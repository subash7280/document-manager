import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { showError } from '../lib/errorReporting';
import { Globe, Lock, RefreshCw } from 'lucide-react';
import { resetShareLink, setVisibility } from '../lib/documentActions';
import Button from './Button';
import FileIcon from './FileIcon';
import Modal from './Modal';
import ShareTargets from './ShareTargets';
import VisibilityBadge from './VisibilityBadge';

// Small preview of what is being shared.
export function SharePreview({ filename, contentType, kind, sizeLabel, imageUrl, visibility }) {
  return (
    <div className="share-preview">
      <span className="share-preview-thumb">
        {kind === 'IMAGE' && imageUrl
          ? <img src={imageUrl} alt="" />
          : <FileIcon contentType={contentType} filename={filename} size={22} showLabel={false} />}
      </span>
      <span className="min-w-0 flex-grow-1">
        <span className="d-block fw-semibold text-truncate">{filename}</span>
        <span className="ui-small ui-muted">{sizeLabel}</span>
      </span>
      {visibility && <VisibilityBadge visibility={visibility} />}
    </div>
  );
}

// ==================================================================
// SHARE DIALOG (owner)
//
// PRIVATE document -> explains what public means and asks for explicit
//   consent ("Share publicly", unchecked). Only after the server has
//   saved the PUBLIC setting does a link exist and get shown.
// PUBLIC document  -> the link, copy / share buttons, and controls to
//   reset the link or make the document private again (confirmed).
// ==================================================================
export default function ShareDialog({ doc, onClose, onUpdated }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(null); // 'publish' | 'private' | 'reset'
  const [confirming, setConfirming] = useState(null); // 'private' | 'reset'
  const isPublic = doc.visibility === 'PUBLIC' && doc.shareUrl;

  const run = async (action, fn, successMessage) => {
    setBusy(action);
    try {
      const updated = await fn();
      onUpdated(updated);
      setConfirming(null);
      toast.success(successMessage);
    } catch (err) {
      showError(err, 'Changing who can see a document');
    } finally {
      setBusy(null);
    }
  };

  const preview = (
    <SharePreview
      filename={doc.filename}
      contentType={doc.contentType}
      kind={doc.kind}
      sizeLabel={doc.sizeLabel}
      imageUrl={doc.contentUrl}
      visibility={doc.visibility}
    />
  );

  if (!isPublic) {
    return (
      <Modal
        title="Share document"
        onClose={() => !busy && onClose()}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={!!busy}>Keep private</Button>
            <Button
              variant="primary"
              icon={Globe}
              disabled={!consent}
              loading={busy === 'publish'}
              onClick={() => run('publish', () => setVisibility(doc.uuid, 'PUBLIC'), 'Public link created')}
            >
              Create public link
            </Button>
          </>
        }
      >
        <div className="d-grid gap-3">
          {preview}
          <div className="ui-alert ui-alert-info">
            <Lock size={18} aria-hidden="true" />
            <div>This document is <strong>private</strong>. Only you can open it.</div>
          </div>
          <div className={'consent-box' + (consent ? ' is-public' : '')}>
            <label className="ui-check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                <span className="fw-semibold d-block">Share publicly</span>
                <span className="ui-small ui-muted">
                  Anyone who has the link will be able to view, download and print this document
                  <strong> without signing in</strong>. People you send it to can forward it.
                  You can make it private again at any time, which turns the link off.
                </span>
              </span>
            </label>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Share document" size="lg" onClose={() => !busy && onClose()}>
      <div className="d-grid gap-4">
        {preview}
        <ShareTargets url={doc.shareUrl} title={doc.filename} />

        <div className="ui-card ui-card-body" style={{ boxShadow: 'none' }}>
          <div className="ui-label mb-1">Who can access</div>
          <p className="ui-small ui-muted">
            <Globe size={14} className="me-1" aria-hidden="true" />
            Anyone with the link, without signing in. Your other documents and your account details are never visible through it.
          </p>

          {confirming === 'private' ? (
            <div className="ui-alert ui-alert-warning" role="alert">
              <div className="flex-grow-1">
                <strong>Make this document private?</strong>
                <div className="ui-small">The public link stops working immediately for everyone who has it.</div>
                <div className="d-flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="destructive" loading={busy === 'private'}
                    onClick={() => run('private', () => setVisibility(doc.uuid, 'PRIVATE'), 'Document is now private. The link no longer works.')}>
                    Make private
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={!!busy}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : confirming === 'reset' ? (
            <div className="ui-alert ui-alert-warning" role="alert">
              <div className="flex-grow-1">
                <strong>Create a new link?</strong>
                <div className="ui-small">The current link stops working. Only people you send the new link to can open the document.</div>
                <div className="d-flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="primary" loading={busy === 'reset'}
                    onClick={() => run('reset', () => resetShareLink(doc.uuid), 'New link created. The old link no longer works.')}>
                    Create new link
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={!!busy}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              <Button size="sm" variant="destructive-ghost" icon={Lock} onClick={() => setConfirming('private')}>
                Make private
              </Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setConfirming('reset')}>
                Reset link
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
