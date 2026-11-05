import React, { useState } from 'react';
import Button from './Button';
import Modal from './Modal';

// ==================================================================
// CONFIRM DIALOG - for actions that are hard to undo (delete, make
// private, reset a public link). onConfirm may be async: the button
// shows a spinner and the dialog closes only when it succeeds.
// ==================================================================
export default function ConfirmDialog({ title, children, confirmLabel = 'Confirm', destructive = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller already showed the error; keep the dialog open.
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {/* Destructive actions start focused on Cancel, so Enter is safe. */}
          <Button variant="outline" onClick={onClose} disabled={busy} data-autofocus={destructive || undefined}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={confirm} loading={busy} data-autofocus={!destructive || undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ui-muted">{children}</div>
    </Modal>
  );
}
