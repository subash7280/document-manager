import mongoose from 'mongoose';
import { config } from '../config.js';
import Document from '../models/Document.js';
import User from '../models/User.js';

// ==================================================================
// ONE-TIME MIGRATION: give documents uploaded before sign-in existed
// (they have no owner, so nobody can see them) to one account.
//
//   1. Sign in to the app once with that account.
//   2. npm run assign-legacy -- --email you@example.com          (preview)
//   3. npm run assign-legacy -- --email you@example.com --apply  (do it)
//
// The documents stay PRIVATE; nothing becomes public.
// ==================================================================
const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const apply = args.includes('--apply');

if (!args.includes('--email') || !email) {
  console.error('Usage: npm run assign-legacy -- --email you@example.com [--apply]');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
try {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No account with the email ${email}. Sign in to the app with it first.`);
    process.exitCode = 1;
  } else {
    const filter = { ownerId: { $exists: false } };
    const count = await Document.countDocuments(filter);
    if (!apply) {
      console.log(`${count} document(s) without an owner would be given to ${email}. Add --apply to do it.`);
    } else {
      const result = await Document.updateMany(filter, { $set: { ownerId: user._id, visibility: 'private' } });
      console.log(`Assigned ${result.modifiedCount} document(s) to ${email}. They are private.`);
    }
  }
} finally {
  await mongoose.disconnect();
}
