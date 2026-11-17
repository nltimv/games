// CORS for the Android and iOS apps (server/cors.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { createAppCors, parseOrigins, DEFAULT_APP_ORIGINS } = require('../../server/cors.js');

async function withServer(origins, fn) {
  const app = express();
  app.use('/api', createAppCors(origins));
  app.get('/api/config', (_req, res) => res.json({ cloud: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('parseOrigins: defaults, a list, and none', () => {
  assert.deepEqual(parseOrigins(undefined), DEFAULT_APP_ORIGINS);
  assert.deepEqual(parseOrigins(''), DEFAULT_APP_ORIGINS);
  assert.deepEqual(parseOrigins(' capacitor://localhost , https://app.example '), ['capacitor://localhost', 'https://app.example']);
  assert.deepEqual(parseOrigins('none'), []);
});

test('the app origins get CORS headers and a preflight answer', async () => {
  await withServer(DEFAULT_APP_ORIGINS, async (base) => {
    for (const origin of DEFAULT_APP_ORIGINS) {
      const res = await fetch(`${base}/config`, { headers: { origin } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
      assert.match(res.headers.get('vary') ?? '', /Origin/);

      const pre = await fetch(`${base}/saves/driftworks`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type' },
      });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get('access-control-allow-origin'), origin);
      assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
      assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
    }
  });
});

test('other origins get no CORS headers', async () => {
  await withServer(DEFAULT_APP_ORIGINS, async (base) => {
    const res = await fetch(`${base}/config`, { headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${base}/config`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });
});

test('APP_ORIGINS=none turns CORS off', async () => {
  await withServer(parseOrigins('none'), async (base) => {
    const res = await fetch(`${base}/config`, { headers: { origin: 'capacitor://localhost' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
