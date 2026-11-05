import { GraphQLError } from 'graphql';
import mongoose from 'mongoose';
import Folder from '../models/Folder.js';

// ==================================================================
// FOLDER RULES - the one place that decides which folder an id means.
// Like documents, a folder is only ever visible to its owner; someone
// else's folder looks exactly like a folder that does not exist.
// ==================================================================

// How deep folders may be nested (Proofs / 10th / Marks = 3 levels).
export const MAX_DEPTH = 20;

// The name used for the top level in breadcrumbs and the activity log.
export const ROOT_NAME = 'My documents';

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

export const isObjectId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

// "  Proofs   2026 " -> "Proofs 2026". Throws a friendly error when the
// name is empty or too long.
export function cleanFolderName(name) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) throw badInput('Please enter a folder name.');
  if (clean.length > 100) throw badInput('Folder names can be at most 100 characters.');
  return clean;
}

export const findOwnedFolder = (user, id) =>
  (isObjectId(id) ? Folder.findOne({ _id: id, ownerId: user._id }) : null);

// Where something should GO (upload, create, move):
//   null or "root" -> null (the top level)
//   a folder id    -> that folder, which must be the user's own
export async function destinationFolder(user, folderId) {
  if (folderId == null || folderId === 'root') return null;
  const folder = await findOwnedFolder(user, folderId);
  if (!folder) throw badInput('That folder no longer exists.');
  return folder;
}

// MongoDB condition for "documents in this place" (list filters):
//   undefined / null -> {} (everywhere)
//   "root"           -> top level (folderId null OR missing)
//   a folder id      -> that folder
export function folderScope(folderId) {
  if (folderId == null) return {};
  if (folderId === 'root') return { folderId: null };
  if (!isObjectId(folderId)) throw badInput('Invalid folder id.');
  return { folderId: new mongoose.Types.ObjectId(folderId) };
}

// The name of the folder a thing is in, for the activity log.
export async function folderName(folderId) {
  if (!folderId) return ROOT_NAME;
  return (await Folder.findById(folderId, { name: 1 }))?.name ?? ROOT_NAME;
}

// A unique-index clash means the name is taken in that place.
export function nameTaken(err, name) {
  if (err?.code === 11000) return badInput(`A folder named "${name}" already exists there.`);
  return err;
}
