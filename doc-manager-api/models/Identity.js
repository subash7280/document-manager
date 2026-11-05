import mongoose from 'mongoose';

// ==================================================================
// IDENTITY = one way of signing in to a User account.
//
// The pair (provider, subject) is the ONLY thing that decides "who is
// this person". `subject` is the provider's permanent user id (the
// "sub" claim of the ID token). Emails can change or be recycled, so
// they are never used to match a sign-in to an account.
// ==================================================================
const identitySchema = new mongoose.Schema({
  provider: { type: String, enum: ['google', 'apple'], required: true },
  subject: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false }
}, { timestamps: true });

// One identity can belong to only one account.
identitySchema.index({ provider: 1, subject: 1 }, { unique: true });
// Used to detect "this email already has an account" (no auto-merge).
identitySchema.index({ email: 1 });

const Identity = mongoose.model('Identity', identitySchema);

export default Identity;
