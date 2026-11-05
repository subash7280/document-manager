// Dates are stored as ISO strings by the API; shown in the user's locale.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : '');
export const formatDateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : '');

export const initials = (name = '', email = '') => {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
};

export const providerLabel = (provider) =>
  ({ GOOGLE: 'Google', APPLE: 'Apple', google: 'Google', apple: 'Apple' }[provider] ?? provider);
