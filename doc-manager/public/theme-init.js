// ==================================================================
// THEME BEFORE FIRST PAINT
// Runs before React loads, so a dark-theme user never sees a white
// flash. Same storage key and rules as src/lib/theme.jsx.
// ==================================================================
(function () {
  var preference = 'system';
  try {
    preference = localStorage.getItem('dm-theme') || 'system';
  } catch (e) {
    // Storage can be blocked (private mode); fall back to the system theme.
  }
  var dark = preference === 'dark'
    || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
})();
