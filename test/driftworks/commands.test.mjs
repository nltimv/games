import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { groupOrderOptions, orderOptions, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { affordableQty } from '../../public/games/driftworks/systems/market.js';
import { carryOut, carryOutGroup } from '../../public/games/driftworks/systems/commands.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { newGame, firstShip } from './helpers.mjs';

const field = (id) => ({ kind: 'field', id });
const station = (id) => ({ kind: 'station', id });
const kinds = (options) => options.map((o) => o.kind);

test('a miner can mine a full hold at a field, or pick an amount', () => {
  const state = newGame();
  const options = orderOptions(state, firstShip(state), field('kx14'));
  assert.deepEqual(kinds(options), ['mine', 'mine-amount']);
  assert.equal(options[0].qty, 10);
  assert.ok(options[0].value > 0 && !options[0].disabled);
  assert.equal(options[1].max, 10);
});

test('haulers cannot mine', () => {
  const state = newGame();
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  assert.deepEqual(orderOptions(state, kite, field('kx14')), []);
});

test('a busy ship gets options that queue, worked out from where it will be', () => {
  const state = newGame();
  const mule = firstShip(state);
  carryOut(state, mule.id, orderOptions(state, mule, field('kx14'))[0]);
  // After mining, the hold is full: the field offers nothing it can do.
  const again = orderOptions(state, mule, field('rime'));
  assert.ok(again[0].disabled);
  assert.equal(again[0].note, 'Hold full');
  // The refinery would buy the ore it will carry.
  const sell = orderOptions(state, mule, station('halcyon-refinery'));
  assert.deepEqual(kinds(sell), ['sell', 'fly']);
  assert.equal(sell[0].queued, true);
  assert.equal(sell[0].now, false);
  assert.equal(carryOut(state, mule.id, sell[0]).queued, true);
  // Both slots are used now.
  const full = orderOptions(state, mule, station('aurel-post'));
  assert.ok(full.every((o) => o.disabled && o.note === 'Orders full'));
});

test('a docked, idle miner sells on the spot', () => {
  const state = newGame();
  const mule = firstShip(state);
  mule.cargo['ferrite-ore'] = 10;
  const credits = state.credits;
  const [option] = orderOptions(state, mule, station(mule.at));
  assert.equal(option.kind, 'sell');
  assert.equal(option.now, true);
  assert.ok(carryOut(state, mule.id, option).ok);
  assert.ok(state.credits > credits);
  assert.equal(mule.order, null);
});

test('a hauler elsewhere is offered one order per good the station sells, sized for the best buyer', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-foundry');
  const options = orderOptions(state, kite, station('halcyon-refinery'));
  const buys = options.filter((o) => o.kind === 'buy');
  assert.ok(buys.length >= 2);
  assert.deepEqual(kinds(options), [...buys.map(() => 'buy'), 'fly'], 'no two-order trades');
  // Buys with a buyer first, the best paying first.
  const rank = (o) => (o.destId ? 1 : 0);
  for (let i = 1; i < buys.length; i += 1) {
    assert.ok(rank(buys[i - 1]) >= rank(buys[i]));
    if (rank(buys[i - 1]) === rank(buys[i]) && buys[i].destId) assert.ok(buys[i - 1].profit >= buys[i].profit);
  }
  const [best] = buys;
  assert.ok(best.destId && best.profit > 0);

  // One order: it buys. Selling is the next pick, at the buyer.
  const result = carryOut(state, kite.id, best);
  assert.ok(result.ok && result.order);
  assert.equal(kite.order.type, 'buy');
  assert.equal(kite.queue.length, 0);
  const sell = orderOptions(state, kite, station(best.destId)).find((o) => o.kind === 'sell');
  assert.ok(sell.goods.includes(best.good));
  assert.ok(carryOut(state, kite.id, sell).ok);
  advance(state, state.now + 60 * 60_000);
  assert.equal(kite.at, best.destId);
  assert.deepEqual(kite.cargo, {});
  assert.ok(Math.abs(state.stats.tradeProfit - best.profit) < 1, 'the trade pays what the menu said');
});

test('a buy is sized to what still pays at the best buyer, not to the hold', () => {
  const state = newGame({ credits: 1_000_000 });
  const kite = createShip(state, 'heron', 'halcyon-foundry');
  // A big hold: all the silicon the refinery has would sink the foundry's price below what it cost.
  kite.modules.hold = 4;
  const all = affordableQty(state, 'halcyon-refinery', 'silicon', state.credits, holdOf(kite));
  assert.ok(tradePlan(state, kite, 'silicon', all, 'halcyon-foundry', state.now, 'halcyon-refinery').profit < 0);
  const buy = orderOptions(state, kite, station('halcyon-refinery')).find((o) => o.kind === 'buy' && o.good === 'silicon');
  assert.equal(buy.destId, 'halcyon-foundry');
  assert.ok(buy.qty > 0 && buy.qty < all && buy.profit > 0);
});

test('a hauler can buy at a station to sell later', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-foundry');
  const buys = orderOptions(state, kite, station('halcyon-refinery')).filter((o) => o.kind === 'buy');
  assert.ok(buys.length > 0);
  assert.ok(carryOut(state, kite.id, buys[0]).ok);
  assert.equal(kite.order.type, 'buy');
});

