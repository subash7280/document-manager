import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { appleClientSecret } from '../auth/providers.js';
import { safeReturnTo } from '../auth/routes.js';
import { cleanFilename, detectFileType, servingRules } from '../documents/fileTypes.js';
import { isShareToken, newShareToken } from '../documents/access.js';
import { files } from './helpers.js';

test('Apple client secret is a valid ES256 JWT for Apple', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwt = appleClientSecret({
    teamId: 'TEAM123456',
    clientId: 'com.example.docs.web',
    keyId: 'KEY1234567',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
  });
  const [header, payload, signature] = jwt.split('.');
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
  assert.deepEqual(decode(header), { alg: 'ES256', kid: 'KEY1234567' });
  const claims = decode(payload);
  assert.equal(claims.iss, 'TEAM123456');
  assert.equal(claims.sub, 'com.example.docs.web');
  assert.equal(claims.aud, 'https://appleid.apple.com');
  assert.ok(claims.exp > claims.iat);
  const valid = crypto.verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  assert.ok(valid);
});

test('safeReturnTo only allows same-site paths', () => {
  assert.equal(safeReturnTo('/upload'), '/upload');
  assert.equal(safeReturnTo('/d/abc?x=1'), '/d/abc?x=1');
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', undefined]) {
    assert.equal(safeReturnTo(bad), '/');
  }
});

test('file type detection uses extension AND content', () => {
  assert.deepEqual(detectFileType('a.PNG', files.png), { contentType: 'image/png' });
  assert.deepEqual(detectFileType('a.pdf', files.pdf), { contentType: 'application/pdf' });
  assert.deepEqual(detectFileType('notes.md', Buffer.from('# Hi ✓')), { contentType: 'text/markdown' });
  assert.ok(detectFileType('a.exe', files.pdf).error);
  assert.ok(detectFileType('noextension', files.pdf).error);
  assert.ok(detectFileType('a.svg', Buffer.from('<html><script></script></html>')).error);
  assert.deepEqual(detectFileType('a.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), { contentType: 'image/svg+xml' });
});

test('a multi-byte character cut at the 64 KB sample edge is still valid text', () => {
  const text = Buffer.concat([Buffer.alloc(64 * 1024 - 1, 'a'), Buffer.from('é and more')]);
  assert.deepEqual(detectFileType('long.txt', text), { contentType: 'text/plain' });
});

test('cleanFilename removes paths and control characters', () => {
  assert.equal(cleanFilename('..\\..\\Windows\\evil.pdf'), 'evil.pdf');
  assert.equal(cleanFilename('a\u0000b\u001f.txt'), 'ab.txt');
  assert.equal(cleanFilename('x'.repeat(300)).length, 255);
});

test('only safe types are served inline', () => {
  assert.deepEqual(servingRules('image/png'), { inline: true, contentType: 'image/png' });
  assert.deepEqual(servingRules('text/csv'), { inline: true, contentType: 'text/plain; charset=utf-8' });
  for (const risky of ['text/html', 'application/xhtml+xml', 'application/javascript', undefined]) {
    assert.deepEqual(servingRules(risky), { inline: false, contentType: 'application/octet-stream' });
  }
});

test('share tokens are 256-bit, URL-safe and unique', () => {
  const tokens = new Set(Array.from({ length: 1000 }, newShareToken));
  assert.equal(tokens.size, 1000);
  for (const token of tokens) assert.ok(isShareToken(token));
  assert.ok(!isShareToken('../../etc'));
});
