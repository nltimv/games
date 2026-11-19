'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAMES_MANIFEST = path.join(__dirname, 'src', 'games.json');

app.disable('x-powered-by');

// Behind an ingress or load balancer, trust its X-Forwarded-* headers so
// rate limits see the player's address.
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== 'false') {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

// The Android and iOS apps call /api from their own origin.
const { createAppCors, parseOrigins } = require('./server/cors');
app.use('/api', createAppCors(parseOrigins(process.env.APP_ORIGINS)));

// Liveness/readiness probe endpoint for container orchestration.
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serves the game registry so the front-end lobby can render game cards
// without needing to be rebuilt when new games are added.
app.get('/api/games', (_req, res) => {
  fs.readFile(GAMES_MANIFEST, 'utf8', (err, data) => {
    if (err) {
      res.status(500).json({ error: 'Unable to load game registry' });
      return;
    }
    try {
      res.type('application/json').send(data);
    } catch {
      res.status(500).json({ error: 'Invalid game registry' });
    }
  });
});

// Cloud saves and usage data are optional and both need the database.
// Without CLOUD_SAVES the hub runs as before and players only see local
// saves; without TELEMETRY nothing is collected (the games then stop
// sending after their first try).
const cloudOn = process.env.CLOUD_SAVES === 'true';
const telemetryOn = process.env.TELEMETRY === 'true';
const database = cloudOn || telemetryOn ? startDatabase() : null;

// Usage data goes first: the cloud save routes answer every /api request
// they see while the database is starting.
if (telemetryOn) startTelemetry(database);
if (cloudOn) {
  startCloudSaves(database);
} else {
  app.get('/api/config', (_req, res) => res.json({ cloud: false, recovery: false }));
}

/** Game id → name from the registry, so mails go out in the game's name. */
function gameTitles() {
  try {
    return Object.fromEntries(JSON.parse(fs.readFileSync(GAMES_MANIFEST, 'utf8')).map((game) => [game.id, game.title]));
  } catch {
    return {};
  }
}

/** The pool, and `ready` once migrations ran. Keeps retrying while the database is not up. */
function startDatabase() {
  const { createPool, migrate } = require('./server/db');
  const pool = createPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL });
  const db = { pool, ready: false, onReady: [] };

  // The database may come up after the app: keep trying, and serve the
  // games meanwhile (database endpoints answer 503 until then).
  let delay = 1000;
  const connect = () =>
    migrate(pool)
      .then((applied) => {
        db.ready = true;
        console.log(applied.length ? `Database ready (applied ${applied.join(', ')})` : 'Database ready');
        for (const fn of db.onReady) fn();
      })
      .catch((err) => {
        console.error(`Waiting for the database: ${err.message}`);
        setTimeout(connect, delay).unref();
        delay = Math.min(delay * 2, 30_000);
      });
  connect();
  return db;
}

function startCloudSaves(db) {
  const { createCloudRouter } = require('./server/cloud');
  const { createMailer } = require('./server/mail');
  app.use(
    '/api',
    createCloudRouter({
      pool: db.pool,
      pepper: process.env.CLOUD_PEPPER,
      mailer: createMailer(),
      gameTitles: gameTitles(),
      maxSaveBytes: Number(process.env.MAX_SAVE_BYTES) || 1024 * 1024,
      isReady: () => db.ready,
    }),
  );
}

function startTelemetry(db) {
  const { createTelemetryRouter, purgeEvents, ensureReader } = require('./server/telemetry');
  const games = new Set(Object.keys(gameTitles()));
  app.use('/api', createTelemetryRouter({ pool: db.pool, knownGames: () => (games.size ? games : null), isReady: () => db.ready }));

  // Events older than the retention period are deleted daily (13 months by default).
  const days = Number(process.env.TELEMETRY_RETENTION_DAYS) || 395;
  const purge = () =>
    purgeEvents(db.pool, days)
      .then((n) => n && console.log(`Usage data: deleted ${n} events older than ${days} days`))
      .catch((err) => console.error(`Usage data purge failed: ${err.message}`));
  db.onReady.push(() => {
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
    // The read-only login for the dashboards, when the chart asks for one.
    const user = process.env.TELEMETRY_READER_USER;
    const password = process.env.TELEMETRY_READER_PASSWORD;
    if (user && password) {
      ensureReader(db.pool, { user, password })
        .then(() => console.log(`Usage data: read-only role ${user} ready`))
        .catch((err) => console.error(`Could not set up the read-only role ${user}: ${err.message}`));
    }
  });
}

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Fallback for unknown routes.
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`Games Hub listening on port ${PORT}`);
});
