// The shape of a save, and a fresh game.

import { START_STATION } from '../content/homeSystem.js';
import { createShip } from '../systems/fleet.js';
import { addLog } from '../systems/log.js';
import { randomSeed } from './rng.js';

// Version 2 rebuilt orders, research and contracts; older saves start over.
export const SAVE_VERSION = 2;
export const OLDEST_SAVE_VERSION = 2;
export const STARTING_CREDITS = 250;

export function createGame({ now = Date.now(), seed = randomSeed() } = {}) {
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
    },
    research: { done: [], active: null },
    contracts: { offers: [], active: [], nextId: 1 },
    ships: [],
    nextShipId: 1,
    markets: {},
    goals: [],
    tutorial: { skipped: false },
    log: [],
  };
  createShip(state, 'mule', START_STATION);
  addLog(state, now, 'Your company starts in Aurel with one mining ship, Mule-1.', 'info');
  return state;
}
