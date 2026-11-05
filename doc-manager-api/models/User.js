import mongoose from 'mongoose';

// ==================================================================
// USER = one person's account.
// A user does not store any password: they sign in through Google or
// Apple. Each sign-in method is an Identity (see Identity.js); one user
// can have several identities (e.g. Google AND Apple, linked in Settings).
// ==================================================================
const userSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 100 },
  // Only a VERIFIED email from the provider is stored here.
  email: { type: String, lowercase: true, trim: true },
  avatarUrl: String,
  lastLoginAt: Date,
  // ADMIN: can see every user and their documents (the Admin page).
  // No API can change this: set it to true directly in MongoDB
  // (e.g. MongoDB Compass). It takes effect on the user's next request.
  isAdmin: { type: Boolean, default: false }
}, { timestamps: true });

userSchema.index({ email: 1 });

const User = mongoose.model('User', userSchema);

export default User;
