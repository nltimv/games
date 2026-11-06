// Read-only questions the UI asks before the player commits to something:
// who buys this, what would a trip bring in, what is the best trade. None of
// these change the state.

import { HULLS, TRIP_LENGTHS } from '../content/ships.js';
import { HOME_SYSTEM, findField } from '../content/homeSystem.js';
import { MINUTE } from '../core/time.js';
import { affordableQty, findEntry, marketView, quote } from './market.js';
import { canCarry, freeHold } from './cargo.js';
import { miningYield } from './orders.js';
import { travelTime } from './travel.js';

/** Stations that buy `good`, best price first, with their market view. */
export function buyersOf(state, good, at = state.now) {
  return HOME_SYSTEM.stations
    .filter((station) => findEntry(station.id, good)?.side === 'buys')
    .map((station) => ({ station, view: marketView(state, station.id, good, at) }))
    .sort((a, b) => b.view.price - a.view.price);
}

/** Where a docked ship could take `qty` of `good`, with the expected sale. */
export function deliveryOptions(state, ship, good, qty = ship.cargo[good] ?? 0, at = state.now) {
  if (!ship.at || qty <= 0) return [];
  return buyersOf(state, good, at)
    .filter(({ station }) => station.id !== ship.at)
    .map(({ station }) => ({
      stationId: station.id,
      sale: quote(state, station.id, good, Math.floor(qty), at),
      travel: travelTime(ship.hull, ship.at, station.id),
    }));
}

/** What selling a ship's whole stock of `good` where it is docked would pay. */
export function saleHere(state, ship, good, at = state.now) {
  if (!ship.at || findEntry(ship.at, good)?.side !== 'buys') return null;
  return quote(state, ship.at, good, Math.floor(ship.cargo[good] ?? 0), at);
}

/** One mining trip, previewed: amount, rough value, and return time. */
export function tripPreview(state, ship, fieldId, minutes, at = state.now) {
  const field = findField(fieldId);
  const amount = miningYield(ship, fieldId, minutes);
  let value = 0;
  if (amount > 0 && field) {
    const home = ship.at && findEntry(ship.at, field.good)?.side === 'buys' ? ship.at : buyersOf(state, field.good, at)[0]?.station.id;
    if (home) value = quote(state, home, field.good, amount, at).total;
  }
  return { minutes, amount, value, endsAt: at + minutes * MINUTE };
}

export function tripPreviews(state, ship, fieldId, at = state.now) {
  return TRIP_LENGTHS.map((trip) => tripPreview(state, ship, fieldId, trip.minutes, at));
}

/** The most a docked hauler can buy of `good` here: hold, credits and stock. */
export function maxPurchase(state, ship, good, at = state.now) {
  if (!ship.at || HULLS[ship.hull].role !== 'hauler' || !canCarry(ship, good)) return 0;
  const entry = findEntry(ship.at, good);
  if (!entry || entry.side !== 'sells') return 0;
  return affordableQty(state, ship.at, good, state.credits, freeHold(ship), at);
}

/** Buy `qty` here and sell it at `destId`: the expected money and time. */
export function tradePlan(state, ship, good, qty, destId, at = state.now) {
  const buys = findEntry(destId, good)?.side === 'buys';
  const buy = quote(state, ship.at, good, qty, at);
  // quote() prices either side, so only count a sale where the station buys.
  const sell = buys ? quote(state, destId, good, buy.qty, at) : { qty: 0, total: 0, average: 0 };
  return {
    qty: buy.qty,
    buy,
    sell,
    profit: sell.total - buy.total,
    travel: travelTime(ship.hull, ship.at, destId),
  };
}

/**
 * The quantity with the best expected profit for a trade. Buying more
 * raises the buy price and lowers the sell price, so past some point each
 * extra tonne loses money.
 */
export function bestTradeQty(state, ship, good, destId, maxQty, at = state.now) {
  let best = { qty: 0, profit: 0 };
  const step = Math.max(1, Math.round(maxQty / 40));
  for (let qty = step; qty <= maxQty + step - 1; qty += step) {
    const q = Math.min(qty, maxQty);
    const plan = tradePlan(state, ship, good, q, destId, at);
    if (plan.profit > best.profit) best = { qty: plan.qty, profit: plan.profit };
  }
  return best;
}

