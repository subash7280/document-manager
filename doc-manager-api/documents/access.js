import crypto from 'node:crypto';
import { GraphQLError } from 'graphql';
import Document from '../models/Document.js';

// ==================================================================
// ACCESS RULES - the ONE place that decides who may touch a document.
// Every GraphQL resolver and every file route goes through these
// helpers, so the rules cannot drift apart.
//
//   Owner          -> full access (view, download, rename, share, delete)
//   Anyone else    -> nothing; a document they cannot access looks
//                     exactly like a document that does not exist
//   Public link    -> view/download of THAT document only, and only
//                     while its owner keeps it public
//   Admin          -> (users.isAdmin = true) view/download of EVERY
//                     document, through the admin routes only; admins
//                     cannot change other users' documents
// ==================================================================

// Throws the standard GraphQL "please sign in" error.
export function requireUser(context) {
  if (!context.user) {
    throw new GraphQLError('You must be signed in.', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  return context.user;
}

// Signed in AND users.isAdmin is true; anyone else gets FORBIDDEN.
export function requireAdmin(context) {
  const user = requireUser(context);
  if (!user.isAdmin) {
    throw new GraphQLError('Only administrators can do this.', { extensions: { code: 'FORBIDDEN' } });
  }
  return user;
}

// MongoDB filter: "documents this user may manage". To add sharing with
// specific people later, this is the function to extend.
export const accessibleBy = (user) => ({ ownerId: user._id });

// { data: 0 } = never load the (legacy, inline) file bytes by accident.
export const findOwnedDocument = (user, uuid) =>
  Document.findOne({ uuid: String(uuid), ...accessibleBy(user) }, { data: 0 });

// Any user's document, for admins. Callers MUST check isAdmin first.
export const findDocumentForAdmin = (uuid) =>
  Document.findOne({ uuid: String(uuid) }, { data: 0 });

// ------------------------------------------------------------------
// PUBLIC SHARE TOKENS
// 32 random bytes = 256 bits, written as 43 URL-safe characters.
// Unguessable, unrelated to the document id, and replaced (never
// reused) every time a document is published again.
// ------------------------------------------------------------------
export const newShareToken = () => crypto.randomBytes(32).toString('base64url');
export const isShareToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

export const findPublicDocument = (token) => {
  if (!isShareToken(token)) return null;
  return Document.findOne({ shareToken: token, visibility: 'public' }, { data: 0 });
};
