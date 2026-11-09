import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { allSystems, systemOf } from '../../public/games/driftworks/content/galaxy.js';
import {
  CONTRACT_RULES,
  acceptContract,
  contractMarks,
  deliverCargo,
  spawnChance,
  updateContracts,
} from '../../public/games/driftworks/systems/contracts.js';
import { marketView } from '../../public/games/driftworks/systems/market.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder, projectShip, roomForRounds } from '../../public/games/driftworks/systems/orders.js';
import { groupOrderOptions, orderOptions } from '../../public/games/driftworks/systems/advisor.js';
import { carryOut } from '../../public/games/driftworks/systems/commands.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const HOUR = 60 * MINUTE;
const AUREL_ORES = HOME_SYSTEM.fields.map((field) => field.good);

function withBrokerage() {
  const state = newGame();
  state.research.done.push('brokerage');
  updateContracts(state, T0);
  return state;
}

/** Accepts the first offer and puts a ship with `qty` of its good at its station. */
function running(qty) {
  const state = withBrokerage();
  const contract = acceptContract(state, state.contracts.offers[0].id, T0).contract;
  const ship = firstShip(state);
  ship.at = contract.stationId;
  ship.cargo = { [contract.good]: qty };
  return { state, contract, ship };
}

test('Brokerage brings a small first offer in Aurel at once, for ore mined there', () => {
  const state = newGame();
  updateContracts(state, T0);
  assert.equal(state.contracts.offers.length, 0, 'no offers before Brokerage');
  const open = withBrokerage();
  assert.equal(open.contracts.offers.length, 1);
  const [offer] = open.contracts.offers;
  assert.equal(systemOf(offer.stationId), HOME_SYSTEM.id);
  assert.ok(AUREL_ORES.includes(offer.good));
  assert.equal(offer.qty, 30, 'three holds of a 10 t Mule');
  assert.ok(offer.reward > offer.qty * 8, 'pays more than selling would');
  assert.ok(offer.hours >= 2.5);
});

test('offers turn up over time, a few per station for different goods, the same for the same seed', () => {
  const run = () => {
    const state = withBrokerage();
    advance(state, T0 + 3 * HOUR);
    return state;
  };
  const a = run();
  assert.ok(a.contracts.offers.length >= 2, `${a.contracts.offers.length} offers after 3 h`);
  for (const station of new Set(a.contracts.offers.map((offer) => offer.stationId))) {
    const here = a.contracts.offers.filter((offer) => offer.stationId === station);
    assert.ok(here.length <= CONTRACT_RULES.perStation);
    assert.equal(new Set(here.map((offer) => offer.good)).size, here.length);
  }
  assert.deepEqual(a.contracts.offers, run().contracts.offers);
  // A day away leaves only recent offers.
  advance(a, T0 + 27 * HOUR);
  assert.ok(a.contracts.offers.every((offer) => offer.expiresAt > a.now));
});

test('the chance of an offer per check falls as more systems are surveyed, down to a floor', () => {
  const state = newGame();
  assert.equal(spawnChance(state), CONTRACT_RULES.chance.start);
  state.surveyed = allSystems().slice(1, 5).map((system) => system.id);
  const five = spawnChance(state);
  assert.ok(five < 0.4 && five > CONTRACT_RULES.chance.min);
  state.surveyed = Array.from({ length: 80 }, (_, i) => `s${i}`);
  assert.equal(spawnChance(state), CONTRACT_RULES.chance.min);
});

test('amounts, prices and time limits vary, and amounts grow with the cargo racks', () => {
  const offers = (holdLevel) => {
    const state = withBrokerage();
    for (let i = 1; i <= holdLevel; i += 1) state.research.done.push(`hold-${i}`);
    createShip(state, 'kite', 'halcyon-shipyard');
    state.stats.contracts = 1; // past the first, small offer
    state.contracts.offers = [];
    const seen = [];
    for (let h = 1; h <= 40; h += 1) {
      advance(state, T0 + h * HOUR);
      seen.push(...state.contracts.offers);
      state.contracts.offers = [];
    }
    return seen;
  };
  const early = offers(0);
  const late = offers(4);
  assert.ok(new Set(early.map((o) => o.qty)).size > 3, 'amounts vary');
  assert.ok(new Set(early.map((o) => o.hours)).size > 2, 'time limits vary');
  assert.ok(new Set(early.map((o) => (o.reward / o.qty).toFixed(2))).size > 3, 'prices vary');
  assert.ok(early.some((o) => ['iron', 'silicon', 'graphite', 'water'].includes(o.good)), 'refined goods once a hauler can bring them');
  const mean = (list) => list.reduce((sum, o) => sum + o.qty, 0) / list.length;
  assert.ok(mean(late) > 8 * mean(early), `${mean(late)} vs ${mean(early)}`);
});

