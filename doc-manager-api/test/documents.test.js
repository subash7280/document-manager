import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import { Client, files, profile, startTestServer } from './helpers.js';

let server;
let alice;
let bob;
let visitor;

before(async () => {
  server = await startTestServer();
  alice = new Client(server.baseUrl);
  bob = new Client(server.baseUrl);
  visitor = new Client(server.baseUrl);
  await alice.signIn(server.providers.google, profile('alice'));
  await bob.signIn(server.providers.google, profile('bob'));
});
after(() => server.stop());

const uploadOk = async (client, name, bytes) => {
  const res = await client.upload(name, bytes);
  assert.equal(res.errors, undefined, JSON.stringify(res.errors));
  return res.data.uploadDocument;
};
const shareToken = (shareUrl) => shareUrl.split('/s/')[1];

// ------------------------------------------------------------------
// AUTHENTICATION
// ------------------------------------------------------------------
test('every document operation requires sign-in', async () => {
  const operations = [
    '{ documents { total } }',
    '{ document(uuid: "x") { uuid } }',
    'mutation { renameDocument(uuid: "x", filename: "y") { uuid } }',
    'mutation { deleteDocument(uuid: "x") }',
    'mutation { setDocumentVisibility(uuid: "x", visibility: PUBLIC) { uuid } }',
    'mutation { resetShareLink(uuid: "x") { uuid } }',
    'mutation { updateProfile(name: "x") { id } }'
  ];
  for (const query of operations) {
    const res = await visitor.gql(query);
    assert.equal(res.errors?.[0]?.extensions?.code, 'UNAUTHENTICATED', query);
  }
  const upload = await visitor.upload('a.txt', files.txt);
  assert.equal(upload.errors[0].extensions.code, 'UNAUTHENTICATED');
});

// ------------------------------------------------------------------
// OWNERSHIP
// ------------------------------------------------------------------
test('users only ever see and touch their own documents', async () => {
  const doc = await uploadOk(alice, 'alice-secret.pdf', files.pdf);
  assert.equal(doc.visibility, 'PRIVATE', 'private by default');
  assert.equal(doc.shareUrl, null);

  // Bob's list does not contain it.
  const list = await bob.gql('{ documents { total documents { uuid } } }');
  assert.ok(!list.data.documents.documents.some((d) => d.uuid === doc.uuid));

  // Bob cannot read, rename, publish, reset or delete it, even knowing the uuid.
  const v = { uuid: doc.uuid };
  assert.equal((await bob.gql('query($uuid: ID!) { document(uuid: $uuid) { uuid } }', v)).data.document, null);
  assert.equal((await bob.gql('mutation($uuid: ID!) { renameDocument(uuid: $uuid, filename: "pwned.pdf") { uuid } }', v)).data.renameDocument, null);
  assert.equal((await bob.gql('mutation($uuid: ID!) { setDocumentVisibility(uuid: $uuid, visibility: PUBLIC) { uuid } }', v)).data.setDocumentVisibility, null);
  assert.equal((await bob.gql('mutation($uuid: ID!) { resetShareLink(uuid: $uuid) { uuid } }', v)).data.resetShareLink, null);
  assert.equal((await bob.gql('mutation($uuid: ID!) { deleteDocument(uuid: $uuid) }', v)).data.deleteDocument, false);

  // ...nor download it through the REST file route.
  for (const client of [bob, visitor]) {
    const res = await client.request(`/api/documents/${doc.uuid}/content`);
    assert.ok([401, 404].includes(res.status), `status ${res.status}`);
  }

  // Nothing changed for Alice.
  const still = await alice.gql('query($uuid: ID!) { document(uuid: $uuid) { filename visibility } }', v);
  assert.deepEqual(still.data.document, { filename: 'alice-secret.pdf', visibility: 'PRIVATE' });
  const own = await alice.request(`/api/documents/${doc.uuid}/content`);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
});

test('documents without an owner (legacy) are visible to nobody', async () => {
  await Document.create({ uuid: 'legacy-1', filename: 'old.txt', contentType: 'text/plain', size: 3, data: Buffer.from('old') });
  for (const client of [alice, bob]) {
    const res = await client.gql('{ document(uuid: "legacy-1") { uuid } documents(search: "old.txt") { total } }');
    assert.equal(res.data.document, null);
    assert.equal(res.data.documents.total, 0);
  }
});

test('filters, search and sorting stay inside the user\'s documents', async () => {
  await uploadOk(bob, 'zeta.txt', files.txt);
  await uploadOk(bob, 'Alpha.txt', files.txt);
  const res = await bob.gql('{ documents(sort: NAME_ASC) { documents { filename } } byKind: documents(kind: PDF) { total } }');
  assert.deepEqual(res.data.documents.documents.map((d) => d.filename), ['Alpha.txt', 'zeta.txt']);
  assert.equal(res.data.byKind.total, 0, "Alice's PDF is not counted for Bob");
});

