import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, nextEventAt } from '../../public/games/driftworks/core/sim.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import {
  cancelOrder,
  canCopy,
  cargoNow,
  minedSoFar,
  canRepeat,
  canRunAgain,
  clearQueue,
  copyOrders,
  freeSlots,
  giveOrder,
  orderPhase,
  orderRefit,
  orderTimes,
  planCycle,
  projectShip,
  refitAll,
  repeatToFill,
  roomForRounds,
  runAgain,
  runAllAgain,
  shipStatus,
} from '../../public/games/driftworks/systems/orders.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { travelTime } from '../../public/games/driftworks/systems/travel.js';
import { findField } from '../../public/games/driftworks/content/homeSystem.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const mine = (fieldId = 'kx14', amount = null) => ({ type: 'mine', fieldId, amount });
const sell = (stationId = 'halcyon-refinery', good) => ({ type: 'sell', stationId, ...(good ? { good } : {}) });

test('a full-hold mining order takes the flight plus hold / (laser x richness)', () => {
  const state = newGame();
  const ship = firstShip(state);
  const result = giveOrder(state, ship, mine('carbon-drift'));
  assert.ok(result.ok);
  assert.equal(result.queued, false);
  const travel = travelTime(ship, 'halcyon-refinery', 'carbon-drift');
  const mining = (holdOf(ship) / (10 * findField('carbon-drift').richness)) * MINUTE;
  assert.equal(ship.order.endsAt, T0 + travel + mining);
  assert.equal(ship.order.steps[0].amount, holdOf(ship));
  assert.equal(ship.at, null);
  assert.equal(nextEventAt(state), ship.order.endsAt);
});

test('the flight to the field is not part of the mining job', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, mine('carbon-drift'));
  const order = ship.order;
  const travel = travelTime(ship, 'halcyon-refinery', 'carbon-drift');
  const { flight, work } = orderTimes(order);
  assert.equal(flight, travel);
  assert.equal(work, order.endsAt - T0 - travel);
  const flying = orderPhase(order, T0);
  assert.deepEqual(flying, { label: 'Flying to Carbon Drift to mine', start: T0, end: T0 + travel, flying: true });
  const mining = orderPhase(order, T0 + travel + 1);
  assert.deepEqual(mining, { label: 'Mining Carbon Drift', start: T0 + travel, end: order.endsAt, flying: false });
  assert.match(shipStatus(ship, T0), /^Flying to Carbon Drift/);

  // A sale happens on arrival: the whole order is its flight.
  ship.order = null;
  ship.at = 'carbon-drift';
  ship.cargo['carbon-ore'] = 10;
  giveOrder(state, ship, sell());
  assert.equal(orderTimes(ship.order).work, 0);
  assert.match(orderPhase(ship.order, T0).label, /Flying to Halcyon Refinery to sell carbon ore/);
});

test('a smaller amount mines faster, and the ship waits at the field', () => {
  const state = newGame();
  const ship = firstShip(state);
  const full = giveOrder(state, createShip(state, 'mule', 'halcyon-refinery'), mine('kx14')).order;
  const part = giveOrder(state, ship, mine('kx14', 4)).order;
  assert.ok(part.endsAt < full.endsAt);
  advance(state, part.endsAt);
  assert.equal(ship.order, null);
  assert.equal(ship.at, 'kx14');
  assert.equal(ship.cargo['ferrite-ore'], 4);
  assert.match(shipStatus(ship), /Waiting at KX-14 with 4 t ferrite ore/);
});

test('a sell order flies to the station and sells everything it buys', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.at = 'kx14';
  ship.cargo['ferrite-ore'] = 8;
  const credits = state.credits;
  const result = giveOrder(state, ship, sell('aurel-post'));
  assert.ok(result.ok);
  advance(state, result.order.endsAt);
  assert.equal(ship.at, 'aurel-post');
  assert.deepEqual(ship.cargo, {});
  assert.ok(state.credits > credits);
  assert.equal(state.stats.oreSold, 8);
});

