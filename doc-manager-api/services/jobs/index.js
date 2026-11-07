// ==================================================================
// SCHEDULED JOBS
// Started once by index.js when the server starts (never in tests).
//
// KEEP-ALIVE HEALTH CHECK
// Calls our own public GET /app/health-check on a timer: by default
// every 8 hours, at 00:00, 08:00 and 16:00 UTC (three times a day).
//   - It confirms the app AND the database still work, and emails the
//     exception_mail list (services/exceptions.js) when they do not.
//   - The request goes to the PUBLIC address (RENDER_EXTERNAL_URL on
//     Render), so it counts as real traffic to the service.
//
// IMPORTANT ABOUT RENDER'S FREE PLAN: a free web service goes to sleep
// after 15 minutes without traffic. A call every 8 hours confirms
// health, but it cannot stop that sleep - and while the service sleeps
// this timer is not running either. To keep it awake, set
// KEEP_ALIVE_INTERVAL_MINUTES=14 (or use an outside monitor such as
// UptimeRobot / cron-job.org on /app/health-check every 10-14 minutes).
//
// Settings (.env):
//   KEEP_ALIVE_ENABLED=false            -> switch the job off
//   KEEP_ALIVE_INTERVAL_MINUTES=480     -> time between checks (min 5)
//   KEEP_ALIVE_URL=https://.../app/health-check -> address to call
// ==================================================================

const state = {
  keepAlive: {
    enabled: false,
    intervalMinutes: null,
    url: null,
    lastRunAt: null,
    lastStatus: null, // 'ok' | 'down' | 'unreachable'
    lastResponseTimeMs: null,
    nextRunAt: null
  }
};

// For the health check JSON (services/health.js).
export const jobsStatus = () => structuredClone(state);

// Milliseconds until the next slot. Slots are counted from midnight
// UTC, so an 8-hour interval always runs at 00:00, 08:00 and 16:00 UTC,
// no matter when the server was started.
export const nextRunDelay = (intervalMs, now = Date.now()) => intervalMs - (now % intervalMs);

// ONE health check. Exported so it can be tried by hand / in tests.
export async function runHealthCheck({ url, reportException, fetchImpl = fetch }) {
  const job = state.keepAlive;
  const started = Date.now();
  job.lastRunAt = new Date(started).toISOString();

  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'DocumentManager-KeepAlive/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(60 * 1000) // a sleeping Render service can take ~50 s to wake
    });
    const body = await res.json().catch(() => null);
    job.lastResponseTimeMs = Date.now() - started;
    job.lastStatus = res.ok && body?.status === 'ok' ? 'ok' : 'down';

    if (job.lastStatus === 'ok') {
      console.log(`[jobs] health check ok (database ${body.checks?.database?.latencyMs ?? '?'} ms, total ${job.lastResponseTimeMs} ms)`);
      return body;
    }
    await reportException({
      source: 'Scheduled job',
      action: 'Keep-alive health check found a problem',
      error: new Error(`Health check answered HTTP ${res.status} with status "${body?.status ?? 'no JSON'}"`),
      details: { URL: url, Response: JSON.stringify(body?.checks ?? body)?.slice(0, 2000) }
    });
    return body;
  } catch (err) {
    job.lastStatus = 'unreachable';
    job.lastResponseTimeMs = Date.now() - started;
    await reportException({
      source: 'Scheduled job',
      action: 'Keep-alive health check could not reach the API',
      error: err,
      details: { URL: url }
    });
    return null;
  }
}

export function startJobs({ config, reportException }) {
  const { enabled, intervalMinutes, url } = config.keepAlive;
  const job = state.keepAlive;
  job.enabled = enabled;
  if (!enabled) {
    console.log('[jobs] keep-alive health check is switched off (KEEP_ALIVE_ENABLED=false)');
    return { stop() { } };
  }

  job.intervalMinutes = intervalMinutes;
  job.url = url;
  const intervalMs = intervalMinutes * 60 * 1000;
  let timer;

  // setTimeout (not setInterval) re-aligns to the clock after every run.
  const scheduleNext = () => {
    const delay = nextRunDelay(intervalMs);
    job.nextRunAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(async () => {
      await runHealthCheck({ url, reportException });
      scheduleNext();
    }, delay);
    timer.unref(); // the timer alone never keeps the process alive
  };
  scheduleNext();

  console.log(`[jobs] keep-alive health check every ${intervalMinutes} min -> ${url} (next: ${job.nextRunAt})`);
  if (intervalMinutes >= 15) {
    console.log('[jobs] note: on Render\'s free plan the service sleeps after 15 idle minutes; see services/jobs/index.js');
  }
  return { stop: () => clearTimeout(timer) };
}