test('accepting starts the clock, and only a few contracts run at once', () => {
  const state = withBrokerage();
  advance(state, T0 + 3 * HOUR);
  state.contracts.offers.push(...[1, 2, 3].map((i) => ({ ...state.contracts.offers[0], id: 900 + i, stationId: 'halcyon-foundry' })));
  const offer = state.contracts.offers[0];
  const accepted = acceptContract(state, offer.id, state.now);
  assert.ok(accepted.ok);
  assert.equal(accepted.contract.deadline, state.now + offer.hours * HOUR);
  assert.equal(state.stats.contractsAccepted, 1);
  assert.ok(!state.contracts.offers.includes(offer));
  while (state.contracts.active.length < CONTRACT_RULES.maxActive) assert.ok(acceptContract(state, state.contracts.offers[0].id, state.now).ok);
  assert.match(acceptContract(state, state.contracts.offers[0].id, state.now).error, /contracts at once/);
});

test('deliveries leave the market alone and pay the fixed price only when complete', () => {
  const { state, contract, ship } = running(contract0Qty());
  const before = marketView(state, contract.stationId, contract.good, T0);
  const credits = state.credits;
  ship.cargo[contract.good] = contract.qty - 5;
  const part = deliverCargo(state, ship, contract.good, T0);
  assert.ok(part.ok && !part.completed);
  assert.equal(state.credits, credits, 'nothing paid yet');
  assert.equal(ship.cargo[contract.good], undefined);
  ship.cargo[contract.good] = 12;
  const rest = deliverCargo(state, ship, contract.good, T0);
  assert.ok(rest.completed);
  assert.equal(rest.qty, 5);
  assert.equal(ship.cargo[contract.good], 7, 'the rest stays aboard');
  assert.equal(state.credits, credits + contract.reward);
  assert.equal(state.stats.contracts, 1);
  assert.equal(state.stats.earned, contract.reward);
  assert.equal(state.contracts.active.length, 0);
  assert.deepEqual(marketView(state, contract.stationId, contract.good, T0), before, 'prices did not move');
});

function contract0Qty() {
  return withBrokerage().contracts.offers[0].qty;
}

test('a contract that runs out pays nothing, and what was delivered is gone', () => {
  const { state, contract, ship } = running(10);
  assert.ok(deliverCargo(state, ship, contract.good, T0).ok);
  const credits = state.credits;
  advance(state, contract.deadline);
  assert.equal(state.contracts.active.length, 0);
  assert.equal(state.credits, credits);
  assert.match(state.log.at(-1).text, /ran out/);
});

test('a Deliver order flies to the station and hands the cargo over on arrival', () => {
  const { state, contract, ship } = running(contract0Qty());
  ship.at = 'halcyon-shipyard';
  const given = giveOrder(state, ship, { type: 'deliver', stationId: contract.stationId, good: contract.good });
  assert.ok(given.ok, given.error);
  assert.equal(projectShip(state, ship).cargo[contract.good], undefined);
  const credits = state.credits;
  advance(state, given.order.endsAt);
  assert.equal(state.credits, credits + contract.reward);
  assert.equal(ship.at, contract.stationId);
});

test('Deliver orders stop once the contract has all it needs, and refuse to arrive late', () => {
  const { state, contract, ship } = running(0);
  ship.cargo = {};
  ship.at = 'halcyon-shipyard';
  const field = HOME_SYSTEM.fields.find((f) => f.good === contract.good);
  // Three holds (30 t) fill it: one round is given, two more are needed.
  assert.ok(giveOrder(state, ship, { type: 'mine', fieldId: field.id, amount: null }).ok);
  assert.ok(giveOrder(state, ship, { type: 'deliver', stationId: contract.stationId, good: contract.good }).ok);
  ship.plan = [
    { type: 'mine', fieldId: field.id, amount: null },
    { type: 'deliver', stationId: contract.stationId, good: contract.good },
  ];
  state.research.done.push('queue-1', 'queue-2');
  assert.equal(roomForRounds(state, ship), 2, 'only two more rounds are needed');
  const late = running(10);
  late.ship.at = 'halcyon-shipyard';
  late.contract.deadline = T0 + 5000;
  assert.match(giveOrder(late.state, late.ship, { type: 'deliver', stationId: late.contract.stationId, good: late.contract.good }).error, /runs out/);
});

