// Read-only questions the UI asks before the player commits to something:
// who buys this, what would a hold of ore bring in, what is the best trade.
// None of these change the state.

import { HULLS } from '../content/ships.js';
import { findGate, findStation, findSystem, gateTo, systemOf } from '../content/galaxy.js';
import { affordableQty, findEntry, marketEntries, marketView, quote } from './market.js';
import { canCarry, cargoTotal, freeHold } from './cargo.js';
import { contractFor, stillNeeded } from './contracts.js';
import { holdOf } from './modules.js';
import { buildOrder, freeSlots, orderTimes, projectShip, refitOffer } from './orders.js';
import { isSurveyed, knownStations, surveyable } from './explore.js';
import { knownAt } from './knowledge.js';
import { canJump, plotCourse, travelTime } from './travel.js';
import { isShielded } from './shielding.js';
import { derelictLeft, isInvestigated } from './signals.js';
import { findSignal } from '../content/galaxy.js';

/** What selling `qty` of `good` at a station pays, at the prices known there. */
export function saleValue(state, stationId, good, qty, at = state.now) {
  if (findEntry(stationId, good)?.side !== 'buys' || qty <= 0) return { qty: 0, total: 0, average: 0 };
  return quote(state, stationId, good, Math.floor(qty), knownAt(state, stationId, at));
}

/**
 * Known stations that buy `good` (in one system, if given), best price
 * first, with their market view.
 */
export function buyersOf(state, good, at = state.now, systemId = null) {
  return knownStations(state)
    .filter((station) => (!systemId || systemOf(station.id) === systemId) && findEntry(station.id, good)?.side === 'buys')
    .map((station) => ({ station, view: marketView(state, station.id, good, knownAt(state, station.id, at)) }))
    .sort((a, b) => b.view.price - a.view.price);
}

/** The best place to sell `qty` of `good` (in one system, if given), by total paid. */
export function bestBuyer(state, good, qty, at = state.now, systemId = null) {
  let best = null;
  for (const { station } of buyersOf(state, good, at, systemId)) {
    const sale = saleValue(state, station.id, good, qty, at);
    if (!best || sale.total > best.sale.total) best = { stationId: station.id, sale };
  }
  return best;
}

/**
 * A system's market for `good` at the prices last seen there: the cheapest
 * a station sells it for and the most one pays, { sells, buys } (null
 * where no station does).
 */
export function systemMarket(state, systemId, good, at = state.now) {
  let sells = null;
  let buys = null;
  for (const station of findSystem(systemId)?.stations ?? []) {
    const entry = findEntry(station.id, good);
    if (!entry) continue;
    const price = marketView(state, station.id, good, knownAt(state, station.id, at)).price;
    if (entry.side === 'sells') sells = Math.min(sells ?? Infinity, price);
    else buys = Math.max(buys ?? 0, price);
  }
  return { sells, buys };
}

/** Where a docked ship could take `qty` of `good`, with the expected sale. */
export function deliveryOptions(state, ship, good, qty = ship.cargo[good] ?? 0, at = state.now) {
  if (!ship.at || qty <= 0) return [];
  return buyersOf(state, good, at)
    .filter(({ station }) => station.id !== ship.at)
    .map(({ station }) => ({
      stationId: station.id,
      sale: saleValue(state, station.id, good, Math.floor(qty), at),
      travel: travelTime(state, ship, ship.at, station.id),
    }));
}

/** What selling a ship's whole stock of `good` where it is docked would pay. */
export function saleHere(state, ship, good, at = state.now) {
  if (!ship.at || findEntry(ship.at, good)?.side !== 'buys') return null;
  return saleValue(state, ship.at, good, Math.floor(ship.cargo[good] ?? 0), at);
}

/**
 * A mining order previewed from the end of the ship's current orders:
 * { ok, amount, max, value, startsAt, endsAt, queued } or { ok: false, error }.
 * `amount` null means a full hold.
 */
