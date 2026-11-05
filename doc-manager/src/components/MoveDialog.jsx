import React, { useEffect, useMemo, useState } from 'react';
import { Folder, FolderInput, House, Search } from 'lucide-react';
import { moveDocument } from '../lib/documentActions';
import { reportError } from '../lib/errorReporting';
import { ROOT_NAME, flattenTree, loadFolderTree, moveFolder, subtreeIds } from '../lib/folderActions';
import Button from './Button';
import Modal from './Modal';
import { Spinner } from './Spinner';

// ==================================================================
// MOVE TO... - pick a destination folder for a document or a folder.
//   item: { type: 'document' | 'folder', id, name, folderId }
//         (folderId = where it is now; null = top level)
// A folder cannot be moved into itself or its own subfolders, so those
// are shown but disabled.
// ==================================================================
export default function MoveDialog({ item, onClose, onMoved }) {
  const [folders, setFolders] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState(item.folderId ?? 'root');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadFolderTree().then(setFolders).catch((err) => {
      setLoadError(err.message);
      reportError(err, 'Loading folders for "Move to"');
    });
  }, []);

  const blocked = useMemo(
    () => (item.type === 'folder' && folders ? subtreeIds(folders, item.id) : new Set()),
    [folders, item]
  );
  const rows = useMemo(() => {
    if (!folders) return [];
    const all = flattenTree(folders);
    const text = filter.trim().toLowerCase();
    // While filtering, show matches flat (their depth no longer matters).
    return text ? all.filter((r) => r.folder.name.toLowerCase().includes(text)).map((r) => ({ ...r, depth: 0 })) : all;
  }, [folders, filter]);

  const current = item.folderId ?? 'root';
  const submit = async () => {
    if (target === current) return onClose();
    setBusy(true);
    setError('');
    const destination = target === 'root' ? null : target;
    try {
      const result = item.type === 'document'
        ? await moveDocument(item.id, destination)
        : await moveFolder(item.id, destination);
      const name = target === 'root' ? ROOT_NAME : folders.find((f) => f.id === target)?.name;
      onMoved(result, name);
      onClose();
    } catch (err) {
      setError(err.message);
      reportError(err, item.type === 'document' ? 'Moving a document' : 'Moving a folder');
      setBusy(false);
    }
  };

  const option = (id, label, depth, Icon, disabled) => (
    <label key={id} className={'move-option' + (target === id ? ' is-selected' : '') + (disabled ? ' is-disabled' : '')}
      style={{ paddingLeft: 12 + depth * 20 }}>
      <input type="radio" name="move-target" value={id} checked={target === id} disabled={disabled}
        onChange={() => setTarget(id)} className="visually-hidden" />
      <Icon size={17} aria-hidden="true" className="flex-shrink-0" />
      <span className="text-truncate flex-grow-1">{label}</span>
      {id === current && <span className="ui-small ui-subtle flex-shrink-0">Current</span>}
    </label>
  );

  return (
    <Modal
      title={`Move "${item.name}"`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={FolderInput} onClick={submit} loading={busy} disabled={!folders || target === current}>
            Move here
          </Button>
        </>
      }
    >
      {loadError ? (
        <div className="ui-alert ui-alert-error" role="alert">{loadError}</div>
      ) : !folders ? (
        <div className="text-center py-4"><Spinner label="Loading folders" /></div>
      ) : (
        <div className="d-grid gap-3">
          {folders.length > 8 && (
            <div className="ui-input-icon">
              <Search size={17} aria-hidden="true" />
              <input type="search" className="ui-input" placeholder="Find a folder" aria-label="Find a folder"
                value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <fieldset className="move-list">
            <legend className="visually-hidden">Destination folder</legend>
            {!filter.trim() && option('root', ROOT_NAME, 0, House, false)}
            {rows.map(({ folder, depth }) =>
              option(folder.id, folder.name, filter.trim() ? 0 : depth + 1, Folder, blocked.has(folder.id)))}
            {rows.length === 0 && filter.trim() && <div className="ui-small ui-muted p-3">No folder matches "{filter.trim()}".</div>}
          </fieldset>
          {error && <div className="ui-field-error m-0" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
