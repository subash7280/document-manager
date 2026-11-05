import React, { useState } from 'react';
import { createFolder, renameFolder } from '../lib/folderActions';
import { reportError } from '../lib/errorReporting';
import Button from './Button';
import Modal from './Modal';

// ==================================================================
// NEW FOLDER / RENAME FOLDER
//   <FolderDialog parentId={...} onSaved={...} />   -> create
//   <FolderDialog folder={...} onSaved={...} />      -> rename
// Errors (e.g. "A folder named X already exists there") are shown
// under the field, so the user can fix the name and try again.
// ==================================================================
export default function FolderDialog({ folder, parentId = null, onClose, onSaved }) {
  const renaming = Boolean(folder);
  const [name, setName] = useState(folder?.name ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a folder name.');
    if (renaming && trimmed === folder.name) return onClose();
    setBusy(true);
    try {
      onSaved(renaming ? await renameFolder(folder.id, trimmed) : await createFolder(trimmed, parentId));
      onClose();
    } catch (err) {
      setError(err.message);
      reportError(err, renaming ? 'Renaming a folder' : 'Creating a folder');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={renaming ? 'Rename folder' : 'New folder'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="folder-form" loading={busy}>{renaming ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <form id="folder-form" onSubmit={submit} noValidate>
        <label className="ui-label" htmlFor="folder-name">Folder name</label>
        <input
          id="folder-name"
          className="ui-input"
          value={name}
          maxLength={100}
          placeholder="e.g. 10th proofs"
          autoComplete="off"
          onChange={(e) => { setName(e.target.value); setError(''); }}
          aria-invalid={!!error}
          aria-describedby={error ? 'folder-error' : undefined}
          data-autofocus
        />
        {error && <div id="folder-error" className="ui-field-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
