import fs from 'node:fs';
import mongoose from 'mongoose';
import { getAppConfig } from './appConfig.js';
import { jobsStatus } from './jobs/index.js';

// ==================================================================
// HEALTH CHECK - GET /app/health-check (public, no sign-in)
// Answers "is the app working?" as JSON. Used by:
//   - the scheduled keep-alive job (services/jobs/index.js)
//   - Render's "Health Check Path" setting, uptime monitors, people
// HTTP 200 when everything needed to serve users works, 503 when not
// (the database is down), so monitors can rely on the status code.
//
// PUBLIC on purpose, so it reveals nothing secret: no database address,
// no email addresses, no keys - only up/down, timings and counts.
// ==================================================================

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const startedAt = new Date();

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

// Rejects if `promise` takes longer than `ms`.
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref())
]);

async function checkDatabase() {
  const state = DB_STATES[mongoose.connection.readyState] ?? 'unknown';
  if (state !== 'connected') return { status: 'down', state };
  const started = performance.now();
  try {
    await withTimeout(mongoose.connection.db.admin().ping(), 3000);
    return { status: 'up', state, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 'down', state, error: err.message };
  }
}

export async function checkHealth({ config, providers, mailer }) {
  const started = performance.now();
  const database = await checkDatabase();

  // application_configs is only readable when the database is up.
  let appConfig = null;
  if (database.status === 'up') {
    appConfig = await withTimeout(getAppConfig({ maxAgeMs: config.appConfigCacheMs }), 3000).catch(() => null);
  }

  const memory = process.memoryUsage();
  const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  const healthy = database.status === 'up';

  return {
    httpStatus: healthy ? 200 : 503,
    body: {
      status: healthy ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
      app: {
        name: appConfig?.appName ?? 'Document Manager',
        version: pkg.version,
        environment: config.isProduction ? 'production' : 'development',
        node: process.version,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: { rss: mb(memory.rss), heapUsed: mb(memory.heapUsed), heapTotal: mb(memory.heapTotal) }
      },
      checks: {
        api: { status: 'up' },
        database,
        appConfig: appConfig
          ? { status: appConfig.found ? 'up' : 'missing', exceptionRecipients: appConfig.exceptionMail.length }
          : { status: 'unknown' },
        email: { status: mailer ? 'configured' : 'not_configured' },
        signIn: { providers: Object.keys(providers) }
      },
      jobs: jobsStatus(),
      responseTimeMs: Math.round(performance.now() - started)
    }
  };
}
