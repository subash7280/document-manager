import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import Folder from '../models/Folder.js';
import { Client, files, profile, startTestServer } from './helpers.js';

let server;
let alice;
let bob;

before(async () => {
  server = await startTestServer();
  alice = new Client(server.baseUrl);
  bob = new Client(server.baseUrl);
  await alice.signIn(server.providers.google, profile('alice'));
  await bob.signIn(server.providers.google, profile('bob'));
});
after(() => server.stop());

const ok = (res) => {
  assert.equal(res.errors, undefined, JSON.stringify(res.errors));
  return res.data;
};
const create = async (client, name, parentId = null) =>
  ok(await client.gql('mutation($name: String!, $parentId: ID) { createFolder(name: $name, parentId: $parentId) { id name parentId path { id name } } }', { name, parentId })).createFolder;
const uploadTo = async (client, name, folderId) => {
  const res = await client.upload(name, files.txt, undefined, folderId);
  return ok(res).uploadDocument;
};
const LIST = `query($folderId: ID, $parentId: ID) {
  documents(folderId: $folderId) { total documents { filename folder { name } } }
  folders(parentId: $parentId) { name folderCount documentCount }
}`;

test('folders nest, and documents can be uploaded into them', async () => {
  const proofs = await create(alice, 'Proofs');
  const tenth = await create(alice, '10th', proofs.id);
  const twelfth = await create(alice, '12th', proofs.id);
  assert.deepEqual(tenth.path, [{ id: proofs.id, name: 'Proofs' }]);

  await uploadTo(alice, 'marksheet-10.txt', tenth.id);
  await uploadTo(alice, 'transfer-10.txt', tenth.id); // two in one folder share one folder lookup
  await uploadTo(alice, 'marksheet-12.txt', twelfth.id);
  await uploadTo(alice, 'loose.txt', null);

  const inTenth = ok(await alice.gql(LIST, { folderId: tenth.id, parentId: tenth.id }));
  assert.deepEqual(inTenth.documents.documents.map((d) => d.filename).sort(), ['marksheet-10.txt', 'transfer-10.txt']);
  assert.deepEqual(inTenth.documents.documents.map((d) => d.folder.name), ['10th', '10th']);

  const top = ok(await alice.gql(LIST, { folderId: 'root', parentId: 'root' }));
  assert.deepEqual(top.documents.documents.map((d) => d.filename), ['loose.txt']);
  assert.deepEqual(top.folders, [{ name: 'Proofs', folderCount: 2, documentCount: 0 }]);

  const everywhere = ok(await alice.gql(LIST, {}));
  assert.equal(everywhere.documents.total, 4);
  assert.equal(everywhere.folders.length, 3);

  // Search finds folders at any depth.
  const found = ok(await alice.gql('{ folders(search: "12") { name path { name } } }'));
  assert.deepEqual(found.folders, [{ name: '12th', path: [{ name: 'Proofs' }] }]);
});

test('folder names are unique per parent, ignoring case', async () => {
  const parent = await create(alice, 'Unique test');
  await create(alice, 'Bills', parent.id);
  const dup = await alice.gql('mutation($p: ID) { createFolder(name: "  BILLS ", parentId: $p) { id } }', { p: parent.id });
  assert.match(dup.errors[0].message, /already exists/);
  // Same name in a different place is fine.
  await create(alice, 'Bills');
  const blank = await alice.gql('mutation { createFolder(name: "   ") { id } }');
  assert.equal(blank.errors[0].extensions.code, 'BAD_USER_INPUT');
});

test('rename and move documents and folders', async () => {
  const a = await create(alice, 'Move A');
  const b = await create(alice, 'Move B');
  const child = await create(alice, 'Child', a.id);
  const grandchild = await create(alice, 'Grandchild', child.id);
  const doc = await uploadTo(alice, 'move-me.txt', null);

  const moved = ok(await alice.gql('mutation($u: ID!, $f: ID) { moveDocument(uuid: $u, folderId: $f) { folderId folder { name } } }', { u: doc.uuid, f: grandchild.id }));
  assert.equal(moved.moveDocument.folder.name, 'Grandchild');

  // Move the "Child" subtree from A to B: the grandchild's path follows.
  ok(await alice.gql('mutation($id: ID!, $p: ID) { moveFolder(id: $id, parentId: $p) { id } }', { id: child.id, p: b.id }));
  const gc = ok(await alice.gql('query($id: ID!) { folder(id: $id) { path { name } } }', { id: grandchild.id }));
  assert.deepEqual(gc.folder.path.map((p) => p.name), ['Move B', 'Child']);

  // A folder cannot go inside itself or its own subfolder.
  for (const target of [child.id, grandchild.id]) {
    const res = await alice.gql('mutation($id: ID!, $p: ID) { moveFolder(id: $id, parentId: $p) { id } }', { id: child.id, p: target });
    assert.match(res.errors[0].message, /into itself/);
  }

  const renamed = ok(await alice.gql('mutation($id: ID!) { renameFolder(id: $id, name: "Renamed child") { name } }', { id: child.id }));
  assert.equal(renamed.renameFolder.name, 'Renamed child');

  // Back to the top level with "root".
  const top = ok(await alice.gql('mutation($id: ID!) { moveFolder(id: $id, parentId: "root") { parentId path { id } } }', { id: child.id }));
  assert.deepEqual(top.moveFolder, { parentId: null, path: [] });
  const gc2 = ok(await alice.gql('query($id: ID!) { folder(id: $id) { path { name } } }', { id: grandchild.id }));
  assert.deepEqual(gc2.folder.path.map((p) => p.name), ['Renamed child']);
});

