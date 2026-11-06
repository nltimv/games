import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyCargo, canCarry, cargoTotal, freeHold, sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { buyShip, createShip, shipPrice } from '../../public/games/driftworks/systems/fleet.js';
import { SHIP_PRICES } from '../../public/games/driftworks/content/ships.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { newGame, firstShip } from './helpers.mjs';

test('selling ore pays credits and counts toward stats', () => {
  const state = newGame();
  const ship = firstShip(state);
  ship.cargo['ferrite-ore'] = 60;
  const result = sellCargo(state, ship, 'ferrite-ore');
  assert.ok(result.ok);
  assert.equal(result.qty, 60);
  assert.equal(state.credits, 250 + result.total);
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

test('ships are bought at a shipyard with enough credits', () => {
  const state = newGame({ credits: 100 });
  assert.equal(buyShip(state, 'mule', 'halcyon-shipyard').ok, false, 'too poor');
  assert.equal(buyShip(state, 'mule', 'halcyon-refinery').ok, false, 'not a shipyard');
  state.credits = 10_000;
  const price = shipPrice(state);
  const result = buyShip(state, 'mule', 'halcyon-shipyard');
  assert.ok(result.ok);
  assert.equal(result.ship.name, 'Mule-2');
  assert.equal(result.ship.at, 'halcyon-shipyard');
  assert.equal(state.credits, 10_000 - price);
});

test('each ship costs more than the last, whatever its hull', () => {
  const state = newGame({ credits: 1_000_000 });
  assert.equal(shipPrice(state), SHIP_PRICES[0]);
  createShip(state, 'mule', 'halcyon-shipyard');
  assert.equal(shipPrice(state), SHIP_PRICES[1]);
  while (state.ships.length <= SHIP_PRICES.length) createShip(state, 'mule', 'halcyon-shipyard');
  assert.equal(shipPrice(state), Math.round((SHIP_PRICES.at(-1) * 1.5) / 10000) * 10000);
});

test('Kites need the Hauler licence', () => {
  const state = newGame({ credits: 10_000 });
  assert.match(buyShip(state, 'kite', 'halcyon-shipyard').error, /Hauler licence/);
  state.research.done.push('kite-licence');
  assert.ok(buyShip(state, 'kite', 'halcyon-shipyard').ok);
});
