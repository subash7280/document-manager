import mongoose from 'mongoose';

// ==================================================================
// FILE STORAGE (MONGODB GRIDFS)
//
// MongoDB cannot store a single record bigger than 16 MB, but this app
// accepts files up to 20 MB. GridFS is MongoDB's built-in answer: it
// cuts a file into small chunks (255 KB each) and stores them in two
// collections:
//   files.files   -> one row per file (name, length, upload date)
//   files.chunks  -> the pieces of the file contents
//
// This has NOTHING to do with GraphQL. Resolvers and routes only call
// the functions below and do not care how the bytes are stored.
// Files are never reachable by a direct storage URL: every read goes
// through an authorization check first (documents/routes.js).
// ==================================================================

// The bucket can only be created after mongoose has connected, so it
// is created on first use instead of when this file is loaded.
let bucket;
const getBucket = () => {
  if (!bucket) {
    bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'files' });
  }
  return bucket;
};

// Tests reconnect to a fresh database; forget the old bucket.
mongoose.connection.on('connected', () => {
  bucket = undefined;
});

// ------------------------------------------------------------------
// SAVE: bytes -> GridFS. Resolves with the new file's id, which the
// Document record keeps in its `fileId` field.
// ------------------------------------------------------------------
export const saveFile = (name, buffer) => new Promise((resolve, reject) => {
  const upload = getBucket().openUploadStream(name);
  upload.on('error', reject);
  upload.on('finish', () => resolve(upload.id));
  upload.end(buffer);
});

// ------------------------------------------------------------------
// STREAM: GridFS -> a readable stream, so a download is sent to the
// browser chunk by chunk instead of loading 20 MB into memory first.
// ------------------------------------------------------------------
export const openReadStream = (fileId) => getBucket().openDownloadStream(fileId);

// ------------------------------------------------------------------
// DELETE: removes the file row and all of its chunks.
// ------------------------------------------------------------------
export const deleteFile = (fileId) => getBucket().delete(fileId);
