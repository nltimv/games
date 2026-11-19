// Builds the Grafana dashboards for usage data (docs/analytics.md) into
// helm/games-hub/dashboards/*.json, which the Helm chart loads into
// Grafana. Edit the panels here, then run:
//
//   npm run dashboards
//
// Every query reads the `events` table (server/migrations/003_events.sql).
// test/cloud/dashboards.test.mjs runs each one against PostgreSQL and checks
// that the JSON files are up to date.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOALS } from '../public/games/driftworks/content/goals.js';

const DS = { type: 'grafana-postgresql-datasource', uid: 'games-db' };
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'helm', 'games-hub', 'dashboards');

// ---------- Building blocks ----------

let nextId = 1;
const target = (rawSql, format = 'table') => ({ refId: 'A', datasource: DS, rawSql, format, rawQuery: true, editorMode: 'code' });

function panel(type, title, sql, { w = 12, h = 8, x = 0, y = 0, description, format = 'table', options = {}, unit, decimals, overrides = [] } = {}) {
  return {
    id: nextId++,
    type,
    title,
    ...(description ? { description } : {}),
    datasource: DS,
    gridPos: { h, w, x, y },
    targets: [target(sql, format)],
    fieldConfig: { defaults: { ...(unit ? { unit } : {}), ...(decimals != null ? { decimals } : {}) }, overrides },
    options,
  };
}

const stat = (title, sql, opts = {}) =>
  panel('stat', title, sql, { h: 4, w: 6, ...opts, options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'none', graphMode: 'none', textMode: 'value', ...opts.options } });