export function minePreview(state, ship, fieldId, amount = null, at = state.now) {
  const view = projectShip(state, ship);
  const max = Math.floor(Math.max(0, holdOf(view) - cargoTotal(view)));
  const built = buildOrder(state, view, { type: 'mine', fieldId, amount }, view.time);
  if (!built.ok) return { ok: false, error: built.error, amount: 0, max, value: 0 };
  const step = built.order.steps[0];
  // What the ore fetches in the field's own system, or anywhere known.
  const best = bestBuyer(state, step.good, step.amount, at, systemOf(fieldId)) ?? bestBuyer(state, step.good, step.amount, at);
  return {
    ok: true,
    amount: step.amount,
    max,
    value: best?.sale.total ?? 0,
    startsAt: view.time,
    endsAt: built.order.endsAt,
    ...orderTimes(built.order),
    queued: Boolean(ship.order),
  };
}

/** The most a docked hauler can buy of `good` here: hold, credits and stock. */
export function maxPurchase(state, ship, good, at = state.now) {
  if (!ship.at || HULLS[ship.hull].role !== 'hauler' || !canCarry(ship, good)) return 0;
  const entry = findEntry(ship.at, good);
  if (!entry || entry.side !== 'sells') return 0;
  return affordableQty(state, ship.at, good, state.credits, freeHold(ship), at);
}

/**
 * Buy `qty` at `fromId` and sell it at `destId`: the expected money and
 * time. Jump fees come off the profit; `reachable` is false when no known
 * route leads there.
 */
export function tradePlan(state, ship, good, qty, destId, at = state.now, fromId = ship.at, course = plotCourse(state, ship, fromId, destId)) {
  const buy = quote(state, fromId, good, qty, knownAt(state, fromId, at));
  const sell = saleValue(state, destId, good, buy.qty, at);
  const fees = course.ok ? course.fees : 0;
  return {
    qty: buy.qty,
    buy,
    sell,
    fees,
    jumps: course.ok ? course.jumps : 0,
    profit: sell.total - buy.total - fees,
    travel: course.ok ? course.time : Infinity,
    reachable: course.ok,
  };
}

/**
 * The quantity with the best expected profit for a trade. Buying more
 * raises the buy price and lowers the sell price, so past some point each
 * extra tonne loses money.
 */
export function bestTradeQty(state, ship, good, destId, maxQty, at = state.now, fromId = ship.at) {
  let best = { qty: 0, profit: 0 };
  const course = plotCourse(state, ship, fromId, destId);
  if (!course.ok) return best;
  const step = Math.max(1, Math.round(maxQty / 40));
  for (let qty = step; qty <= maxQty + step - 1; qty += step) {
    const q = Math.min(qty, maxQty);
    const plan = tradePlan(state, ship, good, q, destId, at, fromId, course);
    if (plan.profit > best.profit) best = { qty: plan.qty, profit: plan.profit };
  }
  return best;
}

// Buyers checked for a trade from a station: the best-paying few it knows.
const ROUTE_CANDIDATES = 8;

/**
 * The most profitable known buyer for `good` bought at `fromId`, sized to
 * what still pays and with jump fees counted: { destId, plan, profit }, or
 * null when no buyer pays more than the station asks.
 */
export function bestRoute(state, ship, good, fromId, maxQty, at = state.now) {
  const asks = marketView(state, fromId, good, knownAt(state, fromId, at))?.price ?? Infinity;
  let best = null;
  const buyers = buyersOf(state, good, at).filter(({ station, view }) => station.id !== fromId && view.price > asks);
  for (const { station } of buyers.slice(0, ROUTE_CANDIDATES)) {
    const { qty, profit } = bestTradeQty(state, ship, good, station.id, maxQty, at, fromId);
    if (qty > 0 && profit > (best?.profit ?? 0)) best = { destId: station.id, qty, profit };
  }
  if (!best) return null;
  const plan = tradePlan(state, ship, good, best.qty, best.destId, at, fromId);
  return { destId: best.destId, plan, profit: plan.profit };
}

function slotNote(free, needed) {
  return free >= needed ? null : 'Orders full';
}

