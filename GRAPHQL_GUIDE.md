# Learn GraphQL with Doc Manager

This guide explains how this app uses GraphQL, step by step.
Read it from top to bottom. Each part is short.

---

## 1. What is GraphQL? (in 1 minute)

**REST** is like a shop with many counters.
Each counter gives you a fixed package:

```
GET    /api/documents       -> counter 1 (list)
GET    /api/document/123    -> counter 2 (one file)
POST   /api/upload          -> counter 3 (upload)
DELETE /api/document/123    -> counter 4 (delete)
```

**GraphQL** is like a shop with **one counter** and a **menu**.
You write down exactly what you want, and you get exactly that. Nothing more.

```
POST /graphql      <- every request goes here
```

You send a small "order" like this:

```graphql
query {
  documents {
    total
    documents { filename }
  }
}
```

And you get back the **same shape**, filled with data:

```json
{
  "data": {
    "documents": {
      "total": 2,
      "documents": [ { "filename": "cat.png" }, { "filename": "bill.pdf" } ]
    }
  }
}
```

That's the whole idea:

- **One address** (`/graphql`).
- **The client chooses** which fields it wants.
- **The answer has the same shape** as the question.

---

## 2. The big picture

```
 BROWSER (React)                                SERVER (Node + Express)
 ───────────────                                ───────────────────────
 operations.js   "what to ask"                  typeDefs.js  "the menu" (schema)
      │                                              │
 client.js       sends it with fetch()  ──POST──►  app.js       session cookie -> who is asking
      │          (the session cookie goes along)     │          then GraphQL Yoga at /graphql
 pages/...       use the answer                 resolvers.js "the cooks" (get the data,
                                                     │          only YOUR documents)
                                                 MongoDB
```

There are only **3 words** you must know:

| Word | Simple meaning | File |
|---|---|---|
| **Schema** | The menu. Lists what can be asked. | [typeDefs.js](doc-manager-api/graphql/typeDefs.js) |
| **Resolver** | The cook. A function that gets the data for one item on the menu. | [resolvers.js](doc-manager-api/graphql/resolvers.js) |
| **Operation** | The order. What the browser asks for. | [operations.js](doc-manager/src/graphql/operations.js) |

**Not everything is GraphQL.** Three jobs use plain HTTP routes, because GraphQL
answers in JSON and these need something else:

| Job | Route | Why not GraphQL? |
|---|---|---|
| Sign in with Google / Apple | `/auth/...` | Needs real browser redirects |
| Show / download file bytes | `/api/documents/:uuid/content`, `/api/shared/:token/content` | Raw bytes, not JSON |

GraphQL still controls them: it returns the URLs (`contentUrl`, `downloadUrl`).

---

## 3. The folders

```
Document Manager/
├── doc-manager-api/              ← BACKEND
│   ├── index.js                  ← connects MongoDB, starts the server
│   ├── app.js                    ← security layers, sessions, /auth, /api, /graphql
│   ├── config.js                 ← settings from .env
│   ├── graphql/
│   │   ├── typeDefs.js           ← the schema (menu)
│   │   └── resolvers.js          ← the resolvers (cooks)
│   ├── auth/                     ← Google / Apple sign-in and sessions
│   ├── documents/
│   │   ├── access.js             ← WHO may touch a document (one place)
│   │   ├── fileTypes.js          ← allowed file types + safe serving rules
│   │   └── routes.js             ← file bytes (view / download)
│   ├── folders/access.js         ← which folder an id means (one place)
│   ├── activity/                 ← activity log + browser/device detection
│   ├── services/                 ← app config, exception emails, health check,
│   │   └── jobs/index.js         ←   and the scheduled health check job
│   ├── storage/fileStorage.js    ← GridFS (file bytes in MongoDB)
│   ├── models/                   ← Document, Folder, ActivityLog, AppConfig, User, ...
│   └── test/                     ← automated tests (npm test)
│
└── doc-manager/                  ← FRONTEND
    └── src/
        ├── graphql/
        │   ├── client.js         ← sends any GraphQL request
        │   ├── operations.js     ← every query + mutation the app uses
        │   └── upload.js         ← file upload (GraphQL multipart request)
        ├── lib/                  ← auth state, theme, file rules, sharing
        ├── components/           ← Button, Modal, Menu, ShareDialog, ...
        ├── pages/                ← SignIn, Drive, Activity, Upload, Settings, Viewer
        └── viewer/               ← PDF (pdf.js) and text viewers
```

