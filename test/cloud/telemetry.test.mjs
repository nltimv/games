// Usage data endpoint (server/telemetry.js). The checks on what gets kept
// run everywhere; the API tests run against a real PostgreSQL when
// TEST_DATABASE_URL is set, in their own schema so they cannot race the
// cloud save tests.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const express = require('express');
const { createPool, migrate } = require('../../server/db.js');
const { createTelemetryRouter, cleanEvent, purgeEvents, ensureReader } = require('../../server/telemetry.js');
const { cleanProps, EVENTS } = require('../../server/telemetryEvents.js');

const URL_ = process.env.TEST_DATABASE_URL;
const SCHEMA = 'telemetry_test';
const skip = URL_ ? false : 'TEST_DATABASE_URL is not set';

// ---------- What gets kept ----------

test('unknown events are dropped; unknown or mistyped props are left out', () => {
  assert.equal(cleanProps('made_up_event', { a: 1 }), null);
  assert.deepEqual(cleanProps('goal_completed', { goal_id: 'first-sale', goal_index: 0, email: 'a@b.c', tutorial: 'yes' }), { goal_id: 'first-sale', goal_index: 0 });
  assert.deepEqual(cleanProps('session_heartbeat', null), {});
  assert.equal(cleanProps('game_card_clicked', { target: 'x'.repeat(500) }).target.length, 64);
  assert.deepEqual(cleanProps('game_ended', { score: Number.NaN, length_s: Infinity, result: 'won' }), { result: 'won' });
  // Inherited names are not events.
  assert.equal(cleanProps('toString', {}), null);
  assert.equal(cleanProps('__proto__', {}), null);
});

test('every event lists only string, number or boolean props', () => {
  for (const [name, schema] of Object.entries(EVENTS)) {
    assert.match(name, /^[a-z_]+$/);
    for (const type of Object.values(schema)) assert.ok(['string', 'number', 'boolean'].includes(type), `${name}: ${type}`);
  }
});

test('events need a known game and a session id; the clock is bounded', () => {
  const receivedAt = Date.parse('2026-11-19T12:00:00Z');
  const games = new Set(['hub', 'driftworks']);
  const base = { name: 'session_heartbeat', game: 'driftworks', session_id: randomUUID(), at: receivedAt - 1000 };
  assert.ok(cleanEvent(base, { games, receivedAt }));
  assert.equal(cleanEvent({ ...base, game: 'evil' }, { games, receivedAt }), null);
  assert.equal(cleanEvent({ ...base, session_id: 'nope' }, { games, receivedAt }), null);
  assert.equal(cleanEvent({ ...base, name: 'nope' }, { games, receivedAt }), null);
  assert.equal(cleanEvent({ ...base, at: receivedAt + 3600_000 }, { games, receivedAt }).at.getTime(), receivedAt);
  assert.equal(cleanEvent({ ...base, at: receivedAt - 30 * 86400_000 }, { games, receivedAt }).at.getTime(), receivedAt);
  assert.equal(cleanEvent({ ...base, save_id: 'not-a-uuid' }, { games, receivedAt }).saveId, null);
  assert.equal(cleanEvent({ ...base, version: '<script>' }, { games, receivedAt }).version, null);
  assert.equal(cleanEvent({ ...base, version: '0.6.0' }, { games, receivedAt }).version, '0.6.0');
});

// ---------- The API ----------

let pool;
let router;
let server;
let base;

before(async () => {
  if (!URL_) return;
  const admin = createPool({ connectionString: URL_ });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const url = new URL(URL_);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  pool = createPool({ connectionString: url.toString() });
  await migrate(pool);
  const app = express();
  router = createTelemetryRouter({ pool, knownGames: () => new Set(['driftworks', 'snake']), limits: { limit: 5 } });
  app.set('trust proxy', true);
  app.use('/api', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!URL_) return;
  await new Promise((resolve) => server.close(resolve));
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await pool.end();
});

beforeEach(async () => {
  if (!URL_) return;
  await pool.query('TRUNCATE events');
  router.resetLimits();
});

async function send(body, { type = 'application/json', ip = '10.0.0.1' } = {}) {
  const res = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return res.status;
}

