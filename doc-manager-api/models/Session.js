import mongoose from 'mongoose';

// ==================================================================
// SESSION = one signed-in browser.
// The browser holds a random token in an httpOnly cookie. Only the
// SHA-256 HASH of that token is stored here, so someone who can read
// the database still cannot use it to sign in.
// ==================================================================
const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  userAgent: String
}, { timestamps: true });

// MongoDB deletes expired sessions automatically (checked about once a
// minute; the code also checks expiresAt itself).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model('Session', sessionSchema);

export default Session;
