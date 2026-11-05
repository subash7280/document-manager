# Doc Manager - Frontend (Vite + React)

## Setup
1. Install dependencies: `npm install`
2. Start the API first (`doc-manager-api/`, port 5000).
3. Run dev: `npm run dev` → open **http://localhost:5173**
4. Tests: `npm test` · Build: `npm run build`

The dev server forwards `/graphql`, `/auth`, `/api` and `/app` to the API (see `vite.config.js`;
set `API_PROXY_TARGET` if the API runs elsewhere). The app and API therefore share one origin,
which the httpOnly session cookie needs. For production, see "Deployment" in the API README.

## Pages
| Route | Page |
|---|---|
| `/signin` | One page for sign-in and sign-up (Google, Apple) |
| `/` | My documents (top level): folders and files, like Google Drive. New folder / Upload, grid or list view |
| `/folders/:folderId` | Inside a folder: breadcrumb, subfolders, files; rename / move / delete the folder |
| `/shared` | Every publicly shared document, from any folder |
| `/activity` | Activity log: every action with browser, system and device; filters by type, result, device, browser, system and dates |
| `/upload` | Drag and drop upload with progress, "Save to" folder, and the "Share publicly" consent (`?folder=<id>` preselects a folder) |
| `/settings` | Profile, connected sign-in methods, theme, sign out (everywhere) |
| `/d/:uuid` | Standalone viewer for your own document (sign-in required) |
| `/s/:token` | Public standalone viewer, no sign-in, no app branding |

## Structure
- `src/graphql/` → `client.js` (fetch), `operations.js` (every query/mutation), `upload.js` (multipart upload with progress)
- `src/lib/` → `auth.jsx` (who is signed in, asked from the server), `theme.jsx`, `files.js` (upload rules), `share.js`, `documentActions.js`, `folderActions.js`, `errorReporting.js`
- `src/components/` → design-system components: `Button`, `Modal`, `ConfirmDialog`, `Menu`, `ShareDialog`, `ShareTargets`, `DriveItems` (folder cards, document cards and rows), `FolderDialog`, `MoveDialog`, `ErrorBoundary`, ...

## Error reporting
Catch blocks call `showError(err, 'What the user was doing')` (a toast) or `reportError(...)` from
`src/lib/errorReporting.js`. Browser-side errors are sent to `POST /api/client-errors`, and the API emails them
to the `exception_mail` list with the browser and device. Errors the server returned (`fromServer`), network
problems and cancelled uploads are not sent again. `ErrorBoundary` shows a "Something went wrong" page
instead of a blank screen, and window error handlers catch anything else.
- `src/pages/` → one file per route; `src/viewer/` → PDF (pdf.js) and text viewers
- `src/styles/tokens.css` → colors, radii, shadows, spacing for light and dark themes; `app.css` → component styles

## Design system
- Light and dark themes from the same tokens; Light / Dark / System toggle in the header and Settings (saved per device; `public/theme-init.js` applies it before the first paint).
- Buttons: `primary`, `secondary`, `outline`, `ghost`, `destructive`, `destructive-ghost` in `sm` / `md` / `lg`, with hover, focus, active, disabled and loading states.
- Every interactive element has a visible keyboard focus ring; dialogs trap focus and restore it; menus support arrow keys.
- Bootstrap 5.3 (from npm) provides the grid and utilities; icons come from `lucide-react`.

## Viewer formats
| Stored type | In the viewer | Print |
|---|---|---|
| PDF | pdf.js, page by page (works on Android/iOS too) | yes (pages rendered as images; layout may differ slightly from the original) |
| PNG, JPEG, GIF, WebP, SVG | image | yes |
| TXT, MD, CSV, JSON | plain text (never rendered as HTML) | yes |
| Word, Excel, PowerPoint, OpenDocument, RTF, ZIP | "no preview" card with Download | download and print from an app |
