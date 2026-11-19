'use strict';

// Every event the server accepts, with the properties it keeps. Anything
// not listed here is dropped: unknown events entirely, unknown properties
// from known events. Types: 'string' (cut to 64 characters), 'number'
// (finite), 'boolean'. Add an event here before a game sends it.
//
// Common fields (who, when, which game) are not properties: see
// server/telemetry.js. The taxonomy and the questions it answers are in
// docs/analytics.md.

const S = 'string';
const N = 'number';
const B = 'boolean';

const DEVICE = { page: S, first_open: B, os: S, browser: S, device: S, screen: S, touch: B, lang: S, tz: S, referrer: S };

const EVENTS = {
  // Every page (public/shared/js/telemetry.js).
  app_open: DEVICE,
  session_start: { away_min: N, first: B },
  session_heartbeat: {},
  js_error: { message: S, source: S },
  analytics_off: {},

  // The lobby.
  game_card_clicked: { target: S },

  // Small games: one round.
  game_started: { mode: S, level: N },
  game_ended: { mode: S, level: N, result: S, length_s: N, score: N },

  // Driftworks: menus and saves.
  menu_view: { view: S, from: S },
  save_created: { kind: S, saves_on_device: N },
  save_opened: { kind: S, act: N, goal_index: N },
  save_started_over: { reason: S },
  whats_new_viewed: { auto: B },
  settings_changed: { setting: S, value: B },
  away_report_shown: { away_min: N, log_entries: N },

  // Driftworks: progress.
  goal_completed: { goal_id: S, goal_index: N, act: N, tutorial: B, played_min: N, age_h: N, credits: N, ships: N },
  act_completed: { act: N, played_min: N, age_h: N },
  tutorial_skipped: { goal_id: S, goal_index: N, act: N, played_min: N },
  progress_snapshot: {
    act: N,
    goal_index: N,
    played_min: N,
    age_h: N,
    credits: N,
    ships: N,
    research_done: N,
    systems_known: N,
    contracts: N,
    missions: N,
    copies: N,
    repeats: N,
  },

  // Driftworks: systems.
  research_started: { research_id: S, played_min: N },
  research_completed: { research_id: S, played_min: N },
  ship_built: { hull: S, fleet_size: N, played_min: N },
  ship_salvaged: { hull: S, fleet_size: N },
  contract_accepted: { played_min: N },
  contract_completed: { played_min: N },
  system_surveyed: { count: N, played_min: N },
  derelict_salvaged: { count: N },
  commander_hired: { commanders: N, played_min: N },
  mission_started: { count: N, played_min: N },

  // Driftworks: cloud saves.
  cloud_code_prompt: { choice: S },
  cloud_conflict: { choice: S },
  cloud_sync_failed: { state: S },
};

const TYPES = { [S]: (v) => typeof v === 'string', [N]: (v) => typeof v === 'number' && Number.isFinite(v), [B]: (v) => typeof v === 'boolean' };

/** Keeps the properties `name` allows, with the right types. Null for an unknown event. */
function cleanProps(name, props) {
  const schema = Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
  if (!schema) return null;
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  for (const [key, type] of Object.entries(schema)) {
    if (!Object.hasOwn(props, key)) continue;
    const value = props[key];
    if (!TYPES[type](value)) continue;
    out[key] = type === S ? value.slice(0, 64) : value;
  }
  return out;
}

module.exports = { EVENTS, cleanProps };
