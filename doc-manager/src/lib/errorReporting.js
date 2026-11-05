import toast from 'react-hot-toast';

// ==================================================================
// ERROR REPORTING (browser -> exception email)
// When an action fails in a catch block, the user sees a toast AND the
// error is sent to POST /api/client-errors, which emails the
// application_configs.exception_mail list with the browser and device.
//
// NOT sent (to avoid noise and duplicates):
//   - errors the SERVER answered with (error.fromServer): the server
//     already emailed the unexpected ones itself, and the rest are
//     normal answers like "A folder with this name already exists"
//   - network problems (error.code NETWORK) and cancelled uploads
//   - the same message twice from one page load
// ==================================================================

const sent = new Set();

export function shouldReport(error) {
  if (!error) return false;
  if (error.fromServer) return false;
  if (['NETWORK', 'CANCELLED', 'AbortError'].includes(error.code) || error.name === 'AbortError') return false;
  return true;
}

// action: what the user was doing, e.g. 'Moving a document'.
export function reportError(error, action, { componentStack } = {}) {
  if (!shouldReport(error)) return;
  const message = String(error?.message || error || 'Unknown error').slice(0, 1000);
  const key = `${action}|${message}`;
  if (sent.has(key)) return;
  sent.add(key);

  try {
    // keepalive: the report still goes out if the page is being left.
    fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        message,
        name: error?.name,
        stack: String(error?.stack || '').slice(0, 8000),
        componentStack: componentStack?.slice(0, 3000),
        page: window.location.pathname + window.location.search
      })
    }).catch(() => {});
  } catch {
    // Reporting must never break the page.
  }
}

// The usual catch block: tell the user, report if it was unexpected.
//   catch (err) { showError(err, 'Renaming a folder'); }
export function showError(error, action, options) {
  toast.error(error?.message || 'Something went wrong. Please try again.', options);
  reportError(error, action);
}

// Errors no catch block handled: a crash in an event handler or a
// promise nobody awaited. Installed once in main.jsx.
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    // Ignore errors from browser extensions and other sites' scripts.
    if (event.filename && !event.filename.startsWith(window.location.origin)) return;
    if (/ResizeObserver loop/.test(event.message)) return; // harmless browser warning
    reportError(event.error ?? new Error(event.message), 'Unhandled error in the page');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), 'Unhandled promise rejection in the page');
  });
}
