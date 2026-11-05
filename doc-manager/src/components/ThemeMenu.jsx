import React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import Button from './Button';
import Menu from './Menu';

export const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor }
];

// Header button that switches between light, dark and system themes.
export default function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  const CurrentIcon = resolved === 'dark' ? Moon : Sun;
  return (
    <Menu
      label="Theme"
      trigger={(props) => <Button {...props} variant="ghost" iconOnly icon={CurrentIcon} label="Change theme" />}
      items={THEME_OPTIONS.map((option) => ({
        label: option.label,
        icon: option.icon,
        checked: preference === option.value,
        trailing: preference === option.value ? <Check size={15} aria-hidden="true" /> : null,
        onSelect: () => setPreference(option.value)
      }))}
    />
  );
}
