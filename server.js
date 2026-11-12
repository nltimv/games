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
// rate limits see the player's address and secure cookies work.
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== 'false') {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

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

// Cloud saves are optional: without CLOUD_SAVES the hub runs as before and
// players only see local saves.
if (process.env.CLOUD_SAVES === 'true') {
  startCloudSaves();
} else {
  app.get('/api/config', (_req, res) => res.json({ cloud: false, recovery: false }));
}

function startCloudSaves() {
  const { createPool, migrate } = require('./server/db');
  const { createCloudRouter } = require('./server/cloud');
  const { createMailer } = require('./server/mail');

  const pool = createPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL });
  let ready = false;
  app.use(
    '/api',
    createCloudRouter({
      pool,
      pepper: process.env.CLOUD_PEPPER,
      mailer: createMailer(),
      maxSaveBytes: Number(process.env.MAX_SAVE_BYTES) || 1024 * 1024,
      isReady: () => ready,
    }),
  );

  // The database may come up after the app: keep trying, and serve the
  // games meanwhile (cloud endpoints answer 503 until then).
  let delay = 1000;
  const connect = () =>
    migrate(pool)
      .then((applied) => {
        ready = true;
        console.log(applied.length ? `Cloud saves ready (applied ${applied.join(', ')})` : 'Cloud saves ready');
      })
      .catch((err) => {
        console.error(`Cloud saves waiting for the database: ${err.message}`);
        setTimeout(connect, delay).unref();
        delay = Math.min(delay * 2, 30_000);
      });
  connect();
}

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Fallback for unknown routes.
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`Games Hub listening on port ${PORT}`);
});
