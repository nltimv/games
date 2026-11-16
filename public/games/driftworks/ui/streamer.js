// Streamer mode: hides save codes and email addresses on screen, so they
// do not leak on a stream or a screenshot. Codes show as dots with a Show
// button; email fields mask what is typed. Copying a code still works.
// The setting belongs to this device (localStorage), not to a save.

import { formatCode } from '../../../shared/js/cloudSync.js';
import { h } from './dom.js';

const KEY = 'driftworks-streamer-mode';

export function streamerMode() {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setStreamerMode(on) {
  try {
    if (on) globalThis.localStorage?.setItem(KEY, '1');
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Blocked storage: the setting lasts until the page closes.
  }
  document.documentElement.classList.toggle('dw-streamer', Boolean(on));
}

// Applies the class on load, for the CSS that masks email fields.
document.documentElement.classList.toggle('dw-streamer', streamerMode());

const HIDDEN = '•••• •••• •••• ••••';

/** A code for running text: dots in streamer mode. */
export function codeText(code) {
  return streamerMode() ? HIDDEN : formatCode(code);
}

/** The big code box; in streamer mode it shows dots and a Show button. */
export function codeBox(code) {
  const output = h('output', { class: 'dw-cloud-number', 'aria-label': 'Save code' }, codeText(code));
  if (!streamerMode()) return output;
  let shown = false;
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'dw-link dw-code-reveal',
      'aria-pressed': 'false',
      onClick: () => {
        shown = !shown;
        output.textContent = shown ? formatCode(code) : HIDDEN;
        toggle.textContent = shown ? 'Hide' : 'Show';
        toggle.setAttribute('aria-pressed', String(shown));
      },
    },
    'Show',
  );
  return h('div', { class: 'dw-code-wrap' }, output, toggle);
}

/** The setting as a checkbox row, for the main menu and Settings. */
export function streamerToggle({ onChange } = {}) {
  return h(
    'label',
    { class: 'dw-cloud-check' },
    h('input', {
      type: 'checkbox',
      checked: streamerMode(),
      dataset: { key: 'streamer-toggle' },
      onChange: (e) => {
        setStreamerMode(e.target.checked);
        onChange?.(e.target.checked);
      },
    }),
    h('span', null, 'Streamer mode: hide save codes and email addresses'),
  );
}