// ------------------------------------------------------------------
// PUBLIC SHARING
// ------------------------------------------------------------------
test('publish -> anyone with the link can view; revoke -> link is dead', async () => {
  const doc = await uploadOk(alice, 'brochure.pdf', files.pdf);
  const v = { uuid: doc.uuid };

  const published = await alice.gql('mutation($uuid: ID!) { setDocumentVisibility(uuid: $uuid, visibility: PUBLIC) { visibility shareUrl } }', v);
  const { shareUrl } = published.data.setDocumentVisibility;
  assert.match(shareUrl, /^http:\/\/localhost:5173\/s\/[A-Za-z0-9_-]{43}$/);
  const token = shareToken(shareUrl);

  // A signed-out visitor can see it - and only file details, no owner data.
  const pub = await visitor.gql('query($t: String!) { publicDocument(token: $t) { filename kind contentUrl } }', { t: token });
  assert.deepEqual(pub.data.publicDocument, { filename: 'brochure.pdf', kind: 'PDF', contentUrl: `/api/shared/${token}/content` });
  const content = await visitor.request(`/api/shared/${token}/content`);
  assert.equal(content.status, 200);
  assert.equal(Buffer.from(await content.arrayBuffer()).toString(), files.pdf.toString());

  // The owner-only route still refuses the visitor.
  assert.equal((await visitor.request(`/api/documents/${doc.uuid}/content`)).status, 401);

  // Revoke.
  await alice.gql('mutation($uuid: ID!) { setDocumentVisibility(uuid: $uuid, visibility: PRIVATE) { visibility } }', v);
  assert.equal((await visitor.gql('query($t: String!) { publicDocument(token: $t) { filename } }', { t: token })).data.publicDocument, null);
  assert.equal((await visitor.request(`/api/shared/${token}/content`)).status, 404);

  // Publishing again gives a NEW link; the old one stays dead.
  const again = await alice.gql('mutation($uuid: ID!) { setDocumentVisibility(uuid: $uuid, visibility: PUBLIC) { shareUrl } }', v);
  const newToken = shareToken(again.data.setDocumentVisibility.shareUrl);
  assert.notEqual(newToken, token);
  assert.equal((await visitor.request(`/api/shared/${token}/content`)).status, 404);
  assert.equal((await visitor.request(`/api/shared/${newToken}/content`)).status, 200);

  // Reset link: rotates the token while staying public.
  const reset = await alice.gql('mutation($uuid: ID!) { resetShareLink(uuid: $uuid) { shareUrl } }', v);
  const rotated = shareToken(reset.data.resetShareLink.shareUrl);
  assert.equal((await visitor.request(`/api/shared/${newToken}/content`)).status, 404);
  assert.equal((await visitor.request(`/api/shared/${rotated}/content`)).status, 200);

  // Deleting the document kills the link too.
  await alice.gql('mutation($uuid: ID!) { deleteDocument(uuid: $uuid) }', v);
  assert.equal((await visitor.request(`/api/shared/${rotated}/content`)).status, 404);
});

test('a public link only opens its own document', async () => {
  const pub = await uploadOk(alice, 'public.txt', files.txt);
  const priv = await uploadOk(alice, 'private.txt', Buffer.from('top secret'));
  const res = await alice.gql('mutation($uuid: ID!) { setDocumentVisibility(uuid: $uuid, visibility: PUBLIC) { shareUrl } }', { uuid: pub.uuid });
  const token = shareToken(res.data.setDocumentVisibility.shareUrl);

  // The token is not a key to anything else.
  assert.equal((await visitor.request(`/api/shared/${priv.uuid}/content`)).status, 404);
  assert.equal((await visitor.request(`/api/documents/${priv.uuid}/content`)).status, 401);
  const anon = await visitor.gql(`{ documents { total } }`);
  assert.equal(anon.errors[0].extensions.code, 'UNAUTHENTICATED');
  // Guessing tokens: malformed and random tokens find nothing.
  for (const guess of ['1', pub.uuid, 'A'.repeat(43), token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
    assert.equal((await visitor.request(`/api/shared/${encodeURIComponent(guess)}/content`)).status, 404, guess);
  }
});

// ------------------------------------------------------------------
// SAFE SERVING
// ------------------------------------------------------------------
test('risky legacy content types are always downloaded, never rendered', async () => {
  const doc = await Document.create({
    uuid: 'legacy-html',
    ownerId: (await mongoose.model('User').findOne({ email: 'alice@example.com' }))._id,
    filename: 'page.html',
    contentType: 'text/html',
    size: 30,
    data: Buffer.from('<script>alert(1)</script>')
  });
  const res = await alice.request(`/api/documents/${doc.uuid}/content`);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

// ------------------------------------------------------------------
// UPLOAD VALIDATION
// ------------------------------------------------------------------
test('uploads are validated on the server', async () => {
  const cases = [
    ['too-big.pdf', Buffer.concat([files.pdf, Buffer.alloc(20 * 1024 * 1024)]), /too large/],
    ['script.html', Buffer.from('<html></html>'), /not supported/],
    ['fake.pdf', Buffer.from('MZ this is an exe'), /does not look like a \.pdf/],
    ['fake.png', files.pdf, /does not look like a \.png/],
    ['empty.txt', Buffer.alloc(0), /empty/],
    ['binary.txt', Buffer.from([0x00, 0x01, 0x02]), /does not look like a \.txt/]
  ];
  for (const [name, bytes, message] of cases) {
    const res = await alice.upload(name, bytes);
    assert.ok(res.errors, `${name} should be rejected`);
    assert.match(res.errors[0].message, message, name);
  }
});

test('the server decides the content type, and strips paths from names', async () => {
  const doc = await uploadOk(alice, '../../etc/photo.png', files.png);
  assert.equal(doc.filename, 'photo.png');
  assert.equal(doc.contentType, 'image/png');
  assert.equal(doc.kind, 'IMAGE');
});

test('repeating an upload with the same uploadId does not create a duplicate', async () => {
  const uploadId = 'retry-test-0001';
  const [a, b] = await Promise.all([
    alice.upload('report.txt', files.txt, uploadId),
    alice.upload('report.txt', files.txt, uploadId)
  ]);
  assert.equal(a.data.uploadDocument.uuid, b.data.uploadDocument.uuid);
  assert.equal(await Document.countDocuments({ uploadId }), 1);
  const gridFiles = await mongoose.connection.db.collection('files.files').countDocuments({ filename: a.data.uploadDocument.uuid });
  assert.equal(gridFiles, 1, 'no orphaned file bytes');
});
