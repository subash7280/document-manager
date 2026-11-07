import { useEffect, useState } from 'react';
import { API_ENDPOINT, GRAPHQL_URL } from '../graphql/client';

// ==================================================================
// SIGN-IN PROVIDERS ENABLED ON THE SERVER
// The API only lists providers whose keys are set in its .env, so the
// UI shows exactly those (e.g. no Apple button until Apple is set up).
// Asked once per page load and shared by every component.
// ==================================================================
let request;

const loadProviders = () => {
    const loadProvidersEndpoint = `${API_ENDPOINT}/auth/providers`; console.log('loadProvidersEndpoint :>> ', loadProvidersEndpoint);

    request = request || fetch(
        loadProvidersEndpoint,
        {
            credentials: 'include',
        },
    )
        .then(async (res) => {
            console.log('Providers HTTP status:', res.status);
            console.log('Providers URL:', res.url);

            const body = await res.json();

            console.log('Providers response:', body);

            if (!res.ok) {
                throw new Error(
                    `Providers request failed: ${res.status}`
                );
            }

            return body.providers.map((p) => p.id);
        })
        .catch((error) => {
            console.error('Failed to load providers:', error);
            request = undefined;
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
