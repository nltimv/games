// Ship orders and the order queue. Every order takes real time and cannot be
// hurried: it stores absolute times, and core/sim.js applies its step when
// the time comes, even if the tab was closed in between.
//
// An order is built from a spec:
//   { type: 'mine', fieldId, amount }   fly to a field and mine `amount` t
//                                       (null: whatever the hold has room for)
//   { type: 'sell', stationId, good }   fly to a station and sell everything
//                                       it buys (or only `good`)
//   { type: 'buy', stationId, good, qty }  haulers: fly there and buy
//   { type: 'deliver', stationId, good }   fly to a station and hand `good`
//                                       to the contract running there
//   { type: 'fly', stationId }
//   { type: 'refit', modules, paid, stationId }  fly to a shipyard and fit
//                                       modules (see orderRefit; paid up front)
//   { type: 'survey', systemId }        scouts: fly to an unsurveyed system
//                                       and survey it
//   { type: 'investigate' | 'salvage', signalId }  see systems/signalOrders.js
//
// Targets in another system are reached through the gates (see
// travel.plotCourse). Each jump's fee is paid as the ship enters the
// warp (see payJump); an order only starts while the company can pay all
// of them.
//
// A built order has:
//   type, label, target         what it is, for the UI
//   flightLabel                 what it says while flying there
//   startedAt, endsAt           wall-clock times (ms)
//   steps: [{ at, kind, ... }]  effects applied at their time, in order
//   legs:  [{ from, to, start, end, jump?, fee? }]  where to draw the ship
//   fees, jumps                 jump fees (cr) and how many jumps
//   jumpsPaid                   how many of its jumps have been paid (an
//                               order saved without it paid them all)
//
// A ship holds a few orders at once (orderSlots, raised by research): the
// current one plus a queue. Each queued order starts as soon as the one
// before it ends. A ship that runs out of orders waits where it is.

import { goodName } from '../content/goods.js';
import { HULLS, REFIT_MINUTES } from '../content/ships.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { findField, findPlace, findStation, findSystem, systemOf } from '../content/galaxy.js';
import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { MINUTE, SECOND } from '../core/time.js';
import { findEntry } from './market.js';
import { canCarry, cargoTotal, holdNote } from './cargo.js';
import { contractFor, stillNeeded } from './contracts.js';
import { holdOf, laserOf, refitCost, refitTarget } from './modules.js';
import { isResearched, orderSlots } from './research.js';
import { plotCourse, travelTime } from './travel.js';
import { flight, route, stationLegs } from './courses.js';
import { buildInvestigate, buildSalvage } from './signalOrders.js';
import { isFieldOpen } from './signals.js';
import { isSurveyed, knownStations, surveyable, surveyorOf } from './explore.js';
import { hazardNote } from './shielding.js';
import { addLog } from './log.js';

const fail = (error) => ({ ok: false, error });

/** The plan a ship remembers is never longer than the biggest queue. */
const MAX_PLAN = 16;

export const SHIPYARD_ID = HOME_SYSTEM.stations.find((s) => s.type === 'shipyard').id;

/** "Flying to Halcyon Foundry" -> "flying to Halcyon Foundry". */
export function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const lower = (good) => goodName(good).toLowerCase();

function freeIn(view) {
  return Math.max(0, holdOf(view) - cargoTotal(view));
}

/** Goods aboard that a station buys (only `good`, if given). */
function sellable(view, stationId, good) {
  return Object.keys(view.cargo).filter((g) => view.cargo[g] > 0 && (!good || g === good) && findEntry(stationId, g)?.side === 'buys');
}

// ---------- Builders ----------
// Each builds an order for `view` (a ship, or a projection of one; see
// projectShip) starting at `start`, or explains why it cannot.