**Rule to remember:** keep all GraphQL code in a `graphql/` folder,
on **both** sides. Then you always know where to look.

---

## 4. Part A — How the API is set up (backend)

### Step 1. Install two packages

```bash
cd doc-manager-api
npm install graphql graphql-yoga
```

- `graphql` = the official GraphQL engine.
- `graphql-yoga` = a ready-made GraphQL server that works with Express.

### Step 2. Write the schema (the menu)

File: [doc-manager-api/graphql/typeDefs.js](doc-manager-api/graphql/typeDefs.js)

```graphql
type Document {          # what a "Document" looks like
  uuid: ID!              # "!" = never empty
  filename: String
  kind: FileKind!
  visibility: Visibility!
  shareUrl: String       # only set when the document is PUBLIC
}

type Query {             # things you can READ
  me: User
  documents(page: Int = 1, limit: Int = 10, search: String, kind: FileKind,
            visibility: Visibility, sort: DocumentSort = NEWEST): DocumentPage!
  document(uuid: ID!): Document
  publicDocument(token: String!): PublicDocument
}

type Mutation {          # things you can CHANGE
  uploadDocument(file: File!, uploadId: ID!): Document!
  renameDocument(uuid: ID!, filename: String!): Document
  setDocumentVisibility(uuid: ID!, visibility: Visibility!): Document
  deleteDocument(uuid: ID!): Boolean!
}
```

- `type Query` = **read** (like GET).
- `type Mutation` = **change** (like POST / PUT / DELETE).

### Step 3. Write the resolvers (the cooks)

File: [doc-manager-api/graphql/resolvers.js](doc-manager-api/graphql/resolvers.js)

The resolvers object has **the same shape as the schema**:

```js
export const resolvers = {
  Query: {
    document: (parent, args, context) => {
      const user = requireUser(context);                    // signed in?
      return Document.findOne({ uuid: args.uuid, ownerId: user._id });  // only MINE
    },
  },
  Mutation: {
    deleteDocument: async (parent, args, context) => {
      const user = requireUser(context);
      const doc = await Document.findOneAndDelete({ uuid: args.uuid, ownerId: user._id });
      return Boolean(doc);                                  // true / false
    },
  },
};
```

- `args` = what the client sent, for example `{ uuid: "abc" }`.
- `context` = who is asking (explained in section 8, idea 21).
- `parent` = the object "above" this field (explained in section 8).
- Whatever you `return` is sent back to the client.

### Step 4. Join them and open `/graphql`

File: [doc-manager-api/app.js](doc-manager-api/app.js)

```js
const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),          // menu + cooks
  graphqlEndpoint: '/graphql',
  context: ({ req }) => ({ user: req.user ?? null, config }),  // who is asking
});
app.use(yoga.graphqlEndpoint, yoga);                       // open the counter
```

### Step 5. Try it

Start the API (`npm run dev`) and the UI (`npm run dev` in doc-manager), sign in at
http://localhost:5173, then open **http://localhost:5173/graphql** in the same browser.
(Use the app's address, not port 5000: your session cookie belongs to the app's address,
and the API refuses changes coming from other addresses.)

This is **GraphiQL**, a playground. Type a query on the left and press ▶.
Press `Ctrl + Space` for autocomplete. Click **Docs** to read the whole schema.

> GraphiQL works because GraphQL can describe itself. This is called **introspection**.
> GraphiQL is switched **off in production**.

> 🔒 Document queries answer `You must be signed in.` until you are signed in.

---

## 5. Part B — How the UI sends a request (frontend)

### Step 1. Write the operation (what to ask)

File: [doc-manager/src/graphql/operations.js](doc-manager/src/graphql/operations.js)

```js
export const DELETE_DOCUMENT = `
  mutation DeleteDocument($uuid: ID!) {
    deleteDocument(uuid: $uuid)
  }
`;
```

- `$uuid` is a **variable**: a blank to fill in later.
- `ID!` says what type the blank is.

### Step 2. Send it

File: [doc-manager/src/graphql/client.js](doc-manager/src/graphql/client.js)

There is one small function, `graphqlRequest(query, variables)`. It does this:

```js
fetch('/graphql', {                        // same address as the page
  method: 'POST',
  credentials: 'same-origin',              // send the session cookie
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables })
});
```

### Step 3. Use it in a component

File: [doc-manager/src/lib/documentActions.js](doc-manager/src/lib/documentActions.js)

```js
const data = await graphqlRequest(DELETE_DOCUMENT, { uuid: '1234' });
if (data.deleteDocument) toast.success('Deleted');
```