const batch = (events, extra = {}) => ({ install_id: randomUUID(), platform: 'web', events, ...extra });
const event = (name, props = {}, extra = {}) => ({ name, game: 'driftworks', version: '0.6.0', session_id: randomUUID(), at: Date.now(), props, ...extra });

test('a batch is stored with only the allowed fields, and nothing from the request', { skip }, async () => {
  const saveId = randomUUID();
  const status = await send(
    batch([
      event('goal_completed', { goal_id: 'first-sale', goal_index: 0, act: 1, secret: 'x' }, { save_id: saveId }),
      event('not_an_event', {}),
      event('app_open', { os: 'android' }, { game: 'hub' }),
      event('session_heartbeat', {}, { game: 'unknown-game' }),
    ]),
  );
  assert.equal(status, 204);
  const { rows } = await pool.query('SELECT * FROM events ORDER BY id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'goal_completed');
  assert.equal(rows[0].save_id, saveId);
  assert.deepEqual(rows[0].props, { goal_id: 'first-sale', goal_index: 0, act: 1 });
  assert.equal(rows[1].game, 'hub');
  // No column could hold an address or a user agent.
  const { rows: cols } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND table_schema = $1", [SCHEMA]);
  assert.deepEqual(cols.map((c) => c.column_name).sort(), ['at', 'game', 'id', 'install_id', 'name', 'platform', 'props', 'received_at', 'save_id', 'session_id', 'version']);
});

test('bad batches are refused', { skip }, async () => {
  assert.equal(await send(batch([event('session_heartbeat')]), { type: 'text/plain' }), 415);
  assert.equal(await send('{nope'), 400);
  assert.equal(await send(batch([event('session_heartbeat')], { install_id: 'x' })), 400);
  assert.equal(await send(batch([event('session_heartbeat')], { platform: 'tv' })), 400);
  assert.equal(await send(batch(Array.from({ length: 51 }, () => event('session_heartbeat')))), 413);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM events');
  assert.equal(rows[0].n, 0);
});

test('one address is rate limited', { skip }, async () => {
  for (let i = 0; i < 5; i++) assert.equal(await send(batch([event('session_heartbeat')]), { ip: '10.0.0.9' }), 204);
  assert.equal(await send(batch([event('session_heartbeat')]), { ip: '10.0.0.9' }), 429);
  assert.equal(await send(batch([event('session_heartbeat')]), { ip: '10.0.0.10' }), 204);
});

test('old events are purged', { skip }, async () => {
  await pool.query("INSERT INTO events (at, game, name, install_id, session_id, platform) VALUES (now() - interval '400 days', 'hub', 'app_open', $1, $1, 'web'), (now(), 'hub', 'app_open', $1, $1, 'web')", [randomUUID()]);
  assert.equal(await purgeEvents(pool, 395), 1);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM events');
  assert.equal(rows[0].n, 1);
});

test('the reader role can read events and nothing else', { skip }, async (t) => {
  const user = 'telemetry_test_reader';
  try {
    await ensureReader(pool, { user, password: "it's-a-test" });
    // Running it again updates the role instead of failing.
    await ensureReader(pool, { user, password: 'second-password' });
  } catch (err) {
    if (/permission denied/i.test(err.message)) return t.skip('the test user may not create roles');
    throw err;
  }
  const url = new URL(URL_);
  url.username = user;
  url.password = 'second-password';
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const reader = createPool({ connectionString: url.toString() });
  try {
    await reader.query('SELECT count(*) FROM events');
    await assert.rejects(reader.query('SELECT count(*) FROM saves'), /permission denied/);
    await assert.rejects(reader.query("INSERT INTO events (at, game, name, install_id, session_id, platform) VALUES (now(), 'hub', 'x', gen_random_uuid(), gen_random_uuid(), 'web')"), /permission denied/);
  } finally {
    await reader.end();
    await pool.query(`REVOKE ALL ON events FROM ${user}`).catch(() => {});
  }
  await assert.rejects(ensureReader(pool, { user: 'Robert"; DROP', password: 'x' }), /plain lower-case/);
});
