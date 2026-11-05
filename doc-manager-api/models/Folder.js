import mongoose from 'mongoose';

// ==================================================================
// FOLDER = a named box for documents, like a folder in Google Drive.
// Folders can contain other folders (e.g. "Proofs" -> "10th", "12th").
//
//   parentId   -> the folder it sits in (null = top level, "My documents")
//   ancestors  -> EVERY folder above it, top-down. For Proofs/10th/Marks:
//                 Marks.ancestors = [Proofs, 10th]
//                 Storing the whole chain makes two things one query:
//                   the breadcrumb       -> Folder.find({ _id: { $in: ancestors } })
//                   "everything inside"  -> Folder.find({ ancestors: folderId })
// Documents point at their folder with Document.folderId.
// ==================================================================
const folderSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Folder' }]
}, { timestamps: true });

// No two folders with the same name in the same place. The collation
// makes the check ignore upper/lower case: "Proofs" = "proofs".
folderSchema.index(
  { ownerId: 1, parentId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);
folderSchema.index({ ownerId: 1, ancestors: 1 });

const Folder = mongoose.model('Folder', folderSchema);

export default Folder;
