// Cloud saves for a game. Each save has a save code: whoever has the code
// can load the save on any device. There are no accounts.
//
// The local save in localStorage stays the one the game plays from, so the
// game works offline exactly as before. This module gets the save a code,
// pushes it to the cloud now and then, and on start decides whether to
// push, take the cloud save, or ask the player: it never overwrites a save
// that has progress the other one lacks.
//
// Bookkeeping lives beside the save (`metaKey`): its code, the cloud
// revision this device last synced (`revision`), whether the local save
// changed since (`dirty`), and a random device id.

const META_DEFAULTS = { code: null, revision: 0, dirty: false, device: '', backup: null, hasEmail: false };

/**
 * What to do with a local save and the cloud save (pure).
 *
 * @param {object} p
 * @param {object|null} p.local   { fresh } summary of the local save, or null when there is none
 * @param {object|null} p.cloud   { revision, device } of the cloud save, or null when it is still empty
 * @param {object} p.meta         { revision, dirty, device }
 * @returns {'none'|'push'|'pull'|'adopt'|'conflict'}
 *   adopt: the cloud holds this device's own last write (sent as the page
 *   closed); keep the local save, which is the same or newer.
 */
export function decideSync({ local, cloud, meta }) {
  if (!cloud) return local ? 'push' : 'none';
  if (!local || local.fresh) return 'pull';
  if (cloud.revision === meta.revision) return meta.dirty ? 'push' : 'none';
  if (cloud.revision > meta.revision) {
    if (meta.device && cloud.device === meta.device && cloud.revision === meta.revision + 1) return 'adopt';
    return meta.dirty ? 'conflict' : 'pull';
  }
  // The cloud went back (an older backup was restored on the server): ask.
  return 'conflict';
}

/** 1234 5678 9012 3456 */
export function formatCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

function randomDevice() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The server calls, one per function. Each resolves to { status, body };
 * a network failure rejects.
 */
