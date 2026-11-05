import React from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { reportError } from '../lib/errorReporting';

// ==================================================================
// ERROR BOUNDARY - the app's last safety net.
// If a component crashes while drawing the page, React would show a
// blank screen. This catches it, shows a friendly message instead, and
// reports the error (with the component stack) for the exception email.
// It has to be a class: React only offers these two hooks to classes.
// ==================================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError(error, 'Showing the page (the page crashed)', { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-page">
        <div className="ui-card ui-card-body text-center d-grid gap-3 justify-items-center" style={{ maxWidth: 440 }}>
          <span className="ui-empty-icon" aria-hidden="true"><TriangleAlert size={26} /></span>
          <h1 className="ui-h2">Something went wrong</h1>
          <p className="ui-muted mb-0">The problem has been reported. Reloading the page usually fixes it.</p>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={17} aria-hidden="true" /> Reload
          </button>
        </div>
      </main>
    );
  }
}
