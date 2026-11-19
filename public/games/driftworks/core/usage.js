// Usage data for Driftworks (see /privacy and docs/analytics.md): turns what
// changed in a company into events. ui/usage.js keeps a snapshot of the
// state, and after every change compares the new one with it. Watching the
// state, rather than calling track() from every system, keeps the game
// rules free of usage code and catches changes from every source (player
// actions, the clock, missions while away).
//
// Pure functions of the state, so they run in Node tests.

import { GOALS } from '../content/goals.js';

const GOAL_INDEX = new Map(GOALS.map((goal, i) => [goal.id, i]));
const LAST_OF_ACT = new Map();
for (const goal of GOALS) LAST_OF_ACT.set(goal.act ?? 1, goal.id);

/** Survey counts worth an event; every survey would be too many. */
const SURVEY_MILESTONES = [1, 2, 5, 10, 25, 50, 100, 150, 200];

/** Rounds to two significant figures: 12,345 becomes 12,000. Enough to plot, no more. */
export function roughly(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) < 100) return v;
  const scale = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / scale) * scale;
}

/** The goal index (0-based) of the first goal not done yet; GOALS.length when all are. */
export function nextGoalIndex(state) {
  const done = new Set(state.goals ?? []);
  const i = GOALS.findIndex((goal) => !done.has(goal.id));
  return i < 0 ? GOALS.length : i;
}

/** The act the company is in: the act of its first unfinished goal. */
export function actNow(state) {
  const goal = GOALS[nextGoalIndex(state)];
  return goal ? (goal.act ?? 1) : Math.max(...GOALS.map((g) => g.act ?? 1));
}

/** What the comparison needs from a state, copied so later changes don't touch it. */
export function snapshot(state) {
  const stats = state.stats ?? {};
  return {
    goals: [...(state.goals ?? [])],
    research: [...(state.research?.done ?? [])],
    active: [state.research?.active?.id, state.research?.second?.id].filter(Boolean),
    ships: (state.ships ?? []).map((ship) => [ship.id, ship.hull]),
    contracts: stats.contracts ?? 0,
    accepted: stats.contractsAccepted ?? 0,
    surveyed: (state.surveyed ?? []).length,
    derelicts: stats.salvaged ?? 0,
    missions: stats.missions ?? 0,
    hires: state.hires ?? 0,
  };
}

/**
 * The events between snapshot `before` and the current `state`.
 * `playedMin` is the save's play time on this device, `now` the clock.
 * Returns [name, props] pairs.
 */
export function changes(before, state, { playedMin = 0, now = state.now } = {}) {
  const after = snapshot(state);
  const events = [];
  const ageH = Math.max(0, Math.round(((now - (state.createdAt ?? now)) / 3_600_000) * 10) / 10);
  const played = Math.round(playedMin);

  const doneBefore = new Set(before.goals);
  for (const id of after.goals) {
    if (doneBefore.has(id) || !GOAL_INDEX.has(id)) continue;
    const goal = GOALS[GOAL_INDEX.get(id)];
    const act = goal.act ?? 1;
    events.push([
      'goal_completed',
      { goal_id: id, goal_index: GOAL_INDEX.get(id), act, tutorial: Boolean(goal.tutorial), played_min: played, age_h: ageH, credits: roughly(state.credits), ships: after.ships.length },
    ]);
    if (LAST_OF_ACT.get(act) === id) events.push(['act_completed', { act, played_min: played, age_h: ageH }]);
  }

  const researched = new Set(before.research);
  for (const id of after.research) if (!researched.has(id)) events.push(['research_completed', { research_id: id, played_min: played }]);
  const running = new Set(before.active);
  for (const id of after.active) if (!running.has(id) && !researched.has(id)) events.push(['research_started', { research_id: id, played_min: played }]);

  const shipsBefore = new Map(before.ships);
  const shipsAfter = new Map(after.ships);
  for (const [id, hull] of after.ships) if (!shipsBefore.has(id)) events.push(['ship_built', { hull, fleet_size: after.ships.length, played_min: played }]);
  for (const [id, hull] of before.ships) if (!shipsAfter.has(id)) events.push(['ship_salvaged', { hull, fleet_size: after.ships.length }]);

  // Counters: one event per step, a few at most (a long time away can finish many).
  const steps = (from, to) => Math.min(5, Math.max(0, to - from));
  for (let i = 0; i < steps(before.accepted, after.accepted); i++) events.push(['contract_accepted', { played_min: played }]);
  for (let i = 0; i < steps(before.contracts, after.contracts); i++) events.push(['contract_completed', { played_min: played }]);
  for (let i = 0; i < steps(before.missions, after.missions); i++) events.push(['mission_started', { count: before.missions + i + 1, played_min: played }]);
  for (let i = 0; i < steps(before.hires, after.hires); i++) events.push(['commander_hired', { commanders: before.hires + i + 1, played_min: played }]);
  for (let i = 0; i < steps(before.derelicts, after.derelicts); i++) events.push(['derelict_salvaged', { count: before.derelicts + i + 1 }]);

  const milestone = SURVEY_MILESTONES.filter((n) => before.surveyed < n && after.surveyed >= n).at(-1);
  if (milestone) events.push(['system_surveyed', { count: milestone, played_min: played }]);

  return { events, after };
}

/** Where the company stands, sent when the player leaves the game (the last one shows where a player stopped). */
export function progress(state, { playedMin = 0, now = state.now } = {}) {
  const stats = state.stats ?? {};
  return {
    act: actNow(state),
    goal_index: nextGoalIndex(state),
    played_min: Math.round(playedMin),
    age_h: Math.max(0, Math.round(((now - (state.createdAt ?? now)) / 3_600_000) * 10) / 10),
    credits: roughly(state.credits),
    ships: (state.ships ?? []).length,
    research_done: (state.research?.done ?? []).length,
    systems_known: (state.surveyed ?? []).length,
    contracts: stats.contracts ?? 0,
    missions: stats.missions ?? 0,
    copies: stats.copies ?? 0,
    repeats: stats.repeats ?? 0,
  };
}
