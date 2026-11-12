// Cloud save API against a real PostgreSQL. Runs when TEST_DATABASE_URL is
// set (CI sets it); skipped otherwise.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { createPool, migrate } = require('../../server/db.js');
const { createCloudRouter } = require('../../server/cloud.js');
const { createHasher } = require('../../server/crypto.js');

const URL = process.env.TEST_DATABASE_URL;
const PEPPER = 'a-test-pepper-that-is-long-enough-123';
const skip = URL ? false : 'TEST_DATABASE_URL is not set';

let pool;
let router;
let server;
let base;
const sent = [];
const mailer = {
  async sendNewCodes(to, saves) {
    sent.push({ kind: 'recovery', to, saves });
  },
  async sendEmailLinked(to, save) {
    sent.push({ kind: 'linked', to, save });
  },
};

before(async () => {
  if (!URL) return;
  pool = createPool({ connectionString: URL });
  await pool.query('DROP TABLE IF EXISTS saves, sessions, accounts, schema_migrations CASCADE');
  await migrate(pool);
  const app = express();
  router = createCloudRouter({
    pool,
    pepper: PEPPER,
    mailer,
    maxSaveBytes: 10_000,
    limits: { wrongCode: { limit: 5 }, recovery: { limit: 2 }, create: { limit: 1000 } },
  });
  app.use('/api', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!URL) return;
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  if (!URL) return;
  await pool.query('TRUNCATE saves');
  sent.length = 0;
  router.resetLimits();
});

