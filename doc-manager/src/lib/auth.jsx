import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { graphqlRequest, UNAUTHENTICATED_EVENT } from '../graphql/client';
import { ME } from '../graphql/operations';
import Button from '../components/Button';
import { FullPageSpinner } from '../components/Spinner';

// ==================================================================
// AUTH STATE IN THE BROWSER
// The browser never decides on its own who is signed in: it asks the
// server with the `me` query (the session cookie is httpOnly, so page
// scripts cannot even read it). This state only chooses which page to
// show; the API checks the session again on every request.
//   status: 'loading' | 'signedIn' | 'signedOut' | 'error'
// ==================================================================
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [state, setState] = useState({ status: 'loading', user: null });
    console.log('state in the AuthProvider  () :>> ', state);

    const refresh = useCallback(async () => {
        try {
            const data = await graphqlRequest(ME);
            console.log('data in the refresh function :>> ', data);

            setState({ status: data.me ? 'signedIn' : 'signedOut', user: data.me });
        }
        catch (error) {
            console.log('error in the refresh function :>> ', error);

            setState((prev) => (prev.status === 'signedIn' ? prev : { status: 'error', user: null }));
        };
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Any API call answering UNAUTHENTICATED (session expired, signed out
    // in another tab...) sends the user back to the sign-in page.
    useEffect(() => {
        const onUnauthenticated = () => setState({ status: 'signedOut', user: null });
        window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
        return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    }, []);

    const signOut = useCallback(async ({ everywhere = false } = {}) => {
        const res = await fetch(everywhere ? '/auth/signout-all' : '/auth/signout', {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Sign out failed. Please try again.');
        setState({ status: 'signedOut', user: null });
    }, []);

    const setUser = useCallback((user) => setState({ status: 'signedIn', user }), []);

    return (
        <AuthContext.Provider value={{ ...state, refresh, signOut, setUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

// Wraps private routes: shows them only to signed-in users.
export function RequireAuth() {
    const { status, refresh } = useAuth();
    console.log('status in the RequireAuth() :>> ', status);
    // console.log('refresh in the RequireAuth() :>> ', refresh);

    const location = useLocation();

    if (status === 'loading') return <FullPageSpinner label="Loading your workspace" />;

    if (status === 'error') {
        return (
            <main className="auth-page">
                <div className="ui-card ui-card-body text-center" style={{ maxWidth: 420 }}>
                    <h1 className="ui-h2 mb-2">Can't reach the server</h1>
                    <p className="ui-muted">Check your connection and try again.</p>
                    <Button variant="primary" icon={RefreshCw} onClick={refresh}>Try again</Button>
                </div>
            </main>
        );
    };

    if (status === 'signedOut') {
        const returnTo = location.pathname + location.search;
        return <Navigate to={`/signin?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    };

    return <Outlet />;
};

// Wraps admin routes (inside RequireAuth): non-admins go to their
// documents. The API refuses admin queries for them anyway.
export function RequireAdmin() {
    const { user } = useAuth();
    return user?.isAdmin ? <Outlet /> : <Navigate to="/" replace />;
};