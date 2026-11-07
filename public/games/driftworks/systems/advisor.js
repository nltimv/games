// Read-only questions the UI asks before the player commits to something:
// who buys this, what would a hold of ore bring in, what is the best trade.
// None of these change the state.

import { HULLS } from '../content/ships.js';
import { findGate, findStation, findSystem, gateTo, systemOf } from '../content/galaxy.js';
import { affordableQty, findEntry, marketEntries, marketView, quote } from './market.js';
import { canCarry, cargoTotal, freeHold } from './cargo.js';
import { contractBonus, contractForSale } from './contracts.js';
import { holdOf } from './modules.js';
import { buildOrder, freeSlots, orderTimes, projectShip, refitOffer } from './orders.js';
import { isSurveyed, knownStations, surveyable } from './explore.js';
import { knownAt } from './knowledge.js';
import { canJump, plotCourse, travelTime } from './travel.js';

/** What selling `qty` of `good` at a station pays, contract premium included. */
export function saleValue(state, stationId, good, qty, at = state.now) {
  if (findEntry(stationId, good)?.side !== 'buys' || qty <= 0) return { qty: 0, total: 0, average: 0, bonus: 0 };
  const sale = quote(state, stationId, good, Math.floor(qty), knownAt(state, stationId, at));
  const bonus = contractBonus(state, stationId, good, sale.qty, sale.average, at);
  return { ...sale, total: sale.total + bonus, bonus };
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
export function tradePlan(state, ship, good, qty, destId, at = state.now, fromId = ship.at) {
  const buy = quote(state, fromId, good, qty, knownAt(state, fromId, at));
  const sell = saleValue(state, destId, good, buy.qty, at);
  const course = plotCourse(state, ship, fromId, destId);
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
  const step = Math.max(1, Math.round(maxQty / 40));
  for (let qty = step; qty <= maxQty + step - 1; qty += step) {
    const q = Math.min(qty, maxQty);
    const plan = tradePlan(state, ship, good, q, destId, at, fromId);
    if (plan.profit > best.profit) best = { qty: plan.qty, profit: plan.profit };
  }
  return best;
}

const MAX_TRADES = 3;

function slotNote(free, needed) {
  return free >= needed ? null : 'Orders full';
}

/**
 * What `ship` could do at a map target ({ kind, id }), for the order menu.
 * A busy ship's options queue after its current orders, so they are
 * worked out from where it will be then. Each option has a `kind`:
 *   mine         { fieldId, amount: null, qty, value, endsAt }   a full hold
 *   mine-amount  { fieldId, max }                                opens the slider
 *   sell         { stationId, total, endsAt, now, contract }     `now`: sells on the spot;
 *                                                                `contract`: the one it counts towards
 *   buy          { stationId, good, qty, cost, endsAt }          haulers
 *   trade        { fromId, stationId, good, qty, cost, profit,   haulers: buy where it
 *                  contract }
 *                                                                is, sell here
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

  // Sell what it carries (or will carry).
  const goods = Object.keys(view.cargo).filter((g) => view.cargo[g] > 0 && findEntry(stationId, g)?.side === 'buys');
  if (goods.length) {
    const total = goods.reduce((sum, g) => sum + saleValue(state, stationId, g, view.cargo[g], at).total, 0);
    const now = !queued && ship.at === stationId;
    const times = now ? { endsAt: at } : timesOf({ type: 'sell', stationId });
    const contract = contractForSale(state, stationId, goods, times.endsAt ?? at);
    const option = { kind: 'sell', stationId, goods, total, ...times, now, contract };
    options.push(now ? { ...option, queued, disabled: false, note: null } : gated(option));
  }

  if (role === 'hauler') {
    const viewFree = Math.max(0, holdOf(view) - cargoTotal(view));
    // Buy where it is (or will be) and bring it here.
    if (view.at && view.at !== stationId && plotCourse(state, view, view.at, stationId).ok) {
      const trades = [];
      for (const entry of marketEntries(view.at)) {
        if (entry.side !== 'sells' || findEntry(stationId, entry.good)?.side !== 'buys' || !canCarry(view, entry.good)) continue;
        const max = affordableQty(state, view.at, entry.good, state.credits, viewFree, knownAt(state, view.at, at));
        if (max <= 0) continue;
        const best = bestTradeQty(state, view, entry.good, stationId, max, at, view.at);
        if (best.qty <= 0 || best.profit <= 0) continue;
        const plan = tradePlan(state, view, entry.good, best.qty, stationId, at, view.at);
        const contract = contractForSale(state, stationId, [entry.good], at);
        trades.push({ kind: 'trade', fromId: view.at, stationId, good: entry.good, qty: plan.qty, cost: plan.buy.total, profit: plan.profit, fees: plan.fees, jumps: plan.jumps, contract });
      }
      trades.sort((a, b) => b.profit - a.profit);
      for (const trade of trades.slice(0, MAX_TRADES)) options.push(gated(trade, 2));
    }
    // Buy here, to sell somewhere else later.
    const buys = [];
    for (const entry of marketEntries(stationId)) {
      if (entry.side !== 'sells' || !canCarry(view, entry.good)) continue;
      const known = knownAt(state, stationId, at);
      const qty = affordableQty(state, stationId, entry.good, state.credits, viewFree, known);
      if (qty < 1) continue;
      const cost = quote(state, stationId, entry.good, qty, known).total;
      const resale = bestBuyer(state, entry.good, qty, at);
      const margin = (resale?.sale.total ?? 0) - cost;
      buys.push({ kind: 'buy', stationId, good: entry.good, qty, cost, margin, ...timesOf({ type: 'buy', stationId, good: entry.good, qty }) });
    }
    buys.sort((a, b) => b.margin - a.margin);
    for (const buy of buys.slice(0, MAX_TRADES)) options.push(gated(buy));
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
    if (isSurveyed(state, systemId) && !system.hazard) {
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
const GROUP_KINDS = ['mine', 'sell', 'trade', 'buy', 'refit', 'jump', 'fly'];

// Buys are merged per good, trades per good and place to buy, the rest per kind.
function groupKey(option) {
  if (option.kind === 'buy') return `buy:${option.good}`;
  if (option.kind === 'trade') return `trade:${option.fromId}:${option.good}`;
  return option.kind;
}

/**
 * Haulers that buy the same good in the same place share the credits and
 * the stock, and every tonne bought raises the price of the next. This
 * works out how much the group can buy (for a trade: how much still pays),
 * splits it over the ships in order, and prices the whole lot.
 */
function sharePurchase(state, ships, group, at) {
  const { kind, good, stationId } = group;
  const source = kind === 'trade' ? group.fromId : stationId;
  const wanted = group.members.reduce((sum, member) => sum + member.option.qty, 0);
  const known = knownAt(state, source, at);
  let qty = affordableQty(state, source, good, state.credits, wanted, known);
  if (kind === 'trade') {
    const ship = ships.find((s) => s.id === group.members[0]?.shipId);
    qty = ship ? bestTradeQty(state, ship, good, stationId, qty, at, source).qty : 0;
  }
  const members = [];
  let left = qty;
  for (const member of group.members) {
    const take = Math.min(member.option.qty, left);
    if (take < 1) break;
    members.push({ shipId: member.shipId, option: { ...member.option, qty: take } });
    left -= take;
  }
  const cost = quote(state, source, good, qty, known).total;
  if (kind === 'buy') {
    const resale = bestBuyer(state, good, qty, at);
    return { ...group, members, qty, cost, margin: (resale?.sale.total ?? 0) - cost };
  }
  const sale = saleValue(state, stationId, good, qty, at);
  const fees = members.reduce((sum, member) => sum + (member.option.fees ?? 0), 0);
  return { ...group, members, qty, cost, profit: sale.total - cost - fees, contract: contractForSale(state, stationId, [good], at) };
}

/**
 * Orders for several selected ships at once, merged: the full-hold mine,
 * sell everything, refit and fly per kind, and haulers' buys and trades
 * per good. Each has `members` ([{ shipId, option }], the ships that can
 * take it, with their own option), `of` (how many ships were asked), the
 * summed `value` (mine), `total` (sell) or `cost` (refit), and `disabled`
 * with a `note` when no ship can take it. Buys and trades have the
 * group's `qty`, `cost` and `margin` or `profit`, with the amount split
 * over the members so that together they never buy more than the credits
 * and the stock allow.
 */
export function groupOrderOptions(state, ships, target, at = state.now) {
  const groups = new Map();
  for (const ship of ships) {
    for (const option of orderOptions(state, ship, target, at)) {
      if (!GROUP_KINDS.includes(option.kind)) continue;
      const key = groupKey(option);
      if (!groups.has(key)) {
        const { kind, good, fromId, stationId, systemId } = option;
        groups.set(key, { kind, good, fromId, stationId, systemId, members: [], notes: [], goods: new Set(), value: 0, total: 0, cost: 0, contract: null });
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
    if ((group.kind === 'buy' || group.kind === 'trade') && group.members.length) group = sharePurchase(state, ships, group, at);
    const disabled = group.members.length === 0;
    return { ...group, of: ships.length, disabled, note: disabled ? (notes[0] ?? null) : null };
  });
  // Best buys and trades first, and only the best few, as for one ship.
  const worth = (option) => option.profit ?? option.margin ?? 0;
  return GROUP_KINDS.flatMap((kind) => {
    const ofKind = merged.filter((option) => option.kind === kind);
    if (kind !== 'buy' && kind !== 'trade') return ofKind;
    return ofKind.sort((a, b) => worth(b) - worth(a)).slice(0, MAX_TRADES);
  });
}