### What really travels over the network

**Request** (browser → server):

```json
POST /graphql
{
  "query": "mutation DeleteDocument($uuid: ID!) { deleteDocument(uuid: $uuid) }",
  "variables": { "uuid": "1234" }
}
```

**Response** (server → browser):

```json
{ "data": { "deleteDocument": true } }
```

**When something goes wrong:**

```json
{
  "errors": [
    { "message": "File name cannot be empty.", "extensions": { "code": "BAD_USER_INPUT" } }
  ]
}
```

> ⚠️ GraphQL often sends HTTP **200 OK even when there is an error**.
> Always check the `errors` array. `client.js` does this for you.

> 💡 Open your browser's DevTools → **Network** tab → click a `graphql` request.
> You will see exactly the JSON above. This is the best way to learn.

---

## 6. Follow one click from start to end

### Example: the user clicks **Rename**

```
1. DrivePage.jsx      the menu's "Rename" opens RenameDialog (components/RenameDialog.jsx)
                      the user types a name and clicks Save

2. operations.js      RENAME_DOCUMENT
                      mutation RenameDocument($uuid: ID!, $filename: String!) {
                        renameDocument(uuid: $uuid, filename: $filename) {
                          ...DocumentFields
                        }
                      }

3. client.js          POST /graphql  { query, variables: { uuid, filename } }
                      + the session cookie

4. app.js             sessionMiddleware turns the cookie into req.user,
                      Yoga puts it into `context` and checks the request against
                      the schema. Wrong types? It stops here. Your code never runs.

5. resolvers.js       Mutation.renameDocument()  (wrapped in tracked())
                      - not signed in? -> UNAUTHENTICATED
                      - finds { uuid, ownerId: me } -> someone else's file = null
                      - trims the name; empty? -> BAD_USER_INPUT
                      - saves it; tracked() writes "Renamed a.pdf to b.pdf,
                        Chrome on Windows 11" to the activity log

6. resolvers.js       Document.kind() and Document.sizeLabel()
                      run because the client asked for them (in DocumentFields)

7. client.js          gets { data: { renameDocument: {...} } }

8. DrivePage.jsx      swaps the new document into the list and shows a toast.
                      No reload needed, because the mutation already returned
                      the new data.
```

### Example: the user uploads a file and ticks "Share publicly"

```
UploadPage.jsx  checks type + size in the browser (lib/files.js), for quick feedback
upload.js       multipart request: operations JSON + map + the raw file (no base64)
                XMLHttpRequest reports progress -> progress bar
resolvers.js    Mutation.uploadDocument(file, uploadId)
                → signed in? → same uploadId before? return that one (no duplicates)
                → size ≤ 20 MB → extension allowed → first bytes match the type
                → bytes into GridFS → details into MongoDB, ALWAYS private
UploadPage.jsx  only now, because the box was ticked:
                setDocumentVisibility(uuid, PUBLIC) → server creates the share link
```

**Why two steps?** A document must never be public by accident. If the upload or
the second step fails, the document is private (or does not exist).

**Why GridFS?** MongoDB cannot store one record bigger than 16 MB, but files can be
20 MB. GridFS cuts a file into small chunks. The `Document` record only keeps a
`fileId` that points to them.

**Why multipart instead of base64?** The first GraphQL version sent files as base64
text inside the JSON (about 33% bigger, and no progress bar). The *GraphQL multipart
request* standard sends the file as a normal form upload part and lets the server
place it into the `$file` variable. Yoga supports it out of the box (`scalar File`).

---

## 7. What changed over time

### REST → GraphQL

| Before (REST) | Now (GraphQL) | Kind |
|---|---|---|
| `GET /api/documents?page=1&limit=10` | `documents(page, limit, search, kind, visibility, sort)` | Query |
| `GET /api/document/:uuid` | `document(uuid)` (details) + `contentUrl` (bytes) | Query |
| `POST /api/upload` (multer, form-data) | `uploadDocument(file, uploadId)` (multipart) | Mutation |
| `DELETE /api/document/:uuid` | `deleteDocument(uuid)` | Mutation |
| — | `renameDocument`, `setDocumentVisibility`, `resetShareLink` **new** | Mutation |

### Single user → private multi-user app

