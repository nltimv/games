// Safe, namespaced localStorage access shared by the games.
//
// Every read and write is wrapped in try/catch: storage can be missing or
// throw in private windows, with blocked site data, or when the quota is
// full. Callers always get a value back (the fallback) instead of an error.

function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Creates a store whose keys are prefixed with `<prefix>-`, matching the
 * repo convention that storage keys start with the game id.
 */
export function createStore(prefix, storage = getStorage()) {
  const key = (name) => `${prefix}-${name}`;

  return {
    getRaw(name, fallback = null) {
      try {
        const value = storage?.getItem(key(name));
        return value ?? fallback;
      } catch {
        return fallback;
      }
    },

    setRaw(name, value) {
      try {
        storage?.setItem(key(name), value);
        return true;
      } catch {
        return false;
      }
    },

    getJSON(name, fallback = null) {
      const raw = this.getRaw(name);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    setJSON(name, value) {
      try {
        return this.setRaw(name, JSON.stringify(value));
      } catch {
        return false;
      }
    },

    remove(name) {
      try {
        storage?.removeItem(key(name));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** A tiny in-memory Storage stand-in, handy for tests. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}
