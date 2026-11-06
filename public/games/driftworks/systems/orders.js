// Ship orders. Every order takes real time and cannot be hurried: it stores
// absolute times for its steps, and core/sim.js runs each step when its time
// comes, even if the tab was closed in between.
//
// An order has:
//   type, label, target         what it is, for the UI
//   startedAt, endsAt           wall-clock times (ms)
//   steps: [{ at, kind, ... }]  effects applied at their time, in order
//   legs:  [{ from, to, start, end }]  where to draw the ship
//
// Orders are created from a spec ({ type, ...params }) so a queued order can
// be started later with fresh travel times and prices.

import { GOODS, goodName } from '../content/goods.js';
import { HULLS, TRIP_LENGTHS } from '../content/ships.js';
import { findField, findStation } from '../content/homeSystem.js';
import { formatNumber } from '../../../shared/js/format.js';
import { MINUTE } from '../core/time.js';
import { findEntry } from './market.js';
import { freeHold } from './cargo.js';
import { travelTime } from './travel.js';
import { addLog } from './log.js';

const fail = (error) => ({ ok: false, error });

/** "Flying to Halcyon Foundry" -> "flying to Halcyon Foundry". */
export function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** How much a mining trip brings back, before it starts. */
export function miningYield(ship, fieldId, minutes) {
  const hull = HULLS[ship.hull];
  const field = findField(fieldId);
  const trip = TRIP_LENGTHS.find((t) => t.minutes === minutes);
  if (!field || !trip) return 0;
  const raw = hull.miningRate * minutes * field.richness * (1 + trip.bonus);
  return Math.floor(Math.min(freeHold(ship), raw));
}

function validateIdle(ship) {
  if (!ship) return fail('No such ship.');
  if (ship.order) return fail(`${ship.name} is busy until its current order ends.`);
  if (!ship.at) return fail(`${ship.name} is not docked.`);
  return null;
}

function buildMine(state, ship, { fieldId, minutes }) {
  const hull = HULLS[ship.hull];
  if (hull.role !== 'miner') return fail(`${ship.name} is not a mining ship.`);
  const field = findField(fieldId);
  if (!field) return fail('No such asteroid field.');
  if (!TRIP_LENGTHS.some((t) => t.minutes === minutes)) return fail('Pick a trip length.');
  const amount = miningYield(ship, fieldId, minutes);
  if (amount <= 0) return fail(`${ship.name}'s hold is full. Sell the cargo first.`);

  const start = state.now;
  const end = start + minutes * MINUTE;
  const travel = Math.min(travelTime(ship.hull, ship.at, fieldId), minutes * MINUTE * 0.3);
  const home = ship.at;
  return {
    ok: true,
    order: {
      type: 'mine',
      label: `Mining ${field.name}`,
      target: fieldId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'mined', good: field.good, amount, station: home, field: fieldId }],
      legs: [
        { from: home, to: fieldId, start, end: start + travel },
        { from: fieldId, to: fieldId, start: start + travel, end: end - travel },
        { from: fieldId, to: home, start: end - travel, end },
      ],
    },
  };
}

function buildMove(state, ship, { stationId, sell }) {
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  if (stationId === ship.at) return fail(`${ship.name} is already there.`);
  if (sell) {
    const entry = findEntry(stationId, sell);
    if (!entry || entry.side !== 'buys') return fail(`${station.name} does not buy ${goodName(sell).toLowerCase()}.`);
    if (!(ship.cargo[sell] > 0)) return fail(`${ship.name} has no ${goodName(sell).toLowerCase()} aboard.`);
  }
  const start = state.now;
  const end = start + travelTime(ship.hull, ship.at, stationId);
  const steps = [{ at: end, kind: 'arrive', station: stationId }];
  if (sell) steps.push({ at: end, kind: 'sell', station: stationId, good: sell });
  return {
    ok: true,
    order: {
      type: sell ? 'deliver' : 'move',
      label: sell ? `Delivering ${goodName(sell).toLowerCase()} to ${station.name}` : `Flying to ${station.name}`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps,
      legs: [{ from: ship.at, to: stationId, start, end }],
    },
  };
}

const BUILDERS = { mine: buildMine, move: buildMove };

/** Checks an order spec without starting it. */
export function previewOrder(state, ship, spec) {
  const invalid = validateIdle(ship);
  if (invalid) return invalid;
  const build = BUILDERS[spec.type];
  if (!build) return fail('Unknown order.');
  return build(state, ship, spec);
}

/** Starts an order now. Returns { ok, order } or { ok: false, error }. */
export function giveOrder(state, ship, spec) {
  const result = previewOrder(state, ship, spec);
  if (!result.ok) return result;
  const order = { ...result.order, spec, stepIndex: 0 };
  const from = ship.at;
  ship.order = order;
  ship.at = null;
  if (order.type === 'mine') {
    state.stats.miningTrips += 1;
    const step = order.steps[0];
    addLog(
      state,
      state.now,
      `${ship.name} left ${findStation(from).name} to mine ${findField(order.target).name} (about ${formatNumber(step.amount)} t ${goodName(step.good).toLowerCase()})`,
      'order',
    );
  } else {
    addLog(state, state.now, `${ship.name}: ${lowerFirst(order.label)}`, 'order');
  }
  return { ok: true, order };
}

/** A short line for a ship's current state, for lists. */
export function shipStatus(ship) {
  if (ship.order) return ship.order.label;
  const station = findStation(ship.at);
  const aboard = Object.entries(ship.cargo)
    .filter(([, qty]) => qty > 0)
    .map(([good, qty]) => `${formatNumber(qty)} t ${GOODS[good].name.toLowerCase()}`);
  const where = station ? `Docked at ${station.name}` : 'In space';
  return aboard.length ? `${where} with ${aboard.join(', ')}` : where;
}
