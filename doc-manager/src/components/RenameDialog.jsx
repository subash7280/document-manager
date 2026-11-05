import React, { useState } from 'react';
import { renameDocument } from '../lib/documentActions';
import { reportError } from '../lib/errorReporting';
import Button from './Button';
import Modal from './Modal';

export default function RenameDialog({ doc, onClose, onRenamed }) {
  const [name, setName] = useState(doc.filename);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a file name.');
    if (trimmed === doc.filename) return onClose();
    setBusy(true);
    try {
      onRenamed(await renameDocument(doc.uuid, trimmed));
      onClose();
    } catch (err) {
      setError(err.message);
      reportError(err, 'Renaming a document');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Rename document"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-form" loading={busy}>Save</Button>
        </>
      }
    >
      <form id="rename-form" onSubmit={submit} noValidate>
        <label className="ui-label" htmlFor="rename-input">File name</label>
        <input
          id="rename-input"
          className="ui-input"
          value={name}
          maxLength={255}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          aria-invalid={!!error}
          aria-describedby={error ? 'rename-error' : undefined}
          data-autofocus
        />
        {error && <div id="rename-error" className="ui-field-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
