import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// ==================================================================
// MENU - an accessible drop-down menu.
//   <Menu trigger={(props) => <Button {...props} .../>} items={[...]} />
// items: { label, icon, onSelect, danger } | { separator: true } | { heading }
//
// Keyboard: Enter / Space / ArrowDown opens it, ArrowUp / ArrowDown /
// Home / End move, Escape closes and returns focus, Tab closes.
// It opens upwards when there is no room below.
// ==================================================================
export default function Menu({ trigger, items, label }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  const menuItems = () => [...(menuRef.current?.querySelectorAll('[role^="menuitem"]') ?? [])];
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const height = menuRef.current.offsetHeight;
    setUp(rect.bottom + height + 12 > window.innerHeight && rect.top > height + 12);
    menuItems()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!wrapRef.current.contains(e.target)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const onMenuKeyDown = (e) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement);
    const move = (i) => list[(i + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); move(index + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(list.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { close(false); }
  };

  const triggerProps = {
    ref: buttonRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => setOpen((v) => !v),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
    }
  };

  return (
    <div className="ui-menu-wrap" ref={wrapRef}>
      {trigger(triggerProps)}
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={'ui-menu' + (up ? ' ui-menu-up' : '')}
          onKeyDown={onMenuKeyDown}
        >
          {items.filter(Boolean).map((item, i) => {
            if (item.separator) return <div key={i} className="ui-menu-sep" role="separator" />;
            if (item.heading) return <div key={i} className="ui-menu-label">{item.heading}</div>;
            const Icon = item.icon;
            return (
              <button
                key={i}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                tabIndex={-1}
                className={'ui-menu-item' + (item.danger ? ' ui-menu-item-danger' : '')}
                aria-checked={item.checked}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {Icon && <Icon size={16} aria-hidden="true" />}
                <span className="flex-grow-1">{item.label}</span>
                {item.trailing}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