const series = (title, sql, opts = {}) => panel('timeseries', title, sql, { format: 'time_series', ...opts, options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' }, ...opts.options } });
const bars = (title, sql, opts = {}) => panel('barchart', title, sql, { ...opts, options: { orientation: 'horizontal', showValue: 'auto', legend: { displayMode: 'list', placement: 'bottom', showLegend: false }, xTickLabelMaxLength: 32, ...opts.options } });
const table = (title, sql, opts = {}) => panel('table', title, sql, { ...opts, options: { showHeader: true, cellHeight: 'sm', ...opts.options } });
const row = (title, y) => ({ id: nextId++, type: 'row', title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] });

/** A filter variable whose "All" is the value ALL, so queries still work before any data exists. */
function variable(name, label, query, { custom = false } = {}) {
  return {
    type: custom ? 'custom' : 'query',
    name,
    label,
    ...(custom ? { query, options: [] } : { datasource: DS, query, definition: query, refresh: 2, sort: 0 }),
    includeAll: true,
    // Grafana puts a custom All value in as is, without formatting it: so it carries its own quotes.
    allValue: "'ALL'",
    multi: true,
    current: { selected: true, text: ['All'], value: ['$__all'] },
    hide: 0,
  };
}

/** SQL for "matches the variable", true for All. */
const pick = (column, name) => `('ALL' IN (\${${name}:sqlstring}) OR ${column} IN (\${${name}:sqlstring}))`;

function dashboard({ uid, title, description, panels, variables = [], time = 'now-30d' }) {
  return {
    uid,
    title,
    description,
    tags: ['games-hub', 'usage'],
    timezone: 'browser',
    editable: false,
    graphTooltip: 1,
    schemaVersion: 39,
    version: 1,
    refresh: '',
    time: { from: time, to: 'now' },
    templating: { list: variables },
    annotations: { list: [] },
    links: [{ title: 'Games Hub dashboards', type: 'dashboards', tags: ['games-hub'], asDropdown: true }],
    panels,
  };
}

// ---------- Overview: every game ----------

const PLATFORM = variable('platform', 'Platform', 'web,android,ios', { custom: true });
const onPlatform = pick('platform', 'platform');

function overview() {
  nextId = 1;
  const f = `$__timeFilter(at) AND ${onPlatform}`;
  const opened = `name = 'app_open' AND ${f}`;
  const byProp = (prop) =>
    `SELECT coalesce(nullif(props->>'${prop}', ''), 'unknown') AS "${prop}", count(DISTINCT install_id) AS "Players"
FROM events WHERE ${opened}
GROUP BY 1 ORDER BY 2 DESC LIMIT 12`;
  let y = 0;
  const panels = [
    stat('Players', `SELECT count(DISTINCT install_id) AS "Players" FROM events WHERE ${f}`, { x: 0, y, description: 'Devices or browsers with any event in the time range.' }),
    stat('New players', `SELECT count(DISTINCT install_id) AS "New" FROM events WHERE ${opened} AND props->>'first_open' = 'true'`, { x: 6, y }),
    stat('Sessions', `SELECT count(DISTINCT session_id) AS "Sessions" FROM events WHERE ${f}`, { x: 12, y, description: 'A session ends after 30 minutes without events.' }),
    stat(
      'Median session',
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) AS "Minutes"
FROM (SELECT extract(epoch FROM max(at) - min(at)) / 60 AS mins FROM events WHERE ${f} GROUP BY session_id) s`,
      { x: 18, y, unit: 'm', decimals: 1, description: 'First to last event of a session. Heartbeats every 5 minutes while a page is on screen.' },
    ),
  ];
  y += 4;
  panels.push(
    series(
      'Players per day',
      `SELECT $__timeGroupAlias(at, '1d'), count(DISTINCT install_id) AS "Players", count(DISTINCT session_id) AS "Sessions"
FROM events WHERE ${f}
GROUP BY 1 ORDER BY 1`,
      { x: 0, y, w: 16 },
    ),
    bars('Platform', `SELECT platform AS "Platform", count(DISTINCT install_id) AS "Players" FROM events WHERE ${f} GROUP BY 1 ORDER BY 2 DESC`, { x: 16, y, w: 8 }),
  );
  y += 8;
  panels.push(row('Devices', y));
  y += 1;
  panels.push(
    bars('Device type', byProp('device'), { x: 0, y, w: 8 }),
    bars('Operating system', byProp('os'), { x: 8, y, w: 8 }),
    bars('Browser', byProp('browser'), { x: 16, y, w: 8 }),
  );
  y += 8;
  panels.push(
    bars('Language', byProp('lang'), { x: 0, y, w: 8, description: 'The device language. A rough stand-in for where players are.' }),
    bars('Time zone', byProp('tz'), { x: 8, y, w: 8 }),
    bars('Screen size', byProp('screen'), { x: 16, y, w: 8, description: 'Rounded to 50 px.' }),
  );
  y += 8;
  panels.push(row('Games', y));
  y += 1;
  panels.push(
    table(
      'Games played',
      `SELECT game AS "Game",
  count(DISTINCT install_id) AS "Players",
  count(DISTINCT session_id) AS "Sessions",
  round(sum(mins)::numeric / nullif(count(DISTINCT session_id), 0), 1) AS "Minutes per session"
FROM (
  SELECT game, install_id, session_id, extract(epoch FROM max(at) - min(at)) / 60 AS mins
  FROM events WHERE ${f} AND game <> 'hub'
  GROUP BY game, install_id, session_id
) s
GROUP BY game ORDER BY 2 DESC`,
      { x: 0, y, w: 12 },
    ),
    bars('Lobby: cards opened', `SELECT props->>'target' AS "Game", count(*) AS "Opened" FROM events WHERE name = 'game_card_clicked' AND ${f} GROUP BY 1 ORDER BY 2 DESC`, { x: 12, y, w: 6 }),
    bars('Where visitors came from', byProp('referrer'), { x: 18, y, w: 6 }),
  );
  y += 8;
  panels.push(
    table(
      'Small games: rounds',
      `SELECT game AS "Game", coalesce(props->>'mode', '') AS "Mode",
  count(*) FILTER (WHERE name = 'game_started') AS "Started",
  count(*) FILTER (WHERE name = 'game_ended' AND props->>'result' IN ('won', 'perfect')) AS "Won",
  count(*) FILTER (WHERE name = 'game_ended' AND props->>'result' = 'lost') AS "Lost",
  round(avg((props->>'length_s')::numeric) FILTER (WHERE name = 'game_ended'), 0) AS "Avg seconds",
  max((props->>'level')::int) AS "Highest level"
FROM events WHERE name IN ('game_started', 'game_ended') AND ${f}
GROUP BY 1, 2 ORDER BY 1, 2`,
      { x: 0, y, w: 24 },
    ),
  );
  y += 8;
  panels.push(row('Coming back', y));
  y += 1;
  panels.push(
    table(
      'Retention by week of first visit',
      `WITH first AS (
  SELECT install_id, min(at) AS first_at FROM events WHERE ${onPlatform} GROUP BY install_id
), days AS (
  SELECT DISTINCT install_id, (at::date) AS day FROM events WHERE ${onPlatform}
)
SELECT to_char(date_trunc('week', f.first_at), 'YYYY-MM-DD') AS "Week",
  count(*) AS "New players",
  round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.install_id = f.install_id AND d.day = f.first_at::date + 1)) / count(*), 1) AS "Day 1 %",
  round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.install_id = f.install_id AND d.day = f.first_at::date + 7)) / count(*), 1) AS "Day 7 %",
  round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.install_id = f.install_id AND d.day = f.first_at::date + 30)) / count(*), 1) AS "Day 30 %",
  round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.install_id = f.install_id AND d.day > f.first_at::date + 7)) / count(*), 1) AS "Back after a week %"