| Before | Now |
|---|---|
| Anyone could list, download or delete every file | Sign-in required; every query is limited to **your** documents |
| `dataBase64` field (whole file inside JSON) | `contentUrl` / `downloadUrl` (streamed, checked routes) |
| No sharing | Explicit "Share publicly" + unguessable, revocable `/s/<token>` links |
| One page | Sign-in, Drive (folders), Shared, Activity, Upload, Settings, standalone Viewer |
| Bootstrap from a CDN, light only | Design tokens, light + dark theme |
| One flat list of files | Nested folders: `folder`, `folders`, `createFolder`, `moveFolder`, `moveDocument`, ... |
| No history | `activityLogs`: every mutation is recorded with the browser and device (`tracked()` in activity/log.js) |
| Errors only in the console | Unexpected errors are emailed (a Yoga **plugin** in app.js) |

Old documents (uploaded before sign-in existed) have no owner, so nobody sees them
until `npm run assign-legacy` gives them to an account (see the API README).

---

## 8. GraphQL ideas used in this app (cheat sheet)

Each idea is used somewhere in the app. Open the file and find it.

| # | Idea | Simple meaning | Where to look |
|---|---|---|---|
| 1 | **Query** | Read data | `type Query` in typeDefs.js |
| 2 | **Mutation** | Change data | `type Mutation` in typeDefs.js |
| 3 | **Scalar types** | `String`, `Int`, `Boolean`, `ID` | typeDefs.js |
| 4 | **Non-null `!`** | "This is never empty" | `uuid: ID!` |
| 5 | **Default argument** | Value used when the client sends nothing | `page: Int = 1`, `sort: DocumentSort = NEWEST` |
| 6 | **Variables** `$x` | Blanks filled in separately (safe, reusable) | every operation in operations.js |
| 7 | **Custom scalar** | A new basic type | `scalar File` (uploads) |
| 8 | **Enum** | Only a fixed list of values is allowed | `FileKind`, `Visibility`, `DocumentSort` |
| 9 | **Nested type** | A type inside a type | `DocumentPage` → `documents: [Document!]!` |
| 10 | **Resolver** | Function that gets the data | resolvers.js |
| 11 | **Default resolver** | No function needed if the field name matches the data | `filename`, `size` (no resolver written) |
| 12 | **Computed field** | Calculated, not stored in the database | `kind`, `sizeLabel`, `shareUrl`, `hasNextPage` |
| 13 | **`parent` argument** | The object above this field | `DocumentPage.documents(page)` uses `page.filter` |
| 14 | **Lazy field** | Code runs **only if the client asks** for the field | `DocumentPage.documents`, `User.linkedAccounts` |
| 15 | **Fragment** `...X` | A reusable list of fields | `DocumentFields`, `UserFields` in operations.js |
| 16 | **Alias** `name: field` | Give an answer another name, or ask for the same field twice | `DRIVE_VIEW` (`page: documents(...)`) |
| 17 | **Errors** | `GraphQLError` → message goes to client | `badInput()` in resolvers.js |
| 18 | **Error code** | Extra info in `extensions` | `BAD_USER_INPUT`, `UNAUTHENTICATED`, read in client.js |
| 19 | **Null for "not found"** | Return `null`, not an error | `document(uuid)`, `publicDocument(token)` |
| 20 | **Introspection** | The schema can describe itself | GraphiQL "Docs" panel |
| 21 | **Context** | Data shared by all resolvers of one request | `{ user, config }` built in app.js |
| 22 | **Enum internal values** | API says `PUBLIC`, database stores `'public'` | `Visibility` map at the end of resolvers.js |
| 23 | **Two types, one record** | Different views of the same data for different callers | `Document` (owner) vs `PublicDocument` (anyone) |
| 24 | **Multipart upload** | Files as form parts, mapped into variables | `graphql/upload.js` |
| 25 | **Directive** `@include(if:)` | Keep a field only when a variable is true | `DRIVE_VIEW` (`folder` only inside a folder) |
| 26 | **Several root fields** | One request asks for several unrelated things | `DRIVE_VIEW`: `folder` + `folders` + `documents` |
| 27 | **Nested list of objects** | A field that returns a list of another type | `Folder.path: [FolderRef!]!` (breadcrumbs) |
| 28 | **Wrapping resolvers** | A function that adds behaviour to many resolvers | `tracked('FOLDER_CREATED', ...)` writes the activity log |
| 29 | **Plugin** | Hooks into every request | `reportUnexpectedErrors` in app.js (exception emails) |
| 30 | **Per-request cache** | Avoid loading the same thing twice in one request | `context.folderCache` used by `Document.folder` |

### Ideas 25 + 26 explained: one request per screen