/**
 * What `ship` could do at a map target ({ kind, id }), for the order menu.
 * A busy ship's options queue after its current orders, so they are
 * worked out from where it will be then. Each option has a `kind`:
 *   mine         { fieldId, amount: null, qty, value, endsAt }   a full hold
 *   mine-amount  { fieldId, max }                                opens the slider
 *   sell         { stationId, total, endsAt, now }               `now`: sells on the spot
 *   deliver      { stationId, good, qty, contract, completes,    hands cargo to a contract
 *                  reward, endsAt, now }                         here; `completes`: the last
 *                                                                tonnes it needs
 *   buy          { stationId, good, qty, cost, endsAt, destId,   haulers; sized for a contract
 *                  profit, contract, completes, reward }         elsewhere (`contract`), else
 *                                                                for the best buyer it knows
 *                                                                (`destId`, `profit`), else a
 *                                                                full hold
 *   refit        { stationId, cost, modules, endsAt }            at a shipyard
 *   fly          { stationId, endsAt }                           any place in its system
 *   jump         { systemId, stationId, endsAt, jumps, fees }    to another system's gate
 *   survey       { systemId, endsAt, fees }                      scouts
 * plus `queued` (it waits for other orders) and `disabled` with a `note`.
 * Options with an `endsAt` also have `flight` and `work`: how long the ship
 * flies and how long the job itself takes, in ms.
 */
export function orderOptions(state, ship, target, at = state.now) {
  if (!ship || !target) return [];
  const role = HULLS[ship.hull].role;
  const view = projectShip(state, ship);
  const free = freeSlots(state, ship);
  const queued = Boolean(ship.order);
  const options = [];
  // When the order would end, and how long it flies and works.
  const timesOf = (spec) => {
    const built = buildOrder(state, view, spec, view.time);
    if (!built.ok) return { endsAt: null, error: built.error };
    return { endsAt: built.order.endsAt, ...orderTimes(built.order), fees: built.order.fees ?? 0, jumps: built.order.jumps ?? 0 };
  };
  // Disabled, with the reason, when the ship has no room or cannot get there.
  const gated = (option, slots = 1) => {
    const blocked = slotNote(free, slots) ?? option.error ?? null;
    const rest = { ...option };
    delete rest.error;
    return { ...rest, queued, disabled: Boolean(blocked) || Boolean(rest.disabled), note: blocked ?? rest.note ?? null };
  };

  if (target.kind === 'gate' || target.kind === 'system') return travelOptions(state, view, target, timesOf, gated);
  if (target.kind === 'signal') return signalOptions(state, view, target.id, timesOf, gated);

  if (target.kind === 'field') {
    if (role !== 'miner') return [];
    const full = minePreview(state, ship, target.id, null, at);
    const blocked = slotNote(free, 1);
    options.push({
      kind: 'mine',
      fieldId: target.id,
      amount: null,
      qty: full.amount,
      value: full.value,
      endsAt: full.endsAt,
      flight: full.flight,
      work: full.work,
      queued,
      disabled: Boolean(blocked) || !full.ok,
      note: blocked ?? (full.ok ? null : 'Hold full'),
    });
    if (full.ok && full.max >= 2) {
      options.push({ kind: 'mine-amount', fieldId: target.id, max: full.max, queued, disabled: Boolean(blocked), note: blocked });
    }
    return options;
  }
  if (target.kind !== 'station') return [];
  const stationId = target.id;

  // Hand cargo to a contract running here.
  for (const good of Object.keys(view.cargo)) {
    const contract = contractFor(state, stationId, good, at);
    if (!contract || view.cargo[good] < 1) continue;
    const needed = stillNeeded(contract) - (view.delivered[contract.id] ?? 0);
    if (needed < 1) continue;
    const qty = Math.min(Math.floor(view.cargo[good]), needed);
    const now = !queued && ship.at === stationId;
    const times = now ? { endsAt: at } : timesOf({ type: 'deliver', stationId, good });
    const option = { kind: 'deliver', stationId, good, qty, contract, completes: qty >= needed, reward: contract.reward, ...times, now };
    options.push(now ? { ...option, queued, disabled: false, note: null } : gated(option));
  }

  // Sell what it carries (or will carry).
  const goods = Object.keys(view.cargo).filter((g) => view.cargo[g] > 0 && findEntry(stationId, g)?.side === 'buys');
  if (goods.length) {
    const total = goods.reduce((sum, g) => sum + saleValue(state, stationId, g, view.cargo[g], at).total, 0);
    const now = !queued && ship.at === stationId;
    const times = now ? { endsAt: at } : timesOf({ type: 'sell', stationId });
    const option = { kind: 'sell', stationId, goods, total, ...times, now };
    options.push(now ? { ...option, queued, disabled: false, note: null } : gated(option));
  }

  if (role === 'hauler') {
    const viewFree = Math.max(0, holdOf(view) - cargoTotal(view));
    options.push(...buyOptions(state, view, stationId, viewFree, at, timesOf).map((option) => gated(option)));
  }

  if (findStation(stationId)?.type === 'shipyard') {
    const offer = refitOffer(state, ship);
    if (offer) {
      const poor = state.credits < offer.cost ? 'Not enough credits' : null;
      const times = timesOf({ type: 'refit', modules: offer.modules, stationId });
      options.push(gated({ kind: 'refit', stationId, cost: offer.cost, modules: offer.modules, ...times, disabled: Boolean(poor), note: poor }));
    }
  }

  if (view.at !== stationId) options.push(gated({ kind: 'fly', stationId, ...timesOf({ type: 'fly', stationId }) }));
  return options;
}

