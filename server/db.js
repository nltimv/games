'use strict';

// PostgreSQL pool and schema migrations. Migrations are the numbered .sql
// files in ./migrations, applied in order on start, each in a transaction,
// under an advisory lock so two pods starting together cannot race.

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 727_001; // any constant; shared by every instance of this app

function createPool(config = {}) {
  // With no connection string, pg reads PGHOST, PGPORT, PGDATABASE, PGUSER,
  // PGPASSWORD and PGSSLMODE from the environment.
  const options = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 };
  if (config.connectionString) options.connectionString = config.connectionString;
  // DB_SSL: disable (default), require (encrypted, certificate not checked)
  // or verify-full (encrypted and the certificate checked).
  if (config.ssl === 'require') options.ssl = { rejectUnauthorized: false };
  else if (config.ssl === 'verify-full') options.ssl = { rejectUnauthorized: true };
  const pool = new Pool(options);
  // An idle client losing its connection must not crash the server.
  pool.on('error', (err) => console.error(`Database connection error: ${err.message}`));
  return pool;
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: Number.parseInt(name, 10), name, file: path.join(MIGRATIONS_DIR, name) }));
}

/** Applies every migration not yet applied. Returns the names applied. */
async function migrate(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((row) => row.version));
    for (const migration of migrationFiles()) {
      if (done.has(migration.version)) continue;
      const sql = fs.readFileSync(migration.file, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${err.message}`, { cause: err });
      }
      applied.push(migration.name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}

module.exports = { createPool, migrate, migrationFiles };
