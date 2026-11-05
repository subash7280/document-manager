import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorReporting';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './lib/auth';

// ==================================================================
// ENTRY POINT
//   BrowserRouter -> page addresses (/, /upload, /s/:token, ...)
//   ThemeProvider -> light / dark / system theme
//   AuthProvider  -> who is signed in (asked from the server)
//   Toaster       -> the one place where every toast appears
//   ErrorBoundary -> a friendly page (and an error report) if a page crashes
// ==================================================================
installGlobalErrorHandlers();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <Toaster
            position="top-center"
            toastOptions={{
              className: 'ui-toast',
              success: { iconTheme: { primary: 'var(--dm-success)', secondary: 'var(--dm-surface)' } },
              error: { iconTheme: { primary: 'var(--dm-danger)', secondary: 'var(--dm-surface)' } }
            }}
          />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
