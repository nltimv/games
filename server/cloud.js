'use strict';

// Cloud saves: anonymous accounts, sessions and one save per account and
// game. Mounted under /api by server.js when CLOUD_SAVES is on.
//
// Privacy rules: account numbers and emails are only stored as keyed
// hashes, and nothing here logs a number, email, token or IP address.

const crypto = require('node:crypto');
const express = require('express');
const {
  newAccountNumber,
  normalizeNumber,
  formatNumber,
  normalizeEmail,
  createHasher,
  newSessionToken,
  hashToken,
} = require('./crypto');
const { createRateLimiter } = require('./rateLimit');

const COOKIE = 'gh_session';
const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const GAME_ID = /^[a-z0-9-]{1,32}$/;

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

/** Keeps only the fields the conflict prompt shows, with sane types. */
function cleanSummary(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = {};
  if (Number.isFinite(s.lastPlayed)) out.lastPlayed = s.lastPlayed;
  if (Number.isFinite(s.credits)) out.credits = s.credits;
  if (Number.isInteger(s.act) && s.act >= 0 && s.act < 100) out.act = s.act;
  if (Number.isInteger(s.ships) && s.ships >= 0) out.ships = s.ships;
  if (typeof s.company === 'string') out.company = s.company.slice(0, 60);
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
 * @param {boolean} options.secureCookie
 * @param {object} [options.limits]      override rate limits (tests)
 * @param {() => boolean} [options.isReady]
 */
function createCloudRouter({ pool, pepper, mailer = null, maxSaveBytes = 1024 * 1024, secureCookie = true, limits = {}, isReady = () => true }) {
  const hash = createHasher(pepper);
  const limiters = {
    signup: createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000, ...limits.signup }),
    login: createRateLimiter({ limit: 10, windowMs: 60 * 1000, ...limits.login }),
    recoveryIp: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, ...limits.recovery }),
    recoveryEmail: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, ...limits.recovery }),
  };

  const router = express.Router();
  router.use(express.json({ limit: maxSaveBytes + 4096 }));

  // Writes must be JSON: a cross-site form cannot send that without a CORS
  // preflight, which this server never allows. (A cross-site DELETE needs a
  // preflight anyway.)
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

  function limited(res, limiter, key) {
    const { ok, retryAfter } = limiter.hit(key);
    if (ok) return false;
    res.set('Retry-After', String(retryAfter)).status(429).json({ error: 'Too many tries. Wait a moment and try again.' });
    return true;
  }

  function setSessionCookie(res, token) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/api',
      maxAge: SESSION_DAYS * DAY_MS,
    });
  }

  async function startSession(res, accountId) {
    const token = newSessionToken();
    await pool.query("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [
      hashToken(token),
      accountId,
      SESSION_DAYS,
    ]);
    await pool.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [accountId]);
    setSessionCookie(res, token);
  }

  /** Loads req.account from the session cookie, or answers 401. */
  async function requireAccount(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (!token) return res.status(401).json({ error: 'Not logged in' });
      const { rows } = await pool.query(
        `SELECT a.id, a.email_hash IS NOT NULL AS has_email, s.expires_at
           FROM sessions s JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      if (!rows.length) {
        res.clearCookie(COOKIE, { path: '/api' });
        return res.status(401).json({ error: 'Not logged in' });
      }
      req.account = { id: rows[0].id, hasEmail: rows[0].has_email };
      req.sessionToken = token;
      // Sliding expiry: renew a session at most once a day.
      if (rows[0].expires_at.getTime() - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
        await pool.query("UPDATE sessions SET expires_at = now() + make_interval(days => $2) WHERE token_hash = $1", [hashToken(token), SESSION_DAYS]);
        setSessionCookie(res, token);
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Sign up: a new account with a fresh number, logged in straight away.
  // The number is in this response and nowhere else, ever.
  router.post(
    '/account',
    wrap(async (req, res) => {
      if (limited(res, limiters.signup, req.ip)) return;
      for (let attempt = 0; attempt < 5; attempt++) {
        const number = newAccountNumber();
        const id = crypto.randomUUID();
        const { rowCount } = await pool.query('INSERT INTO accounts (id, number_hash) VALUES ($1, $2) ON CONFLICT (number_hash) DO NOTHING', [
          id,
          hash.number(number),
        ]);
        if (!rowCount) continue;
        await startSession(res, id);
        return res.status(201).json({ number: formatNumber(number) });
      }
      throw new Error('Could not pick an unused account number');
    }),
  );

  router.get('/account', requireAccount, (req, res) => {
    res.json({ hasEmail: req.account.hasEmail });
  });

  router.delete(
    '/account',
    requireAccount,
    wrap(async (req, res) => {
      await pool.query('DELETE FROM accounts WHERE id = $1', [req.account.id]);
      res.clearCookie(COOKIE, { path: '/api' });
      res.status(204).end();
    }),
  );

  router.put(
    '/account/email',
    requireAccount,
    wrap(async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: 'That is not an email address.' });
      try {
        await pool.query('UPDATE accounts SET email_hash = $2 WHERE id = $1', [req.account.id, hash.email(email)]);
      } catch (err) {
        // The address is already linked to another account. Saying so would
        // tell anyone which addresses have accounts, so report success.
        if (err.code !== '23505') throw err;
      }
      res.status(204).end();
    }),
  );

  router.delete(
    '/account/email',
    requireAccount,
    wrap(async (req, res) => {
      await pool.query('UPDATE accounts SET email_hash = NULL WHERE id = $1', [req.account.id]);
      res.status(204).end();
    }),
  );

  // Log in with an account number.
  router.post(
    '/session',
    wrap(async (req, res) => {
      if (limited(res, limiters.login, req.ip)) return;
      const number = normalizeNumber(req.body?.number);
      if (!number) return res.status(400).json({ error: 'An account number has 16 digits.' });
      const { rows } = await pool.query('SELECT id FROM accounts WHERE number_hash = $1', [hash.number(number)]);
      if (!rows.length) return res.status(401).json({ error: 'No account has that number.' });
      await startSession(res, rows[0].id);
      res.status(204).end();
    }),
  );

  router.delete(
    '/session',
    wrap(async (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
      res.clearCookie(COOKIE, { path: '/api' });
      res.status(204).end();
    }),
  );

  // Recovery: always 202, so it never tells whether an address has an
  // account. The work happens after the answer, so timing tells nothing either.
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

  async function recover(email, emailHash) {
    const client = await pool.connect();
    let number = null;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id FROM accounts WHERE email_hash = $1 FOR UPDATE', [emailHash]);
      if (!rows.length) {
        await client.query('ROLLBACK');
        return;
      }
      const id = rows[0].id;
      for (let attempt = 0; attempt < 5 && !number; attempt++) {
        const candidate = newAccountNumber();
        await client.query('SAVEPOINT pick');
        try {
          await client.query('UPDATE accounts SET number_hash = $2 WHERE id = $1', [id, hash.number(candidate)]);
          number = candidate;
        } catch (err) {
          if (err.code !== '23505') throw err;
          await client.query('ROLLBACK TO SAVEPOINT pick');
        }
      }
      if (!number) throw new Error('Could not pick an unused account number');
      await client.query('DELETE FROM sessions WHERE account_id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await mailer.sendNewNumber(email, formatNumber(number));
  }

  function checkGame(req, res, next) {
    if (!GAME_ID.test(req.params.game)) return res.status(404).json({ error: 'Unknown game' });
    next();
  }

  router.get(
    '/saves/:game',
    checkGame,
    requireAccount,
    wrap(async (req, res) => {
      const { rows } = await pool.query('SELECT revision, data, summary, device, updated_at FROM saves WHERE account_id = $1 AND game = $2', [
        req.account.id,
        req.params.game,
      ]);
      if (!rows.length) return res.status(404).json({ error: 'No cloud save yet', revision: 0 });
      const row = rows[0];
      res.set('Cache-Control', 'no-store');
      res.json({ revision: row.revision, data: row.data, summary: row.summary, device: row.device, updatedAt: row.updated_at.getTime() });
    }),
  );

  // Write a save. `baseRevision` is the cloud revision the client last saw
  // (0 for none). When the cloud has moved on, answer 409 with what is there.
  router.put(
    '/saves/:game',
    checkGame,
    requireAccount,
    wrap(async (req, res) => {
      const { baseRevision, data } = req.body ?? {};
      if (!Number.isInteger(baseRevision) || baseRevision < 0) return res.status(400).json({ error: 'baseRevision is required' });
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'data must be an object' });
      const json = JSON.stringify(data);
      if (Buffer.byteLength(json) > maxSaveBytes) return res.status(413).json({ error: 'This save is too large for the cloud.' });
      const summary = cleanSummary(req.body.summary);
      const device = cleanDevice(req.body.device);
      const { id } = req.account;
      const game = req.params.game;

      let result;
      if (baseRevision === 0) {
        result = await pool.query(
          `INSERT INTO saves (account_id, game, revision, data, summary, device) VALUES ($1, $2, 1, $3, $4, $5)
           ON CONFLICT (account_id, game) DO NOTHING RETURNING revision, updated_at`,
          [id, game, json, summary, device],
        );
      } else {
        result = await pool.query(
          `UPDATE saves SET revision = revision + 1, data = $4, summary = $5, device = $6, updated_at = now()
            WHERE account_id = $1 AND game = $2 AND revision = $3 RETURNING revision, updated_at`,
          [id, game, baseRevision, json, summary, device],
        );
      }
      if (result.rowCount) return res.json({ revision: result.rows[0].revision, updatedAt: result.rows[0].updated_at.getTime() });

      const { rows } = await pool.query('SELECT revision, summary, device, updated_at FROM saves WHERE account_id = $1 AND game = $2', [id, game]);
      if (!rows.length) return res.status(409).json({ error: 'The cloud save is gone', revision: 0 });
      const row = rows[0];
      res.status(409).json({ error: 'The cloud save changed', revision: row.revision, summary: row.summary, device: row.device, updatedAt: row.updated_at.getTime() });
    }),
  );

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

/** Deletes expired sessions. */
async function sweepSessions(pool) {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

module.exports = { createCloudRouter, sweepSessions, parseCookies, cleanSummary };