/**
 * Orders at a signal: a scout investigates an unknown one, a hauler
 * salvages a derelict, and any ship can fly there.
 */
function signalOptions(state, view, signalId, timesOf, gated) {
  const signal = findSignal(signalId);
  if (!signal) return [];
  const role = HULLS[view.hull].role;
  const options = [];
  if (role === 'scout' && !isInvestigated(state, signal)) {
    options.push(gated({ kind: 'investigate', signalId, ...timesOf({ type: 'investigate', signalId }) }));
  }
  if (role === 'hauler' && signal.kind === 'derelict' && isInvestigated(state, signal) && derelictLeft(state, signal) > 0) {
    const room = Math.max(0, Math.floor(holdOf(view) - cargoTotal(view)));
    const qty = Math.min(room, derelictLeft(state, signal));
    options.push(gated({ kind: 'salvage', signalId, good: signal.good, qty, ...timesOf({ type: 'salvage', signalId }) }));
  }
  if (view.at !== signalId) options.push(gated({ kind: 'fly', stationId: signalId, ...timesOf({ type: 'fly', stationId: signalId }) }));
  return options;
}

/**
 * What a hauler can buy at a station: one order per good it sells that the
 * ship can carry and afford. Each is sized for where the goods can go: what
 * a running contract elsewhere still needs, else the amount that still pays
 * at the best buyer the company knows (jump fees counted), else a full hold.
 * Selling or delivering them is the next order, given at that station.
 */
function buyOptions(state, view, stationId, free, at, timesOf) {
  const known = knownAt(state, stationId, at);
  const options = [];
  for (const entry of marketEntries(stationId)) {
    if (entry.side !== 'sells' || !canCarry(view, entry.good)) continue;
    const good = entry.good;
    const max = affordableQty(state, stationId, good, state.credits, free, known);
    if (max < 1) continue;
    // Getting to the station (jump fees included) comes before any of it.
    const there = timesOf({ type: 'buy', stationId, good, qty: max });
    const use = contractUse(state, view, stationId, good, max, there, at) ?? routeUse(state, view, stationId, good, max, there, at) ?? { qty: max };
    const cost = quote(state, stationId, good, use.qty, known).total;
    options.push({ kind: 'buy', stationId, good, cost, ...use, ...timesOf({ type: 'buy', stationId, good, qty: use.qty }) });
  }
  const rank = (option) => (option.contract ? 2 : option.destId ? 1 : 0);
  return options.sort((a, b) => rank(b) - rank(a) || (b.profit ?? 0) - (a.profit ?? 0));
}

