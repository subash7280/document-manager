import React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FileText, FolderOpen, Globe, History, LogOut, Settings, ShieldCheck, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { showError } from '../lib/errorReporting';
import { initials } from '../lib/format';
import Menu from './Menu';
import ThemeMenu from './ThemeMenu';

export function Avatar({ user, large = false }) {
  return (
    <span className={'shell-avatar' + (large ? ' shell-avatar-lg' : '')} aria-hidden="true">
      {user?.avatarUrl
        ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
        : initials(user?.name, user?.email)}
    </span>
  );
}

// The main places of the app. Shown as a sidebar on wide screens and as
// a bottom bar on phones (see .shell-sidebar / .shell-tabbar in app.css).
const NAV = [
  { to: '/', label: 'My documents', short: 'Documents', icon: FolderOpen, match: (path) => path === '/' || path.startsWith('/folders/') },
  { to: '/shared', label: 'Shared publicly', short: 'Shared', icon: Globe },
  { to: '/activity', label: 'Activity', short: 'Activity', icon: History },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
  // Only for users.isAdmin = true (the server checks it again).
  { to: '/admin', label: 'Admin', short: 'Admin', icon: ShieldCheck, adminOnly: true, match: (path) => path.startsWith('/admin/') }
];

function NavItems({ variant }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  return NAV.filter((item) => !item.adminOnly || user?.isAdmin).map(({ to, label, short, icon: Icon, match }) => (
    <NavLink
      key={to}
      to={to}
      end
      // "My documents" stays highlighted inside any folder.
      className={({ isActive }) => ((isActive || match?.(pathname)) ? 'active' : '')}
    >
      <Icon size={variant === 'tab' ? 20 : 18} aria-hidden="true" />
      <span>{variant === 'tab' ? short : label}</span>
    </NavLink>
  ));
}

// ==================================================================
// APP SHELL - header + navigation + page area for the private workspace.
// (The document viewer does NOT use it: it has no app branding.)
// ==================================================================
export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/signin', { replace: true });
    } catch (err) {
      showError(err, 'Signing out');
    }
  };

  return (
    <>
      <a href="#main" className="ui-skip-link">Skip to content</a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link to="/" className="shell-brand">
            <span className="shell-logo" aria-hidden="true"><FileText size={17} /></span>
            Doc Manager
          </Link>
          <div className="shell-spacer" />
          <ThemeMenu />
          <Menu
            label="Account"
            trigger={(props) => (
              <button {...props} type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label="Account menu" title="Account">
                <Avatar user={user} />
              </button>
            )}
            items={[
              { heading: user?.name || user?.email || 'Account' },
              { label: 'My documents', icon: FolderOpen, onSelect: () => navigate('/') },
              { label: 'Upload', icon: Upload, onSelect: () => navigate('/upload') },
              { label: 'Activity', icon: History, onSelect: () => navigate('/activity') },
              { label: 'Settings', icon: Settings, onSelect: () => navigate('/settings') },
              user?.isAdmin && { label: 'Admin', icon: ShieldCheck, onSelect: () => navigate('/admin') },
              { separator: true },
              { label: 'Sign out', icon: LogOut, onSelect: handleSignOut }
            ]}
          />
        </div>
      </header>

      <div className="shell-body">
        <nav className="shell-sidebar" aria-label="Main">
          <NavItems variant="side" />
        </nav>
        <main id="main" className="shell-main" tabIndex={-1}>
          <div className="shell-container">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="shell-tabbar" aria-label="Main">
        <NavItems variant="tab" />
      </nav>
    </>
  );
}
