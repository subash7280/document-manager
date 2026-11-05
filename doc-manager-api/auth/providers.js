import crypto from 'node:crypto';
import * as oidc from 'openid-client';

// ==================================================================
// SIGN-IN PROVIDERS (OpenID Connect)
//
// Both Google and Apple use the OpenID Connect "authorization code"
// flow, handled by the certified `openid-client` library:
//   1. authorizationUrl() -> where to send the browser to sign in
//   2. the provider sends the browser back with a one-time `code`
//   3. exchange() swaps the code for an ID token (server to server) and
//      VERIFIES it: signature, issuer, audience, expiry and nonce.
// The result is a normalized profile:
//   { subject, email, emailVerified, name, picture }
//
// Tests replace these objects with fakes (see test/helpers.js), so the
// rest of the app never talks to openid-client directly.
// ==================================================================

// Discovery (downloading the provider's endpoints and keys) happens on
// first use and is cached. A failed attempt is retried next time.
function lazyDiscovery(discover) {
  let promise;
  return () => {
    promise ??= discover().catch((err) => {
      promise = undefined;
      throw err;
    });
    return promise;
  };
}

// The provider redirects back with ?code=...&state=... (or posts them).
// openid-client wants them as a URL that starts with our redirect URI.
function callbackUrl(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url;
}

function profileFromClaims(claims) {
  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : undefined,
    // Apple sends "true" as a string, Google as a boolean.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' ? claims.name : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined
  };
}

// ------------------------------------------------------------------
// GOOGLE: standard OIDC with PKCE.
// ------------------------------------------------------------------
function googleProvider({ clientId, clientSecret, issuer }) {
  const getConfig = lazyDiscovery(() => oidc.discovery(new URL(issuer), clientId, clientSecret));

  return {
    id: 'google',
    label: 'Google',
    usesPkce: true,
    responseMode: 'query',

    async authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
      const config = await getConfig();
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account'
      }).href;
    },

    async exchange({ redirectUri, params, state, nonce, codeVerifier }) {
      const config = await getConfig();
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl(redirectUri, params), {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
        idTokenExpected: true
      });
      let claims = tokens.claims();
      // Providers may put email/name only in the UserInfo endpoint
      // instead of the ID token. fetchUserInfo checks that the answer is
      // about the SAME user (sub) as the verified ID token.
      if (!claims.email || !claims.name) {
        const userInfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        claims = { ...userInfo, ...claims, email: claims.email ?? userInfo.email, email_verified: claims.email_verified ?? userInfo.email_verified, name: claims.name ?? userInfo.name, picture: claims.picture ?? userInfo.picture };
      }
      return profileFromClaims(claims);
    }
  };
}

// ------------------------------------------------------------------
// APPLE: OIDC with response_mode=form_post. Apple has no fixed client
// secret: the secret is a short-lived JWT signed with your .p8 key
// (ES256), created fresh for every token request.
// ------------------------------------------------------------------
export function appleClientSecret({ teamId, clientId, keyId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'ES256', kid: keyId })}.${encode({
    iss: teamId,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: clientId
  })}`;
  // JWTs need the raw r||s signature format, not DER.
  const signature = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

function appleProvider(apple) {
  // Custom client authentication: client_secret_post with a fresh JWT.
  const clientAuth = (_as, client, body) => {
    body.set('client_id', client.client_id);
    body.set('client_secret', appleClientSecret(apple));
  };
  const getConfig = lazyDiscovery(() => oidc.discovery(new URL(apple.issuer), apple.clientId, undefined, clientAuth));

  return {
    id: 'apple',
    label: 'Apple',
    usesPkce: false,
    responseMode: 'form_post',

    async authorizationUrl({ redirectUri, state, nonce }) {
      const config = await getConfig();
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid name email',
        response_mode: 'form_post',
        state,
        nonce
      }).href;
    },

    async exchange({ redirectUri, params, state, nonce }) {
      const config = await getConfig();
      // Only code + state belong in the authorization response; Apple
      // also posts `user` (name, first sign-in only) which is read below.
      const response = new URLSearchParams();
      for (const key of ['code', 'state']) {
        if (params.has(key)) response.set(key, params.get(key));
      }
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl(redirectUri, response), {
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true
      });
      const profile = profileFromClaims(tokens.claims());

      // Apple sends the user's name ONLY the first time, outside the token.
      try {
        const user = JSON.parse(params.get('user') || '{}');
        const name = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(' ');
        if (name) profile.name = name.slice(0, 100);
      } catch {
        // Ignore a malformed `user` field; the name is optional.
      }
      return profile;
    }
  };
}

// Only providers whose environment variables are set are enabled.
export function createProviders(config) {
  const providers = {};
  if (config.google) providers.google = googleProvider(config.google);
  if (config.apple) providers.apple = appleProvider(config.apple);
  return providers;
}