function buildMine(state, view, { fieldId, amount }, start) {
  if (HULLS[view.hull].role !== 'miner') return fail(`${view.name} is not a mining ship.`);
  const field = findField(fieldId);
  if (!field || !isFieldOpen(state, field)) return fail('No such asteroid field.');
  const free = freeIn(view);
  const qty = Math.floor(Math.min(free, amount ?? free));
  if (free < 1) return fail(`${view.name}'s hold is full.`);
  if (!(qty >= 1)) return fail('Pick an amount to mine.');
  const course = flight(state, view, fieldId, start);
  if (!course.ok) return course;
  const { travel, legs } = course;
  const mining = Math.round(((qty / (laserOf(view) * field.richness)) * MINUTE) / SECOND) * SECOND;
  const end = start + travel + mining;
  legs.push({ from: fieldId, to: fieldId, start: start + travel, end });
  return {
    ok: true,
    order: {
      type: 'mine',
      label: `Mining ${field.name}`,
      flightLabel: `Flying to ${field.name} to mine`,
      target: fieldId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'mined', good: field.good, amount: qty, field: fieldId }],
      legs,
      ...route(course),
    },
  };
}

function buildSell(state, view, { stationId, good }, start) {
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  const goods = sellable(view, stationId, good);
  if (!goods.length) {
    if (good) return fail(`${station.name} does not buy ${lower(good)}, or ${view.name} has none.`);
    return fail(`${view.name} carries nothing ${station.name} buys.`);
  }
  const course = stationLegs(state, view, stationId, start);
  if (!course.ok) return course;
  const { end, legs } = course;
  const what = goods.length === 1 ? lower(goods[0]) : 'cargo';
  return {
    ok: true,
    order: {
      type: 'sell',
      label: `Selling ${what} at ${station.name}`,
      flightLabel: `Flying to ${station.name} to sell ${what}`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'sell', station: stationId, ...(good ? { good } : {}) }],
      legs,
      ...route(course),
    },
  };
}

function buildBuy(state, view, { stationId, good, qty }, start) {
  if (HULLS[view.hull].role !== 'hauler') return fail('Only haulers can buy goods.');
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  if (findEntry(stationId, good)?.side !== 'sells') return fail(`${station.name} does not sell ${lower(good)}.`);
  if (!canCarry(view, good)) return fail(holdNote(good));
  const amount = Math.floor(Math.min(qty, freeIn(view)));
  if (amount < 1) return fail(`${view.name}'s hold is full.`);
  const course = stationLegs(state, view, stationId, start);
  if (!course.ok) return course;
  const { end, legs } = course;
  return {
    ok: true,
    order: {
      type: 'buy',
      label: `Buying ${lower(good)} at ${station.name}`,
      flightLabel: `Flying to ${station.name} to buy ${lower(good)}`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'buy', station: stationId, good, qty: amount }],
      legs,
      ...route(course),
    },
  };
}

function buildDeliver(state, view, { stationId, good }, start) {
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  const contract = contractFor(state, stationId, good, start);
  if (!contract) return fail(`${station.name} has no contract for ${lower(good)} running.`);
  const carried = Math.floor(view.cargo[good] ?? 0);
  if (carried < 1) return fail(`${view.name} has no ${lower(good)} aboard.`);
  // Deliveries this ship already has lined up for the same contract.
  const needed = stillNeeded(contract) - (view.delivered?.[contract.id] ?? 0);
  if (needed < 1) return fail(`${view.name}'s orders already deliver all the contract needs.`);
  const course = stationLegs(state, view, stationId, start);
  if (!course.ok) return course;
  const { end, legs } = course;
  if (end > contract.deadline) return fail(`The contract runs out before ${view.name} gets there.`);
  return {
    ok: true,
    order: {
      type: 'deliver',
      label: `Delivering ${lower(good)} to ${station.name}`,
      flightLabel: `Flying to ${station.name} to deliver ${lower(good)}`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'deliver', station: stationId, good, qty: Math.min(carried, needed), contract: contract.id }],
      legs,
      ...route(course),
    },
  };
}

function buildFly(state, view, { stationId }, start) {
  // Any place will do: a station, a field or a gate.
  const station = findPlace(stationId);
  if (!station) return fail('No such place.');
  if (stationId === view.at) return fail(`${view.name} is already there.`);
  const course = stationLegs(state, view, stationId, start);
  if (!course.ok) return course;
  const { end, legs } = course;
  return {
    ok: true,
    order: {
      type: 'fly',
      label: `Flying to ${station.name}`,
      flightLabel: `Flying to ${station.name}`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'arrive', station: stationId }],
      legs,
      ...route(course),
    },
  };
}