test('the shipyard offers a refit to a ship that is behind', () => {
  const state = newGame();
  const mule = firstShip(state);
  assert.ok(!kinds(orderOptions(state, mule, station('halcyon-shipyard'))).includes('refit'));
  state.research.done.push('hold-1');
  const refit = orderOptions(state, mule, station('halcyon-shipyard')).find((o) => o.kind === 'refit');
  assert.equal(refit.cost, 60);
  assert.ok(carryOut(state, mule.id, refit).ok);
  assert.equal(mule.order.type, 'refit');
});

test('fly, unknown ships and unknown options', () => {
  const state = newGame();
  const mule = firstShip(state);
  const fly = orderOptions(state, mule, station('aurel-post')).find((o) => o.kind === 'fly');
  assert.ok(carryOut(state, mule.id, fly).ok);
  assert.equal(mule.order.type, 'fly');
  assert.equal(carryOut(state, 'nope', fly).ok, false);
  assert.equal(carryOut(state, mule.id, { kind: 'warp' }).ok, false);
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: 'halcyon-foundry' }).queued);
});

test('several selected ships get the orders they can all take, each its own', () => {
  const state = newGame({ credits: 100_000 });
  const a = firstShip(state);
  const b = createShip(state, 'mule', 'halcyon-shipyard');
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  const ships = [a, b, kite];
  const atField = groupOrderOptions(state, ships, field('kx14'));
  assert.deepEqual(kinds(atField), ['mine']);
  assert.equal(atField[0].members.length, 2, 'the Kite cannot mine');
  assert.equal(atField[0].of, 3);
  const result = carryOutGroup(state, atField[0]);
  assert.deepEqual(result, { ok: true, count: 2, error: null });
  assert.ok(a.order && b.order && !kite.order);

  // The refinery buys the ore both Mules will carry and sells goods the
  // Kite can buy; all three can fly there.
  const atRefinery = groupOrderOptions(state, ships, station('halcyon-refinery'));
  assert.equal(atRefinery[0].kind, 'sell');
  assert.equal(atRefinery[0].members.length, 2);
  assert.ok(atRefinery[0].total > 0);
  assert.ok(atRefinery.some((o) => o.kind === 'buy' && o.members.length === 1));
  assert.equal(atRefinery.at(-1).kind, 'fly');
  assert.equal(atRefinery.at(-1).members.length, 3);
  assert.equal(carryOutGroup(state, { members: [] }).ok, false);
});

test('several haulers buy a good together, sharing the credits and the stock', () => {
  const state = newGame({ credits: 100_000 });
  const kites = [1, 2, 3].map(() => createShip(state, 'kite', 'halcyon-foundry'));
  const mule = firstShip(state);
  const options = groupOrderOptions(state, [...kites, mule], station('halcyon-refinery'));
  const buys = options.filter((o) => o.kind === 'buy');
  assert.ok(buys.length >= 2);
  const buy = buys.find((o) => !o.destId) ?? buys.at(-1);
  assert.equal(buy.members.length, 3, 'the Mule cannot buy');
  assert.equal(buy.of, 4);
  const own = orderOptions(state, kites[0], station('halcyon-refinery')).find((o) => o.kind === 'buy' && o.good === buy.good);
  assert.ok(buy.qty <= own.qty * 3);
  assert.equal(buy.members.reduce((sum, m) => sum + m.option.qty, 0), buy.qty);

  const result = carryOutGroup(state, buy);
  assert.deepEqual(result, { ok: true, count: buy.members.length, error: null });
  advance(state, state.now + 60 * 60_000);
  for (const { shipId, option } of buy.members) assert.equal(state.ships.find((s) => s.id === shipId).cargo[buy.good], option.qty);
});

test('a group buy never asks for more than the credits pay for', () => {
  const state = newGame({ credits: 100_000 });
  const kites = [1, 2, 3].map(() => createShip(state, 'kite', 'halcyon-foundry'));
  const target = station('halcyon-refinery');
  const good = orderOptions(state, kites[0], target).find((o) => o.kind === 'buy').good;
  const own = orderOptions(state, kites[0], target).find((o) => o.good === good);
  // Enough for one and a half holds.
  state.credits = Math.ceil(own.cost * 1.5);
  const buy = groupOrderOptions(state, kites, target).find((o) => o.kind === 'buy' && o.good === good);
  assert.equal(buy.members.length, 2);
  assert.ok(buy.cost <= state.credits);
  assert.equal(buy.members[0].option.qty, own.qty);
  assert.ok(buy.members[1].option.qty < own.qty);
  assert.equal(buy.members.reduce((sum, m) => sum + m.option.qty, 0), buy.qty);
});

test('haulers buying together for one buyer stop at what still pays there', () => {
  const state = newGame({ credits: 100_000 });
  const kites = [1, 2].map(() => createShip(state, 'kite', 'halcyon-foundry'));
  const buy = groupOrderOptions(state, kites, station('halcyon-refinery')).find((o) => o.kind === 'buy' && o.destId);
  assert.ok(buy, 'a buy with a buyer');
  assert.equal(buy.destId, 'halcyon-foundry');
  assert.ok(buy.profit > 0);
  assert.equal(buy.members.reduce((sum, m) => sum + m.option.qty, 0), buy.qty);
  assert.equal(carryOutGroup(state, buy).count, buy.members.length);
  for (const { shipId } of buy.members) {
    const kite = state.ships.find((s) => s.id === shipId);
    assert.equal(kite.order.type, 'buy');
    assert.equal(kite.queue.length, 0);
  }
});
