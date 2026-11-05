import { GraphQLError } from 'graphql';
import crypto from 'node:crypto';
import ActivityLog from '../models/ActivityLog.js';
import Document from '../models/Document.js';
import Folder from '../models/Folder.js';
import Identity from '../models/Identity.js';
import User from '../models/User.js';
import { tracked } from '../activity/log.js';
import { deleteFile, saveFile } from '../storage/fileStorage.js';
import {
  accessibleBy, findOwnedDocument, findPublicDocument, newShareToken, requireAdmin, requireUser
} from '../documents/access.js';
import { MAX_FILE_SIZE, cleanFilename, detectFileType } from '../documents/fileTypes.js';
import {
  MAX_DEPTH, ROOT_NAME, cleanFolderName, destinationFolder, findOwnedFolder, folderName, folderScope, isObjectId, nameTaken
} from '../folders/access.js';

// ==================================================================
// HELPERS
// ==================================================================

// Makes user text safe to use inside a regular expression, so a search
// for "a.b" finds "a.b" literally (and "(((" cannot break the query).
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Turns the optional filter arguments into a MongoDB filter object.
// It ALWAYS starts with "documents this user may access", so no filter
// combination can ever return someone else's files.
//   folderId   -> see folderScope() in folders/access.js
//   kind IMAGE -> contentType starts with "image/"
//   kind PDF   -> contentType is exactly "application/pdf"
//   kind OTHER -> everything else (including files with no contentType)
const buildFilter = (user, { folderId, search, kind, visibility }) => {
  const conditions = [accessibleBy(user), folderScope(folderId)];

  const text = (search ?? '').trim();
  if (text) {
    conditions.push({ filename: { $regex: escapeRegex(text), $options: 'i' } });
  }

  if (kind === 'IMAGE') {
    conditions.push({ contentType: { $regex: '^image/' } });
  } else if (kind === 'PDF') {
    conditions.push({ contentType: 'application/pdf' });
  } else if (kind === 'OTHER') {
    conditions.push({ contentType: { $not: /^image\//, $ne: 'application/pdf' } });
  }

  // `visibility` already arrives as 'private' / 'public' (see the
  // ENUM MAPPING at the bottom of this file).
  if (visibility) {
    conditions.push({ visibility });
  }

  return { $and: conditions };
};

// DocumentSort enum value -> MongoDB sort. The uuid tie-breaker keeps
// pages stable when two files have the same date, name or size.
const SORTS = {
  NEWEST: { uploadedAt: -1, uuid: 1 },
  OLDEST: { uploadedAt: 1, uuid: 1 },
  NAME_ASC: { filename: 1, uuid: 1 },
  NAME_DESC: { filename: -1, uuid: 1 },
  LARGEST: { size: -1, uuid: 1 }
};

// Same rules as buildFilter, but for one document already in memory.
const kindOf = (contentType) => {
  if (contentType && contentType.startsWith('image/')) return 'IMAGE';
  if (contentType === 'application/pdf') return 'PDF';
  return 'OTHER';
};

// 1536 -> "1.5 KB"
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const toIso = (date) => (date ? date.toISOString() : null);

// page / limit arguments -> safe numbers. A client may explicitly send
// `page: null`, which overrides the schema default, hence the "??".
const pagination = (page, limit, defaultLimit) => {
  const safePage = Math.max(1, page ?? 1);
  const safeLimit = Math.max(1, Math.min(100, limit ?? defaultLimit));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

// Errors the CLIENT caused (bad input) are tagged with a "code".
// The code lands in the response as errors[0].extensions.code, so a
// frontend can react to the kind of error, not just show the text.
const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const isDuplicateKey = (err) => err?.code === 11000;

const dateArgument = (value, name) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badInput(`"${name}" is not a valid date.`);
  return date;
};

// Activity log "target" for a document / folder.
const docTarget = (doc) => ({ type: 'document', id: doc.uuid, name: doc.filename });
const folderTarget = (folder) => ({ type: 'folder', id: folder.id, name: folder.name });

// One page of documents (DocumentPage and AdminDocumentPage).
// { data: 0 } = do NOT load the file bytes from MongoDB.
// The collation makes name sorting ignore upper/lower case.
const listDocuments = (page) =>
  Document.find(page.filter, { data: 0 })
    .collation({ locale: 'en', strength: 2 })
    .sort(page.sort)
    .skip(page.skip)
    .limit(page.limit);

// A document's folder (Document.folder and AdminDocument.folder).
// context.folderCache (app.js) remembers folders already loaded in
// THIS request, so 12 documents in one folder = 1 database query.
const documentFolder = (doc, _args, context) => {
  if (!doc.folderId) return null;
  const key = doc.folderId.toString();
  if (!context.folderCache.has(key)) {
    // .exec() turns the query into a promise. A Mongoose query can
    // run only once, but a promise can be awaited by every document.
    context.folderCache.set(key, Folder.findOne({ _id: doc.folderId, ownerId: doc.ownerId }, { name: 1 }).exec());
  }
  return context.folderCache.get(key);
};

// How many documents a user has and their total size, for the Admin
// page. Cached per request (context.userStats), so documentCount and
// storageUsed share ONE database query.
const userStats = (user, context) => {
  const key = user._id.toString();
  if (!context.userStats.has(key)) {
    context.userStats.set(key, Document.aggregate([
      { $match: { ownerId: user._id } },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$size', 0] } } } }
    ]).then(([row]) => ({ count: row?.count ?? 0, bytes: row?.bytes ?? 0 })));
  }
  return context.userStats.get(key);
};

// ==================================================================
// RESOLVERS
//
// The schema (typeDefs.js) says WHAT can be asked for.
// Resolvers say HOW to get it. There is one function per field that
// needs custom logic; the object below mirrors the schema's shape:
//   resolvers.Query.documents   <->  type Query    { documents }
//   resolvers.Mutation.X        <->  type Mutation { X }
//   resolvers.Document.Y        <->  type Document { Y }
//
// Every resolver receives the same 4 arguments:
//   (parent, args, context, info)
//   parent  -> the result of the field "above" this one
//              (for Document.kind, it is the Document object)
//   args    -> the arguments the client passed, e.g. { uuid: "..." }.
//              GraphQL has ALREADY validated their types against the
//              schema, so `uuid` is guaranteed to be a string here and
//              `kind` is guaranteed to be IMAGE, PDF, OTHER or null.
//   context -> shared per-request data, built in app.js:
//              { user, config, client, ... }. `user` comes from the
//              session cookie, checked on the SERVER - the client
//              cannot fake it.
//   info    -> details about the query itself (rarely needed)
// Unused arguments are named with a leading "_" by convention.
//
// MUTATIONS are wrapped in tracked('ACTION', ...) (activity/log.js), so
// every change is written to the user's activity log, together with the
// browser and device it came from. Inside, the resolver gets
// (args, context, activity) and fills in `activity` as it goes.
//
// Fields WITHOUT a resolver (uuid, filename, contentType, size, total,
// page, limit) use GraphQL's "default resolver", which simply reads the
// property with the same name from the parent object.
//
// ERRORS: throwing a GraphQLError sends its message to the client.
// Any other unexpected error is hidden by GraphQL Yoga and replaced
// with "Unexpected error." so server internals never leak; the real
// error is printed in the server console AND emailed to the
// exception_mail list (see the plugin in app.js).
// ==================================================================
export const resolvers = {
  // ----------------------------------------------------------------
  // QUERY RESOLVERS (READ-ONLY)
  // ----------------------------------------------------------------
  Query: {
    // No sign-in required: returns null for visitors.
    me: (_parent, _args, context) => context.user ?? null,

    documents: async (_parent, { folderId, page, limit, search, kind, visibility, sort }, context) => {
      const user = requireUser(context);
      const paging = pagination(page, limit, 10);
      const filter = buildFilter(user, { folderId, search, kind, visibility });
      const total = await Document.countDocuments(filter);

      // This object becomes the `parent` of the DocumentPage field
      // resolvers below. `filter`, `skip` and `sort` are NOT in the
      // schema, so clients can never see them; they are only passed
      // along so that DocumentPage.documents knows what to load.
      return { total, ...paging, filter, sort: SORTS[sort ?? 'NEWEST'] };
    },

    // Returning null is the normal GraphQL way to say "not found".
    // Someone else's document is ALSO "not found": the answer never
    // reveals that a document exists.
    document: (_parent, { uuid }, context) => findOwnedDocument(requireUser(context), uuid),

    // No sign-in required. Null for a wrong, revoked or private token.
    publicDocument: (_parent, { token }) => findPublicDocument(token),

    folder: (_parent, { id }, context) => findOwnedFolder(requireUser(context), id),

    folders: (_parent, { parentId, search }, context) => {
      const user = requireUser(context);
      const filter = { ownerId: user._id };
      const text = (search ?? '').trim();
      if (text) {
        filter.name = { $regex: escapeRegex(text), $options: 'i' };
      } else if (parentId === 'root') {
        filter.parentId = null;
      } else if (parentId != null) {
        if (!isObjectId(parentId)) throw badInput('Invalid folder id.');
        filter.parentId = parentId;
      }
      // The collation sorts "apple", "Banana", "cherry" like a person would.
      return Folder.find(filter).collation({ locale: 'en', strength: 2, numericOrdering: true }).sort({ name: 1 }).limit(1000);
    },

    activityLogs: async (_parent, args, context) => {
      const user = requireUser(context);
      const paging = pagination(args.page, args.limit, 20);

      // Same idea as buildFilter: it ALWAYS starts with "this user".
      const filter = { userId: user._id };
      if (args.category) filter.category = args.category;
      if (args.action) filter.action = args.action;
      if (args.status) filter.status = args.status;
      if (args.deviceType) filter['client.deviceType'] = args.deviceType;
      if (args.browser) filter['client.browser'] = args.browser;
      if (args.os) filter['client.os'] = args.os;
      const text = (args.search ?? '').trim();
      if (text) filter['target.name'] = { $regex: escapeRegex(text), $options: 'i' };
      const from = dateArgument(args.from, 'from');
      const to = dateArgument(args.to, 'to');
      if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

      const total = await ActivityLog.countDocuments(filter);
      return { total, ...paging, filter };
    },

    // distinct = every different value of a field, e.g. ["Chrome", "Edge"].
    activityFilterOptions: async (_parent, _args, context) => {
      const user = requireUser(context);
      const values = async (field) =>
        (await ActivityLog.distinct(field, { userId: user._id })).filter(Boolean).sort((a, b) => a.localeCompare(b));
      return { browsers: await values('client.browser'), operatingSystems: await values('client.os') };
    },

    // ---------------- ADMIN (read-only, every user) ----------------
    adminUsers: async (_parent, { page, limit, search }, context) => {
      requireAdmin(context);
      const paging = pagination(page, limit, 25);
      const filter = {};
      const text = (search ?? '').trim();
      if (text) {
        const pattern = { $regex: escapeRegex(text), $options: 'i' };
        filter.$or = [{ name: pattern }, { email: pattern }];
      }
      const total = await User.countDocuments(filter);
      return { total, ...paging, filter };
    },

    adminUser: (_parent, { id }, context) => {
      requireAdmin(context);
      return isObjectId(id) ? User.findById(id) : null;
    },

    // Same filters as Query.documents, but for the chosen user and in
    // every folder. buildFilter only needs the user's _id.
    adminDocuments: async (_parent, { userId, page, limit, search, kind, visibility, sort }, context) => {
      requireAdmin(context);
      if (!isObjectId(userId)) throw badInput('Invalid user id.');
      const paging = pagination(page, limit, 25);
      const filter = buildFilter({ _id: userId }, { search, kind, visibility });
      const total = await Document.countDocuments(filter);
      return { total, ...paging, filter, sort: SORTS[sort ?? 'NEWEST'] };
    },
  },

  // ----------------------------------------------------------------
  // MUTATION RESOLVERS (CHANGE DATA)
  // ----------------------------------------------------------------
  Mutation: {
    // `file` is a web File object, built by GraphQL Yoga from the
    // multipart upload (see the File scalar in typeDefs.js).
    uploadDocument: tracked('DOCUMENT_UPLOADED', async ({ file, uploadId, folderId }, context, activity) => {
      const user = requireUser(context);

      if (!/^[A-Za-z0-9-]{8,64}$/.test(uploadId)) {
        throw badInput('Invalid upload id.');
      }
      // Same uploadId again (retry / double click) -> same document.
      // (Not logged again: activity.target is not set on this path.)
      const previous = await Document.findOne({ ownerId: user._id, uploadId }, { data: 0 });
      if (previous) return previous;

      if (!file || typeof file.arrayBuffer !== 'function') {
        throw badInput('No file was received.');
      }
      // Browsers send a " in a file name as %22 (HTML multipart rules).
      const filename = cleanFilename(file.name.replace(/%22/g, '"'));
      // Named now, so a failure below is logged with the file's name.
      activity.failedTarget = { type: 'document', name: filename || String(file.name).slice(0, 255) };
      if (file.size > MAX_FILE_SIZE) {
        throw badInput('File is too large. The maximum size is 20 MB.');
      }
      if (file.size === 0) {
        throw badInput('The file is empty.');
      }
      if (!filename) {
        throw badInput('The file needs a name.');
      }
      const folder = await destinationFolder(user, folderId);
      activity.to = folder?.name ?? ROOT_NAME;

      const data = Buffer.from(await file.arrayBuffer());
      if (data.length > MAX_FILE_SIZE) {
        throw badInput('File is too large. The maximum size is 20 MB.');
      }

      // The SERVER decides the type from the extension + the file's
      // first bytes. The browser's file.type is ignored on purpose.
      const detected = detectFileType(filename, data);
      if (detected.error) {
        throw badInput(detected.error);
      }

      // Step 1: store the bytes in GridFS (see storage/fileStorage.js).
      const uuid = crypto.randomUUID();
      const fileId = await saveFile(uuid, data);

      // Step 2: store the details, pointing at the bytes via fileId.
      // New documents are ALWAYS private (schema default).
      try {
        const doc = await Document.create({
          uuid,
          ownerId: user._id,
          folderId: folder?._id ?? null,
          filename,
          contentType: detected.contentType,
          size: data.length,
          fileId,
          uploadId
        });
        activity.target = docTarget(doc);
        return doc;
      } catch (err) {
        // The details could not be saved, so remove the bytes from
        // step 1 instead of leaving an orphaned file in GridFS.
        await deleteFile(fileId);
        // Two identical uploads arrived at the same time: return the winner.
        if (isDuplicateKey(err)) {
          const winner = await Document.findOne({ ownerId: user._id, uploadId }, { data: 0 });
          if (winner) return winner;
        }
        throw err;
      }
    }),

    // An UPDATE mutation (REST would use PUT or PATCH for this).
    // It returns the updated document, so the client can show the new
    // name straight away without asking the server for the list again.
    renameDocument: tracked('DOCUMENT_RENAMED', async ({ uuid, filename }, context, activity) => {
      const user = requireUser(context);
      const doc = await findOwnedDocument(user, uuid);
      // Another user's uuid finds nothing, so the answer is null.
      if (!doc) return null;
      activity.failedTarget = docTarget(doc);

      const newName = cleanFilename(filename);
      if (!newName) {
        throw badInput('File name cannot be empty.');
      }
      if (filename.trim().length > 255) {
        throw badInput('File name is too long (max 255 characters).');
      }
      if (newName === doc.filename) return doc;

      activity.from = doc.filename;
      doc.filename = newName;
      await doc.save();
      activity.to = newName;
      activity.target = docTarget(doc);
      return doc;
    }),

    // Deletes the details AND the file bytes in GridFS. Deleting the
    // document also deletes its public link.
    deleteDocument: tracked('DOCUMENT_DELETED', async ({ uuid }, context, activity) => {
      const user = requireUser(context);
      const doc = await Document.findOneAndDelete({ uuid, ...accessibleBy(user) }, { projection: { data: 0 } });
      if (!doc) return false;
      activity.target = docTarget(doc);
      activity.from = await folderName(doc.folderId);

      if (doc.fileId) {
        try {
          await deleteFile(doc.fileId);
        } catch (err) {
          // The document is already gone for the user, so still report
          // success; just log the leftover bytes for the server owner.
          console.error('Could not delete GridFS file ' + doc.fileId, err);
        }
      }
      return true;
    }),

    // Puts a document into another folder ("root" / null = top level).
    moveDocument: tracked('DOCUMENT_MOVED', async ({ uuid, folderId }, context, activity) => {
      const user = requireUser(context);
      const doc = await findOwnedDocument(user, uuid);
      if (!doc) return null;
      activity.failedTarget = docTarget(doc);

      const folder = await destinationFolder(user, folderId);
      const newFolderId = folder?._id ?? null;
      if (String(doc.folderId ?? null) === String(newFolderId)) return doc; // already there

      activity.from = await folderName(doc.folderId);
      doc.folderId = newFolderId;
      await doc.save();
      activity.to = folder?.name ?? ROOT_NAME;
      activity.target = docTarget(doc);
      return doc;
    }),

    // PUBLIC  -> creates a new unguessable token (kept if already public)
    // PRIVATE -> deletes the token: the old public link dies at once,
    //            and publishing again later creates a DIFFERENT link.
    setDocumentVisibility: tracked(
      ({ visibility }) => (visibility === 'public' ? 'DOCUMENT_MADE_PUBLIC' : 'DOCUMENT_MADE_PRIVATE'),
      async ({ uuid, visibility }, context, activity) => {
        const doc = await findOwnedDocument(requireUser(context), uuid);
        if (!doc) return null;
        activity.failedTarget = docTarget(doc);
        const wasPublic = doc.visibility === 'public' && Boolean(doc.shareToken);

        if (visibility === 'public') {
          if (wasPublic) return doc; // nothing changes
          doc.visibility = 'public';
          doc.shareToken = newShareToken();
          doc.publishedAt = new Date();
        } else {
          if (doc.visibility !== 'public' && !doc.shareToken) return doc; // already private
          doc.visibility = 'private';
          doc.shareToken = undefined;
          doc.publishedAt = undefined;
        }
        await doc.save();
        activity.target = docTarget(doc);
        return doc;
      }
    ),

    resetShareLink: tracked('SHARE_LINK_RESET', async ({ uuid }, context, activity) => {
      const doc = await findOwnedDocument(requireUser(context), uuid);
      if (!doc) return null;
      activity.failedTarget = docTarget(doc);
      if (doc.visibility !== 'public') {
        throw badInput('Only public documents have a link to reset.');
      }
      doc.shareToken = newShareToken();
      doc.publishedAt = new Date();
      await doc.save();
      activity.target = docTarget(doc);
      return doc;
    }),

    // ---------------- FOLDERS ----------------
    createFolder: tracked('FOLDER_CREATED', async ({ name, parentId }, context, activity) => {
      const user = requireUser(context);
      const folderNameClean = cleanFolderName(name);
      activity.failedTarget = { type: 'folder', name: folderNameClean };

      const parent = await destinationFolder(user, parentId);
      const ancestors = parent ? [...parent.ancestors, parent._id] : [];
      if (ancestors.length >= MAX_DEPTH) {
        throw badInput(`Folders can be nested at most ${MAX_DEPTH} levels deep.`);
      }

      let folder;
      try {
        folder = await Folder.create({ ownerId: user._id, name: folderNameClean, parentId: parent?._id ?? null, ancestors });
      } catch (err) {
        throw nameTaken(err, folderNameClean);
      }
      activity.to = parent?.name ?? ROOT_NAME;
      activity.target = folderTarget(folder);
      return folder;
    }),

    renameFolder: tracked('FOLDER_RENAMED', async ({ id, name }, context, activity) => {
      const user = requireUser(context);
      const folder = await findOwnedFolder(user, id);
      if (!folder) return null;
      activity.failedTarget = folderTarget(folder);

      const newName = cleanFolderName(name);
      if (newName === folder.name) return folder;
      const oldName = folder.name;
      folder.name = newName;
      try {
        await folder.save();
      } catch (err) {
        throw nameTaken(err, newName);
      }
      activity.from = oldName;
      activity.to = newName;
      activity.target = folderTarget(folder);
      return folder;
    }),

    // Moving a folder moves everything inside it. Because each folder
    // stores its full `ancestors` chain, every folder below the moved
    // one gets its chain rewritten too:
    //   old: [Proofs, 10th, Marks]   moving 10th from Proofs to Archive
    //   new: [Archive, 10th, Marks]
    moveFolder: tracked('FOLDER_MOVED', async ({ id, parentId }, context, activity) => {
      const user = requireUser(context);
      const folder = await findOwnedFolder(user, id);
      if (!folder) return null;
      activity.failedTarget = folderTarget(folder);

      const parent = await destinationFolder(user, parentId);
      if (parent && (parent._id.equals(folder._id) || parent.ancestors.some((a) => a.equals(folder._id)))) {
        throw badInput('A folder cannot be moved into itself or into one of its own subfolders.');
      }
      if (String(folder.parentId ?? null) === String(parent?._id ?? null)) return folder; // already there

      const newAncestors = parent ? [...parent.ancestors, parent._id] : [];
      const descendants = await Folder.find({ ownerId: user._id, ancestors: folder._id }, { ancestors: 1 });
      const deepest = Math.max(0, ...descendants.map((d) => d.ancestors.length - folder.ancestors.length));
      if (newAncestors.length + deepest >= MAX_DEPTH) {
        throw badInput(`That would nest folders more than ${MAX_DEPTH} levels deep.`);
      }

      const oldDepth = folder.ancestors.length;
      activity.from = await folderName(folder.parentId);
      folder.parentId = parent?._id ?? null;
      folder.ancestors = newAncestors;
      try {
        await folder.save();
      } catch (err) {
        throw nameTaken(err, folder.name);
      }
      if (descendants.length) {
        await Folder.bulkWrite(descendants.map((d) => ({
          updateOne: {
            filter: { _id: d._id },
            update: { $set: { ancestors: [...newAncestors, folder._id, ...d.ancestors.slice(oldDepth + 1)] } }
          }
        })));
      }
      activity.to = parent?.name ?? ROOT_NAME;
      activity.target = folderTarget(folder);
      return folder;
    }),

    // Deletes the folder, every folder below it, and every document in
    // any of them (details + bytes, so their public links die too).
    deleteFolder: tracked('FOLDER_DELETED', async ({ id }, context, activity) => {
      const user = requireUser(context);
      const folder = await findOwnedFolder(user, id);
      if (!folder) return false;
      activity.failedTarget = folderTarget(folder);

      const descendants = await Folder.find({ ownerId: user._id, ancestors: folder._id }, { _id: 1 });
      const folderIds = [folder._id, ...descendants.map((d) => d._id)];
      const docs = await Document.find({ ownerId: user._id, folderId: { $in: folderIds } }, { fileId: 1 });

      await Document.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      for (const doc of docs) {
        if (!doc.fileId) continue;
        try {
          await deleteFile(doc.fileId);
        } catch (err) {
          console.error('Could not delete GridFS file ' + doc.fileId, err);
        }
      }
      await Folder.deleteMany({ _id: { $in: folderIds } });

      activity.from = await folderName(folder.parentId);
      activity.note = `${descendants.length} ${descendants.length === 1 ? 'subfolder' : 'subfolders'} and `
        + `${docs.length} ${docs.length === 1 ? 'document' : 'documents'} deleted with it`;
      activity.target = folderTarget(folder);
      return true;
    }),

    // ---------------- ACCOUNT ----------------
    updateProfile: tracked('PROFILE_UPDATED', async ({ name }, context, activity) => {
      const user = requireUser(context);
      const newName = name.trim();
      if (!newName || newName.length > 100) {
        throw badInput('Name must be 1 to 100 characters.');
      }
      if (newName === user.name) return user;
      activity.from = user.name;
      user.name = newName;
      await user.save();
      activity.to = newName;
      activity.target = { type: 'account', id: user.id, name: 'Display name' };
      return user;
    }),

    // `provider` arrives as 'google' / 'apple' (ENUM MAPPING below).
    unlinkAccount: tracked('ACCOUNT_UNLINKED', async ({ provider }, context, activity) => {
      const user = requireUser(context);
      const target = { type: 'account', id: provider, name: provider === 'apple' ? 'Apple' : 'Google' };
      activity.failedTarget = target;
      const count = await Identity.countDocuments({ userId: user._id });
      if (count <= 1) {
        throw badInput('You cannot remove your only sign-in method.');
      }
      const { deletedCount } = await Identity.deleteOne({ userId: user._id, provider });
      if (deletedCount) activity.target = target;
      return user;
    }),
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: DocumentPage and ActivityLogPage TYPES
  // `page` here is the object returned by Query.documents above.
  // ----------------------------------------------------------------
  DocumentPage: {
    // Computed: is there another page after this one?
    hasNextPage: (page) => page.page * page.limit < page.total,

    // The list itself is loaded ONLY if the client asks for
    // `documents { ... }`. A query that asks just for `total` (like the
    // frontend's summary counts) never runs this database call.
    documents: listDocuments,
  },

  AdminDocumentPage: {
    hasNextPage: (page) => page.page * page.limit < page.total,
    documents: listDocuments,
  },

  AdminUserPage: {
    hasNextPage: (page) => page.page * page.limit < page.total,
    users: (page) => User.find(page.filter)
      .collation({ locale: 'en', strength: 2, numericOrdering: true })
      .sort({ name: 1, _id: 1 })
      .skip(page.skip)
      .limit(page.limit),
  },

  ActivityLogPage: {
    hasNextPage: (page) => page.page * page.limit < page.total,
    entries: (page) => ActivityLog.find(page.filter).sort({ createdAt: -1, _id: -1 }).skip(page.skip).limit(page.limit),
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: Document TYPE
  // They run once for EACH Document in a response, but only when the
  // client actually asked for that field.
  // ----------------------------------------------------------------
  Document: {
    // MongoDB returns a JavaScript Date; convert it to readable text.
    uploadedAt: (doc) => toIso(doc.uploadedAt),
    publishedAt: (doc) => toIso(doc.publishedAt),

    // Old documents have no visibility field: they are private.
    visibility: (doc) => doc.visibility ?? 'private',

    // The full public link, built from the app's address. Only the
    // owner ever receives a Document, so only the owner sees it.
    shareUrl: (doc, _args, context) =>
      doc.visibility === 'public' && doc.shareToken ? `${context.config.appOrigin}/s/${doc.shareToken}` : null,

    contentUrl: (doc) => `/api/documents/${doc.uuid}/content`,
    downloadUrl: (doc) => `/api/documents/${doc.uuid}/content?download=1`,

    folderId: (doc) => doc.folderId?.toString() ?? null,

    folder: documentFolder,

    // Computed field: returned as a string, GraphQL checks that it is
    // one of the FileKind enum values.
    kind: (doc) => kindOf(doc.contentType),

    // Computed field: null when the size is unknown.
    sizeLabel: (doc) => {
      return typeof doc.size === 'number' ? formatBytes(doc.size) : null;
    },
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: Folder TYPE
  // ----------------------------------------------------------------
  Folder: {
    id: (folder) => folder._id.toString(),
    parentId: (folder) => folder.parentId?.toString() ?? null,
    createdAt: (folder) => toIso(folder.createdAt),
    updatedAt: (folder) => toIso(folder.updatedAt),

    // The ancestors in the stored order (top-down). $in does not keep
    // order, so the results are put back in `ancestors` order.
    path: async (folder) => {
      if (!folder.ancestors?.length) return [];
      const found = await Folder.find({ _id: { $in: folder.ancestors }, ownerId: folder.ownerId }, { name: 1 });
      const byId = new Map(found.map((f) => [f.id, f]));
      return folder.ancestors.map((id) => byId.get(id.toString())).filter(Boolean);
    },

    folderCount: (folder) => Folder.countDocuments({ ownerId: folder.ownerId, parentId: folder._id }),
    documentCount: (folder) => Document.countDocuments({ ownerId: folder.ownerId, folderId: folder._id }),

    contents: async (folder) => {
      const below = await Folder.find({ ownerId: folder.ownerId, ancestors: folder._id }, { _id: 1 });
      const documents = await Document.countDocuments({
        ownerId: folder.ownerId,
        folderId: { $in: [folder._id, ...below.map((f) => f._id)] }
      });
      return { folders: below.length, documents };
    },
  },

  FolderRef: {
    id: (folder) => folder._id?.toString() ?? folder.id,
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: ActivityLog TYPE
  // `client` needs no resolver: it is stored with the same field names
  // as the ClientInfo type.
  // ----------------------------------------------------------------
  ActivityLog: {
    id: (log) => log._id.toString(),
    targetType: (log) => log.target?.type ?? null,
    targetName: (log) => log.target?.name ?? null,
    createdAt: (log) => toIso(log.createdAt),
    client: (log) => log.client ?? {},
  },

  ClientInfo: {
    deviceType: (client) => client.deviceType ?? 'OTHER',
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: PublicDocument TYPE
  // The parent is the same MongoDB document, but this type exposes far
  // fewer fields, and its URLs use the share token instead of the uuid.
  // ----------------------------------------------------------------
  PublicDocument: {
    kind: (doc) => kindOf(doc.contentType),
    sizeLabel: (doc) => (typeof doc.size === 'number' ? formatBytes(doc.size) : null),
    contentUrl: (doc) => `/api/shared/${doc.shareToken}/content`,
    downloadUrl: (doc) => `/api/shared/${doc.shareToken}/content?download=1`,
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: ADMIN TYPES
  // AdminDocument's URLs use the admin file route, which checks
  // isAdmin again (documents/routes.js). There is no shareUrl.
  // ----------------------------------------------------------------
  AdminDocument: {
    uploadedAt: (doc) => toIso(doc.uploadedAt),
    visibility: (doc) => doc.visibility ?? 'private',
    folder: documentFolder,
    kind: (doc) => kindOf(doc.contentType),
    sizeLabel: (doc) => (typeof doc.size === 'number' ? formatBytes(doc.size) : null),
    contentUrl: (doc) => `/api/admin/documents/${doc.uuid}/content`,
    downloadUrl: (doc) => `/api/admin/documents/${doc.uuid}/content?download=1`,
  },

  AdminUser: {
    id: (user) => user._id.toString(),
    isAdmin: (user) => Boolean(user.isAdmin),
    createdAt: (user) => toIso(user.createdAt),
    lastLoginAt: (user) => toIso(user.lastLoginAt),
    documentCount: async (user, _args, context) => (await userStats(user, context)).count,
    storageUsed: async (user, _args, context) => (await userStats(user, context)).bytes,
    storageLabel: async (user, _args, context) => formatBytes((await userStats(user, context)).bytes),
  },

  // ----------------------------------------------------------------
  // FIELD RESOLVERS: User and LinkedAccount TYPES
  // ----------------------------------------------------------------
  User: {
    id: (user) => user._id.toString(),
    createdAt: (user) => toIso(user.createdAt),
    isAdmin: (user) => Boolean(user.isAdmin),
    linkedAccounts: (user) => Identity.find({ userId: user._id }).sort({ createdAt: 1 }),
  },

  LinkedAccount: {
    linkedAt: (identity) => toIso(identity.createdAt),
  },

  // ----------------------------------------------------------------
  // ENUM MAPPING
  // The API speaks UPPERCASE enum values (PUBLIC, GOOGLE) while the
  // database stores lowercase strings ('public', 'google'). Mapping
  // them here means resolvers receive 'public' in their args, and a
  // stored 'public' is sent to clients as PUBLIC - automatically.
  // (The activity log enums need no mapping: the database stores the
  // enum values themselves, e.g. 'DOCUMENT_UPLOADED'.)
  // ----------------------------------------------------------------
  Visibility: {
    PRIVATE: 'private',
    PUBLIC: 'public',
  },

  AuthProvider: {
    GOOGLE: 'google',
    APPLE: 'apple',
  },
};
