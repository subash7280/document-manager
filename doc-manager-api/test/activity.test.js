import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import AppConfig from '../models/AppConfig.js';
import Folder from '../models/Folder.js';
import { Client, USER_AGENTS, files, profile, startTestServer } from './helpers.js';

let server;
let alice;
let bob;

before(async () => {
  server = await startTestServer();
  alice = new Client(server.baseUrl);
  bob = new Client(server.baseUrl, { userAgent: USER_AGENTS.iphone });
  await alice.signIn(server.providers.google, profile('alice'));
  await bob.signIn(server.providers.google, profile('bob'));
});
after(() => server.stop());
beforeEach(() => { server.mails.length = 0; });

const ok = (res) => {
  assert.equal(res.errors, undefined, JSON.stringify(res.errors));
  return res.data;
};
const LOGS = `query($status: ActivityStatus, $category: ActivityCategory, $deviceType: DeviceType, $search: String, $from: String, $to: String) {
  activityLogs(limit: 100, status: $status, category: $category, deviceType: $deviceType, search: $search, from: $from, to: $to) {
    total
    entries { action category status targetType targetName from to note error createdAt
      client { browser browserVersion os osVersion deviceType deviceVendor deviceModel userAgent } }
  }
}`;
const logs = async (client, filters = {}) => ok(await client.gql(LOGS, filters)).activityLogs;

// ------------------------------------------------------------------
// ACTIVITY LOG
// ------------------------------------------------------------------
test('sign-in and every change are recorded with browser and device', async () => {
  const folder = ok(await alice.gql('mutation { createFolder(name: "Proofs") { id } }')).createFolder;
  const doc = ok(await alice.upload('report.txt', files.txt, undefined, folder.id)).uploadDocument;
  ok(await alice.gql('mutation($u: ID!) { renameDocument(uuid: $u, filename: "final.txt") { uuid } }', { u: doc.uuid }));
  ok(await alice.gql('mutation($u: ID!) { setDocumentVisibility(uuid: $u, visibility: PUBLIC) { uuid } }', { u: doc.uuid }));
  await alice.request(`/api/documents/${doc.uuid}/content?download=1`);

  const { entries } = await logs(alice);
  assert.deepEqual(entries.map((e) => e.action), [
    'DOCUMENT_DOWNLOADED', 'DOCUMENT_MADE_PUBLIC', 'DOCUMENT_RENAMED', 'DOCUMENT_UPLOADED', 'FOLDER_CREATED', 'SIGNED_UP'
  ]);
  const rename = entries.find((e) => e.action === 'DOCUMENT_RENAMED');
  assert.deepEqual({ from: rename.from, to: rename.to, name: rename.targetName }, { from: 'report.txt', to: 'final.txt', name: 'final.txt' });
  assert.equal(entries.find((e) => e.action === 'DOCUMENT_UPLOADED').to, 'Proofs');
  assert.deepEqual(rename.client, {
    browser: 'Chrome', browserVersion: '130', os: 'Windows', osVersion: '10', deviceType: 'DESKTOP',
    deviceVendor: null, deviceModel: null, userAgent: USER_AGENTS.chromeWindows
  });
});

test('client hints give the real Windows version and phone model', async () => {
  const res = await alice.request('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"15.0.0"'
    },
    body: JSON.stringify({ query: 'mutation { createFolder(name: "Hinted") { id } }' })
  });
  assert.equal(res.status, 200);
  const [latest] = (await logs(alice)).entries;
  assert.equal(latest.client.osVersion, '11');
  assert.ok(res.headers.get('accept-ch').includes('Sec-CH-UA-Platform-Version'));
});

test('failures are recorded too, with the message the user saw', async () => {
  await alice.upload('virus.exe', Buffer.from('MZ'));
  const [failed] = (await logs(alice, { status: 'FAILURE' })).entries;
  assert.equal(failed.action, 'DOCUMENT_UPLOADED');
  assert.equal(failed.status, 'FAILURE');
  assert.equal(failed.targetName, 'virus.exe');
  assert.match(failed.error, /not supported/);
  assert.equal(server.mails.length, 0, 'a user mistake is not emailed');
});

test('each user sees only their own activity, and filters work', async () => {
  ok(await bob.gql('mutation { createFolder(name: "Bob on phone") { id } }'));
  const bobLogs = await logs(bob);
  assert.ok(bobLogs.entries.every((e) => !['Proofs', 'final.txt'].includes(e.targetName)));
  const phone = bobLogs.entries.find((e) => e.action === 'FOLDER_CREATED');
  assert.deepEqual([phone.client.browser, phone.client.os, phone.client.deviceType, phone.client.deviceVendor, phone.client.deviceModel],
    ['Mobile Safari', 'iOS', 'MOBILE', 'Apple', 'iPhone']);

  assert.equal((await logs(alice, { deviceType: 'MOBILE' })).total, 0);
  assert.ok((await logs(bob, { deviceType: 'MOBILE' })).total >= 2);
  const folderOnly = await logs(alice, { category: 'FOLDER' });
  assert.ok(folderOnly.entries.length > 0 && folderOnly.entries.every((e) => e.category === 'FOLDER'));
  assert.deepEqual((await logs(alice, { search: 'final' })).entries.map((e) => e.action), ['DOCUMENT_DOWNLOADED', 'DOCUMENT_MADE_PUBLIC', 'DOCUMENT_RENAMED']);
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await logs(alice, { from: future })).total, 0);
  const bad = await alice.gql(LOGS, { from: 'not a date' });
  assert.equal(bad.errors[0].extensions.code, 'BAD_USER_INPUT');

  const options = ok(await bob.gql('{ activityFilterOptions { browsers operatingSystems } }')).activityFilterOptions;
  assert.deepEqual(options, { browsers: ['Mobile Safari'], operatingSystems: ['iOS'] });
});

