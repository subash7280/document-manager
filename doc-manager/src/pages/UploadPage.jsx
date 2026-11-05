import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertCircle, ArrowLeft, Check, CloudUpload, Eye, FolderOpen, Globe, Lock, RefreshCw, Upload, X } from 'lucide-react';
import { newUploadId, uploadDocument } from '../graphql/upload';
import { setVisibility } from '../lib/documentActions';
import { reportError } from '../lib/errorReporting';
import { ROOT_NAME, flattenTree, loadFolderTree } from '../lib/folderActions';
import { ACCEPT_ATTRIBUTE, formatBytes, fileAppearance, validateFile } from '../lib/files';
import Button from '../components/Button';
import FileIcon from '../components/FileIcon';
import ShareTargets from '../components/ShareTargets';

// ==================================================================
// UPLOAD PAGE
// Steps: choose a file -> choose the folder ("Save to") -> (optional)
// consent to share publicly -> upload with progress -> result.
// /upload?folder=<id> starts with that folder chosen (the Drive page's
// "Upload here" links there).
//
// PRIVACY ORDER: the file is ALWAYS uploaded as private first. Only
// after the upload has succeeded, and only if "Share publicly" was
// ticked, is a second request sent to make it public. If that second
// step fails, the document simply stays private.
// ==================================================================
export default function UploadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [folderId, setFolderId] = useState(params.get('folder') ?? '');
  const [folderRows, setFolderRows] = useState(null); // [{ folder, depth }]
  const inputRef = useRef(null);
  const uploadRef = useRef(null); // the running upload (to cancel)

  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [sharePublicly, setSharePublicly] = useState(false); // unchecked by default
  const [dragging, setDragging] = useState(false);
  // idle | uploading | publishing | done | failed
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [doc, setDoc] = useState(null);
  // One id per chosen file: retrying the same file reuses it, so the
  // server can never store it twice.
  const uploadIdRef = useRef(null);

  const busy = phase === 'uploading' || phase === 'publishing';

  // Local preview for images (released when no longer needed).
  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || fileError) return setPreviewUrl(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, fileError]);

  // Warn before leaving the page in the middle of an upload.
  useEffect(() => {
    if (!busy) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);

  // Cancel a running upload when the page is left.
  useEffect(() => () => uploadRef.current?.cancel(), []);

  // Folders for the "Save to" list.
  useEffect(() => {
    loadFolderTree()
      .then((folders) => {
        const rows = flattenTree(folders);
        setFolderRows(rows);
        // A folder from the address that no longer exists -> top level.
        setFolderId((id) => (rows.some((r) => r.folder.id === id) ? id : ''));
      })
      .catch((err) => {
        setFolderRows([]);
        reportError(err, 'Loading folders on the upload page');
      });
  }, []);

  const folderPath = folderId ? `/folders/${folderId}` : '/';
  const folderLabel = folderRows?.find((r) => r.folder.id === folderId)?.folder.name ?? ROOT_NAME;

  const chooseFile = (chosen) => {
    if (!chosen || busy) return;
    setFile(chosen);
    setFileError(validateFile(chosen) ?? '');
    setError('');
    setPhase('idle');
    setProgress(0);
    uploadIdRef.current = newUploadId();
  };

  const reset = () => {
    setFile(null);
    setFileError('');
    setSharePublicly(false);
    setPhase('idle');
    setProgress(0);
    setError('');
    setPublishError('');
    setDoc(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const publish = async (uploaded) => {
    setPhase('publishing');
    setPublishError('');
    try {
      setDoc(await setVisibility(uploaded.uuid, 'PUBLIC'));
      toast.success('Uploaded and shared publicly');
    } catch (err) {
      setPublishError(err.message);
      reportError(err, 'Sharing a document right after upload');
    }
    setPhase('done');
  };

  const start = async () => {
    // Guard against double clicks: only one upload at a time.
    if (busy || !file || fileError) return;
    setPhase('uploading');
    setError('');
    setProgress(0);

    const upload = uploadDocument(file, uploadIdRef.current, { folderId: folderId || null, onProgress: setProgress });
    uploadRef.current = upload;
    try {
      const uploaded = await upload.promise;
      setDoc(uploaded);
      setProgress(1);
      if (sharePublicly) {
        await publish(uploaded);
      } else {
        setPhase('done');
        toast.success('Uploaded as a private document');
      }
    } catch (err) {
      if (err.code === 'CANCELLED') {
        setPhase('idle');
        setProgress(0);
        toast('Upload cancelled');
      } else {
        setError(err.message);
        setPhase('failed');
        reportError(err, 'Uploading a document');
      }
    } finally {
      uploadRef.current = null;
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const dropped = e.dataTransfer.files;
    if (dropped.length > 1) toast('Only one file at a time. Using the first one.');
    chooseFile(dropped[0]);
  };

  // ---------------------------------------------------------------
  // RESULT
  // ---------------------------------------------------------------
  if (phase === 'done' && doc) {
    const isPublic = doc.visibility === 'PUBLIC';
    return (
      <div className="upload-layout">
        <div className="ui-card ui-card-body d-grid gap-4">
          <div className="d-flex align-items-center gap-3">
            <span className="ui-result-icon" aria-hidden="true"><Check size={28} /></span>
            <div className="min-w-0">
              <h1 className="ui-h2">Upload complete</h1>
              <div className="ui-muted text-truncate">{doc.filename} · {doc.sizeLabel} · in {folderLabel}</div>
            </div>
          </div>

          {publishError ? (
            <div className="ui-alert ui-alert-warning" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div className="flex-grow-1">
                <strong>Your document is uploaded and private.</strong> We couldn't make it public: {publishError}
                <div className="mt-2">
                  <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => publish(doc)}>Try again</Button>
                </div>
              </div>
            </div>
          ) : isPublic ? (
            <>
              <div className="ui-alert ui-alert-success">
                <Globe size={18} aria-hidden="true" />
                <div>Shared publicly. Anyone with the link can view it without signing in.</div>
              </div>
              <ShareTargets url={doc.shareUrl} title={doc.filename} />
            </>
          ) : (
            <div className="ui-alert ui-alert-info">
              <Lock size={18} aria-hidden="true" />
              <div>This document is private. Only you can open it. You can share it later from your documents.</div>
            </div>
          )}

          <div className="d-flex flex-wrap gap-2">
            <Button variant="primary" icon={Eye} to={`/d/${doc.uuid}`}>Open document</Button>
            <Button variant="outline" icon={Upload} onClick={reset}>Upload another</Button>
            <Button variant="ghost" icon={FolderOpen} to={folderPath}>Open {folderLabel}</Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // FORM
  // ---------------------------------------------------------------
  const look = file ? fileAppearance(file.type, file.name) : null;
  return (
    <div className="upload-layout">
      <div className="page-header">
        <div>
          <Link to={folderPath} className="ui-small ui-muted text-decoration-none d-inline-flex align-items-center gap-1 mb-2">
            <ArrowLeft size={14} aria-hidden="true" /> {folderLabel}
          </Link>
          <h1 className="ui-h1">Upload a document</h1>
          <p className="ui-muted mb-0 mt-1">PDFs, images, text and Office files up to 20 MB.</p>
        </div>
      </div>

      <div className="ui-card ui-card-body d-grid gap-4">
        {/* DROP ZONE: drag a file here, or use the button (keyboard friendly). */}
        <div
          className={'dropzone' + (dragging ? ' is-dragging' : '')}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={onDrop}
        >
          <span className="dropzone-icon" aria-hidden="true"><CloudUpload size={26} /></span>
          <div>
            <div className="fw-semibold">{dragging ? 'Drop to choose this file' : 'Drag and drop a file here'}</div>
            <div className="ui-small ui-muted">or</div>
          </div>
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="visually-hidden"
            accept={ACCEPT_ATTRIBUTE}
            onChange={(e) => chooseFile(e.target.files?.[0])}
            tabIndex={-1}
            aria-hidden="true"
          />
          <div className="ui-small ui-subtle">PDF, PNG, JPG, GIF, WebP, SVG, TXT, MD, CSV, JSON, RTF, Word, Excel, PowerPoint, OpenDocument, ZIP · max 20 MB</div>
        </div>

        {file && (
          <div>
            <div className="file-row">
              <span className="file-row-thumb">
                {previewUrl ? <img src={previewUrl} alt="" /> : <FileIcon contentType={file.type} filename={file.name} size={22} showLabel={false} />}
              </span>
              <div className="file-row-info">
                <div className="file-row-name" title={file.name}>{file.name}</div>
                <div className="ui-small ui-muted">{look.label} · {formatBytes(file.size)}</div>
              </div>
              {!busy && <Button size="sm" variant="ghost" iconOnly icon={X} label="Remove file" onClick={reset} />}
            </div>
            {fileError && <div className="ui-field-error" role="alert">{fileError}</div>}
          </div>
        )}

        {/* WHERE TO SAVE IT */}
        <div>
          <label className="ui-label" htmlFor="upload-folder">Save to</label>
          <select id="upload-folder" className="ui-select" value={folderId} disabled={busy || folderRows === null}
            onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{ROOT_NAME}</option>
            {folderRows?.map(({ folder, depth }) => (
              // Non-breaking spaces indent subfolders under their parent.
              <option key={folder.id} value={folder.id}>{'   '.repeat(depth + 1)}{folder.name}</option>
            ))}
          </select>
        </div>

        {/* VISIBILITY: explicit consent, unchecked by default. */}
        <fieldset disabled={busy}>
          <legend className="ui-label">Who can see this document?</legend>
          <div className={'consent-box' + (sharePublicly ? ' is-public' : '')}>
            <label className="ui-check">
              <input type="checkbox" checked={sharePublicly} onChange={(e) => setSharePublicly(e.target.checked)} aria-describedby="visibility-help" />
              <span>
                <span className="fw-semibold d-block">Share publicly</span>
                <span id="visibility-help" className="ui-small ui-muted d-block">
                  {sharePublicly ? (
                    <>
                      <Globe size={13} className="me-1" aria-hidden="true" />
                      <strong>Public:</strong> anyone who has the link can view, download and print it without signing in.
                      The link is created after the upload finishes. You can make it private again later.
                    </>
                  ) : (
                    <>
                      <Lock size={13} className="me-1" aria-hidden="true" />
                      <strong>Private:</strong> only you can open this document. You can share it later.
                    </>
                  )}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {phase === 'failed' && (
          <div className="ui-alert ui-alert-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="flex-grow-1">
              <strong>Upload failed.</strong> {error}
              <div className="ui-small ui-muted">Nothing was shared. Retrying will not create a duplicate.</div>
            </div>
          </div>
        )}

        {busy && (
          <div aria-live="polite">
            <div className="d-flex justify-content-between ui-small mb-2">
              <span>{phase === 'publishing' ? 'Creating public link…' : progress >= 1 ? 'Processing…' : 'Uploading…'}</span>
              <span className="ui-muted">{Math.round(progress * 100)}%</span>
            </div>
            <div className="ui-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="ui-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="d-flex flex-wrap gap-2 justify-content-end">
          {phase === 'uploading' ? (
            <Button variant="outline" icon={X} onClick={() => uploadRef.current?.cancel()}>Cancel upload</Button>
          ) : (
            <Button variant="ghost" onClick={() => navigate(folderPath)} disabled={busy}>Cancel</Button>
          )}
          <Button
            variant="primary"
            icon={phase === 'failed' ? RefreshCw : Upload}
            onClick={start}
            disabled={!file || !!fileError}
            loading={busy}
          >
            {phase === 'failed' ? 'Try again' : sharePublicly ? 'Upload and share' : 'Upload'}
          </Button>
        </div>
      </div>
    </div>
  );
}
