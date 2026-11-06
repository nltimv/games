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
//   { type: 'fly', stationId }
//   { type: 'refit', modules, paid }    fly to the shipyard and fit modules
//                                       (see orderRefit; paid up front)
//
// A built order has:
//   type, label, target         what it is, for the UI
//   flightLabel                 what it says while flying there
//   startedAt, endsAt           wall-clock times (ms)
//   steps: [{ at, kind, ... }]  effects applied at their time, in order
//   legs:  [{ from, to, start, end }]  where to draw the ship
//
// A ship holds a few orders at once (orderSlots, raised by research): the
// current one plus a queue. Each queued order starts as soon as the one
// before it ends. A ship that runs out of orders waits where it is.

import { goodName } from '../content/goods.js';
import { HULLS, REFIT_MINUTES } from '../content/ships.js';
import { HOME_SYSTEM, findField, findStation } from '../content/homeSystem.js';
import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { MINUTE, SECOND } from '../core/time.js';
import { findEntry } from './market.js';
import { canCarry, cargoTotal } from './cargo.js';
import { holdOf, laserOf, refitCost, refitTarget } from './modules.js';
import { orderSlots } from './research.js';
import { travelTime } from './travel.js';
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

function flight(view, to, start) {
  const travel = travelTime(view, view.at, to);
  return { travel, legs: travel ? [{ from: view.at, to, start, end: start + travel }] : [] };
}

// ---------- Builders ----------
// Each builds an order for `view` (a ship, or a projection of one; see
// projectShip) starting at `start`, or explains why it cannot.

function buildMine(state, view, { fieldId, amount }, start) {
  if (HULLS[view.hull].role !== 'miner') return fail(`${view.name} is not a mining ship.`);
  const field = findField(fieldId);
  if (!field) return fail('No such asteroid field.');
  const free = freeIn(view);
  const qty = Math.floor(Math.min(free, amount ?? free));
  if (free < 1) return fail(`${view.name}'s hold is full.`);
  if (!(qty >= 1)) return fail('Pick an amount to mine.');
  const { travel, legs } = flight(view, fieldId, start);
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
    },
  };
}

function stationLegs(view, stationId, start, stay = 0) {
  const { travel, legs } = flight(view, stationId, start);
  const end = start + travel + stay;
  if (!legs.length || stay) legs.push({ from: stationId, to: stationId, start: start + travel, end });
  return { end, legs };
}

function buildSell(state, view, { stationId, good }, start) {
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  const goods = sellable(view, stationId, good);
  if (!goods.length) {
    if (good) return fail(`${station.name} does not buy ${lower(good)}, or ${view.name} has none.`);
    return fail(`${view.name} carries nothing ${station.name} buys.`);
  }
  const { end, legs } = stationLegs(view, stationId, start);
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
    },
  };
}

function buildBuy(state, view, { stationId, good, qty }, start) {
  if (HULLS[view.hull].role !== 'hauler') return fail('Only haulers can buy goods.');
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  if (findEntry(stationId, good)?.side !== 'sells') return fail(`${station.name} does not sell ${lower(good)}.`);
  if (!canCarry(view, good)) return fail(`${goodName(good)} needs a better hold.`);
  const amount = Math.floor(Math.min(qty, freeIn(view)));
  if (amount < 1) return fail(`${view.name}'s hold is full.`);
  const { end, legs } = stationLegs(view, stationId, start);
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
    },
  };
}

function buildFly(state, view, { stationId }, start) {
  const station = findStation(stationId);
  if (!station) return fail('No such station.');
  if (stationId === view.at) return fail(`${view.name} is already there.`);
  const { end, legs } = stationLegs(view, stationId, start);
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
    },
  };
}

function buildRefit(state, view, { modules }, start) {
  if (!modules) return fail('Nothing to fit.');
  const station = findStation(SHIPYARD_ID);
  const { end, legs } = stationLegs(view, SHIPYARD_ID, start, REFIT_MINUTES * MINUTE);
  return {
    ok: true,
    order: {
      type: 'refit',
      label: `Refitting at ${station.name}`,
      flightLabel: `Flying to ${station.name} for a refit`,
      target: SHIPYARD_ID,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'refit', station: SHIPYARD_ID, modules }],
      legs,
    },
  };
}

