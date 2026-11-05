import React, { useEffect, useState } from 'react';
import { Spinner } from '../components/Spinner';

// Very large text files are cut for display (download shows everything).
const MAX_CHARS = 500_000;

// Shows a text file as plain text. It is never interpreted as HTML:
// React puts it on the page as text, so markup inside it cannot run.
export default function TextView({ url, onReady, onError }) {
  const [text, setText] = useState(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        // fromServer: the server's own answer (e.g. 404), not a browser bug.
        if (!res.ok) throw Object.assign(new Error(`Server returned ${res.status}`), { fromServer: true });
        return res.text();
      })
      .then((body) => {
        if (cancelled) return;
        setTruncated(body.length > MAX_CHARS);
        setText(body.slice(0, MAX_CHARS));
        onReady?.();
      })
      .catch((err) => !cancelled && onError?.(err));
    return () => { cancelled = true; };
  }, [url]);

  if (text === null) return <div className="py-5"><Spinner size={28} label="Loading text" /></div>;
  return (
    <div className="w-100 d-grid gap-3 justify-items-center" style={{ maxWidth: 900 }}>
      {truncated && (
        <div className="ui-alert ui-alert-info no-print">Showing the first part of this file. Download it to see everything.</div>
      )}
      <pre className="viewer-text">{text}</pre>
    </div>
  );
}
