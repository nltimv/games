// Anonymous usage data for the Games Hub: which games get played, for how
// long, on what devices, and how far players get. Events go in batches to
// the hub's own server (POST /api/events, see server/telemetry.js), never to
// a third party. See /privacy for what is collected and why.
//
// What identifies a player is a random install id kept in localStorage. It
// is not derived from anything (not a save code, not the device), and it is
// deleted when the player turns usage data off. The server keeps no IP
// addresses.
//
// Usage: a page calls initTelemetry({ game }) once; any module then calls
// track(name, props). Before init, or when usage data is off, track() does
// nothing. Nothing in here may throw into a game: every entry point is
// wrapped.

import { apiBase, appPlatform, isApp } from './platform.js';
import { createStore } from './storage.js';

const PATH = '/api/events';
const SESSION_GAP_MS = 30 * 60 * 1000;
const FLUSH_MS = 30_000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const MAX_QUEUE = 500;
const MAX_BATCH = 50;
const MAX_ERRORS = 3;

const store = (storage) => createStore('games', storage);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function uuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Not a secure context: fall through.
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether the browser asks sites not to track (Global Privacy Control or Do Not Track). */
function browserOptedOut(nav = globalThis.navigator) {
  try {
    return nav?.globalPrivacyControl === true || nav?.doNotTrack === '1' || globalThis.window?.doNotTrack === '1';
  } catch {
    return false;
  }
}

/** Whether usage data is on: the player's setting, and the browser's privacy signals. */
export function analyticsEnabled({ storage = defaultStorage(), nav = globalThis.navigator } = {}) {
  return store(storage).getRaw('telemetry-off') !== '1' && !browserOptedOut(nav);
}

/** Whether the browser itself turned usage data off (the setting then cannot turn it on). */
export function analyticsBlockedByBrowser(nav = globalThis.navigator) {
  return browserOptedOut(nav);
}

/**
 * Turns usage data on or off on this device. Off also forgets the install
 * id and anything not yet sent, so turning it on again starts a new id.
 */
export function setAnalyticsEnabled(on, { storage = defaultStorage() } = {}) {
  const s = store(storage);
  if (on) {
    s.remove('telemetry-off');
  } else {
    current?.track('analytics_off');
    current?.flush({ keepalive: true });
    s.setRaw('telemetry-off', '1');
    s.remove('telemetry-id');
    s.remove('telemetry-session');
    s.remove('telemetry-queue');
    current?.stop();
  }
}

// ---------- Device facts (coarse on purpose) ----------

