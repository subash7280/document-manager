// ==================================================================
// GRAPHQL SCHEMA ("type definitions")
//
// The schema is the CONTRACT between the frontend and the backend.
// It lists every piece of data a client can ask for, and every action
// a client can perform. Anything not written here simply does not exist
// for the client.
//
// It is written in GraphQL's own language, SDL (Schema Definition
// Language), inside a normal JavaScript string.
//
// Quick reading guide:
//   String, Int, Boolean, ID   -> built-in basic types
//   String!                    -> "!" means NEVER null (always present)
//   [Document!]!               -> a list of Documents (list never null,
//                                 and no item inside it is null)
//   enum                       -> a fixed list of allowed values
//   scalar                     -> a custom basic type (File, below)
//   """ text """               -> a description; it shows up as help
//                                 text in the GraphiQL playground
//
// WHO MAY CALL WHAT
//   me, publicDocument  -> anyone (they return null when not allowed)
//   admin*              -> administrators only (users.isAdmin = true):
//                          read-only view of EVERY user and document
//   everything else     -> signed-in users only, and only for their OWN
//                          documents, folders and activity (enforced in
//                          resolvers.js)
//
// FOLDER ARGUMENTS: one rule everywhere a folder id filters a list
//   a folder's id -> inside that folder
//   "root"        -> the top level ("My documents")
//   null/omitted  -> everywhere (all folders, any depth)
// All of it goes to ONE address: POST /graphql
// ==================================================================

