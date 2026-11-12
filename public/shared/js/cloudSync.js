// Cloud saves for a game: an account session on the server, plus keeping the
// local save and the cloud save in step.
//
// The local save in localStorage stays the one the game plays from, so the
// game works offline exactly as before. This module pushes it to the cloud
// now and then, and on start (or log in) decides whether to push, take the
// cloud save, or ask the player: it never overwrites a save that has
// progress the other one lacks.
//
// Bookkeeping lives in `<game>-cloud`: the cloud revision this device last
// synced (`revision`), whether the local save changed since (`dirty`), a
// random device id, and whether the player is logged in.

const META_DEFAULTS = { revision: 0, dirty: false, signedIn: false, prompted: false, device: '', backup: null };

/**
 * What to do with a local save and the cloud save (pure).
 *
 * @param {object} p
 * @param {object|null} p.local   { fresh } summary of the local save, or null when there is none
 * @param {object|null} p.cloud   { revision, device } of the cloud save, or null when there is none
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

/** Whether the player should be offered to move a local save to the cloud (pure). */
export function shouldOfferMigration({ enabled, meta, local }) {
  return Boolean(enabled && !meta.signedIn && !meta.prompted && local && !local.fresh);
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
 * @param {object} options
 * @param {string} options.game          game id, e.g. 'driftworks'
 * @param {string} options.saveKey       full localStorage key of the save
 * @param {(data: object) => object} options.summarize  save → { lastPlayed, credits, act, ships, fresh }
 * @param {(data: object) => boolean} options.canLoad   whether this version of the game can load a save
 */
export function createCloudSync({ game, saveKey, summarize, canLoad = () => true, storage = defaultStorage(), fetchFn = globalThis.fetch?.bind(globalThis), now = () => Date.now() }) {
  const metaKey = `${game}-cloud`;
  const listeners = new Set();
  let config = { cloud: false, recovery: false };
  let status = 'off'; // off | signed-out | synced | saving | offline | conflict | error
  let conflict = null; // { local, cloud, cloudData }
  let frozen = false;
  let loaded = false; // the game has read its save; a pull now needs a reload
  let reloadNeeded = false;
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
    for (const listener of listeners) listener(api.status());
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

  async function request(method, path, body, { keepalive = false } = {}) {
    if (!fetchFn) throw new Error('offline');
    const res = await fetchFn(`/api${path}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401 && path !== '/session') {
      writeMeta({ signedIn: false, revision: 0 });
      setStatus('signed-out');
    }
    return { status: res.status, body: json };
  }

  /** Fetches the cloud save: { revision, data, summary, device, updatedAt } or null. */
  async function fetchCloud() {
    const res = await request('GET', `/saves/${game}`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    return res.body;
  }

  function startConflict(cloud) {
    const local = readLocal();
    conflict = { local: summaryOf(local), cloud: { ...(cloud.summary ?? {}), updatedAt: cloud.updatedAt, otherDevice: cloud.device !== meta.device }, cloudData: cloud.data, revision: cloud.revision };
    setStatus('conflict');
  }

  /**
   * Compares the local save with the cloud save and acts on it. A pull
   * writes the cloud save into local storage: call it before the game loads
   * its save, or reload the game afterwards (the result says `reload`).
   */
  async function reconcile() {
    const cloud = await fetchCloud();
    if (!meta.signedIn) return { action: 'none' };
    const localData = readLocal();
    const action = decideSync({ local: summaryOf(localData), cloud, meta });
    if (action === 'pull' && !canLoad(cloud.data)) {
      setStatus('error');
      return { action: 'outdated' };
    }
    if (action === 'pull') {
      if (localData && !summaryOf(localData)?.fresh) keepBackup(localData, 'device');
      writeLocal(cloud.data);
      writeMeta({ revision: cloud.revision, dirty: false });
      lastSyncedAt = now();
      if (loaded) {
        frozen = true;
        reloadNeeded = true;
      }
      setStatus('synced');
      return { action, reload: true };
    }
    if (action === 'conflict') {
      startConflict(cloud);
      return { action };
    }
    if (action === 'adopt') writeMeta({ revision: cloud.revision, dirty: true });
    if (action === 'push' || action === 'adopt') {
      await pushNow();
      return { action };
    }
    lastSyncedAt = now();
    setStatus('synced');
    return { action };
  }

  async function pushNow({ keepalive = false } = {}) {
    if (!meta.signedIn || conflict || frozen || !config.cloud) return;
    const data = readLocal();
    if (!data) return;
    const gen = generation;
    const body = { baseRevision: meta.revision, data, summary: summaryOf(data) ?? {}, device: meta.device };
    // Browsers cap keepalive bodies at 64 KB.
    const small = !keepalive || JSON.stringify(body).length < 60_000;
    setStatus('saving');
    try {
      const res = await request('PUT', `/saves/${game}`, body, { keepalive: keepalive && small });
      if (res.status === 200) {
        writeMeta({ revision: res.body.revision, dirty: gen !== generation });
        lastSyncedAt = now();
        setStatus('synced');
      } else if (res.status === 409) {
        const cloud = await fetchCloud();
        if (cloud) startConflict(cloud);
        else {
          writeMeta({ revision: 0 });
          setStatus('offline');
        }
      } else if (res.status !== 401) {
        setStatus(res.status === 413 ? 'error' : 'offline');
      }
    } catch {
      setStatus('offline');
    }
  }

  const api = {
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
      return { enabled: config.cloud, recovery: config.recovery, signedIn: meta.signedIn, state: status, lastSyncedAt, conflict, backup: meta.backup, reloadNeeded };
    },


    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Whether to offer moving the local save to the cloud. */
    shouldOfferMigration() {
      return shouldOfferMigration({ enabled: config.cloud, meta, local: summaryOf(readLocal()) });
    },

    dismissMigration() {
      writeMeta({ prompted: true });
    },

    /**
     * Run before the game loads its save: reads the server config and, when
     * logged in, brings the local save in step (a newer cloud save is
     * written to local storage first). Gives up after `timeoutMs` and plays
     * from the local save.
     */
    async start({ timeoutMs = 4000 } = {}) {
      const work = (async () => {
        try {
          const res = await request('GET', '/config');
          config = res.status === 200 && res.body ? res.body : { cloud: false };
        } catch {
          config = { cloud: false };
        }
        if (!config.cloud) return setStatus('off');
        if (!meta.signedIn) return setStatus('signed-out');
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
      if (busy || !meta.signedIn || !config.cloud || conflict) return;
      if (status === 'offline' || status === 'error') {
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

    /** Creates an account and moves the local save into it. Returns the number to show. */
    async signUp() {
      const res = await request('POST', '/account', {});
      if (res.status !== 201) return { ok: false, error: res.body?.error ?? 'Could not create an account.' };
      writeMeta({ signedIn: true, revision: 0, dirty: true, prompted: true });
      setStatus('saving');
      await pushNow();
      return { ok: true, number: res.body.number };
    },

    /** Logs in and brings the saves in step: { ok, reload, conflict }. */
    async logIn(number) {
      const res = await request('POST', '/session', { number });
      if (res.status !== 204) return { ok: false, error: res.body?.error ?? 'Could not log in.' };
      writeMeta({ signedIn: true, revision: 0, dirty: true, prompted: true });
      try {
        const outcome = await reconcile();
        return { ok: true, reload: Boolean(outcome.reload), conflict: outcome.action === 'conflict', outdated: outcome.action === 'outdated' };
      } catch {
        setStatus('offline');
        return { ok: true };
      }
    },

    async logOut() {
      try {
        await request('DELETE', '/session');
      } catch {
        // Logged out on this device either way.
      }
      conflict = null;
      writeMeta({ signedIn: false, revision: 0, dirty: false });
      setStatus('signed-out');
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

    async account() {
      const res = await request('GET', '/account');
      return res.status === 200 ? res.body : null;
    },

    async setEmail(email) {
      const res = await request('PUT', '/account/email', { email });
      return res.status === 204 ? { ok: true } : { ok: false, error: res.body?.error ?? 'Could not save the email.' };
    },

    async removeEmail() {
      const res = await request('DELETE', '/account/email');
      return { ok: res.status === 204 };
    },

    async recover(email) {
      const res = await request('POST', '/recovery', { email });
      return res.status === 202 ? { ok: true } : { ok: false, error: res.body?.error ?? 'Could not send the mail.' };
    },

    async deleteAccount() {
      const res = await request('DELETE', '/account');
      if (res.status !== 204) return { ok: false, error: 'Could not delete the account.' };
      conflict = null;
      writeMeta({ signedIn: false, revision: 0, dirty: false });
      setStatus('signed-out');
      return { ok: true };
    },
  };
  return api;
}
