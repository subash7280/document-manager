// ==================================================================
// GRAPHQL CLIENT
// A tiny GraphQL client, written with plain fetch() so you can see
// exactly what happens on the network. (Libraries like Apollo Client
// or urql do the same thing, plus caching and other extras.)
//
// Every GraphQL request is the same shape:
//   POST /graphql
//   Content-Type: application/json
//   { "query": "<GraphQL text>", "variables": { ...values... } }
//
// Every GraphQL response is also the same shape:
//   { "data":   { ...exactly the fields you asked for... },
//     "errors": [ { "message": "..." } ]   <- only if something failed }
//
// Note: GraphQL often answers with HTTP 200 even when there are errors,
// so we must always look inside the "errors" array.
//
// SIGN-IN: the address is relative ("/graphql"), so the request goes to
// the same origin as the page and the browser attaches the httpOnly
// session cookie automatically. No token is ever handled in JavaScript.
// ==================================================================

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL // '/graphql';
console.log('GRAPHQL_URL :>> ', GRAPHQL_URL);

// Fired when the server says "you are not signed in" (lib/auth.jsx
// listens and shows the sign-in page).
export const UNAUTHENTICATED_EVENT = 'dm:unauthenticated';

// Turns a GraphQL { errors: [...] } body into a thrown Error.
// An error may carry extra info in "extensions", e.g.
//   { "message": "File name cannot be empty.",
//     "extensions": { "code": "BAD_USER_INPUT" } }
// We copy that code onto the Error so components can check it.
// fromServer: the server already knows about this error (and emailed
// it if it was unexpected), so lib/errorReporting.js does not resend it.
export function errorFromBody(body, status) {
    const error = new Error(body?.errors?.map((e) => e?.message)?.join('\n') || `Server returned ${status}`);

    error.code = body?.errors?.[0]?.extensions?.code;
    error.fromServer = true;

    if (error?.code === 'UNAUTHENTICATED') {
        window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    };

    return error;
};

// Sends a query or mutation and returns its "data" object.
// Throws an Error (with the server's message) if anything went wrong.
export async function graphqlRequest(query, variables = {}) {
    let res;
    try {
        res = await fetch(
            GRAPHQL_URL,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(
                    {
                        query,
                        variables,
                    },
                ),
            },
        );
        console.log('res 1 :>> ', res);
    }
    catch (error) {
        console.log('error in the graphqlRequest function of "res" :>> ', error);
        throw Object.assign(new Error('Network error. Check your connection and try again.'), { code: 'NETWORK' });
    };
    console.log('res 2 :>> ', res);

    let body;
    try {
        body = await res.json();
        console.log('body 1 :>> ', body);
    }
    catch (error) {
        console.log('error in the graphqlRequest function of "body" :>> ', error);

        // The server did not answer with JSON at all (e.g. it is down,
        // or a proxy returned an HTML error page).
        throw new Error(`Server returned ${res.status} ${res.statusText}`);
    };
    console.log('body 2 :>> ', body);

    // GraphQL can return partial data together with errors. To keep
    // this app simple, ANY error is treated as a failure.
    if (body?.errors && body?.errors?.length > 0) {
        throw errorFromBody(body, res?.status);
    };

    if (!body?.data) {
        throw new Error(`Server returned ${res?.status} ${res?.statusText}`);
    };

    return body?.data;
};