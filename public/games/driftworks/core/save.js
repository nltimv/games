// Saving and loading. The whole state is plain JSON in localStorage under
// `driftworks-save`. Each save carries a version; MIGRATIONS upgrade older
// saves one version at a time. Saves older than OLDEST_SAVE_VERSION come
// from before a rebuild and cannot be upgraded: the game starts over.

import { createStore } from '../../../shared/js/storage.js';
import { OLDEST_SAVE_VERSION, SAVE_VERSION } from './state.js';
import { HOME_FACTION } from '../content/galaxy.js';
import { CREDITS_PER_POINT } from '../systems/standing.js';

const SAVE_KEY = 'save';

/**
 * Upgrade functions keyed by the version they upgrade FROM:
 * MIGRATIONS[1] turns a version 1 save into version 2, and so on.
 */
export const MIGRATIONS = {
  // Act 2: the galaxy. Nothing is lost; the company has surveyed only Aurel.
  2(save) {
    return {
      ...save,
      stats: { jumps: 0, jumpFees: 0, surveys: 0, farSales: 0, ...save.stats },
      surveyed: save.surveyed ?? [],
      seen: save.seen ?? {},
      // A company that already has the warp drive starts its Halcyon
      // standing from what it earned (see standing.openStanding).
      standing: save.standing ?? (save.research?.done?.includes('warp-drive') ? { [HOME_FACTION]: (save.stats?.earned ?? 0) / CREDITS_PER_POINT } : {}),
    };
  },
  // Contracts became a fixed price for a set amount. Old offers and
  // contracts (a premium on sales) are dropped; new offers turn up soon.
  3(save) {
    return {
      ...save,
      contracts: { offers: [], active: [], nextId: save.contracts?.nextId ?? 1, checks: {} },
    };
  },
  // Act 3: sealed holds (a new module line, standard on every ship until a
  // refit), sales counted per tier, and signals in the deep galaxy.
  4(save) {
    return {
      ...save,
      stats: { tierTonnes: {}, tierProfit: {}, chartPay: 0, signals: 0, salvaged: 0, ...save.stats },
      signals: save.signals ?? {},
      ships: save.ships.map((ship) => ({ ...ship, modules: { seal: 0, ...ship.modules } })),
    };
  },
};

export function migrate(data) {
  let save = data;
  while (save.version < SAVE_VERSION) {
    const step = MIGRATIONS[save.version];
    if (!step) throw new Error(`No migration from save version ${save.version}`);
    save = { ...step(save), version: save.version + 1 };
  }
  return save;
}

function isPlausible(data) {
  return (
    data &&
    typeof data === 'object' &&
    Number.isInteger(data.version) &&
    data.version >= OLDEST_SAVE_VERSION &&
    data.version <= SAVE_VERSION &&
    Array.isArray(data.ships) &&
    Number.isFinite(data.credits)
  );
}

export function deserialize(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!isPlausible(data)) return null;
    return migrate(data);
  } catch {
    return null;
  }
}

export function serialize(state) {
  return JSON.stringify(state);
}

/** True for a save from before the last rebuild. */
export function isOutdated(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    return Number.isInteger(data?.version) && data.version < OLDEST_SAVE_VERSION;
  } catch {
    return false;
  }
}

export function createSaveStore(storage) {
  const store = createStore('driftworks', storage);
  return {
    load() {
      const raw = store.getRaw(SAVE_KEY);
      return raw == null ? null : deserialize(raw);
    },
    /** Whether the stored save is one this version can no longer load. */
    hasOutdated() {
      const raw = store.getRaw(SAVE_KEY);
      return raw != null && isOutdated(raw);
    },
    save(state) {
      return store.setRaw(SAVE_KEY, serialize(state));
    },
    clear() {
      return store.remove(SAVE_KEY);
    },
  };
}

/** A copyable text backup of a save. */
export function exportSave(state) {
  const bytes = new TextEncoder().encode(serialize(state));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function importSave(text) {
  try {
    const binary = atob(text.trim());
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return deserialize(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
