// Usage events from what changed in a company (core/usage.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { actNow, changes, nextGoalIndex, progress, roughly, snapshot } from '../../public/games/driftworks/core/usage.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { createSession } from '../../public/games/driftworks/core/session.js';
import { sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { newGame, T0 } from './helpers.mjs';

const HOUR = 3_600_000;
const names = (events) => events.map(([name]) => name);

test('nothing changed, nothing to tell', () => {
  const state = newGame();
  assert.deepEqual(changes(snapshot(state), state).events, []);
});

test('a completed goal carries where and when; the last goal of an act also ends the act', () => {
  const state = newGame();
  const before = snapshot(state);
  state.goals.push('first-sale');
  state.credits = 12_345;
  const { events } = changes(before, state, { playedMin: 7.6, now: T0 + 2 * HOUR });
  assert.deepEqual(events, [
    ['goal_completed', { goal_id: 'first-sale', goal_index: 0, act: 1, tutorial: true, played_min: 8, age_h: 2, credits: 12_000, ships: 2 }],
  ]);

  const lastOfAct1 = GOALS.filter((g) => (g.act ?? 1) === 1).at(-1);
  const all = snapshot(state);
  state.goals = GOALS.filter((g) => (g.act ?? 1) === 1).map((g) => g.id);
  const act = changes(all, state).events;
  assert.equal(act.at(-2)[1].goal_id, lastOfAct1.id);
  assert.deepEqual(act.at(-1), ['act_completed', { act: 1, played_min: 0, age_h: 0 }]);
  assert.equal(actNow(state), 2);
  assert.equal(nextGoalIndex(state), state.goals.length);
});

test('research, ships, contracts, missions and surveys each tell once', () => {
  const state = newGame();
  const before = snapshot(state);
  state.research.active = { id: 'hold-1' };
  createShip(state, 'mule', 'halcyon-shipyard');
  state.ships.shift();
  state.stats.contractsAccepted = 2;
  state.stats.contracts = 1;
  state.stats.missions = 1;
  state.hires = 1;
  state.stats.salvaged = 1;
  state.surveyed = Array.from({ length: 6 }, (_, i) => `s${i}`);
  const { events, after } = changes(before, state);
  assert.deepEqual(names(events), [
    'research_started',
    'ship_built',
    'ship_salvaged',
    'contract_accepted',
    'contract_accepted',
    'contract_completed',
    'mission_started',
    'commander_hired',
    'derelict_salvaged',
    'system_surveyed',
  ]);
  // Only the highest survey milestone passed.
  assert.equal(events.at(-1)[1].count, 5);
  assert.equal(events[1][1].hull, 'mule');

  state.research.done.push('hold-1');
  state.research.active = null;
  assert.deepEqual(names(changes(after, state).events), ['research_completed']);
});

test('a long time away tells a few steps, not hundreds', () => {
  const state = newGame();
  const before = snapshot(state);
  state.stats.contracts = 300;
  assert.equal(changes(before, state).events.length, 5);
});

test('the snapshot does not follow later changes to the state', () => {
  const state = newGame();
  const before = snapshot(state);
  state.goals.push('first-sale');
  assert.deepEqual(before.goals, []);
});

test('progress and rough numbers', () => {
  const state = newGame();
  const p = progress(state, { playedMin: 3, now: T0 + HOUR });
  assert.equal(p.act, 1);
  assert.equal(p.goal_index, 0);
  assert.equal(p.ships, 2);
  assert.equal(p.age_h, 1);
  assert.equal(roughly(87), 87);
  assert.equal(roughly(1_234_567), 1_200_000);
  assert.equal(roughly(-4567), -4600);
});

test('a real goal through the session shows up as an event', () => {
  let now = T0;
  const session = createSession({ storage: createMemoryStorage(), clock: () => now });
  let before = snapshot(session.state);
  const seen = [];
  session.subscribe(() => {
    const { events, after } = changes(before, session.state, { now });
    before = after;
    seen.push(...events);
  });
  now += 60_000;
  session.act((state) => {
    const ship = createShip(state, 'mule', 'halcyon-refinery');
    ship.cargo['ferrite-ore'] = 10;
    return sellCargo(state, ship, 'ferrite-ore');
  });
  assert.deepEqual(names(seen), ['goal_completed', 'ship_built']);
});