async function call(method, path, { code, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(code ? { authorization: `Code ${code}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function newSave() {
  const res = await call('POST', '/saves/driftworks', { body: {} });
  assert.equal(res.status, 201);
  return res.body.code;
}

async function waitForMail() {
  for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 30));
}

const save = (credits) => ({ version: 7, credits, ships: [] });

test('migrations are applied once and are safe to run again', { skip }, async () => {
  assert.deepEqual(await migrate(pool), []);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  assert.deepEqual(
    rows.map((r) => r.name),
    ['001_init.sql'],
  );
});

test('a new save gets a grouped code; the database holds only its hash; no cookie is set', { skip }, async () => {
  const res = await call('POST', '/saves/driftworks', { body: {} });
  assert.equal(res.status, 201);
  assert.match(res.body.code, /^\d{4} \d{4} \d{4} \d{4}$/);
  assert.equal(res.headers.get('set-cookie'), null);
  const digits = res.body.code.replace(/ /g, '');
  const { rows } = await pool.query('SELECT * FROM saves');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].code_hash, createHasher(PEPPER).code(digits));
  assert.ok(!JSON.stringify(rows).includes(digits), 'the code is not stored');

  const empty = await call('GET', '/saves/driftworks', { code: res.body.code });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.revision, 0);
  assert.equal(empty.body.data, null);
});

test('a code works from any device, with spaces or dashes; wrong or missing codes are refused', { skip }, async () => {
  const code = await newSave();
  assert.equal((await call('GET', '/saves/driftworks', { code: code.replace(/ /g, '-') })).status, 200);
  assert.equal((await call('GET', '/saves/driftworks', { code: '0000 0000 0000 0000' })).status, 401);
  assert.equal((await call('GET', '/saves/driftworks', { code: '12' })).status, 401);
  assert.equal((await call('GET', '/saves/driftworks')).status, 401);
  assert.equal((await call('GET', '/saves/snake', { code })).status, 401, 'a code only opens its own game');
  assert.equal((await call('GET', '/saves/Bad!', { code })).status, 404);
});

test('guessing codes is rate limited, and then even a right code has to wait', { skip }, async () => {
  const code = await newSave();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call('GET', '/saves/driftworks', { code: '1111 1111 1111 1111' })).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.equal((await call('GET', '/saves/driftworks', { code })).status, 429);
});

test('writes must be JSON', { skip }, async () => {
  const res = await fetch(`${base}/saves/driftworks`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(res.status, 415);
});

test('saves: first write, update on the right revision, 409 on a stale one', { skip }, async () => {
  const code = await newSave();
  const first = await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 0, data: save(100), summary: { name: 'Aurel Mining', credits: 100, act: 1, ships: 3, lastPlayed: 5, junk: 'x' }, device: 'phone-1' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 1);

  // Another device also thinks the save is still empty: conflict, with what is there.
  const stale = await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 0, data: save(5), summary: { credits: 5 } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 1);
  assert.deepEqual(stale.body.summary, { name: 'Aurel Mining', credits: 100, act: 1, ships: 3, lastPlayed: 5 });
  assert.equal(stale.body.device, 'phone-1');

  // Having chosen, it writes on top of revision 1.
  const chosen = await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 1, data: save(5), summary: { credits: 5 } } });
  assert.equal(chosen.body.revision, 2);
  const got = await call('GET', '/saves/driftworks', { code });
  assert.equal(got.body.revision, 2);
  assert.equal(got.body.data.credits, 5);
  assert.equal((await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 1, data: save(150) } })).status, 409);
});

test('each code opens only its own save; saves are size limited', { skip }, async () => {
  const a = await newSave();
  const b = await newSave();
  await call('PUT', '/saves/driftworks', { code: a, body: { baseRevision: 0, data: save(1) } });
  assert.equal((await call('GET', '/saves/driftworks', { code: b })).body.data, null);
  assert.equal((await call('PUT', '/saves/driftworks', { code: a, body: { baseRevision: 1, data: { big: 'x'.repeat(10_001) } } })).status, 413);
  assert.equal((await call('PUT', '/saves/driftworks', { code: a, body: { baseRevision: 1, data: { big: 'x'.repeat(20_000) } } })).status, 413);
});

test('linking an email stores only its hash and mails a confirmation with the code', { skip }, async () => {
  const code = await newSave();
  await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 0, data: save(1), summary: { name: 'Aurel Mining' } } });
  assert.equal((await call('PUT', '/saves/driftworks/email', { code, body: { email: 'Player@Example.com ' } })).status, 204);
  await waitForMail();
  assert.deepEqual(sent, [{ kind: 'linked', to: 'player@example.com', save: { name: 'Aurel Mining', code } }]);
  const row = (await pool.query('SELECT email_hash FROM saves')).rows[0];
  assert.deepEqual(row.email_hash, createHasher(PEPPER).email('player@example.com'));
  assert.equal((await call('GET', '/saves/driftworks', { code })).body.hasEmail, true);
  assert.equal((await call('PUT', '/saves/driftworks/email', { code, body: { email: 'nope' } })).status, 400);
  assert.equal((await call('DELETE', '/saves/driftworks/email', { code })).status, 204);
  assert.equal((await call('GET', '/saves/driftworks', { code })).body.hasEmail, false);
});

test('recovery mails new codes for every save of the address; the old codes stop working', { skip }, async () => {
  const one = await newSave();
  const two = await newSave();
  const other = await newSave();
  for (const code of [one, two]) await call('PUT', '/saves/driftworks/email', { code, body: { email: 'player@example.com' } });
  await call('PUT', '/saves/driftworks', { code: one, body: { baseRevision: 0, data: save(42), summary: { name: 'First' } } });
  await waitForMail();
  sent.length = 0;

  // An unknown address gets the same answer and no mail.
  assert.equal((await call('POST', '/recovery', { body: { email: 'nobody@example.com' } })).status, 202);
  assert.equal((await call('POST', '/recovery', { body: { email: 'player@example.com' } })).status, 202);
  await waitForMail();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'recovery');
  assert.equal(sent[0].to, 'player@example.com');
  assert.equal(sent[0].saves.length, 2);
  const first = sent[0].saves.find((s) => s.name === 'First');
  assert.notEqual(first.code, one);

  assert.equal((await call('GET', '/saves/driftworks', { code: one })).status, 401, 'old code stops working');
  assert.equal((await call('GET', '/saves/driftworks', { code: two })).status, 401);
  assert.equal((await call('GET', '/saves/driftworks', { code: first.code })).body.data.credits, 42, 'the save itself is kept');
  assert.equal((await call('GET', '/saves/driftworks', { code: other })).status, 200, 'other saves are untouched');
});

test('recovery is rate limited per address', { skip }, async () => {
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await call('POST', '/recovery', { body: { email: 'ratelimit@example.com' } })).status);
  assert.deepEqual(statuses, [202, 202, 429]);
});

test('deleting a cloud save removes it and its code', { skip }, async () => {
  const code = await newSave();
  await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 0, data: save(1) } });
  assert.equal((await call('DELETE', '/saves/driftworks', { code })).status, 204);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM saves')).rows[0].n, 0);
  assert.equal((await call('GET', '/saves/driftworks', { code })).status, 401);
});
