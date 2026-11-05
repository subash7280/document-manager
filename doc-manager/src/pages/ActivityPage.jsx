import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, CircleAlert, FileText, Folder, Globe, History, KeyRound, Monitor, RefreshCw, Search, SearchX,
  SlidersHorizontal, Smartphone, Tablet, UserRound
} from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { ACTIVITY_FILTER_OPTIONS, ACTIVITY_LOGS } from '../graphql/operations';
import { reportError } from '../lib/errorReporting';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';

const PAGE_SIZE = 25;

// ------------------------------------------------------------------
// WHAT EACH ACTION MEANS (the API sends enum values like DOCUMENT_MOVED)
// ------------------------------------------------------------------
const CATEGORIES = {
  AUTH: { label: 'Sign-in', icon: KeyRound },
  ACCOUNT: { label: 'Account', icon: UserRound },
  DOCUMENT: { label: 'Documents', icon: FileText },
  FOLDER: { label: 'Folders', icon: Folder },
  SHARING: { label: 'Sharing', icon: Globe }
};

export const ACTIONS = {
  SIGNED_UP: { category: 'AUTH', label: 'Account created' },
  SIGNED_IN: { category: 'AUTH', label: 'Signed in' },
  SIGNED_OUT: { category: 'AUTH', label: 'Signed out' },
  SIGNED_OUT_EVERYWHERE: { category: 'AUTH', label: 'Signed out of all devices' },
  ACCOUNT_LINKED: { category: 'ACCOUNT', label: 'Sign-in method connected' },
  ACCOUNT_UNLINKED: { category: 'ACCOUNT', label: 'Sign-in method disconnected' },
  PROFILE_UPDATED: { category: 'ACCOUNT', label: 'Profile updated' },
  DOCUMENT_UPLOADED: { category: 'DOCUMENT', label: 'Uploaded' },
  DOCUMENT_RENAMED: { category: 'DOCUMENT', label: 'Renamed' },
  DOCUMENT_MOVED: { category: 'DOCUMENT', label: 'Moved' },
  DOCUMENT_DELETED: { category: 'DOCUMENT', label: 'Deleted' },
  DOCUMENT_DOWNLOADED: { category: 'DOCUMENT', label: 'Downloaded' },
  DOCUMENT_MADE_PUBLIC: { category: 'SHARING', label: 'Shared publicly' },
  DOCUMENT_MADE_PRIVATE: { category: 'SHARING', label: 'Made private' },
  SHARE_LINK_RESET: { category: 'SHARING', label: 'Public link reset' },
  FOLDER_CREATED: { category: 'FOLDER', label: 'Folder created' },
  FOLDER_RENAMED: { category: 'FOLDER', label: 'Folder renamed' },
  FOLDER_MOVED: { category: 'FOLDER', label: 'Folder moved' },
  FOLDER_DELETED: { category: 'FOLDER', label: 'Folder deleted' }
};

const DEVICE_ICONS = { DESKTOP: Monitor, MOBILE: Smartphone, TABLET: Tablet, OTHER: Monitor };
const DEVICE_LABELS = { DESKTOP: 'Computer', MOBILE: 'Phone', TABLET: 'Tablet', OTHER: 'Other device' };

// What a FAILED action is called: Couldn't <verb> "name".
const FAILED = {
  ACCOUNT_LINKED: (e) => `Couldn't connect ${e.targetName ?? 'a'} sign-in`,
  ACCOUNT_UNLINKED: (e) => `Couldn't disconnect ${e.targetName ?? 'a'} sign-in`,
  PROFILE_UPDATED: () => "Couldn't update your profile",
  DOCUMENT_UPLOADED: (_e, name) => `Couldn't upload ${name}`,
  DOCUMENT_RENAMED: (_e, name) => `Couldn't rename ${name}`,
  DOCUMENT_MOVED: (_e, name) => `Couldn't move ${name}`,
  DOCUMENT_DELETED: (_e, name) => `Couldn't delete ${name}`,
  DOCUMENT_DOWNLOADED: (_e, name) => `Couldn't download ${name}`,
  DOCUMENT_MADE_PUBLIC: (_e, name) => `Couldn't share ${name} publicly`,
  DOCUMENT_MADE_PRIVATE: (_e, name) => `Couldn't make ${name} private`,
  SHARE_LINK_RESET: (_e, name) => `Couldn't reset the public link of ${name}`,
  FOLDER_CREATED: (_e, name) => `Couldn't create folder ${name}`,
  FOLDER_RENAMED: (_e, name) => `Couldn't rename folder ${name}`,
  FOLDER_MOVED: (_e, name) => `Couldn't move folder ${name}`,
  FOLDER_DELETED: (_e, name) => `Couldn't delete folder ${name}`
};

