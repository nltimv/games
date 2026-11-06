import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, registerVisit } from '../../public/games/driftworks/core/sim.js';
import { autonomyEndsAt } from '../../public/games/driftworks/core/state.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const trip = (minutes) => ({ type: 'mine', fieldId: 'kx14', minutes });

test('advancing with nothing to do just moves the clock', () => {
  const state = newGame();
  advance(state, T0 + 10 * MINUTE);
  assert.equal(state.now, T0 + 10 * MINUTE);
});

test('the clock never runs backwards', () => {
  const state = newGame();
  advance(state, T0 + 10 * MINUTE);
  advance(state, T0 + 5 * MINUTE);
  assert.equal(state.now, T0 + 10 * MINUTE);
});

test('a queued order starts when the previous one ends inside the autonomy window', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, trip(25));
  ship.queue.push({ type: 'move', stationId: 'aurel-post' });
  advance(state, T0 + 26 * MINUTE);
  assert.equal(ship.queue.length, 0);
  assert.equal(ship.order?.type, 'move');
});

test('queued work waits for the player once the autonomy window has passed', () => {
  const state = newGame();
  const ship = firstShip(state);
  assert.equal(autonomyEndsAt(state), T0 + 60 * MINUTE);
  // Leave the station after 50 minutes, so the 25 minute trip ends past the window.
  advance(state, T0 + 50 * MINUTE);
  giveOrder(state, ship, trip(25));
  ship.queue.push({ type: 'move', stationId: 'aurel-post' });

  advance(state, T0 + 6 * 60 * MINUTE);
  assert.equal(ship.order, null, 'the given order finished');
  assert.equal(ship.at, 'halcyon-refinery');
  assert.equal(ship.queue.length, 1, 'the queued order is still waiting');

  registerVisit(state, T0 + 6 * 60 * MINUTE);
  assert.equal(ship.queue.length, 0);
  assert.equal(ship.order?.type, 'move');
});

test('goals are checked as the simulation runs', () => {
  const state = newGame();
  giveOrder(state, firstShip(state), trip(5));
  advance(state, T0 + 6 * MINUTE);
  assert.ok(state.goals.includes('first-trip'));
});
