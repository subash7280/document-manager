import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GraphQLError, getOperationAST } from 'graphql';
import { createYoga, createSchema } from 'graphql-yoga';
import { typeDefs } from './graphql/typeDefs.js';
import { resolvers } from './graphql/resolvers.js';
import { CLIENT_HINTS, clientInfo } from './activity/clientInfo.js';
import { createAuthRouter } from './auth/routes.js';
import { sessionMiddleware } from './auth/sessions.js';
import { createDocumentRouter } from './documents/routes.js';
import { findPublicDocument } from './documents/access.js';
import { MAX_FILE_SIZE } from './documents/fileTypes.js';
import { createClientErrorRouter } from './services/clientErrors.js';
import { createExceptionReporter } from './services/exceptions.js';
import { checkHealth } from './services/health.js';

// ==================================================================
// THE EXPRESS APP
// createApp() builds the whole server WITHOUT starting it, so tests can
// create one with a test database and fake sign-in providers.
// Requests flow through these layers, top to bottom:
//   security headers -> cookies -> cross-site check -> session (req.user)
//   -> /app/health-check | /auth (sign-in) | /api (files, browser errors)
//      | /graphql | the UI
// Anything that fails unexpectedly on the way is emailed to the
// application_configs.exception_mail list (services/exceptions.js).
// ==================================================================

// Origin check (CSRF protection): a request that CHANGES something must
// come from our own pages. Browsers always send the Origin header on
// such requests, and other sites cannot fake it.
function rejectCrossSiteWrites(config) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, res, next) => {
    // Apple's sign-in answer is cross-site by design; it is protected by
    // the one-time state + transaction cookie instead (auth/routes.js).
    if (safeMethods.has(req.method) || req.path === '/auth/apple/callback') return next();
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    const crossSite = origin ? origin !== config.appOrigin : site && !['same-origin', 'none'].includes(site);
    if (crossSite) {
      return res.status(403).json({ errors: [{ message: 'Cross-site request blocked.' }] });
    }
    next();
  };
}

// ------------------------------------------------------------------
// GRAPHQL PLUGIN: EMAIL UNEXPECTED ERRORS
// A Yoga plugin can hook into each step of a request. onExecuteDone
// runs after the resolvers, with the final { data, errors } result.
// An error whose originalError is a GraphQLError was thrown on purpose
// ("File is too large"): the user sees it, nobody is emailed. Anything
// else is a bug or an outage: it is reported (services/exceptions.js).
// ------------------------------------------------------------------
const describeFiles = (_key, value) =>
(value && typeof value === 'object' && typeof value.arrayBuffer === 'function'
  ? `[file "${value.name}", ${value.size} bytes]`
  : value);

const reportUnexpectedErrors = (reportException) => ({
  onExecute() {
    return {
      onExecuteDone({ args, result }) {
        if (!Array.isArray(result?.errors)) return;
        const operation = getOperationAST(args.document, args.operationName);
        for (const error of result.errors) {
          const original = error.originalError;
          if (!original || original instanceof GraphQLError) continue;
          reportException({
            source: 'GraphQL API',
            action: `${operation?.operation ?? 'operation'} ${operation?.name?.value ?? '(unnamed)'} -> ${error.path?.join('.') ?? 'request'}`,
            error: original,
            req: args.contextValue.req,
            details: { Variables: JSON.stringify(args.variableValues ?? {}, describeFiles)?.slice(0, 2000) }
          });
        }
      }
    };
  }
});

const limiter = (perMinute, message) => rateLimit({
  windowMs: 60 * 1000,
  limit: perMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { errors: [{ message }] }
});

// ------------------------------------------------------------------
// THE UI (production): when CLIENT_DIST points at the built React app,
// this server also serves it, so the UI and API share one origin.
// ------------------------------------------------------------------
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Content Security Policy for the app's pages: only our own scripts may
// run. (Avatars come from Google's image server.)
const pageCsp = (config) => helmet.contentSecurityPolicy({
  directives: {
    // Only on https sites; on plain http it would break every request.
    upgradeInsecureRequests: config.secureCookies ? [] : null,
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
  }
});

function serveClient(app, config) {
  const dist = path.resolve(config.clientDist);
  const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

  // Hashed files under /assets never change, so they can be cached forever.
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));

  app.get('*', pageCsp(config), async (req, res, next) => {
    // Unknown API addresses stay a 404, not the app's HTML page.
    if (/^\/(api|app|auth|graphql)(\/|$)/.test(req.path)) return next();
    try {
      let html = indexHtml;
      res.set('Cache-Control', 'no-store');

      // Document pages are never indexed by search engines, and the
      // share token in the address is never sent to other sites.
      const shared = req.path.match(/^\/s\/([^/]+)$/);
      if (shared || req.path.startsWith('/d/')) {
        res.set('Referrer-Policy', 'no-referrer');
        // No app branding on document pages: neutral tab icon and title.
        html = html
          .replace('/favicon.svg', '/favicon-document.svg')
          .replace(/<title>[^<]*<\/title>/, '<title>Document</title>');
        let meta = '<meta name="robots" content="noindex, nofollow">';

        // SHARE PREVIEW: chat apps (WhatsApp, LinkedIn...) read these tags
        // to show a title and picture. Only for PUBLIC documents, and only
        // the file name and type - never anything about the owner.
        const doc = shared && await findPublicDocument(shared[1]);
        if (doc) {
          const title = escapeHtml(doc.filename || 'Shared document');
          meta += `<meta property="og:title" content="${title}"><meta property="og:type" content="website">`
            + `<meta property="og:description" content="${escapeHtml(doc.contentType || 'Document')}">`;
          if (doc.contentType?.startsWith('image/') && doc.contentType !== 'image/svg+xml') {
            const image = escapeHtml(`${config.appOrigin}/api/shared/${doc.shareToken}/content`);
            meta += `<meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image">`;
          }
          html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
        }
        html = html.replace('</head>', `${meta}</head>`);
      }
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });
}

