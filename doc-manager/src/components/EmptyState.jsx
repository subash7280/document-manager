import React from 'react';

export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="ui-empty">
      {Icon && (
        <span className="ui-empty-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
      )}
      <h2 className="ui-h2">{title}</h2>
      {children && <p className="ui-muted">{children}</p>}
      {action}
    </div>
  );
}
