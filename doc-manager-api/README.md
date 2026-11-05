# Doc Manager - Backend (Express + GraphQL)

Private, multi-user document storage: Google / Apple sign-in, per-user documents in folders,
consent-based public links, safe file serving, an activity log of every action, exception emails
and a public health check.

## Setup
1. Copy `.env.example` to `.env` and fill in `MONGO_URI` (and the sign-in providers, below).
2. Install dependencies: `npm install`
3. Create the settings document (app name + who gets exception emails): `npm run seed-config`
4. Run in dev: `npm run dev` (requires nodemon) or `npm start`
5. Start the UI too (`doc-manager/`, `npm run dev`) and open **http://localhost:5173**.
   Always use the UI's address: the UI forwards `/graphql`, `/auth` and `/api` to this server.

| Script | What it does |
|---|---|
| `npm start` / `npm run dev` | Start the API |
| `npm test` | Automated tests (in-memory MongoDB, no setup needed) |
| `npm run assign-legacy -- --email you@example.com [--apply]` | Give old, owner-less documents to an account |
| `npm run seed-config` | Create the `application_configs` document if it does not exist yet |

## Environment variables
See [.env.example](.env.example) for every setting with comments.

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | yes | MongoDB connection string |
| `APP_ORIGIN` | yes in production | Browser address of the app (default `http://localhost:5173`). OAuth redirect URIs and share links are built from it. Use `https://` in production (enables Secure cookies) |
| `PORT` | no | Default 5000 |
| `NODE_ENV` | no | `production` disables GraphiQL |
| `CLIENT_DIST` | production | Path to `doc-manager/dist`; this server then serves the UI too |
| `TRUST_PROXY` | behind a proxy | Number of proxies (correct client IPs for rate limiting) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google | |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | for Apple | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for exception emails | Email is off when `SMTP_HOST` is empty |
| `KEEP_ALIVE_ENABLED`, `KEEP_ALIVE_INTERVAL_MINUTES`, `KEEP_ALIVE_URL` | no | Scheduled health check; default every 480 minutes (8 hours) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | not yet | Cloudflare R2 placeholders for future extended storage. Not read by any code yet; files are still stored in GridFS |

A provider whose variables are missing is shown as "not configured" on the sign-in page.

## Sign-in provider setup

### Google
1. Google Cloud Console → APIs & Services → **OAuth consent screen**: set it up (scopes: `openid`, `email`, `profile`).
2. **Credentials** → Create credentials → **OAuth client ID** → *Web application*.
3. Authorized redirect URI: `<APP_ORIGIN>/auth/google/callback`
   (development: `http://localhost:5173/auth/google/callback`).
4. Put the client ID and secret into `.env`.

### Apple
Requires a paid Apple Developer Program membership and a **public https domain**:
Apple does not accept `localhost` or `http` return URLs, so test Apple on a deployed or tunnelled https address.
1. Certificates, Identifiers & Profiles → **Identifiers** → an App ID with *Sign in with Apple* enabled.
2. Create a **Services ID** (this is `APPLE_CLIENT_ID`), enable *Sign in with Apple*, add your domain and
   the return URL `<APP_ORIGIN>/auth/apple/callback`.