// mailer: from services/mailer.js (null = email off); tests pass a fake.
export function createApp({ config, providers, mailer = null }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // One reporter for the whole app; index.js also uses it for crashes.
  const reportException = createExceptionReporter({ config, mailer });
  app.locals.reportException = reportException;

  // Standard security headers (HSTS, nosniff, frame protection...).
  // Content-Security-Policy is set per response type instead: pages get
  // pageCsp above, files get their own in documents/routes.js.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Ask Chrome/Edge for the exact Windows version and phone model on
  // later requests (see activity/clientInfo.js).
  app.use((_req, res, next) => {
    res.set('Accept-CH', CLIENT_HINTS.join(', '));
    next();
  });
  app.use(cookieParser());
  app.use(rejectCrossSiteWrites(config));
  app.use(sessionMiddleware(config));

  const limits = config.rateLimits ?? { auth: 30, shared: 120, graphql: 600, health: 60, clientErrors: 20 };

  // ----------------------------------------------------------------
  // HEALTH CHECK (public): GET /app/health-check -> JSON
  // ----------------------------------------------------------------
  app.get('/app/health-check', limiter(limits.health, 'Too many requests. Please wait a minute.'), async (_req, res, next) => {
    try {
      const { httpStatus, body } = await checkHealth({ config, providers, mailer });
      res.set('Cache-Control', 'no-store').status(httpStatus).json(body);
    } catch (err) {
      next(err);
    }
  });

  app.use('/auth', limiter(limits.auth, 'Too many sign-in attempts. Please wait a minute.'), createAuthRouter({ config, providers, reportException }));
  app.use('/api', createClientErrorRouter({ limiter: limiter(limits.clientErrors, 'Too many error reports.'), reportException }));
  app.use('/api', createDocumentRouter({ sharedLimiter: limiter(limits.shared, 'Too many requests. Please wait a minute.'), reportException }));

  // ================================================================
  // GRAPHQL SERVER
  //
  // REST had one URL per action (/api/upload, /api/documents, ...).
  // GraphQL has ONE URL for everything: /graphql
  // The request body says what the client wants, for example:
  //   query { documents(page: 1) { total documents { uuid filename } } }
  //
  // 1. createSchema joins the contract (typeDefs) with the code that
  //    fulfils it (resolvers) into one executable schema.
  // 2. createYoga turns that schema into a request handler that reads
  //    the GraphQL request, runs the matching resolvers, and replies
  //    with JSON: { "data": {...} } and/or { "errors": [...] }.
  // 3. context: builds the `context` argument of EVERY resolver. Here it
  //    carries the signed-in user found by sessionMiddleware above, and
  //    the browser/device info that the activity log records.
  // 4. plugins: extra behaviour around every request (here: emailing
  //    unexpected errors, see reportUnexpectedErrors above).
  // 5. app.use mounts that handler on Express at /graphql.
  //
  // TIP: in development, sign in to the app, then open
  // http://localhost:5173/graphql (the APP's address, so your session
  // cookie is sent) for GraphiQL, an interactive playground. It is
  // switched off in production.
  // ================================================================
  const yoga = createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: '/graphql',
    context: ({ req }) => ({
      user: req.user ?? null,
      config,
      req,
      client: clientInfo(req),
      // Per-request cache, so a page of 12 documents in the same folder
      // loads that folder once (see Document.folder in resolvers.js).
      folderCache: new Map(),
      // Same idea for the Admin page's per-user counts (resolvers.js).
      userStats: new Map()
    }),
    plugins: [reportUnexpectedErrors(reportException)],
    graphiql: !config.isProduction,
    // A 20 MB file plus the multipart wrapping around it.
    maxRequestBodySize: MAX_FILE_SIZE + 1024 * 1024,
    // Same-origin only (see README), so no CORS headers are sent.
    cors: false,
    logging: config.isProduction ? 'warn' : 'info',
  });

  app.use(
    yoga.graphqlEndpoint,
    limiter(limits.graphql, 'Too many requests. Please wait a minute.'),
    // JSON requests are small now (files use multipart), so 1 MB is plenty.
    express.json({ limit: '1mb' }),
    yoga
  );

  if (config.clientDist) serveClient(app, config);

  // ================================================================
  // ERRORS OUTSIDE GRAPHQL
  // Reply in the same { errors: [...] } shape that GraphQL uses, and
  // never send internal details (stack traces, database messages).
  // (Express recognises an error handler by its 4 arguments, so `_req`
  // and `_next` must stay even though they are unused.)
  // Real failures are emailed (services/exceptions.js).
  // ================================================================
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ errors: [{ message: 'Request is too large.' }] });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ errors: [{ message: 'Request body is not valid JSON.' }] });
    }
    reportException({
      source: req.path.startsWith('/auth') ? 'Sign-in' : 'REST API',
      action: `${req.method} ${req.route?.path ? req.baseUrl + req.route.path : req.path}`,
      error: err,
      req
    });
    if (res.headersSent) return res.destroy();
    res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  });

  return app;
}
