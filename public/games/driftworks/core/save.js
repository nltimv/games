// Saving and loading. The whole state is plain JSON in localStorage under
// `driftworks-save`. Each save carries a version; MIGRATIONS upgrade older
// saves one version at a time, so players never lose progress to an update.

import { createStore } from '../../../shared/js/storage.js';
import { SAVE_VERSION } from './state.js';

const SAVE_KEY = 'save';

/**
 * Upgrade functions keyed by the version they upgrade FROM:
 * MIGRATIONS[1] turns a version 1 save into version 2, and so on.
 */
export const MIGRATIONS = {};

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
    data.version >= 1 &&
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

export function createSaveStore(storage) {
  const store = createStore('driftworks', storage);
  return {
    load() {
      const raw = store.getRaw(SAVE_KEY);
      return raw == null ? null : deserialize(raw);
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
