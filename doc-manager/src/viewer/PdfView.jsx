import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Spinner } from '../components/Spinner';

// ==================================================================
// PDF VIEWER (pdf.js)
// Browsers on Android and some on iOS cannot show a PDF inside a page,
// so PDFs are drawn page by page onto <canvas> elements with Mozilla's
// pdf.js. This file is loaded only when a PDF is opened.
// Pages are drawn when they scroll near the screen; printing first
// draws every page.
// ==================================================================
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({ pdf, number, aspectRatio, register }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const job = useRef(null);
  const [failed, setFailed] = useState(false);

  const render = useCallback(() => {
    job.current ??= (async () => {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      // Pages can differ in shape (e.g. one landscape page): use this page's own.
      if (wrapRef.current) wrapRef.current.style.aspectRatio = `${base.width} / ${base.height}`;
      const cssWidth = wrapRef.current?.clientWidth || base.width;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      // At least 1.5x, so printed pages stay sharp.
      const viewport = page.getViewport({ scale: Math.max((cssWidth * pixelRatio) / base.width, 1.5) });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    })().catch((err) => {
      console.error(`PDF page ${number} failed`, err);
      setFailed(true);
    });
    return job.current;
  }, [pdf, number]);

  useEffect(() => register(number, render), [number, render, register]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        render();
        observer.disconnect();
      }
    }, { rootMargin: '800px 0px' });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [render]);

  return (
    <div className="viewer-pdf-page" ref={wrapRef} style={{ aspectRatio }} aria-label={`Page ${number}`} role="img">
      <canvas ref={canvasRef} />
      {failed && <div className="position-absolute top-50 start-50 translate-middle ui-small" style={{ color: '#555' }}>Page {number} could not be displayed</div>}
    </div>
  );
}

const PdfView = forwardRef(function PdfView({ url, onReady, onError }, ref) {
  const [pdf, setPdf] = useState(null);
  const [aspectRatio, setAspectRatio] = useState('1 / 1.414');
  const renderers = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    // isEvalSupported: false -> pdf.js never compiles code from the PDF.
    const task = pdfjs.getDocument({ url, withCredentials: true, isEvalSupported: false, enableXfa: false });
    task.promise.then(async (doc) => {
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (cancelled) return;
      setAspectRatio(`${first.width} / ${first.height}`);
      setPdf(doc);
      onReady?.(doc.numPages);
    }).catch((err) => {
      if (!cancelled) onError?.(err);
    });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url]);

  const register = useCallback((number, render) => {
    renderers.current.set(number, render);
    return () => renderers.current.delete(number);
  }, []);

  // The viewer calls this before printing: draw every page first.
  useImperativeHandle(ref, () => ({
    renderAll: () => Promise.all([...renderers.current.values()].map((render) => render()))
  }), []);

  if (!pdf) return <div className="py-5"><Spinner size={28} label="Loading PDF" /></div>;

  return (
    <div className="viewer-pdf" aria-label={`PDF document with ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i + 1} pdf={pdf} number={i + 1} aspectRatio={aspectRatio} register={register} />
      ))}
    </div>
  );
});

export default PdfView;