3. **Keys** → create a key with *Sign in with Apple* → download the `.p8` file (`APPLE_KEY_ID` is the key's id).
4. `APPLE_TEAM_ID` is shown at the top right of the developer portal.
5. `APPLE_PRIVATE_KEY` = the `.p8` file contents (use `\n` for line breaks on one line).

Apple only shares the user's name on the **first** sign-in, and users may hide their email
(a private relay address is used instead).

### How accounts are matched
- The provider's permanent user id (`sub`) decides the account. Signing in again → same account, never a duplicate.
- A **new** provider whose verified email already belongs to an account is **refused**, not merged:
  the person signs in the original way and connects the new provider in **Settings → Sign-in methods**
  (which proves they own both).

## Administrators
A user with `isAdmin: true` in the `users` collection gets an **Admin** page: every user (name, email,
number of documents, storage used, last sign-in) and each user's documents, which they can open and download.
- Set it only in the database, e.g. in MongoDB Compass: `{ "isAdmin": true }` on the user's document.
  No API can change it. It takes effect on the user's next request (reload the page).
- Read-only: admins cannot rename, move, share or delete other users' documents, and never see share links.
- Admin file access uses its own route (`/api/admin/documents/:uuid/content`); the owner-only route is unchanged.
- Admin downloads are recorded in the **admin's** activity log, with the owner's name in the note.

## Folders
Drive-style folders, nested up to 20 levels (`models/Folder.js`). Each folder stores its whole chain of
parent folders (`ancestors`), so breadcrumbs and "everything inside this folder" are single queries.
- Names are unique inside the same parent, ignoring case ("Proofs" = "proofs").
- Deleting a folder deletes its subfolders and every document in them (file bytes included; public links stop working).
- A folder cannot be moved into itself or into one of its own subfolders.
- In lists, a folder argument means: a folder id = inside it, `"root"` = the top level, `null` = everywhere.
- Existing documents have no folder, so they appear at the top level ("My documents").

## Activity log
Every action is saved in the `activity_logs` collection, whether it succeeded or failed: sign-in / sign-up /
sign-out, connecting or disconnecting a sign-in method, profile changes, upload, rename, move, delete, download,
share publicly / make private / reset link, and folder create / rename / move / delete.

Each entry stores:
- the target's name at that moment,
- old and new values (renames and moves),
- the error the user saw (failures),
- where it came from: IP address, browser and version, operating system and version, device type, vendor and
  model (`activity/clientInfo.js`).

Browser and device details come from the User-Agent plus Chrome's client hints, which give the real Windows 11
or Android version and the phone model. Users only ever see their own log (the `activityLogs` query).
Failed sign-ins by unknown people cannot be logged, because there is no account to file them under.

## Application config and exception emails
The `application_configs` collection holds one document:
```json
{ "app_name": "Document Manager", "exception_mail": ["subash.e@spantechnologyservices.com"] }
```
`npm run seed-config` creates it. To change the recipients, edit it in MongoDB Compass. It is re-read every
minute, so no restart is needed.

When something fails **unexpectedly**, an email goes to every `exception_mail` address. It contains what
happened, the error and stack trace, the signed-in user, the request, and the browser / system / device / IP.
Covered:
- GraphQL queries and mutations (a Yoga plugin in `app.js`), REST routes and the Express error handler
- sign-in provider failures, file read failures, and crashes (`unhandledRejection`, `uncaughtException`)
- the scheduled health check finding a problem
- errors in the browser (`POST /api/client-errors`, sent by the React app's catch blocks, error boundary and
  global error handlers)

Not emailed, on purpose: mistakes users can fix themselves ("File is too large", "A folder with this name
already exists"). Those show up in the activity log as failures.

Two safety limits:
- The same error is emailed at most once every 10 minutes.
- No more than 30 exception emails go out per hour.

Email needs the `SMTP_*` settings, for example:
- Microsoft 365: `smtp.office365.com`, port 587
- Gmail: `smtp.gmail.com`, port 587, with an App password

## Health check and the scheduled job
`GET /app/health-check` (public, no sign-in) answers with JSON:
- overall `status`
- app name, version, uptime and memory
- database up/down and ping time
- whether `application_configs` exists and whether email is configured
- the sign-in providers
- the scheduled job's last result

It answers HTTP 200 when healthy and 503 when the database is down. It shows no secrets (no connection strings,
no email addresses). You can use it as Render's **Health Check Path**.

`services/jobs/index.js` calls that address on a timer: by default every 8 hours (00:00, 08:00 and 16:00 UTC),
at `RENDER_EXTERNAL_URL` (set by Render) or `KEEP_ALIVE_URL`. If the answer isn't healthy, or the API can't
be reached, everyone on the exception email list is notified.

> **Render free plan:** a free web service sleeps after **15 minutes** without traffic. A call every 8 hours
> checks health but cannot keep it awake, and while it sleeps the timer does not run either. To keep it awake,
> set `KEEP_ALIVE_INTERVAL_MINUTES=14`, or point an outside monitor (UptimeRobot, cron-job.org) at
> `/app/health-check` every 10 to 14 minutes.

## Deployment (one origin)
The session cookie must be a first-party cookie, so the UI and the API must be served from the **same origin**:

- **Option A (simplest):** build the UI (`npm run build` in `doc-manager/`) and set `CLIENT_DIST=../doc-manager/dist`.
  This server then serves the app, the API and the share-link previews.
- **Option B (Netlify or another static host):** proxy `/graphql`, `/auth/*` and `/api/*` to this server, e.g. Netlify `_redirects`:
  ```
  /graphql   https://api.example.com/graphql   200
  /auth/*    https://api.example.com/auth/:splat   200
  /api/*     https://api.example.com/api/:splat    200
  /app/*     https://api.example.com/app/:splat    200
  /*         /index.html   200
  ```
  Set `APP_ORIGIN` to the Netlify address and `TRUST_PROXY=1`. (Share previews in chat apps need Option A.)

Use https in production. Rate limits are kept in memory, so with several API instances, use a shared store.

## Project layout
- `index.js` → connects to MongoDB, starts the server
- `app.js` → security headers, CSRF origin check, rate limits, sessions, routes, GraphQL Yoga, the built UI
- `config.js` → environment variables
- `auth/` → OpenID Connect providers (`openid-client`), sessions, account matching, `/auth/*` routes
- `documents/access.js` → the one place that decides who may access a document
- `documents/fileTypes.js` → upload allowlist, content sniffing, safe serving rules
- `documents/routes.js` → file contents: `/api/documents/:uuid/content`, `/api/shared/:token/content`
- `folders/access.js` → the folder rules (which folder an id means, names, nesting)
- `activity/` → `clientInfo.js` (browser / system / device), `log.js` (writing the activity log, `tracked()`)
- `services/` → `appConfig.js`, `mailer.js`, `exceptions.js` (exception emails), `clientErrors.js`, `health.js`, `jobs/index.js` (scheduled health check)
- `graphql/typeDefs.js`, `graphql/resolvers.js` → the GraphQL API
- `models/` → `Document`, `Folder`, `ActivityLog`, `AppConfig`, `User`, `Identity`, `Session`, `AuthTransaction`
- `storage/fileStorage.js` → file bytes in MongoDB GridFS
- `scripts/assign-legacy-documents.js` → one-time migration; `scripts/seed-app-config.js` → creates `application_configs`
- `test/` → `node --test` suites

## API
GraphQL at `POST /graphql` (GraphiQL in development: sign in, then open `<APP_ORIGIN>/graphql`).

| Operation | Who |
|---|---|
| `query me` | anyone (null when signed out) |
| `query documents(folderId, page, limit, search, kind, visibility, sort)` | signed in, own documents only |
| `query document(uuid)` | owner |
| `query publicDocument(token)` | anyone, while the document is public |
| `query folder(id)` / `folders(parentId, search)` | owner |
| `query activityLogs(page, limit, search, category, action, status, deviceType, browser, os, from, to)` / `activityFilterOptions` | signed in, own log only |
| `mutation uploadDocument(file: File!, uploadId: ID!, folderId: ID)` | signed in (multipart request, max 20 MB, always private) |
| `mutation renameDocument / moveDocument / deleteDocument / setDocumentVisibility / resetShareLink` | owner |
| `mutation createFolder / renameFolder / moveFolder / deleteFolder` | owner |
| `mutation updateProfile / unlinkAccount` | signed in |
| `query adminUsers(page, limit, search)` / `adminUser(id)` / `adminDocuments(userId, page, limit, search, kind, visibility, sort)` | administrators only (`FORBIDDEN` otherwise) |

HTTP routes: `/auth/providers`, `/auth/:provider/start`, `/auth/google/callback`, `/auth/apple/callback`,
`/auth/signout`, `/auth/signout-all`, `/api/documents/:uuid/content`, `/api/shared/:token/content`,
`/api/admin/documents/:uuid/content` (administrators only) (`?download=1` to download),
`POST /api/client-errors` (browser error reports), `GET /app/health-check`.

## Security summary
- Server-side OAuth 2.0 / OIDC authorization code flow (PKCE for Google, state + nonce for both); ID tokens are verified by `openid-client`.
- Sessions: random 256-bit token in an httpOnly, SameSite=Lax (Secure on https) cookie; only its SHA-256 hash is stored; new token on every sign-in; sign out / sign out everywhere delete them on the server.
- Every document query and file route filters by owner; other users' documents look like "not found".
  The only exception is administrators (`users.isAdmin`, database-only), who get read-only access through separate `admin*` queries and route.
- Public links use a separate random 256-bit token (`/s/<token>`); making a document private deletes it; publishing again creates a new one.
- Uploads: extension allowlist + magic-byte check, server decides the content type, names are cleaned, 20 MB limit, idempotent `uploadId`.
- File responses: `no-store`, `nosniff`, `CSP: sandbox`, forced download for anything that is not an image, PDF or plain text.
- CSRF: Origin check on every state-changing request + SameSite cookies. Rate limits on `/auth`, `/api/shared` and `/graphql`. Helmet headers, strict CSP for pages, GraphiQL off in production, internal errors never sent to clients.

## Existing data (migration)
Documents uploaded before this version have no owner, so **nobody can see them** (safe default).
After signing in once, give them to your account:
```
npm run assign-legacy -- --email you@example.com          # shows how many
npm run assign-legacy -- --email you@example.com --apply  # assigns them (they stay private)
```
New indexes are created automatically when the API starts.
