import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RefreshCw, Search, SearchX, ShieldCheck, Users } from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { ADMIN_USERS } from '../graphql/operations';
import { reportError } from '../lib/errorReporting';
import { formatDate } from '../lib/format';
import { Avatar } from '../components/AppShell';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';

const PAGE_SIZE = 25;

const documentsText = (user) => `${user.documentCount} ${user.documentCount === 1 ? 'document' : 'documents'} · ${user.storageLabel}`;

export function AdminBadge() {
  return (
    <span className="ui-badge ui-badge-admin">
      <ShieldCheck size={12} aria-hidden="true" />
      Admin
    </span>
  );
}

function UserRow({ user }) {
  const lastSignIn = user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never';
  return (
    <li>
      <Link to={`/admin/users/${user.id}`} className="admin-user-row">
        <Avatar user={user} />
        <span className="min-w-0">
          <span className="admin-user-name">
            <span className="text-truncate">{user.name || user.email || 'Unnamed user'}</span>
            {user.isAdmin && <AdminBadge />}
          </span>
          <span className="admin-user-meta text-truncate">{user.email || 'No email'}</span>
          <span className="admin-user-meta admin-user-meta-mobile">{documentsText(user)}</span>
        </span>
        <span className="admin-user-col">{documentsText(user)}</span>
        <span className="admin-user-col" title={`Joined ${formatDate(user.createdAt)}`}>{lastSignIn}</span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}

// ==================================================================
// ADMIN: EVERY USER (administrators only; see RequireAdmin)
// Click a user to see their documents (AdminUserPage).
// Search and page live in the address bar, like on the Drive page.
// ==================================================================
export default function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [searchText, setSearchText] = useState(search);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const requestId = useRef(0);

  const updateParams = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value === '' || value == null || (key === 'page' && value === 1)) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoadError(null);
    try {
      const data = await graphqlRequest(ADMIN_USERS, { page, limit: PAGE_SIZE, search: search || null });
      if (id === requestId.current) setResult(data.adminUsers);
    } catch (err) {
      if (id !== requestId.current || err.code === 'UNAUTHENTICATED') return;
      setLoadError(err.message);
      reportError(err, 'Loading the admin user list');
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (searchText.trim() === search) return undefined;
    const timer = setTimeout(() => updateParams({ q: searchText.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const firstItem = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="ui-h1">Admin</h1>
          <p className="ui-muted mb-0 mt-1">Every user and the documents they uploaded. View only: changes stay with each owner.</p>
        </div>
        <Button variant="outline" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>

      <div className="ui-input-icon mb-4" role="search">
        <Search size={17} aria-hidden="true" />
        <input type="search" className="ui-input" placeholder="Search users by name or email" aria-label="Search users by name or email"
          value={searchText} onChange={(e) => setSearchText(e.target.value)} />
      </div>

      {loadError ? (
        <div className="ui-alert ui-alert-error" role="alert">
          <div className="flex-grow-1"><strong>Couldn't load the users.</strong> {loadError}</div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={load}>Retry</Button>
        </div>
      ) : !result ? (
        <div className="ui-card ui-card-body d-grid gap-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-skeleton" style={{ height: 44 }} />)}
        </div>
      ) : result.users.length === 0 ? (
        <div className="ui-card">
          {search
            ? <EmptyState icon={SearchX} title="No users match" action={<Button variant="outline" onClick={() => setSearchText('')}>Clear search</Button>}>Try part of the name or email.</EmptyState>
            : <EmptyState icon={Users} title="No users yet">People appear here after they sign in for the first time.</EmptyState>}
        </div>
      ) : (
        <>
          <p className="ui-small ui-muted mb-2">{result.total} {result.total === 1 ? 'user' : 'users'}</p>
          <div className="ui-card admin-list">
            <div className="admin-user-row admin-user-head" aria-hidden="true">
              <span /><span>User</span><span className="admin-user-col">Documents</span><span className="admin-user-col">Last sign-in</span><span />
            </div>
            <ul className="list-unstyled m-0" aria-live="polite">
              {result.users.map((user) => <UserRow key={user.id} user={user} />)}
            </ul>
          </div>
          {(page > 1 || result.hasNextPage) && (
            <nav className="dash-pagination" aria-label="Pagination">
              <span className="ui-muted ui-small">Showing {firstItem}–{firstItem + result.users.length - 1} of {result.total}</span>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline" icon={ChevronLeft} disabled={page <= 1} onClick={() => updateParams({ page: page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={!result.hasNextPage} onClick={() => updateParams({ page: page + 1 })}>
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
