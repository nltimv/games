'use strict';

// Cloud saves. Each save has a save code: whoever has the code can read and
// write that save. There are no accounts. Mounted under /api by server.js
// when CLOUD_SAVES is on.
//
// The code travels in the Authorization header ("Code 1234..."), never in a
// URL or a cookie. Privacy rules: codes and emails are only stored as keyed
// hashes, and nothing here logs a code, email or IP address.

const crypto = require('node:crypto');
const express = require('express');
const { newSaveCode, normalizeCode, formatCode, normalizeEmail, createHasher } = require('./crypto');
const { createRateLimiter } = require('./rateLimit');

const GAME_ID = /^[a-z0-9-]{1,32}$/;

/** Keeps only the fields the save list shows, with sane types. */
function cleanSummary(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = {};
  if (typeof s.name === 'string') out.name = s.name.trim().slice(0, 40);
  if (Number.isFinite(s.lastPlayed)) out.lastPlayed = s.lastPlayed;
  if (Number.isFinite(s.credits)) out.credits = s.credits;
  if (Number.isInteger(s.act) && s.act >= 0 && s.act < 100) out.act = s.act;
  if (Number.isInteger(s.ships) && s.ships >= 0) out.ships = s.ships;
  return out;
}

function cleanDevice(input) {
  return typeof input === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input) ? input : null;
}

/**
 * @param {object} options
 * @param {import('pg').Pool} options.pool
 * @param {string} options.pepper
 * @param {object|null} options.mailer   from mail.js, or null
 * @param {number} options.maxSaveBytes
 * @param {object} [options.limits]      override rate limits (tests)
 * @param {() => boolean} [options.isReady]
 */
