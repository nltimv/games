// The "while you were away" dialog, and the Settings page of the game
// menu and the main menu (see menu.js and mainMenu.js).

import { formatClock, formatDuration } from '../../../shared/js/format.js';
import { apiBase } from '../../../shared/js/platform.js';
import { GAME_VERSION } from '../content/changelog.js';
import { analyticsBlockedByBrowser, analyticsEnabled, initTelemetry, setAnalyticsEnabled, track } from '../../../shared/js/telemetry.js';
import { logSince } from '../systems/log.js';
import { h } from './dom.js';
import { button } from './components.js';
import { plusCredits } from './format.js';
import { streamerToggle } from './streamer.js';

const AWAY_KINDS = new Set(['arrival', 'sale', 'goal', 'warning', 'purchase']);

function openDialog(dialog, children) {
  dialog.replaceChildren(...children.flat(Infinity).filter(Boolean));
  dialog.classList.remove('is-menu');
  if (!dialog.open) dialog.showModal();
}

/**
 * Shows what happened since `since`, if anything worth telling did.
 * Returns true when the dialog opened.
 */
export function showAway(dialog, state, since, now) {
  const all = logSince(state, since);
  const entries = all.filter((e) => AWAY_KINDS.has(e.kind));
  // Captain's logs from missions that ended, each on a card of its own.
  const logs = all.filter((e) => e.kind === 'fleet').slice(-3);
  if (!entries.length && !logs.length) return false;
  const income = [...entries, ...all.filter((e) => e.kind === 'fleet')].reduce((sum, e) => sum + Math.max(0, e.amount ?? 0), 0);
  const close = () => dialog.close();
  openDialog(dialog, [
    h('span', { class: 'dw-eyebrow' }, 'Welcome back'),
    h('h2', { id: 'modal-title' }, `While you were away: ${formatDuration(now - since)}`),
    logs.map((e) => h('blockquote', { class: 'dw-captains-log' }, e.text)),
    h(
      'ul',
      { class: 'dw-away-list' },
      entries.slice(-12).map((e) =>
        h(
          'li',
          null,
          h('span', { class: `dw-dot is-${e.kind}`, 'aria-hidden': 'true' }),
          h('span', { class: 'dw-grow' }, e.text),
          h('time', { datetime: new Date(e.at).toISOString() }, formatClock(e.at)),
        ),
      ),
    ),
    income > 0 ? h('p', { class: 'dw-note' }, `Credits earned: ${plusCredits(income)}`) : null,
    h('div', { class: 'dw-row-actions' }, button('Continue', { variant: 'primary', onClick: close })),
  ]);
  return true;
}

/**
 * The Settings page, in the game menu and the main menu. Starting over is
 * New game in the main menu, and removing a save is Load game, Manage.
 * `head` is the page heading with its Back button.
 */
export function settingsPage({ head }) {
  const body = h(
    'div',
    { class: 'dw-modal-body' },
    h(
      'div',
      { class: 'dw-section' },
      h('h3', { class: 'dw-section-title' }, h('span', null, 'Privacy')),
      streamerToggle({ onChange: (value) => track('settings_changed', { setting: 'streamer', value }) }),
      h('p', { class: 'dw-note' }, 'For streams and screenshots: save codes show as dots until you press Show, and email fields are masked. Applies on this device.'),
      usageToggle(),
      h(
        'p',
        { class: 'dw-note' },
        'Anonymous data on how the game is played (goals reached, time played, device type) helps make Driftworks better. No names, codes or emails. ',
        h('a', { href: `${apiBase()}/privacy`, target: '_blank', rel: 'noopener' }, 'What is collected'),
      ),
    ),
  );
  return [head, body];
}

/** Usage data on or off, for this device (see /privacy). */
function usageToggle() {
  const blocked = analyticsBlockedByBrowser();
  return h(
    'label',
    { class: 'dw-cloud-check' },
    h('input', {
      type: 'checkbox',
      checked: analyticsEnabled(),
      disabled: blocked,
      dataset: { key: 'usage-toggle' },
      onChange: (e) => {
        setAnalyticsEnabled(e.target.checked);
        // On again: start with a new id. Events tie to a save again from the next time it opens.
        if (e.target.checked && initTelemetry({ game: 'driftworks', version: GAME_VERSION })) track('settings_changed', { setting: 'analytics', value: true });
      },
    }),
    h('span', null, blocked ? 'Share anonymous usage data (off: your browser asks sites not to track)' : 'Share anonymous usage data'),
  );
}