test('a delivery that comes after its contract is filled sells at the station instead', () => {
  const { state, contract, ship } = running(0);
  ship.at = 'halcyon-shipyard';
  ship.cargo = { [contract.good]: 10 };
  state.research.done.push('queue-1');
  assert.ok(giveOrder(state, ship, { type: 'fly', stationId: 'aurel-post' }).ok);
  assert.ok(giveOrder(state, ship, { type: 'deliver', stationId: contract.stationId, good: contract.good }).ok);
  // Another ship fills the contract while this one is on its way.
  contract.delivered = contract.qty - 1;
  const other = createShip(state, 'mule', contract.stationId);
  other.cargo = { [contract.good]: 1 };
  assert.ok(deliverCargo(state, other, contract.good, T0).completed);
  advance(state, T0 + 3 * HOUR);
  assert.deepEqual(ship.cargo, {}, 'sold at the market');
  assert.equal(ship.at, contract.stationId);
  assert.ok(state.log.some((entry) => /sells its .* instead/.test(entry.text)));
});

test('the order menu offers Deliver apart from Sell, and ships share what is left', () => {
  const { state, contract, ship } = running(15);
  const options = orderOptions(state, ship, { kind: 'station', id: contract.stationId });
  const deliver = options.find((o) => o.kind === 'deliver');
  const sell = options.find((o) => o.kind === 'sell');
  assert.ok(deliver.now && deliver.qty === 15 && !deliver.completes);
  assert.ok(sell, 'selling is still an option');
  assert.equal(sell.contract, undefined);
  // A second ship with 15 t: together they bring only the 5 t still missing after the first.
  const other = createShip(state, 'mule', contract.stationId);
  other.cargo = { [contract.good]: 15 };
  const [group] = groupOrderOptions(state, [ship, other], { kind: 'station', id: contract.stationId }).filter((o) => o.kind === 'deliver');
  assert.equal(group.qty, contract.qty);
  assert.ok(group.completes);
  assert.deepEqual(group.members.map((m) => m.option.qty), [15, contract.qty - 15]);
  const credits = state.credits;
  assert.ok(carryOut(state, ship.id, deliver).ok);
  assert.equal(state.credits, credits);
});

test('a hauler buys what a contract needs, then delivers it: one order each', () => {
  const state = withBrokerage();
  state.credits = 50000;
  state.research.done.push('hold-1');
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  state.contracts.active.push({ id: 99, stationId: 'halcyon-foundry', good: 'iron', qty: 60, delivered: 0, basis: 0, reward: 2000, acceptedAt: T0, deadline: T0 + 4 * HOUR });
  // The refinery's iron is offered for the contract, sized to what it needs.
  const buy = orderOptions(state, kite, { kind: 'station', id: 'halcyon-refinery' }).find((o) => o.kind === 'buy' && o.good === 'iron');
  assert.equal(buy.contract.id, 99);
  assert.equal(buy.destId, 'halcyon-foundry');
  assert.equal(buy.qty, 60);
  assert.ok(buy.completes);
  const credits = state.credits;
  assert.ok(carryOut(state, kite.id, buy).ok);
  // The foundry then offers to deliver the iron the Kite will carry.
  const deliver = orderOptions(state, kite, { kind: 'station', id: 'halcyon-foundry' }).find((o) => o.kind === 'deliver');
  assert.equal(deliver.qty, 60);
  assert.ok(deliver.completes && !deliver.now);
  assert.ok(carryOut(state, kite.id, deliver).ok);
  advance(state, T0 + HOUR);
  assert.equal(state.stats.contracts, 1);
  assert.ok(Math.abs(state.credits - (credits - buy.cost + 2000)) < buy.cost * 0.02, 'paid for the iron, then the contract');
});

test('the maps mark stations and systems with offers and running contracts', () => {
  const state = withBrokerage();
  const [offer] = state.contracts.offers;
  let marks = contractMarks(state, T0);
  assert.deepEqual(marks.stations.get(offer.stationId), { offer: true, active: false });
  assert.deepEqual(marks.systems.get(HOME_SYSTEM.id), { offer: true, active: false });
  acceptContract(state, offer.id, T0);
  marks = contractMarks(state, T0);
  assert.deepEqual(marks.stations.get(offer.stationId), { offer: false, active: true });
});
