import express from 'express';
import { clientInfo } from '../activity/clientInfo.js';
import { recordActivity } from '../activity/log.js';
import Document from '../models/Document.js';
import User from '../models/User.js';
import { openReadStream } from '../storage/fileStorage.js';
import { findDocumentForAdmin, findOwnedDocument, findPublicDocument } from './access.js';
import { servingRules } from './fileTypes.js';

// ==================================================================
// FILE CONTENT ROUTES (plain HTTP, not GraphQL)
// GraphQL answers in JSON, which cannot carry raw bytes efficiently.
// The actual file contents are therefore sent by these two routes,
// and GraphQL only returns their URLs (Document.contentUrl, ...):
//
//   GET /api/documents/:uuid/content        -> signed-in OWNER only
//   GET /api/shared/:token/content          -> anyone, while the document is public
//   GET /api/admin/documents/:uuid/content  -> administrators only (any user's document)
//
// Add ?download=1 to get a download instead of an inline view.
// ==================================================================

// RFC 6266 header with a plain-ASCII fallback name plus the real
// (UTF-8) name, so "Résumé.pdf" downloads with the right name.
function contentDisposition(type, filename = 'download') {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const notFound = (res) => res.status(404).json({ error: 'Document not found.' });

async function sendDocument(req, res, doc, reportException) {
  const rules = servingRules(doc.contentType);
  const asDownload = req.query.download === '1' || !rules.inline;

  res.set({
    'Content-Type': rules.contentType,
    'Content-Disposition': contentDisposition(asDownload ? 'attachment' : 'inline', doc.filename),
    // Never store document bytes in shared caches or the back/forward
    // cache, so revoking a public link or signing out takes effect.
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // Opened directly, a file can never run scripts on this site.
    // (Browsers' PDF viewers do not work inside a sandbox, and PDFs are
    // not scripted HTML, so they only get the framing rule.)
    'Content-Security-Policy': rules.contentType === 'application/pdf'
      ? "frame-ancestors 'self'"
      : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox"
  });

  if (doc.fileId) {
    const stream = openReadStream(doc.fileId);
    stream.on('error', (err) => {
      // The details exist but the bytes cannot be read: worth an email.
      reportException?.({ source: 'REST API', action: `Reading the file of document ${doc.uuid} from GridFS`, error: err, req });
      if (res.headersSent) return res.destroy(err);
      res.removeHeader('Content-Disposition');
      notFound(res);
    });
    if (typeof doc.size === 'number') res.set('Content-Length', String(doc.size));
    return stream.pipe(res);
  }

  // OLD FILES ONLY: bytes stored inside the document itself.
  const withData = await Document.findById(doc._id, { data: 1 });
  if (!withData?.data) return notFound(res);
  res.end(withData.data);
}

export function createDocumentRouter({ sharedLimiter, reportException }) {
  const router = express.Router();

  router.get('/documents/:uuid/content', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'You must be signed in.' });
      const doc = await findOwnedDocument(req.user, req.params.uuid);
      if (!doc) return notFound(res);
      // Downloads go into the activity log. (Plain views do not: the
      // dashboard's thumbnails use this same address many times.)
      if (req.query.download === '1') {
        await recordActivity({
          userId: req.user._id,
          client: clientInfo(req),
          action: 'DOCUMENT_DOWNLOADED',
          entry: { target: { type: 'document', id: doc.uuid, name: doc.filename } }
        });
      }
      await sendDocument(req, res, doc, reportException);
    } catch (err) {
      next(err);
    }
  });

  // A non-admin gets the same 404 as for a missing document, so this
  // route does not even reveal that a document exists.
  router.get('/admin/documents/:uuid/content', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'You must be signed in.' });
      if (!req.user.isAdmin) return notFound(res);
      const doc = await findDocumentForAdmin(req.params.uuid);
      if (!doc) return notFound(res);
      // Admin downloads go into the ADMIN's activity log, naming the owner.
      if (req.query.download === '1') {
        const owner = doc.ownerId && await User.findById(doc.ownerId, { name: 1, email: 1 });
        await recordActivity({
          userId: req.user._id,
          client: clientInfo(req),
          action: 'DOCUMENT_DOWNLOADED',
          entry: {
            target: { type: 'document', id: doc.uuid, name: doc.filename },
            note: `Admin download of a document owned by ${owner?.name || owner?.email || 'an unknown user'}`
          }
        });
      }
      await sendDocument(req, res, doc, reportException);
    } catch (err) {
      next(err);
    }
  });

  router.get('/shared/:token/content', sharedLimiter, async (req, res, next) => {
    try {
      const doc = await findPublicDocument(req.params.token);
      if (!doc) return notFound(res);
      await sendDocument(req, res, doc, reportException);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
