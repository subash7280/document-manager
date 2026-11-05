import mongoose from 'mongoose';

// ==================================================================
// ACTIVITY LOG = one line in a user's history: "Renamed a.pdf to b.pdf
// from Chrome on Windows 11, 10:15". Written by activity/log.js after
// every action, successful or not, and shown on the Activity page.
//
// action, category, status and client.deviceType are stored as the
// GraphQL enum values themselves (e.g. 'DOCUMENT_RENAMED', 'SUCCESS'),
// so they need no enum mapping in resolvers.js.
// The target's NAME is copied in, so the history still reads well
// after the document or folder itself has been deleted.
// ==================================================================
const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  category: { type: String, required: true },
  status: { type: String, enum: ['SUCCESS', 'FAILURE'], required: true },

  // What the action was done to.
  target: {
    type: { type: String }, // 'document' | 'folder' | 'account'
    id: String,
    name: String
  },
  // Old and new value for renames and moves; `note` for anything else
  // worth knowing (e.g. "2 folders and 7 documents" for a folder delete).
  from: String,
  to: String,
  note: String,
  // The message the user saw when it failed.
  error: String,

  // Where it was done from (see activity/clientInfo.js).
  client: {
    ip: String,
    userAgent: String,
    browser: String,
    browserVersion: String,
    os: String,
    osVersion: String,
    deviceType: String, // 'DESKTOP' | 'MOBILE' | 'TABLET' | 'OTHER'
    deviceVendor: String,
    deviceModel: String
  },

  createdAt: { type: Date, default: Date.now }
}, { collection: 'activity_logs', versionKey: false });

// "My activity, newest first" (the only way it is ever read).
activityLogSchema.index({ userId: 1, createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

export default ActivityLog;
