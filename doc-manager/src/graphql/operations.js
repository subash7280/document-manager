// ==================================================================
// GRAPHQL OPERATIONS (QUERIES + MUTATIONS)
// Every query and mutation the frontend sends lives in this file.
//
// How to read an operation:
//
//   query GetDocuments($page: Int!, $limit: Int!) {   <- 1
//     documents(page: $page, limit: $limit) {         <- 2
//       total                                         <- 3
//     }
//   }
//
//   1. "query" = read data ("mutation" = change data).
//      "GetDocuments" is a name we choose; it helps with debugging.
//      "$page: Int!" declares a VARIABLE. Its value is sent separately
//      in the "variables" JSON, never glued into the query text.
//      This is safer and lets the same query text be reused.
//   2. The field to call (defined in the backend's typeDefs.js) and
//      the arguments passed to it.
//   3. The "selection set": the exact fields we want back.
//      The server returns THESE fields and nothing else. This is the
//      main idea of GraphQL: the client decides the shape of the data.
//
// The /* GraphQL */ comment does nothing at runtime; it just lets
// editor extensions syntax-highlight the text as GraphQL.
// ==================================================================

// ------------------------------------------------------------------
// FRAGMENTS: SHARED FIELD LISTS
// A fragment is a reusable, named list of fields.
// "on Document" says which type the fields belong to.
// Any operation can include it with "...DocumentFields" (three dots).
// The fragment text must also be added to the operation text, which is
// what ${DOCUMENT_FIELDS} does below.
// Benefit: the list, the viewer and every mutation result ask for the
// same fields, so a returned document can simply replace the old one.
// ------------------------------------------------------------------
const DOCUMENT_FIELDS = /* GraphQL */ `
  fragment DocumentFields on Document {
    uuid
    filename
    contentType
    kind
    size
    sizeLabel
    uploadedAt
    visibility
    shareUrl
    publishedAt
    contentUrl
    downloadUrl
    folderId
    folder {
      id
      name
    }
  }
`;

// A NESTED selection: path is a list of FolderRef objects, so it needs
// its own { ... } of fields, just like a top-level query.
const FOLDER_FIELDS = /* GraphQL */ `
  fragment FolderFields on Folder {
    id
    name
    parentId
    updatedAt
    folderCount
    documentCount
    path {
      id
      name
    }
  }
`;

const USER_FIELDS = /* GraphQL */ `
  fragment UserFields on User {
    id
    name
    email
    avatarUrl
    createdAt
    isAdmin
    linkedAccounts {
      provider
      email
      linkedAt
    }
  }
`;

// ------------------------------------------------------------------
// QUERY: WHO IS SIGNED IN?
// Answers null when signed out. The session cookie travels with the
// request automatically; the server decides who "me" is.
// ------------------------------------------------------------------
export const ME = /* GraphQL */ `
  query Me {
    me {
      ...UserFields
    }
  }
  ${USER_FIELDS}
`;

// ------------------------------------------------------------------
// QUERY: ONE SCREEN OF THE DRIVE (a folder, its subfolders, its files)
// Three fields in ONE request, each answered by its own resolver.
//
// DIRECTIVES: @include(if: $variable) keeps a field only when the
// variable is true. One query text covers every screen:
//   top level      -> no "folder" (there is no current folder)
//   "Shared" view  -> no "folders" (only documents are listed)
//
// FOLDER ARGUMENTS (same rule on the server for every list):
//   a folder id -> inside that folder, "root" -> top level,
//   null        -> everywhere (used for search and the Shared view)
//
// ALIAS: "page: documents(...)" renames the answer to "page", so the
// response reads { folder, folders, page: { total, documents } }.
// ------------------------------------------------------------------
export const DRIVE_VIEW = /* GraphQL */ `
  query DriveView(
    $folderId: ID!
    $inFolder: Boolean!
    $showFolders: Boolean!
    $scope: ID
    $page: Int!
    $limit: Int!
    $search: String
    $kind: FileKind
    $visibility: Visibility
    $sort: DocumentSort
  ) {
    folder(id: $folderId) @include(if: $inFolder) {
      ...FolderFields
    }
    folders(parentId: $scope, search: $search) @include(if: $showFolders) {
      ...FolderFields
    }
    page: documents(folderId: $scope, page: $page, limit: $limit, search: $search, kind: $kind, visibility: $visibility, sort: $sort) {
      total
      hasNextPage
      documents {
        ...DocumentFields
      }
    }
  }
  ${FOLDER_FIELDS}
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// QUERY: EVERY FOLDER (for the "Move to" and "Save to" pickers)
// No arguments = parentId null = all folders at any depth. The browser
// builds the tree from each folder's parentId.
// ------------------------------------------------------------------
export const FOLDER_TREE = /* GraphQL */ `
  query FolderTree {
    folders {
      id
      name
      parentId
    }
  }