test('deleting a folder deletes everything inside it, including file bytes', async () => {
  const root = await create(alice, 'Delete me');
  const inner = await create(alice, 'Inner', root.id);
  const d1 = await uploadTo(alice, 'one.txt', root.id);
  const d2 = await uploadTo(alice, 'two.txt', inner.id);
  const keep = await uploadTo(alice, 'keep.txt', null);

  const contents = ok(await alice.gql('query($id: ID!) { folder(id: $id) { contents { folders documents } } }', { id: root.id }));
  assert.deepEqual(contents.folder.contents, { folders: 1, documents: 2 });

  assert.equal(ok(await alice.gql('mutation($id: ID!) { deleteFolder(id: $id) }', { id: root.id })).deleteFolder, true);
  assert.equal(await Folder.countDocuments({ _id: { $in: [root.id, inner.id] } }), 0);
  assert.equal(await Document.countDocuments({ uuid: { $in: [d1.uuid, d2.uuid] } }), 0);
  assert.equal(await Document.countDocuments({ uuid: keep.uuid }), 1);
  const bytes = await mongoose.connection.db.collection('files.files').countDocuments({ filename: { $in: [d1.uuid, d2.uuid] } });
  assert.equal(bytes, 0, 'GridFS files are removed');
});

test('folders are private to their owner', async () => {
  const secret = await create(alice, 'Alice private');
  const doc = await uploadTo(alice, 'in-secret.txt', secret.id);
  const v = { id: secret.id };

  assert.equal(ok(await bob.gql('query($id: ID!) { folder(id: $id) { id } }', v)).folder, null);
  assert.equal(ok(await bob.gql('query($id: ID) { documents(folderId: $id) { total } }', v)).documents.total, 0);
  assert.equal(ok(await bob.gql('query($id: ID) { folders(parentId: $id) { id } }', v)).folders.length, 0);
  assert.ok(!ok(await bob.gql('{ folders { id } }')).folders.some((f) => f.id === secret.id));
  assert.equal(ok(await bob.gql('mutation($id: ID!) { renameFolder(id: $id, name: "x") { id } }', v)).renameFolder, null);
  assert.equal(ok(await bob.gql('mutation($id: ID!) { deleteFolder(id: $id) }', v)).deleteFolder, false);
  assert.equal(ok(await bob.gql('mutation($id: ID!) { moveFolder(id: $id, parentId: "root") { id } }', v)).moveFolder, null);

  // Bob cannot put things INTO Alice's folder either.
  const upload = await bob.upload('sneaky.txt', files.txt, undefined, secret.id);
  assert.match(upload.errors[0].message, /no longer exists/);
  const bobFolder = await create(bob, 'Bob folder');
  const into = await bob.gql('mutation($id: ID!, $p: ID) { moveFolder(id: $id, parentId: $p) { id } }', { id: bobFolder.id, p: secret.id });
  assert.match(into.errors[0].message, /no longer exists/);
  const bobDoc = await uploadTo(bob, 'bob.txt', null);
  const docInto = await bob.gql('mutation($u: ID!, $f: ID) { moveDocument(uuid: $u, folderId: $f) { uuid } }', { u: bobDoc.uuid, f: secret.id });
  assert.match(docInto.errors[0].message, /no longer exists/);

  // And Alice's folder is untouched.
  const still = ok(await alice.gql('query($id: ID) { documents(folderId: $id) { documents { uuid } } }', v));
  assert.deepEqual(still.documents.documents.map((d) => d.uuid), [doc.uuid]);
});

test('folder operations require sign-in', async () => {
  const visitor = new Client(server.baseUrl);
  for (const query of ['{ folders { id } }', 'mutation { createFolder(name: "x") { id } }', '{ activityLogs { total } }']) {
    const res = await visitor.gql(query);
    assert.equal(res.errors?.[0]?.extensions?.code, 'UNAUTHENTICATED', query);
  }
});