test('orders for a busy ship queue up to the slot limit, checked from where it will be', () => {
  const state = newGame();
  const ship = firstShip(state);
  assert.equal(freeSlots(state, ship), 2);
  giveOrder(state, ship, mine('kx14'));
  // Its hold will be full after the current order, so another mine is refused...
  const again = giveOrder(state, ship, mine('rime'));
  assert.equal(again.ok, false);
  assert.match(again.error, /hold is full/);
  // ...but a sale of the ore it will carry is fine.
  const queued = giveOrder(state, ship, sell());
  assert.ok(queued.ok && queued.queued);
  assert.equal(queued.order.startedAt, ship.order.endsAt, 'the estimate starts when the current order ends');
  assert.equal(freeSlots(state, ship), 0);
  assert.match(giveOrder(state, ship, { type: 'fly', stationId: 'aurel-post' }).error, /orders are full/);

  // The queue runs on its own.
  advance(state, queued.order.endsAt);
  assert.equal(ship.order, null);
  assert.equal(ship.at, 'halcyon-refinery');
  assert.equal(state.stats.oreSold, holdOf(ship));
});

test('the projection follows the queue: place, cargo and time', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, mine('kx14'));
  let view = projectShip(state, ship);
  assert.equal(view.at, 'kx14');
  assert.equal(view.cargo['ferrite-ore'], holdOf(ship));
  assert.equal(view.time, ship.order.endsAt);
  giveOrder(state, ship, sell('aurel-post'));
  view = projectShip(state, ship);
  assert.equal(view.at, 'aurel-post');
  assert.deepEqual(view.cargo, {});
});

test('a queued order that can no longer run is skipped with a warning', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo.ice = 5;
  giveOrder(state, ship, { type: 'fly', stationId: 'aurel-post' });
  giveOrder(state, ship, sell('halcyon-refinery'));
  ship.cargo = {}; // the ice is gone before the sale starts
  advance(state, T0 + 30 * MINUTE);
  assert.equal(ship.order, null);
  assert.equal(ship.queue.length, 0);
  assert.equal(state.log.at(-1).kind, 'warning');
});

test('bad orders are refused', () => {
  const state = newGame();
  const ship = firstShip(state);
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  assert.match(giveOrder(state, kite, mine()).error, /not a mining ship/);
  assert.equal(giveOrder(state, ship, { type: 'teleport' }).ok, false);
  assert.equal(giveOrder(state, ship, { type: 'fly', stationId: 'halcyon-refinery' }).ok, false, 'already there');
  assert.equal(giveOrder(state, ship, sell()).ok, false, 'nothing to sell');
  assert.equal(giveOrder(state, ship, { type: 'buy', stationId: 'halcyon-refinery', good: 'iron', qty: 5 }).ok, false, 'miners do not buy');
});

test('clearing the queue keeps the current order and trims the plan', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, mine());
  giveOrder(state, ship, sell());
  assert.equal(ship.plan.length, 2);
  assert.ok(clearQueue(state, ship).ok);
  assert.equal(ship.queue.length, 0);
  assert.ok(ship.order);
  assert.equal(ship.plan.length, 1);
  assert.equal(clearQueue(state, ship).ok, false);
});

test('repeat to fill adds whole rounds of the plan that would work', () => {
  const state = newGame();
  state.research.done.push('queue-1'); // 4 orders
  const ship = firstShip(state);
  giveOrder(state, ship, mine());
  assert.equal(roomForRounds(state, ship), 0, 'a second mine would find the hold full');
  giveOrder(state, ship, sell());
  assert.deepEqual(planCycle(ship.plan), [mine(), sell()]);
  assert.equal(roomForRounds(state, ship), 1);
  assert.ok(repeatToFill(state, ship).ok);
  assert.equal(ship.queue.length, 3);
  assert.equal(state.stats.repeats, 1);
  assert.equal(repeatToFill(state, ship).ok, false, 'no room left');
});

