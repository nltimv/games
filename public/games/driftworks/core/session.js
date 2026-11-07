// A running game: the state plus the only ways it changes. The UI calls
// act() for player actions and tick() about once a second. Both advance the
// simulation, check goals, save, and tell listeners what happened, so the UI
// never has to remember to do any of that itself.

import { useGalaxy } from '../content/galaxy.js';
import { checkGoals } from '../systems/goals.js';
import { addLog } from '../systems/log.js';
import { createSaveStore, exportSave, importSave } from './save.js';
import { advance, nextEventAt } from './sim.js';
import { createGame } from './state.js';

function normalize(state) {
  state.lastSeenAt ??= state.now;
  useGalaxy(state.seed);
  return state;
}

function startFresh(saves, now) {
  const outdated = saves.hasOutdated();
  const state = createGame({ now });
  if (outdated) addLog(state, now, 'Driftworks changed a lot in this update, so your company starts over.', 'info');
  return state;
}

export function createSession({ storage, clock = () => Date.now() } = {}) {
  const saves = createSaveStore(storage);
  let state = normalize(saves.load() ?? startFresh(saves, clock()));
  const listeners = new Set();

  function emit(change) {
    for (const listener of listeners) listener(change);
  }

  /** Runs `fn` and returns its result plus the log entries it added. */
  function withNewLog(fn) {
    const last = state.log.at(-1);
    const result = fn();
    const from = last ? state.log.lastIndexOf(last) + 1 : 0;
    return { result, log: state.log.slice(from) };
  }

  return {
    get state() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Moves the world to `now`. Returns true if anything happened. */
    tick(now = clock()) {
      const due = nextEventAt(state);
      if (due == null || due > now) {
        state.now = Math.max(state.now, now);
        return false;
      }
      const { log } = withNewLog(() => advance(state, now));
      saves.save(state);
      emit({ source: 'tick', log });
      return true;
    },

    /**
     * A player action. `fn(state, now)` makes the change and returns a
     * result ({ ok, error } by convention), which is passed back.
     */
    act(fn) {
      const now = clock();
      const { result, log } = withNewLog(() => {
        advance(state, now);
        const outcome = fn(state, now);
        // Orders that take no time (a sale where the ship is docked) and
        // anything they unblock happen right away.
        advance(state, now);
        checkGoals(state, now);
        return outcome;
      });
      saves.save(state);
      emit({ source: 'act', log, result });
      return result;
    },


    /** Notes that the player has seen everything up to `now`. */
    markSeen(now = clock()) {
      state.lastSeenAt = Math.max(state.lastSeenAt ?? 0, now);
    },

    save() {
      return saves.save(state);
    },

    exportText() {
      return exportSave(state);
    },

    importText(text) {
      const loaded = importSave(text);
      if (!loaded) return false;
      state = normalize(loaded);
      state.lastSeenAt = clock();
      saves.save(state);
      emit({ source: 'load', log: [] });
      return true;
    },

    reset() {
      state = normalize(createGame({ now: clock() }));
      saves.save(state);
      emit({ source: 'load', log: [] });
    },
  };
}
