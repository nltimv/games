import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { CONTRACT_RULES, acceptContract, contractBonus, refreshBoard } from '../../public/games/driftworks/systems/contracts.js';
import { quote } from '../../public/games/driftworks/systems/market.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const HOUR = 60 * MINUTE;

function withBoard() {
  const state = newGame();
  state.research.done.push('brokerage');
  refreshBoard(state, T0);
  return state;
}

test('the board opens with Brokerage and offers ore for three Mule holds', () => {
  const state = newGame();
  refreshBoard(state, T0);
  assert.equal(state.contracts.offers.length, 0);
  const open = withBoard();
  assert.equal(open.contracts.offers.length, CONTRACT_RULES.board);
  for (const offer of open.contracts.offers) {
    assert.equal(offer.qty, 30);
    assert.match(offer.good, /ore|rock|ice/);
  }
  const keys = open.contracts.offers.map((o) => `${o.stationId}:${o.good}`);
  assert.equal(new Set(keys).size, keys.length, 'no two offers for the same thing');
});

test('the board is the same for the same seed', () => {
  assert.deepEqual(withBoard().contracts.offers, withBoard().contracts.offers);
});

test('an accepted contract pays its premium on matching sales until it is filled', () => {
  const state = withBoard();
  const offer = state.contracts.offers[0];
  assert.ok(acceptContract(state, offer.id, T0).ok);
  assert.equal(state.stats.contractsAccepted, 1);
  assert.equal(state.contracts.offers.length, CONTRACT_RULES.board, 'the board refills');

  const ship = firstShip(state);
  ship.at = offer.stationId;
  ship.cargo[offer.good] = 20;
  const market = quote(state, offer.stationId, offer.good, 20, T0);
  assert.ok(Math.abs(contractBonus(state, offer.stationId, offer.good, 20, market.average, T0) - market.total * 0.5) < 1e-6);
  const sale = sellCargo(state, ship, offer.good, Infinity, T0);
  assert.ok(Math.abs(sale.bonus - market.total * 0.5) < 1e-6);
  assert.equal(state.contracts.active[0].delivered, 20);

  ship.cargo[offer.good] = 20; // 10 more fill it; the other 10 sell at market
  const second = sellCargo(state, ship, offer.good, Infinity, T0);
  assert.ok(second.bonus > 0 && second.bonus < second.total / 3);
  assert.equal(state.contracts.active.length, 0);
  assert.equal(state.stats.contracts, 1);
});

test('contracts run out quietly, and only two run at once', () => {
  const state = withBoard();
  const [a, b, c] = state.contracts.offers;
  assert.ok(acceptContract(state, a.id, T0).ok);
  assert.ok(acceptContract(state, b.id, T0).ok);
  assert.match(acceptContract(state, c.id, T0).error, /2 contracts/);
  const credits = state.credits;
  advance(state, T0 + CONTRACT_RULES.hours * HOUR);
  assert.equal(state.contracts.active.length, 0);
  assert.equal(state.credits, credits, 'no penalty');
});

test('with a hauler, some offers ask for refined goods', () => {
  const state = newGame();
  state.research.done.push('brokerage');
  const seen = new Set();
  const draw = () => {
    for (let i = 0; i < 10; i += 1) {
      state.contracts.offers = [];
      refreshBoard(state, T0);
      for (const offer of state.contracts.offers) seen.add(offer.good);
    }
  };
  draw();
  assert.ok(![...seen].some((good) => ['iron', 'silicon', 'graphite', 'water'].includes(good)), 'ore only without a hauler');
  createShip(state, 'kite', 'halcyon-shipyard');
  draw();
  assert.ok([...seen].some((good) => ['iron', 'silicon', 'graphite', 'water'].includes(good)));
});
