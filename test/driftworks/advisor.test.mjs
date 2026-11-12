import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestTradeQty, buyersOf, deliveryOptions, farTrade, feesBack, maxPurchase, minePreview, orderOptions, systemMarket, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { findEntry, marketView } from '../../public/games/driftworks/systems/market.js';
import { HOME_IMPORTS, findSystem, systemOf } from '../../public/games/driftworks/content/galaxy.js';
import { createGame } from '../../public/games/driftworks/core/state.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { carryOut } from '../../public/games/driftworks/systems/commands.js';
import { RESEARCH } from '../../public/games/driftworks/content/research.js';
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

test('market charts: a system shows the cheapest price its stations ask for a good, and the most they pay', () => {
  const state = newGame();
  const charts = RESEARCH.find((r) => r.id === 'market-charts');
  assert.deepEqual(charts.needs, ['warp-drive']);
  const price = (stationId, good) => marketView(state, stationId, good).price;
  assert.deepEqual(systemMarket(state, 'aurel', 'iron'), { sells: price('halcyon-refinery', 'iron'), buys: Math.max(price('halcyon-foundry', 'iron'), price('aurel-post', 'iron')) });
  assert.deepEqual(systemMarket(state, 'aurel', 'ice'), { sells: price('aurel-post', 'ice'), buys: price('halcyon-refinery', 'ice') });
  assert.deepEqual(systemMarket(state, 'aurel', 'crystal'), { sells: null, buys: null });
});

// Early act 2: the warp drive, and a Kite with the cargo racks a player has by then.
function act2(seed) {
  const state = createGame({ now: T0, seed });
  state.credits = 100_000;
  state.research.done.push('warp-drive', 'hold-1', 'hold-2', 'hold-3', 'hold-4');
  return { state, kite: createShip(state, 'kite', 'halcyon-refinery') };
}

test("the first trade into any of Aurel's neighbours pays after the jump fees there and back", () => {
  for (const seed of [1234, 20261106, 7, 1, 2, 3, 42, 777]) {
    for (const neighbour of Object.keys(HOME_IMPORTS)) {
      const { state, kite } = act2(seed);
      markSurveyed(state, neighbour, state.now);
      const trade = farTrade(state, kite);
      assert.equal(systemOf(trade?.destId), neighbour, `seed ${seed}: a trade into ${neighbour}`);
      assert.ok(trade.profit > 1000, `seed ${seed}, ${neighbour}: ${Math.round(trade.profit)} cr after fees both ways`);
      assert.ok(HOME_IMPORTS[neighbour].includes(trade.good));
    }
  }
});

test('order menus give what a trade into another system leaves after the jump fees there and back', () => {
  const { state, kite } = act2(1234);
  markSurveyed(state, 'dace', state.now);
  const host = findSystem('dace').stations.find((s) => s.imports);
  // The Buy order's note: the best sale in range, after the purchase and the fees both ways.
  const buy = orderOptions(state, kite, { kind: 'station', id: 'halcyon-refinery' }).find((o) => o.kind === 'buy' && o.good === 'iron');
  const net = (id) => tradePlan(state, kite, 'iron', buy.qty, id, state.now, 'halcyon-refinery').profit - feesBack(state, kite, id, 'halcyon-refinery');
  assert.equal(Math.round(buy.resale.profit), Math.round(Math.max(net(host.id), net('halcyon-foundry'))));
  assert.ok(feesBack(state, kite, host.id, 'halcyon-refinery') > 0);
  assert.equal(feesBack(state, kite, 'halcyon-foundry', 'halcyon-refinery'), 0);
  assert.ok(carryOut(state, kite.id, buy).ok);
  advance(state, kite.order.endsAt);
  // The Sell order there: the sale, less what the iron cost and the jumps both ways.
  const sell = orderOptions(state, kite, { kind: 'station', id: host.id }).find((o) => o.kind === 'sell');
  assert.ok(sell.fees > 0 && sell.back > 0);
  assert.equal(Math.round(sell.profit), Math.round(sell.total - kite.costBasis.iron - sell.fees - sell.back));
  assert.ok(sell.profit > 0);
  // Ice from Aurel's trading post fetches no more next door than it costs: the menu shows the loss.
  const ice = act2(1234);
  markSurveyed(ice.state, 'dace', ice.state.now);
  const refinery = findSystem('dace').stations.find((s) => findEntry(s.id, 'ice')?.side === 'buys');
  ice.kite.at = 'aurel-post';
  const iceBuy = orderOptions(ice.state, ice.kite, { kind: 'station', id: 'aurel-post' }).find((o) => o.kind === 'buy' && o.good === 'ice');
  assert.ok(carryOut(ice.state, ice.kite.id, iceBuy).ok);
  const iceSell = orderOptions(ice.state, ice.kite, { kind: 'station', id: refinery.id }).find((o) => o.kind === 'sell');
  assert.ok(iceSell.profit < 0, `ice to ${refinery.name}: ${Math.round(iceSell.profit)} cr`);
});
