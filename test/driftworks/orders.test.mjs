import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, nextEventAt } from '../../public/games/driftworks/core/sim.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder, miningYield, shipStatus } from '../../public/games/driftworks/systems/orders.js';
import { HULLS } from '../../public/games/driftworks/content/ships.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

test('longer trips mine more per minute', () => {
  const state = newGame();
  const ship = firstShip(state);
  const perMinute = [5, 15, 25, 50].map((m) => miningYield(ship, 'kx14', m) / m);
  for (let i = 1; i < perMinute.length; i += 1) assert.ok(perMinute[i] > perMinute[i - 1], perMinute.join(', '));
});

test('mining yield never exceeds the free hold', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo.ice = HULLS.mule.hold - 10;
  assert.equal(miningYield(ship, 'silica-reef', 50), 10);
});

test('a mining trip brings ore back to the station it left from', () => {
  const state = newGame();
  const ship = firstShip(state);
  const home = ship.at;
  const result = giveOrder(state, ship, { type: 'mine', fieldId: 'kx14', minutes: 25 });
  assert.ok(result.ok);
  assert.equal(ship.at, null);
  assert.equal(nextEventAt(state), T0 + 25 * MINUTE);

  advance(state, T0 + 24 * MINUTE);
  assert.equal(ship.at, null, 'still out');
  assert.match(shipStatus(ship), /Mining KX-14/);

  advance(state, T0 + 25 * MINUTE);
  assert.equal(ship.at, home);
  assert.equal(ship.order, null);
  assert.equal(ship.cargo['ferrite-ore'], result.order.steps[0].amount);
  assert.equal(state.stats.miningTrips, 1);
});

test('a busy ship cannot take a second order', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, { type: 'mine', fieldId: 'kx14', minutes: 5 });
  const second = giveOrder(state, ship, { type: 'mine', fieldId: 'rime', minutes: 5 });
  assert.equal(second.ok, false);
  assert.match(second.error, /busy/);
});

test('haulers cannot mine and bad specs are refused', () => {
  const state = newGame();
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  assert.equal(giveOrder(state, kite, { type: 'mine', fieldId: 'kx14', minutes: 5 }).ok, false);
  assert.equal(giveOrder(state, firstShip(state), { type: 'mine', fieldId: 'kx14', minutes: 7 }).ok, false);
  assert.equal(giveOrder(state, firstShip(state), { type: 'teleport' }).ok, false);
  assert.equal(giveOrder(state, firstShip(state), { type: 'move', stationId: 'halcyon-refinery' }).ok, false, 'already there');
});

test('a delivery sells its cargo on arrival', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo['ferrite-ore'] = 50;
  const credits = state.credits;
  const result = giveOrder(state, ship, { type: 'move', stationId: 'aurel-post', sell: 'ferrite-ore' });
  assert.ok(result.ok);
  advance(state, result.order.endsAt);
  assert.equal(ship.at, 'aurel-post');
  assert.equal(ship.cargo['ferrite-ore'], undefined);
  assert.ok(state.credits > credits);
});

test('a delivery to a station that does not buy the good is refused', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo.ice = 20;
  const result = giveOrder(state, ship, { type: 'move', stationId: 'aurel-post', sell: 'ice' });
  assert.equal(result.ok, false);
});
