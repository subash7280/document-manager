import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, FileText, Info, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useProviders } from '../lib/providers';
import { providerLabel } from '../lib/format';
import { AppleLogo, GoogleLogo } from '../components/BrandIcons';
import Button from '../components/Button';
import { FullPageSpinner, Spinner } from '../components/Spinner';
import ThemeMenu from '../components/ThemeMenu';

// Error codes sent back by the API's auth routes (?error=...).
export function authErrorMessage(code, provider) {
  const other = provider ? providerLabel(provider) : 'the method you used before';
  switch (code) {
    case 'cancelled': return 'Sign-in was cancelled. You can try again whenever you are ready.';
    case 'account_exists': return `An account with this email already exists. Continue with ${other} instead. You can then connect this sign-in method in Settings.`;
    case 'session_expired': return 'Your sign-in attempt expired or was started in another browser. Please try again.';
    case 'state_mismatch': return 'We could not verify the sign-in response. Please try again.';
    case 'provider_error': return 'The sign-in service did not respond as expected. Please try again in a moment.';
    case 'provider_unavailable': return 'That sign-in option is not available right now.';
    case 'signin_required': return 'Please sign in to continue.';
    case 'identity_in_use': return 'That account is already connected to a different Doc Manager account.';
    case 'provider_already_linked': return 'An account from that provider is already connected.';
    default: return code ? 'Something went wrong while signing in. Please try again.' : '';
  }
}

// Only same-site paths: "//evil.com" and "/\evil.com" would leave the site.
// (Same rule as safeReturnTo in doc-manager-api/auth/routes.js.)
export const safeReturnTo = (value) =>
  (value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/');

// ==================================================================
// SIGN IN / SIGN UP - one page for both.
// First time with Google or Apple -> the server creates the account.
// Same Google/Apple account again  -> the server signs into it.
// The buttons are plain links to the API: the whole OAuth exchange
// happens on the server; this page never sees a token.
// ==================================================================
export default function SignInPage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const providers = useProviders(); // null while loading
  const [redirecting, setRedirecting] = useState(null);
  const returnTo = safeReturnTo(params.get('returnTo'));
  const error = authErrorMessage(params.get('error'), params.get('provider'));

  // Coming back with the browser's back button must not leave a spinner.
  useEffect(() => {
    const onPageShow = () => setRedirecting(null);
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (status === 'loading') return <FullPageSpinner label="Checking your session" />;
  if (status === 'signedIn') return <Navigate to={returnTo} replace />;

  const start = (provider) => {
    setRedirecting(provider);
    window.location.assign(`/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`);
  };

  // Both buttons are always shown. A provider whose keys are not set on
  // the server yet is shown disabled, with a short note under it.
  const providerButton = (id, label, Logo) => {
    if (providers === null) return null;
    const available = providers.includes(id);
    return (
      <div className="d-grid gap-1">
        <Button
          variant="outline"
          className={`auth-provider-btn auth-${id}`}
          onClick={() => start(id)}
          disabled={!available || (redirecting && redirecting !== id)}
          loading={redirecting === id}
          aria-describedby={available ? undefined : `${id}-unavailable`}
        >
          {redirecting !== id && <Logo size={19} />}
          {redirecting === id ? `Redirecting to ${label}…` : `Continue with ${label}`}
        </Button>
        {!available && (
          <span id={`${id}-unavailable`} className="ui-small ui-subtle text-center">
            {label} sign-in is coming soon.
          </span>
        )}
      </div>
    );
  };

  return (
    <main className="auth-page">
      <div className="auth-top"><ThemeMenu /></div>
      <div className="auth-card">
        <div className="text-center mb-4">
          <span className="shell-logo mx-auto mb-3" style={{ width: 44, height: 44, borderRadius: 12 }} aria-hidden="true">
            <FileText size={22} />
          </span>
          <h1 className="ui-h1">Welcome to Doc Manager</h1>
          <p className="ui-muted mt-2 mb-0">Sign in or create your account. It takes one click.</p>
        </div>

        <div className="ui-card ui-card-body d-grid gap-3">
          {error && (
            <div className="ui-alert ui-alert-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}

          {providers === null && <div className="text-center py-2"><Spinner label="Loading sign-in options" /></div>}
          {providerButton('google', 'Google', GoogleLogo)}
          {providerButton('apple', 'Apple', AppleLogo)}

          {providers?.length === 0 && error === '' && (
            <div className="ui-alert ui-alert-info ui-small" role="status">
              <Info size={16} aria-hidden="true" />
              <div>Sign-in is not available yet. Please try again later.</div>
            </div>
          )}

          <p className="ui-small ui-muted text-center mb-0">
            New here? Your private workspace is created automatically the first time you continue.
          </p>
        </div>

        <p className="ui-small ui-muted text-center mt-4 d-flex align-items-start justify-content-center gap-2">
          <ShieldCheck size={16} className="flex-shrink-0 mt-1" aria-hidden="true" />
          <span>We never see your password. Your documents stay private unless you choose to share them.</span>
        </p>
      </div>
    </main>
  );
}