export const typeDefs = /* GraphQL */ `
  # ----------------------------------------------------------------
  # SCALARS
  # File = an uploaded file, sent with the "GraphQL multipart request"
  # format (a normal multipart/form-data upload). GraphQL Yoga gives
  # the resolver a standard web File object: name, size, type, bytes.
  # ----------------------------------------------------------------
  scalar File

  # ----------------------------------------------------------------
  # ENUMS
  # enum = a type that can only be ONE of the listed values.
  # GraphQL rejects any other value automatically, so the resolvers
  # never receive something like "IMAGEZ" by mistake.
  # In JSON (variables and responses) an enum value is just a string:
  #   "IMAGE"
  # ----------------------------------------------------------------
  "A simple category for a file, worked out from its contentType."
  enum FileKind {
    IMAGE
    PDF
    OTHER
  }

  "Who can open a document."
  enum Visibility {
    "Only the owner (the default for every upload)."
    PRIVATE
    "Anyone who has the public link, without signing in."
    PUBLIC
  }

  "Order of the document list."
  enum DocumentSort {
    NEWEST
    OLDEST
    NAME_ASC
    NAME_DESC
    LARGEST
  }

  "A sign-in method."
  enum AuthProvider {
    GOOGLE
    APPLE
  }

  "Something a user did. Recorded in the activity log."
  enum ActivityAction {
    SIGNED_UP
    SIGNED_IN
    SIGNED_OUT
    SIGNED_OUT_EVERYWHERE
    ACCOUNT_LINKED
    ACCOUNT_UNLINKED
    PROFILE_UPDATED
    DOCUMENT_UPLOADED
    DOCUMENT_RENAMED
    DOCUMENT_MOVED
    DOCUMENT_DELETED
    DOCUMENT_DOWNLOADED
    DOCUMENT_MADE_PUBLIC
    DOCUMENT_MADE_PRIVATE
    SHARE_LINK_RESET
    FOLDER_CREATED
    FOLDER_RENAMED
    FOLDER_MOVED
    FOLDER_DELETED
  }

  "Groups of ActivityAction values, for filtering."
  enum ActivityCategory {
    AUTH
    ACCOUNT
    DOCUMENT
    FOLDER
    SHARING
  }

  enum ActivityStatus {
    SUCCESS
    FAILURE
  }

  enum DeviceType {
    DESKTOP
    MOBILE
    TABLET
    OTHER
  }

  # ----------------------------------------------------------------
  # OBJECT TYPES
  # type = a shape of data the server RETURNS. Each field has its own
  # type, and a client picks which fields it wants.
  # ----------------------------------------------------------------
  """
  One stored file, as seen by its OWNER.
  A client picks only the fields it needs. For example, the file list
  never asks for the file contents; it uses contentUrl for thumbnails.
  """
  type Document {
    uuid: ID!
    filename: String
    contentType: String
    "File size in bytes."
    size: Int
    "Upload time as an ISO 8601 date string, e.g. 2026-10-26T10:15:00.000Z"
    uploadedAt: String
    visibility: Visibility!
    "The public link. Null unless visibility is PUBLIC."
    shareUrl: String
    "When the document was made public (null when private)."
    publishedAt: String
    "URL that shows the file (owner's session required)."
    contentUrl: String!
    "URL that downloads the file (owner's session required)."
    downloadUrl: String!
    "The folder it is in. Null = top level (My documents)."
    folderId: ID
    "That folder's id and name (handy for search results). Null = top level."
    folder: FolderRef

    # The two fields below are COMPUTED fields. They are not stored in
    # MongoDB at all; a resolver calculates them when a client asks.
    # The client cannot tell the difference, and does not need to.
    "IMAGE, PDF or OTHER (calculated from contentType)."
    kind: FileKind!
    "Human-friendly size, e.g. 1.4 MB (calculated from size)."
    sizeLabel: String
  }

  """
  A document opened through its public link.
  On purpose this type has NO uuid, owner, dates or other private data:
  a public link reveals only what is needed to show the file.
  """
  type PublicDocument {
    filename: String
    contentType: String
    kind: FileKind!
    size: Int
    sizeLabel: String
    contentUrl: String!
    downloadUrl: String!
  }

  """
  A folder, like in Google Drive. Folders can hold documents and other
  folders. Names are unique inside the same parent (ignoring case).
  """
  type Folder {
    id: ID!
    name: String!
    "The folder it is in. Null = top level."
    parentId: ID
    "The folders above it, top-down (for breadcrumbs). Empty at the top level."
    path: [FolderRef!]!
    createdAt: String
    updatedAt: String
    "Folders directly inside it."
    folderCount: Int!
    "Documents directly inside it."
    documentCount: Int!
    "Everything inside it at ANY depth (shown before deleting it)."
    contents: FolderContents!
  }

  "Just enough of a folder to show it and link to it."
  type FolderRef {
    id: ID!
    name: String!
  }

  type FolderContents {
    folders: Int!
    documents: Int!
  }

  "Which browser, system and device an action came from."
  type ClientInfo {
    ip: String
    "e.g. Chrome, Edge, Mobile Safari"
    browser: String
    "Major version, e.g. 130"
    browserVersion: String
    "e.g. Windows, Mac OS, Android, iOS"
    os: String
    "e.g. 11"
    osVersion: String
    deviceType: DeviceType!
    "e.g. Apple, Samsung (phones and tablets only)"
    deviceVendor: String
    "e.g. iPhone, Pixel 8 (phones and tablets only)"
    deviceModel: String
    userAgent: String
  }

  "One entry of the activity log."
  type ActivityLog {
    id: ID!
    action: ActivityAction!
    category: ActivityCategory!
    status: ActivityStatus!
    "What it was done to: 'document', 'folder' or 'account'."
    targetType: String
    "Its name at that moment (kept even after it is deleted)."
    targetName: String
    "Old value, for renames and moves."
    from: String
    "New value, for renames, moves and uploads (the folder)."
    to: String
    "Anything else worth knowing, e.g. how much a folder delete removed."
    note: String
    "Why it failed (FAILURE only)."
    error: String
    createdAt: String!
    client: ClientInfo!
  }

  type ActivityLogPage {
    total: Int!
    page: Int!
    limit: Int!
    hasNextPage: Boolean!
    entries: [ActivityLog!]!
  }

  "Values that exist in YOUR activity log, to fill the filter menus."
  type ActivityFilterOptions {
    browsers: [String!]!
    operatingSystems: [String!]!
  }

  "One page of documents, plus the numbers needed for pagination."
  type DocumentPage {
    "Number of documents matching the filters (across all pages)."
    total: Int!
    page: Int!
    limit: Int!
    "true if there is at least one more page after this one."
    hasNextPage: Boolean!
    documents: [Document!]!
  }

  "A sign-in method connected to the account."
  type LinkedAccount {
    provider: AuthProvider!
    email: String
    linkedAt: String
  }

  "The signed-in person."
  type User {
    id: ID!
    name: String
    email: String
    avatarUrl: String
    createdAt: String
    "true for administrators (set in the database only, never through the API)."
    isAdmin: Boolean!
    linkedAccounts: [LinkedAccount!]!
  }

  # ----------------------------------------------------------------
  # ADMIN TYPES (administrators only)
  # Separate from User / Document on purpose: an admin sees who owns
  # what, but never share links, and file URLs go through the admin
  # route (/api/admin/...), which checks isAdmin again.
  # ----------------------------------------------------------------
  "Any user's account, with a summary of what they stored."
  type AdminUser {
    id: ID!
    name: String
    email: String
    avatarUrl: String
    isAdmin: Boolean!
    createdAt: String
    lastLoginAt: String
    "How many documents they uploaded."
    documentCount: Int!
    "Total size of their documents in bytes."
    storageUsed: Float!
    "Human-friendly storageUsed, e.g. 4.2 MB."
    storageLabel: String!
  }

  type AdminUserPage {
    total: Int!
    page: Int!
    limit: Int!
    hasNextPage: Boolean!
    users: [AdminUser!]!
  }

  "Any user's document, as an administrator sees it."
  type AdminDocument {
    uuid: ID!
    filename: String
    contentType: String
    kind: FileKind!
    size: Int
    sizeLabel: String
    uploadedAt: String
    visibility: Visibility!
    "The folder it is in. Null = the owner's top level."
    folder: FolderRef
    "URL that shows the file (administrator's session required)."
    contentUrl: String!
    "URL that downloads the file (administrator's session required)."
    downloadUrl: String!
  }

  type AdminDocumentPage {
    total: Int!
    page: Int!
    limit: Int!
    hasNextPage: Boolean!
    documents: [AdminDocument!]!
  }

  # ----------------------------------------------------------------
  # QUERIES (READ)
  # Query = READ operations (like GET in REST). They never change data.
  # ----------------------------------------------------------------
  type Query {
    "The signed-in user, or null when signed out. The UI asks this to know who is signed in."
    me: User

    """
    List YOUR documents. All arguments are optional:
      page / limit -> pagination (defaults 1 and 10)
      search       -> only files whose name contains this text
      kind         -> only files of this kind (IMAGE, PDF or OTHER)
      visibility   -> only PRIVATE or only PUBLIC documents
      sort         -> order (default NEWEST)
      folderId     -> a folder id, "root" (top level) or null (everywhere)
    """
    documents(
      folderId: ID
      page: Int = 1
      limit: Int = 10
      search: String
      kind: FileKind
      visibility: Visibility
      sort: DocumentSort = NEWEST
    ): DocumentPage!

    "One of YOUR documents. Null if it does not exist or is not yours."
    document(uuid: ID!): Document

    "A document by its public link token. Null if the link is wrong or was revoked. No sign-in needed."
    publicDocument(token: String!): PublicDocument

    "One of YOUR folders. Null if it does not exist or is not yours."
    folder(id: ID!): Folder

    """
    YOUR folders, sorted by name.
      parentId -> a folder id (its subfolders), "root" (top-level folders)
                  or null (ALL folders, e.g. for a "Move to" picker)
      search   -> only folders whose name contains this text, at any depth
                  (parentId is then ignored)
    """
    folders(parentId: ID, search: String): [Folder!]!

    """
    YOUR activity log, newest first. All filters are optional.
      search     -> text in the document / folder name
      from / to  -> ISO date-times, e.g. "2026-10-01T00:00:00.000Z"
      browser/os -> a value from activityFilterOptions
    """
    activityLogs(
      page: Int = 1
      limit: Int = 20
      search: String
      category: ActivityCategory
      action: ActivityAction
      status: ActivityStatus
      deviceType: DeviceType
      browser: String
      os: String
      from: String
      to: String
    ): ActivityLogPage!

    activityFilterOptions: ActivityFilterOptions!

    """
    ADMIN ONLY. Every user, sorted by name.
      search -> only users whose name or email contains this text
    """
    adminUsers(page: Int = 1, limit: Int = 25, search: String): AdminUserPage!

    "ADMIN ONLY. One user. Null if there is no such user."
    adminUser(id: ID!): AdminUser

    """
    ADMIN ONLY. One user's documents, in every folder.
    Same filters as "documents"; folders are not browsed here.
    """
    adminDocuments(
      userId: ID!
      page: Int = 1
      limit: Int = 25
      search: String
      kind: FileKind
      visibility: Visibility
      sort: DocumentSort = NEWEST
    ): AdminDocumentPage!
  }

  # ----------------------------------------------------------------
  # MUTATIONS (WRITE)
  # Mutation = WRITE operations (like POST / PUT / DELETE in REST).
  # ----------------------------------------------------------------
  type Mutation {
    """
    Save a new file (max 20 MB). It is always PRIVATE at first.
    uploadId is a random id made by the client for this upload: sending
    the same uploadId again returns the first document instead of
    creating a duplicate (safe retries after a network error).
    folderId: where to put it (null or "root" = top level).
    """
    uploadDocument(file: File!, uploadId: ID!, folderId: ID): Document!

    "Change a file's name. Returns the updated document, or null if not found."
    renameDocument(uuid: ID!, filename: String!): Document

    "Delete a file. Returns true if it was deleted, false if it was not found."
    deleteDocument(uuid: ID!): Boolean!

    "Put a document in another folder (folderId null or 'root' = top level)."
    moveDocument(uuid: ID!, folderId: ID): Document

    "Make a folder. parentId null or 'root' = top level."
    createFolder(name: String!, parentId: ID): Folder!

    "Rename a folder. Null if not found."
    renameFolder(id: ID!, name: String!): Folder

    "Move a folder and everything in it. It cannot go inside itself."
    moveFolder(id: ID!, parentId: ID): Folder

    """
    Delete a folder AND everything inside it: subfolders and documents
    (their public links stop working). Cannot be undone.
    """
    deleteFolder(id: ID!): Boolean!

    """
    Make a document PUBLIC (creates a public link) or PRIVATE (deletes
    the public link, so it stops working immediately).
    """
    setDocumentVisibility(uuid: ID!, visibility: Visibility!): Document

    "Replace a public document's link with a new one; the old link stops working."
    resetShareLink(uuid: ID!): Document

    "Change your display name."
    updateProfile(name: String!): User!

    "Disconnect a sign-in method. Your last remaining method cannot be removed."
    unlinkAccount(provider: AuthProvider!): User!
  }
`;