```graphql
query DriveView($folderId: ID!, $inFolder: Boolean!, $showFolders: Boolean!, $scope: ID) {
  folder(id: $folderId) @include(if: $inFolder) { name path { id name } }   # breadcrumb
  folders(parentId: $scope) @include(if: $showFolders) { id name }          # subfolders
  page: documents(folderId: $scope) { total documents { filename } }        # files
}
```
The Drive page sends **one** request and gets the folder, its subfolders and its files.
At the top level there is no current folder, so `$inFolder` is `false` and `folder` is skipped.
REST would need three requests (or a special endpoint) for the same screen.

### Idea 28 explained: `tracked()`

Every mutation in resolvers.js is wrapped:
```js
renameFolder: tracked('FOLDER_RENAMED', async ({ id, name }, context, activity) => {
  ...
  activity.from = oldName;               // the resolver fills in the entry
  activity.to = newName;
  activity.target = folderTarget(folder);
  return folder;
}),
```
`tracked()` runs the resolver, then saves one activity log entry: `SUCCESS` with those
details, or `FAILURE` with the error message. The browser and device come from
`context.client`, built once per request in app.js.

### Idea 13 + 14 explained

Look at `DocumentPage` in [resolvers.js](doc-manager-api/graphql/resolvers.js):

```js
Query: {
  documents: async (_parent, args, context) => {
    const total = await Document.countDocuments(filter);
    return { total, page, limit, filter, sort, skip };   // ← no list loaded here
  },
},
DocumentPage: {
  documents: (page) => Document.find(page.filter)...   // ← list loaded HERE
},
```

- `Query.documents` returns an object. That object becomes the **parent** of `DocumentPage`.
- `DocumentPage.documents` runs **only** when the client writes `documents { ... }`.
- The `all: documents { total }` alias asks only for `total`, so its list is **never loaded**.

GraphQL calls resolvers **only for the fields you ask for**. Remember this.

### Idea 21 explained: context = "who is asking"

```
browser ──cookie──► sessionMiddleware ──► req.user ──► context.user ──► every resolver
```

- The session cookie is **httpOnly**: page scripts cannot read it, and the browser
  cannot fake `context.user`. Only the server decides who you are.
- Every resolver that touches documents calls `requireUser(context)` and filters
  with `accessibleBy(user)` from [documents/access.js](doc-manager-api/documents/access.js).
  Hiding a button in the UI is **not** security; this filter is.

### Idea 23 explained: one record, two types

A public link must reveal only the file, never the owner. So `publicDocument`
returns a `PublicDocument`, a type that simply **has no** `uuid`, owner, dates or
`shareUrl` field. A visitor cannot ask for what is not on the menu.

---

## 9. Practice in GraphiQL

Sign in to the app, then open **http://localhost:5173/graphql** and paste these one by one.

**1. Who am I?**
```graphql
{ me { name email linkedAccounts { provider } } }
```

**2. Ask for just a few fields**
```graphql
{ documents { total documents { filename sizeLabel visibility } } }
```

**3. Use arguments**
```graphql
{ documents(page: 1, limit: 3, kind: IMAGE, sort: NAME_ASC) { total hasNextPage documents { filename } } }
```

**4. Use an alias**
```graphql
{
  newest: documents(limit: 1) { documents { filename } }
  publicCount: documents(visibility: PUBLIC) { total }
}
```

**5. Use variables.** Paste the query on top, and the JSON into the **Variables** panel at the bottom:
```graphql
query Find($text: String) { documents(search: $text) { total documents { uuid filename } } }
```
```json
{ "text": "invoice" }
```

**6. Make a mistake on purpose** (and read the error)
```graphql
{ documents(kind: VIDEO) { total } }
```

**7. A mutation** (copy a real `uuid` from query 5 first)
```graphql
mutation { setDocumentVisibility(uuid: "PASTE-UUID-HERE", visibility: PUBLIC) { visibility shareUrl } }
```

**8. Open the public view** (paste the token, the part after `/s/` in `shareUrl`)
```graphql
{ publicDocument(token: "PASTE-TOKEN-HERE") { filename kind sizeLabel contentUrl } }
```
Then make it `PRIVATE` again with query 7 and run query 8 once more: it returns `null`.

**9. Ask the schema about itself (introspection)**
```graphql
{ __type(name: "Visibility") { enumValues { name description } } }
```

**10. Sign out** (in another tab) and run query 2 again: `UNAUTHENTICATED`.

