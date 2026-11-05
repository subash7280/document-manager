import React from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { fileAppearance } from '../lib/files';

const ICONS = {
  pdf: FileText,
  image: FileImage,
  sheet: FileSpreadsheet,
  slides: Presentation,
  doc: FileText,
  archive: FileArchive,
  text: FileText,
  file: File
};

// A colored file-type tile, used where there is no picture preview.
export default function FileIcon({ contentType, filename, size = 36, showLabel = true }) {
  const look = fileAppearance(contentType, filename);
  const Icon = ICONS[look.icon];
  return (
    <span className="file-icon" style={{ '--file-color': `var(--dm-type-${look.tone})` }} aria-hidden="true">
      <span className="file-icon-inner">
        <Icon size={size} strokeWidth={1.5} />
        {showLabel && <span className="file-icon-ext">{look.label}</span>}
      </span>
    </span>
  );
}