`;

// QUERY: what deleting a folder would remove (shown in the dialog).
export const FOLDER_CONTENTS = /* GraphQL */ `
  query FolderContents($id: ID!) {
    folder(id: $id) {
      id
      contents {
        folders
        documents
      }
    }
  }
`;

// ------------------------------------------------------------------
// QUERY: ONE OF MY DOCUMENTS (the owner's viewer)
// Null if it does not exist OR belongs to someone else.
// ------------------------------------------------------------------
export const GET_DOCUMENT = /* GraphQL */ `
  query GetDocument($uuid: ID!) {
    document(uuid: $uuid) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// QUERY: A DOCUMENT BY ITS PUBLIC LINK (no sign-in)
// PublicDocument is a different type with fewer fields: no uuid, no
// dates, nothing about the owner.
// ------------------------------------------------------------------
export const GET_PUBLIC_DOCUMENT = /* GraphQL */ `
  query GetPublicDocument($token: String!) {
    publicDocument(token: $token) {
      filename
      contentType
      kind
      size
      sizeLabel
      contentUrl
      downloadUrl
    }
  }
`;

// ------------------------------------------------------------------
// MUTATION: UPLOAD A FILE
// The file itself is NOT in this text: it travels as a separate part
// of a multipart request (see graphql/upload.js), and GraphQL puts it
// into the $file variable on the server.
// ------------------------------------------------------------------
export const UPLOAD_DOCUMENT = /* GraphQL */ `
  mutation UploadDocument($file: File!, $uploadId: ID!, $folderId: ID) {
    uploadDocument(file: $file, uploadId: $uploadId, folderId: $folderId) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// MUTATION: RENAME A FILE
// A mutation can return data just like a query; here we get back the
// updated document using the same fragment as the list, so the card
// can be updated without reloading the whole list.
// ------------------------------------------------------------------
export const RENAME_DOCUMENT = /* GraphQL */ `
  mutation RenameDocument($uuid: ID!, $filename: String!) {
    renameDocument(uuid: $uuid, filename: $filename) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// MUTATION: PUBLIC / PRIVATE
// PUBLIC creates a public link (shareUrl); PRIVATE deletes it so the
// old link stops working at once.
// ------------------------------------------------------------------
export const SET_VISIBILITY = /* GraphQL */ `
  mutation SetDocumentVisibility($uuid: ID!, $visibility: Visibility!) {
    setDocumentVisibility(uuid: $uuid, visibility: $visibility) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// MUTATION: NEW PUBLIC LINK (the old one stops working)
export const RESET_SHARE_LINK = /* GraphQL */ `
  mutation ResetShareLink($uuid: ID!) {
    resetShareLink(uuid: $uuid) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// MUTATION: DELETE A FILE
// deleteDocument returns a plain Boolean, so there is no selection set
// ({ ... }) after it. Selection sets are only for object types like
// Document.
// ------------------------------------------------------------------
export const DELETE_DOCUMENT = /* GraphQL */ `
  mutation DeleteDocument($uuid: ID!) {
    deleteDocument(uuid: $uuid)
  }
`;

// MUTATION: PUT A DOCUMENT IN ANOTHER FOLDER (null = top level)
export const MOVE_DOCUMENT = /* GraphQL */ `
  mutation MoveDocument($uuid: ID!, $folderId: ID) {
    moveDocument(uuid: $uuid, folderId: $folderId) {
      ...DocumentFields
    }
  }
  ${DOCUMENT_FIELDS}
`;

// ------------------------------------------------------------------
// MUTATIONS: FOLDERS
// They return the folder with the same fragment as the list, so the
// screen can update without asking for the whole list again.
// ------------------------------------------------------------------
export const CREATE_FOLDER = /* GraphQL */ `
  mutation CreateFolder($name: String!, $parentId: ID) {
    createFolder(name: $name, parentId: $parentId) {
      ...FolderFields
    }
  }
  ${FOLDER_FIELDS}
`;

export const RENAME_FOLDER = /* GraphQL */ `
  mutation RenameFolder($id: ID!, $name: String!) {
    renameFolder(id: $id, name: $name) {
      ...FolderFields
    }
  }
  ${FOLDER_FIELDS}
`;

export const MOVE_FOLDER = /* GraphQL */ `
  mutation MoveFolder($id: ID!, $parentId: ID) {
    moveFolder(id: $id, parentId: $parentId) {
      ...FolderFields
    }
  }
  ${FOLDER_FIELDS}
`;

export const DELETE_FOLDER = /* GraphQL */ `
  mutation DeleteFolder($id: ID!) {
    deleteFolder(id: $id)
  }
`;

// ------------------------------------------------------------------
// QUERIES: ACTIVITY LOG
// Every filter is an optional variable; null means "no filter".
// client { ... } is a nested object (browser, system, device).
// ------------------------------------------------------------------
export const ACTIVITY_LOGS = /* GraphQL */ `
  query ActivityLogs(
    $page: Int!
    $limit: Int!
    $search: String
    $category: ActivityCategory
    $action: ActivityAction
    $status: ActivityStatus
    $deviceType: DeviceType
    $browser: String
    $os: String
    $from: String
    $to: String
  ) {
    activityLogs(
      page: $page
      limit: $limit
      search: $search
      category: $category
      action: $action
      status: $status
      deviceType: $deviceType
      browser: $browser
      os: $os
      from: $from
      to: $to
    ) {
      total
      hasNextPage
      entries {
        id
        action
        category
        status
        targetType
        targetName
        from
        to
        note
        error
        createdAt
        client {
          ip
          browser
          browserVersion
          os
          osVersion
          deviceType
          deviceVendor
          deviceModel
          userAgent
        }
      }
    }
  }
`;

export const ACTIVITY_FILTER_OPTIONS = /* GraphQL */ `
  query ActivityFilterOptions {
    activityFilterOptions {
      browsers
      operatingSystems
    }
  }
`;

// ------------------------------------------------------------------
// MUTATIONS: ACCOUNT SETTINGS
// ------------------------------------------------------------------
export const UPDATE_PROFILE = /* GraphQL */ `
  mutation UpdateProfile($name: String!) {
    updateProfile(name: $name) {
      ...UserFields
    }
  }
  ${USER_FIELDS}
`;

// ------------------------------------------------------------------
// QUERIES: ADMIN (administrators only; others get FORBIDDEN)
// AdminUser / AdminDocument are separate types from User / Document:
// no share links, and file URLs go through the admin route.
// ------------------------------------------------------------------
export const ADMIN_USERS = /* GraphQL */ `
  query AdminUsers($page: Int!, $limit: Int!, $search: String) {
    adminUsers(page: $page, limit: $limit, search: $search) {
      total
      hasNextPage
      users {
        id
        name
        email
        avatarUrl
        isAdmin
        createdAt
        lastLoginAt
        documentCount
        storageLabel
      }
    }
  }
`;

// One user + one page of their documents, in ONE request.
export const ADMIN_USER_DOCUMENTS = /* GraphQL */ `
  query AdminUserDocuments(
    $userId: ID!
    $page: Int!
    $limit: Int!
    $search: String
    $kind: FileKind
    $visibility: Visibility
    $sort: DocumentSort
  ) {
    user: adminUser(id: $userId) {
      id
      name
      email
      avatarUrl
      isAdmin
      documentCount
      storageLabel
    }
    page: adminDocuments(userId: $userId, page: $page, limit: $limit, search: $search, kind: $kind, visibility: $visibility, sort: $sort) {
      total
      hasNextPage
      documents {
        uuid
        filename
        contentType
        kind
        sizeLabel
        uploadedAt
        visibility
        folder {
          id
          name
        }
        contentUrl
        downloadUrl
      }
    }
  }
`;

export const UNLINK_ACCOUNT = /* GraphQL */ `
  mutation UnlinkAccount($provider: AuthProvider!) {
    unlinkAccount(provider: $provider) {
      ...UserFields
    }
  }
  ${USER_FIELDS}
`;
