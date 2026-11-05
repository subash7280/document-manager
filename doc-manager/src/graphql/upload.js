import { errorFromBody } from './client';
import { UPLOAD_DOCUMENT } from './operations';

// ==================================================================
// FILE UPLOAD: the "GraphQL multipart request" format
// A file cannot go inside JSON, so the request is multipart/form-data
// with three parts:
//   operations -> the normal { query, variables } JSON, with the file
//                 variable set to null as a placeholder
//   map        -> which part fills which variable: { "0": ["variables.file"] }
//   0          -> the file itself (raw bytes, no base64)
// GraphQL Yoga on the server rebuilds the variables from these parts.
//
// XMLHttpRequest is used instead of fetch() because only XHR reports
// UPLOAD progress (for the progress bar), and it can be cancelled.
// ==================================================================

// Returns { promise, cancel }. The promise resolves with the uploaded
// Document, or rejects with an Error (error.code: 'CANCELLED',
// 'NETWORK', 'BAD_USER_INPUT', ...).
// folderId: the folder to upload into (null = top level).
export function uploadDocument(file, uploadId, { folderId = null, onProgress } = {}) {
  const xhr = new XMLHttpRequest();

  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('operations', JSON.stringify({ query: UPLOAD_DOCUMENT, variables: { file: null, uploadId, folderId } }));
    form.append('map', JSON.stringify({ 0: ['variables.file'] }));
    form.append('0', file, file.name);

    xhr.open('POST', '/graphql');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        return reject(Object.assign(
          new Error(xhr.status === 413 ? 'File is too large. The maximum size is 20 MB.' : `Upload failed (server returned ${xhr.status}).`),
          { fromServer: xhr.status === 413 }
        ));
      }
      if (body.errors?.length) return reject(errorFromBody(body, xhr.status));
      if (!body.data?.uploadDocument) return reject(new Error('Upload failed. Please try again.'));
      resolve(body.data.uploadDocument);
    };
    xhr.onerror = () => reject(Object.assign(new Error('The connection was interrupted. Check your connection and try again.'), { code: 'NETWORK' }));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { code: 'CANCELLED' }));

    xhr.send(form);
  });

  return { promise, cancel: () => xhr.abort() };
}

// A random id for one upload attempt (reused when retrying the SAME
// file, so the server never stores it twice).
export const newUploadId = () =>
  (crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