test('run again repeats the last plan once the ship is idle', () => {
  const state = newGame();
  const ship = firstShip(state);
  assert.equal(runAgain(state, ship).ok, false, 'no plan yet');
  giveOrder(state, ship, mine('carbon-drift'));
  giveOrder(state, ship, sell());
  assert.equal(runAgain(state, ship).ok, false, 'still busy');
  advance(state, T0 + 30 * MINUTE);
  const result = runAgain(state, ship);
  assert.ok(result.ok);
  assert.equal(result.given, 2);
  assert.equal(ship.order.type, 'mine');
  assert.deepEqual(ship.plan, [mine('carbon-drift'), sell()]);
});

test('a sale given after the mining ends still joins the route, so it can be repeated', () => {
  const state = newGame();
  state.research.done.push('queue-1'); // 4 orders
  const ship = firstShip(state);
  giveOrder(state, ship, mine('carbon-drift'));
  advance(state, T0 + 10 * MINUTE); // the ship waits at the field with a full hold
  assert.equal(ship.order, null);
  giveOrder(state, ship, sell());
  assert.deepEqual(ship.plan, [mine('carbon-drift'), sell()]);
  assert.ok(canRepeat(state, ship), 'busy with the sale: one more round fits');
  advance(state, T0 + 20 * MINUTE);
  assert.equal(roomForRounds(state, ship), 2);
  assert.ok(canRepeat(state, ship));
  assert.ok(canRunAgain(state, ship));
  // With an empty hold, the next order starts a new route.
  giveOrder(state, ship, mine('kx14'));
  assert.deepEqual(ship.plan, [mine('kx14')]);
});

test('run again and repeat are only offered when the orders would work', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.plan = [sell()]; // nothing in the hold to sell
  assert.equal(canRunAgain(state, ship), false);
  assert.equal(canRepeat(state, ship), false);
  ship.plan = [mine('carbon-drift'), sell()];
  assert.ok(canRunAgain(state, ship));
  assert.equal(canRepeat(state, ship), false, 'with 2 slots an idle ship fits one round: that is Run again');
});

test('run all again restarts every idle ship with a plan', () => {
  const state = newGame();
  const a = firstShip(state);
  const b = createShip(state, 'mule', 'halcyon-refinery');
  createShip(state, 'mule', 'halcyon-refinery'); // never had orders
  for (const ship of [a, b]) {
    giveOrder(state, ship, mine('kx14'));
    giveOrder(state, ship, sell());
  }
  advance(state, T0 + 30 * MINUTE);
  const result = runAllAgain(state);
  assert.deepEqual(result, { ok: true, count: 2 });
  assert.ok(a.order && b.order);
});

test('copy orders gives a ship another ship\'s plan, if its hull can fly it', () => {
  const state = newGame();
  const a = firstShip(state);
  giveOrder(state, a, mine('rime'));
  giveOrder(state, a, sell());
  const b = createShip(state, 'mule', 'halcyon-shipyard');
  const result = copyOrders(state, b, a);
  assert.ok(result.ok);
  assert.equal(b.order.target, 'rime');
  assert.deepEqual(b.queue, [sell()]);
  assert.equal(state.stats.copies, 1);
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  assert.equal(copyOrders(state, kite, a).ok, false, 'haulers cannot mine');
});

test('a plan that would not work for the new ship cannot be copied', () => {
  const state = newGame();
  const a = firstShip(state);
  a.plan = [sell()];
  const b = createShip(state, 'mule', 'halcyon-shipyard');
  assert.equal(canCopy(state, a, b), false, 'b has nothing to sell');
  a.plan = [mine('rime'), sell()];
  assert.ok(canCopy(state, a, b));
});

