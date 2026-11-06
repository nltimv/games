// Driftworks boot: load or start a company, catch up on time away, then run
// a one-second clock for the simulation. The map draws only when something
// changes (see render/mapView.js).

import { createSession } from './core/session.js';
import { createApp } from './ui/app.js';

const AUTOSAVE_MS = 15_000;
const REFRESH_PANELS_MS = 30_000;

const session = createSession();
const bootNow = Date.now();
const awaySince = session.state.lastSeenAt;

// Catch up first, so the first frame already shows where ships are now.
session.tick(bootNow);
session.visit(bootNow);

const app = createApp(session);
app.showAwayIfNeeded(awaySince, bootNow);
session.markSeen(bootNow);
session.save();

// The player is "away" while the tab is hidden or the window is not
// focused (say, back in their editor). Coming back shows what happened.
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    leave();
    app.map.stop();
  } else {
    app.map.start();
    if (document.hasFocus()) comeBack();
  }
});
window.addEventListener('blur', leave);
window.addEventListener('focus', comeBack);
window.addEventListener('pagehide', () => session.save());

app.map.start();
