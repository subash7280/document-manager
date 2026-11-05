import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ==================================================================
// THEME: 'light' | 'dark' | 'system' (follows the device setting).
// The choice is saved in localStorage (it is a per-device preference,
// not account data). public/theme-init.js applies it before first paint.
// ==================================================================
const STORAGE_KEY = 'dm-theme';
const ThemeContext = createContext(null);

const readPreference = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
};

const systemPrefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Follow the device when it switches between light and dark.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', resolved);
  }, [resolved]);

  const setPreference = useCallback((value) => {
    setPreferenceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Not saved (storage blocked); still applied for this visit.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
