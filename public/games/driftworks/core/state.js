// The shape of a save, and a fresh game.

import { START_STATION } from '../content/homeSystem.js';
import { useGalaxy } from '../content/galaxy.js';
import { createShip } from '../systems/fleet.js';
import { addLog } from '../systems/log.js';
import { randomSeed } from './rng.js';

// Version 2 rebuilt orders, research and contracts; older saves start over.
// Version 3 added the galaxy (act 2); version 2 saves upgrade (see save.js).
// Version 4 made contracts a fixed price for a set amount.
// Version 5 added sealed holds, hazard shielding, signals and act 3.
// Version 6 replaced ship prices with the fleet allowance and building.
export const SAVE_VERSION = 6;
export const OLDEST_SAVE_VERSION = 2;
export const STARTING_CREDITS = 600;

export function createGame({ now = Date.now(), seed = randomSeed() } = {}) {
  useGalaxy(seed);
  const state = {
    version: SAVE_VERSION,
    seed,
    createdAt: now,
    // The simulation's clock: how far the world has been advanced.
    now,
    // The last time the game was on screen; the away summary starts here.
    lastSeenAt: now,
    credits: STARTING_CREDITS,
    stats: {
      earned: 0,
      oreSold: 0,
      tradeProfit: 0,
      miningTrips: 0,
      sales: 0,
      research: 0,
      refits: 0,
      contracts: 0,
      contractsAccepted: 0,
      copies: 0,
      repeats: 0,
      jumps: 0,
      jumpFees: 0,
      surveys: 0,
      // Paid by factions for the charts of systems surveyed first.
      chartPay: 0,
      signals: 0,
      salvaged: 0,
      missions: 0,
      // Builds started, and what went into them: { licences, materials, fees }.
      builds: 0,
      shipSpend: { licences: 0, materials: 0, fees: 0 },
      // Profit from sales in other systems than the one the goods came from.
      farSales: 0,
      // Tonnes sold and profit made per goods tier: { [tier]: number }.
      tierTonnes: {},
      tierProfit: {},
    },
    research: { done: [], active: null, second: null },
    // Offers, running contracts, and when each surveyed system is next
    // checked for a new offer (see systems/contracts.js).
    contracts: { offers: [], active: [], nextId: 1, checks: {} },
    ships: [],
    nextShipId: 1,
    // Ships being built or planned at shipyards, and the goods delivered
    // for builds at each yard (see systems/shipyard.js).
    builds: [],
    nextBuildId: 1,
    stores: {},
    // Allowance points an old save got so its whole fleet still fits.
    allowanceBonus: 0,
    markets: {},
    // Systems your scouts have surveyed (Aurel is always known).
    surveyed: [],
    // When a ship last saw each system's prices: { [systemId]: time }.
    seen: {},
    // Signals investigated or salvaged: { [signalId]: { investigatedAt, salvaged } }.
    signals: {},
    // Commanders hired so far; the next three candidates come from it.
    hires: 0,
    // Standing with each faction, in points.
    standing: {},
    goals: [],
    tutorial: { skipped: false },
    log: [],
  };
  createShip(state, 'mule', START_STATION);
  createShip(state, 'kite', START_STATION);
  addLog(state, now, 'Your company starts in Aurel with a mining ship, Mule-1, and a hauler, Kite-1.', 'info');
  return state;
}
