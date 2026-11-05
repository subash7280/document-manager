import React from 'react';
import { Globe, Lock } from 'lucide-react';

// "Private" / "Public" pill. Icon + text, so it never relies on color alone.
export default function VisibilityBadge({ visibility }) {
  const isPublic = visibility === 'PUBLIC';
  const Icon = isPublic ? Globe : Lock;
  return (
    <span className={`ui-badge ${isPublic ? 'ui-badge-public' : 'ui-badge-private'}`}>
      <Icon size={12} aria-hidden="true" />
      {isPublic ? 'Public' : 'Private'}
    </span>
  );
}
