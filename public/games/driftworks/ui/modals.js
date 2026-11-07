// The two dialogs: "while you were away" and settings (backups and reset).

import { formatClock, formatDuration } from '../../../shared/js/format.js';
import { logSince } from '../systems/log.js';
import { h } from './dom.js';
import { button } from './components.js';
import { plusCredits } from './format.js';

const AWAY_KINDS = new Set(['arrival', 'sale', 'goal', 'warning', 'purchase']);

function openDialog(dialog, children) {
  dialog.replaceChildren(...children.flat(Infinity).filter(Boolean));
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
  const income = entries.reduce((sum, e) => sum + Math.max(0, e.amount ?? 0), 0);
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

/** Settings: copy a backup code, restore one, or start over. */
export function showSettings(dialog, session, { onToast }) {
  let confirmReset = false;

  function render() {
    const code = session.exportText();
    const exportBox = h('textarea', { readonly: true, 'aria-label': 'Backup code', rows: 3 }, code);
    const importBox = h('textarea', { 'aria-label': 'Paste a backup code', placeholder: 'Paste a backup code here', rows: 3 });

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(code);
        onToast('Backup code copied.');
      } catch {
        exportBox.select();
        onToast('Select the code and copy it.');
      }
    };
    const load = () => {
      if (!importBox.value.trim()) return onToast('Paste a backup code first.', 'warning');
      if (session.importText(importBox.value)) {
        onToast('Backup loaded.');
        dialog.close();
      } else onToast('That code is not a Driftworks backup.', 'warning');
    };
    const reset = () => {
      if (!confirmReset) {
        confirmReset = true;
        render();
        return;
      }
      session.reset();
      onToast('A new company starts in Aurel.');
      dialog.close();
    };

    openDialog(dialog, [
      h('span', { class: 'dw-eyebrow' }, 'Driftworks'),
      h('h2', { id: 'modal-title' }, 'Settings'),
      h('p', { class: 'dw-note' }, 'Your company is saved in this browser. Copy the backup code to move it to another device or keep it safe.'),
      h('div', { class: 'dw-section' }, exportBox, h('div', { class: 'dw-row-actions' }, button('Copy backup code', { onClick: copy }))),
      h('div', { class: 'dw-section' }, importBox, h('div', { class: 'dw-row-actions' }, button('Load backup', { onClick: load }))),
      h(
        'div',
        { class: 'dw-section' },
        confirmReset ? h('p', { class: 'dw-note is-warn' }, 'This deletes your company for good. Press again to start over.') : null,
        h(
          'div',
          { class: 'dw-row-actions' },
          button(confirmReset ? 'Yes, delete and start over' : 'Start over', { variant: 'danger', onClick: reset }),
          button('Close', { variant: 'primary', onClick: () => dialog.close() }),
        ),
      ),
    ]);
  }
  render();
}
