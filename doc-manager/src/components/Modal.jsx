import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button';

// ==================================================================
// REUSABLE MODAL
//
// A pop-up window, opened and closed by React: the parent shows it by
// rendering it, and hides it by not rendering it, e.g.
//   {deleting && <Modal title="Delete file" onClose={...}>...</Modal>}
//
// Props:
//   title    -> text in the header (also the dialog's accessible name)
//   onClose  -> called when the user clicks X, the dark background,
//               or presses Escape
//   footer   -> optional buttons shown at the bottom
//   size     -> optional 'lg' for a wider dialog
//   children -> the content of the modal
//
// ACCESSIBILITY: focus moves into the dialog when it opens, Tab and
// Shift+Tab stay inside it, and focus returns to the button that
// opened it when it closes. On phones it slides up as a bottom sheet.
// ==================================================================
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, onClose, footer, size, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  // Latest onClose without re-running the effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;

    // Focus the element marked data-autofocus, else the first field, else the dialog.
    const target = dialog.querySelector('[data-autofocus]')
      || dialog.querySelector(FOCUSABLE.split(', ').map((s) => `.ui-modal-body ${s}`).join(', '))
      || dialog;
    target.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('ui-modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('ui-modal-open');
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    // Clicking outside the dialog (on the dark area) closes it.
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={'ui-modal' + (size ? ' ui-modal-' + size : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{title}</h2>
          <Button variant="ghost" size="sm" iconOnly icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
