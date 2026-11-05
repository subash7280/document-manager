import React from 'react';
import { LoaderCircle } from 'lucide-react';

export function Spinner({ size = 20, label = 'Loading' }) {
  return (
    <span role="status" className="d-inline-flex align-items-center gap-2 ui-muted">
      <LoaderCircle size={size} className="ui-spin" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export function FullPageSpinner({ label }) {
  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
      <Spinner size={28} label={label} />
    </div>
  );
}
