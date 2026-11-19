'use strict';

// Usage data: POST /api/events takes batches of events from the hub and the
// games (public/shared/js/telemetry.js) and stores them in the `events`
// table, for the Grafana dashboards. Mounted under /api by server.js when
// TELEMETRY is on.
//
// Privacy rules: only events and properties listed in telemetryEvents.js
// are kept; nothing from the request itself is stored (no IP address, no
// user agent, no headers); rows older than the retention period are
// deleted. The install, session and save ids are random ids made by the
// browser, unrelated to save codes.

const express = require('express');
const { createRateLimiter } = require('./rateLimit');
const { cleanProps } = require('./telemetryEvents');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME_ID = /^[a-z0-9-]{1,32}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,20}$/;
const PLATFORMS = new Set(['web', 'android', 'ios']);
const DAY = 24 * 60 * 60 * 1000;

const MAX_BATCH = 50;
const MAX_BODY = '64kb';

/**
 * One event row from what a client sent, or null when it is not usable.
 * `receivedAt` bounds the client's clock: an event may be up to a week old
 * (sent after offline play) and never in the future.
 */
function cleanEvent(raw, { games, receivedAt }) {
  if (!raw || typeof raw !== 'object') return null;
  const { name, game } = raw;
  if (typeof name !== 'string' || typeof game !== 'string' || !GAME_ID.test(game)) return null;
  if (games && !games.has(game)) return null;
  const props = cleanProps(name, raw.props);
  if (!props) return null;
  if (typeof raw.session_id !== 'string' || !UUID.test(raw.session_id)) return null;
  const saveId = typeof raw.save_id === 'string' && UUID.test(raw.save_id) ? raw.save_id : null;
  const version = typeof raw.version === 'string' && VERSION.test(raw.version) ? raw.version : null;
  let at = Number(raw.at);
  if (!Number.isFinite(at) || at > receivedAt + 5 * 60 * 1000 || at < receivedAt - 7 * DAY) at = receivedAt;
  at = Math.min(at, receivedAt);
  return { at: new Date(at), game, name, sessionId: raw.session_id, saveId, version, props };
}

/**
 * @param {object} options
 * @param {import('pg').Pool} options.pool
 * @param {() => Set<string>|null} [options.knownGames]  game ids that may send events ('hub' is always allowed); null allows any
 * @param {() => boolean} [options.isReady]
 * @param {object} [options.limits]  override the rate limit (tests)
 */
function createTelemetryRouter({ pool, knownGames = () => null, isReady = () => true, limits = {} }) {
  // A page sends a batch every 30 seconds at most; this leaves room for
  // several tabs and a shared address (a school, an office).
  const limiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000, ...limits });
  const router = express.Router();

  router.post('/events', express.json({ limit: MAX_BODY }), (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON' });
    if (!isReady()) return res.status(503).json({ error: 'Starting up' });
    const { ok, retryAfter } = limiter.hit(req.ip);
    if (!ok) return res.set('Retry-After', String(retryAfter)).status(429).json({ error: 'Too many events' });

    const body = req.body ?? {};
    const installId = typeof body.install_id === 'string' && UUID.test(body.install_id) ? body.install_id : null;
    const platform = PLATFORMS.has(body.platform) ? body.platform : null;
    if (!installId || !platform || !Array.isArray(body.events)) return res.status(400).json({ error: 'Bad batch' });
    if (body.events.length > MAX_BATCH) return res.status(413).json({ error: 'Too many events in one batch' });

    const allowed = knownGames();
    const games = allowed ? new Set([...allowed, 'hub']) : null;
    const receivedAt = Date.now();
    const rows = body.events.map((raw) => cleanEvent(raw, { games, receivedAt })).filter(Boolean);
    if (!rows.length) return res.status(204).end();

    // One INSERT for the batch.
    const values = [];
    const params = [];
    for (const row of rows) {
      const i = params.length;
      values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8}, $${i + 9})`);
      params.push(row.at, row.game, row.name, installId, row.saveId, row.sessionId, row.version, platform, JSON.stringify(row.props));
    }
    pool
      .query(`INSERT INTO events (at, game, name, install_id, save_id, session_id, version, platform, props) VALUES ${values.join(', ')}`, params)
      .then(() => res.status(204).end())
      .catch(next);
  });

  router.use('/events', (err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Batch too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
    console.error(`Telemetry error: ${err.message}`);
    res.status(500).json({ error: 'Could not store events' });
  });

  router.resetLimits = () => limiter.reset();
  return router;
}

/** Deletes events older than `days` days. Returns how many went. */
async function purgeEvents(pool, days) {
  const { rowCount } = await pool.query("DELETE FROM events WHERE at < now() - make_interval(days => $1)", [days]);
  return rowCount;
}

/**
 * Creates or updates a login role that may only read the events table, for
 * Grafana. Needs a database user allowed to create roles (the bundled
 * PostgreSQL's is); with an external database, create the role by hand
 * instead (see docs/analytics.md).
 */
async function ensureReader(pool, { user, password }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) throw new Error('TELEMETRY_READER_USER must be a plain lower-case name');
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
    const literal = (await client.query('SELECT quote_literal($1) AS q', [password])).rows[0].q;
    const verb = rows.length ? 'ALTER' : 'CREATE';
    await client.query(`${verb} ROLE ${user} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal}`);
    const db = (await client.query('SELECT current_database() AS db')).rows[0].db;
    await client.query(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO ${user}`);
    const schema = (await client.query('SELECT current_schema() AS s')).rows[0].s;
    await client.query(`GRANT USAGE ON SCHEMA "${schema.replace(/"/g, '""')}" TO ${user}`);
    await client.query(`GRANT SELECT ON events TO ${user}`);
  } finally {
    client.release();
  }
}

module.exports = { createTelemetryRouter, cleanEvent, purgeEvents, ensureReader, MAX_BATCH };