test('sign-out is recorded', async () => {
  const carol = new Client(server.baseUrl);
  await carol.signIn(server.providers.google, profile('carol'));
  await carol.signIn(server.providers.google, profile('carol'));
  const before = (await logs(carol)).entries.map((e) => e.action);
  assert.deepEqual(before, ['SIGNED_IN', 'SIGNED_UP']);
  await carol.request('/auth/signout', { method: 'POST' });
  await carol.signIn(server.providers.google, profile('carol'));
  assert.deepEqual((await logs(carol)).entries.slice(0, 2).map((e) => e.action), ['SIGNED_IN', 'SIGNED_OUT']);
});

// ------------------------------------------------------------------
// EXCEPTION EMAILS
// ------------------------------------------------------------------
test('unexpected errors are emailed to application_configs.exception_mail', async () => {
  await AppConfig.deleteMany({});
  await AppConfig.create({ app_name: 'Document Manager', exception_mail: [' Ops@Example.com ', 'not-an-email', 'ops@example.com', 'dev@example.com'] });

  const realCreate = Folder.create;
  const explode = async () => { throw new Error('database exploded'); };
  Folder.create = explode;
  try {
    const res = await alice.gql('mutation CreateBrokenFolder { createFolder(name: "Boom") { id } }');
    assert.equal(res.errors[0].message, 'Unexpected error.', 'internal details are hidden from the user');
  } finally {
    Folder.create = realCreate;
  }

  await new Promise((r) => setTimeout(r, 50)); // the email is sent without blocking the answer
  assert.equal(server.mails.length, 1);
  const [mail] = server.mails;
  assert.equal(mail.to, 'ops@example.com, dev@example.com');
  assert.match(mail.subject, /^\[Document Manager\] GraphQL API error: database exploded/);
  for (const expected of ['mutation CreateBrokenFolder', 'createFolder', 'alice@example.com', 'Chrome 130', 'Windows', 'Desktop', USER_AGENTS.chromeWindows]) {
    assert.ok(mail.text.includes(expected), `email mentions ${expected}`);
  }
  assert.ok(mail.html.includes('database exploded'));

  // The failure is in Alice's activity log as well, without internals.
  const [failed] = (await logs(alice, { status: 'FAILURE', category: 'FOLDER' })).entries;
  assert.equal(failed.targetName, 'Boom');
  assert.equal(failed.error, 'Something went wrong on the server.');

  // The same error again within 10 minutes is not emailed twice.
  Folder.create = explode;
  try {
    await alice.gql('mutation CreateBrokenFolder { createFolder(name: "Boom") { id } }');
  } finally {
    Folder.create = realCreate;
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.mails.length, 1);
});

test('errors from the browser are emailed, without secrets in the address', async () => {
  const visitor = new Client(server.baseUrl, { userAgent: USER_AGENTS.iphone });
  const token = 'A'.repeat(43);
  const res = await visitor.request('/api/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'Showing a PDF', message: 'pdf.js worker crashed', name: 'TypeError', stack: 'TypeError: x\n    at render (PdfView.jsx:10)', page: `/s/${token}?print=1` })
  });
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 50));
  const [mail] = server.mails;
  assert.match(mail.subject, /Browser error: pdf.js worker crashed/);
  assert.ok(mail.text.includes('Not signed in'));
  assert.ok(mail.text.includes('Mobile Safari') && mail.text.includes('iPhone'));
  assert.ok(mail.text.includes('/s/[token]'));
  assert.ok(!mail.text.includes(token), 'share token is redacted');

  // Other sites cannot send reports.
  const cross = await visitor.request('/api/client-errors', {
    method: 'POST', origin: 'https://evil.example', headers: { 'content-type': 'application/json' }, body: '{"message":"spam"}'
  });
  assert.equal(cross.status, 403);
});

test('no exception_mail configured -> nothing is sent', async () => {
  await AppConfig.deleteMany({});
  await alice.request('/api/client-errors', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'nobody listens' })
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.mails.length, 0);
});

// ------------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------------
test('GET /app/health-check reports app and database health without secrets', async () => {
  await AppConfig.create({ app_name: 'Document Manager', exception_mail: ['ops@example.com'] });
  const visitor = new Client(server.baseUrl);
  const res = await visitor.request('/app/health-check');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.app.name, 'Document Manager');
  assert.equal(body.checks.database.status, 'up');
  assert.equal(typeof body.checks.database.latencyMs, 'number');
  assert.deepEqual(body.checks.appConfig, { status: 'up', exceptionRecipients: 1 });
  assert.equal(body.checks.email.status, 'configured');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('ops@example.com') && !raw.includes('mongodb://'), 'no addresses or connection strings');
});
