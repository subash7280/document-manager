import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, Download, EllipsisVertical, Eye, Folder, FolderInput, FolderOpen, Globe, Lock, Pencil, Printer, RefreshCw, Share2, Trash2
} from 'lucide-react';
import { downloadFile } from '../lib/documentActions';
import { ROOT_NAME } from '../lib/folderActions';
import { formatDate } from '../lib/format';
import Button from './Button';
import FileIcon from './FileIcon';
import Menu from './Menu';
import VisibilityBadge from './VisibilityBadge';

// ==================================================================
// DRIVE ITEMS - how folders and documents look on the Drive page.
//   FolderCard   -> a folder tile (click to open it)
//   DocumentCard -> a document with a thumbnail (grid view)
//   DocumentRow  -> a document as one compact line (list view)
// Every action is reported to the page with onAction(type, item).
// ==================================================================

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function folderSummary(folder) {
  const parts = [];
  if (folder.folderCount) parts.push(plural(folder.folderCount, 'folder', 'folders'));
  if (folder.documentCount) parts.push(plural(folder.documentCount, 'file', 'files'));
  return parts.join(' · ') || 'Empty';
}

// "Proofs › 10th" - where a folder lives (the top level is "My documents").
export const locationOf = (path) => (path.length ? path.map((p) => p.name).join(' › ') : ROOT_NAME);

export function folderMenuItems(folder, onAction, { includeOpen = true } = {}) {
  return [
    includeOpen && { label: 'Open', icon: FolderOpen, onSelect: () => onAction('openFolder', folder) },
    { label: 'Rename', icon: Pencil, onSelect: () => onAction('renameFolder', folder) },
    { label: 'Move to…', icon: FolderInput, onSelect: () => onAction('moveFolder', folder) },
    { separator: true },
    { label: 'Delete folder', icon: Trash2, danger: true, onSelect: () => onAction('deleteFolder', folder) }
  ];
}

export function FolderCard({ folder, onAction, showLocation }) {
  return (
    <article className="folder-card">
      <Link to={`/folders/${folder.id}`} className="folder-card-link" title={folder.name}>
        <span className="folder-card-icon" aria-hidden="true"><Folder size={22} fill="currentColor" fillOpacity={0.18} /></span>
        <span className="min-w-0">
          <span className="folder-card-name">{folder.name}</span>
          <span className="folder-card-meta">{showLocation ? `In ${locationOf(folder.path)}` : folderSummary(folder)}</span>
        </span>
      </Link>
      <Menu
        label={`Actions for folder ${folder.name}`}
        trigger={(props) => <Button {...props} size="sm" variant="ghost" iconOnly icon={EllipsisVertical} label={`More actions for folder ${folder.name}`} />}
        items={folderMenuItems(folder, onAction)}
      />
    </article>
  );
}

function documentMenuItems(doc, onAction, { compact }) {
  const isPublic = doc.visibility === 'PUBLIC';
  return [
    compact && { label: 'Open', icon: Eye, onSelect: () => onAction('open', doc) },
    compact && { label: 'Share', icon: Share2, onSelect: () => onAction('share', doc) },
    { label: 'Download', icon: Download, onSelect: () => downloadFile(doc.downloadUrl, doc.filename) },
    { label: 'Print', icon: Printer, onSelect: () => onAction('print', doc) },
    { label: 'Rename', icon: Pencil, onSelect: () => onAction('rename', doc) },
    { label: 'Move to…', icon: FolderInput, onSelect: () => onAction('move', doc) },
    { separator: true },
    isPublic && { label: 'Copy public link', icon: Copy, onSelect: () => onAction('copy', doc) },
    isPublic
      ? { label: 'Make private', icon: Lock, onSelect: () => onAction('private', doc) }
      : { label: 'Share publicly…', icon: Globe, onSelect: () => onAction('share', doc) },
    isPublic && { label: 'Reset public link', icon: RefreshCw, onSelect: () => onAction('reset', doc) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onAction('delete', doc) }
  ];
}

const docLocation = (doc) => (doc.folder ? doc.folder.name : ROOT_NAME);

function Thumb({ doc, size }) {
  const [imageFailed, setImageFailed] = useState(false);
  return doc.kind === 'IMAGE' && !imageFailed
    ? <img src={doc.contentUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
    : <FileIcon contentType={doc.contentType} filename={doc.filename} size={size} showLabel={size > 24} />;
}

export function DocumentCard({ doc, onAction, showLocation }) {
  const viewerPath = `/d/${doc.uuid}`;
  return (
    <article className="ui-card doc-card">
      <Link to={viewerPath} className="doc-thumb" tabIndex={-1} aria-hidden="true">
        <Thumb doc={doc} size={34} />
      </Link>
      <div className="doc-card-body">
        <Link to={viewerPath} className="doc-title" title={doc.filename}>{doc.filename}</Link>
        <div className="doc-meta">
          <span>{doc.sizeLabel}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={doc.uploadedAt} title={`Uploaded ${formatDate(doc.uploadedAt)}`}>{formatDate(doc.uploadedAt)}</time>
        </div>
        {showLocation && (
          <div className="doc-meta" title={`In ${docLocation(doc)}`}>
            <Folder size={13} aria-hidden="true" /><span className="text-truncate">{docLocation(doc)}</span>
          </div>
        )}
        <div><VisibilityBadge visibility={doc.visibility} /></div>
        <div className="doc-actions">
          <Button size="sm" variant="outline" icon={Eye} to={viewerPath}>Open</Button>
          <Button size="sm" variant="ghost" icon={Share2} onClick={() => onAction('share', doc)}>Share</Button>
          <Menu
            label={`Actions for ${doc.filename}`}
            trigger={(props) => <Button {...props} size="sm" variant="ghost" iconOnly icon={EllipsisVertical} label={`More actions for ${doc.filename}`} />}
            items={documentMenuItems(doc, onAction, { compact: false })}
          />
        </div>
      </div>
    </article>
  );
}

export function DocumentRow({ doc, onAction, showLocation }) {
  const viewerPath = `/d/${doc.uuid}`;
  return (
    <li className="doc-row">
      <span className="doc-row-thumb" aria-hidden="true"><Thumb doc={doc} size={18} /></span>
      <div className="doc-row-main min-w-0">
        <Link to={viewerPath} className="doc-title" title={doc.filename}>{doc.filename}</Link>
        <div className="doc-meta doc-row-meta-mobile">
          <span>{doc.sizeLabel}</span><span aria-hidden="true">·</span><span>{formatDate(doc.uploadedAt)}</span>
          {doc.visibility === 'PUBLIC' && <><span aria-hidden="true">·</span><span className="text-success">Public</span></>}
        </div>
      </div>
      {showLocation && <span className="doc-row-col text-truncate" title={docLocation(doc)}>{docLocation(doc)}</span>}
      <span className="doc-row-col"><time dateTime={doc.uploadedAt}>{formatDate(doc.uploadedAt)}</time></span>
      <span className="doc-row-col">{doc.sizeLabel}</span>
      <span className="doc-row-col"><VisibilityBadge visibility={doc.visibility} /></span>
      <span>
        <Menu
          label={`Actions for ${doc.filename}`}
          trigger={(props) => <Button {...props} size="sm" variant="ghost" iconOnly icon={EllipsisVertical} label={`Actions for ${doc.filename}`} />}
          items={documentMenuItems(doc, onAction, { compact: true })}
        />
      </span>
    </li>
  );
}
