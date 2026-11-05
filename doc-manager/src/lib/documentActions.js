import { graphqlRequest } from '../graphql/client';
import { DELETE_DOCUMENT, MOVE_DOCUMENT, RENAME_DOCUMENT, RESET_SHARE_LINK, SET_VISIBILITY } from '../graphql/operations';

// ==================================================================
// DOCUMENT ACTIONS - the mutations used by the dashboard, the viewer
// and the share dialog. Each returns the updated document (same
// DocumentFields fragment), so callers can swap it into their state.
// A null answer means the document no longer exists for this user.
// ==================================================================
const orThrowMissing = (doc) => {
  if (!doc) throw new Error('This document no longer exists.');
  return doc;
};

export const setVisibility = async (uuid, visibility) =>
  orThrowMissing((await graphqlRequest(SET_VISIBILITY, { uuid, visibility })).setDocumentVisibility);

export const resetShareLink = async (uuid) =>
  orThrowMissing((await graphqlRequest(RESET_SHARE_LINK, { uuid })).resetShareLink);

export const renameDocument = async (uuid, filename) =>
  orThrowMissing((await graphqlRequest(RENAME_DOCUMENT, { uuid, filename })).renameDocument);

// folderId null = top level ("My documents").
export const moveDocument = async (uuid, folderId) =>
  orThrowMissing((await graphqlRequest(MOVE_DOCUMENT, { uuid, folderId })).moveDocument);

export const deleteDocument = async (uuid) => {
  const data = await graphqlRequest(DELETE_DOCUMENT, { uuid });
  if (!data.deleteDocument) throw new Error('This document no longer exists.');
};

// Downloads through the authorized file route. The server answers with
// "Content-Disposition: attachment", so the browser saves the file.
export function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
