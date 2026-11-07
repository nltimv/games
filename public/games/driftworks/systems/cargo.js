// Ship holds: how much is aboard, what a hold may carry, and buying and
// selling while docked.

import { GOODS, goodName } from '../content/goods.js';
import { HOLD_CLASS_MAX_TIER, HULLS } from '../content/ships.js';
import { findStation, systemOf } from '../content/galaxy.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { affordableQty, buyFromStation, findEntry, sellToStation } from './market.js';
import { holdOf } from './modules.js';
import { addLog } from './log.js';
import { earnStanding } from './standing.js';

export function cargoTotal(ship) {
  return Object.values(ship.cargo).reduce((sum, qty) => sum + qty, 0);
}

export function freeHold(ship) {
  return Math.max(0, holdOf(ship) - cargoTotal(ship));
}

export function canCarry(ship, good) {
  return GOODS[good].tier <= HOLD_CLASS_MAX_TIER[HULLS[ship.hull].holdClass];
}

/** Takes `qty` of a good out of a hold. Returns what that part cost to buy. */
export function removeCargo(ship, good, qty) {
  const held = ship.cargo[good] ?? 0;
  const basis = ship.costBasis[good] ?? 0;
  const share = held > 0 ? basis * (qty / held) : 0;
  const left = held - qty;
  if (left <= 1e-9) {
    delete ship.cargo[good];
    delete ship.costBasis[good];
  } else {
    ship.cargo[good] = left;
    ship.costBasis[good] = basis - share;
  }
  return share;
}

/**
 * Sells up to `qty` (default: all) of a good from a docked ship to the
 * station it is docked at. Returns { ok, qty, total, profit } or an error.
 */
export function sellCargo(state, ship, good, qty = Infinity, at = state.now) {
  const stationId = ship.at;
  if (!stationId) return { ok: false, error: `${ship.name} is not docked.` };
  const entry = findEntry(stationId, good);
  if (!entry || entry.side !== 'buys') {
    return { ok: false, error: `${findStation(stationId).name} does not buy ${goodName(good).toLowerCase()}.` };
  }
  const held = ship.cargo[good] ?? 0;
  const amount = Math.min(held, qty);
  if (amount <= 0) return { ok: false, error: `${ship.name} has no ${goodName(good).toLowerCase()} aboard.` };

  const sale = sellToStation(state, stationId, good, Math.floor(amount), at);
  if (sale.qty <= 0) return { ok: false, error: `${findStation(stationId).name} has no room for more.` };

  const total = sale.total;
  const basis = removeCargo(ship, good, sale.qty);
  const profit = total - basis;
  state.credits += total;
  state.stats.sales += 1;
  if (systemOf(stationId) !== HOME_SYSTEM.id) state.stats.farSales = (state.stats.farSales ?? 0) + 1;
  earnStanding(state, stationId, total, at);
  // "Earned" counts what the company made: for traded goods that is the
  // profit, not the whole sale, so buying and reselling does not inflate it.
  state.stats.earned += Math.max(0, profit);
  if (GOODS[good].tier === 1) state.stats.oreSold += sale.qty;
  if (HULLS[ship.hull].role === 'hauler') state.stats.tradeProfit += profit;

  const notes = [];
  if (HULLS[ship.hull].role === 'hauler') notes.push(`profit ${formatCredits(profit)}`);
  addLog(
    state,
    at,
    `${ship.name} sold ${formatNumber(sale.qty)} t ${goodName(good).toLowerCase()} at ${findStation(stationId).name}: +${formatCredits(total)}${notes.length ? ` (${notes.join(', ')})` : ''}`,
    'sale',
    total,
  );
  return { ok: true, qty: sale.qty, total, profit };
}

/** Buys up to `qty` of a good for a docked hauler, limited by hold and credits. */
export function buyCargo(state, ship, good, qty, at = state.now) {
  const stationId = ship.at;
  if (!stationId) return { ok: false, error: `${ship.name} is not docked.` };
  if (HULLS[ship.hull].role !== 'hauler') return { ok: false, error: 'Only haulers can buy goods.' };
  const entry = findEntry(stationId, good);
  if (!entry || entry.side !== 'sells') {
    return { ok: false, error: `${findStation(stationId).name} does not sell ${goodName(good).toLowerCase()}.` };
  }
  if (!canCarry(ship, good)) return { ok: false, error: `${goodName(good)} needs a better hold.` };

  const limit = Math.min(qty, freeHold(ship));
  const amount = affordableQty(state, stationId, good, state.credits, limit, at);
  if (amount <= 0) {
    if (freeHold(ship) <= 0) return { ok: false, error: `${ship.name}'s hold is full.` };
    return { ok: false, error: 'Not enough credits or stock.' };
  }

  const purchase = buyFromStation(state, stationId, good, amount, at);
  state.credits -= purchase.total;
  earnStanding(state, stationId, purchase.total, at);
  ship.cargo[good] = (ship.cargo[good] ?? 0) + purchase.qty;
  ship.costBasis[good] = (ship.costBasis[good] ?? 0) + purchase.total;
  addLog(
    state,
    at,
    `${ship.name} bought ${formatNumber(purchase.qty)} t ${goodName(good).toLowerCase()} at ${findStation(stationId).name}: −${formatCredits(purchase.total)}`,
    'trade',
    -purchase.total,
  );
  return { ok: true, qty: purchase.qty, total: purchase.total };
}
