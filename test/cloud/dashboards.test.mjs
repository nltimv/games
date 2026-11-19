// The Grafana dashboards (scripts/dashboards.mjs): the JSON in the Helm
// chart matches the script, and every query runs against PostgreSQL with
// some made-up events (when TEST_DATABASE_URL is set).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { buildDashboards, queries } from '../../scripts/dashboards.mjs';

const require = createRequire(import.meta.url);
const { createPool, migrate } = require('../../server/db.js');

const URL_ = process.env.TEST_DATABASE_URL;
const SCHEMA = 'dashboards_test';
const skip = URL_ ? false : 'TEST_DATABASE_URL is not set';
const dashboards = buildDashboards();

test('the dashboards in the Helm chart are up to date (npm run dashboards)', () => {
  for (const [name, dash] of Object.entries(dashboards)) {
    const file = JSON.parse(readFileSync(new URL(`../../helm/games-hub/dashboards/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(file, JSON.parse(JSON.stringify(dash)), `${name} is stale: run npm run dashboards`);
  }
});

test('every panel has a unique id and a query on the provisioned data source', () => {
  for (const dash of Object.values(dashboards)) {
    const ids = dash.panels.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of dash.panels.filter((p) => p.type !== 'row')) assert.equal(p.targets[0].datasource.uid, 'games-db');
  }
});

/** What Grafana does to a query before it runs, for the last 90 days and every filter on All. */
function expand(sql) {
  return sql
    .replace(/\$__timeFilter\(([^)]+)\)/g, "$1 BETWEEN now() - interval '90 days' AND now()")
    .replace(/\$__timeGroupAlias\(([^,]+),\s*'1d'\)/g, "date_trunc('day', $1) AS time")
    .replace(/\$\{\w+:sqlstring\}/g, "'ALL'");
}

let pool;

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

  // A few players: some stop early, some get far, over a few weeks.
  const DAY = 86_400_000;
  const rows = [];
  const add = (at, game, name, install, session, save, props, platform = 'web') => rows.push([new Date(at), game, name, install, save, session, game === 'driftworks' ? '0.6.0' : null, platform, JSON.stringify(props)]);
  for (let p = 0; p < 12; p++) {
    const install = randomUUID();
    const save = randomUUID();
    const platform = ['web', 'android', 'ios'][p % 3];
    const start = Date.now() - (40 - p * 3) * DAY;
    for (let day = 0; day < 1 + (p % 5) * 3; day += 1 + (p % 2)) {
      const session = randomUUID();
      const at = start + day * DAY;
      add(at, 'hub', 'session_start', install, session, null, day ? { away_min: 1440 } : { first: true }, platform);
      add(at + 1000, 'hub', 'app_open', install, session, null, { page: 'lobby', first_open: day === 0, os: 'android', device: 'phone', lang: 'nl-NL', tz: 'Europe/Amsterdam', referrer: 'direct', screen: '400x850' }, platform);
      add(at + 2000, 'hub', 'game_card_clicked', install, session, null, { target: 'driftworks' }, platform);
      add(at + 3000, 'driftworks', 'save_opened', install, session, save, { kind: day ? 'continue' : 'new', act: 1, goal_index: 0 }, platform);
      add(at + 4000, 'driftworks', 'menu_view', install, session, save, { view: 'settings', from: 'game' }, platform);
      for (let g = day; g < Math.min(day + 3, p * 2); g++) {
        add(at + 5000 + g, 'driftworks', 'goal_completed', install, session, save, { goal_id: `g${g}`, goal_index: g, act: g < 11 ? 1 : 2, tutorial: g < 7, played_min: g * 10, age_h: day * 24, credits: 1000, ships: 2 }, platform);
      }
      add(at + 6000, 'driftworks', 'research_completed', install, session, save, { research_id: 'hold-1', played_min: 30 }, platform);
      add(at + 6500, 'driftworks', 'ship_built', install, session, save, { hull: 'mule', fleet_size: 3, played_min: 31 }, platform);
      add(at + 7000, 'driftworks', 'progress_snapshot', install, session, save, { act: 1, goal_index: day, ships: 3, copies: p % 2, repeats: 0, played_min: 40 }, platform);
      add(at + 8000, 'driftworks', 'session_heartbeat', install, session, save, {}, platform);
      add(at + 9000, 'snake', 'game_ended', install, session, null, { result: 'lost', length_s: 30, score: 40 }, platform);
    }
    if (p === 11) add(start + 1000, 'driftworks', 'act_completed', install, randomUUID(), save, { act: 1, played_min: 300, age_h: 50 }, platform);
    if (p === 3) add(start + 1000, 'driftworks', 'tutorial_skipped', install, randomUUID(), save, { goal_id: 'first-research', goal_index: 2, act: 1, played_min: 4 }, platform);
    if (p === 5) add(start + 1000, 'hub', 'js_error', install, randomUUID(), null, { message: 'x is not defined', source: 'snake/game.js:#' }, platform);
  }
  for (const r of rows) await pool.query('INSERT INTO events (at, game, name, install_id, save_id, session_id, version, platform, props) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', r);
});

after(async () => {
  if (!URL_) return;
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await pool.end();
});

for (const [name, dash] of Object.entries(dashboards)) {
  for (const { title, sql } of queries(dash)) {
    test(`${name}: "${title}" runs`, { skip }, async () => {
      const { rows } = await pool.query(expand(sql));
      assert.ok(Array.isArray(rows));
    });
  }
}

test('the goal funnel starts with every new save and never grows', { skip }, async () => {
  const funnel = queries(dashboards['driftworks.json']).find((q) => q.title === 'Goal funnel');
  const { rows } = await pool.query(expand(funnel.sql));
  assert.equal(rows[0].Goal, '00 Started');
  assert.ok(Number(rows[0].Saves) > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(Number(rows[i].Saves) <= Number(rows[i - 1].Saves));
});
