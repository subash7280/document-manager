import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ChevronDown, ChevronLeft, ChevronRight, FolderOpen, FolderPlus, FolderX, Globe, LayoutGrid, List, Plus, RefreshCw,
  Search, SearchX, Upload
} from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { DRIVE_VIEW } from '../graphql/operations';
import { deleteDocument, resetShareLink, setVisibility } from '../lib/documentActions';
import { reportError, showError } from '../lib/errorReporting';
import { ROOT_NAME, deleteFolder, folderContents } from '../lib/folderActions';
import { copyText } from '../lib/share';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import { DocumentCard, DocumentRow, FolderCard, folderMenuItems, folderSummary } from '../components/DriveItems';
import EmptyState from '../components/EmptyState';
import FolderDialog from '../components/FolderDialog';
import Menu from '../components/Menu';
import MoveDialog from '../components/MoveDialog';
import RenameDialog from '../components/RenameDialog';
import ShareDialog from '../components/ShareDialog';

const PAGE_SIZE = 24;
export const SORTS = [
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'OLDEST', label: 'Oldest first' },
  { value: 'NAME_ASC', label: 'Name A–Z' },
  { value: 'NAME_DESC', label: 'Name Z–A' },
  { value: 'LARGEST', label: 'Largest first' }
];

// Grid or list, remembered on this device.
const VIEW_KEY = 'dm-view';
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
};