function buildRefit(state, view, { modules, stationId = SHIPYARD_ID }, start) {
  if (!modules) return fail('Nothing to fit.');
  const station = findStation(stationId);
  if (station?.type !== 'shipyard') return fail('Refits are done at shipyards.');
  const course = stationLegs(state, view, stationId, start, REFIT_MINUTES * MINUTE);
  if (!course.ok) return course;
  const { end, legs } = course;
  return {
    ok: true,
    order: {
      type: 'refit',
      label: `Refitting at ${station.name}`,
      flightLabel: `Flying to ${station.name} for a refit`,
      target: stationId,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'refit', station: stationId, modules }],
      legs,
      ...route(course),
    },
  };
}

/** How long a survey takes once the scout is there. */
export function surveyTime(state) {
  return (isResearched(state, 'scanners') ? 5 : 10) * MINUTE;
}

function buildSurvey(state, view, { systemId }, start) {
  if (HULLS[view.hull].role !== 'scout') return fail('Only scouts can survey.');
  const system = findSystem(systemId);
  if (!system) return fail('No such system.');
  if (isSurveyed(state, systemId)) return fail(`${system.name} is already surveyed.`);
  if (!surveyable(state, systemId)) return fail(hazardNote(state, system) ?? `${system.name} is too far out to survey yet.`);
  const surveyor = surveyorOf(state, systemId);
  if (surveyor) return fail(`${surveyor.name} is already on its way to survey ${system.name}.`);
  // The scout surveys from the gate it arrives at.
  const course = flight(state, view, entryGate(state, view, systemId), start, { surveyTarget: systemId });
  if (!course.ok) return course;
  const { travel, legs } = course;
  const arrival = legs.at(-1)?.to ?? view.at;
  const end = start + travel + surveyTime(state);
  legs.push({ from: arrival, to: arrival, start: start + travel, end });
  return {
    ok: true,
    order: {
      type: 'survey',
      label: `Surveying ${system.name}`,
      flightLabel: `Flying to ${system.name} to survey it`,
      target: arrival,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'survey', system: systemId, station: arrival }],
      legs,
      ...route(course),
    },
  };
}

/** The gate a scout comes in by: the one from the surveyed neighbour on the quickest way. */
function entryGate(state, view, systemId) {
  const system = findSystem(systemId);
  const here = systemOf(view.at);
  const gates = system.gates.filter((gate) => gate.to === here || isSurveyed(state, gate.to));
  let best = null;
  for (const gate of gates) {
    const course = plotCourse(state, view, view.at, gate.id, { surveyTarget: systemId });
    if (course.ok && (!best || course.time < best.time)) best = { id: gate.id, time: course.time };
  }
  return best?.id ?? gates[0]?.id ?? null;
}

const BUILDERS = {
  mine: buildMine,
  sell: buildSell,
  buy: buildBuy,
  deliver: buildDeliver,
  fly: buildFly,
  refit: buildRefit,
  survey: buildSurvey,
  investigate: buildInvestigate,
  salvage: buildSalvage,
};

export function buildOrder(state, view, spec, start = state.now) {
  const build = BUILDERS[spec?.type];
  if (!build) return fail('Unknown order.');
  if (!view.at) return fail(`${view.name} is not docked.`);
  return build(state, view, spec, start);
}

// ---------- Projection ----------

/**
 * Applies an order's remaining steps to a projection. The sim applies the
 * same steps for real (core/sim.js); this is the estimate.
 */
function applySteps(view, order, from = 0) {
  for (const step of order.steps.slice(from)) {
    if (step.kind === 'mined') {
      view.cargo[step.good] = (view.cargo[step.good] ?? 0) + Math.min(step.amount, freeIn(view));
      view.at = step.field;
    } else if (step.kind === 'sell') {
      for (const good of sellable(view, step.station, step.good)) delete view.cargo[good];
      view.at = step.station;
    } else if (step.kind === 'buy') {
      view.cargo[step.good] = (view.cargo[step.good] ?? 0) + Math.min(step.qty, freeIn(view));
      view.at = step.station;
    } else if (step.kind === 'deliver') {
      const qty = Math.min(step.qty, view.cargo[step.good] ?? 0);
      view.cargo[step.good] = (view.cargo[step.good] ?? 0) - qty;
      if (view.cargo[step.good] <= 0) delete view.cargo[step.good];
      view.delivered = { ...view.delivered, [step.contract]: (view.delivered?.[step.contract] ?? 0) + qty };
      view.at = step.station;
    } else if (step.kind === 'refit') {
      view.modules = { ...view.modules, ...step.modules };
      view.at = step.station;
    } else if (step.kind === 'salvage') {
      view.cargo[step.good] = (view.cargo[step.good] ?? 0) + Math.min(step.qty, freeIn(view));
      view.at = step.station;
    } else if (step.kind === 'arrive' || step.kind === 'survey' || step.kind === 'investigate') {
      view.at = step.station;
    }
  }
  view.time = Math.max(view.time, order.endsAt);
}