// One readable sentence per entry, e.g. Renamed "a.pdf" to "b.pdf".
export function describe(entry) {
  const name = entry.targetName ? `"${entry.targetName}"` : '';
  if (entry.status === 'FAILURE' && FAILED[entry.action]) return FAILED[entry.action](entry, name).trim();
  switch (entry.action) {
    case 'SIGNED_UP': return `Created your account with ${entry.targetName ?? 'a sign-in provider'}`;
    case 'SIGNED_IN': return `Signed in with ${entry.targetName ?? 'a sign-in provider'}`;
    case 'SIGNED_OUT': return 'Signed out';
    case 'SIGNED_OUT_EVERYWHERE': return 'Signed out of all devices';
    case 'ACCOUNT_LINKED': return `Connected ${entry.targetName ?? 'a'} sign-in`;
    case 'ACCOUNT_UNLINKED': return `Disconnected ${entry.targetName ?? 'a'} sign-in`;
    case 'PROFILE_UPDATED': return entry.to ? `Changed display name to "${entry.to}"` : 'Updated profile';
    case 'DOCUMENT_UPLOADED': return `Uploaded ${name}${entry.to ? ` to ${entry.to}` : ''}`;
    case 'DOCUMENT_RENAMED': return entry.from ? `Renamed "${entry.from}" to "${entry.to}"` : `Renamed ${name}`;
    case 'DOCUMENT_MOVED': return entry.from ? `Moved ${name} from ${entry.from} to ${entry.to}` : `Moved ${name}`;
    case 'DOCUMENT_DELETED': return `Deleted ${name}`;
    case 'DOCUMENT_DOWNLOADED': return `Downloaded ${name}`;
    case 'DOCUMENT_MADE_PUBLIC': return `Shared ${name} publicly`;
    case 'DOCUMENT_MADE_PRIVATE': return `Made ${name} private`;
    case 'SHARE_LINK_RESET': return `Reset the public link of ${name}`;
    case 'FOLDER_CREATED': return `Created folder ${name}${entry.to ? ` in ${entry.to}` : ''}`;
    case 'FOLDER_RENAMED': return entry.from ? `Renamed folder "${entry.from}" to "${entry.to}"` : `Renamed folder ${name}`;
    case 'FOLDER_MOVED': return entry.from ? `Moved folder ${name} from ${entry.from} to ${entry.to}` : `Moved folder ${name}`;
    case 'FOLDER_DELETED': return `Deleted folder ${name}`;
    default: return ACTIONS[entry.action]?.label ?? entry.action;
  }
}

const browserText = (c) => [c.browser, c.browserVersion].filter(Boolean).join(' ') || 'Unknown browser';
const systemText = (c) => [c.os, c.osVersion].filter(Boolean).join(' ') || 'unknown system';
const deviceText = (c) => [c.deviceVendor, c.deviceModel].filter(Boolean).join(' ') || DEVICE_LABELS[c.deviceType];

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// "Today", "Yesterday" or "Monday, 26 October 2026"
function dayLabel(date) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dayFormat.format(date);
}

// <input type="date"> gives "2026-10-28"; the API wants an exact
// moment. Start of that day / end of that day in the user's time zone.
const dayStart = (value) => (value ? new Date(`${value}T00:00:00`).toISOString() : null);
const dayEnd = (value) => (value ? new Date(`${value}T23:59:59.999`).toISOString() : null);

