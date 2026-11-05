import { graphqlRequest } from '../graphql/client';
import { CREATE_FOLDER, DELETE_FOLDER, FOLDER_CONTENTS, FOLDER_TREE, MOVE_FOLDER, RENAME_FOLDER } from '../graphql/operations';

// ==================================================================
// FOLDER ACTIONS - the folder mutations, plus helpers to turn the flat
// list of folders into a tree for the "Move to" / "Save to" pickers.
// In every function, parentId / folderId null means the top level.
// ==================================================================
export const ROOT_NAME = 'My documents';

const orThrowMissing = (folder) => {
  if (!folder) throw Object.assign(new Error('This folder no longer exists.'), { fromServer: true });
  return folder;
};

export const createFolder = async (name, parentId) =>
  (await graphqlRequest(CREATE_FOLDER, { name, parentId })).createFolder;

export const renameFolder = async (id, name) =>
  orThrowMissing((await graphqlRequest(RENAME_FOLDER, { id, name })).renameFolder);

export const moveFolder = async (id, parentId) =>
  orThrowMissing((await graphqlRequest(MOVE_FOLDER, { id, parentId })).moveFolder);

export const deleteFolder = async (id) => {
  const data = await graphqlRequest(DELETE_FOLDER, { id });
  if (!data.deleteFolder) throw Object.assign(new Error('This folder no longer exists.'), { fromServer: true });
};

export const folderContents = async (id) => (await graphqlRequest(FOLDER_CONTENTS, { id })).folder?.contents ?? null;

// Flat list -> depth-first rows, each with its depth, sorted by name:
//   [{ folder: Proofs, depth: 0 }, { folder: 10th, depth: 1 }, ...]
export function flattenTree(folders) {
  const children = new Map();
  for (const folder of folders) {
    const key = folder.parentId ?? 'root';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(folder);
  }
  const rows = [];
  const walk = (key, depth) => {
    const list = (children.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const folder of list) {
      rows.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk('root', 0);
  return rows;
}

// Ids of a folder and everything below it (they cannot be a destination
// when moving that folder).
export function subtreeIds(folders, rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

export const loadFolderTree = async () => (await graphqlRequest(FOLDER_TREE)).folders;
