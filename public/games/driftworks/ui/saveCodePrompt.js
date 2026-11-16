// Shown once a save gets its save code: a new game, a save from before
// cloud saves, or a save whose old code stopped working. It shows the code
// and asks the player to note it down, then (when the server can send mail)
// offers to link a recovery email, with a warning when they skip it.

import { formatCode } from '../../../shared/js/cloudSync.js';
import { h } from './dom.js';
import { button } from './components.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the prompt in the game's dialog for the save's sync (`cloud`) and
 * resolves once the player is done with it. `name` is the save's name.
 */
export function showSaveCode(dialog, { cloud, name, toast }) {
  return new Promise((resolve) => {
    const status = cloud.status();
    const code = status.code;
    if (!code) return resolve();

    let page = 'code';
    let wroteDown = false;
    let notice = null; // { text, warn }
    let pending = false;
    let email = '';

    // Esc does not skip past the code: the player has to see it.
    const keepOpen = (e) => e.preventDefault();
    dialog.addEventListener('cancel', keepOpen);

    function done(message) {
      cloud.codeSeen();
      dialog.removeEventListener('cancel', keepOpen);
      dialog.close();
      dialog.replaceChildren();
      if (message) toast(message);
      resolve();
    }

    function go(next, message = null) {
      page = next;
      notice = message;
      render();
    }

    const say = (text, warn = false) => ({ text, warn });
    const eyebrow = h('span', { class: 'dw-eyebrow' }, 'Cloud save');

    function codePage() {
      const next = button('Continue', {
        variant: 'primary',
        block: true,
        disabled: !wroteDown,
        key: 'code-continue',
        onClick: () => {
          // Seen: a reload from here on goes straight to the game.
          cloud.codeSeen();
          if (status.recovery && !cloud.status().hasEmail) go('email');
          else done();
        },
      });
      return [
        eyebrow,
        h('h2', { id: 'modal-title' }, status.codeReplaced ? 'Your new save code' : 'Your save code'),
        h(
          'p',
          { class: 'dw-note' },
          status.codeReplaced
            ? `The old code of "${name}" stopped working, so it is now saved under a new code:`
            : `"${name}" is now saved online. Its save code:`,
        ),
        h('output', { class: 'dw-cloud-number', 'aria-label': 'Save code' }, formatCode(code)),
        button('Copy code', {
          block: true,
          key: 'code-copy',
          onClick: async () => go('code', (await copyText(code)) ? say('Code copied.') : say('Select the code and copy it.')),
        }),
        h('p', { class: 'dw-note is-warn' }, 'Write it down or keep it somewhere safe. With it you load this save on another device. Anyone with the code can play the save, so keep it to yourself.'),
        h(
          'label',
          { class: 'dw-cloud-check' },
          h('input', {
            type: 'checkbox',
            checked: wroteDown,
            dataset: { key: 'code-check' },
            onChange: (e) => {
              wroteDown = e.target.checked;
              next.disabled = !wroteDown;
            },
          }),
          h('span', null, 'I wrote down my code'),
        ),
        h('div', { class: 'dw-row-actions' }, next),
      ];
    }

    function emailPage() {
      const input = h('input', { class: 'dw-cloud-input', type: 'email', autocomplete: 'email', inputmode: 'email', value: email, placeholder: 'you@example.com' });
      const submit = async (e) => {
        e.preventDefault();
        if (pending) return;
        email = input.value.trim();
        if (!email) return go('email', say('Enter an email address, or skip this.', true));
        pending = true;
        notice = null;
        render();
        const result = await cloud.linkEmail(email);
        pending = false;
        if (result.ok) done('Email linked. The save code is on its way there.');
        else go('email', say(result.error, true));
      };
      return [
        eyebrow,
        h('h2', { id: 'modal-title' }, 'Add a recovery email'),
        h('p', { class: 'dw-note' }, 'If you ever lose the code, we send a new one to this address. We mail you the code now too.'),
        h(
          'form',
          { class: 'dw-cloud-form', onSubmit: submit },
          h('label', { class: 'dw-cloud-field' }, h('span', null, 'Recovery email'), input),
          h(
            'div',
            { class: 'dw-row-actions' },
            button(pending ? 'Linking…' : 'Link email', { variant: 'primary', disabled: pending, onClick: submit, key: 'email-link' }),
            button('Skip', { disabled: pending, onClick: () => ((email = input.value.trim()), go('skip')), key: 'email-skip' }),
          ),
        ),
        h('p', { class: 'dw-note' }, 'The address is stored scrambled, so it cannot be read back. You can add or remove it later under Load game, Manage.'),
      ];
    }

    function skipPage() {
      return [
        eyebrow,
        h('h2', { id: 'modal-title' }, 'No recovery email?'),
        h('p', { class: 'dw-note is-warn' }, 'Without a recovery email, this save cannot be recovered if you lose its code. Nobody can look it up for you.'),
        h(
          'div',
          { class: 'dw-row-actions' },
          button('Add email', { variant: 'primary', onClick: () => go('email'), key: 'skip-add' }),
          button('Continue without', { onClick: () => done(), key: 'skip-continue' }),
        ),
      ];
    }

    function render() {
      const [head, title, ...rest] = (page === 'email' ? emailPage() : page === 'skip' ? skipPage() : codePage()).flat(Infinity).filter(Boolean);
      // What just happened goes right under the heading, where it is seen.
      const line = notice ? h('p', { class: `dw-note${notice.warn ? ' is-warn' : ''}`, role: 'status' }, notice.text) : null;
      dialog.replaceChildren(...[head, title, line, ...rest].filter(Boolean));
      if (!dialog.open) dialog.showModal();
      const focus = page === 'email' ? dialog.querySelector('input') : dialog.querySelector('[data-key]');
      focus?.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    }

    render();
  });
}
