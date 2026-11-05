import mongoose from 'mongoose';

// ==================================================================
// MONGODB MODEL (MONGOOSE)
//
// This describes how a file's details are SAVED IN THE DATABASE.
// It is NOT the GraphQL type. The GraphQL type (see graphql/typeDefs.js)
// describes what CLIENTS ARE ALLOWED TO ASK FOR. The two are separate
// on purpose, for example:
//   - the database keeps `fileId` (where the bytes live in GridFS) and
//     `ownerId`, but clients never see them;
//   - clients can ask for `kind`, `sizeLabel` and `shareUrl`, which are
//     not stored here at all; resolvers work them out on request.
// ==================================================================
const docSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  // The account that uploaded the file. Documents without an owner
  // (uploaded before sign-in existed) are visible to NOBODY until
  // scripts/assign-legacy-documents.js gives them an owner.
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // The folder it is in (see Folder.js). null or missing = top level
  // ("My documents"), which is where every older document lives.
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  filename: String,
  contentType: String,
  // Size in bytes.
  size: Number,
  // Id of the file contents in GridFS (see storage/fileStorage.js).
  fileId: mongoose.Schema.Types.ObjectId,
  // OLD FILES ONLY: files uploaded before GridFS was added keep their
  // bytes here. New uploads leave this empty.
  data: Buffer,

  // PRIVACY: every document starts private. Only the owner can switch
  // it to public, which creates a random, unguessable shareToken.
  // Switching back to private deletes the token, so old links stop
  // working immediately.
  visibility: { type: String, enum: ['private', 'public'], default: 'private' },
  shareToken: String,
  publishedAt: Date,

  // Random id sent by the browser with each upload. Sending the same
  // upload twice (double click, retry after a network error) returns
  // the first document instead of creating a duplicate.
  uploadId: String,
  uploadedAt: { type: Date, default: Date.now }
});

// Fast "my documents, newest first" and "my documents by name".
docSchema.index({ ownerId: 1, uploadedAt: -1 });
docSchema.index({ ownerId: 1, filename: 1 });
// "Documents in this folder, newest first".
docSchema.index({ ownerId: 1, folderId: 1, uploadedAt: -1 });
// Only documents that HAVE a token are indexed, and each token is unique.
docSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } });
docSchema.index({ ownerId: 1, uploadId: 1 }, { unique: true, partialFilterExpression: { uploadId: { $type: 'string' } } });

const Document = mongoose.model('Document', docSchema);

export default Document;