/**
 * Where a ship will be, what it will carry and when, once its current and
 * queued orders are done. Sales and purchases are estimates.
 */
export function projectShip(state, ship, built = null) {
  const view = {
    id: ship.id,
    name: ship.name,
    hull: ship.hull,
    at: ship.at,
    cargo: { ...ship.cargo },
    modules: { ...ship.modules },
    // Tonnes its orders will deliver to each contract: { [contractId]: t }.
    delivered: {},
    time: state.now,
  };
  if (ship.order) {
    applySteps(view, ship.order, ship.order.stepIndex);
    view.at = ship.order.target;
  }
  for (const spec of ship.queue) {
    const next = buildOrder(state, view, spec, view.time);
    if (!next.ok) continue;
    built?.push(next.order);
    applySteps(view, next.order);
  }
  return view;
}

/**
 * The jumps still ahead of a ship, through its current order and then its
 * queued ones: [{ from, to, start, end, queued }] with system ids, in order.
 * Queued jumps are estimates, like projectShip.
 */
export function shipRoute(state, ship, now = state.now) {
  const hops = [];
  const add = (order, queued) => {
    for (const leg of order.legs ?? []) {
      if (leg.jump && leg.end > now) hops.push({ from: systemOf(leg.from), to: systemOf(leg.to), start: leg.start, end: leg.end, queued });
    }
  };
  if (ship.order) add(ship.order, false);
  if (ship.queue.length) {
    const queued = [];
    projectShip(state, ship, queued);
    for (const order of queued) add(order, true);
  }
  return hops;
}

// ---------- Giving orders ----------

export function freeSlots(state, ship) {
  return Math.max(0, orderSlots(state) - (ship.order ? 1 : 0) - ship.queue.length);
}

/** Starts a spec now on an idle ship. Its jump fees are paid at the gates. */
function startOrder(state, ship, spec) {
  const result = buildOrder(state, ship, spec, state.now);
  if (!result.ok) return result;
  const fees = result.order.fees ?? 0;
  if (fees > state.credits) return fail(`The jump fees are ${formatCredits(fees)}. You need ${formatCredits(fees - state.credits)} more.`);
  ship.order = { ...result.order, spec, stepIndex: 0, jumpsPaid: 0 };
  ship.at = null;
  if (spec.type === 'mine') state.stats.miningTrips += 1;
  return { ok: true, order: ship.order };
}

function remember(ship, spec) {
  if (spec.type === 'refit') return;
  ship.plan.push(spec);
  if (ship.plan.length > MAX_PLAN) ship.plan.splice(0, ship.plan.length - MAX_PLAN);
}

/**
 * Gives a ship an order: an idle ship starts it now, a busy one queues it
 * after its other orders. Returns { ok, order, queued } or { ok: false, error }.
 * `order` is the built order (for a queued one, an estimate of it).
 */
export function giveOrder(state, ship, spec) {
  if (!ship) return fail('No such ship.');
  if (!BUILDERS[spec?.type]) return fail('Unknown order.');
  if (ship.order) {
    if (freeSlots(state, ship) <= 0) return fail(`${ship.name}'s orders are full.`);
    const view = projectShip(state, ship);
    const check = buildOrder(state, view, spec, view.time);
    if (!check.ok) return check;
    ship.queue.push(spec);
    remember(ship, spec);
    return { ok: true, queued: true, order: check.order };
  }
  // An idle ship with an empty hold starts a new plan. One that still carries
  // cargo is halfway through its route (it mined, then waited for the order
  // to sell), so the new order adds to the plan. A refit keeps the plan.
  const midRoute = cargoTotal(ship) > 0;
  const result = startOrder(state, ship, spec);
  if (!result.ok) return result;
  if (spec.type !== 'refit' && !midRoute) ship.plan = [];
  remember(ship, spec);
  return { ok: true, queued: false, order: result.order };
}

