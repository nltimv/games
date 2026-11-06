import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_TAU,
  affordableQty,
  buyFromStation,
  marketView,
  quote,
  sellToStation,
  stockAt,
} from '../../public/games/driftworks/systems/market.js';
import { newGame, T0 } from './helpers.mjs';

const REFINERY = 'halcyon-refinery';

test('a fresh market sits at its seeded target', () => {
  const state = newGame();
  const view = marketView(state, REFINERY, 'ferrite-ore');
  assert.equal(view.side, 'buys');
  assert.ok(view.fill > 0.15 && view.fill < 0.45, `fill ${view.fill}`);
  assert.ok(Math.abs(view.pressure) < 1e-9);
});

test('selling lowers the price and buying raises it', () => {
  const state = newGame();
  const before = marketView(state, REFINERY, 'ferrite-ore').price;
  sellToStation(state, REFINERY, 'ferrite-ore', 200);
  assert.ok(marketView(state, REFINERY, 'ferrite-ore').price < before);

  const ironBefore = marketView(state, REFINERY, 'iron').price;
  buyFromStation(state, REFINERY, 'iron', 100);
  assert.ok(marketView(state, REFINERY, 'iron').price > ironBefore);
});

test('a big trade averages worse than a small one', () => {
  const state = newGame();
  const small = quote(state, REFINERY, 'ferrite-ore', 10);
  const big = quote(state, REFINERY, 'ferrite-ore', 300);
  assert.ok(big.average < small.average);
});

test('stock drifts back toward the target over hours', () => {
  const state = newGame();
  const target = stockAt(state, REFINERY, 'ferrite-ore');
  sellToStation(state, REFINERY, 'ferrite-ore', 300, T0);
  const right = stockAt(state, REFINERY, 'ferrite-ore', T0);
  const later = stockAt(state, REFINERY, 'ferrite-ore', T0 + 3 * RECOVERY_TAU);
  assert.ok(right > target + 290);
  // After three time constants about 95% of the gap is gone.
  assert.ok(later - target < (right - target) * 0.06);
});

test('a station cannot take more than its storage holds', () => {
  const state = newGame();
  const { room } = marketView(state, REFINERY, 'ferrite-ore');
  const sale = sellToStation(state, REFINERY, 'ferrite-ore', 100_000);
  assert.equal(sale.qty, Math.floor(room));
  assert.equal(quote(state, REFINERY, 'ferrite-ore', 10).qty, 0);
});

test('affordableQty never overspends', () => {
  const state = newGame();
  const qty = affordableQty(state, REFINERY, 'iron', 500, 1000);
  assert.ok(qty > 0);
  assert.ok(quote(state, REFINERY, 'iron', qty).total <= 500);
  assert.ok(quote(state, REFINERY, 'iron', qty + 1).total > 500);
});

test('stations only trade their own goods', () => {
  const state = newGame();
  assert.equal(marketView(state, REFINERY, 'steel'), null);
  assert.equal(sellToStation(state, REFINERY, 'iron', 10).qty, 0, 'the refinery sells iron, it does not buy it');
});
