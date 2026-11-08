// Station markets.
//
// Each station good has a stock level. Prices are a straight line in how
// full the station is (see content/stations.js). Stock drifts back toward a
// target with exponential decay, evaluated lazily from the time it was last
// touched, so markets cost nothing to simulate while nobody looks at them.

import { GOODS } from '../content/goods.js';
import { CURVES, STATION_TYPES, TIER_STORAGE } from '../content/stations.js';
import { findStation } from '../content/galaxy.js';
import { seededUnit } from '../core/rng.js';
import { MINUTE } from '../core/time.js';
import { priceFactor } from './standing.js';

/** Time constant of the drift back to target: ~86% recovered after 3 h. */
export const RECOVERY_TAU = 90 * MINUTE;

// Curves with storage scaled for each tier, made once.
const scaled = new Map();
function curveFor(name, good) {
  const share = TIER_STORAGE[GOODS[good].tier] ?? 1;
  const key = `${name}:${share}`;
  if (!scaled.has(key)) scaled.set(key, { ...CURVES[name], cap: CURVES[name].cap * share });
  return scaled.get(key);
}

// Each station's entries, made once per station (a galaxy's stations never change).
const entriesOf = new WeakMap();

/** The goods a station trades, as { good, side, curve } entries. */
export function marketEntries(stationId) {
  const station = findStation(stationId);
  if (!station) return [];
  let cached = entriesOf.get(station);
  if (!cached) {
    const type = STATION_TYPES[station.type];
    const entries = [];
    // Generated stations list their own goods; Aurel's use their type's.
    for (const good of station.buys ?? type.buys) entries.push({ good, side: 'buys', curve: curveFor(type.buyCurve, good) });
    for (const good of station.sells ?? type.sells) entries.push({ good, side: 'sells', curve: curveFor(type.sellCurve, good) });
    cached = { entries, byGood: new Map(entries.map((e) => [e.good, e])) };
    entriesOf.set(station, cached);
  }
  return cached.entries;
}

export function findEntry(stationId, good) {
  marketEntries(stationId);
  return entriesOf.get(findStation(stationId))?.byGood.get(good) ?? null;
}

/** Each save's targets differ by up to ±10% so markets are not identical. */
function targetStock(state, stationId, entry) {
  const jitter = (seededUnit(state.seed, `${stationId}:${entry.good}`) - 0.5) * 0.2;
  return entry.curve.cap * Math.min(0.95, Math.max(0.05, entry.curve.target + jitter));
}

function record(state, stationId, entry) {
  state.markets[stationId] ??= {};
  const goods = state.markets[stationId];
  goods[entry.good] ??= { stock: targetStock(state, stationId, entry), at: state.createdAt };
  return goods[entry.good];
}

/** Stock at time `at`, without changing anything. */
export function stockAt(state, stationId, good, at = state.now) {
  const entry = findEntry(stationId, good);
  if (!entry) return 0;
  const target = targetStock(state, stationId, entry);
  const rec = state.markets[stationId]?.[good];
  if (!rec) return target;
  const dt = Math.max(0, at - rec.at);
  return target + (rec.stock - target) * Math.exp(-dt / RECOVERY_TAU);
}

/** Brings a record up to time `at` before a trade changes it. */
function settle(state, stationId, entry, at) {
  const rec = record(state, stationId, entry);
  rec.stock = stockAt(state, stationId, entry.good, at);
  rec.at = Math.max(rec.at, at);
  return rec;
}

function priceAtFill(entry, fill) {
  const base = GOODS[entry.good].value;
  const clamped = Math.min(1, Math.max(0, fill));
  return base * (entry.curve.high - (entry.curve.high - entry.curve.low) * clamped);
}

/**
 * What a station currently offers for a good, from the player's side:
 * side 'buys' means the player can sell to it, 'sells' that the player can
 * buy from it. `room` is how much it can take (for sales) or has (for buys).
 */
export function marketView(state, stationId, good, at = state.now) {
  const entry = findEntry(stationId, good);
  if (!entry) return null;
  const stock = stockAt(state, stationId, good, at);
  const fill = stock / entry.curve.cap;
  const target = targetStock(state, stationId, entry);
  return {
    good,
    side: entry.side,
    price: priceAtFill(entry, fill) * priceFactor(state, stationId, good, entry.side),
    stock,
    fill,
    cap: entry.curve.cap,
    // Positive when the station wants more than usual (buy side) or has
    // more than usual (sell side): what the trend arrow shows.
    pressure: entry.side === 'buys' ? (target - stock) / entry.curve.cap : (stock - target) / entry.curve.cap,
    room: entry.side === 'buys' ? Math.max(0, entry.curve.cap - stock) : Math.max(0, stock),
  };
}

/**
 * Prices a trade of `qty` tonnes without doing it. The price moves along the
 * line as the trade fills or empties the station, so the average price is
 * the price at the midpoint.
 */
export function quote(state, stationId, good, qty, at = state.now) {
  const entry = findEntry(stationId, good);
  if (!entry || qty <= 0) return { qty: 0, total: 0, average: 0 };
  const stock = stockAt(state, stationId, good, at);
  const room = entry.side === 'buys' ? entry.curve.cap - stock : stock;
  const amount = Math.max(0, Math.min(qty, Math.floor(room)));
  if (amount <= 0) return { qty: 0, total: 0, average: 0 };
  const end = entry.side === 'buys' ? stock + amount : stock - amount;
  const average = priceAtFill(entry, (stock + end) / 2 / entry.curve.cap) * priceFactor(state, stationId, good, entry.side);
  return { qty: amount, total: average * amount, average };
}

/** The player sells to a station that buys this good. Returns credits earned. */
export function sellToStation(state, stationId, good, qty, at = state.now) {
  const entry = findEntry(stationId, good);
  if (!entry || entry.side !== 'buys') return { qty: 0, total: 0, average: 0 };
  const q = quote(state, stationId, good, qty, at);
  if (q.qty > 0) {
    const rec = settle(state, stationId, entry, at);
    rec.stock += q.qty;
  }
  return q;
}

/** The player buys from a station that sells this good. Returns the cost. */
export function buyFromStation(state, stationId, good, qty, at = state.now) {
  const entry = findEntry(stationId, good);
  if (!entry || entry.side !== 'sells') return { qty: 0, total: 0, average: 0 };
  const q = quote(state, stationId, good, qty, at);
  if (q.qty > 0) {
    const rec = settle(state, stationId, entry, at);
    rec.stock -= q.qty;
  }
  return q;
}

/** The largest amount the player can buy with `credits`, by bisection. */
export function affordableQty(state, stationId, good, credits, limit, at = state.now) {
  let lo = 0;
  let hi = Math.floor(limit);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const q = quote(state, stationId, good, mid, at);
    if (q.qty === mid && q.total <= credits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
