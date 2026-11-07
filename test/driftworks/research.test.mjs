import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { RESEARCH, findResearch, prerequisites } from '../../public/games/driftworks/content/research.js';
import { ORDER_SLOTS } from '../../public/games/driftworks/content/ships.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { holdOf, laserOf, refitCost, refitTarget, speedOf } from '../../public/games/driftworks/systems/modules.js';
import { bestModules, canStartResearch, openResearch, orderSlots, researchLevel, startResearch } from '../../public/games/driftworks/systems/research.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

test('research is paid up front, runs one at a time, and finishes on the clock', () => {
  const state = newGame({ credits: 1000 });
  const result = startResearch(state, 'hold-1', T0);
  assert.ok(result.ok);
  assert.equal(state.credits, 900);
  assert.match(startResearch(state, 'brokerage', T0).error, /lab is busy/);
  advance(state, T0 + findResearch('hold-1').minutes * MINUTE);
  assert.equal(state.research.active, null);
  assert.equal(researchLevel(state, 'hold'), 1);
  assert.match(startResearch(state, 'hold-1', state.now).error, /already done/);
});

test('each level needs the one before it, and money is checked', () => {
  const state = newGame({ credits: 100_000 });
  assert.match(canStartResearch(state, 'hold-2').error, /needs Cargo racks I/);
  assert.deepEqual(prerequisites(findResearch('warp-drive')), ['engine-2']);
  state.credits = 10;
  assert.match(canStartResearch(state, 'hold-1').error, /You need/);
  assert.equal(canStartResearch(state, 'nope').ok, false);
});

test('the open list starts with the cheap basics', () => {
  const state = newGame();
  assert.deepEqual(
    openResearch(state).map((r) => r.id),
    ['brokerage', 'hold-1', 'queue-1', 'laser-1', 'kite-licence', 'engine-1'],
  );
});

test('every research has a unique id, a cost, a time and a known prerequisite', () => {
  const ids = new Set(RESEARCH.map((r) => r.id));
  assert.equal(ids.size, RESEARCH.length);
  for (const research of RESEARCH) {
    assert.ok(research.cost > 0 && research.minutes > 0, research.id);
    for (const need of prerequisites(research)) assert.ok(ids.has(need), `${research.id} needs ${need}`);
  }
});

test('queue research raises every ship\'s order slots', () => {
  const state = newGame();
  assert.equal(orderSlots(state), ORDER_SLOTS[0]);
  state.research.done.push('queue-1', 'queue-2');
  assert.equal(orderSlots(state), ORDER_SLOTS[2]);
});

test('ships carry their own modules: new ships get the newest, old ones need a refit', () => {
  const state = newGame();
  const old = firstShip(state);
  assert.equal(holdOf(old), 10);
  assert.equal(laserOf(old), 10);
  assert.equal(speedOf(old), 400);
  state.research.done.push('hold-1', 'laser-1', 'engine-1');
  assert.deepEqual(bestModules(state), { hold: 1, laser: 1, engine: 1 });
  const fresh = createShip(state, 'mule', 'halcyon-shipyard');
  assert.equal(holdOf(fresh), 25);
  assert.equal(refitTarget(state, fresh), null);
  assert.deepEqual(refitTarget(state, old), { hold: 1, laser: 1, engine: 1 });

  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  assert.equal(holdOf(kite), 100, 'a Kite carries four times a Mule');
  assert.equal(laserOf(kite), 0);
  assert.equal(speedOf(kite), 480 * 1.2);
});

test('refits cost more as the modules get better', () => {
  assert.equal(refitCost({ hold: 1, laser: 0, engine: 0 }), 60);
  assert.ok(refitCost({ hold: 5, laser: 4, engine: 2 }) > 1500);
  assert.ok(refitCost({ hold: 2, laser: 1, engine: 0 }) > refitCost({ hold: 1, laser: 1, engine: 0 }));
});
