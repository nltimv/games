// The "while you were away" dialog, and the Settings page of the game
// menu (starting over; see menu.js).

import { formatClock, formatDuration } from '../../../shared/js/format.js';
import { logSince } from '../systems/log.js';
import { h } from './dom.js';
import { button } from './components.js';
import { plusCredits } from './format.js';

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
 * The Settings page of the game menu: start over. Saves and their codes
 * are the main menu's job. `head` is the page heading (with its
 * Back button); `onDone` closes the menu after a reset.
 */
export function settingsPage({ session, onToast, onDone, head }) {
  let confirmReset = false;
  const body = h('div', { class: 'dw-modal-body' });

  function render() {
    const reset = () => {
      if (!confirmReset) {
        confirmReset = true;
        render();
        body.querySelector('[data-key="settings-reset"]')?.focus({ preventScroll: true });
        return;
      }
      session.reset();
      onToast('A new company starts in Aurel.');
      onDone();
    };

    body.replaceChildren(
      ...[
        h('p', { class: 'dw-note' }, 'Starting over replaces this save with a new company. To keep it and start another, use New game in the main menu.'),
        h(
          'div',
          { class: 'dw-section' },
          confirmReset ? h('p', { class: 'dw-note is-warn' }, 'This deletes your company for good. Press again to start over.') : null,
          h('div', { class: 'dw-row-actions' }, button(confirmReset ? 'Yes, delete and start over' : 'Start over', { variant: 'danger', onClick: reset, key: 'settings-reset' })),
        ),
      ].filter(Boolean),
    );
  }
  render();
  return [head, body];
}
