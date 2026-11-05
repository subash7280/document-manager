import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import User from '../models/User.js';
import { Client, files, profile, startTestServer } from './helpers.js';

let server;
let admin;
let alice;
let visitor;
let aliceDoc;

const ADMIN_USERS = '{ adminUsers { total users { id name email isAdmin documentCount storageUsed storageLabel } } }';
const ADMIN_DOCUMENTS = `query($userId: ID!, $search: String) {
  adminDocuments(userId: $userId, search: $search) { total documents { uuid filename contentUrl downloadUrl visibility } }
}`;

before(async () => {
  server = await startTestServer();
  admin = new Client(server.baseUrl);
  alice = new Client(server.baseUrl);
  visitor = new Client(server.baseUrl);
  await admin.signIn(server.providers.google, profile('admin'));
  await alice.signIn(server.providers.google, profile('alice'));
  // isAdmin is only ever set in the database, never through the API.
  await User.updateOne({ email: 'admin@example.com' }, { isAdmin: true });

  aliceDoc = (await alice.upload('alice-report.pdf', files.pdf)).data.uploadDocument;
  await alice.upload('alice-notes.txt', files.txt);
});
after(() => server.stop());

const aliceId = async () => (await User.findOne({ email: 'alice@example.com' })).id;

test('me.isAdmin reflects the database flag', async () => {
  assert.equal((await admin.gql('{ me { isAdmin } }')).data.me.isAdmin, true);
  assert.equal((await alice.gql('{ me { isAdmin } }')).data.me.isAdmin, false);
});

test('only administrators can use the admin queries', async () => {
  const userId = await aliceId();
  const queries = [
    [ADMIN_USERS, {}],
    ['query($id: ID!) { adminUser(id: $id) { id } }', { id: userId }],
    [ADMIN_DOCUMENTS, { userId }]
  ];
  for (const [query, variables] of queries) {
    assert.equal((await alice.gql(query, variables)).errors?.[0]?.extensions?.code, 'FORBIDDEN', query);
    assert.equal((await visitor.gql(query, variables)).errors?.[0]?.extensions?.code, 'UNAUTHENTICATED', query);
  }
});

test('an administrator sees every user with their document totals', async () => {
  const res = await admin.gql(ADMIN_USERS);
  assert.equal(res.errors, undefined, JSON.stringify(res.errors));
  assert.equal(res.data.adminUsers.total, 2);
  const aliceRow = res.data.adminUsers.users.find((u) => u.email === 'alice@example.com');
  assert.equal(aliceRow.name, 'User alice');
  assert.equal(aliceRow.isAdmin, false);
  assert.equal(aliceRow.documentCount, 2);
  assert.equal(aliceRow.storageUsed, files.pdf.length + files.txt.length);

  const search = await admin.gql('{ adminUsers(search: "ALICE") { total users { email } } }');
  assert.deepEqual(search.data.adminUsers.users.map((u) => u.email), ['alice@example.com']);
});

test("an administrator lists and opens another user's documents", async () => {
  const userId = await aliceId();
  const list = await admin.gql(ADMIN_DOCUMENTS, { userId });
  assert.equal(list.errors, undefined, JSON.stringify(list.errors));
  assert.equal(list.data.adminDocuments.total, 2);

  const searched = await admin.gql(ADMIN_DOCUMENTS, { userId, search: 'report' });
  const [doc] = searched.data.adminDocuments.documents;
  assert.equal(doc.uuid, aliceDoc.uuid);
  assert.equal(doc.contentUrl, `/api/admin/documents/${aliceDoc.uuid}/content`);

  const view = await admin.request(doc.contentUrl);
  assert.equal(view.status, 200);
  assert.equal(Buffer.from(await view.arrayBuffer()).toString(), files.pdf.toString());

  // Downloads are recorded in the ADMIN's log, naming the owner.
  const download = await admin.request(doc.downloadUrl);
  assert.equal(download.status, 200);
  const log = await admin.gql('{ activityLogs(action: DOCUMENT_DOWNLOADED) { entries { targetName note } } }');
  assert.deepEqual(log.data.activityLogs.entries[0], {
    targetName: 'alice-report.pdf',
    note: 'Admin download of a document owned by User alice'
  });
});

test('the admin file route is closed to everyone else', async () => {
  assert.equal((await visitor.request(`/api/admin/documents/${aliceDoc.uuid}/content`)).status, 401);
  // Even the owner uses the normal route; the admin route says "not found".
  assert.equal((await alice.request(`/api/admin/documents/${aliceDoc.uuid}/content`)).status, 404);
});

test('admins still cannot change other users\' documents', async () => {
  const v = { uuid: aliceDoc.uuid };
  assert.equal((await admin.gql('mutation($uuid: ID!) { deleteDocument(uuid: $uuid) }', v)).data.deleteDocument, false);
  assert.equal((await admin.gql('mutation($uuid: ID!) { renameDocument(uuid: $uuid, filename: "x.pdf") { uuid } }', v)).data.renameDocument, null);
  // ...and their own Drive still only shows their own documents.
  assert.equal((await admin.gql('{ documents { total } }')).data.documents.total, 0);
});