/** Gives several orders in turn; stops at the first that fails. */
export function giveOrders(state, ship, specs) {
  let given = 0;
  for (const spec of specs) {
    const result = giveOrder(state, ship, { ...spec });
    if (!result.ok) return given ? { ok: true, given, error: result.error } : result;
    given += 1;
  }
  return { ok: given > 0, given, error: given ? undefined : 'No orders to give.' };
}

/**
 * Called by the simulation when a ship's order ends: starts the next queued
 * order, skipping (and refunding) any that can no longer run.
 */
export function startNextOrder(state, ship, at) {
  ship.order = null;
  while (ship.queue.length) {
    const spec = ship.queue.shift();
    const result = startOrder(state, ship, spec);
    if (result.ok) return;
    refund(state, spec);
    addLog(state, at, `${ship.name} skipped an order: ${result.error}`, 'warning');
  }
}

function refund(state, spec) {
  if (spec?.type === 'refit' && spec.paid) state.credits += spec.paid;
}

const placeName = (id) => findPlace(id)?.name ?? 'its target';

/** The jump legs of an order, in order. */
const jumpLegs = (order) => (order?.legs ?? []).filter((leg) => leg.jump);

/** The next jump of a ship's order still to pay for, or null. */
export function nextJump(order) {
  const legs = jumpLegs(order);
  return legs[order?.jumpsPaid ?? legs.length] ?? null;
}

/** The jump fees ships still have to pay on the orders they are flying now (cr). */
export function feesDue(state) {
  let due = 0;
  for (const ship of state.ships) {
    const legs = jumpLegs(ship.order);
    for (const leg of legs.slice(ship.order?.jumpsPaid ?? legs.length)) due += leg.fee ?? 0;
  }
  return due;
}

/**
 * Called by the simulation as a ship enters a warp: pays that jump's fee.
 * Without the credits, the ship stays at the gate and its order ends there;
 * its queued orders carry on from the gate if they can.
 */
export function payJump(state, ship, leg) {
  const order = ship.order;
  order.jumpsPaid = (order.jumpsPaid ?? 0) + 1;
  const fee = leg.fee ?? 0;
  const to = findSystem(systemOf(leg.to))?.name ?? 'the next system';
  if (fee > state.credits) {
    ship.order = null;
    ship.at = leg.from;
    addLog(state, leg.start, `${ship.name} waits at ${placeName(leg.from)}: the jump to ${to} costs ${formatCredits(fee)}`, 'warning');
    startNextOrder(state, ship, leg.start);
    return { ok: false };
  }
  state.credits -= fee;
  state.stats.jumpFees = (state.stats.jumpFees ?? 0) + fee;
  state.stats.jumps = (state.stats.jumps ?? 0) + 1;
  if (fee > 0) addLog(state, leg.start, `${ship.name} paid ${formatCredits(fee)} to jump to ${to}`, 'purchase', -fee);
  return { ok: true };
}

/**
 * Tonnes a mining order has mined by `now`. The hold fills as the ship
 * mines, so a cancelled trip keeps what it has (see cancelOrder).
 */
export function minedSoFar(order, now) {
  const step = order?.steps[order.stepIndex ?? 0];
  const leg = order?.legs.at(-1);
  if (step?.kind !== 'mined' || !leg || leg.from !== leg.to) return 0;
  const t = (now - leg.start) / Math.max(1, leg.end - leg.start);
  return Math.floor(step.amount * Math.min(1, Math.max(0, t)));
}

/** What a ship carries at `now`, counting ore a mining order has mined so far. */
export function cargoNow(ship, now) {
  const cargo = { ...ship.cargo };
  const mined = minedSoFar(ship.order, now);
  if (mined > 0) {
    const good = ship.order.steps[ship.order.stepIndex].good;
    cargo[good] = (cargo[good] ?? 0) + Math.min(mined, Math.floor(holdOf(ship) - cargoTotal(ship)));
  }
  return cargo;
}

