import AppConfig from '../models/AppConfig.js';

// ==================================================================
// READING "application_configs"
// The settings document is read from MongoDB and kept in memory for a
// minute, so changing it in the database (e.g. adding an email to
// exception_mail) takes effect within a minute, without a restart.
// ==================================================================

export const DEFAULT_APP_CONFIG = { app_name: 'Document Manager', exception_mail: [] };

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

let cache = null; // { value, loadedAt }

// Cleans up what was typed by hand: trims, drops empty/invalid
// addresses and duplicates.
export function normalizeAppConfig(doc) {
  const emails = Array.isArray(doc?.exception_mail) ? doc.exception_mail : [doc?.exception_mail];
  const exceptionMail = [...new Set(
    emails.filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e))
  )];
  return {
    appName: (typeof doc?.app_name === 'string' && doc.app_name.trim()) || DEFAULT_APP_CONFIG.app_name,
    exceptionMail,
    found: Boolean(doc)
  };
}

export async function getAppConfig({ maxAgeMs = 60 * 1000 } = {}) {
  if (cache && Date.now() - cache.loadedAt < maxAgeMs) return cache.value;
  const doc = await AppConfig.findOne().sort({ _id: 1 }).lean();
  const value = normalizeAppConfig(doc);
  cache = { value, loadedAt: Date.now() };
  return value;
}

export function clearAppConfigCache() {
  cache = null;
}
