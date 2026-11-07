// Carries out an option from the order menu (see advisor.orderOptions).
// Each option maps onto the same calls the panels use, so the menu and the
// panels can never disagree about what an order does.

import { sellCargo } from './cargo.js';
import { findShip } from './fleet.js';
import { giveOrder, giveOrders, orderRefit } from './orders.js';

const fail = (error) => ({ ok: false, error });

/** Sells everything a docked, idle ship carries that its station buys. */
export function sellAllHere(state, ship, goods) {
  let total = 0;
  let error = null;
  for (const good of goods) {
    const result = sellCargo(state, ship, good);
    if (result.ok) total += result.total;
    else error ??= result.error;
  }
  return total > 0 ? { ok: true, total } : fail(error ?? 'Nothing to sell here.');
}

/** Returns { ok, ... } or { ok: false, error }, like the calls it wraps. */
export function carryOut(state, shipId, option) {
  const ship = findShip(state, shipId);
  if (!ship) return fail('No such ship.');
  switch (option?.kind) {
    case 'mine':
      return giveOrder(state, ship, { type: 'mine', fieldId: option.fieldId, amount: option.amount ?? null });
    case 'sell':
      if (option.now) return sellAllHere(state, ship, option.goods);
      return giveOrder(state, ship, { type: 'sell', stationId: option.stationId });
    case 'buy':
      return giveOrder(state, ship, { type: 'buy', stationId: option.stationId, good: option.good, qty: option.qty });
    case 'trade':
      return giveOrders(state, ship, [
        { type: 'buy', stationId: option.fromId, good: option.good, qty: option.qty },
        { type: 'sell', stationId: option.stationId, good: option.good },
      ]);
    case 'refit':
      return orderRefit(state, ship);
    case 'fly':
      return giveOrder(state, ship, { type: 'fly', stationId: option.stationId });
    default:
      return fail('Unknown order.');
  }
}

/**
 * Gives a group option (see advisor.groupOrderOptions) to each of its ships.
 * Returns { ok, count, error } where `error` is the first ship that failed.
 */
export function carryOutGroup(state, option) {
  let count = 0;
  let error = null;
  for (const { shipId, option: own } of option?.members ?? []) {
    const result = carryOut(state, shipId, own);
    if (result.ok) count += 1;
    else error ??= `${findShip(state, shipId)?.name ?? 'A ship'}: ${result.error}`;
  }
  return count ? { ok: true, count, error } : fail(error ?? 'No ship could take that order.');
}