/**
 * Cancels a ship's current order. At its target the job stops now: a
 * mining ship keeps what it has mined, and a refit is refunded. A ship
 * still flying cannot stop in open space, so it finishes the flight and
 * waits there without doing the job. Queued orders carry on after that.
 * Returns { ok, mined, flying }.
 */
export function cancelOrder(state, ship, at = state.now) {
  if (!ship) return fail('No such ship.');
  const order = ship.order;
  if (!order) return fail(`${ship.name} has no order to cancel.`);
  const phase = orderPhase(order, at);
  if (phase.flying) {
    const leg = order.legs.find((l) => l.from !== l.to && at < l.end) ?? order.legs.find((l) => l.from !== l.to);
    const name = placeName(leg.to);
    if (order.type === 'fly' && leg.to === order.target) return fail(`${ship.name} cannot stop in open space. It waits at ${name} when it gets there.`);
    // Jumps not yet entered are never paid for.
    refund(state, order.spec);
    ship.order = {
      type: 'fly',
      label: `Flying to ${name}`,
      flightLabel: `Flying to ${name}`,
      target: leg.to,
      startedAt: order.startedAt,
      endsAt: leg.end,
      steps: [{ at: leg.end, kind: 'arrive', station: leg.to }],
      legs: order.legs.filter((l) => l.end <= leg.end),
      spec: { type: 'fly', stationId: leg.to },
      stepIndex: 0,
      fees: 0,
      jumps: 0,
      jumpsPaid: order.jumpsPaid,
    };
    addLog(state, at, `${ship.name} cancelled its order and waits at ${name} when it gets there`, 'order');
    return { ok: true, flying: true, mined: 0 };
  }
  refund(state, order.spec);
  const mined = Math.min(minedSoFar(order, at), Math.floor(holdOf(ship) - cargoTotal(ship)));
  const step = order.steps[order.stepIndex];
  if (mined > 0) {
    ship.cargo[step.good] = (ship.cargo[step.good] ?? 0) + mined;
    logMined(state, ship, { ...step, at, amount: mined });
  }
  ship.at = order.target;
  addLog(state, at, `${ship.name} cancelled its order at ${placeName(order.target)}`, 'order');
  startNextOrder(state, ship, at);
  return { ok: true, flying: false, mined };
}

/** Removes the orders waiting after the current one. Refits are refunded. */
export function clearQueue(state, ship) {
  if (!ship.queue.length) return fail(`${ship.name} has no orders waiting.`);
  const dropped = ship.queue.splice(0);
  for (const spec of dropped) refund(state, spec);
  const routeOrders = dropped.filter((spec) => spec.type !== 'refit').length;
  if (routeOrders) ship.plan.splice(-routeOrders);
  return { ok: true, dropped: dropped.length };
}

// ---------- Refits ----------

/** What a refit would fit and cost for this ship now, or null. */
export function refitOffer(state, ship) {
  const modules = refitTarget(state, ship);
  return modules ? { modules, cost: refitCost(modules) } : null;
}

/** The known shipyard a ship reaches first (the home one when none is nearer). */
export function nearestShipyard(state, ship) {
  const view = projectShip(state, ship);
  let best = { id: SHIPYARD_ID, time: travelTime(state, view, view.at, SHIPYARD_ID) };
  for (const station of knownStations(state)) {
    if (station.type !== 'shipyard' || station.id === SHIPYARD_ID) continue;
    const time = travelTime(state, view, view.at, station.id);
    if (time < best.time) best = { id: station.id, time };
  }
  return best.id;
}

/** Pays for a refit and gives the order to fly to a shipyard (the nearest, by default) for it. */
export function orderRefit(state, ship, stationId = nearestShipyard(state, ship)) {
  if (!ship) return fail('No such ship.');
  const offer = refitOffer(state, ship);
  if (!offer) return fail(`${ship.name} already has the newest modules.`);
  if (state.credits < offer.cost) return fail(`A refit costs ${formatCredits(offer.cost)}. You need ${formatCredits(offer.cost - state.credits)} more.`);
  const result = giveOrder(state, ship, { type: 'refit', modules: offer.modules, paid: offer.cost, stationId });
  if (!result.ok) return result;
  state.credits -= offer.cost;
  addLog(state, state.now, `${ship.name} booked a refit for ${formatCredits(offer.cost)}`, 'purchase', -offer.cost);
  return { ...result, cost: offer.cost };
}

