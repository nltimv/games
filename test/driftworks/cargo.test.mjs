import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyCargo, canCarry, cargoTotal, freeHold, holdNote, sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { STARTING_CREDITS } from '../../public/games/driftworks/core/state.js';
import { holdOf, maxTierOf, refitTarget, speedOf } from '../../public/games/driftworks/systems/modules.js';
import { newGame, firstShip } from './helpers.mjs';

test('selling ore pays credits and counts toward stats', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo['ferrite-ore'] = 60;
  const result = sellCargo(state, ship, 'ferrite-ore');
  assert.ok(result.ok);
  assert.equal(result.qty, 60);
  assert.equal(state.credits, STARTING_CREDITS + result.total);
  assert.equal(state.stats.oreSold, 60);
  assert.equal(state.stats.earned, result.total);
  assert.equal(cargoTotal(ship), 0);
  assert.equal(state.log.at(-1).amount, result.total);
});

test('a station refuses goods it does not buy', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo.water = 10;
  const result = sellCargo(state, ship, 'water');
  assert.equal(result.ok, false);
  assert.equal(ship.cargo.water, 10);
});

test('a hauler buys within its hold and credits, and trade profit is tracked', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const bought = buyCargo(state, kite, 'iron', 10_000);
  assert.ok(bought.ok);
  assert.equal(bought.qty, holdOf(kite));
  assert.equal(freeHold(kite), 0);

  kite.at = 'halcyon-foundry';
  const sold = sellCargo(state, kite, 'iron');
  assert.ok(sold.ok);
  assert.ok(Math.abs(state.stats.tradeProfit - (sold.total - bought.total)) < 1e-6);
  assert.equal(state.stats.oreSold, 0, 'iron is not ore');
});

test('a partial sale keeps the matching share of the cost basis', () => {
  const state = newGame({ credits: 100_000 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const bought = buyCargo(state, kite, 'iron', 40);
  kite.at = 'halcyon-foundry';
  sellCargo(state, kite, 'iron', 16);
  assert.equal(kite.cargo.iron, 24);
  assert.ok(Math.abs(kite.costBasis.iron - bought.total * 0.6) < 1e-6);
});

test('buying is limited by credits', () => {
  const state = newGame({ credits: 160 });
  const kite = createShip(state, 'kite', 'halcyon-refinery');
  const bought = buyCargo(state, kite, 'iron', 1000);
  assert.ok(bought.ok);
  assert.ok(bought.total <= 160);
  assert.ok(state.credits >= 0);
});

test('miners cannot buy goods and holds have a tier limit', () => {
  const state = newGame({ credits: 100_000 });
  assert.equal(buyCargo(state, firstShip(state), 'iron', 10).ok, false);
  const kite = createShip(state, 'kite', 'halcyon-foundry');
  assert.equal(canCarry(kite, 'iron'), true);
  assert.equal(canCarry(kite, 'steel'), false);
  assert.equal(buyCargo(state, kite, 'steel', 10).ok, false);
});

test('a Kite stops at tier 3 goods and Cargo racks V; a Heron goes further, and faster', () => {
  const state = newGame({ credits: 1_000_000 });
  state.research.done.push('hold-1', 'hold-2', 'hold-3', 'hold-4', 'hold-5', 'hold-6', 'sealed-holds');
  const kite = createShip(state, 'kite', 'halcyon-foundry');
  const heron = createShip(state, 'heron', 'halcyon-foundry');
  assert.equal(kite.modules.hold, 5, 'a new Kite gets Cargo racks V, not VI');
  assert.equal(heron.modules.hold, 6);
  assert.equal(refitTarget(state, kite), null, 'nothing newer fits a Kite');
  assert.equal(maxTierOf(kite), 3);
  assert.equal(canCarry(kite, 'steel'), true);
  assert.equal(canCarry(kite, 'circuits'), false);
  assert.equal(holdNote('circuits', kite), 'Kites carry goods up to tier 3.');
  assert.equal(maxTierOf(heron), 4);
  assert.equal(canCarry(heron, 'circuits'), true);
  assert.equal(speedOf(heron) / speedOf(kite), 1.25);
  // A Kite refitted to Cargo racks VI before the cap keeps them.
  kite.modules.hold = 6;
  assert.equal(holdOf(kite), 4 * 1800);
  assert.equal(refitTarget(state, kite), null);
});