test('a refit is paid up front, fits the newest modules at the shipyard, and keeps the plan', () => {
  const state = newGame({ credits: 1000 });
  const ship = firstShip(state);
  giveOrder(state, ship, mine());
  giveOrder(state, ship, sell());
  advance(state, T0 + 30 * MINUTE);
  assert.equal(orderRefit(state, ship).ok, false, 'nothing newer yet');

  state.research.done.push('hold-1');
  const before = state.credits;
  const result = orderRefit(state, ship);
  assert.ok(result.ok);
  assert.equal(state.credits, before - result.cost);
  advance(state, result.order.endsAt);
  assert.equal(ship.at, 'halcyon-shipyard');
  assert.equal(ship.modules.hold, 1);
  assert.equal(holdOf(ship), 25);
  assert.equal(state.stats.refits, 1);
  assert.equal(ship.plan.length, 2, 'Run again still has the route');
});

test('refit all books every ship that is behind, and clearing refunds a queued refit', () => {
  const state = newGame({ credits: 1000 });
  const a = firstShip(state);
  const b = createShip(state, 'mule', 'halcyon-refinery');
  state.research.done.push('hold-1');
  createShip(state, 'mule', 'halcyon-shipyard'); // already has the new racks
  giveOrder(state, b, mine());
  const result = refitAll(state);
  assert.equal(result.count, 2);
  assert.equal(a.order.type, 'refit');
  assert.equal(b.queue[0].type, 'refit');
  const credits = state.credits;
  clearQueue(state, b);
  assert.equal(state.credits, credits + result.cost / 2);
});

test('a mining ship fills its hold as it mines, and keeps it when cancelled', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, mine('carbon-drift'));
  giveOrder(state, ship, sell());
  const { start, end } = orderPhase(ship.order, ship.order.endsAt - 1);
  assert.equal(minedSoFar(ship.order, start - 1), 0, 'nothing while flying');
  const half = start + (end - start) / 2;
  assert.equal(minedSoFar(ship.order, half), 5);
  assert.deepEqual(cargoNow(ship, half), { 'carbon-ore': 5 });
  advance(state, half);
  const result = cancelOrder(state, ship, half);
  assert.deepEqual(result, { ok: true, flying: false, mined: 5 });
  assert.deepEqual(ship.cargo, { 'carbon-ore': 5 });
  assert.equal(ship.order.type, 'sell', 'the queued sale starts right away');
  advance(state, half + 10 * MINUTE);
  assert.equal(state.stats.oreSold, 5);
});

test('a ship cancelled in flight finishes the flight and waits there', () => {
  const state = newGame();
  const ship = firstShip(state);
  giveOrder(state, ship, mine('carbon-drift'));
  const result = cancelOrder(state, ship, T0 + 1000);
  assert.deepEqual(result, { ok: true, flying: true, mined: 0 });
  assert.equal(ship.order.type, 'fly');
  assert.match(orderPhase(ship.order, T0 + 1000).label, /^Flying to Carbon Drift$/);
  assert.match(cancelOrder(state, ship, T0 + 2000).error, /cannot stop in open space/);
  advance(state, T0 + 10 * MINUTE);
  assert.equal(ship.at, 'carbon-drift');
  assert.equal(ship.order, null);
  assert.deepEqual(ship.cargo, {});
  assert.equal(cancelOrder(state, ship).ok, false, 'nothing to cancel');
});

test('a cancelled refit is refunded', () => {
  const state = newGame({ credits: 1000 });
  state.research.done.push('hold-1');
  const ship = firstShip(state);
  assert.ok(orderRefit(state, ship).ok);
  assert.equal(state.credits, 940);
  assert.ok(cancelOrder(state, ship, T0 + 1000).ok);
  assert.equal(state.credits, 1000);
  advance(state, T0 + 10 * MINUTE);
  assert.equal(holdOf(ship), 10, 'no new modules');
});
