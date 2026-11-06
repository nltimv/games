// Buying ships and naming them.
//
// Faction shipyards charge a licence fee that grows with each ship of the
// same hull you already own, so a fleet grows steadily instead of
// exponentially. (Owning a shipyard later removes the fee.)

import { HULLS } from '../content/ships.js';
import { STATION_TYPES } from '../content/stations.js';
import { findStation } from '../content/homeSystem.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';

export function createShip(state, hullId, stationId) {
  const hull = HULLS[hullId];
  const taken = new Set(state.ships.map((s) => s.name));
  let n = state.ships.filter((s) => s.hull === hullId).length + 1;
  while (taken.has(`${hull.namePrefix}-${n}`)) n += 1;
  const ship = {
    id: `ship-${state.nextShipId}`,
    name: `${hull.namePrefix}-${n}`,
    hull: hullId,
    at: stationId,
    cargo: {},
    costBasis: {},
    order: null,
    queue: [],
  };
  state.nextShipId += 1;
  state.ships.push(ship);
  return ship;
}

/** Each ship of a hull you own adds this share of the base price. */
export const LICENCE_STEP = 0.5;

/** What the next ship of `hullId` costs this company. */
export function hullPrice(state, hullId) {
  const hull = HULLS[hullId];
  const owned = state.ships.filter((s) => s.hull === hullId).length;
  return Math.round((hull.price * (1 + LICENCE_STEP * owned)) / 50) * 50;
}

export function hullsForSale(stationId) {
  const station = findStation(stationId);
  if (!station) return [];
  return STATION_TYPES[station.type].hulls ?? [];
}

export function buyShip(state, hullId, stationId) {
  const hull = HULLS[hullId];
  if (!hull || !hullsForSale(stationId).includes(hullId)) {
    return { ok: false, error: 'That ship is not sold here.' };
  }
  const price = hullPrice(state, hullId);
  if (state.credits < price) {
    return { ok: false, error: `You need ${formatCredits(price - state.credits)} more.` };
  }
  state.credits -= price;
  const ship = createShip(state, hullId, stationId);
  addLog(state, state.now, `Bought ${ship.name}, a ${hull.name.toLowerCase()}, for ${formatCredits(price)}`, 'purchase', -price);
  return { ok: true, ship };
}

export function findShip(state, shipId) {
  return state.ships.find((s) => s.id === shipId) ?? null;
}
