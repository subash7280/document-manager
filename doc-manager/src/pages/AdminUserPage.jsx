import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search, SearchX, UserX } from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { ADMIN_USER_DOCUMENTS } from '../graphql/operations';
import { downloadFile } from '../lib/documentActions';
import { reportError } from '../lib/errorReporting';
import { formatDate } from '../lib/format';
import { Avatar } from '../components/AppShell';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import FileIcon from '../components/FileIcon';
import VisibilityBadge from '../components/VisibilityBadge';
import { AdminBadge } from './AdminUsersPage';
import { SORTS } from './DrivePage';

const PAGE_SIZE = 25;
const TOP_LEVEL = 'Top level';

function Thumb({ doc }) {
  const [imageFailed, setImageFailed] = useState(false);
  return doc.kind === 'IMAGE' && !imageFailed
    ? <img src={doc.contentUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
    : <FileIcon contentType={doc.contentType} filename={doc.filename} size={18} showLabel={false} />;
}

// One document. "Open" uses the admin file route in a new tab: images,
// PDFs and text are shown, anything else is downloaded (server rule).
function AdminDocumentRow({ doc }) {
  const location = doc.folder?.name ?? TOP_LEVEL;
  return (
    <li className="doc-row has-location">
      <span className="doc-row-thumb" aria-hidden="true"><Thumb doc={doc} /></span>
      <div className="doc-row-main min-w-0">
        <a href={doc.contentUrl} target="_blank" rel="noopener noreferrer" className="doc-title" title={doc.filename}>{doc.filename}</a>
        <div className="doc-meta doc-row-meta-mobile">
          <span>{doc.sizeLabel}</span><span aria-hidden="true">·</span><span>{formatDate(doc.uploadedAt)}</span>
          {doc.visibility === 'PUBLIC' && <><span aria-hidden="true">·</span><span className="text-success">Public</span></>}
        </div>
      </div>
      <span className="doc-row-col text-truncate" title={location}>{location}</span>
      <span className="doc-row-col"><time dateTime={doc.uploadedAt}>{formatDate(doc.uploadedAt)}</time></span>
      <span className="doc-row-col">{doc.sizeLabel}</span>
      <span className="doc-row-col"><VisibilityBadge visibility={doc.visibility} /></span>
      <span>
        <Button size="sm" variant="ghost" iconOnly icon={Download} label={`Download ${doc.filename}`}
          onClick={() => downloadFile(doc.downloadUrl, doc.filename)} />
      </span>
    </li>
  );
}

// ==================================================================
// ADMIN: ONE USER'S DOCUMENTS (administrators only; see RequireAdmin)
// Every folder at once, with the folder shown per document. View and
// download only: the API gives admins no way to change them.
// ==================================================================
export default function AdminUserPage() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('q') ?? '',
    kind: params.get('kind') ?? '',
    visibility: params.get('visibility') ?? '',
    sort: params.get('sort') ?? 'NEWEST',
    page: Math.max(1, Number(params.get('page')) || 1)
  };
  const filtersKey = params.toString();
  const [searchText, setSearchText] = useState(filters.search);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const requestId = useRef(0);

  const updateParams = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value === '' || value == null || (key === 'page' && value === 1) || (key === 'sort' && value === 'NEWEST')) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoadError(null);
    try {
      const data = await graphqlRequest(ADMIN_USER_DOCUMENTS, {
        userId,
        page: filters.page,
        limit: PAGE_SIZE,
        search: filters.search || null,
        kind: filters.kind || null,
        visibility: filters.visibility || null,
        sort: filters.sort
      });
      if (id === requestId.current) setResult(data);
    } catch (err) {
      if (id !== requestId.current || err.code === 'UNAUTHENTICATED') return;
      setLoadError(err.message);
      reportError(err, "Loading a user's documents (admin)");
    }
  }, [userId, filtersKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (searchText.trim() === filters.search) return undefined;
    const timer = setTimeout(() => updateParams({ q: searchText.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const hasFilters = Boolean(filters.search || filters.kind || filters.visibility);
  const clearFilters = () => {
    setSearchText('');
    setParams({}, { replace: true });
  };
  const user = result?.user;
  const docs = result?.page.documents ?? [];
  const firstItem = (filters.page - 1) * PAGE_SIZE + 1;

  if (result && !user) {
    return (
      <div className="ui-card">
        <EmptyState icon={UserX} title="User not found" action={<Button variant="outline" icon={ArrowLeft} to="/admin">All users</Button>}>
          The account may have been deleted.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon={ArrowLeft} to="/admin" className="mb-3">All users</Button>
      <div className="page-header">
        <div className="admin-user-header min-w-0">
          {user && <Avatar user={user} large />}
          <div className="min-w-0">
            <h1 className="ui-h1 admin-user-name">
              <span className="text-truncate">{user ? (user.name || user.email || 'Unnamed user') : 'Loading…'}</span>
              {user?.isAdmin && <AdminBadge />}
            </h1>
            {user && (
              <p className="ui-muted mb-0 mt-1">
                {user.email || 'No email'} · {user.documentCount} {user.documentCount === 1 ? 'document' : 'documents'} · {user.storageLabel}
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>

      <div className="dash-toolbar" role="search">
        <div className="ui-input-icon">
          <Search size={17} aria-hidden="true" />
          <input type="search" className="ui-input" placeholder="Search this user's documents" aria-label="Search this user's documents by name"
            value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <select className="ui-select" aria-label="File type" value={filters.kind} onChange={(e) => updateParams({ kind: e.target.value, page: 1 })}>
          <option value="">All types</option>
          <option value="PDF">PDFs</option>
          <option value="IMAGE">Images</option>
          <option value="OTHER">Other files</option>
        </select>
        <select className="ui-select" aria-label="Visibility" value={filters.visibility} onChange={(e) => updateParams({ visibility: e.target.value, page: 1 })}>
          <option value="">Any visibility</option>
          <option value="PRIVATE">Private only</option>
          <option value="PUBLIC">Public only</option>
        </select>
        <select className="ui-select" aria-label="Sort by" value={filters.sort} onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loadError ? (
        <div className="ui-alert ui-alert-error" role="alert">
          <div className="flex-grow-1"><strong>Couldn't load the documents.</strong> {loadError}</div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={load}>Retry</Button>
        </div>
      ) : !result ? (
        <div className="ui-card ui-card-body d-grid gap-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-skeleton" style={{ height: 44 }} />)}
        </div>
      ) : docs.length === 0 ? (
        <div className="ui-card">
          {hasFilters
            ? <EmptyState icon={SearchX} title="No documents match" action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}>Try a different name or fewer filters.</EmptyState>
            : <EmptyState icon={FileText} title="No documents yet">This user hasn't uploaded anything.</EmptyState>}
        </div>
      ) : (
        <>
          <div className="ui-card doc-list">
            <div className="doc-row doc-row-head has-location" aria-hidden="true">
              <span /><span>Name</span><span>Folder</span><span>Uploaded</span><span>Size</span><span>Access</span><span />
            </div>
            <ul className="list-unstyled m-0" aria-live="polite">
              {docs.map((doc) => <AdminDocumentRow key={doc.uuid} doc={doc} />)}
            </ul>
          </div>
          {(filters.page > 1 || result.page.hasNextPage) && (
            <nav className="dash-pagination" aria-label="Pagination">
              <span className="ui-muted ui-small">Showing {firstItem}–{firstItem + docs.length - 1} of {result.page.total}</span>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline" icon={ChevronLeft} disabled={filters.page <= 1} onClick={() => updateParams({ page: filters.page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={!result.page.hasNextPage} onClick={() => updateParams({ page: filters.page + 1 })}>
                  Next <ChevronRight size={15} aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
