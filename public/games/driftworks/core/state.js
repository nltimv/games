// The shape of a save, and a fresh game.

import { START_STATION } from '../content/homeSystem.js';
import { createShip } from '../systems/fleet.js';
import { addLog } from '../systems/log.js';
import { randomSeed } from './rng.js';
import { MINUTE } from './time.js';

export const SAVE_VERSION = 1;
export const STARTING_CREDITS = 600;
export const BASE_AUTONOMY_MINUTES = 60;

export function createGame({ now = Date.now(), seed = randomSeed() } = {}) {
  const state = {
    version: SAVE_VERSION,
    seed,
    createdAt: now,
    // The simulation's clock: how far the world has been advanced.
    now,
    // The last time the player did something. Queued work only starts
    // within the autonomy window after it.
    lastVisitAt: now,
    // The last time the game was on screen; the away summary starts here.
    lastSeenAt: now,
    autonomyMinutes: BASE_AUTONOMY_MINUTES,
    // How many orders a ship holds at once (1 = only the current one).
    // Research raises this in act 2.
    orderSlots: 1,
    credits: STARTING_CREDITS,
    stats: { earned: 0, oreSold: 0, tradeProfit: 0, miningTrips: 0 },
    ships: [],
    nextShipId: 1,
    markets: {},
    goals: [],
    log: [],
  };
  createShip(state, 'mule', START_STATION);
  addLog(state, now, 'Your company starts in Aurel with one mining ship, Mule-1.', 'info');
  return state;
}

export function autonomyEndsAt(state) {
  return state.lastVisitAt + state.autonomyMinutes * MINUTE;
}
