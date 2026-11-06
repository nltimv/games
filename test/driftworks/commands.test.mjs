import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderOptions } from '../../public/games/driftworks/systems/advisor.js';
import { carryOut } from '../../public/games/driftworks/systems/commands.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { newGame, firstShip } from './helpers.mjs';

const field = (id) => ({ kind: 'field', id });
const station = (id) => ({ kind: 'station', id });

test('a miner gets one option per trip length at a field', () => {
  const state = newGame();
  const options = orderOptions(state, firstShip(state), field('kx14'));
  assert.deepEqual(options.map((o) => [o.kind, o.minutes]), [['mine', 5], ['mine', 15], ['mine', 25], ['mine', 50]]);
  assert.ok(options.every((o) => o.amount > 0 && o.value > 0 && !o.disabled));
});

test('haulers cannot mine, and busy ships get no options', () => {
  const state = newGame();
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  assert.deepEqual(orderOptions(state, kite, field('kx14')), []);
  const mule = firstShip(state);
  carryOut(state, mule.id, orderOptions(state, mule, field('kx14'))[0]);
  assert.ok(mule.order);
  assert.deepEqual(orderOptions(state, mule, station('aurel-post')), []);
});

test('a docked miner with ore can sell it here, deliver it, or just fly', () => {
  const state = newGame();
  const mule = firstShip(state);
  mule.cargo['ferrite-ore'] = 40;
  const here = orderOptions(state, mule, station(mule.at));
  assert.deepEqual(here.map((o) => o.kind), ['sell']);
  assert.equal(here[0].qty, 40);

  const there = orderOptions(state, mule, station('aurel-post'));
  assert.deepEqual(there.map((o) => o.kind), ['deliver', 'fly']);
  assert.ok(there[0].total > 0 && there[0].travel > 0);

  // The foundry does not buy ore: only flying is offered.
  assert.deepEqual(orderOptions(state, mule, station('halcyon-foundry')).map((o) => o.kind), ['fly']);
});

test('a hauler is offered profitable trades, best first, and carrying one out buys and sends it', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const options = orderOptions(state, kite, station('halcyon-foundry'));
  const trades = options.filter((o) => o.kind === 'trade');
  assert.ok(trades.length >= 1 && trades.length <= 3);
  assert.ok(trades.every((t) => t.profit > 0 && t.qty > 0));
  for (let i = 1; i < trades.length; i += 1) assert.ok(trades[i - 1].profit >= trades[i].profit);
  assert.equal(options.at(-1).kind, 'fly');

  const before = state.credits;
  const result = carryOut(state, kite.id, trades[0]);
  assert.equal(result.ok, true);
  assert.equal(kite.cargo[trades[0].good], trades[0].qty);
  assert.equal(state.credits, before - trades[0].cost);
  assert.equal(kite.order.type, 'deliver');
  assert.equal(kite.order.target, 'halcyon-foundry');
});

test('carrying out mine, sell and fly options matches the panels', () => {
  const state = newGame();
  const mule = firstShip(state);
  mule.cargo['ferrite-ore'] = 30;
  const credits = state.credits;
  assert.equal(carryOut(state, mule.id, orderOptions(state, mule, station(mule.at))[0]).ok, true);
  assert.ok(state.credits > credits);
  assert.equal(mule.cargo['ferrite-ore'] ?? 0, 0);

  const fly = orderOptions(state, mule, station('aurel-post')).find((o) => o.kind === 'fly');
  assert.equal(carryOut(state, mule.id, fly).ok, true);
  assert.equal(mule.order.type, 'move');

  assert.equal(carryOut(state, 'nope', fly).ok, false);
  assert.equal(carryOut(state, mule.id, { kind: 'warp' }).ok, false);
});
