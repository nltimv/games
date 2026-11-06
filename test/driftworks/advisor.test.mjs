import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestTradeQty, buyersOf, deliveryOptions, maxPurchase, tradePlan, tripPreviews } from '../../public/games/driftworks/systems/advisor.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

test('buyers are sorted best price first', () => {
  const state = newGame();
  const buyers = buyersOf(state, 'ferrite-ore');
  assert.deepEqual(buyers.map((b) => b.station.id).sort(), ['aurel-post', 'halcyon-refinery']);
  assert.ok(buyers[0].view.price >= buyers[1].view.price);
});

test('trip previews cover every trip length with a value and return time', () => {
  const state = newGame();
  const trips = tripPreviews(state, firstShip(state), 'kx14');
  assert.deepEqual(trips.map((t) => t.minutes), [5, 15, 25, 50]);
  for (const t of trips) {
    assert.ok(t.amount > 0 && t.value > 0);
    assert.equal(t.endsAt, T0 + t.minutes * MINUTE);
  }
});

test('the refinery to foundry iron run pays, and the best amount beats a tiny one', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const max = maxPurchase(state, kite, 'iron');
  assert.equal(max, 160);
  const best = bestTradeQty(state, kite, 'iron', 'halcyon-foundry', max);
  assert.ok(best.qty > 0 && best.qty <= max);
  assert.ok(best.profit > tradePlan(state, kite, 'iron', 5, 'halcyon-foundry').profit);
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
