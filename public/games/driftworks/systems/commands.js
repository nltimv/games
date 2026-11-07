// Carries out an option from the order menu (see advisor.orderOptions).
// Each option maps onto the same calls the panels use, so the menu and the
// panels can never disagree about what an order does. Every option is one
// order: buying and selling are two picks, each at its own station.

import { sellCargo } from './cargo.js';
import { deliverCargo } from './contracts.js';
import { findShip } from './fleet.js';
import { giveOrder, orderRefit } from './orders.js';

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
    case 'deliver':
      if (option.now) return deliverCargo(state, ship, option.good);
      return giveOrder(state, ship, { type: 'deliver', stationId: option.stationId, good: option.good });
    case 'buy':
      return giveOrder(state, ship, { type: 'buy', stationId: option.stationId, good: option.good, qty: option.qty });
    case 'refit':
      return orderRefit(state, ship, option.stationId);
    case 'fly':
    case 'jump':
      return giveOrder(state, ship, { type: 'fly', stationId: option.stationId });
    case 'survey':
      return giveOrder(state, ship, { type: 'survey', systemId: option.systemId });
    case 'investigate':
    case 'salvage':
      return giveOrder(state, ship, { type: option.kind, signalId: option.signalId });
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

