import express from 'express';
import { redactPath } from './exceptions.js';

// ==================================================================
// BROWSER ERRORS - POST /api/client-errors
// The React app sends errors that happen IN THE BROWSER here (a page
// that crashed, a file that could not be displayed...), so they are
// emailed like server errors. Errors the server itself returned are
// NOT sent again: the server already reported them.
//
// Body (JSON, max 16 KB): { action, message, name, stack, componentStack, page }
// Open to signed-out visitors too (the public viewer can fail), but:
//   - only from our own pages (the cross-site check in app.js),
//   - rate limited per IP, and emails are throttled in exceptions.js.
// ==================================================================
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);

export function createClientErrorRouter({ limiter, reportException }) {
  const router = express.Router();

  router.post('/client-errors', limiter, express.json({ limit: '16kb' }), (req, res) => {
    const body = req.body ?? {};
    const message = text(body.message, 1000);
    if (!message) return res.status(400).json({ error: 'message is required.' });

    // Not awaited: the browser does not need to wait for the email.
    reportException({
      source: 'Browser',
      action: text(body.action, 200) || 'Unknown action in the web app',
      error: { name: text(body.name, 100) || 'Error', message, stack: text(body.stack, 8000) },
      req,
      details: {
        Page: body.page ? redactPath(text(body.page, 500)) : undefined,
        'React component stack': text(body.componentStack, 3000)
      }
    });
    res.status(204).end();
  });

  return router;
}
