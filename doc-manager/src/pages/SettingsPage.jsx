import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Link2, LogOut, MonitorSmartphone, Unlink } from 'lucide-react';
import { graphqlRequest } from '../graphql/client';
import { UNLINK_ACCOUNT, UPDATE_PROFILE } from '../graphql/operations';
import { useAuth } from '../lib/auth';
import { useProviders } from '../lib/providers';
import { formatDate, providerLabel } from '../lib/format';
import { useTheme } from '../lib/theme';
import { showError } from '../lib/errorReporting';
import { Avatar } from '../components/AppShell';
import { ProviderLogo } from '../components/BrandIcons';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import { THEME_OPTIONS } from '../components/ThemeMenu';
import { authErrorMessage } from './SignInPage';

const PROVIDERS = ['GOOGLE', 'APPLE'];

export default function SettingsPage() {
  const { user, setUser, signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const enabledProviders = useProviders();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(user.name ?? '');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'unlink', provider } | { type: 'signout-all' }

  // Results of "Connect Google/Apple" come back as ?linked= or ?error=.
  // (That round trip reloads the app, so `user` is already up to date.)
  useEffect(() => {
    const linked = params.get('linked');
    const error = params.get('error');
    if (!linked && !error) return;
    if (linked) toast.success(`${providerLabel(linked)} is now connected`);
    if (error) toast.error(authErrorMessage(error, params.get('provider')), { duration: 6000 });
    setParams({}, { replace: true });
  }, []);

  const saveName = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await graphqlRequest(UPDATE_PROFILE, { name });
      setUser(data.updateProfile);
      toast.success('Profile saved');
    } catch (err) {
      showError(err, 'Saving the display name');
    } finally {
      setSaving(false);
    }
  };

  const linked = Object.fromEntries(user.linkedAccounts.map((a) => [a.provider, a]));
  // Show providers set up on the server, plus any already connected.
  const providers = PROVIDERS.filter((p) => linked[p] || enabledProviders?.includes(p.toLowerCase()));

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="ui-h1">Settings</h1>
          <p className="ui-muted mb-0 mt-1">Manage your profile, sign-in methods and appearance.</p>
        </div>
      </div>

      <div className="settings-stack">
        {/* PROFILE */}
        <section className="ui-card" aria-labelledby="profile-heading">
          <div className="ui-card-header"><h2 id="profile-heading" className="ui-h2">Profile</h2></div>
          <form className="ui-card-body d-grid gap-3" onSubmit={saveName}>
            <div className="d-flex align-items-center gap-3">
              <Avatar user={user} large />
              <div className="min-w-0">
                <div className="fw-semibold text-truncate">{user.name || 'No name yet'}</div>
                <div className="ui-small ui-muted text-truncate">{user.email || 'No email shared by your provider'}</div>
                {user.createdAt && <div className="ui-small ui-subtle">Member since {formatDate(user.createdAt)}</div>}
              </div>
            </div>
            <div>
              <label className="ui-label" htmlFor="profile-name">Display name</label>
              <div className="d-flex gap-2 flex-wrap">
                <input id="profile-name" className="ui-input flex-grow-1" style={{ maxWidth: 360 }} value={name} maxLength={100}
                  onChange={(e) => setName(e.target.value)} required />
                <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || name.trim() === user.name}>Save</Button>
              </div>
            </div>
          </form>
        </section>

        {/* SIGN-IN METHODS */}
        <section className="ui-card" aria-labelledby="methods-heading">
          <div className="ui-card-header">
            <h2 id="methods-heading" className="ui-h2">Sign-in methods</h2>
            {providers.length > 1 && (
              <p className="ui-small ui-muted mb-0 mt-1">
                Connect both to sign in either way. Connecting requires signing in to that account, which proves it is yours.
              </p>
            )}
          </div>
          <div className="ui-card-body py-2">
            {providers.map((provider) => {
              const account = linked[provider];
              const isLast = account && user.linkedAccounts.length === 1;
              return (
                <div className="settings-row" key={provider}>
                  <span className="provider-mark"><ProviderLogo provider={provider} size={20} /></span>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold">{providerLabel(provider)}</div>
                    <div className="ui-small ui-muted text-truncate">
                      {account ? `Connected${account.email ? ` · ${account.email}` : ''}` : 'Not connected'}
                    </div>
                  </div>
                  {account ? (
                    <Button size="sm" variant="ghost" icon={Unlink} disabled={isLast}
                      title={isLast ? 'You need at least one sign-in method' : undefined}
                      onClick={() => setConfirm({ type: 'unlink', provider })}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" icon={Link2}
                      href={`/auth/${provider.toLowerCase()}/start?intent=link&returnTo=${encodeURIComponent('/settings')}`}>
                      Connect
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* APPEARANCE */}
        <section className="ui-card" aria-labelledby="appearance-heading">
          <div className="ui-card-header"><h2 id="appearance-heading" className="ui-h2">Appearance</h2></div>
          <div className="ui-card-body">
            <div className="ui-segmented" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <React.Fragment key={value}>
                  <input type="radio" id={`theme-${value}`} name="theme" value={value} checked={preference === value} onChange={() => setPreference(value)} />
                  <label htmlFor={`theme-${value}`}><Icon size={15} aria-hidden="true" />{label}</label>
                </React.Fragment>
              ))}
            </div>
            <p className="ui-field-hint mb-0">Saved on this device. "System" follows your device's light or dark setting.</p>
          </div>
        </section>

        {/* SESSIONS */}
        <section className="ui-card" aria-labelledby="sessions-heading">
          <div className="ui-card-header"><h2 id="sessions-heading" className="ui-h2">Sessions</h2></div>
          <div className="ui-card-body d-flex flex-wrap gap-2">
            <Button variant="outline" icon={LogOut} onClick={async () => {
              try { await signOut(); navigate('/signin', { replace: true }); } catch (err) { showError(err, 'Signing out'); }
            }}>
              Sign out
            </Button>
            <Button variant="destructive-ghost" icon={MonitorSmartphone} onClick={() => setConfirm({ type: 'signout-all' })}>
              Sign out of all devices
            </Button>
          </div>
        </section>
      </div>

      {confirm?.type === 'unlink' && (
        <ConfirmDialog
          title={`Disconnect ${providerLabel(confirm.provider)}?`}
          confirmLabel="Disconnect"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              const data = await graphqlRequest(UNLINK_ACCOUNT, { provider: confirm.provider });
              setUser(data.unlinkAccount);
              toast.success(`${providerLabel(confirm.provider)} disconnected`);
            } catch (err) {
              showError(err, 'Disconnecting a sign-in method');
              throw err;
            }
          }}
        >
          You will no longer be able to sign in with {providerLabel(confirm.provider)}. Your documents are not affected.
        </ConfirmDialog>
      )}
      {confirm?.type === 'signout-all' && (
        <ConfirmDialog
          title="Sign out of all devices?"
          confirmLabel="Sign out everywhere"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await signOut({ everywhere: true });
              navigate('/signin', { replace: true });
            } catch (err) {
              showError(err, 'Signing out of all devices');
              throw err;
            }
          }}
        >
          Every browser and device signed in to your account, including this one, will be signed out.
        </ConfirmDialog>
      )}
    </>
  );
}
