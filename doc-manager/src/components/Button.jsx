import React, { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';

// ==================================================================
// BUTTON - every button in the app uses this component.
//   variant: primary | secondary | outline | ghost | destructive | destructive-ghost
//   size:    sm | md | lg
//   icon:    a lucide icon component shown before the label
//   loading: shows a spinner, disables the button, sets aria-busy
//   to:      renders a router <Link> styled as a button
//   iconOnly: square button; `label` becomes its accessible name
// ==================================================================
const Button = forwardRef(function Button(
  { variant = 'outline', size = 'md', icon: Icon, loading = false, to, href, iconOnly = false, label, block = false, className = '', children, disabled, type = 'button', ...rest },
  ref
) {
  const classes = [
    'ui-btn',
    `ui-btn-${variant}`,
    size !== 'md' && `ui-btn-${size}`,
    iconOnly && 'ui-btn-icon',
    block && 'ui-btn-block',
    className
  ].filter(Boolean).join(' ');

  const iconSize = size === 'sm' ? 15 : 17;
  const content = (
    <>
      {loading ? <LoaderCircle size={iconSize} className="ui-spin" aria-hidden="true" /> : Icon && <Icon size={iconSize} aria-hidden="true" />}
      {iconOnly ? <span className="visually-hidden">{label}</span> : children}
    </>
  );
  const a11y = { 'aria-label': iconOnly ? label : undefined, title: iconOnly ? label : undefined };

  if (to) {
    return <Link ref={ref} to={to} className={classes} {...a11y} {...rest}>{content}</Link>;
  }
  if (href) {
    return <a ref={ref} href={href} className={classes} {...a11y} {...rest}>{content}</a>;
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...a11y}
      {...rest}
    >
      {content}
    </button>
  );
});

export default Button;
