'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const seedTable = require('./src/seed-table.js');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAMES_MANIFEST = path.join(__dirname, 'src', 'games.json');

// Pre-compiled Pipelines levels (tools/build-seeds.js). Optional: without it
// the game generates its own levels in the browser, it just cannot verify the
// biggest boards while it does so.
const SEEDS_PATH = process.env.PIPELINES_SEEDS || path.join(__dirname, 'data', 'pipelines-seeds.bin');
const MAX_SEED_WINDOW = 128;
// One read of the whole file, then answers come out of memory; the reader
// re-checks mtime occasionally so a rebuilt table lands without a restart.
const seeds = new seedTable.TableReader(SEEDS_PATH);

app.disable('x-powered-by');

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

// ------------------------------------------------------- pipelines seed table

// A level's seed never changes once built, so these are cacheable for a good
// while; the build id in every response is what tells a client it is looking
// at a different table. Express computes the ETag and answers conditional
// requests from it, so a revalidation costs no work here either.
function sendSeeds(res, payload) {
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json(payload);
}

function seedsUnavailable(res) {
  // No-store, so a client that asked before the table was deployed does not
  // hold on to the answer once it is.
  res.set('Cache-Control', 'no-store');
  res.status(503).json({ error: 'Seed table unavailable' });
}

// A window of levels in one request: the game asks for the levels around the
// one it is about to play, so moving through a session costs a handful of
// requests rather than one per level.
app.get('/api/pipelines/seeds', (req, res) => {
  const info = seeds.info;
  if (!info) {
    seedsUnavailable(res);
    return;
  }
  const from = Number.parseInt(req.query.from, 10);
  const count = Number.parseInt(req.query.count, 10);
  if (!Number.isInteger(from) || from < 1) {
    res.status(400).json({ error: 'from must be a positive integer' });
    return;
  }
  const window = Number.isInteger(count) ? Math.min(Math.max(count, 1), MAX_SEED_WINDOW) : 1;
  sendSeeds(res, {
    total: info.total,
    firstLevel: info.firstLevel,
    buildId: info.buildId,
    generator: info.generator,
    from: from,
    count: window,
    levels: seeds.range(from, window),
  });
});

app.get('/api/pipelines/seeds/:level', (req, res) => {
  const info = seeds.info;
  if (!info) {
    seedsUnavailable(res);
    return;
  }
  const level = Number.parseInt(req.params.level, 10);
  if (!Number.isInteger(level) || level < 1) {
    res.status(400).json({ error: 'level must be a positive integer' });
    return;
  }
  const record = seeds.get(level);
  if (!record) {
    res.set('Cache-Control', 'public, max-age=300');
    res.status(404).json({ error: 'No seed for that level', total: info.total, buildId: info.buildId });
    return;
  }
  sendSeeds(res, Object.assign({ total: info.total, buildId: info.buildId, generator: info.generator }, record));
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Fallback for unknown routes.
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`Games Hub listening on port ${PORT}`);
});
