// Read-only questions the UI asks before the player commits to something:
// who buys this, what would a hold of ore bring in, what is the best trade.
// None of these change the state.

import { HULLS } from '../content/ships.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { affordableQty, findEntry, marketEntries, marketView, quote } from './market.js';
import { canCarry, cargoTotal, freeHold } from './cargo.js';
import { contractBonus } from './contracts.js';
import { holdOf } from './modules.js';
import { buildOrder, freeSlots, orderTimes, projectShip, refitOffer, SHIPYARD_ID } from './orders.js';
import { travelTime } from './travel.js';

/** What selling `qty` of `good` at a station pays, contract premium included. */
export function saleValue(state, stationId, good, qty, at = state.now) {
  if (findEntry(stationId, good)?.side !== 'buys' || qty <= 0) return { qty: 0, total: 0, average: 0, bonus: 0 };
  const sale = quote(state, stationId, good, Math.floor(qty), at);
  const bonus = contractBonus(state, stationId, good, sale.qty, sale.average, at);
  return { ...sale, total: sale.total + bonus, bonus };
}

/** Stations that buy `good`, best price first, with their market view. */
export function buyersOf(state, good, at = state.now) {
  return HOME_SYSTEM.stations
    .filter((station) => findEntry(station.id, good)?.side === 'buys')
    .map((station) => ({ station, view: marketView(state, station.id, good, at) }))
    .sort((a, b) => b.view.price - a.view.price);
}

/** The best place to sell `qty` of `good`, by total paid. */
export function bestBuyer(state, good, qty, at = state.now) {
  let best = null;
  for (const { station } of buyersOf(state, good, at)) {
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
      travel: travelTime(ship, ship.at, station.id),
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
  const best = bestBuyer(state, step.good, step.amount, at);
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

/** Buy `qty` at `fromId` and sell it at `destId`: the expected money and time. */
export function tradePlan(state, ship, good, qty, destId, at = state.now, fromId = ship.at) {
  const buy = quote(state, fromId, good, qty, at);
  const sell = saleValue(state, destId, good, buy.qty, at);
  return {
    qty: buy.qty,
    buy,
    sell,
    profit: sell.total - buy.total,
    travel: travelTime(ship, fromId, destId),
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
 *   sell         { stationId, total, endsAt, now }               `now`: sells on the spot
 *   buy          { stationId, good, qty, cost, endsAt }          haulers
 *   trade        { fromId, stationId, good, qty, cost, profit }  haulers: buy where it
 *                                                                is, sell here
 *   refit        { cost, modules, endsAt }                       at the shipyard
 *   fly          { stationId, endsAt }
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
    return built.ok ? { endsAt: built.order.endsAt, ...orderTimes(built.order) } : { endsAt: null };
  };

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
    const blocked = now ? null : slotNote(free, 1);
    options.push({ kind: 'sell', stationId, goods, total, ...(now ? { endsAt: at } : timesOf({ type: 'sell', stationId })), now, queued, disabled: Boolean(blocked), note: blocked });
  }

  if (role === 'hauler') {
    const viewFree = Math.max(0, holdOf(view) - cargoTotal(view));
    // Buy where it is (or will be) and bring it here.
    if (view.at && view.at !== stationId) {
      const trades = [];
      for (const entry of marketEntries(view.at)) {
        if (entry.side !== 'sells' || findEntry(stationId, entry.good)?.side !== 'buys' || !canCarry(view, entry.good)) continue;
        const max = affordableQty(state, view.at, entry.good, state.credits, viewFree, at);
        if (max <= 0) continue;
        const best = bestTradeQty(state, view, entry.good, stationId, max, at, view.at);
        if (best.qty <= 0 || best.profit <= 0) continue;
        const plan = tradePlan(state, view, entry.good, best.qty, stationId, at, view.at);
        trades.push({ kind: 'trade', fromId: view.at, stationId, good: entry.good, qty: plan.qty, cost: plan.buy.total, profit: plan.profit, queued });
      }
      trades.sort((a, b) => b.profit - a.profit);
      for (const trade of trades.slice(0, MAX_TRADES)) {
        const blocked = slotNote(free, 2);
        options.push({ ...trade, disabled: Boolean(blocked), note: blocked });
      }
    }
    // Buy here, to sell somewhere else later.
    const buys = [];
    for (const entry of marketEntries(stationId)) {
      if (entry.side !== 'sells' || !canCarry(view, entry.good)) continue;
      const qty = affordableQty(state, stationId, entry.good, state.credits, viewFree, at);
      if (qty < 1) continue;
      const cost = quote(state, stationId, entry.good, qty, at).total;
      const resale = bestBuyer(state, entry.good, qty, at);
      const margin = (resale?.sale.total ?? 0) - cost;
      buys.push({ kind: 'buy', stationId, good: entry.good, qty, cost, margin, ...timesOf({ type: 'buy', stationId, good: entry.good, qty }), queued });
    }
    buys.sort((a, b) => b.margin - a.margin);
    for (const buy of buys.slice(0, MAX_TRADES)) {
      const blocked = slotNote(free, 1);
      options.push({ ...buy, disabled: Boolean(blocked), note: blocked });
    }
  }

  if (stationId === SHIPYARD_ID) {
    const offer = refitOffer(state, ship);
    if (offer) {
      const blocked = slotNote(free, 1) ?? (state.credits < offer.cost ? 'Not enough credits' : null);
      options.push({ kind: 'refit', cost: offer.cost, modules: offer.modules, ...timesOf({ type: 'refit', modules: offer.modules }), queued, disabled: Boolean(blocked), note: blocked });
    }
  }

  if (view.at !== stationId) {
    const blocked = slotNote(free, 1);
    options.push({ kind: 'fly', stationId, ...timesOf({ type: 'fly', stationId }), queued, disabled: Boolean(blocked), note: blocked });
  }
  return options;
}

// Orders that make sense for a whole group of ships at once.
const GROUP_KINDS = ['mine', 'sell', 'refit', 'fly'];

/**
 * Orders for several selected ships at once, merged by kind: the full-hold
 * mine, sell everything, refit and fly. Each has `members`
 * ([{ shipId, option }], the ships that can take it, with their own
 * option), `of` (how many ships were asked), the summed `value` (mine),
 * `total` (sell) or `cost` (refit), and `disabled` with a `note` when no
 * ship can take it.
 */
export function groupOrderOptions(state, ships, target, at = state.now) {
  const groups = new Map();
  for (const ship of ships) {
    for (const option of orderOptions(state, ship, target, at)) {
      if (!GROUP_KINDS.includes(option.kind)) continue;
      if (!groups.has(option.kind)) groups.set(option.kind, { kind: option.kind, members: [], notes: [], goods: new Set(), value: 0, total: 0, cost: 0 });
      const group = groups.get(option.kind);
      if (option.disabled) {
        group.notes.push(option.note);
        continue;
      }
      group.members.push({ shipId: ship.id, option });
      group.value += option.value ?? 0;
      group.total += option.total ?? 0;
      group.cost += option.cost ?? 0;
      for (const good of option.goods ?? []) group.goods.add(good);
    }
  }
  return GROUP_KINDS.filter((kind) => groups.has(kind)).map((kind) => {
    const { notes, goods, ...group } = groups.get(kind);
    const disabled = group.members.length === 0;
    return { ...group, goods: [...goods], of: ships.length, disabled, note: disabled ? (notes[0] ?? null) : null };
  });
}