export function createCloudApi({ game, fetchFn = globalThis.fetch?.bind(globalThis) }) {
  async function request(method, path, { code, body, keepalive = false } = {}) {
    if (!fetchFn) throw new Error('offline');
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (code) headers.authorization = `Code ${String(code).replace(/\D/g, '')}`;
    const res = await fetchFn(`/api${path}`, { method, keepalive, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const saves = `/saves/${game}`;
  return {
    /** { cloud, recovery }; cloud is false when the server has no cloud saves or cannot be reached. */
    async config() {
      try {
        const res = await request('GET', '/config');
        return res.status === 200 && res.body ? res.body : { cloud: false, recovery: false };
      } catch {
        return { cloud: false, recovery: false, offline: true };
      }
    },
    create: () => request('POST', saves, { body: {} }),
    load: (code) => request('GET', saves, { code }),
    write: (code, body, options) => request('PUT', saves, { code, body, ...options }),
    remove: (code) => request('DELETE', saves, { code }),
    setEmail: (code, email) => request('PUT', `${saves}/email`, { code, body: { email } }),
    removeEmail: (code) => request('DELETE', `${saves}/email`, { code }),
    recover: (email) => request('POST', '/recovery', { body: { email } }),
  };
}

/**
 * Keeps one local save in step with its cloud save.
 *
 * @param {object} options
 * @param {string} options.game          game id, e.g. 'driftworks'
 * @param {string} options.saveKey       full localStorage key of the save
 * @param {string} options.metaKey       full localStorage key of its bookkeeping
 * @param {() => string} options.getName the save's name, sent along for the save list
 * @param {(data: object) => object} options.summarize  save → { lastPlayed, credits, act, ships, fresh }
 * @param {(data: object) => boolean} options.canLoad   whether this version of the game can load a save
 */
export function createCloudSync({ game, saveKey, metaKey, getName = () => '', summarize, canLoad = () => true, storage = defaultStorage(), fetchFn, now = () => Date.now() }) {
  const api = createCloudApi({ game, fetchFn });
  const listeners = new Set();
  let config = { cloud: false, recovery: false };
  let status = 'local'; // local | synced | saving | offline | conflict | error
  let conflict = null; // { local, cloud, cloudData, revision }
  let frozen = false;
  let loaded = false; // the game has read its save; a pull now needs a reload
  let reloadNeeded = false;
  let codeReplaced = false;
  let busy = null;
  let lastSyncedAt = null;
  let generation = 0;

  function readMeta() {
    try {
      return { ...META_DEFAULTS, ...JSON.parse(storage?.getItem(metaKey) ?? '{}') };
    } catch {
      return { ...META_DEFAULTS };
    }
  }
  let meta = readMeta();
  if (!meta.device) meta.device = randomDevice();

  function writeMeta(patch = {}) {
    meta = { ...meta, ...patch };
    try {
      storage?.setItem(metaKey, JSON.stringify(meta));
    } catch {
      // Storage full or blocked: the bookkeeping lives on in memory.
    }
  }
  writeMeta();

  function setStatus(next) {
    status = next;
    for (const listener of listeners) listener(sync.status());
  }

  function readLocal() {
    try {
      const raw = storage?.getItem(saveKey);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeLocal(data) {
    try {
      storage?.setItem(saveKey, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  function summaryOf(data) {
    if (!data) return null;
    try {
      return summarize(data);
    } catch {
      return null;
    }
  }

  function keepBackup(data, from) {
    if (!data) return;
    writeMeta({ backup: { data, from, at: now() } });
  }

  /** The code stopped working (recovered by email, or the cloud save was deleted): this save gets a new one. */
  function loseCode() {
    conflict = null;
    codeReplaced = true;
    writeMeta({ code: null, revision: 0, dirty: true, hasEmail: false });
  }

  /** Gets this save a code when it has none. True when it has one afterwards. */
  async function ensureCode() {
    if (meta.code) return true;
    const res = await api.create();
    if (res.status !== 201) return false;
    writeMeta({ code: res.body.code.replace(/\D/g, ''), revision: 0, dirty: true });
    return true;
  }

  /** The cloud save ({ revision, data, ... }), null while it is still empty, or 'gone' when the code no longer works. */
  async function fetchCloud() {
    const res = await api.load(meta.code);
    if (res.status === 401) return 'gone';
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (res.body.hasEmail !== meta.hasEmail) writeMeta({ hasEmail: Boolean(res.body.hasEmail) });
    return res.body.revision > 0 && res.body.data ? res.body : null;
  }

  function startConflict(cloud) {
    const local = readLocal();
    conflict = {
      local: summaryOf(local),
      cloud: { ...(cloud.summary ?? {}), updatedAt: cloud.updatedAt, otherDevice: cloud.device !== meta.device },
      cloudData: cloud.data,
      revision: cloud.revision,
    };
    setStatus('conflict');
  }

  /**
   * Compares the local save with the cloud save and acts on it. A pull
   * writes the cloud save into local storage: before the game has loaded
   * its save that is all; afterwards the game must reload (`reloadNeeded`).
   */
  async function reconcile() {
    if (!(await ensureCode())) return setStatus('offline');
    let cloud = await fetchCloud();
    if (cloud === 'gone') {
      loseCode();
      if (!(await ensureCode())) return setStatus('offline');
      cloud = null;
    }
    const localData = readLocal();
    const action = decideSync({ local: summaryOf(localData), cloud, meta });
    if (action === 'pull') {
      if (!canLoad(cloud.data)) return setStatus('error');
      if (localData && !summaryOf(localData)?.fresh) keepBackup(localData, 'device');
      writeLocal(cloud.data);
      writeMeta({ revision: cloud.revision, dirty: false });
      lastSyncedAt = now();
      if (loaded) {
        frozen = true;
        reloadNeeded = true;
      }
      return setStatus('synced');
    }
    if (action === 'conflict') return startConflict(cloud);
    if (action === 'adopt') writeMeta({ revision: cloud.revision, dirty: true });
    if (action === 'push' || action === 'adopt') return pushNow();
    lastSyncedAt = now();
    setStatus('synced');
  }

  async function pushNow({ keepalive = false } = {}) {
    if (conflict || frozen || !config.cloud || !meta.code) return;
    const data = readLocal();
    if (!data) return setStatus('synced');
    const gen = generation;
    const body = { baseRevision: meta.revision, data, summary: { ...(summaryOf(data) ?? {}), name: getName() }, device: meta.device };
    // Browsers cap keepalive bodies at 64 KB.
    const small = !keepalive || JSON.stringify(body).length < 60_000;
    setStatus('saving');
    try {
      const res = await api.write(meta.code, body, { keepalive: keepalive && small });
      if (res.status === 200) {
        writeMeta({ revision: res.body.revision, dirty: gen !== generation });
        lastSyncedAt = now();
        setStatus('synced');
      } else if (res.status === 409) {
        const cloud = await fetchCloud();
        if (cloud && cloud !== 'gone') startConflict(cloud);
        else setStatus('offline');
      } else if (res.status === 401) {
        loseCode();
        setStatus('offline');
      } else {
        setStatus(res.status === 413 ? 'error' : 'offline');
      }
    } catch {
      setStatus('offline');
    }
  }

  const sync = {
    /**
     * A localStorage stand-in for the game: writes to the save mark it as
     * changed, and are dropped once a cloud save is about to replace it.
     */
    storage: {
      getItem: (key) => storage?.getItem(key) ?? null,
      setItem(key, value) {
        if (key === saveKey) {
          if (frozen) return;
          if (storage?.getItem(key) !== value) {
            generation += 1;
            if (!meta.dirty) writeMeta({ dirty: true });
          }
        }
        storage?.setItem(key, value);
      },
      removeItem(key) {
        if (key === saveKey && frozen) return;
        storage?.removeItem(key);
      },
    },

    status() {
      return { enabled: config.cloud, recovery: config.recovery, code: meta.code, state: status, lastSyncedAt, conflict, backup: meta.backup, reloadNeeded, codeReplaced };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Run before the game loads its save: gets the save a code if it has
     * none and brings the local save in step (a newer cloud save is written
     * to local storage first). Gives up after `timeoutMs` and plays from
     * the local save. `knownConfig` skips asking the server for its config.
     */
    async start({ timeoutMs = 4000, knownConfig = null } = {}) {
      const work = (async () => {
        config = knownConfig ?? (await api.config());
        if (!config.cloud) return setStatus('local');
        try {
          busy = reconcile();
          await busy;
        } catch {
          setStatus('offline');
        } finally {
          busy = null;
        }
      })();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([work, timeout]);
      clearTimeout(timer);
      // The game reads its save next: a pull from now on needs a reload.
      loaded = true;
    },

    /** Pushes the local save when it changed. Safe to call often. */
    async sync({ keepalive = false } = {}) {
      if (busy || !config.cloud || conflict) return;
      if (!meta.code || status === 'offline' || status === 'error' || status === 'local') {
        // Coming back: check the cloud first, in case another device saved.
        busy = reconcile().catch(() => setStatus('offline'));
      } else if (meta.dirty) {
        busy = pushNow({ keepalive });
      } else return;
      try {
        return await busy;
      } finally {
        busy = null;
      }
    },

    /** The save's name changed: send it along with the next push. */
    touch() {
      generation += 1;
      writeMeta({ dirty: true });
    },

    /**
     * Settles a conflict. 'device' writes this device's save to the cloud;
     * 'cloud' takes the cloud save (the game must reload: `reload`). The
     * save not chosen is kept as a backup.
     */
    async resolve(choice) {
      if (!conflict) return { ok: true };
      const { cloudData, revision } = conflict;
      if (choice === 'cloud') {
        if (!canLoad(cloudData)) return { ok: false, error: 'The cloud save is from a newer version. Reload the page to update.' };
        keepBackup(readLocal(), 'device');
        frozen = true;
        writeLocal(cloudData);
        writeMeta({ revision, dirty: false });
        conflict = null;
        lastSyncedAt = now();
        setStatus('synced');
        return { ok: true, reload: true };
      }
      keepBackup(cloudData, 'cloud');
      conflict = null;
      writeMeta({ revision, dirty: true });
      await pushNow();
      return { ok: status !== 'conflict' };
    },

    /** Loads the kept backup in place of the current save (the game must reload). */
    restoreBackup() {
      const backup = meta.backup;
      if (!backup || !canLoad(backup.data)) return false;
      const current = readLocal();
      frozen = true;
      writeLocal(backup.data);
      generation += 1;
      writeMeta({ dirty: true, backup: current ? { data: current, from: 'device', at: now() } : null });
      return true;
    },
  };
  return sync;
}
