import crypto from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { createConfig } from '../config.js';

// ==================================================================
// TEST HELPERS
// Each test file starts a throwaway in-memory MongoDB and a real HTTP
// server. Google/Apple are replaced by fake providers that hand out
// profiles for one-time codes, so the REAL auth routes, cookies,
// sessions and authorization rules are exercised end to end.
// ==================================================================

export const APP_ORIGIN = 'http://localhost:5173';

export function fakeProvider(id, { responseMode = 'query' } = {}) {
  const codes = new Map();
  return {
    id,
    label: id,
    usesPkce: responseMode === 'query',
    responseMode,
    lastAuthorization: null,
    async authorizationUrl(params) {
      this.lastAuthorization = params;
      return `https://idp.test/${id}/authorize?state=${params.state}`;
    },
    async exchange({ params, nonce, codeVerifier }) {
      const entry = codes.get(params.get('code'));
      codes.delete(params.get('code'));
      if (!entry) throw Object.assign(new Error('invalid code'), { code: 'invalid_grant' });
      if (this.usesPkce && !codeVerifier) throw new Error('missing PKCE verifier');
      if (!nonce) throw new Error('missing nonce');
      return entry;
    },
    issueCode(profile) {
      const code = crypto.randomBytes(8).toString('hex');
      codes.set(code, profile);
      return code;
    }
  };
}

export async function startTestServer() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('doc-manager-test'));
  await mongoose.connection.syncIndexes();

  const config = {
    ...createConfig({ APP_ORIGIN, NODE_ENV: 'test' }),
    rateLimits: { auth: 10000, shared: 10000, graphql: 10000, health: 10000, clientErrors: 10000 },
    appConfigCacheMs: 0 // read application_configs fresh in every test
  };
  const providers = { google: fakeProvider('google'), apple: fakeProvider('apple', { responseMode: 'form_post' }) };
  // A fake mailer: "sent" emails are kept in this array.
  const mails = [];
  const mailer = { send: async (message) => { mails.push(message); } };
  const server = http.createServer(createApp({ config, providers, mailer }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    config,
    providers,
    mails,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await mongo.stop();
    }
  };
}

// ------------------------------------------------------------------
// A tiny browser: remembers cookies, sends our Origin on writes.
// ------------------------------------------------------------------
export const USER_AGENTS = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
};

export class Client {
  constructor(baseUrl, { userAgent = USER_AGENTS.chromeWindows } = {}) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.userAgent = userAgent;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path, { method = 'GET', headers = {}, body, origin = APP_ORIGIN } = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      body,
      redirect: 'manual',
      headers: {
        'user-agent': this.userAgent,
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(method !== 'GET' && origin ? { origin } : {}),
        ...headers
      }
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((s) => s.trim());
      const [name, ...rest] = pair.split('=');
      const expired = attributes.some((a) => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a));
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, rest.join('='));
    }
    return res;
  }

  async gql(query, variables = {}) {
    const res = await this.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    return res.json();
  }

  // GraphQL multipart request: operations + map + the file itself.
  async upload(filename, bytes, uploadId = crypto.randomUUID(), folderId = null) {
    const form = new FormData();
    form.set('operations', JSON.stringify({
      query: 'mutation($file: File!, $uploadId: ID!, $folderId: ID) { uploadDocument(file: $file, uploadId: $uploadId, folderId: $folderId) { uuid filename contentType size visibility shareUrl kind folderId } }',
      variables: { file: null, uploadId, folderId }
    }));
    form.set('map', JSON.stringify({ 0: ['variables.file'] }));
    form.set('0', new Blob([bytes]), filename);
    const res = await this.request('/graphql', { method: 'POST', body: form });
    return res.json();
  }

  // Runs the whole sign-in flow through the real /auth routes.
  async signIn(provider, profile, { returnTo = '/' } = {}) {
    const start = await this.request(`/auth/${provider.id}/start?returnTo=${encodeURIComponent(returnTo)}`);
    return this.completeAuth(provider, start, profile);
  }

  async link(provider, profile) {
    const start = await this.request(`/auth/${provider.id}/start?intent=link`);
    return this.completeAuth(provider, start, profile);
  }

  async completeAuth(provider, startResponse, profile, { state } = {}) {
    if (startResponse.status !== 303) return startResponse;
    const realState = new URL(startResponse.headers.get('location')).searchParams.get('state');
    const code = provider.issueCode(profile);
    const params = new URLSearchParams({ code, state: state ?? realState });
    if (provider.responseMode === 'form_post') {
      await this.request(`/auth/${provider.id}/callback`, {
        method: 'POST',
        origin: 'https://appleid.apple.com',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      return this.request(`/auth/${provider.id}/finish`);
    }
    return this.request(`/auth/${provider.id}/callback?${params}`);
  }
}

export const profile = (subject, extra = {}) => ({
  subject,
  email: `${subject}@example.com`,
  emailVerified: true,
  name: `User ${subject}`,
  ...extra
});

// Minimal valid files for upload tests.
export const files = {
  png: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
  pdf: Buffer.from('%PDF-1.4\n%test\n'),
  txt: Buffer.from('Hello, world\n')
};