function ActivityEntry({ entry }) {
  const meta = ACTIONS[entry.action];
  const Icon = CATEGORIES[meta?.category ?? entry.category]?.icon ?? History;
  const DeviceIcon = DEVICE_ICONS[entry.client.deviceType] ?? Monitor;
  const failed = entry.status === 'FAILURE';
  const date = new Date(entry.createdAt);

  return (
    <li className={'activity-item' + (failed ? ' is-failed' : '')}>
      <span className="activity-icon" aria-hidden="true">{failed ? <CircleAlert size={18} /> : <Icon size={18} />}</span>
      <div className="min-w-0 flex-grow-1">
        <div className="activity-line">
          <span className="activity-text">{describe(entry)}</span>
          {failed && <span className="ui-badge ui-badge-failed">Failed</span>}
        </div>
        {failed && entry.error && <div className="activity-error">{entry.error}</div>}
        {entry.note && <div className="ui-small ui-muted">{entry.note}</div>}
        <div className="activity-meta">
          <DeviceIcon size={14} aria-hidden="true" />
          {browserText(entry.client)} on {systemText(entry.client)} · {deviceText(entry.client)}
        </div>
        <details className="activity-details">
          <summary>Details</summary>
          <dl>
            <dt>Time</dt><dd>{fullFormat.format(date)}</dd>
            <dt>Action</dt><dd>{meta?.label ?? entry.action} · {CATEGORIES[entry.category]?.label}</dd>
            <dt>Result</dt><dd>{failed ? 'Failed' : 'Succeeded'}</dd>
            <dt>Browser</dt><dd>{browserText(entry.client)}</dd>
            <dt>System</dt><dd>{systemText(entry.client)}</dd>
            <dt>Device</dt><dd>{DEVICE_LABELS[entry.client.deviceType]}{entry.client.deviceVendor || entry.client.deviceModel ? ` (${deviceText(entry.client)})` : ''}</dd>
            <dt>IP address</dt><dd>{entry.client.ip || 'Unknown'}</dd>
            <dt>User agent</dt><dd className="activity-ua">{entry.client.userAgent || 'None'}</dd>
          </dl>
        </details>
      </div>
      <time className="activity-time" dateTime={entry.createdAt} title={fullFormat.format(date)}>{timeFormat.format(date)}</time>
    </li>
  );
}