function osOf(ua, nav) {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS reports itself as a Mac, but has a touch screen.
  if (/Macintosh/i.test(ua)) return (nav?.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

function browserOf(ua) {
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Phone, tablet or desktop, from the screen's short side and touch. */
function deviceOf(ua, screen, nav) {
  const short = Math.min(screen?.width ?? 0, screen?.height ?? 0);
  const touch = (nav?.maxTouchPoints ?? 0) > 0;
  if (/iPad|Tablet/i.test(ua) || (touch && short >= 600)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua) || (touch && short > 0 && short < 600)) return 'phone';
  return 'desktop';
}

/** Rounds to 50 px so the size says "small phone" or "big monitor" and no more. */
const round50 = (n) => Math.round((Number(n) || 0) / 50) * 50;

export function deviceInfo({ nav = globalThis.navigator, screen = globalThis.screen, doc = globalThis.document } = {}) {
  const ua = String(nav?.userAgent ?? '');
  let tz;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    tz = '';
  }
  let referrer = 'direct';
  try {
    const ref = doc?.referrer ? new URL(doc.referrer) : null;
    if (ref) referrer = ref.origin === globalThis.location?.origin ? 'internal' : ref.hostname;
  } catch {
    referrer = 'direct';
  }
  return {
    os: osOf(ua, nav),
    browser: browserOf(ua),
    device: deviceOf(ua, screen, nav),
    screen: `${round50(screen?.width)}x${round50(screen?.height)}`,
    touch: (nav?.maxTouchPoints ?? 0) > 0,
    lang: String(nav?.language ?? '').slice(0, 16),
    tz: tz.slice(0, 48),
    referrer: referrer.slice(0, 64),
  };
}

/** Minutes bucketed for "time away" style props: exact enough to plot, not a timestamp. */
export function bucketMinutes(ms) {
  const min = Math.max(0, ms / 60_000);
  for (const edge of [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 2880, 10080]) if (min < edge) return edge;
  return 10080 * 2;
}

// ---------- The tracker ----------

let current = null;

/** Records an event if a page started telemetry and usage data is on. Never throws. */
export function track(name, props) {
  try {
    current?.track(name, props);
  } catch {
    // Usage data must never break a game.
  }
}

/** The running tracker, or null. */
export function telemetry() {
  return current;
}

/**
 * Starts telemetry for this page. `game` is the game id ('hub' for the
 * lobby), `version` the game's own version when it has one, `page` what
 * kind of page this is. Returns the tracker, or null when usage data is
 * off or there is no server to send to.
 */
export function initTelemetry({
  game,
  version = '',
  page = 'game',
  storage = defaultStorage(),
  fetchFn = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
  win = globalThis.window,
  doc = globalThis.document,
  nav = globalThis.navigator,
  base = apiBase(),
  platform = appPlatform() || 'web',
  autoStart = true,
} = {}) {
  try {
    current?.stop();
    current = null;
    if (!analyticsEnabled({ storage, nav })) return null;
    // An app built with no server (DRIFTWORKS_API_URL=none) keeps everything on the device.
    if (isApp() && !base) return null;
    if (!fetchFn) return null;
    current = createTracker({ game, version, page, storage, fetchFn, now, win, doc, nav, base, platform, autoStart });
    return current;
  } catch {
    current = null;
    return null;
  }
}

/**
 * For pages whose game is a classic script: starts telemetry and puts it on
 * window.gamesTelemetry, which the game calls. Events the game sent before
 * this module ran (a stub's `q`, see pipelines/index.html) are sent too.
 */
export function startPageTelemetry(options) {
  const early = globalThis.window?.gamesTelemetry?.q;
  const tracker = initTelemetry(options);
  if (globalThis.window) globalThis.window.gamesTelemetry = tracker ?? { track() {} };
  if (tracker && Array.isArray(early)) for (const [name, props, at] of early) tracker.track(name, props, at);
  return tracker;
}

function createTracker({ game, version, page, storage, fetchFn, now, win, doc, nav, base, platform, autoStart }) {
  const s = store(storage);
  let installId = s.getRaw('telemetry-id');
  if (!/^[0-9a-f-]{36}$/.test(installId ?? '')) {
    installId = uuid();
    s.setRaw('telemetry-id', installId);
  }
  const firstOpen = !s.getRaw('telemetry-seen');
  s.setRaw('telemetry-seen', '1');

  // Events a page left unsent when it closed; this page owns them now.
  const leftover = s.getJSON('telemetry-queue', []);
  s.remove('telemetry-queue');
  const queue = Array.isArray(leftover) ? leftover.slice(-MAX_QUEUE) : [];

  let saveId = null;
  let sending = false;
  let stopped = false;
  let off = false; // the server has no telemetry
  let errors = 0;
  const timers = [];
  const cleanups = [];

  function session(at) {
    const stored = s.getJSON('telemetry-session', null);
    if (stored && typeof stored.id === 'string' && at - stored.last < SESSION_GAP_MS) {
      s.setJSON('telemetry-session', { id: stored.id, last: at });
      return stored.id;
    }
    const id = uuid();
    s.setJSON('telemetry-session', { id, last: at });
    push('session_start', stored?.last ? { away_min: bucketMinutes(at - stored.last) } : { first: true }, at, id);
    return id;
  }

  function push(name, props, at, sessionId) {
    queue.push({ name, at, game, version, session_id: sessionId, save_id: saveId, props: props ?? {} });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  }

  function trackEvent(name, props = {}, when = null) {
    if (stopped) return;
    const at = Number.isFinite(when) && when <= now() ? when : now();
    const sessionId = session(at);
    push(name, props, at, sessionId);
  }

  async function flush({ keepalive = false } = {}) {
    // A page that is closing sends at once, even with a batch on its way.
    if ((sending && !keepalive) || off || !queue.length) return;
    sending = true;
    const batch = queue.splice(0, MAX_BATCH);
    try {
      const res = await fetchFn(`${base}${PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install_id: installId, platform, events: batch }),
        keepalive,
        credentials: 'omit',
      });
      if (res.status === 404 || res.status === 410) {
        // This server collects nothing: stop for this page.
        off = true;
        queue.length = 0;
      } else if (res.status === 429 || res.status >= 500) {
        queue.unshift(...batch);
      }
      // Anything else (sent, or refused as malformed) is done with.
    } catch {
      queue.unshift(...batch);
    } finally {
      sending = false;
    }
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  }

  /** On leaving the page: send what we can, and keep the rest for the next page. */
  function park() {
    if (stopped || off) return;
    flush({ keepalive: true });
    if (queue.length) s.setJSON('telemetry-queue', queue.slice(-MAX_QUEUE));
  }

  function listen(target, type, fn) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  }

  function onError(e) {
    if (errors >= MAX_ERRORS) return;
    const message = String(e?.message ?? e?.reason?.message ?? e?.reason ?? '');
    // Errors from scripts on other origins arrive as "Script error." with no details.
    if (!message || /^Script error\.?$/i.test(message)) return;
    errors += 1;
    let source;
    try {
      source = e?.filename ? `${new URL(e.filename).pathname.split('/').slice(-2).join('/')}:${e.lineno ?? 0}` : '';
    } catch {
      source = '';
    }
    trackEvent('js_error', { message: message.replace(/\d+/g, '#').slice(0, 120), source: source.slice(0, 80) });
  }

  const tracker = {
    get installId() {
      return installId;
    },
    /** Events waiting to be sent (for tests). */
    get queue() {
      return queue;
    },
    track(name, props, at) {
      trackEvent(name, props, at);
    },
    /** Ties the following events to a save (a random id per save, see Driftworks' core/analytics.js). */
    setSave(id) {
      saveId = typeof id === 'string' ? id : null;
    },
    flush,
    stop() {
      stopped = true;
      for (const id of timers) clearInterval(id);
      for (const undo of cleanups) undo();
      if (current === tracker) current = null;
    },
  };

  trackEvent('app_open', { page, first_open: firstOpen, ...deviceInfo({ nav, doc }) });

  if (autoStart) {
    timers.push(setInterval(() => flush(), FLUSH_MS));
    timers.push(
      setInterval(() => {
        if (!doc?.hidden) trackEvent('session_heartbeat');
      }, HEARTBEAT_MS),
    );
    listen(doc, 'visibilitychange', () => {
      // After the other listeners, so what the game tracks on leaving goes out too.
      if (doc.hidden) setTimeout(park, 0);
      else session(now());
    });
    listen(win, 'pagehide', park);
    listen(win, 'online', () => flush());
    listen(win, 'error', onError);
    listen(win, 'unhandledrejection', onError);
    // The first events go out soon, so a short visit still counts.
    setTimeout(() => flush(), 5000);
  }

  return tracker;
}
