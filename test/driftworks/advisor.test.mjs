import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestTradeQty, buyersOf, deliveryOptions, maxPurchase, minePreview, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { newGame, firstShip, T0 } from './helpers.mjs';

test('buyers are sorted best price first', () => {
  const state = newGame();
  const buyers = buyersOf(state, 'ferrite-ore');
  assert.deepEqual(buyers.map((b) => b.station.id).sort(), ['aurel-post', 'halcyon-refinery']);
  assert.ok(buyers[0].view.price >= buyers[1].view.price);
});

test('a mine preview gives the amount, value and finish time, from the end of the queue', () => {
  const state = newGame();
  const ship = firstShip(state);
  const full = minePreview(state, ship, 'kx14');
  assert.equal(full.amount, 10);
  assert.equal(full.max, 10);
  assert.ok(full.value > 0);
  assert.equal(full.startsAt, T0);
  const part = minePreview(state, ship, 'kx14', 4);
  assert.equal(part.amount, 4);
  assert.ok(part.endsAt < full.endsAt && part.value < full.value);

  giveOrder(state, ship, { type: 'fly', stationId: 'aurel-post' });
  const later = minePreview(state, ship, 'kx14');
  assert.equal(later.queued, true);
  assert.equal(later.startsAt, ship.order.endsAt);
});

test('the refinery to foundry iron run pays, and the best amount beats a tiny one', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const max = maxPurchase(state, kite, 'iron');
  assert.equal(max, 40);
  const best = bestTradeQty(state, kite, 'iron', 'halcyon-foundry', max);
  assert.ok(best.qty > 0 && best.qty <= max);
  assert.ok(best.profit >= tradePlan(state, kite, 'iron', 5, 'halcyon-foundry').profit);
  assert.ok(best.profit > 0);
});

test('delivery options skip the station the ship is at', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo['ferrite-ore'] = 50;
  const options = deliveryOptions(state, ship, 'ferrite-ore');
  assert.deepEqual(options.map((o) => o.stationId), ['aurel-post']);
  assert.ok(options[0].travel > 0);
});
