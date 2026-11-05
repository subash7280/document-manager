import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Identity from '../models/Identity.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { Client, profile, startTestServer } from './helpers.js';

let server;
before(async () => { server = await startTestServer(); });
after(() => server.stop());

const ME = '{ me { id name email linkedAccounts { provider email } } }';

test('signed-out visitors get me = null', async () => {
  const client = new Client(server.baseUrl);
  const res = await client.gql(ME);
  assert.equal(res.data.me, null);
});

test('first Google sign-in creates an account and a session', async () => {
  const client = new Client(server.baseUrl);
  const res = await client.signIn(server.providers.google, profile('alice'), { returnTo: '/upload' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/upload');
  assert.ok(client.cookies.has('dm_session'));
  assert.ok(!client.cookies.has('dm_oauth'), 'transaction cookie is cleared');

  const me = (await client.gql(ME)).data.me;
  assert.equal(me.email, 'alice@example.com');
  assert.deepEqual(me.linkedAccounts.map((a) => a.provider), ['GOOGLE']);

  // Only the HASH of the session token is stored.
  const session = await Session.findOne({ userId: me.id });
  assert.notEqual(session.tokenHash, client.cookies.get('dm_session'));
});

test('signing in again with the same identity does not create a duplicate', async () => {
  const first = new Client(server.baseUrl);
  await first.signIn(server.providers.google, profile('bob'));
  const second = new Client(server.baseUrl);
  await second.signIn(server.providers.google, profile('bob'));

  const a = (await first.gql(ME)).data.me;
  const b = (await second.gql(ME)).data.me;
  assert.equal(a.id, b.id);
  assert.equal(await User.countDocuments({ email: 'bob@example.com' }), 1);
  assert.equal(await Identity.countDocuments({ subject: 'bob' }), 1);
});

test('a new provider with an existing verified email is NOT merged automatically', async () => {
  const google = new Client(server.baseUrl);
  await google.signIn(server.providers.google, profile('carol-g', { email: 'carol@example.com' }));

  const apple = new Client(server.baseUrl);
  const res = await apple.signIn(server.providers.apple, profile('carol-a', { email: 'carol@example.com' }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/signin\?error=account_exists&provider=google/);
  assert.ok(!apple.cookies.has('dm_session'));
  assert.equal(await User.countDocuments({ email: 'carol@example.com' }), 1);
});

test('a signed-in user can link Apple from Settings, then sign in with either', async () => {
  const client = new Client(server.baseUrl);
  await client.signIn(server.providers.google, profile('dave-g', { email: 'dave@example.com' }));
  const linked = await client.link(server.providers.apple, profile('dave-a', { email: 'relay123@privaterelay.appleid.com' }));
  assert.equal(linked.headers.get('location'), '/settings?linked=apple');

  const viaApple = new Client(server.baseUrl);
  await viaApple.signIn(server.providers.apple, profile('dave-a', { email: 'relay123@privaterelay.appleid.com' }));
  const a = (await client.gql(ME)).data.me;
  const b = (await viaApple.gql(ME)).data.me;
  assert.equal(a.id, b.id);
  assert.deepEqual(b.linkedAccounts.map((x) => x.provider).sort(), ['APPLE', 'GOOGLE']);
});

test('an identity already used by another account cannot be linked', async () => {
  const owner = new Client(server.baseUrl);
  await owner.signIn(server.providers.apple, profile('erin-a'));
  const other = new Client(server.baseUrl);
  await other.signIn(server.providers.google, profile('frank-g'));
  const res = await other.link(server.providers.apple, profile('erin-a'));
  assert.match(res.headers.get('location'), /^\/settings\?error=identity_in_use/);
});

test('linking requires being signed in', async () => {
  const client = new Client(server.baseUrl);
  const res = await client.request('/auth/apple/start?intent=link');
  assert.match(res.headers.get('location'), /^\/signin\?error=signin_required/);
});

test('a callback with a wrong state is rejected', async () => {
  const client = new Client(server.baseUrl);
  const start = await client.request('/auth/google/start');
  const res = await client.completeAuth(server.providers.google, start, profile('mallory'), { state: 'forged' });
  assert.match(res.headers.get('location'), /error=state_mismatch/);
  assert.ok(!client.cookies.has('dm_session'));
});

test('a callback from a browser that did not start the sign-in is rejected (login CSRF)', async () => {
  const victim = new Client(server.baseUrl);
  const attacker = new Client(server.baseUrl);
  const start = await attacker.request('/auth/google/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const code = server.providers.google.issueCode(profile('attacker'));
  const res = await victim.request(`/auth/google/callback?code=${code}&state=${state}`);
  assert.match(res.headers.get('location'), /error=session_expired/);
  assert.ok(!victim.cookies.has('dm_session'));
});

test('a cancelled sign-in shows a friendly error', async () => {
  const client = new Client(server.baseUrl);
  const start = await client.request('/auth/google/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const res = await client.request(`/auth/google/callback?error=access_denied&state=${state}`);
  assert.match(res.headers.get('location'), /error=cancelled/);
});

test('returnTo cannot redirect to another site', async () => {
  const client = new Client(server.baseUrl);
  const res = await client.signIn(server.providers.google, profile('gina'), { returnTo: '//evil.example/steal' });
  assert.equal(res.headers.get('location'), '/');
});

test('sign-out ends the session on the server', async () => {
  const client = new Client(server.baseUrl);
  await client.signIn(server.providers.google, profile('henry'));
  const token = client.cookies.get('dm_session');
  const res = await client.request('/auth/signout', { method: 'POST' });
  assert.equal(res.status, 204);
  assert.equal((await client.gql(ME)).data.me, null);

  // Re-using the old cookie does not work either.
  const replay = new Client(server.baseUrl);
  replay.cookies.set('dm_session', token);
  assert.equal((await replay.gql(ME)).data.me, null);
});

test('sign out everywhere ends all sessions of the user', async () => {
  const laptop = new Client(server.baseUrl);
  const phone = new Client(server.baseUrl);
  await laptop.signIn(server.providers.google, profile('ivy'));
  await phone.signIn(server.providers.google, profile('ivy'));
  await laptop.request('/auth/signout-all', { method: 'POST' });
  assert.equal((await phone.gql(ME)).data.me, null);
});

test('cross-site POSTs are blocked (CSRF)', async () => {
  const client = new Client(server.baseUrl);
  await client.signIn(server.providers.google, profile('jack'));
  const res = await client.request('/auth/signout', { method: 'POST', origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.ok((await client.gql(ME)).data.me, 'still signed in');
});

test('the last sign-in method cannot be removed', async () => {
  const client = new Client(server.baseUrl);
  await client.signIn(server.providers.google, profile('kim'));
  const res = await client.gql('mutation { unlinkAccount(provider: GOOGLE) { id } }');
  assert.equal(res.errors[0].extensions.code, 'BAD_USER_INPUT');
});
