// ==================================================================
// FILE TYPES: what may be uploaded, and how each type is served.
//
// The browser's idea of a file's type cannot be trusted (it is just a
// guess from the extension, and attackers can send anything). So:
//   1. the EXTENSION must be on the allowlist below;
//   2. the first bytes of the file must match that type ("magic bytes");
//   3. the SERVER decides the stored content type.
// Keep this list in sync with doc-manager/src/lib/files.js.
// ==================================================================

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const startsWith = (bytes, signature, offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

const isPng = (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (b) => startsWith(b, [0xff, 0xd8, 0xff]);
const isGif = (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'));
const isWebp = (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8);
const isPdf = (b) => startsWith(b, ascii('%PDF-'));
const isZip = (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
const isOle = (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isRtf = (b) => startsWith(b, ascii('{\\rtf'));

// Plain text: valid UTF-8 without NUL bytes (checked on the first 64 KB).
const isText = (b) => {
  const sample = b.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    // stream: true = a character cut in half at the 64 KB mark is fine.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: sample.length < b.length });
    return true;
  } catch {
    return false;
  }
};
const isSvg = (b) => isText(b) && /<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 4096)));

// extension -> stored content type + byte check
const TYPES = {
  png: { contentType: 'image/png', check: isPng },
  jpg: { contentType: 'image/jpeg', check: isJpeg },
  jpeg: { contentType: 'image/jpeg', check: isJpeg },
  gif: { contentType: 'image/gif', check: isGif },
  webp: { contentType: 'image/webp', check: isWebp },
  svg: { contentType: 'image/svg+xml', check: isSvg },
  pdf: { contentType: 'application/pdf', check: isPdf },
  txt: { contentType: 'text/plain', check: isText },
  md: { contentType: 'text/markdown', check: isText },
  csv: { contentType: 'text/csv', check: isText },
  json: { contentType: 'application/json', check: isText },
  rtf: { contentType: 'application/rtf', check: isRtf },
  doc: { contentType: 'application/msword', check: isOle },
  xls: { contentType: 'application/vnd.ms-excel', check: isOle },
  ppt: { contentType: 'application/vnd.ms-powerpoint', check: isOle },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: isZip },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: isZip },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: isZip },
  odt: { contentType: 'application/vnd.oasis.opendocument.text', check: isZip },
  ods: { contentType: 'application/vnd.oasis.opendocument.spreadsheet', check: isZip },
  odp: { contentType: 'application/vnd.oasis.opendocument.presentation', check: isZip },
  zip: { contentType: 'application/zip', check: isZip }
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

// "../../etc/report.PDF" -> "report.PDF"; strips control characters.
export function cleanFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
}

const extensionOf = (filename) => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

// Returns { contentType } or { error } with a message for the user.
export function detectFileType(filename, bytes) {
  const extension = extensionOf(filename);
  const type = TYPES[extension];
  if (!type) {
    return { error: `This file type is not supported. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.` };
  }
  if (!type.check(bytes)) {
    return { error: `The file content does not look like a .${extension} file.` };
  }
  return { contentType: type.contentType };
}

// ------------------------------------------------------------------
// SERVING RULES
// Only these types may be shown INSIDE the browser (inline). Anything
// else - including old documents saved with a risky type such as
// text/html - is always sent as a download with a neutral type, so it
// can never run as a web page on this site.
// ------------------------------------------------------------------
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'application/json'
]);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

export function servingRules(contentType) {
  if (!INLINE_TYPES.has(contentType)) {
    return { inline: false, contentType: 'application/octet-stream' };
  }
  // Text is always served as plain text, so a browser never renders it.
  if (TEXT_TYPES.has(contentType)) {
    return { inline: true, contentType: 'text/plain; charset=utf-8' };
  }
  return { inline: true, contentType };
}
