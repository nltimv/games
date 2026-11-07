// Buying ships and naming them.
//
// Each ship costs more than the last, whatever its hull (see SHIP_PRICES),
// so a fleet grows steadily instead of exponentially.

import { HULLS, SHIP_PRICES, SHIP_PRICE_GROWTH } from '../content/ships.js';
import { findResearch } from '../content/research.js';
import { STATION_TYPES } from '../content/stations.js';
import { findFaction, findStation } from '../content/galaxy.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';
import { bestModules, isResearched } from './research.js';
import { hasStanding, STANDING_LEVELS } from './standing.js';

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
    // Fitted module levels; new ships get the newest researched.
    modules: bestModules(state),
    order: null,
    // Orders waiting to start after the current one.
    queue: [],
    // The orders given since the ship was last idle, for "Run again" and
    // "Copy orders".
    plan: [],
  };
  state.nextShipId += 1;
  state.ships.push(ship);
  return ship;
}

/** What the company's next ship costs, whatever the hull. */
export function shipPrice(state) {
  // Command ships come with their commander, at their own prices.
  const index = Math.max(0, state.ships.filter((ship) => !HULLS[ship.hull].hired).length - 1);
  if (index < SHIP_PRICES.length) return SHIP_PRICES[index];
  const raw = SHIP_PRICES.at(-1) * SHIP_PRICE_GROWTH ** (index - SHIP_PRICES.length + 1);
  return Math.round(raw / 10000) * 10000;
}

/**
 * Hulls a shipyard stocks, licensed or not. Hulls that need standing show
 * from the warp drive on, when standing starts to count.
 */
export function hullsForSale(state, stationId) {
  const station = findStation(stationId);
  if (!station) return [];
  return (STATION_TYPES[station.type].hulls ?? []).filter((id) => !HULLS[id].standing || isResearched(state, 'warp-drive'));
}

/** The research a hull still needs before the company may buy it, or null. */
export function missingLicence(state, hullId) {
  const licence = HULLS[hullId]?.licence;
  return licence && !isResearched(state, licence) ? findResearch(licence) : null;
}

/** Why the company may not buy a hull at a shipyard yet, or null. */
export function hullLock(state, hullId, stationId) {
  const hull = HULLS[hullId];
  const licence = missingLicence(state, hullId);
  if (licence) return `Needs the ${licence.name} research.`;
  const faction = findStation(stationId)?.faction;
  if (hull?.standing && !hasStanding(state, faction, hull.standing)) {
    const level = STANDING_LEVELS.find((l) => l.id === hull.standing);
    return `Needs ${level.name} standing with the ${findFaction(faction)?.name ?? 'faction'}.`;
  }
  return null;
}

export function buyShip(state, hullId, stationId) {
  const hull = HULLS[hullId];
  if (!hull || !hullsForSale(state, stationId).includes(hullId)) {
    return { ok: false, error: 'That ship is not sold here.' };
  }
  const lock = hullLock(state, hullId, stationId);
  if (lock) return { ok: false, error: lock };
  const price = shipPrice(state);
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