**11. Make folders** (copy the `id` from the first answer into the second)
```graphql
mutation { createFolder(name: "Proofs") { id name } }
```
```graphql
mutation { createFolder(name: "10th proofs", parentId: "PASTE-ID-HERE") { id name path { name } } }
```

**12. Walk the tree**: top level, then everything, then inside one folder
```graphql
{
  top: folders(parentId: "root") { name folderCount documentCount }
  all: folders { name path { name } }
  inside: documents(folderId: "PASTE-ID-HERE") { total documents { filename folder { name } } }
}
```

**13. Read your activity log**
```graphql
{
  activityLogs(limit: 5, category: FOLDER) {
    total
    entries { action status targetName from to createdAt client { browser os deviceType } }
  }
}
```

**14. A failure is logged too**: run query 11 again with the same name (it fails with
"already exists"), then run query 13 with `status: FAILURE`.

---

## 10. Homework: from beginner to master

Do them in order. Each one teaches a new idea.

### Level 1 — Easy
1. Add a field `extension: String` to `Document` (for example `"pdf"`). Compute it from `filename` in a resolver. Show it on the card.
2. Add a query `stats` that returns `{ totalFiles, totalSizeLabel, publicFiles }` for the signed-in user.
3. Add a `SMALLEST` value to `enum DocumentSort` and to the `SORTS` map in resolvers.js.

### Level 2 — Medium
4. Add `description: String` to the MongoDB model, and a mutation `updateDescription(uuid, description)`. Remember the owner check!
5. Change `renameDocument` to take one `input` object (`input RenameDocumentInput`). This is the common style in big APIs.
6. Add `viewCount: Int` to `Document` and increase it in the public file route. Show it only to the owner.

### Level 3 — Hard
7. **Sharing with specific people**: add `sharedWith: [ObjectId]` to the model and extend `accessibleBy()` in documents/access.js. Add a mutation `shareWithUser(uuid, email)`.
8. **Tags**: add a new `Tag` type and let a document have many tags (`tags: [Tag!]!`). Then try a query that goes Document → Tag → Documents.
9. **N+1 problem**: in task 8, count how many database calls one query makes. Then fix it with the `dataloader` package (create the loaders in `context`).

### Level 4 — Master
10. **Link expiry**: add `expiresAt` to public links; `publicDocument` returns `null` after it.
11. **Subscriptions**: push a live message to the owner's open browsers when an upload finishes.
12. **Apollo Client** in React: replace `client.js` and learn caching with `useQuery` and `useMutation`.

---

## 11. Common mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Asking for a field that is not in the schema | Error: `Cannot query field "x"` | Add it to typeDefs.js first |
| Adding to the schema but not writing a resolver (for a computed field) | You get `null` | Write the resolver |
| Forgetting `{ ... }` after an object field | Error: "must have a selection" | Pick the fields you want |
| Putting `{ ... }` after a Boolean/String | Error: "must not have a selection" | Remove the braces |
| Using a fragment but not adding its text | Error: `Unknown fragment` | Add `${DOCUMENT_FIELDS}` to the operation |
| Checking only `res.ok` | You miss errors (HTTP is 200!) | Check `body.errors` |
| Gluing values into the query text | Bugs and security problems | Always use `$variables` |
| Enum value in quotes inside the query: `kind: "IMAGE"` | Error | Write `kind: IMAGE` in query text. (In **variables** JSON, it *is* a string: `"IMAGE"`.) |
| Finding a document by `uuid` only | Users can reach other users' files | Always add `accessibleBy(user)` to the filter |
| Trusting the browser's `file.type` | Anyone can lie about a file's type | Check on the server (documents/fileTypes.js) |

---

## 12. Word list

| Word | Meaning |
|---|---|
| Schema / typeDefs | The menu: all types, queries, mutations |
| SDL | The language the schema is written in |
| Operation | One query or mutation sent by the client |
| Selection set | The `{ ... }` list of fields you want |
| Argument | A value given to a field: `document(uuid: "1")` |
| Variable | `$uuid`, filled in from the `variables` JSON |
| Resolver | A function that returns the data for one field |
| Parent | The result of the field above, given to the resolver |
| Context | Per-request data for all resolvers (here: the signed-in user) |
| Fragment | A named, reusable selection set |
| Alias | A new name for a field in the answer |
| Introspection | Asking the schema about itself |
| GraphiQL | The in-browser playground at `/graphql` |
| Yoga | The GraphQL server library this app uses |
| Multipart request | Sending files with GraphQL as form parts |
