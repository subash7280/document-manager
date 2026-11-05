import Identity from '../models/Identity.js';
import User from '../models/User.js';

// ==================================================================
// ACCOUNTS: turning a verified provider profile into a User.
//
// Rules (sign-in and sign-up are the SAME flow):
//   1. Known (provider, subject)  -> sign in to that account.
//   2. Unknown, and the verified email already belongs to an account
//      -> REFUSE. Accounts are never merged just because emails match;
//         the person must sign in the original way and connect the new
//         provider from Settings (which proves they own both).
//   3. Unknown otherwise -> create a new account + identity.
// ==================================================================

export class AuthFlowError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const isDuplicateKey = (err) => err?.code === 11000;

async function signInExisting(identity, profile) {
  const user = await User.findById(identity.userId);
  if (!user) return null;

  identity.email = profile.email ?? identity.email;
  identity.emailVerified = profile.emailVerified;
  await identity.save();

  user.lastLoginAt = new Date();
  if (!user.name && profile.name) user.name = profile.name;
  if (!user.avatarUrl && profile.picture) user.avatarUrl = profile.picture;
  await user.save();
  return user;
}

export async function resolveSignIn(provider, profile) {
  const existing = await Identity.findOne({ provider, subject: profile.subject });
  if (existing) {
    const user = await signInExisting(existing, profile);
    if (user) return { user, created: false };
    // The account was deleted but the identity remained: start fresh.
    await existing.deleteOne();
  }

  const verifiedEmail = profile.emailVerified ? profile.email : undefined;
  if (verifiedEmail) {
    const taken = await Identity.findOne({ email: verifiedEmail, emailVerified: true })
      || await User.findOne({ email: verifiedEmail });
    if (taken) {
      throw new AuthFlowError('account_exists', { provider: taken.provider });
    }
  }

  const user = await User.create({
    name: profile.name,
    email: verifiedEmail,
    avatarUrl: profile.picture,
    lastLoginAt: new Date()
  });
  try {
    await Identity.create({
      provider,
      subject: profile.subject,
      userId: user._id,
      email: profile.email,
      emailVerified: profile.emailVerified
    });
  } catch (err) {
    // Two simultaneous first sign-ins: the other one won. Use its account.
    await user.deleteOne();
    if (!isDuplicateKey(err)) throw err;
    const winner = await Identity.findOne({ provider, subject: profile.subject });
    return { user: await signInExisting(winner, profile), created: false };
  }
  return { user, created: true };
}

// Adds a provider to the signed-in user's account (Settings -> Connect).
export async function linkIdentity(userId, provider, profile) {
  const existing = await Identity.findOne({ provider, subject: profile.subject });
  if (existing) {
    if (existing.userId.equals(userId)) return; // already linked
    throw new AuthFlowError('identity_in_use');
  }
  if (await Identity.exists({ userId, provider })) {
    throw new AuthFlowError('provider_already_linked');
  }
  try {
    await Identity.create({
      provider,
      subject: profile.subject,
      userId,
      email: profile.email,
      emailVerified: profile.emailVerified
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new AuthFlowError('identity_in_use');
    throw err;
  }
}