function SkeletonGrid() {
  return (
    <div className="dash-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="ui-card doc-card">
          <div className="doc-thumb ui-skeleton" style={{ borderRadius: 'var(--dm-radius-lg) var(--dm-radius-lg) 0 0' }} />
          <div className="doc-card-body">
            <div className="ui-skeleton" style={{ height: 16, width: '70%' }} />
            <div className="ui-skeleton" style={{ height: 12, width: '45%' }} />
            <div className="ui-skeleton" style={{ height: 30, width: '60%', marginTop: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// "New" button: new folder or upload into the folder being viewed.
function NewMenu({ onNewFolder, uploadPath }) {
  const navigate = useNavigate();
  return (
    <Menu
      label="Create"
      trigger={(props) => (
        <Button {...props} variant="primary" icon={Plus}>New <ChevronDown size={15} aria-hidden="true" /></Button>
      )}
      items={[
        { label: 'New folder', icon: FolderPlus, onSelect: onNewFolder },
        { label: 'Upload file', icon: Upload, onSelect: () => navigate(uploadPath) }
      ]}
    />
  );
}

// ==================================================================
// DRIVE - folders and documents, like Google Drive.
//   /                   -> top level ("My documents")
//   /folders/:folderId  -> inside a folder
//   /shared             -> every PUBLIC document, in any folder
// Typing in the search box searches ALL folders. Filters live in the
// address bar (?q=&kind=&visibility=&sort=&page=), so refresh and the
// back button keep them.
// ==================================================================
export default function DrivePage({ mode = 'folder' }) {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const shared = mode === 'shared';
  const filters = {
    search: params.get('q') ?? '',
    kind: params.get('kind') ?? '',
    visibility: shared ? 'PUBLIC' : params.get('visibility') ?? '',
    sort: params.get('sort') ?? 'NEWEST',
    page: Math.max(1, Number(params.get('page')) || 1)
  };
  const searching = Boolean(filters.search);
  const showFolders = !shared && !filters.kind && !params.get('visibility');
  const filtersKey = `${location.pathname}?${params.toString()}`;

  const [searchText, setSearchText] = useState(filters.search);
  const [view, setView] = useState(readView);
  const [result, setResult] = useState(null); // { folder, folders, docs, total, hasNextPage }
  const [loadError, setLoadError] = useState(null);
  const [dialog, setDialog] = useState(null); // { type, doc | folder, ... }
  const requestId = useRef(0);

  // Going to another folder starts with that folder's own (empty) search.
  useEffect(() => { setSearchText(params.get('q') ?? ''); }, [location.pathname]);

  const changeView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode: just not remembered */ }
  };

  const updateParams = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value === '' || value == null || (key === 'sort' && value === 'NEWEST') || (key === 'page' && value === 1)) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  // ONE GraphQL request per screen (see DRIVE_VIEW in operations.js).
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoadError(null);
    try {
      const data = await graphqlRequest(DRIVE_VIEW, {
        folderId: folderId ?? 'root',
        inFolder: Boolean(folderId) && !shared,
        showFolders,
        // Search and the Shared view look everywhere (null).
        scope: shared || searching ? null : folderId ?? 'root',
        page: filters.page,
        limit: PAGE_SIZE,
        search: filters.search || null,
        kind: filters.kind || null,
        visibility: filters.visibility || null,
        sort: filters.sort
      });
      if (id !== requestId.current) return; // a newer request is running
      setResult({
        folder: data.folder ?? null,
        folders: data.folders ?? [],
        docs: data.page.documents,
        total: data.page.total,
        hasNextPage: data.page.hasNextPage
      });
    } catch (err) {
      if (id !== requestId.current || err.code === 'UNAUTHENTICATED') return;
      setLoadError(err.message);
      reportError(err, 'Loading the documents page');
    }
  }, [filtersKey, folderId, shared]);

  useEffect(() => { load(); }, [load]);

  // Search as you type (after a short pause).
  useEffect(() => {
    if (searchText.trim() === filters.search) return undefined;
    const timer = setTimeout(() => updateParams({ q: searchText.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const replaceDoc = (updated) => {
    setResult((prev) => prev && { ...prev, docs: prev.docs.map((d) => (d.uuid === updated.uuid ? updated : d)) });
  };

  const onAction = async (type, item) => {
    if (type === 'open') return navigate(`/d/${item.uuid}`);
    if (type === 'openFolder') return navigate(`/folders/${item.id}`);
    if (type === 'print') return navigate(`/d/${item.uuid}?print=1`);
    if (type === 'copy') {
      return (await copyText(item.shareUrl)) ? toast.success('Public link copied') : toast.error('Could not copy the link.');
    }
    if (type === 'deleteFolder') {
      // Ask the server what is inside, so the dialog can say it.
      try {
        const contents = await folderContents(item.id);
        if (!contents) return load();
        return setDialog({ type, folder: item, contents });
      } catch (err) {
        return showError(err, 'Checking a folder before deleting it');
      }
    }
    if (['renameFolder', 'moveFolder'].includes(type)) return setDialog({ type, folder: item });
    setDialog({ type, doc: item });
  };

  const closeDialog = () => setDialog(null);
  const hasFilters = Boolean(filters.search || filters.kind || params.get('visibility'));
  const firstItem = (filters.page - 1) * PAGE_SIZE + 1;
  const current = result?.folder;
  const missingFolder = Boolean(folderId) && !shared && result && !current;
  const uploadPath = folderId && !shared ? `/upload?folder=${folderId}` : '/upload';
  const showLocation = shared || searching;
  const isEmpty = result && result.docs.length === 0 && (result.folders.length === 0 || !showFolders);

  // ---------------------------------------------------------------
  // HEADER: breadcrumb + title + the folder's own actions + "New"
  // ---------------------------------------------------------------
  let title = ROOT_NAME;
  if (shared) title = 'Shared publicly';
  else if (searching) title = 'Search results';
  else if (current) title = current.name;

  const header = (
    <div className="page-header drive-header">
      <div className="min-w-0">
        {current && !searching && (
          <nav aria-label="Folder path" className="breadcrumbs">
            <Link to="/">{ROOT_NAME}</Link>
            {current.path.map((p) => (
              <React.Fragment key={p.id}>
                <ChevronRight size={14} aria-hidden="true" />
                <Link to={`/folders/${p.id}`}>{p.name}</Link>
              </React.Fragment>
            ))}
            <ChevronRight size={14} aria-hidden="true" />
          </nav>
        )}
        <div className="d-flex align-items-center gap-1 min-w-0">
          <h1 className="ui-h1 text-truncate">{title}</h1>
          {current && !searching && (
            <Menu
              label={`Folder ${current.name}`}
              trigger={(props) => <Button {...props} size="sm" variant="ghost" iconOnly icon={ChevronDown} label={`Actions for folder ${current.name}`} />}
              items={[
                { label: 'New subfolder', icon: FolderPlus, onSelect: () => setDialog({ type: 'newFolder' }) },
                { label: 'Upload here', icon: Upload, onSelect: () => navigate(uploadPath) },
                { separator: true },
                ...folderMenuItems(current, (type) => onAction(type, current), { includeOpen: false })
              ]}
            />
          )}
        </div>
        <p className="ui-muted mb-0 mt-1">
          {shared
            ? 'Documents anyone with the link can open, from all your folders.'
            : searching
              ? `Matching "${filters.search}" in all folders`
              : current
                ? folderSummary(current)
                : 'Your private workspace. Create folders to keep documents organized.'}
        </p>
      </div>
      {!shared && <NewMenu onNewFolder={() => setDialog({ type: 'newFolder' })} uploadPath={uploadPath} />}
    </div>
  );

  if (missingFolder) {
    return (
      <div className="ui-card">
        <EmptyState icon={FolderX} title="This folder is not available"
          action={<Button variant="outline" to="/">Go to {ROOT_NAME}</Button>}>
          It may have been deleted or moved, or it belongs to a different account.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      {header}

      <div className={'dash-toolbar' + (shared ? ' dash-toolbar-shared' : '')} role="search">
        <div className="ui-input-icon">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            className="ui-input"
            placeholder={shared ? 'Search shared documents' : 'Search all folders'}
            aria-label={shared ? 'Search shared documents' : 'Search documents and folders by name'}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <select className="ui-select" aria-label="File type" value={filters.kind} onChange={(e) => updateParams({ kind: e.target.value, page: 1 })}>
          <option value="">All types</option>
          <option value="PDF">PDFs</option>
          <option value="IMAGE">Images</option>
          <option value="OTHER">Other files</option>
        </select>
        {!shared && (
          <select className="ui-select" aria-label="Visibility" value={params.get('visibility') ?? ''} onChange={(e) => updateParams({ visibility: e.target.value, page: 1 })}>
            <option value="">Any visibility</option>
            <option value="PRIVATE">Private only</option>
            <option value="PUBLIC">Public only</option>
          </select>
        )}
        <select className="ui-select" aria-label="Sort by" value={filters.sort} onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="ui-segmented view-toggle" role="radiogroup" aria-label="Layout">
          <input type="radio" id="view-grid" name="view" checked={view === 'grid'} onChange={() => changeView('grid')} />
          <label htmlFor="view-grid" title="Grid"><LayoutGrid size={16} aria-hidden="true" /><span className="visually-hidden">Grid</span></label>
          <input type="radio" id="view-list" name="view" checked={view === 'list'} onChange={() => changeView('list')} />
          <label htmlFor="view-list" title="List"><List size={16} aria-hidden="true" /><span className="visually-hidden">List</span></label>
        </div>
      </div>

      {loadError ? (
        <div className="ui-alert ui-alert-error" role="alert">
          <div className="flex-grow-1">
            <strong>Couldn't load your documents.</strong> {loadError}
          </div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={load}>Retry</Button>
        </div>
      ) : !result ? (
        <SkeletonGrid />
      ) : isEmpty ? (
        <div className="ui-card">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="Nothing matches"
              action={<Button variant="outline" onClick={() => { setSearchText(''); updateParams({ q: '', kind: '', visibility: '', page: 1 }); }}>Clear search and filters</Button>}>
              Try a different name, or show all types.
            </EmptyState>
          ) : shared ? (
            <EmptyState icon={Globe} title="Nothing is shared publicly">
              Documents you share publicly appear here, whichever folder they are in. Use Share on any document to create a public link.
            </EmptyState>
          ) : (
            <EmptyState icon={FolderOpen} title={current ? 'This folder is empty' : 'No documents yet'}
              action={(
                <div className="d-flex flex-wrap justify-content-center gap-2">
                  <Button variant="primary" icon={Upload} to={uploadPath}>Upload a document</Button>
                  <Button variant="outline" icon={FolderPlus} onClick={() => setDialog({ type: 'newFolder' })}>New folder</Button>
                </div>
              )}>
              {current
                ? 'Upload documents here, or create folders inside it.'
                : 'Create folders like "10th proofs" and "12th proofs", then upload documents into them. Everything stays private until you share it.'}
            </EmptyState>
          )}
        </div>
      ) : (
        <div aria-live="polite" className="d-grid gap-5">
          {showFolders && result.folders.length > 0 && (
            <section aria-labelledby="folders-heading">
              <h2 id="folders-heading" className="drive-section-title">Folders</h2>
              <div className="folder-grid">
                {result.folders.map((folder) => (
                  <FolderCard key={folder.id} folder={folder} onAction={onAction} showLocation={searching} />
                ))}
              </div>
            </section>
          )}

          {result.docs.length > 0 && (
            <section aria-labelledby="files-heading">
              <h2 id="files-heading" className="drive-section-title">{shared ? `${result.total} shared ${result.total === 1 ? 'document' : 'documents'}` : 'Files'}</h2>
              {view === 'grid' ? (
                <div className="dash-grid">
                  {result.docs.map((doc) => <DocumentCard key={doc.uuid} doc={doc} onAction={onAction} showLocation={showLocation} />)}
                </div>
              ) : (
                <div className="ui-card doc-list">
                  <div className={'doc-row doc-row-head' + (showLocation ? ' has-location' : '')} aria-hidden="true">
                    <span /><span>Name</span>{showLocation && <span>Folder</span>}<span>Uploaded</span><span>Size</span><span>Access</span><span />
                  </div>
                  <ul className={'list-unstyled m-0' + (showLocation ? ' has-location' : '')}>
                    {result.docs.map((doc) => <DocumentRow key={doc.uuid} doc={doc} onAction={onAction} showLocation={showLocation} />)}
                  </ul>
                </div>
              )}
              {(filters.page > 1 || result.hasNextPage) && (
                <nav className="dash-pagination" aria-label="Pagination">
                  <span className="ui-muted ui-small">
                    Showing {firstItem}–{firstItem + result.docs.length - 1} of {result.total}
                  </span>
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="outline" icon={ChevronLeft} disabled={filters.page <= 1} onClick={() => updateParams({ page: filters.page - 1 })}>
                      Previous
                    </Button>
                    <Button size="sm" variant="outline" disabled={!result.hasNextPage} onClick={() => updateParams({ page: filters.page + 1 })}>
                      Next <ChevronRight size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </nav>
              )}
            </section>
          )}
        </div>
      )}

      {/* ---------- FOLDER DIALOGS ---------- */}
      {dialog?.type === 'newFolder' && (
        <FolderDialog
          parentId={shared ? null : folderId ?? null}
          onClose={closeDialog}
          onSaved={(folder) => { toast.success(`Folder "${folder.name}" created`); load(); }}
        />
      )}
      {dialog?.type === 'renameFolder' && (
        <FolderDialog folder={dialog.folder} onClose={closeDialog} onSaved={() => { toast.success('Folder renamed'); load(); }} />
      )}
      {dialog?.type === 'moveFolder' && (
        <MoveDialog
          item={{ type: 'folder', id: dialog.folder.id, name: dialog.folder.name, folderId: dialog.folder.parentId }}
          onClose={closeDialog}
          onMoved={(_folder, to) => { toast.success(`Moved to ${to}`); load(); }}
        />
      )}
      {dialog?.type === 'deleteFolder' && (
        <ConfirmDialog
          title="Delete folder?"
          confirmLabel="Delete folder"
          destructive
          onClose={closeDialog}
          onConfirm={async () => {
            try {
              await deleteFolder(dialog.folder.id);
              toast.success(`Deleted folder "${dialog.folder.name}"`);
              // Deleting the folder being viewed goes up to its parent.
              if (dialog.folder.id === folderId) navigate(dialog.folder.parentId ? `/folders/${dialog.folder.parentId}` : '/', { replace: true });
              else load();
            } catch (err) {
              showError(err, 'Deleting a folder');
              throw err;
            }
          }}
        >
          <strong>{dialog.folder.name}</strong>
          {dialog.contents.folders + dialog.contents.documents === 0
            ? ' is empty and will be deleted.'
            : <> and everything inside it will be permanently deleted: <strong>{dialog.contents.folders} {dialog.contents.folders === 1 ? 'subfolder' : 'subfolders'}</strong> and <strong>{dialog.contents.documents} {dialog.contents.documents === 1 ? 'document' : 'documents'}</strong>. Public links to those documents stop working.</>}
          {' '}This cannot be undone.
        </ConfirmDialog>
      )}

      {/* ---------- DOCUMENT DIALOGS ---------- */}
      {dialog?.type === 'move' && (
        <MoveDialog
          item={{ type: 'document', id: dialog.doc.uuid, name: dialog.doc.filename, folderId: dialog.doc.folderId }}
          onClose={closeDialog}
          onMoved={(_doc, to) => { toast.success(`Moved to ${to}`); load(); }}
        />
      )}
      {dialog?.type === 'share' && (
        <ShareDialog
          doc={dialog.doc}
          onClose={closeDialog}
          onUpdated={(updated) => { replaceDoc(updated); setDialog({ type: 'share', doc: updated }); load(); }}
        />
      )}
      {dialog?.type === 'rename' && (
        <RenameDialog doc={dialog.doc} onClose={closeDialog} onRenamed={(updated) => { replaceDoc(updated); toast.success('Renamed'); }} />
      )}
      {dialog?.type === 'private' && (
        <ConfirmDialog
          title="Make document private?"
          confirmLabel="Make private"
          destructive
          onClose={closeDialog}
          onConfirm={async () => {
            try {
              replaceDoc(await setVisibility(dialog.doc.uuid, 'PRIVATE'));
              toast.success('Document is now private. The public link no longer works.');
              load();
            } catch (err) {
              showError(err, 'Making a document private');
              throw err;
            }
          }}
        >
          <strong>{dialog.doc.filename}</strong> will only be visible to you. Its public link stops working
          immediately for everyone who has it.
        </ConfirmDialog>
      )}
      {dialog?.type === 'reset' && (
        <ConfirmDialog
          title="Reset public link?"
          confirmLabel="Create new link"
          onClose={closeDialog}
          onConfirm={async () => {
            try {
              const updated = await resetShareLink(dialog.doc.uuid);
              replaceDoc(updated);
              const copied = await copyText(updated.shareUrl);
              toast.success(copied ? 'New link created and copied. The old link no longer works.' : 'New link created. The old link no longer works.');
            } catch (err) {
              showError(err, 'Resetting a public link');
              throw err;
            }
          }}
        >
          The current link for <strong>{dialog.doc.filename}</strong> stops working. Only people you send the new
          link to will be able to open it.
        </ConfirmDialog>
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete document?"
          confirmLabel="Delete"
          destructive
          onClose={closeDialog}
          onConfirm={async () => {
            try {
              await deleteDocument(dialog.doc.uuid);
              toast.success(`Deleted "${dialog.doc.filename}"`);
              // Deleting the last item of a page goes back one page.
              if (result.docs.length === 1 && filters.page > 1) updateParams({ page: filters.page - 1 });
              else load();
            } catch (err) {
              showError(err, 'Deleting a document');
              throw err;
            }
          }}
        >
          <strong>{dialog.doc.filename}</strong> will be permanently deleted
          {dialog.doc.visibility === 'PUBLIC' ? ', and its public link will stop working' : ''}. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}