FROM first f
WHERE $__timeFilter(f.first_at)
GROUP BY 1 ORDER BY 1 DESC`,
      { x: 0, y, w: 16, description: 'Share of the players first seen that week who played again exactly 1, 7 and 30 days later, and at any time more than a week later. Recent weeks have not had the time yet.' },
    ),
    bars(
      'Time away between sessions',
      `SELECT CASE WHEN m <= 60 THEN '< 1 h' WHEN m <= 240 THEN '1-4 h' WHEN m <= 720 THEN '4-12 h' WHEN m <= 1440 THEN '12-24 h' WHEN m <= 10080 THEN '1-7 days' ELSE '> 7 days' END AS "Away",
  count(*) AS "Sessions"
FROM (SELECT (props->>'away_min')::numeric AS m FROM events WHERE name = 'session_start' AND props ? 'away_min' AND ${f}) s
GROUP BY 1 ORDER BY min(m)`,
      { x: 16, y, w: 8 },
    ),
  );
  y += 9;
  panels.push(row('Health', y));
  y += 1;
  panels.push(
    table(
      'Script errors',
      `SELECT game AS "Game", version AS "Version", props->>'message' AS "Message", props->>'source' AS "Where",
  count(*) AS "Times", count(DISTINCT install_id) AS "Players", max(at) AS "Last"
FROM events WHERE name = 'js_error' AND ${f}
GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 50`,
      { x: 0, y, w: 16 },
    ),
    series(
      'Events per day',
      `SELECT $__timeGroupAlias(at, '1d'), count(*) AS "Events", count(*) FILTER (WHERE name = 'analytics_off') AS "Turned off"
FROM events WHERE ${f}
GROUP BY 1 ORDER BY 1`,
      { x: 16, y, w: 8, description: 'Volume, and players turning usage data off.' },
    ),
  );
  return dashboard({ uid: 'games-overview', title: 'Games Hub: overview', description: 'Players, sessions, devices and games, for the whole hub.', variables: [PLATFORM], panels });
}

// ---------- Driftworks ----------

/** The goals as SQL rows: (index, label). -1 is "Started", the last is "All done". */
function goalRows() {
  const rows = [[-1, '00 Started']];
  GOALS.forEach((goal, i) => rows.push([i, `${String(i + 1).padStart(2, '0')} A${goal.act ?? 1} ${goal.title}`]));
  rows.push([GOALS.length, `${GOALS.length + 1} All done`]);
  return `goals(i, label) AS (VALUES ${rows.map(([i, label]) => `(${i}, '${label.replace(/'/g, "''")}')`).join(', ')})`;
}

function driftworks() {
  nextId = 1;
  const VERSION = variable('version', 'Version', "SELECT DISTINCT version FROM events WHERE game = 'driftworks' AND version IS NOT NULL ORDER BY 1 DESC");
  const dw = `game = 'driftworks' AND ${pick('version', 'version')} AND ${onPlatform}`;
  const f = `${dw} AND $__timeFilter(at)`;
  // New saves opened in the time range: the funnel follows them to now.
  const cohort = `cohort AS (
  SELECT DISTINCT save_id FROM events
  WHERE name = 'save_opened' AND props->>'kind' = 'new' AND save_id IS NOT NULL AND ${f}
)`;
  const tops = `${cohort}, top AS (
  SELECT c.save_id, coalesce(max((e.props->>'goal_index')::int), -1) AS top
  FROM cohort c LEFT JOIN events e ON e.save_id = c.save_id AND e.name = 'goal_completed'
  GROUP BY c.save_id
)`;
  const reached = `${tops}, ${goalRows()}`;

  let y = 0;
  const panels = [
    stat('Players', `SELECT count(DISTINCT install_id) AS "Players" FROM events WHERE ${f}`, { x: 0, y }),
    stat('New saves', `SELECT count(DISTINCT save_id) AS "Saves" FROM events WHERE name = 'save_opened' AND props->>'kind' = 'new' AND ${f}`, { x: 6, y }),
    stat(
      'Tutorial finished',
      `WITH ${tops}
