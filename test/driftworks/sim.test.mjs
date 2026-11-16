import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, nextEventAt } from '../../public/games/driftworks/core/sim.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { findEntry, marketView } from '../../public/games/driftworks/systems/market.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
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
  assert.deepEqual(state.goals, ['first-sale'], 'the next goal wants the Kite to sell');
});

test('a ship at a station with no room sells what fits, waits there for room, then sells the rest', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.modules.hold = 6;
  ship.cargo = { 'ferrite-ore': 1800 };
  ship.at = 'halcyon-shipyard';
  // The refinery is full of ferrite ore.
  const cap = marketView(state, 'halcyon-refinery', 'ferrite-ore').cap;
  state.markets['halcyon-refinery'] = { 'ferrite-ore': { stock: cap, at: T0 } };
  const given = giveOrder(state, ship, { type: 'sell', stationId: 'halcyon-refinery' });
  assert.ok(given.ok, given.error);
  const arrives = given.order.endsAt;
  advance(state, arrives + MINUTE);
  assert.ok(ship.order, 'still there, waiting');
  assert.match(ship.order.label, /Waiting for room at Halcyon Refinery/);
  assert.ok(ship.order.endsAt > arrives + MINUTE);
  assert.ok(ship.cargo['ferrite-ore'] < 1800, 'it sold what fit');
  assert.ok(state.log.some((entry) => /is waiting for room/.test(entry.text)));
  advance(state, T0 + 24 * 60 * MINUTE);
  assert.equal(ship.order, null);
  assert.deepEqual(ship.cargo, {}, 'all of it sold in the end');
  assert.equal(ship.at, 'halcyon-refinery');
});

test("a ship on a commander's orders does not wait at a full station: the commander sends it elsewhere", () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.modules.hold = 6;
  ship.cargo = { 'ferrite-ore': 1800 };
  ship.at = 'halcyon-shipyard';
  const cap = marketView(state, 'halcyon-refinery', 'ferrite-ore').cap;
  state.markets['halcyon-refinery'] = { 'ferrite-ore': { stock: cap, at: T0 } };
  const given = giveOrder(state, ship, { type: 'sell', stationId: 'halcyon-refinery' });
  // As if a commander gave it (there is no such commander, so nobody gives the next order).
  given.order.missionBy = 'ship-commander';
  const arrives = given.order.endsAt;
  advance(state, arrives + MINUTE);
  assert.equal(ship.order, null, 'done, not waiting');
  assert.ok(ship.cargo['ferrite-ore'] > 0, 'with the rest still aboard');
});

test("an old save's buy at a station that is now short of the good is skipped, and the ship carries on", () => {
  let state = newGame({ credits: 100_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'dace', state.now);
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  // A save from before the shortages can hold buys at a station that is now
  // short of the good: one on its way, one in the queue, then a flight home.
  assert.equal(findEntry('dace-tradingpost', 'iron')?.side, 'buys');
  assert.ok(giveOrder(state, kite, { type: 'buy', stationId: 'dace-refinery', good: 'iron', qty: 5 }).ok);
  kite.order.spec.stationId = 'dace-tradingpost';
  kite.order.steps.at(-1).station = 'dace-tradingpost';
  kite.queue.push({ type: 'buy', stationId: 'dace-tradingpost', good: 'iron', qty: 5 }, { type: 'fly', stationId: 'halcyon-refinery' });
  state = deserialize(serialize(state));
  const ship = state.ships.find((s) => s.name === kite.name);
  const credits = state.credits;
  advance(state, T0 + 3 * 24 * 60 * MINUTE);
  const lines = state.log.map((entry) => entry.text);
  assert.ok(lines.some((text) => text === `${ship.name} could not buy: Dace Trading Post does not sell iron.`), lines.join('\n'));
  assert.ok(lines.some((text) => text === `${ship.name} skipped an order: Dace Trading Post does not sell iron.`), lines.join('\n'));
  // Nothing bought, and the rest of the queue ran: the ship is home and free.
  assert.equal(ship.cargo.iron ?? 0, 0);
  assert.equal(ship.order, null);
  assert.deepEqual(ship.queue, []);
  assert.equal(ship.at, 'halcyon-refinery');
  assert.ok(state.credits < credits, 'only the jump fees were paid');
});