/**
 * A running contract elsewhere that `good` bought at `fromId` could go to
 * in time, and what it still needs: { qty, contract, destId, completes,
 * reward }, or null.
 */
function contractUse(state, view, fromId, good, max, there, at) {
  let best = null;
  for (const contract of state.contracts.active) {
    if (contract.good !== good || contract.stationId === fromId || !contractFor(state, contract.stationId, good, at)) continue;
    const needed = stillNeeded(contract) - (view.delivered[contract.id] ?? 0);
    if (needed < 1) continue;
    const course = plotCourse(state, view, fromId, contract.stationId);
    if (!course.ok || (there.endsAt ?? view.time) + course.time > contract.deadline) continue;
    if (!best || needed > best.needed) best = { contract, needed };
  }
  if (!best) return null;
  const qty = Math.min(max, best.needed);
  return { qty, contract: best.contract, destId: best.contract.stationId, completes: qty >= best.needed, reward: best.contract.reward };
}

/** The best known buyer for `good` bought at `fromId`: { qty, destId, profit }, or null when none pays. */
function routeUse(state, view, fromId, good, max, there, at) {
  const route = bestRoute(state, view, good, fromId, max, at);
  if (!route) return null;
  const profit = route.profit - (there.fees ?? 0);
  return profit > 0 ? { qty: route.plan.qty, destId: route.destId, profit } : null;
}

/**
 * Orders at a warp gate (in the System view) or a whole system (on the
 * galaxy map): jump there, survey it (scouts), or fly to the gate itself.
 * A system with no way in gives no jump; the menu says why.
 */
function travelOptions(state, view, target, timesOf, gated) {
  const options = [];
  const gate = target.kind === 'gate' ? findGate(target.id) : null;
  const systemId = gate ? gate.to : target.id;
  const system = findSystem(systemId);
  if (!system) return options;
  const here = systemOf(view.at);
  if (canJump(state) && systemId !== here) {
    if (HULLS[view.hull].role === 'scout' && surveyable(state, systemId)) {
      options.push(gated({ kind: 'survey', systemId, ...timesOf({ type: 'survey', systemId }) }));
    }
    if (isSurveyed(state, systemId) && isShielded(state, system)) {
      const arrival = gate && systemOf(gate.id) === here ? gateTo(systemId, here)?.id : nearestGate(state, view, system);
      if (arrival) options.push(gated({ kind: 'jump', systemId, stationId: arrival, ...timesOf({ type: 'fly', stationId: arrival }) }));
    }
  }
  if (gate && view.at !== gate.id) options.push(gated({ kind: 'fly', stationId: gate.id, ...timesOf({ type: 'fly', stationId: gate.id }) }));
  return options;
}

/** The gate of `system` the ship reaches first, or null when none can be reached. */
function nearestGate(state, view, system) {
  let best = null;
  for (const gate of system.gates) {
    const time = travelTime(state, view, view.at, gate.id);
    if (time < (best?.time ?? Infinity)) best = { id: gate.id, time };
  }
  return best?.id ?? null;
}

// Orders that make sense for a whole group of ships at once, in menu order.
const GROUP_KINDS = ['mine', 'deliver', 'sell', 'buy', 'refit', 'jump', 'fly'];

// Buys and deliveries are merged per good, the rest per kind.
function groupKey(option) {
  if (option.kind === 'buy' || option.kind === 'deliver') return `${option.kind}:${option.good}`;
  return option.kind;
}

/** Ships delivering to one contract hand over no more than it still needs, in order. */
function shareDelivery(group) {
  let left = stillNeeded(group.contract);
  const members = [];
  for (const member of group.members) {
    const take = Math.min(member.option.qty, left);
    if (take < 1) break;
    members.push({ shipId: member.shipId, option: { ...member.option, qty: take } });
    left -= take;
  }
  return { ...group, members, qty: stillNeeded(group.contract) - left, completes: left < 1, reward: group.contract.reward };
}

/**
 * Haulers that buy the same good in the same place share the credits and
 * the stock, and every tonne bought raises the price of the next. This
 * works out how much the group can buy (for a contract: what it still
 * needs; for a buyer: what still pays), splits it over the ships in order,
 * and prices the whole lot.
 */
