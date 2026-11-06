// Carries out an option from the order menu (see advisor.orderOptions).
// Each option maps onto the same calls the panels use, so the menu and the
// panels can never disagree about what an order does.

import { buyCargo, sellCargo } from './cargo.js';
import { findShip } from './fleet.js';
import { giveOrder } from './orders.js';

const fail = (error) => ({ ok: false, error });

/** Returns { ok } or { ok: false, error }, like the calls it wraps. */
export function carryOut(state, shipId, option) {
  const ship = findShip(state, shipId);
  if (!ship) return fail('No such ship.');
  switch (option?.kind) {
    case 'mine':
      return giveOrder(state, ship, { type: 'mine', fieldId: option.fieldId, minutes: option.minutes });
    case 'sell':
      return sellCargo(state, ship, option.good);
    case 'deliver':
      return giveOrder(state, ship, { type: 'move', stationId: option.stationId, sell: option.good });
    case 'trade': {
      const bought = buyCargo(state, ship, option.good, option.qty);
      if (!bought.ok) return bought;
      return giveOrder(state, ship, { type: 'move', stationId: option.stationId, sell: option.good });
    }
    case 'fly':
      return giveOrder(state, ship, { type: 'move', stationId: option.stationId });
    default:
      return fail('Unknown order.');
  }
}
