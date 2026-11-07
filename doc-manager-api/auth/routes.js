import express from 'express';
import * as oidc from 'openid-client';
import { clientInfo } from '../activity/clientInfo.js';
import { recordActivity } from '../activity/log.js';
import AuthTransaction from '../models/AuthTransaction.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { AuthFlowError, linkIdentity, resolveSignIn } from './accounts.js';
import { clearSessionCookie, createSession, hashToken, randomToken } from './sessions.js';

// ==================================================================
// AUTH ROUTES (plain HTTP, not GraphQL)
// OAuth needs real browser redirects, which GraphQL cannot do.
//
//   GET  /auth/providers               -> which buttons to show
//   GET  /auth/:provider/start         -> redirect to Google / Apple
//   GET  /auth/google/callback         -> Google sends the user back
//   POST /auth/apple/callback          -> Apple posts the answer back
//   GET  /auth/apple/finish            -> second half of Apple's callback
//   POST /auth/signout                 -> end this session
//   POST /auth/signout-all             -> end every session of this user
// ==================================================================

const TX_COOKIE = 'dm_oauth';
const TX_MS = 10 * 60 * 1000; // a sign-in attempt must finish within 10 minutes

// Only same-site paths like "/settings" are allowed as a destination
// after sign-in ("//evil.com" or "https://..." would be an open redirect).
export function safeReturnTo(value, fallback = '/') {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
        return fallback;
    }
    return value.slice(0, 500);
}

