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
  async sendCodes(to, { game, saves }) {
    sent.push({ kind: 'recovery', to, game, saves });
  },
  async sendEmailLinked(to, save) {
    sent.push({ kind: 'linked', to, save });
  },
};

before(async () => {
  if (!URL) return;
  pool = createPool({ connectionString: URL });
  await pool.query('DROP TABLE IF EXISTS saves, sessions, accounts, events, schema_migrations CASCADE');
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
    ['001_init.sql', '002_code_encrypted.sql', '003_events.sql'],
  );
});

test('a new save gets a grouped code; the database holds its hash and no plain code; no cookie is set', { skip }, async () => {
  const res = await call('POST', '/saves/driftworks', { body: {} });
  assert.equal(res.status, 201);
  assert.match(res.body.code, /^\d{4} \d{4} \d{4} \d{4}$/);
  assert.equal(res.headers.get('set-cookie'), null);
  const digits = res.body.code.replace(/ /g, '');
  const { rows } = await pool.query('SELECT * FROM saves');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].code_hash, createHasher(PEPPER).code(digits));
  assert.ok(!JSON.stringify(rows).includes(digits), 'the code is not stored in plain text');

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
  assert.deepEqual(sent, [{ kind: 'linked', to: 'player@example.com', save: { game: 'Driftworks', name: 'Aurel Mining', code } }]);
  const row = (await pool.query('SELECT email_hash FROM saves')).rows[0];
  assert.deepEqual(row.email_hash, createHasher(PEPPER).email('player@example.com'));
  assert.equal((await call('GET', '/saves/driftworks', { code })).body.hasEmail, true);
  assert.equal((await call('PUT', '/saves/driftworks/email', { code, body: { email: 'nope' } })).status, 400);
  assert.equal((await call('DELETE', '/saves/driftworks/email', { code })).status, 204);
  assert.equal((await call('GET', '/saves/driftworks', { code })).body.hasEmail, false);
});

test('recovery mails the existing codes of every save of the address, and they keep working', { skip }, async () => {
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
  assert.equal(sent[0].game, 'Driftworks');
  assert.deepEqual(sent[0].saves.map((s) => s.code).sort(), [one, two].sort());
  assert.equal(sent[0].saves.find((s) => s.code === one).name, 'First');

  assert.equal((await call('GET', '/saves/driftworks', { code: one })).body.data.credits, 42, 'the code still works');
  assert.equal((await call('GET', '/saves/driftworks', { code: two })).status, 200);
  assert.equal((await call('GET', '/saves/driftworks', { code: other })).status, 200, 'other saves are untouched');
});

test('codes are stored encrypted, not in plain text; a save from before that gets it on its next use', { skip }, async () => {
  const code = await newSave();
  const digits = code.replace(/\D/g, '');
  const hasher = createHasher(PEPPER);
  const { rows } = await pool.query('SELECT code_enc FROM saves');
  assert.ok(!rows[0].code_enc.toString('latin1').includes(digits));
  assert.equal(hasher.decryptCode(rows[0].code_enc), digits);

  await pool.query('UPDATE saves SET code_enc = NULL');
  assert.equal((await call('GET', '/saves/driftworks', { code })).status, 200);
  const after = (await pool.query('SELECT code_enc FROM saves')).rows[0].code_enc;
  assert.equal(hasher.decryptCode(after), digits);
});

test('recovery gives a new code only to a save whose code the server cannot read back', { skip }, async () => {
  const kept = await newSave();
  const old = await newSave();
  for (const code of [kept, old]) await call('PUT', '/saves/driftworks/email', { code, body: { email: 'mixed@example.com' } });
  await waitForMail();
  sent.length = 0;
  await pool.query('UPDATE saves SET code_enc = NULL WHERE code_hash = $1', [createHasher(PEPPER).code(old.replace(/\D/g, ''))]);

  assert.equal((await call('POST', '/recovery', { body: { email: 'mixed@example.com' } })).status, 202);
  await waitForMail();
  const codes = sent[0].saves.map((s) => s.code);
  assert.ok(codes.includes(kept));
  assert.ok(!codes.includes(old));
  assert.equal((await call('GET', '/saves/driftworks', { code: kept })).status, 200);
  assert.equal((await call('GET', '/saves/driftworks', { code: old })).status, 401, 'the unreadable code was replaced');
  const fresh = codes.find((c) => c !== kept);
  assert.equal((await call('GET', '/saves/driftworks', { code: fresh })).status, 200);
});

test('changing the code revokes the old one, keeps the save, and recovery mails the new one', { skip }, async () => {
  const code = await newSave();
  await call('PUT', '/saves/driftworks', { code, body: { baseRevision: 0, data: save(7), summary: { name: 'Leaked' } } });
  await call('PUT', '/saves/driftworks/email', { code, body: { email: 'change@example.com' } });
  await waitForMail();
  sent.length = 0;

  const res = await call('POST', '/saves/driftworks/code', { code, body: {} });
  assert.equal(res.status, 200);
  assert.match(res.body.code, /^\d{4} \d{4} \d{4} \d{4}$/);
  assert.notEqual(res.body.code, code);
  assert.equal((await call('GET', '/saves/driftworks', { code })).status, 401, 'the old code is revoked');
  const now = await call('GET', '/saves/driftworks', { code: res.body.code });
  assert.equal(now.body.data.credits, 7);
  assert.equal(now.body.revision, 1);
  assert.equal(now.body.hasEmail, true, 'the email stays linked');

  await call('POST', '/recovery', { body: { email: 'change@example.com' } });
  await waitForMail();
  assert.deepEqual(sent[0].saves, [{ name: 'Leaked', code: res.body.code }]);
});

test('recovery sends one mail per game, in that game\'s name', { skip }, async () => {
  const drift = await newSave();
  const snake = (await call('POST', '/saves/snake', { body: {} })).body.code;
  await call('PUT', '/saves/driftworks/email', { code: drift, body: { email: 'two@example.com' } });
  await call('PUT', '/saves/snake/email', { code: snake, body: { email: 'two@example.com' } });
  await waitForMail();
  assert.deepEqual(sent.map((m) => m.save.game).sort(), ['Driftworks', 'Snake']);
  sent.length = 0;

  await call('POST', '/recovery', { body: { email: 'two@example.com' } });
  for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent.map((m) => [m.game, m.saves.map((s) => s.code)]).sort(), [
    ['Driftworks', [drift]],
    ['Snake', [snake]],
  ]);
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
