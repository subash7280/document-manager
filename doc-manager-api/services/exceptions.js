import { clientInfo, describeClient } from '../activity/clientInfo.js';
import { getAppConfig } from './appConfig.js';

// ==================================================================
// EXCEPTION EMAILS
// When something fails UNEXPECTEDLY (a bug, the database is down, a
// provider is unreachable...), an email goes to every address in
// application_configs.exception_mail with:
//   what happened, the error and its stack trace, who was signed in,
//   the request, and the browser / system / device it came from.
//
// What counts as "unexpected": everything that is NOT a normal answer
// to the user's input. "File is too large" or "A folder with this name
// already exists" are GraphQLErrors the user simply reads and fixes,
// so they are recorded in the activity log but do not email anyone.
//
// SAFETY VALVES (so a broken database cannot send 1,000 emails):
//   - the same error is emailed at most once every 10 minutes; repeats
//     are counted and mentioned in the next email
//   - at most 30 exception emails per hour in total
//
// createExceptionReporter() returns report(). report() never throws
// and can be called without await ("fire and forget").
// ==================================================================

const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_HOUR = 30;

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (text, max) => String(text ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

// Removes secrets from addresses before they are emailed: query strings
// (OAuth codes, states) and public share tokens.
export function redactPath(url) {
  return String(url ?? '')
    .split(/[?#]/)[0]
    .replace(/\/(s|shared)\/[A-Za-z0-9_-]{20,}/g, '/$1/[token]')
    .slice(0, 300);
}

// Accepts a real Error, or a plain { name, message, stack } object (an
// error reported by the browser).
const toErrorShape = (error) => ({
  name: oneLine(error?.name || 'Error', 100),
  message: oneLine(error?.message || String(error ?? 'Unknown error'), 1000),
  stack: String(error?.stack || '').slice(0, 8000)
});

export function createExceptionReporter({ config, mailer, log = console }) {
  const recent = new Map(); // signature -> { sentAt, suppressed }
  let sentTimes = [];
  const warned = new Set();
  const warnOnce = (key, message) => {
    if (!warned.has(key)) {
      warned.add(key);
      log.warn(message);
    }
  };

  // ----------------------------------------------------------------
  // report({ source, action, error, req, user, client, details })
  //   source  -> where: 'GraphQL API', 'REST API', 'Sign-in', 'Browser',
  //              'Scheduled job', 'Server process'
  //   action  -> what was being done, e.g. 'mutation DeleteFolder (deleteFolder)'
  //   error   -> the Error (or { name, message, stack })
  //   req     -> the Express request, if any (fills user/client/request)
  //   details -> extra { label: value } rows for the email
  // Resolves to true if an email was sent.
  // ----------------------------------------------------------------
  return async function report({ source, action, error, req, user, client, details = {} }) {
    try {
      const err = toErrorShape(error);
      log.error(`[exception] ${source} - ${action}: ${err.name}: ${err.message}`);

      // ---- throttling ----
      const firstFrame = err.stack.split('\n').find((line) => line.trim().startsWith('at ')) ?? '';
      const signature = `${source}|${action}|${err.message}|${firstFrame.trim()}`;
      const now = Date.now();
      const previous = recent.get(signature);
      if (previous && now - previous.sentAt < REPEAT_WINDOW_MS) {
        previous.suppressed += 1;
        return false;
      }
      sentTimes = sentTimes.filter((t) => now - t < 60 * 60 * 1000);
      if (sentTimes.length >= MAX_PER_HOUR) {
        warnOnce(`cap-${Math.floor(now / 3600000)}`, `[exception] more than ${MAX_PER_HOUR} exception emails this hour; the rest are only logged.`);
        return false;
      }

      // ---- recipients ----
      const appConfig = await getAppConfig({ maxAgeMs: config.appConfigCacheMs }).catch(() => null);
      const recipients = appConfig?.exceptionMail ?? [];
      if (recipients.length === 0) {
        warnOnce('no-recipients', '[exception] No exception_mail found in the application_configs collection, so exception emails are off. Run `npm run seed-config` or add the document by hand.');
        return false;
      }
      if (!mailer) {
        warnOnce('no-smtp', '[exception] SMTP is not configured (SMTP_HOST in .env), so exception emails cannot be sent. They are only printed here.');
        return false;
      }

      const suppressed = previous?.suppressed ?? 0;
      recent.set(signature, { sentAt: now, suppressed: 0 });
      sentTimes.push(now);
      for (const [key, value] of recent) {
        if (now - value.sentAt > REPEAT_WINDOW_MS) recent.delete(key);
      }

      // ---- the email ----
      const signedIn = user ?? req?.user;
      const device = client ?? (req ? clientInfo(req) : null);
      const appName = appConfig.appName;
      const rows = [
        ['What happened', action],
        ['Where', source],
        ['When', new Date(now).toISOString()],
        ['Error', `${err.name}: ${err.message}`],
        ['User', signedIn ? `${signedIn.name || '(no name)'} <${signedIn.email || 'no email'}> · id ${signedIn._id ?? signedIn.id}` : 'Not signed in'],
        ...(req ? [['Request', `${req.method} ${redactPath(req.originalUrl || req.url)}`]] : []),
        ...(device ? [
          ['Browser', [device.browser, device.browserVersion].filter(Boolean).join(' ') || 'Unknown'],
          ['System', [device.os, device.osVersion].filter(Boolean).join(' ') || 'Unknown'],
          ['Device', describeClient(device).replace(/^.* \(/, '').replace(/\)$/, '')],
          ['IP address', device.ip || 'Unknown'],
          ['User agent', device.userAgent || 'None']
        ] : []),
        ...Object.entries(details).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v).slice(0, 4000)]),
        ['Environment', `${config.isProduction ? 'production' : 'development'} · ${config.appOrigin}`],
        ...(suppressed ? [['Repeats', `${suppressed} more of the same error in the last 10 minutes were not emailed.`]] : [])
      ];

      const subject = oneLine(`[${appName}] ${source} error: ${err.message}`, 180);
      const text = `${appName} - exception report\n\n`
        + rows.map(([k, v]) => `${k}: ${v}`).join('\n')
        + (err.stack ? `\n\nStack trace:\n${err.stack}` : '');
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#14171c">
<h2 style="margin:0 0 4px;color:#d92d20">${escapeHtml(appName)}: something went wrong</h2>
<p style="margin:0 0 16px;color:#5b6270">${escapeHtml(source)} &middot; ${escapeHtml(new Date(now).toUTCString())}</p>
<table cellpadding="6" style="border-collapse:collapse;max-width:900px">
${rows.map(([k, v]) => `<tr><th align="left" valign="top" style="border-bottom:1px solid #e1e4ea;white-space:nowrap;color:#5b6270;font-weight:600">${escapeHtml(k)}</th><td style="border-bottom:1px solid #e1e4ea;word-break:break-word">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
${err.stack ? `<h3 style="margin:20px 0 6px">Stack trace</h3><pre style="background:#f1f3f6;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap">${escapeHtml(err.stack)}</pre>` : ''}
<p style="color:#7b8291;font-size:12px">Sent automatically. Recipients come from application_configs.exception_mail.</p>
</div>`;

      await mailer.send({ to: recipients.join(', '), subject, text, html });
      return true;
    } catch (sendError) {
      // Never let reporting an error cause another error.
      log.error('[exception] could not send the exception email:', sendError.message);
      return false;
    }
  };
}