/** Books a refit for every ship that is behind and has room for the order. */
export function refitAll(state, stationId) {
  let count = 0;
  let cost = 0;
  let error = null;
  for (const ship of state.ships) {
    if (!refitOffer(state, ship)) continue;
    const result = stationId ? orderRefit(state, ship, stationId) : orderRefit(state, ship);
    if (result.ok) {
      count += 1;
      cost += result.cost;
    } else error ??= result.error;
  }
  if (!count) return fail(error ?? 'Every ship has the newest modules.');
  return { ok: true, count, cost };
}

// ---------- Repeating and copying ----------

const sameSpec = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The shortest run of orders the plan repeats, e.g. [mine, sell]. */
export function planCycle(plan) {
  for (let len = 1; len <= plan.length; len += 1) {
    if (plan.length % len) continue;
    if (plan.every((spec, i) => sameSpec(spec, plan[i % len]))) return plan.slice(0, len);
  }
  return plan.slice();
}

/**
 * How many of `specs`, given in turn after the ship's other orders, would
 * fit in its free slots and work (a second "mine" with a full hold would not).
 */
function ordersThatWork(state, ship, specs) {
  const room = Math.min(specs.length, freeSlots(state, ship));
  const view = projectShip(state, ship);
  for (let i = 0; i < room; i += 1) {
    const built = buildOrder(state, view, specs[i], view.time);
    if (!built.ok) return i;
    applySteps(view, built.order);
  }
  return room;
}

/** How many more whole rounds of its plan a ship has room for, counting only rounds that would work. */
export function roomForRounds(state, ship) {
  const cycle = planCycle(ship.plan);
  if (!cycle.length) return 0;
  const max = Math.floor(freeSlots(state, ship) / cycle.length);
  return Math.floor(ordersThatWork(state, ship, Array.from({ length: max }, () => cycle).flat()) / cycle.length);
}

/**
 * Whether Repeat to fill is worth offering: a busy ship needs one round, an
 * idle one two (a single round is what Run again does).
 */
export function canRepeat(state, ship) {
  return roomForRounds(state, ship) > (ship.order ? 0 : 1);
}

/** Adds rounds of the ship's plan until its orders are full. */
export function repeatToFill(state, ship) {
  if (!ship) return fail('No such ship.');
  const cycle = planCycle(ship.plan);
  if (!cycle.length) return fail(`${ship.name} has no orders to repeat.`);
  const rounds = roomForRounds(state, ship);
  if (rounds < 1) return fail(`${ship.name} has no room for another round.`);
  const result = giveOrders(state, ship, Array.from({ length: rounds }, () => cycle).flat());
  if (result.ok) state.stats.repeats += 1;
  return result;
}

/** Whether an idle ship remembers a plan whose first order would work now. */
export function canRunAgain(state, ship) {
  return !ship.order && ship.plan.length > 0 && ordersThatWork(state, ship, ship.plan) > 0;
}

/** Gives an idle ship the orders it ran last time. */
export function runAgain(state, ship) {
  if (!ship) return fail('No such ship.');
  if (ship.order) return fail(`${ship.name} is still busy.`);
  if (!ship.plan.length) return fail(`${ship.name} has no orders to run again.`);
  return giveOrders(state, ship, ship.plan.slice(0, MAX_PLAN));
}

/**
 * Whether `to` can fly `from`'s plan: the hull suits it (miners mine, haulers
 * buy) and every order that fits in `to`'s slots would work from where it is.
 */
export function canCopy(state, from, to) {
  if (!from || !to || from === to || !from.plan.length) return false;
  const role = HULLS[to.hull].role;
  const suits = from.plan.every((spec) => (spec.type === 'mine' ? role === 'miner' : spec.type === 'buy' ? role === 'hauler' : true));
  if (!suits) return false;
  const fits = Math.min(from.plan.length, freeSlots(state, to));
  return fits > 0 && ordersThatWork(state, to, from.plan) === fits;
}