function sharePurchase(state, ships, group, at) {
  const { good, stationId } = group;
  const first = group.members[0].option;
  let wanted = group.members.reduce((sum, member) => sum + member.option.qty, 0);
  if (first.contract) wanted = Math.min(wanted, stillNeeded(first.contract));
  const known = knownAt(state, stationId, at);
  let qty = affordableQty(state, stationId, good, state.credits, wanted, known);
  const ship = ships.find((s) => s.id === group.members[0].shipId);
  if (!first.contract && first.destId) qty = bestTradeQty(state, ship, good, first.destId, qty, at, stationId).qty;
  const members = [];
  let left = qty;
  for (const member of group.members) {
    const take = Math.min(member.option.qty, left);
    if (take < 1) break;
    members.push({ shipId: member.shipId, option: { ...member.option, qty: take } });
    left -= take;
  }
  const cost = quote(state, stationId, good, qty, known).total;
  const use = { contract: first.contract ?? null, destId: first.destId ?? null };
  if (first.contract) return { ...group, ...use, members, qty, cost, completes: qty >= stillNeeded(first.contract), reward: first.contract.reward };
  if (!first.destId) return { ...group, ...use, members, qty, cost };
  // Each ship pays its own way there and on to the buyer.
  const plan = tradePlan(state, ship, good, qty, first.destId, at, stationId);
  const fees = members.reduce((sum, member) => sum + (member.option.fees ?? 0), 0) + plan.fees * members.length;
  return { ...group, ...use, members, qty, cost, profit: plan.sell.total - cost - fees };
}

/**
 * Orders for several selected ships at once, merged: the full-hold mine,
 * sell everything, refit and fly per kind, and haulers' buys and contract
 * deliveries per good. Each has `members` ([{ shipId, option }], the ships
 * that can take it, with their own option), `of` (how many ships were
 * asked), the summed `value` (mine), `total` (sell) or `cost` (refit), and
 * `disabled` with a `note` when no ship can take it. Buys have the group's
 * `qty` and `cost` (and `profit` for a buyer), with the amount split over
 * the members so that together they never buy more than the credits and
 * the stock allow.
 */
export function groupOrderOptions(state, ships, target, at = state.now) {
  const groups = new Map();
  for (const ship of ships) {
    for (const option of orderOptions(state, ship, target, at)) {
      if (!GROUP_KINDS.includes(option.kind)) continue;
      const key = groupKey(option);
      if (!groups.has(key)) {
        const { kind, good, stationId, systemId } = option;
        groups.set(key, { kind, good, stationId, systemId, members: [], notes: [], goods: new Set(), value: 0, total: 0, cost: 0, contract: null });
      }
      const group = groups.get(key);
      if (option.disabled) {
        group.notes.push(option.note);
        continue;
      }
      group.members.push({ shipId: ship.id, option });
      group.value += option.value ?? 0;
      group.total += option.total ?? 0;
      group.cost += option.cost ?? 0;
      group.contract ??= option.contract ?? null;
      for (const good of option.goods ?? []) group.goods.add(good);
    }
  }
  const merged = [...groups.values()].map(({ notes, goods, ...rest }) => {
    let group = { ...rest, goods: [...goods] };
    if (group.kind === 'buy' && group.members.length) group = sharePurchase(state, ships, group, at);
    if (group.kind === 'deliver' && group.members.length) group = shareDelivery(group);
    const disabled = group.members.length === 0;
    return { ...group, of: ships.length, disabled, note: disabled ? (notes[0] ?? null) : null };
  });
  // Buys for a contract first, then those for a buyer, best first.
  const rank = (option) => (option.contract ? 2 : option.destId ? 1 : 0);
  return GROUP_KINDS.flatMap((kind) => {
    const ofKind = merged.filter((option) => option.kind === kind);
    return kind === 'buy' ? ofKind.sort((a, b) => rank(b) - rank(a) || (b.profit ?? 0) - (a.profit ?? 0)) : ofKind;
  });
}