function createCloudRouter({ pool, pepper, mailer = null, maxSaveBytes = 1024 * 1024, limits = {}, isReady = () => true }) {
  const hash = createHasher(pepper);
  const limiters = {
    // New saves per address.
    create: createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000, ...limits.create }),
    // Wrong codes per address: what stops guessing.
    wrongCode: createRateLimiter({ limit: 10, windowMs: 60 * 1000, ...limits.wrongCode }),
    recoveryIp: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, ...limits.recovery }),
    recoveryEmail: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, ...limits.recovery }),
  };

  const router = express.Router();
  router.use(express.json({ limit: maxSaveBytes + 4096 }));

  // Writes must be JSON: a cross-site form cannot send that without a CORS
  // preflight, which this server never allows.
  router.use((req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON' });
    next();
  });

  router.get('/config', (_req, res) => {
    res.json({ cloud: true, recovery: Boolean(mailer), maxSaveBytes });
  });

  router.use((_req, res, next) => {
    if (!isReady()) return res.status(503).json({ error: 'Cloud saves are starting up' });
    next();
  });

  const tooMany = (res, retryAfter) => res.set('Retry-After', String(retryAfter)).status(429).json({ error: 'Too many tries. Wait a moment and try again.' });

  function limited(res, limiter, key) {
    const { ok, retryAfter } = limiter.hit(key);
    if (ok) return false;
    tooMany(res, retryAfter);
    return true;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function checkGame(req, res, next) {
    if (!GAME_ID.test(req.params.game)) return res.status(404).json({ error: 'Unknown game' });
    next();
  }

  /** Loads req.save from the save code in the Authorization header, or answers 401. */
  const requireSave = wrap(async (req, res, next) => {
    const blocked = limiters.wrongCode.blocked(req.ip);
    if (!blocked.ok) return tooMany(res, blocked.retryAfter);
    const [scheme, ...rest] = (req.headers.authorization || '').split(' ');
    const code = scheme === 'Code' ? normalizeCode(rest.join('')) : null;
    if (!code) return res.status(401).json({ error: 'A save code has 16 digits.' });
    const { rows } = await pool.query('SELECT id, revision, email_hash IS NOT NULL AS has_email FROM saves WHERE code_hash = $1 AND game = $2', [
      hash.code(code),
      req.params.game,
    ]);
    if (!rows.length) {
      limiters.wrongCode.hit(req.ip);
      return res.status(401).json({ error: 'No save has that code.' });
    }
    req.save = { id: rows[0].id, revision: rows[0].revision, hasEmail: rows[0].has_email, code };
    next();
  });

  /** Gives the save `id` a fresh unused code, inside `client`'s transaction. */
  async function assignNewCode(client, id) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newSaveCode();
      await client.query('SAVEPOINT pick');
      try {
        await client.query('UPDATE saves SET code_hash = $2 WHERE id = $1', [id, hash.code(code)]);
        return code;
      } catch (err) {
        if (err.code !== '23505') throw err;
        await client.query('ROLLBACK TO SAVEPOINT pick');
      }
    }
    throw new Error('Could not pick an unused save code');
  }

  // A new, empty cloud save. Its code is in this response and nowhere else.
  router.post(
    '/saves/:game',
    checkGame,
    wrap(async (req, res) => {
      if (limited(res, limiters.create, req.ip)) return;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newSaveCode();
        const { rowCount } = await pool.query('INSERT INTO saves (id, game, code_hash) VALUES ($1, $2, $3) ON CONFLICT (code_hash) DO NOTHING', [
          crypto.randomUUID(),
          req.params.game,
          hash.code(code),
        ]);
        if (rowCount) return res.status(201).json({ code: formatCode(code), revision: 0 });
      }
      throw new Error('Could not pick an unused save code');
    }),
  );

  router.get(
    '/saves/:game',
    checkGame,
    requireSave,
    wrap(async (req, res) => {
      const { rows } = await pool.query('SELECT revision, data, summary, device, updated_at FROM saves WHERE id = $1', [req.save.id]);
      const row = rows[0];
      res.set('Cache-Control', 'no-store');
      res.json({ revision: row.revision, data: row.data, summary: row.summary, device: row.device, updatedAt: row.updated_at.getTime(), hasEmail: req.save.hasEmail });
    }),
  );

  // Write a save. `baseRevision` is the cloud revision the client last saw
  // (0 for a new save). When the cloud has moved on, answer 409 with what is there.
  router.put(
    '/saves/:game',
    checkGame,
    requireSave,
    wrap(async (req, res) => {
      const { baseRevision, data } = req.body ?? {};
      if (!Number.isInteger(baseRevision) || baseRevision < 0) return res.status(400).json({ error: 'baseRevision is required' });
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'data must be an object' });
      const json = JSON.stringify(data);
      if (Buffer.byteLength(json) > maxSaveBytes) return res.status(413).json({ error: 'This save is too large for the cloud.' });
      const result = await pool.query(
        `UPDATE saves SET revision = revision + 1, data = $3, summary = $4, device = $5, updated_at = now()
          WHERE id = $1 AND revision = $2 RETURNING revision, updated_at`,
        [req.save.id, baseRevision, json, cleanSummary(req.body.summary), cleanDevice(req.body.device)],
      );
      if (result.rowCount) return res.json({ revision: result.rows[0].revision, updatedAt: result.rows[0].updated_at.getTime() });

      const { rows } = await pool.query('SELECT revision, summary, device, updated_at FROM saves WHERE id = $1', [req.save.id]);
      if (!rows.length) return res.status(401).json({ error: 'No save has that code.' });
      const row = rows[0];
      res.status(409).json({ error: 'The cloud save changed', revision: row.revision, summary: row.summary, device: row.device, updatedAt: row.updated_at.getTime() });
    }),
  );

  router.delete(
    '/saves/:game',
    checkGame,
    requireSave,
    wrap(async (req, res) => {
      await pool.query('DELETE FROM saves WHERE id = $1', [req.save.id]);
      res.status(204).end();
    }),
  );

  // Link a recovery email to the save and confirm it by mail, with the code.
  router.put(
    '/saves/:game/email',
    checkGame,
    requireSave,
    wrap(async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: 'That is not an email address.' });
      const { rows } = await pool.query("UPDATE saves SET email_hash = $2 WHERE id = $1 RETURNING summary->>'name' AS name", [req.save.id, hash.email(email)]);
      res.status(204).end();
      if (!mailer) return;
      await mailer.sendEmailLinked(email, { name: rows[0]?.name, code: formatCode(req.save.code) }).catch((err) => console.error(`Confirmation mail failed: ${err.message}`));
    }),
  );

  router.delete(
    '/saves/:game/email',
    checkGame,
    requireSave,
    wrap(async (req, res) => {
      await pool.query('UPDATE saves SET email_hash = NULL WHERE id = $1', [req.save.id]);
      res.status(204).end();
    }),
  );

  // Recovery: always 202, so it never tells whether an address has saves.
  // The work happens after the answer, so timing tells nothing either.
  router.post('/recovery', (req, res) => {
    if (!mailer) return res.status(404).json({ error: 'Recovery is not available' });
    if (limited(res, limiters.recoveryIp, req.ip)) return;
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'That is not an email address.' });
    const emailHash = hash.email(email);
    if (limited(res, limiters.recoveryEmail, emailHash.toString('hex'))) return;
    res.status(202).json({ ok: true });
    recover(email, emailHash).catch((err) => console.error(`Recovery failed: ${err.message}`));
  });

  /** Every save linked to the address gets a new code; the old codes stop working. */
  async function recover(email, emailHash) {
    const client = await pool.connect();
    const saves = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query("SELECT id, summary->>'name' AS name FROM saves WHERE email_hash = $1 ORDER BY updated_at DESC LIMIT 50 FOR UPDATE", [emailHash]);
      for (const row of rows) saves.push({ name: row.name, code: formatCode(await assignNewCode(client, row.id)) });
      await client.query(rows.length ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (saves.length) await mailer.sendNewCodes(email, saves);
  }

  router.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'This save is too large for the cloud.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
    console.error(`Cloud save error: ${err.message}`);
    res.status(500).json({ error: 'Something went wrong. Try again later.' });
  });

  /** For tests: forget every rate limit hit. */
  router.resetLimits = () => Object.values(limiters).forEach((limiter) => limiter.reset());
  return router;
}

module.exports = { createCloudRouter, cleanSummary };
