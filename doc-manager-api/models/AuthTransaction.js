import mongoose from 'mongoose';

// ==================================================================
// AUTH TRANSACTION = one sign-in attempt that is in progress.
//
// Created when the user clicks "Continue with Google/Apple", used once
// when the provider sends the user back, then deleted. It holds the
// secrets that prove the answer belongs to THIS attempt in THIS browser:
//   state         -> must come back unchanged (stops forged callbacks)
//   nonce         -> must be inside the ID token (stops token replay)
//   codeVerifier  -> PKCE secret for the code exchange (Google)
// The browser only holds a random key to this record (cookie dm_oauth).
// ==================================================================
const authTransactionSchema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true },
  provider: { type: String, required: true },
  state: { type: String, required: true },
  nonce: { type: String, required: true },
  codeVerifier: String,
  // 'signin' = sign in or create account; 'link' = add this provider
  // to the account in linkUserId (started from Settings).
  intent: { type: String, enum: ['signin', 'link'], default: 'signin' },
  linkUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnTo: { type: String, default: '/' },
  // Apple posts its answer cross-site; it is parked here until the
  // browser comes back same-site (see auth/routes.js).
  callbackParams: { type: Map, of: String },
  expiresAt: { type: Date, required: true }
});

authTransactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuthTransaction = mongoose.model('AuthTransaction', authTransactionSchema);

export default AuthTransaction;
