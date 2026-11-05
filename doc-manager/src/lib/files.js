// ==================================================================
// FILE RULES (browser side)
// Mirrors doc-manager-api/documents/fileTypes.js so users get instant
// feedback. The SERVER checks everything again (including the file's
// real content), so these checks are for convenience, not security.
// ==================================================================

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export const ALLOWED_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'txt', 'md', 'csv', 'json', 'rtf',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'zip'
];

// For <input type="file" accept="...">
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const extensionOf = (filename = '') => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

// Returns an error message, or null when the file looks fine.
export function validateFile(file) {
  if (!file) return 'Choose a file to upload.';
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return ext
      ? `.${ext} files are not supported. Try PDF, images, text or Office documents.`
      : 'This file has no extension, so its type cannot be checked.';
  }
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_FILE_SIZE) return `This file is ${formatBytes(file.size)}. The maximum size is 20 MB.`;
  return null;
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// How a file is presented: a short label, a color token and an icon
// name (see components/FileIcon.jsx).
export function fileAppearance(contentType = '', filename = '') {
  const ext = extensionOf(filename);
  if (contentType === 'application/pdf' || ext === 'pdf') return { label: 'PDF', tone: 'pdf', icon: 'pdf' };
  if (contentType.startsWith('image/')) return { label: ext ? ext.toUpperCase() : 'Image', tone: 'image', icon: 'image' };
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return { label: ext.toUpperCase(), tone: 'sheet', icon: 'sheet' };
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { label: ext.toUpperCase(), tone: 'slides', icon: 'slides' };
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return { label: ext.toUpperCase(), tone: 'doc', icon: 'doc' };
  if (ext === 'zip') return { label: 'ZIP', tone: 'other', icon: 'archive' };
  if (contentType.startsWith('text/') || contentType === 'application/json') {
    return { label: ext ? ext.toUpperCase() : 'Text', tone: 'other', icon: 'text' };
  }
  return { label: ext ? ext.toUpperCase() : 'File', tone: 'other', icon: 'file' };
}

// What the viewer can show inside the page.
export function previewKind(contentType = '') {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(contentType)) return 'text';
  return 'none';
}
