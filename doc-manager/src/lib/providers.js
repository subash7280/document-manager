import { useEffect, useState } from 'react';

// ==================================================================
// SIGN-IN PROVIDERS ENABLED ON THE SERVER
// The API only lists providers whose keys are set in its .env, so the
// UI shows exactly those (e.g. no Apple button until Apple is set up).
// Asked once per page load and shared by every component.
// ==================================================================
let request;

const loadProviders = () => {
  request ??= fetch('/auth/providers', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : { providers: [] }))
    .then((body) => body.providers.map((p) => p.id))
    .catch(() => {
      request = undefined; // try again next time
      return [];
    });
  return request;
};

// Returns null while loading, then e.g. ['google'].
export function useProviders() {
  const [providers, setProviders] = useState(null);
  useEffect(() => {
    let active = true;
    loadProviders().then((list) => active && setProviders(list));
    return () => { active = false; };
  }, []);
  return providers;
}