// ==================================================================
// ACTIVITY LOG PAGE - everything done in this account, newest first,
// with the browser and device each action came from.
// Filters live in the address bar, like on the Drive page.
// ==================================================================
export default function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('q') ?? '',
    type: params.get('type') ?? '', // "cat:DOCUMENT" or "act:DOCUMENT_MOVED"
    status: params.get('status') ?? '',
    device: params.get('device') ?? '',
    browser: params.get('browser') ?? '',
    os: params.get('os') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1)
  };
  const filtersKey = params.toString();
  const [searchText, setSearchText] = useState(filters.search);
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState({ browsers: [], operatingSystems: [] });
  const [loadError, setLoadError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
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
    const [kind, value] = filters.type.split(':');
    try {
      const data = await graphqlRequest(ACTIVITY_LOGS, {
        page: filters.page,
        limit: PAGE_SIZE,
        search: filters.search || null,
        category: kind === 'cat' ? value : null,
        action: kind === 'act' ? value : null,
        status: filters.status || null,
        deviceType: filters.device || null,
        browser: filters.browser || null,
        os: filters.os || null,
        from: dayStart(filters.from),
        to: dayEnd(filters.to)
      });
      if (id === requestId.current) setResult(data.activityLogs);
    } catch (err) {
      if (id !== requestId.current || err.code === 'UNAUTHENTICATED') return;
      setLoadError(err.message);
      reportError(err, 'Loading the activity log');
    }
  }, [filtersKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    graphqlRequest(ACTIVITY_FILTER_OPTIONS)
      .then((data) => setOptions(data.activityFilterOptions))
      .catch((err) => reportError(err, 'Loading activity filter options'));
  }, []);

  useEffect(() => {
    if (searchText.trim() === filters.search) return undefined;
    const timer = setTimeout(() => updateParams({ q: searchText.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const activeFilters = ['type', 'status', 'device', 'browser', 'os', 'from', 'to'].filter((key) => filters[key]).length;
  const hasFilters = Boolean(activeFilters || filters.search);
  const clearFilters = () => {
    setSearchText('');
    setParams({}, { replace: true });
  };

  // Group entries by day: [{ label: 'Today', entries: [...] }, ...]
  const groups = [];
  for (const entry of result?.entries ?? []) {
    const label = dayLabel(new Date(entry.createdAt));
    if (groups.at(-1)?.label !== label) groups.push({ label, entries: [] });
    groups.at(-1).entries.push(entry);
  }
  const firstItem = (filters.page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="ui-h1">Activity</h1>
          <p className="ui-muted mb-0 mt-1">Everything done in your account, with the browser and device it came from.</p>
        </div>
        <Button variant="outline" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>

      <div className="activity-filters" role="search">
        <div className="activity-filters-top">
          <div className="ui-input-icon flex-grow-1">
            <Search size={17} aria-hidden="true" />
            <input type="search" className="ui-input" placeholder="Search by document or folder name" aria-label="Search activity by name"
              value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          {/* Phones: the other filters fold away behind this button. */}
          <Button variant="outline" icon={SlidersHorizontal} className="activity-filters-toggle"
            aria-expanded={showFilters} aria-controls="activity-more-filters" onClick={() => setShowFilters((v) => !v)}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
        </div>
        <div id="activity-more-filters" className={'activity-filters-more' + (showFilters ? ' is-open' : '')}>
          <select className="ui-select" aria-label="Activity type" value={filters.type} onChange={(e) => updateParams({ type: e.target.value, page: 1 })}>
            <option value="">All activity</option>
            {Object.entries(CATEGORIES).map(([category, { label }]) => (
              <optgroup key={category} label={label}>
                <option value={`cat:${category}`}>All {label.toLowerCase()} activity</option>
                {Object.entries(ACTIONS).filter(([, a]) => a.category === category).map(([action, a]) => (
                  <option key={action} value={`act:${action}`}>{a.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select className="ui-select" aria-label="Result" value={filters.status} onChange={(e) => updateParams({ status: e.target.value, page: 1 })}>
            <option value="">Any result</option>
            <option value="SUCCESS">Succeeded</option>
            <option value="FAILURE">Failed</option>
          </select>
          <select className="ui-select" aria-label="Device" value={filters.device} onChange={(e) => updateParams({ device: e.target.value, page: 1 })}>
            <option value="">Any device</option>
            <option value="DESKTOP">Computer</option>
            <option value="MOBILE">Phone</option>
            <option value="TABLET">Tablet</option>
            <option value="OTHER">Other</option>
          </select>
          <select className="ui-select" aria-label="Browser" value={filters.browser} onChange={(e) => updateParams({ browser: e.target.value, page: 1 })}>
            <option value="">Any browser</option>
            {options.browsers.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="ui-select" aria-label="System" value={filters.os} onChange={(e) => updateParams({ os: e.target.value, page: 1 })}>
            <option value="">Any system</option>
            {options.operatingSystems.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <div className="activity-dates">
            <label className="activity-date">
              <span className="ui-small ui-muted">From</span>
              <input type="date" className="ui-input" value={filters.from} max={filters.to || undefined}
                onChange={(e) => updateParams({ from: e.target.value, page: 1 })} />
            </label>
            <label className="activity-date">
              <span className="ui-small ui-muted">To</span>
              <input type="date" className="ui-input" value={filters.to} min={filters.from || undefined}
                onChange={(e) => updateParams({ to: e.target.value, page: 1 })} />
            </label>
          </div>
          {hasFilters && <Button variant="ghost" onClick={clearFilters} className="activity-clear">Clear filters</Button>}
        </div>
      </div>

      {loadError ? (
        <div className="ui-alert ui-alert-error" role="alert">
          <div className="flex-grow-1"><strong>Couldn't load your activity.</strong> {loadError}</div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={load}>Retry</Button>
        </div>
      ) : !result ? (
        <div className="ui-card ui-card-body d-grid gap-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-skeleton" style={{ height: 44 }} />)}
        </div>
      ) : result.entries.length === 0 ? (
        <div className="ui-card">
          {hasFilters
            ? <EmptyState icon={SearchX} title="No activity matches" action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}>Try a wider date range or fewer filters.</EmptyState>
            : <EmptyState icon={History} title="No activity yet">Uploads, folders, sharing and sign-ins will show up here.</EmptyState>}
        </div>
      ) : (
        <>
          <p className="ui-small ui-muted mb-2">{result.total} {result.total === 1 ? 'entry' : 'entries'}</p>
          <div className="d-grid gap-4" aria-live="polite">
            {groups.map((group) => (
              <section key={group.label} className="ui-card" aria-label={group.label}>
                <h2 className="activity-day">{group.label}</h2>
                <ul className="list-unstyled m-0">
                  {group.entries.map((entry) => <ActivityEntry key={entry.id} entry={entry} />)}
                </ul>
              </section>
            ))}
          </div>
          {(filters.page > 1 || result.hasNextPage) && (
            <nav className="dash-pagination" aria-label="Pagination">
              <span className="ui-muted ui-small">Showing {firstItem}–{firstItem + result.entries.length - 1} of {result.total}</span>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline" icon={ChevronLeft} disabled={filters.page <= 1} onClick={() => updateParams({ page: filters.page - 1 })}>Previous</Button>
                <Button size="sm" variant="outline" disabled={!result.hasNextPage} onClick={() => updateParams({ page: filters.page + 1 })}>
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
