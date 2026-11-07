import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, nextEventAt } from '../../public/games/driftworks/core/sim.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { startResearch } from '../../public/games/driftworks/systems/research.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

test('advancing with nothing to do just moves the clock', () => {
  const state = newGame();
  assert.equal(nextEventAt(state), null);
  advance(state, T0 + 10 * MINUTE);
  assert.equal(state.now, T0 + 10 * MINUTE);
});

test('the clock never runs backwards', () => {
  const state = newGame();
  advance(state, T0 + 10 * MINUTE);
  advance(state, T0 + 5 * MINUTE);
  assert.equal(state.now, T0 + 10 * MINUTE);
});

test('a queue keeps running however long the player is away', () => {
  const state = newGame();
  state.research.done.push('queue-1');
  const ship = firstShip(state);
  for (const spec of [
    { type: 'mine', fieldId: 'kx14', amount: null },
    { type: 'sell', stationId: 'halcyon-refinery' },
    { type: 'mine', fieldId: 'kx14', amount: null },
    { type: 'sell', stationId: 'halcyon-refinery' },
  ]) {
    assert.ok(giveOrder(state, ship, spec).ok);
  }
  advance(state, T0 + 12 * 60 * MINUTE);
  assert.equal(ship.order, null);
  assert.equal(ship.queue.length, 0);
  assert.equal(state.stats.oreSold, 20);
  assert.equal(state.stats.sales, 2);
});

test('research finishes on the clock, and goals are checked as it runs', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, { type: 'mine', fieldId: 'carbon-drift', amount: null });
  giveOrder(state, ship, { type: 'sell', stationId: 'halcyon-refinery' });
  assert.ok(startResearch(state, 'hold-1', T0).ok);
  assert.equal(nextEventAt(state), T0 + MINUTE, 'the research ends first');
  advance(state, T0 + 10 * MINUTE);
  assert.deepEqual(state.research, { done: ['hold-1'], active: null, second: null });
  assert.deepEqual(state.goals.slice(0, 2), ['first-sale', 'first-research']);
});
