// Several named saves of one game on this device. The list lives in
// `<game>-slots`; each save's data in `<game>-slot-<id>` and its cloud
// bookkeeping (save code, revision; see cloudSync.js) in
// `<game>-slot-<id>-cloud`.

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function newId() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const MAX_NAME_LENGTH = 40;

/** A tidy save name, or null when nothing is left of it. */
export function cleanName(input) {
  const name = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || null;
}

export function createSaveSlots({ game, storage = defaultStorage(), now = () => Date.now() }) {
  const indexKey = `${game}-slots`;

  function read(key, fallback) {
    try {
      const raw = storage?.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage?.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  const readIndex = () => ({ slots: [], legacyNotice: false, ...read(indexKey, {}) });
  const writeIndex = (index) => write(indexKey, index);

  function update(id, patch) {
    const index = readIndex();
    const slot = index.slots.find((s) => s.id === id);
    if (!slot) return null;
    Object.assign(slot, patch);
    writeIndex(index);
    return slot;
  }

  const slots = {
    /** The part of the save's storage key after `<game>-`. */
    saveName: (id) => `slot-${id}`,
    saveKey: (id) => `${game}-slot-${id}`,
    metaKey: (id) => `${game}-slot-${id}-cloud`,

    /** Saves on this device, most recently played first. */
    list() {
      return readIndex().slots.sort((a, b) => (b.lastPlayed ?? b.createdAt) - (a.lastPlayed ?? a.createdAt));
    },

    get(id) {
      return readIndex().slots.find((s) => s.id === id) ?? null;
    },

    /** The save played last, or null when there is none. */
    latest() {
      return slots.list()[0] ?? null;
    },

    /** The save's data as stored, parsed, or null. */
    data(id) {
      return read(slots.saveKey(id), null);
    },

    /** The save's cloud bookkeeping: { code, revision, dirty, hasEmail, ... }. */
    meta(id) {
      return { code: null, revision: 0, dirty: false, hasEmail: false, ...read(slots.metaKey(id), {}) };
    },

    setMeta(id, patch) {
      write(slots.metaKey(id), { ...slots.meta(id), ...patch });
    },

    findByCode(code) {
      const digits = String(code ?? '').replace(/\D/g, '');
      return digits ? (slots.list().find((s) => slots.meta(s.id).code === digits) ?? null) : null;
    },

    /** `base`, or `base 2`, `base 3`… when that name is taken. */
    freeName(base) {
      const taken = new Set(slots.list().map((s) => s.name.toLowerCase()));
      if (!taken.has(base.toLowerCase())) return base;
      for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
    },

    /**
     * A new save. With `data` (a JSON string or object) it starts from
     * that; without, the game starts a new one when it loads the save.
     */
    create(name, { data = null, meta = null } = {}) {
      const index = readIndex();
      const slot = { id: newId(), name: cleanName(name) ?? slots.freeName('Company'), createdAt: now(), lastPlayed: null };
      if (data != null && !write(slots.saveKey(slot.id), data)) return null;
      if (meta) write(slots.metaKey(slot.id), meta);
      index.slots.push(slot);
      return writeIndex(index) ? slot : null;
    },

    rename(id, name) {
      const clean = cleanName(name);
      if (!clean) return null;
      const slot = update(id, { name: clean });
      // The name travels with the cloud save: mark it for the next push.
      if (slot && slots.meta(id).code) slots.setMeta(id, { dirty: true });
      return slot;
    },

    /** Notes that the save is being played now. */
    touch(id) {
      return update(id, { lastPlayed: now() });
    },

    /** Removes the save from this device. Its cloud save is not touched. */
    remove(id) {
      const index = readIndex();
      index.slots = index.slots.filter((s) => s.id !== id);
      writeIndex(index);
      try {
        storage?.removeItem(slots.saveKey(id));
        storage?.removeItem(slots.metaKey(id));
      } catch {
        // Nothing to clean up.
      }
    },

    /**
     * Turns the single save of earlier versions (stored under `legacyKey`)
     * into a named save, once. Returns the new save, or null when there was
     * nothing to move.
     */
    adoptLegacy(legacyKey, name) {
      let raw;
      try {
        raw = storage?.getItem(legacyKey);
      } catch {
        return null;
      }
      if (raw == null) return null;
      const slot = slots.create(name, { data: raw });
      if (!slot) return null;
      update(slot.id, { lastPlayed: now() });
      writeIndex({ ...readIndex(), legacyNotice: true });
      try {
        storage.removeItem(legacyKey);
      } catch {
        // The copy is in place; the old key is only clutter.
      }
      return slots.get(slot.id);
    },

    /** Whether the player still has to be told their save was moved. */
    get legacyNotice() {
      return Boolean(readIndex().legacyNotice);
    },

    dismissLegacyNotice() {
      writeIndex({ ...readIndex(), legacyNotice: false });
    },
  };
  return slots;
}
