import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, ExternalLink, FileQuestion, Printer, Share2 } from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { GET_DOCUMENT, GET_PUBLIC_DOCUMENT } from '../graphql/operations';
import { downloadFile } from '../lib/documentActions';
import { reportError } from '../lib/errorReporting';
import { fileAppearance, previewKind } from '../lib/files';
import Button from '../components/Button';
import FileIcon from '../components/FileIcon';
import Modal from '../components/Modal';
import ShareDialog, { SharePreview } from '../components/ShareDialog';
import ShareTargets from '../components/ShareTargets';
import { FullPageSpinner, Spinner } from '../components/Spinner';
import TextView from '../viewer/TextView';

// pdf.js is large, so it is only downloaded when a PDF is opened.
const PdfView = lazy(() => import('../viewer/PdfView'));

// ==================================================================
// STANDALONE DOCUMENT VIEWER
//   /s/:token  (mode "public") -> anyone, while the owner keeps it public
//   /d/:uuid   (mode "owner")  -> the signed-in owner only
// Deliberately WITHOUT the app's logo, name, navigation or dashboard:
// just the document and its View / Download / Print / Share actions.
// Printing hides the toolbar (see @media print in app.css).
// ==================================================================
export default function ViewerPage({ mode }) {
  const { uuid, token } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [contentReady, setContentReady] = useState(false);
  const [contentFailed, setContentFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const pdfRef = useRef(null);
  const isOwner = mode === 'owner';

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = isOwner
        ? (await graphqlRequest(GET_DOCUMENT, { uuid })).document
        : (await graphqlRequest(GET_PUBLIC_DOCUMENT, { token })).publicDocument;
      setDoc(data);
      setStatus(data ? 'ready' : 'missing');
    } catch (err) {
      if (err.code !== 'UNAUTHENTICATED') {
        setStatus('error');
        reportError(err, 'Opening a document in the viewer');
      }
    }
  }, [isOwner, uuid, token]);

  useEffect(() => { load(); }, [load]);

  // The browser tab shows the file name (no app name).
  useEffect(() => {
    const previous = document.title;
    document.title = doc?.filename || (status === 'missing' ? 'Document not available' : 'Document');
    return () => { document.title = previous; };
  }, [doc, status]);

  // ...and a neutral document icon instead of the app logo.
  useEffect(() => {
    const icon = document.getElementById('favicon');
    if (!icon) return undefined;
    const previous = icon.getAttribute('href');
    icon.setAttribute('href', '/favicon-document.svg');
    return () => icon.setAttribute('href', previous);
  }, []);

  const kind = doc ? previewKind(doc.contentType) : 'none';
  const canPrint = kind !== 'none' && !contentFailed;

  const print = useCallback(async () => {
    if (!canPrint) return;
    setPrinting(true);
    try {
      // PDF pages are drawn lazily; draw them all before printing.
      if (kind === 'pdf') await pdfRef.current?.renderAll();
      window.print();
    } finally {
      setPrinting(false);
    }
  }, [canPrint, kind]);

  // Opened with ?print=1 (the dashboard's Print action): print once ready.
  useEffect(() => {
    if (params.get('print') !== '1' || !contentReady) return;
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete('print'); return next; }, { replace: true });
    print();
  }, [contentReady]);

  if (status === 'loading') return <div className="viewer"><FullPageSpinner label="Loading document" /></div>;

  if (status === 'missing' || status === 'error') {
    return (
      <main className="viewer">
        <div className="viewer-message ui-card ui-card-body text-center d-grid gap-3 justify-items-center">
          <span className="ui-empty-icon mx-auto" aria-hidden="true"><FileQuestion size={26} /></span>
          <h1 className="ui-h2">{status === 'error' ? "Couldn't load this document" : 'This document is not available'}</h1>
          <p className="ui-muted mb-0">
            {status === 'error'
              ? 'Check your connection and try again.'
              : isOwner
                ? 'It may have been deleted, or it belongs to a different account.'
                : 'The link may be incorrect, or the owner may have stopped sharing it.'}
          </p>
          <div className="d-flex justify-content-center gap-2">
            {status === 'error' && <Button variant="primary" onClick={load}>Try again</Button>}
            {isOwner && <Button variant="outline" icon={ArrowLeft} onClick={() => navigate('/')}>Back to documents</Button>}
          </div>
        </div>
      </main>
    );
  }

  const look = fileAppearance(doc.contentType, doc.filename);
  const shareUrl = isOwner ? doc.shareUrl : `${window.location.origin}/s/${token}`;
  const onContentError = (err) => {
    setContentFailed(true);
    // (An <img> error has no Error object; pdf.js names HTTP errors itself.)
    const httpError = ['MissingPDFException', 'UnexpectedResponseException', 'ResponseException'].includes(err?.name);
    if (err instanceof Error && !httpError) reportError(err, `Displaying a ${kind} file in the viewer`);
    toast.error('This file could not be displayed. You can still download it.');
  };

  return (
    <div className="viewer">
      <header className="viewer-toolbar">
        {isOwner && (
          <Button variant="ghost" size="sm" iconOnly icon={ArrowLeft} label="Back to documents"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
        )}
        <div className="viewer-title">
          <h1 className="viewer-title-name m-0 fs-6" title={doc.filename}>{doc.filename}</h1>
          <div className="viewer-title-meta">{look.label} · {doc.sizeLabel}</div>
        </div>
        <div className="viewer-actions">
          {kind !== 'none' && (
            <Button size="sm" variant="ghost" icon={ExternalLink} href={doc.contentUrl} target="_blank" rel="noopener" title="Open the original file in a new tab">
              <span className="viewer-action-label">View</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadFile(doc.downloadUrl, doc.filename)} title="Download">
            <span className="viewer-action-label">Download</span>
          </Button>
          <Button size="sm" variant="ghost" icon={Printer} onClick={print} loading={printing} disabled={!canPrint || !contentReady}
            title={canPrint ? 'Print' : 'Printing is not available for this file type. Download it to print.'}>
            <span className="viewer-action-label">Print</span>
          </Button>
          <Button size="sm" variant="primary" icon={Share2} onClick={() => setSharing(true)} title="Share">
            <span className="viewer-action-label">Share</span>
          </Button>
        </div>
      </header>

      <main className="viewer-stage">
        {contentFailed || kind === 'none' ? (
          <div className="viewer-message ui-card ui-card-body text-center d-grid gap-3">
            <div className="mx-auto" style={{ width: 96, height: 96, borderRadius: 16, overflow: 'hidden' }}>
              <FileIcon contentType={doc.contentType} filename={doc.filename} size={34} />
            </div>
            <h2 className="ui-h2">{contentFailed ? 'This file could not be displayed' : `Preview isn't available for ${look.label} files`}</h2>
            <p className="ui-muted mb-0">Download it to open it with an app on your device.</p>
            <div><Button variant="primary" icon={Download} onClick={() => downloadFile(doc.downloadUrl, doc.filename)}>Download {doc.sizeLabel}</Button></div>
          </div>
        ) : kind === 'image' ? (
          <img className="viewer-image" src={doc.contentUrl} alt={doc.filename}
            onLoad={() => setContentReady(true)} onError={onContentError} />
        ) : kind === 'pdf' ? (
          <Suspense fallback={<div className="py-5"><Spinner size={28} label="Loading PDF viewer" /></div>}>
            <PdfView ref={pdfRef} url={doc.contentUrl} onReady={() => setContentReady(true)} onError={onContentError} />
          </Suspense>
        ) : (
          <TextView url={doc.contentUrl} onReady={() => setContentReady(true)} onError={onContentError} />
        )}
      </main>

      {sharing && isOwner && (
        <ShareDialog doc={doc} onClose={() => setSharing(false)} onUpdated={setDoc} />
      )}
      {sharing && !isOwner && (
        <Modal title="Share document" size="lg" onClose={() => setSharing(false)}>
          <div className="d-grid gap-4">
            <SharePreview filename={doc.filename} contentType={doc.contentType} kind={doc.kind} sizeLabel={doc.sizeLabel} imageUrl={doc.contentUrl} />
            <ShareTargets url={shareUrl} title={doc.filename} />
          </div>
        </Modal>
      )}
    </div>
  );
}