const BUILDERS = { mine: buildMine, sell: buildSell, buy: buildBuy, fly: buildFly, refit: buildRefit };

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
    } else if (step.kind === 'refit') {
      view.modules = { ...view.modules, ...step.modules };
      view.at = step.station;
    } else if (step.kind === 'arrive') {
      view.at = step.station;
    }
  }
  view.time = Math.max(view.time, order.endsAt);
}

/**
 * Where a ship will be, what it will carry and when, once its current and
 * queued orders are done. Sales and purchases are estimates.
 */
export function projectShip(state, ship) {
  const view = {
    id: ship.id,
    name: ship.name,
    hull: ship.hull,
    at: ship.at,
    cargo: { ...ship.cargo },
    modules: { ...ship.modules },
    time: state.now,
  };
  if (ship.order) {
    applySteps(view, ship.order, ship.order.stepIndex);
    view.at = ship.order.target;
  }
  for (const spec of ship.queue) {
    const built = buildOrder(state, view, spec, view.time);
    if (built.ok) applySteps(view, built.order);
  }
  return view;
}

// ---------- Giving orders ----------

export function freeSlots(state, ship) {
  return Math.max(0, orderSlots(state) - (ship.order ? 1 : 0) - ship.queue.length);
}

/** Starts a spec now on an idle ship. */
function startOrder(state, ship, spec) {
  const result = buildOrder(state, ship, spec, state.now);
  if (!result.ok) return result;
  ship.order = { ...result.order, spec, stepIndex: 0 };
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

const placeName = (id) => (findStation(id) ?? findField(id))?.name ?? 'its target';

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
    if (order.type === 'fly') return fail(`${ship.name} cannot stop in open space. It waits at ${name} when it gets there.`);
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

/** Pays for a refit and gives the order to fly to the shipyard for it. */
export function orderRefit(state, ship) {
  if (!ship) return fail('No such ship.');
  const offer = refitOffer(state, ship);
  if (!offer) return fail(`${ship.name} already has the newest modules.`);
  if (state.credits < offer.cost) return fail(`A refit costs ${formatCredits(offer.cost)}. You need ${formatCredits(offer.cost - state.credits)} more.`);
  const result = giveOrder(state, ship, { type: 'refit', modules: offer.modules, paid: offer.cost });
  if (!result.ok) return result;
  state.credits -= offer.cost;
  addLog(state, state.now, `${ship.name} booked a refit for ${formatCredits(offer.cost)}`, 'purchase', -offer.cost);
  return { ...result, cost: offer.cost };
}

/** Books a refit for every ship that is behind and has room for the order. */
export function refitAll(state) {
  let count = 0;
  let cost = 0;
  let error = null;
  for (const ship of state.ships) {
    if (!refitOffer(state, ship)) continue;
    const result = orderRefit(state, ship);
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

/** Ships that are idle and could run their last orders again. */
export function rerunnable(state) {
  return state.ships.filter((ship) => canRunAgain(state, ship));
}

/** "Run all again": every idle ship repeats its last orders. */
export function runAllAgain(state) {
  let count = 0;
  let error = null;
  for (const ship of rerunnable(state)) {
    const result = runAgain(state, ship);
    if (result.ok) count += 1;
    else error ??= `${ship.name}: ${result.error}`;
  }
  if (!count) return fail(error ?? 'No ship has orders to run again.');
  return { ok: true, count };
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
  if (leg.from !== leg.to) {
    const label = order.flightLabel ?? `Flying to ${(findStation(leg.to) ?? findField(leg.to))?.name ?? 'its target'}`;
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
  const place = findStation(ship.at) ?? findField(ship.at);
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
    case 'fly':
      return `Fly to ${placeName(spec.stationId)}`;
    case 'refit':
      return `Refit at ${findStation(SHIPYARD_ID).name}`;
    default:
      return spec.type;
  }
}

/** Logs a mined hold; used by the simulation. */
export function logMined(state, ship, step) {
  addLog(state, step.at, `${ship.name} mined ${formatNumber(step.amount)} t ${lower(step.good)} at ${findField(step.field).name}`, 'mined');
}