SELECT round(100.0 * count(*) FILTER (WHERE top >= ${GOALS.filter((g) => g.tutorial && (g.act ?? 1) === 1).length - 1}) / nullif(count(*), 0), 1) AS "%" FROM top`,
      { x: 12, y, unit: 'percent', description: 'Share of the new saves that completed every act 1 tutorial goal.' },
    ),
    stat(
      'Median play time per player',
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) AS "Minutes"
FROM (SELECT install_id, sum(mins) AS mins FROM (
  SELECT install_id, session_id, extract(epoch FROM max(at) - min(at)) / 60 AS mins FROM events WHERE ${f} GROUP BY 1, 2
) s GROUP BY install_id) p`,
      { x: 18, y, unit: 'm', decimals: 0 },
    ),
  ];
  y += 4;
  panels.push(row('Where players stop', y));
  y += 1;
  panels.push(
    bars(
      'Goal funnel',
      `WITH ${reached}
SELECT g.label AS "Goal", (SELECT count(*) FROM top WHERE top.top >= g.i) AS "Saves"
FROM goals g WHERE g.i < ${GOALS.length} ORDER BY g.i`,
      { x: 0, y, w: 12, h: 18, description: 'New saves started in the time range, and how many of them completed each goal by now. Goals complete in order. A1, A2, A3 are the acts.' },
    ),
    bars(
      'Stopped playing at',
      `WITH saves AS (
  SELECT save_id, max(at) AS last_at, min(at) AS first_at,
    coalesce(max((props->>'goal_index')::int) FILTER (WHERE name = 'goal_completed'), -1) + 1 AS next
  FROM events WHERE ${dw} AND save_id IS NOT NULL
  GROUP BY save_id
), ${goalRows()}
SELECT g.label AS "Next goal", count(s.save_id) AS "Saves"
FROM goals g LEFT JOIN saves s ON s.next = g.i AND s.last_at < now() - interval '7 days' AND $__timeFilter(s.first_at)
WHERE g.i >= 0
GROUP BY g.i, g.label ORDER BY g.i`,
      { x: 12, y, w: 12, h: 18, description: 'Saves started in the time range with no events for 7 days, by the goal they were on when they stopped.' },
    ),
  );
  y += 18;
  panels.push(
    table(
      'Goals: reach and time',
      `WITH ${reached}, started AS (SELECT count(*) AS n FROM top), times AS (
  SELECT (e.props->>'goal_index')::int AS i,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'played_min')::numeric) AS played,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'age_h')::numeric) AS age
  FROM events e JOIN cohort c ON c.save_id = e.save_id
  WHERE e.name = 'goal_completed' GROUP BY 1
), skips AS (
  SELECT (props->>'goal_index')::int AS i, count(*) AS n FROM events WHERE name = 'tutorial_skipped' AND ${f} GROUP BY 1
)
SELECT g.label AS "Goal",
  (SELECT count(*) FROM top WHERE top.top >= g.i) AS "Saves",
  round(100.0 * (SELECT count(*) FROM top WHERE top.top >= g.i) / nullif((SELECT n FROM started), 0), 1) AS "% of started",
  round(100.0 * (SELECT count(*) FROM top WHERE top.top >= g.i) / nullif((SELECT count(*) FROM top WHERE top.top >= g.i - 1), 0), 1) AS "% of previous",
  round(t.played::numeric, 1) AS "Median minutes played",
  round(t.age::numeric, 1) AS "Median hours since start",
  coalesce(s.n, 0) AS "Guide skipped here"
FROM goals g LEFT JOIN times t ON t.i = g.i LEFT JOIN skips s ON s.i = g.i
WHERE g.i BETWEEN 0 AND ${GOALS.length - 1}
ORDER BY g.i`,
      { x: 0, y, w: 24, h: 24, description: 'Minutes played counts time with the game on screen on that device. Hours since start is real time since the company was founded. Compare with the balance bots (npm run balance).' },
    ),
  );
  y += 24;
  panels.push(
    table(
      'Acts',
      `SELECT 'Act ' || (props->>'act') AS "Act", count(DISTINCT save_id) AS "Saves finished",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'played_min')::numeric)::numeric / 60, 1) AS "Median hours played",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'age_h')::numeric)::numeric / 24, 1) AS "Median days since start"
FROM events WHERE name = 'act_completed' AND ${f}
GROUP BY props->>'act' ORDER BY 1`,
      { x: 0, y, w: 12, h: 6 },
    ),
    table(
      'Versions',
      `WITH saves AS (
  SELECT version, save_id, max((props->>'goal_index')::int) FILTER (WHERE name = 'goal_completed') AS top
  FROM events WHERE ${f} AND save_id IS NOT NULL GROUP BY 1, 2
)
SELECT version AS "Version", count(*) AS "Saves played", round(avg(coalesce(top, -1) + 1), 1) AS "Avg goals done"
FROM saves GROUP BY 1 ORDER BY 1 DESC`,
      { x: 12, y, w: 12, h: 6, description: 'Compare a release with the one before it.' },
    ),
  );
  y += 6;
  panels.push(row('What players do', y));
  y += 1;
  panels.push(
    table(
      'Research',
      `SELECT props->>'research_id' AS "Research",
  count(*) FILTER (WHERE name = 'research_started') AS "Started",
  count(*) FILTER (WHERE name = 'research_completed') AS "Done",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'played_min')::numeric) FILTER (WHERE name = 'research_completed')::numeric, 0) AS "Median minutes played when done"
FROM events WHERE name IN ('research_started', 'research_completed') AND ${f}
GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
      { x: 0, y, w: 12, h: 10 },
    ),
    bars('Ships built', `SELECT props->>'hull' AS "Hull", count(*) AS "Built" FROM events WHERE name = 'ship_built' AND ${f} GROUP BY 1 ORDER BY 2 DESC`, { x: 12, y, w: 6, h: 10 }),
    table(
      'Activity',
      `SELECT name AS "Event", count(*) AS "Times", count(DISTINCT save_id) AS "Saves"
FROM events WHERE name IN ('contract_accepted', 'contract_completed', 'mission_started', 'commander_hired', 'derelict_salvaged', 'ship_salvaged', 'system_surveyed') AND ${f}
GROUP BY 1 ORDER BY 2 DESC`,
      { x: 18, y, w: 6, h: 10 },
    ),
  );
  y += 10;
  panels.push(
    table(
      'Shortcuts found (latest snapshot per save)',
      `WITH latest AS (
  SELECT DISTINCT ON (save_id) save_id, props FROM events
  WHERE name = 'progress_snapshot' AND ${f} ORDER BY save_id, at DESC
)
SELECT 'Act ' || (props->>'act') AS "Act", count(*) AS "Saves",
  round(100.0 * count(*) FILTER (WHERE (props->>'copies')::int > 0) / count(*), 1) AS "Used Copy orders %",
  round(100.0 * count(*) FILTER (WHERE (props->>'repeats')::int > 0) / count(*), 1) AS "Used Repeat to fill %",
  round(avg((props->>'ships')::numeric), 1) AS "Avg ships"
FROM latest GROUP BY props->>'act' ORDER BY 1`,
      { x: 0, y, w: 12, h: 6, description: 'The tutorial only offers these as tips. Do players find them?' },
    ),
    bars(
      'Menus opened',
      `SELECT (props->>'from') || ': ' || (props->>'view') AS "Page", count(*) AS "Opened" FROM events WHERE name = 'menu_view' AND ${f} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      { x: 12, y, w: 12, h: 6 },
    ),
  );
  y += 6;
  panels.push(row('Saves and cloud', y));
  y += 1;
  panels.push(
    table(
      'Saves',
      `SELECT name AS "Event", coalesce(props->>'kind', props->>'choice', props->>'reason', props->>'state', '') AS "Kind", count(*) AS "Times"
FROM events WHERE name IN ('save_created', 'save_opened', 'save_started_over', 'cloud_code_prompt', 'cloud_conflict', 'cloud_sync_failed', 'whats_new_viewed', 'away_report_shown', 'settings_changed') AND ${f}
GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
      { x: 0, y, w: 12, h: 10 },
    ),
    series(
      'Sessions per day',
      `SELECT $__timeGroupAlias(at, '1d'), count(DISTINCT session_id) AS "Sessions", count(DISTINCT install_id) AS "Players"
FROM events WHERE ${f}
GROUP BY 1 ORDER BY 1`,
      { x: 12, y, w: 12, h: 10 },
    ),
  );
  return dashboard({ uid: 'driftworks', title: 'Driftworks', description: 'Progress, drop-off and feature use in Driftworks.', variables: [VERSION, PLATFORM], panels, time: 'now-90d' });
}

export function buildDashboards() {
  return { 'overview.json': overview(), 'driftworks.json': driftworks() };
}

/** Every query in a dashboard (for tests). */
export function queries(dash) {
  return dash.panels.filter((p) => p.targets).map((p) => ({ title: p.title, sql: p.targets[0].rawSql }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, dash] of Object.entries(buildDashboards())) {
    writeFileSync(join(OUT, name), `${JSON.stringify(dash, null, 2)}\n`);
    console.log(`Wrote ${join('helm/games-hub/dashboards', name)} (${dash.panels.length} panels)`);
  }
}
