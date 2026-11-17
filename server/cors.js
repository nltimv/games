'use strict';

// Lets the Driftworks Android and iOS apps call /api. The apps load the game
// from inside the app, so their pages have their own origin:
//
//   capacitor://localhost   iOS
//   https://localhost       Android
//
// Only those origins get CORS headers; every other cross-site request is
// left as before (no CORS, so the browser blocks it). Save codes travel in
// the Authorization header, never in a cookie, so an allowed origin gains
// nothing a player's own code would not already give.

const DEFAULT_APP_ORIGINS = ['capacitor://localhost', 'https://localhost'];

/** APP_ORIGINS: comma-separated list, or "none" to turn CORS off. Unset means the app defaults. */
function parseOrigins(value) {
  if (value == null || value.trim() === '') return DEFAULT_APP_ORIGINS;
  if (value.trim() === 'none') return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createAppCors(origins = DEFAULT_APP_ORIGINS) {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return next();
    res.vary('Origin');
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Expose-Headers', 'Retry-After');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
    next();
  };
}

module.exports = { DEFAULT_APP_ORIGINS, parseOrigins, createAppCors };
