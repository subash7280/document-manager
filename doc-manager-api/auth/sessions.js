import crypto from 'node:crypto';
import Session from '../models/Session.js';
import User from '../models/User.js';

// ==================================================================
// SESSIONS
// After a successful sign-in the browser gets a random token in the
// httpOnly cookie "dm_session". JavaScript in the page cannot read it
// (httpOnly), and the browser only sends it to this site (SameSite=Lax).
// Every request looks the token up here and sets req.user.
// ==================================================================

export const SESSION_COOKIE = 'dm_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sessionCookieOptions = (config) => ({
  httpOnly: true,
  secure: config.secureCookies,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MS
});

// Creates a brand-new session (a new token on EVERY sign-in, so a token
// planted before sign-in can never become a signed-in session).
export async function createSession(req, res, userId, config) {
  const token = randomToken();
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_MS),
    userAgent: req.get('user-agent')?.slice(0, 200)
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config));
}

export function clearSessionCookie(res, config) {
  const { maxAge, ...options } = sessionCookieOptions(config);
  res.clearCookie(SESSION_COOKIE, options);
}

// ------------------------------------------------------------------
// MIDDLEWARE: cookie -> req.user (or nothing when signed out).
// Sessions are "rolling": an active user's session is extended once it
// is past half its lifetime.
// ------------------------------------------------------------------
export function sessionMiddleware(config) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) return next();

      const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
      const user = session && await User.findById(session.userId);
      if (!session || !user) {
        clearSessionCookie(res, config);
        return next();
      }

      if (session.expiresAt.getTime() - Date.now() < SESSION_MS / 2) {
        session.expiresAt = new Date(Date.now() + SESSION_MS);
        await session.save();
        res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config));
      }

      req.user = user;
      req.session = session;
      next();
    } catch (err) {
      next(err);
    }
  };
}