/** Gives `to` the orders `from` was last given. */
export function copyOrders(state, to, from) {
  if (!to || !from) return fail('No such ship.');
  if (!canCopy(state, from, to)) return fail(`${to.name} cannot fly ${from.name}'s orders.`);
  const result = giveOrders(state, to, from.plan.slice(0, MAX_PLAN));
  if (result.ok) state.stats.copies += 1;
  return result;
}

// ---------- Text ----------

/** A short line for a ship's current state, for lists. */
/**
 * What an order is doing at `now`: flying to its target, or the job there
 * (mining, a refit). The flight is not part of the job: sales, purchases
 * and arrivals take no time of their own, so those orders are all flight.
 * Returns { label, start, end, flying }.
 */
export function orderPhase(order, now) {
  const legs = order.legs ?? [];
  const leg = legs.find((l) => now < l.end) ?? legs.at(-1);
  if (!leg) return { label: order.label, start: order.startedAt, end: order.endsAt, flying: false };
  if (leg.jump) {
    const system = findSystem(systemOf(leg.to));
    return { label: `Jumping to ${system?.name ?? 'the next system'}`, start: leg.start, end: leg.end, flying: true, jumping: true };
  }
  if (leg.from !== leg.to) {
    // Crossing a system on the way to a gate is still part of the flight.
    const label = order.flightLabel ?? `Flying to ${placeName(leg.to)}`;
    return { label, start: leg.start, end: leg.end, flying: true };
  }
  return { label: order.label, start: leg.start, end: leg.end, flying: false };
}

/** How long an order flies and how long its job takes, in ms: { flight, work }. */
export function orderTimes(order) {
  let flight = 0;
  let work = 0;
  for (const leg of order.legs ?? []) {
    if (leg.from === leg.to) work += leg.end - leg.start;
    else flight += leg.end - leg.start;
  }
  return { flight, work };
}

export function shipStatus(ship, now) {
  if (ship.order) {
    const more = ship.queue.length ? ` · ${ship.queue.length} more` : '';
    return `${orderPhase(ship.order, now).label}${more}`;
  }
  const place = findPlace(ship.at);
  const aboard = Object.entries(ship.cargo)
    .filter(([, qty]) => qty > 0)
    .map(([good, qty]) => `${formatNumber(qty)} t ${lower(good)}`);
  const where = findStation(ship.at) ? `Docked at ${place.name}` : place ? `Waiting at ${place.name}` : 'In space';
  return aboard.length ? `${where} with ${aboard.join(', ')}` : where;
}

/** Short text for an order spec, for queue lists. */
export function specLabel(spec) {
  switch (spec.type) {
    case 'mine': {
      const field = findField(spec.fieldId);
      return `Mine ${spec.amount ? `${formatNumber(spec.amount)} t` : 'a full hold'} at ${field?.name ?? '?'}`;
    }
    case 'sell':
      return `Sell ${spec.good ? lower(spec.good) : 'cargo'} at ${findStation(spec.stationId)?.name ?? '?'}`;
    case 'buy':
      return `Buy ${formatNumber(spec.qty)} t ${lower(spec.good)} at ${findStation(spec.stationId)?.name ?? '?'}`;
    case 'deliver':
      return `Deliver ${lower(spec.good)} to ${findStation(spec.stationId)?.name ?? '?'}`;
    case 'fly':
      return `Fly to ${placeName(spec.stationId)}`;
    case 'refit':
      return `Refit at ${findStation(spec.stationId ?? SHIPYARD_ID)?.name ?? '?'}`;
    case 'survey':
      return `Survey ${findSystem(spec.systemId)?.name ?? '?'}`;
    case 'investigate':
      return `Investigate the signal in ${findSystem(systemOf(spec.signalId))?.name ?? '?'}`;
    case 'salvage':
      return `Salvage the derelict in ${findSystem(systemOf(spec.signalId))?.name ?? '?'}`;
    default:
      return spec.type;
  }
}

/** Logs a mined hold; used by the simulation. */
export function logMined(state, ship, step) {
  addLog(state, step.at, `${ship.name} mined ${formatNumber(step.amount)} t ${lower(step.good)} at ${findField(step.field).name}`, 'mined');
}
