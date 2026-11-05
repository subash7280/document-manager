import React from 'react';
import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { RequireAdmin, RequireAuth } from './lib/auth';
import ActivityPage from './pages/ActivityPage';
import AdminUserPage from './pages/AdminUserPage';
import AdminUsersPage from './pages/AdminUsersPage';
import DrivePage from './pages/DrivePage';
import NotFoundPage from './pages/NotFoundPage';
import SettingsPage from './pages/SettingsPage';
import SignInPage from './pages/SignInPage';
import UploadPage from './pages/UploadPage';
import ViewerPage from './pages/ViewerPage';

// ==================================================================
// ROUTES
//   /signin              one page for both sign-in and sign-up
//   /s/:token            PUBLIC viewer: no sign-in, no app branding
//   /d/:uuid             the owner's viewer: sign-in required, no app branding
//   /                    My documents (top level)        } the private
//   /folders/:folderId   inside a folder                 } workspace,
//   /shared              every public document           } inside
//   /activity            the activity log                } AppShell
//   /upload, /settings
//   /admin               every user (administrators only)
//   /admin/users/:userId one user's documents (administrators only)
// The server enforces every rule again; these routes only decide
// which page to show.
// ==================================================================
export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/s/:token" element={<ViewerPage mode="public" />} />

      <Route element={<RequireAuth />}>
        <Route path="/d/:uuid" element={<ViewerPage mode="owner" />} />
        <Route element={<AppShell />}>
          <Route index element={<DrivePage />} />
          <Route path="folders/:folderId" element={<DrivePage />} />
          <Route path="shared" element={<DrivePage mode="shared" />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminUsersPage />} />
            <Route path="admin/users/:userId" element={<AdminUserPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
