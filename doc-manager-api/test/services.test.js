import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientInfo, describeClient } from '../activity/clientInfo.js';
import { normalizeAppConfig } from '../services/appConfig.js';
import { redactPath } from '../services/exceptions.js';
import { jobsStatus, nextRunDelay, runHealthCheck } from '../services/jobs/index.js';
import { USER_AGENTS } from './helpers.js';

const fakeReq = (headers) => ({ ip: '203.0.113.7', get: (name) => headers[name.toLowerCase()] });

test('application_configs is cleaned up', () => {
  assert.deepEqual(normalizeAppConfig({ app_name: ' Docs ', exception_mail: ['A@x.com', 'a@x.com', '', 'bad', 5] }),
    { appName: 'Docs', exceptionMail: ['a@x.com'], found: true });
  assert.deepEqual(normalizeAppConfig({ exception_mail: 'one@x.com' }), { appName: 'Document Manager', exceptionMail: ['one@x.com'], found: true });
  assert.deepEqual(normalizeAppConfig(null), { appName: 'Document Manager', exceptionMail: [], found: false });
});

test('browser, system and device are read from the request', () => {
  const iphone = clientInfo(fakeReq({ 'user-agent': USER_AGENTS.iphone }));
  assert.equal(describeClient(iphone), 'Mobile Safari 17 on iOS 17.5 (Mobile, Apple iPhone)');
  assert.equal(iphone.ip, '203.0.113.7');

  const android = clientInfo(fakeReq({
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua-platform-version': '"14.0.0"',
    'sec-ch-ua-model': '"Pixel 8"',
    'sec-ch-ua-mobile': '?1'
  }));
  assert.equal(describeClient(android), 'Chrome 130 on Android 14 (Mobile, Pixel 8)');
  assert.equal(clientInfo(fakeReq({})).deviceType, 'OTHER');
});

test('secrets are removed from addresses in emails', () => {
  const token = 'abcDEF123_-'.repeat(4);
  assert.equal(redactPath(`/api/shared/${token}/content?download=1`), '/api/shared/[token]/content');
  assert.equal(redactPath(`/s/${token}`), '/s/[token]');
  assert.equal(redactPath('/auth/google/callback?code=secret&state=x'), '/auth/google/callback');
});

test('an 8-hour schedule runs at 00:00, 08:00 and 16:00 UTC', () => {
  const eightHours = 8 * 60 * 60 * 1000;
  const at = (iso) => Date.parse(iso);
  assert.equal(nextRunDelay(eightHours, at('2026-10-28T07:00:00Z')), 60 * 60 * 1000);
  assert.equal(nextRunDelay(eightHours, at('2026-10-28T08:00:00Z')), eightHours);
  assert.equal(nextRunDelay(eightHours, at('2026-10-28T23:30:00Z')), 30 * 60 * 1000);
});

test('the health check job emails when the API is unhealthy or unreachable', async () => {
  const reports = [];
  const reportException = async (r) => { reports.push(r); };

  const healthy = async () => new Response(JSON.stringify({ status: 'ok', checks: { database: { latencyMs: 2 } } }), { status: 200 });
  await runHealthCheck({ url: 'http://x/app/health-check', reportException, fetchImpl: healthy });
  assert.equal(reports.length, 0);
  assert.equal(jobsStatus().keepAlive.lastStatus, 'ok');

  const down = async () => new Response(JSON.stringify({ status: 'down', checks: { database: { status: 'down' } } }), { status: 503 });
  await runHealthCheck({ url: 'http://x/app/health-check', reportException, fetchImpl: down });
  assert.equal(reports.length, 1);
  assert.match(reports[0].error.message, /HTTP 503/);

  const unreachable = async () => { throw new Error('ECONNREFUSED'); };
  await runHealthCheck({ url: 'http://x/app/health-check', reportException, fetchImpl: unreachable });
  assert.equal(reports.length, 2);
  assert.equal(jobsStatus().keepAlive.lastStatus, 'unreachable');
});
