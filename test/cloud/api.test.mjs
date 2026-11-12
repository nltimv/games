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
  async sendNewNumber(to, number) {
    sent.push({ to, number });
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
      secureCookie: false,
    limits: { login: { limit: 5 }, recovery: { limit: 2 }, signup: { limit: 1000 } },
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
  await pool.query('TRUNCATE saves, sessions, accounts');
  sent.length = 0;
  router.resetLimits();
});

/** A tiny client that keeps its session cookie, like one browser. */
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
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

test('sign up returns a grouped number once and logs in; the database holds only hashes', { skip }, async () => {
  const call = client();
  const res = await call('POST', '/account', {});
  assert.equal(res.status, 201);
  assert.match(res.body.number, /^\d{4} \d{4} \d{4} \d{4}$/);
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Strict/i);
  assert.equal((await call('GET', '/account')).body.hasEmail, false);

  const digits = res.body.number.replace(/ /g, '');
  const { rows } = await pool.query('SELECT * FROM accounts');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].number_hash, createHasher(PEPPER).number(digits));
  const dump = JSON.stringify(rows) + JSON.stringify((await pool.query('SELECT * FROM sessions')).rows);
  assert.ok(!dump.includes(digits), 'the number is not stored');
});

test('log in with the number on another device; wrong numbers are refused', { skip }, async () => {
  const { body } = await client()('POST', '/account', {});
  const other = client();
  assert.equal((await other('GET', '/account')).status, 401);
  assert.equal((await other('POST', '/session', { number: '0000 0000 0000 0000' })).status, 401);
  assert.equal((await other('POST', '/session', { number: '12' })).status, 400);
  assert.equal((await other('POST', '/session', { number: body.number.replace(/ /g, '-') })).status, 204);
  assert.equal((await other('GET', '/account')).status, 200);
  assert.equal((await other('DELETE', '/session')).status, 204);
  assert.equal((await other('GET', '/account')).status, 401);
});

test('log in is rate limited', { skip }, async () => {
  const call = client();
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/session', { number: '1111 1111 1111 1111' });
  assert.equal(last.status, 429);
});

test('mutating requests must be JSON', { skip }, async () => {
  const res = await fetch(`${base}/account`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(res.status, 415);
});

test('saves: first write, update on the right revision, 409 on a stale one', { skip }, async () => {
  const phone = client();
  const { body } = await phone('POST', '/account', {});
  const laptop = client();
  await laptop('POST', '/session', { number: body.number });

  assert.equal((await phone('GET', '/saves/driftworks')).status, 404);
  const first = await phone('PUT', '/saves/driftworks', { baseRevision: 0, data: save(100), summary: { credits: 100, act: 1, ships: 3, lastPlayed: 5, junk: 'x' }, device: 'phone-1' });
  assert.deepEqual(first.status, 200);
  assert.equal(first.body.revision, 1);

  // The laptop also thinks there is no save yet: conflict, with what is there.
  const stale = await laptop('PUT', '/saves/driftworks', { baseRevision: 0, data: save(5), summary: { credits: 5 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 1);
  assert.deepEqual(stale.body.summary, { credits: 100, act: 1, ships: 3, lastPlayed: 5 });
  assert.equal(stale.body.device, 'phone-1');

  // Having chosen, the laptop writes on top of revision 1.
  const chosen = await laptop('PUT', '/saves/driftworks', { baseRevision: 1, data: save(5), summary: { credits: 5 } });
  assert.equal(chosen.body.revision, 2);
  const got = await phone('GET', '/saves/driftworks');
  assert.equal(got.body.revision, 2);
  assert.equal(got.body.data.credits, 5);
  // The phone's next write on revision 1 is now the stale one.
  assert.equal((await phone('PUT', '/saves/driftworks', { baseRevision: 1, data: save(150) })).status, 409);
});

test('saves are private to their account and size limited', { skip }, async () => {
  const a = client();
  await a('POST', '/account', {});
  await a('PUT', '/saves/driftworks', { baseRevision: 0, data: save(1) });
  const b = client();
  await b('POST', '/account', {});
  assert.equal((await b('GET', '/saves/driftworks')).status, 404);
  assert.equal((await a('PUT', '/saves/driftworks', { baseRevision: 1, data: { big: 'x'.repeat(10_001) } })).status, 413);
  assert.equal((await a('PUT', '/saves/driftworks', { baseRevision: 1, data: { big: 'x'.repeat(20_000) } })).status, 413);
  assert.equal((await a('PUT', '/saves/Bad!', { baseRevision: 1, data: save(1) })).status, 404);
  assert.equal((await client()('GET', '/saves/driftworks')).status, 401);
});

test('recovery mails a new number; the old number and old sessions stop working', { skip }, async () => {
  const phone = client();
  const { body } = await phone('POST', '/account', {});
  assert.equal((await phone('PUT', '/account/email', { email: 'Player@Example.com ' })).status, 204);
  assert.equal((await phone('GET', '/account')).body.hasEmail, true);
  const stored = (await pool.query('SELECT email_hash FROM accounts')).rows[0].email_hash;
  assert.deepEqual(stored, createHasher(PEPPER).email('player@example.com'));

  // An unknown address gets the same answer and no mail.
  assert.equal((await client()('POST', '/recovery', { email: 'nobody@example.com' })).status, 202);
  assert.equal((await client()('POST', '/recovery', { email: 'player@example.com' })).status, 202);
  for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'player@example.com');
  assert.notEqual(sent[0].number, body.number);

  assert.equal((await phone('GET', '/account')).status, 401, 'old sessions are logged out');
  assert.equal((await client()('POST', '/session', { number: body.number })).status, 401, 'old number stops working');
  assert.equal((await client()('POST', '/session', { number: sent[0].number })).status, 204);
});

test('recovery is rate limited per address', { skip }, async () => {
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await client()('POST', '/recovery', { email: 'ratelimit@example.com' })).status);
  assert.deepEqual(statuses, [202, 202, 429]);
});

test('deleting an account deletes its saves', { skip }, async () => {
  const call = client();
  await call('POST', '/account', {});
  await call('PUT', '/saves/driftworks', { baseRevision: 0, data: save(1) });
  assert.equal((await call('DELETE', '/account', {})).status, 204);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM saves')).rows[0].n, 0);
});
