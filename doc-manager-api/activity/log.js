import { GraphQLError } from 'graphql';
import ActivityLog from '../models/ActivityLog.js';

// ==================================================================
// ACTIVITY LOG: WRITING ENTRIES
// Every action a user takes is recorded with recordActivity(), whether
// it worked or not. The Activity page reads them back (resolvers.js,
// Query.activityLogs).
// ==================================================================

// Every action, and the category it is filed under. These are also the
// values of the ActivityAction / ActivityCategory enums in typeDefs.js.
export const ACTION_CATEGORY = {
  SIGNED_UP: 'AUTH',
  SIGNED_IN: 'AUTH',
  SIGNED_OUT: 'AUTH',
  SIGNED_OUT_EVERYWHERE: 'AUTH',
  ACCOUNT_LINKED: 'ACCOUNT',
  ACCOUNT_UNLINKED: 'ACCOUNT',
  PROFILE_UPDATED: 'ACCOUNT',
  DOCUMENT_UPLOADED: 'DOCUMENT',
  DOCUMENT_RENAMED: 'DOCUMENT',
  DOCUMENT_MOVED: 'DOCUMENT',
  DOCUMENT_DELETED: 'DOCUMENT',
  DOCUMENT_DOWNLOADED: 'DOCUMENT',
  DOCUMENT_MADE_PUBLIC: 'SHARING',
  DOCUMENT_MADE_PRIVATE: 'SHARING',
  SHARE_LINK_RESET: 'SHARING',
  FOLDER_CREATED: 'FOLDER',
  FOLDER_RENAMED: 'FOLDER',
  FOLDER_MOVED: 'FOLDER',
  FOLDER_DELETED: 'FOLDER'
};

// The text the user saw. Expected errors (GraphQLError, e.g. "A folder
// with this name already exists") are shown as they are; anything else
// is an internal error whose details only go to the exception email.
export const publicErrorMessage = (err) =>
  (err instanceof GraphQLError ? err.message : 'Something went wrong on the server.');

const clip = (value, max = 300) => (value == null ? undefined : String(value).slice(0, max));

// Saves one entry. It NEVER throws: a broken log must not break the
// action itself (the problem is printed to the server console instead).
//   entry: { target: { type, id, name }, from, to, note, error }
export async function recordActivity({ userId, client, action, status = 'SUCCESS', entry = {} }) {
  if (!userId) return;
  try {
    await ActivityLog.create({
      userId,
      action,
      category: ACTION_CATEGORY[action],
      status,
      target: entry.target && {
        type: entry.target.type,
        id: clip(entry.target.id, 64),
        name: clip(entry.target.name)
      },
      from: clip(entry.from),
      to: clip(entry.to),
      note: clip(entry.note),
      error: clip(entry.error, 500),
      client
    });
  } catch (err) {
    console.error(`[activity] could not record ${action}:`, err.message);
  }
}

// ------------------------------------------------------------------
// tracked(): wraps a GraphQL mutation resolver so it is logged
// automatically.
//
//   renameDocument: tracked('DOCUMENT_RENAMED', async (args, context, activity) => {
//     ...
//     activity.target = { type: 'document', id: doc.uuid, name: doc.filename };
//     activity.from = oldName;
//     return doc;
//   })
//
// The wrapped function gets (args, context, activity) instead of the
// usual (parent, args, context, info): mutations have no parent, and
// `activity` is a blank entry the resolver fills in as it goes.
//   - Success: logged only if the resolver set activity.target (a
//     "not found" or "nothing changed" answer is not logged).
//   - Failure: always logged for a signed-in user, with the error text.
//     Set activity.failedTarget as soon as the target is known, so a
//     failure is logged with its name too.
// `action` can also be a function of the arguments, for a mutation that
// does two different things (setDocumentVisibility: public / private).
// ------------------------------------------------------------------
export const tracked = (action, resolve) => async (_parent, args, context) => {
  const activity = {};
  const log = (status, extra = {}) => recordActivity({
    userId: context.user?._id,
    client: context.client,
    action: typeof action === 'function' ? action(args) : action,
    status,
    entry: { ...activity, ...extra }
  });

  try {
    const result = await resolve(args, context, activity);
    if (activity.target) await log('SUCCESS');
    return result;
  } catch (err) {
    await log('FAILURE', { target: activity.target ?? activity.failedTarget, error: publicErrorMessage(err) });
    throw err;
  }
};
