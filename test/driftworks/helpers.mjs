// Shared setup for the Driftworks tests.

import { createGame } from '../../public/games/driftworks/core/state.js';
import { MINUTE } from '../../public/games/driftworks/core/time.js';

export const T0 = Date.UTC(2026, 10, 6, 9, 0, 0);
export { MINUTE };

/** A fresh game at a fixed time and seed, so every run is the same. */
export function newGame(overrides = {}) {
  const state = createGame({ now: T0, seed: 1234 });
  return Object.assign(state, overrides);
}

export function firstShip(state) {
  return state.ships[0];
}
