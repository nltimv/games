// Driftworks boot: pick a save in the main menu, load or start its company,
// catch up on time away, then run a one-second clock for the simulation. The map draws only when something
// changes (see render/mapView.js).

import { adoptLegacySave, cloudApi, openSave, reloadIntoSave, takeResume } from './core/saves.js';
import { createSession } from './core/session.js';
import { createApp } from './ui/app.js';
import { showConflict } from './ui/cloudSave.js';
import { showMainMenu } from './ui/mainMenu.js';

const AUTOSAVE_MS = 15_000;
const REFRESH_PANELS_MS = 30_000;
const CLOUD_SYNC_MS = 30_000;

const modal = document.getElementById('modal');

// A save from before named saves becomes one, and the main menu explains it.
adoptLegacySave();

// The main menu: Continue, New game or Load game. (Skipped when the page
// reloaded itself to load a newer cloud save.)
const cloudConfig = await cloudApi.config();
const save = openSave(takeResume() ?? (await showMainMenu(modal, { config: cloudConfig })));
const { cloud } = save;

// Give the save its code if it has none, and bring it in step with its
// cloud save first (a newer one from another device is loaded instead).
// Offline or slow, the game starts from the local save after a few seconds.
await cloud.start({ knownConfig: cloudConfig });

const session = createSession({ storage: cloud.storage, saveName: save.saveName });
const bootNow = Date.now();
const awaySince = session.state.lastSeenAt;

// Catch up first, so the first frame already shows where ships are now.
session.tick(bootNow);

const app = createApp(session);
app.showStartup(awaySince, bootNow);
session.markSeen(bootNow);
session.save();

// The player is "away" only while the tab is hidden (another tab, a
// minimised window): then the game stops drawing and the browser slows its
// clock. A window that just lost focus is still on screen (say, on a second
// monitor), so the game keeps running there and nothing needs telling.
let away = false;
let lastPanelRefresh = Date.now();

function leave() {
  if (away) return;
  away = true;
  session.save();
}

function comeBack() {
  if (!away) return;
  away = false;
  const now = Date.now();
  session.tick(now);
  app.render();
  app.showAwayIfNeeded(session.state.lastSeenAt, now);
  session.markSeen(now);
}

setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  session.tick(now);
  if (!away) session.markSeen(now);
  app.updateLive(now);
  // Prices drift back slowly; refresh the numbers now and then.
  if (now - lastPanelRefresh > REFRESH_PANELS_MS) {
    lastPanelRefresh = now;
    app.render();
  }
}, 1000);

setInterval(() => session.save(), AUTOSAVE_MS);

// ---------- Cloud save ----------

const cloudPrompts = { toast: app.toast };

/** Opens a prompt now, or once the dialog that is open closes. */
function whenModalFree(open) {
  if (!modal.open) return open();
  modal.addEventListener('close', () => setTimeout(() => whenModalFree(open), 0), { once: true });
}

if (cloud.status().conflict) whenModalFree(() => showConflict(modal, cloudPrompts));

let cloudState = cloud.status().state;
cloud.subscribe((status) => {
  // A newer cloud save was loaded into storage: restart on it.
  if (status.reloadNeeded) reloadIntoSave();
  // Another device saved while this one played: ask, once.
  if (status.state === 'conflict' && cloudState !== 'conflict') whenModalFree(() => cloud.status().conflict && showConflict(modal, cloudPrompts));
  cloudState = status.state;
  app.render();
});

setInterval(() => {
  if (!document.hidden) cloud.sync();
}, CLOUD_SYNC_MS);
window.addEventListener('online', () => cloud.sync());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    leave();
    cloud.sync({ keepalive: true });
    app.map.stop();
  } else {
    app.map.start();
    comeBack();
  }
});
// Losing focus is not leaving, but save anyway in case the window closes next.
window.addEventListener('blur', () => session.save());
window.addEventListener('pagehide', () => {
  session.save();
  cloud.sync({ keepalive: true });
});

app.map.start();