export function createAuthRouter({ config, providers, reportException }) {
    const router = express.Router();
    const redirectUri = (provider) => `${config.appOrigin}/auth/${provider.id}/callback`;

    // Activity log entry for a sign-in event (see activity/log.js).
    const log = (req, userId, action, provider, extra = {}) => recordActivity({
        userId,
        client: clientInfo(req),
        action,
        status: extra.error ? 'FAILURE' : 'SUCCESS',
        entry: { target: provider && { type: 'account', id: provider.id, name: provider.label }, ...extra }
    });

    // Apple's answer arrives as a cross-site POST. Browsers only send a
    // cookie with such a request if it is SameSite=None (which needs Secure).
    const txCookieOptions = (provider) => ({
        httpOnly: true,
        secure: provider.responseMode === 'form_post' ? true : config.secureCookies,
        sameSite: provider.responseMode === 'form_post' ? 'none' : 'lax',
        path: '/auth',
        maxAge: TX_MS
    });

    // Errors go back to the sign-in page as ?error=<code>; the page turns
    // the code into a friendly message. No details are leaked.
    const failTo = (res, path, code, extra = {}) => {
        const url = new URL(path, config.appOrigin);
        url.searchParams.set('error', code);
        for (const [key, value] of Object.entries(extra)) {
            if (value) url.searchParams.set(key, value);
        }
        res.redirect(303, url.pathname + url.search);
    };

    router.get('/providers', (_req, res) => {
        res.json({ providers: Object.values(providers).map(({ id, label }) => ({ id, label })) });
    });

    // ----------------------------------------------------------------
    // START: create the transaction, then send the browser to the provider.
    // ----------------------------------------------------------------
    router.get('/:provider/start', async (req, res, next) => {
        try {
            const provider = providers[req.params.provider];
            const intent = req.query.intent === 'link' ? 'link' : 'signin';
            const errorPage = intent === 'link' ? '/settings' : '/signin';
            if (!provider) return failTo(res, errorPage, 'provider_unavailable');
            if (intent === 'link' && !req.user) return failTo(res, '/signin', 'signin_required');

            const state = oidc.randomState();
            const nonce = oidc.randomNonce();
            const codeVerifier = provider.usesPkce ? oidc.randomPKCECodeVerifier() : undefined;
            const txToken = randomToken();

            await AuthTransaction.create({
                txHash: hashToken(txToken),
                provider: provider.id,
                state,
                nonce,
                codeVerifier,
                intent,
                linkUserId: intent === 'link' ? req.user._id : undefined,
                returnTo: safeReturnTo(req.query.returnTo, intent === 'link' ? '/settings' : '/'),
                expiresAt: new Date(Date.now() + TX_MS)
            });

            let url;
            try {
                url = await provider.authorizationUrl({
                    redirectUri: redirectUri(provider),
                    state,
                    nonce,
                    codeChallenge: codeVerifier && await oidc.calculatePKCECodeChallenge(codeVerifier)
                });
            } catch (err) {
                console.error(`[auth] ${provider.id} discovery failed:`, err.code || err.name);
                reportException({ source: 'Sign-in', action: `Contacting ${provider.label} to start sign-in`, error: err, req });
                return failTo(res, errorPage, 'provider_error');
            }

            res.cookie(TX_COOKIE, txToken, txCookieOptions(provider));
            res.redirect(303, url);
        } catch (err) {
            next(err);
        }
    });

    // Finds AND deletes the transaction (single use).
    const takeTransaction = async (req, provider) => {
        const txToken = req.cookies?.[TX_COOKIE];
        if (!txToken) return null;
        const tx = await AuthTransaction.findOneAndDelete({ txHash: hashToken(txToken), provider: provider.id });
        if (!tx || tx.expiresAt < new Date()) return null;
        return tx;
    };

    // ----------------------------------------------------------------
    // FINISH (shared by Google and Apple): verify, then sign in or link.
    // ----------------------------------------------------------------
    const finish = async (req, res, provider, tx, params) => {
        const { maxAge, ...clearOptions } = txCookieOptions(provider);
        res.clearCookie(TX_COOKIE, clearOptions);
        const errorPage = tx?.intent === 'link' ? '/settings' : '/signin';

        if (!tx) return failTo(res, '/signin', 'session_expired');
        if (params.get('error')) {
            const cancelled = ['access_denied', 'user_cancelled_authorize'].includes(params.get('error'));
            return failTo(res, errorPage, cancelled ? 'cancelled' : 'provider_error');
        }
        if (params.get('state') !== tx.state) return failTo(res, errorPage, 'state_mismatch');

        let profile;
        try {
            profile = await provider.exchange({
                redirectUri: redirectUri(provider),
                params,
                state: tx.state,
                nonce: tx.nonce,
                codeVerifier: tx.codeVerifier
            });
        } catch (err) {
            // Log the error type only: never tokens, codes or profile data.
            console.error(`[auth] ${provider.id} code exchange failed:`, err.code || err.name);
            reportException({ source: 'Sign-in', action: `Finishing ${provider.label} sign-in (code exchange)`, error: err, req });
            return failTo(res, errorPage, 'provider_error');
        }
        if (!profile?.subject) return failTo(res, errorPage, 'provider_error');

        try {
            if (tx.intent === 'link') {
                // The transaction was created by this signed-in user and is bound
                // to this browser by the dm_oauth cookie.
                const user = await User.findById(tx.linkUserId);
                if (!user) return failTo(res, '/signin', 'signin_required');
                await linkIdentity(user._id, provider.id, profile);
                await log(req, user._id, 'ACCOUNT_LINKED', provider, { note: profile.email });
                return res.redirect(303, `${tx.returnTo}${tx.returnTo.includes('?') ? '&' : '?'}linked=${provider.id}`);
            }

            const { user, created } = await resolveSignIn(provider.id, profile);
            // Replace any previous session in this browser with a new one.
            if (req.session) await Session.deleteOne({ _id: req.session._id });
            await createSession(req, res, user._id, config);
            await log(req, user._id, created ? 'SIGNED_UP' : 'SIGNED_IN', provider);
            res.redirect(303, tx.returnTo);
        } catch (err) {
            if (err instanceof AuthFlowError) {
                // A failed "Connect" belongs in that user's activity log. (A
                // failed sign-in has no known user, so it cannot be logged.)
                if (tx.intent === 'link') {
                    await log(req, tx.linkUserId, 'ACCOUNT_LINKED', provider, { error: 'That account is already connected to another account or provider.' });
                }
                return failTo(res, errorPage, err.code, { provider: err.details.provider });
            }
            throw err;
        }
    };

    // Google: a normal top-level GET redirect back to us.
    router.get('/google/callback', async (req, res, next) => {
        try {
            const provider = providers.google;
            if (!provider) return failTo(res, '/signin', 'provider_unavailable');
            const tx = await takeTransaction(req, provider);
            await finish(req, res, provider, tx, new URLSearchParams(req.query));
        } catch (err) {
            next(err);
        }
    });

    // Apple: a cross-site form POST. Cookies with SameSite=Lax (like the
    // session cookie) are not sent with it and may not be set by it, so
    // the answer is parked in the transaction and the browser is sent to
    // /auth/apple/finish by a same-site page, where cookies work normally.
    router.post('/apple/callback', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res, next) => {
        try {
            const provider = providers.apple;
            if (!provider) return failTo(res, '/signin', 'provider_unavailable');
            const txToken = req.cookies?.[TX_COOKIE];
            const params = {};
            for (const key of ['code', 'state', 'error', 'user']) {
                if (typeof req.body?.[key] === 'string') params[key] = req.body[key];
            }
            if (txToken) {
                await AuthTransaction.updateOne(
                    { txHash: hashToken(txToken), provider: provider.id, callbackParams: { $exists: false } },
                    { $set: { callbackParams: params } }
                );
            }
            res.set('Cache-Control', 'no-store');
            res.type('html').send(
                '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
                + '<meta http-equiv="refresh" content="0;url=/auth/apple/finish"><title>Signing in…</title>'
                + '<p>Signing in… <a href="/auth/apple/finish">Continue</a></p>'
            );
        } catch (err) {
            next(err);
        }
    });

    router.get('/apple/finish', async (req, res, next) => {
        try {
            const provider = providers.apple;
            if (!provider) return failTo(res, '/signin', 'provider_unavailable');
            const tx = await takeTransaction(req, provider);
            const params = new URLSearchParams(tx?.callbackParams ? Object.fromEntries(tx.callbackParams) : {});
            await finish(req, res, provider, tx?.callbackParams ? tx : null, params);
        } catch (err) {
            next(err);
        }
    });

    // ----------------------------------------------------------------
    // SIGN OUT
    // ----------------------------------------------------------------
    router.post('/signout', async (req, res, next) => {
        try {
            if (req.session) await Session.deleteOne({ _id: req.session._id });
            clearSessionCookie(res, config);
            await log(req, req.user?._id, 'SIGNED_OUT');
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    router.post('/signout-all', async (req, res, next) => {
        try {
            if (req.user) await Session.deleteMany({ userId: req.user._id });
            clearSessionCookie(res, config);
            await log(req, req.user?._id, 'SIGNED_OUT_EVERYWHERE');
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    return router;
};