'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAMES_MANIFEST = path.join(__dirname, 'src', 'games.json');

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

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Fallback for unknown routes.
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`Games Hub listening on port ${PORT}`);
});
