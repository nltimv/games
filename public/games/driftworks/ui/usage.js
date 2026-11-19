// Usage data while a Driftworks save is played (see core/usage.js for the
// events, /privacy for what is collected). Each save gets a random id and a
// play-time counter on this device, kept apart from the save itself, so
// usage data never travels with a cloud save or its code.

import { createStore } from '../../../shared/js/storage.js';
import { telemetry, track } from '../../../shared/js/telemetry.js';
import { actNow, changes, nextGoalIndex, progress, snapshot } from '../core/usage.js';

const store = createStore('driftworks');
const KEY = 'usage-saves';
const TICK_MS = 15_000;

let playedMs = 0;

/** Minutes this save has been on screen on this device. */
export function playedMinutes() {
  return playedMs / 60_000;
}

function randomId() {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

/**
 * Starts usage data for the save `slotId` being played in `session`.
 * `kind` says how it was opened: 'new', 'continue', 'resumed' (after a cloud reload).
 */
export function startUsage({ session, slotId, kind, doc = document }) {
  const tracker = telemetry();
  if (!tracker) return;

  const all = store.getJSON(KEY, {}) ?? {};
  const record = all[slotId] && typeof all[slotId] === 'object' ? all[slotId] : {};
  record.id ??= randomId();
  record.playedMs = Number(record.playedMs) || 0;
  playedMs = record.playedMs;
  const persist = () => {
    record.playedMs = playedMs;
    const latest = store.getJSON(KEY, {}) ?? {};
    store.setJSON(KEY, { ...latest, [slotId]: record });
  };
  persist();
  tracker.setSave(record.id);

  track('save_opened', { kind, act: actNow(session.state), goal_index: nextGoalIndex(session.state) });

  let before = snapshot(session.state);
  session.subscribe((change) => {
    // A save loaded or started over in place: a new baseline, nothing happened.
    if (change.source === 'load') {
      before = snapshot(session.state);
      return;
    }
    const { events, after } = changes(before, session.state, { playedMin: playedMinutes(), now: Date.now() });
    before = after;
    for (const [name, props] of events) track(name, props);
  });

  // Play time: only while the game is on screen.
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (!doc.hidden) playedMs += Math.min(now - last, TICK_MS * 2);
    last = now;
  }, TICK_MS);
  setInterval(persist, 60_000);

  // Leaving: where the company stands. Hiding the page comes first; a page
  // closed while on screen (a reload, the Main menu) only gets pagehide.
  let left = false;
  function leave() {
    if (left) return;
    left = true;
    playedMs += Math.min(Date.now() - last, TICK_MS * 2);
    last = Date.now();
    persist();
    track('progress_snapshot', progress(session.state, { playedMin: playedMinutes(), now: Date.now() }));
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) return leave();
    left = false;
    last = Date.now();
  });
  globalThis.addEventListener?.('pagehide', () => {
    leave();
    telemetry()?.flush({ keepalive: true });
  });
}
