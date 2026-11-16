// The main menu, shown when the game opens: Continue the save played last,
// start a New game, or Load game to pick another save, see its save code,
// rename it, or add a save from another device with its code.
//
// It opens in the shared modal dialog before the game itself starts, and
// resolves with the id of the save to play.

import { formatCredits, formatDuration } from '../../../shared/js/format.js';
import { formatCode } from '../../../shared/js/cloudSync.js';
import { MAX_NAME_LENGTH, cleanName } from '../../../shared/js/saveSlots.js';
import { GAME_VERSION } from '../content/changelog.js';
import { LEGACY_SAVE_NAME, canLoadSave, cloudApi, slotSummary, slots } from '../core/saves.js';
import { h } from './dom.js';
import { button } from './components.js';
import { menuItem, pageHead } from './menu.js';

const HUB_URL = '/';

const ICONS = {
  plus: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
  load: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3l1.6 1.8h6.4A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.500Z"/></svg>',
};

function ago(at) {
  if (!at) return null;
  const ms = Date.now() - at;
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

/** "Act 2 · 2,000,000 cr · 5 min ago", or what else there is to say about a save. */
export function describeSave(summary) {
  if (!summary) return 'New game';
  if (summary.outdated) return 'From an old version: starts over';
  return [`Act ${summary.act}`, formatCredits(summary.credits), ago(summary.lastPlayed)].filter(Boolean).join(' · ');
}

function field({ label, ...props }) {
  return h('label', { class: 'dw-cloud-field' }, h('span', null, label), h('input', { class: 'dw-cloud-input', ...props }));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the main menu and resolves with the id of the save to play.
 * `config` is the server's { cloud, recovery }.
 */
export function showMainMenu(dialog, { config }) {
  return new Promise((resolve) => {
    let page = slots.legacyNotice ? 'legacy' : 'main';
    let slotId = null; // the save on the manage page
    let notice = null; // { text, warn }
    let pending = false;
    let confirmDelete = false;

    // The game is not running yet: there is nothing to go back to.
    const keepOpen = (e) => e.preventDefault();
    dialog.addEventListener('cancel', keepOpen);

    function play(id) {
      dialog.removeEventListener('cancel', keepOpen);
      dialog.classList.remove('is-menu', 'is-main-menu');
      dialog.close();
      dialog.replaceChildren();
      resolve(id);
    }

    function go(next, { id = slotId, message = null } = {}) {
      page = next;
      slotId = id;
      notice = message;
      confirmDelete = false;
      render();
    }

    const say = (text, warn = false) => ({ text, warn });

    async function run(task) {
      if (pending) return;
      pending = true;
      notice = null;
      render();
      try {
        await task();
      } catch {
        notice = say('Could not reach the server. Check your connection and try again.', true);
      } finally {
        pending = false;
        if (dialog.open) render();
      }
    }

    function show(children) {
      const [head, ...rest] = [children].flat(Infinity).filter(Boolean);
      // What just happened goes right under the heading, where it is seen.
      const line = notice ? h('p', { class: `dw-note${notice.warn ? ' is-warn' : ''}`, role: 'status' }, notice.text) : null;
      dialog.replaceChildren(...[head, line, ...rest].filter(Boolean));
      dialog.classList.add('is-menu', 'is-main-menu');
      if (!dialog.open) dialog.showModal();
      // Pages that ask for one thing start in its field; the others on their first button.
      const input = ['new', 'add', 'recover'].includes(page) ? dialog.querySelector('input') : null;
      (input ?? dialog.querySelector('[data-key]'))?.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    }

    // ---------- Pages ----------

    function mainPage() {
      const saves = slots.list();
      const latest = saves[0];
      return [
        pageHead('Driftworks', { eyebrow: 'Games Hub' }),
        h(
          'nav',
          { class: 'dw-gm-list', 'aria-label': 'Main menu' },
          latest
            ? menuItem({ icon: 'play', label: 'Continue', sub: `${latest.name} · ${describeSave(slotSummary(latest.id))}`, onClick: () => play(latest.id), key: 'main-continue' })
            : null,
          menuItem({ icon: ICONS.plus, label: 'New game', sub: 'Start a new company', onClick: () => go('new'), key: 'main-new', chevron: true }),
          menuItem({
            icon: ICONS.load,
            label: 'Load game',
            sub: saves.length ? `${saves.length} ${saves.length === 1 ? 'save' : 'saves'} on this device` : config.cloud ? 'Add a save with its save code' : 'No saves yet',
            onClick: () => go('load'),
            key: 'main-load',
            chevron: true,
          }),
          menuItem({ icon: 'hub', label: 'Back to Games Hub', href: HUB_URL, key: 'main-hub' }),
        ),
        h('p', { class: 'dw-gm-version' }, `Driftworks ${GAME_VERSION}`),
      ];
    }

    /** Shown once to players whose save comes from before named saves. */
    function legacyPage() {
      const slot = slots.latest();
      const start = () => {
        slots.dismissLegacyNotice();
        if (slot) play(slot.id);
        else go('main');
      };
      return [
        pageHead('Saves have changed', { eyebrow: `Driftworks ${GAME_VERSION}` }),
        h('p', { class: 'dw-note' }, `Your company is now a save called "${slot?.name ?? LEGACY_SAVE_NAME}". Nothing is lost.`),
        config.cloud
          ? h('p', { class: 'dw-note' }, 'When you continue, it is also saved online and gets a save code. With that code you can load it on any device. You find the code under Load game.')
          : null,
        h('p', { class: 'dw-note' }, 'You can now keep several saves, name them, and pick one in this menu each time you open the game.'),
        h('div', { class: 'dw-row-actions' }, button('Continue', { variant: 'primary', onClick: start, key: 'legacy-continue' }), button('Main menu', { onClick: () => (slots.dismissLegacyNotice(), go('main')) })),
      ];
    }

    function newPage() {
      const input = field({ label: 'Name', maxlength: MAX_NAME_LENGTH, value: slots.freeName('Company'), autocomplete: 'off' });
      const submit = (e) => {
        e.preventDefault();
        const slot = slots.create(cleanName(input.querySelector('input').value) ?? slots.freeName('Company'));
        if (!slot) return go('new', { message: say('This browser has no room for another save.', true) });
        play(slot.id);
      };
      return [
        pageHead('New game', { onBack: () => go('main') }),
        h('p', { class: 'dw-note' }, config.cloud ? 'Name your save. It gets a save code, which loads it on any device.' : 'Name your save. It is kept in this browser.'),
        h('form', { class: 'dw-cloud-form', onSubmit: submit }, input, h('div', { class: 'dw-row-actions' }, button('Start', { variant: 'primary', onClick: submit, key: 'new-start' }))),
      ];
    }

    function saveCard(slot) {
      const meta = slots.meta(slot.id);
      return h(
        'div',
        { class: 'dw-save-card' },
        h('div', { class: 'dw-save-info' }, h('strong', null, slot.name), h('span', null, describeSave(slotSummary(slot.id))), h('span', { class: 'dw-save-code' }, meta.code ? formatCode(meta.code) : config.cloud ? 'Gets a save code when loaded' : 'On this device only')),
        h(
          'div',
          { class: 'dw-save-actions' },
          button('Load', { variant: 'primary', small: true, onClick: () => play(slot.id), key: `load-${slot.id}` }),
          button('Manage', { small: true, onClick: () => go('manage', { id: slot.id }), label: `Manage ${slot.name}` }),
        ),
      );
    }

    function loadPage() {
      const saves = slots.list();
      return [
        pageHead('Load game', { onBack: () => go('main') }),
        saves.length ? h('div', { class: 'dw-save-list' }, saves.map(saveCard)) : h('p', { class: 'dw-note' }, 'No saves on this device yet.'),
        config.cloud
          ? h('div', { class: 'dw-row-actions' }, button('Add a save with a code', { onClick: () => go('add'), key: 'load-add' }))
          : config.offline
            ? h('p', { class: 'dw-note' }, 'Offline: adding a save with a code needs a connection.')
            : null,
      ];
    }

    function addPage() {
      const input = field({ label: 'Save code', inputmode: 'numeric', autocomplete: 'off', placeholder: '0000 0000 0000 0000', maxlength: 24 });
      const submit = (e) => {
        e.preventDefault();
        const code = input.querySelector('input').value.replace(/\D/g, '');
        if (code.length !== 16) return go('add', { message: say('A save code has 16 digits.', true) });
        const have = slots.findByCode(code);
        if (have) return go('load', { message: say(`That is "${have.name}", already on this device.`) });
        run(async () => {
          const res = await cloudApi.load(code);
          if (res.status === 401) notice = say('No save has that code.', true);
          else if (res.status === 429) notice = say('Too many tries. Wait a minute and try again.', true);
          else if (res.status !== 200) notice = say('Could not load that save. Try again later.', true);
          else if (!res.body.data) notice = say('That save is still empty: it has not been played yet.', true);
          else if (!canLoadSave(res.body.data)) notice = say('That save is from a newer version of the game. Reload the page to update.', true);
          else {
            const name = slots.freeName(cleanName(res.body.summary?.name) ?? 'Company');
            const slot = slots.create(name, { data: res.body.data, meta: { code, revision: res.body.revision, dirty: false, hasEmail: Boolean(res.body.hasEmail) } });
            if (!slot) notice = say('This browser has no room for another save.', true);
            else {
              page = 'load';
              notice = say(`"${slot.name}" was added to this device.`);
            }
          }
        });
      };
      return [
        pageHead('Add a save', { onBack: () => go('load') }),
        h('p', { class: 'dw-note' }, 'Enter the save code of a save from another device. You find it there under Load game.'),
        h('form', { class: 'dw-cloud-form', onSubmit: submit }, input, h('div', { class: 'dw-row-actions' }, button('Add save', { variant: 'primary', disabled: pending, onClick: submit, key: 'add-submit' }))),
        config.recovery ? h('button', { type: 'button', class: 'dw-link', onClick: () => go('recover') }, 'Lost a code?') : null,
      ];
    }

    function recoverPage() {
      const input = field({ label: 'Recovery email', type: 'email', autocomplete: 'email', inputmode: 'email' });
      const submit = (e) => {
        e.preventDefault();
        run(async () => {
          const res = await cloudApi.recover(input.querySelector('input').value);
          if (res.status === 202) {
            page = 'add';
            notice = say('Check your inbox. If saves are linked to that address, their new codes are on the way.');
          } else notice = say(res.body?.error ?? 'Could not send the mail.', true);
        });
      };
      return [
        pageHead('Lost a code?', { onBack: () => go('add') }),
        h('p', { class: 'dw-note' }, 'If you linked an email to a save, we send new codes for your saves there. The old codes stop working.'),
        h('form', { class: 'dw-cloud-form', onSubmit: submit }, input, h('div', { class: 'dw-row-actions' }, button('Send new codes', { variant: 'primary', disabled: pending, onClick: submit, key: 'recover-submit' }))),
      ];
    }

    function managePage() {
      const slot = slots.get(slotId);
      if (!slot) return loadPage();
      const meta = slots.meta(slot.id);
      const code = meta.code ? formatCode(meta.code) : null;

      const nameInput = field({ label: 'Name', maxlength: MAX_NAME_LENGTH, value: slot.name, autocomplete: 'off' });
      const rename = (e) => {
        e.preventDefault();
        const renamed = slots.rename(slot.id, nameInput.querySelector('input').value);
        go('manage', { message: renamed ? say('Renamed.') : say('A save needs a name.', true) });
      };

      const emailInput = field({ label: 'Recovery email', type: 'email', autocomplete: 'email', inputmode: 'email' });
      const linkEmail = (e) => {
        e.preventDefault();
        run(async () => {
          const res = await cloudApi.setEmail(meta.code, emailInput.querySelector('input').value);
          if (res.status === 204) {
            slots.setMeta(slot.id, { hasEmail: true });
            notice = say('Email linked. The save code is on its way there.');
          } else notice = say(res.body?.error ?? 'Could not link the email.', true);
        });
      };
      const unlinkEmail = () =>
        run(async () => {
          const res = await cloudApi.removeEmail(meta.code);
          if (res.status === 204) {
            slots.setMeta(slot.id, { hasEmail: false });
            notice = say('Email removed.');
          } else notice = say('Could not remove the email.', true);
        });

      const removeHere = () => {
        slots.remove(slot.id);
        go('load', { id: null, message: say(code ? `"${slot.name}" was removed from this device. Its code still loads it: ${code}` : `"${slot.name}" was deleted.`) });
      };
      const removeEverywhere = () =>
        run(async () => {
          const res = await cloudApi.remove(meta.code);
          if (res.status !== 204 && res.status !== 401) {
            notice = say('Could not delete the cloud save. Try again later.', true);
            return;
          }
          slots.remove(slot.id);
          page = 'load';
          slotId = null;
          notice = say(`"${slot.name}" was deleted.`);
        });

      return [
        pageHead(slot.name, { eyebrow: 'Save', onBack: () => go('load') }),
        h('form', { class: 'dw-cloud-form', onSubmit: rename }, nameInput, h('div', { class: 'dw-row-actions' }, button('Rename', { onClick: rename, key: 'manage-rename' }))),
        code
          ? h(
              'div',
              { class: 'dw-section' },
              h('h3', { class: 'dw-section-title' }, h('span', null, 'Save code')),
              h('output', { class: 'dw-cloud-number', 'aria-label': 'Save code' }, code),
              h('p', { class: 'dw-note' }, 'Enter this code on another device to load this save there. Anyone with the code can play the save, so keep it to yourself.'),
              h(
                'div',
                { class: 'dw-row-actions' },
                button('Copy code', { onClick: async () => go('manage', { message: (await copyText(meta.code)) ? say('Code copied.') : say('Select the code and copy it.') }), key: 'manage-copy' }),
              ),
            )
          : h('p', { class: 'dw-note' }, config.cloud ? 'This save gets its save code the next time you load it.' : 'This save is kept in this browser only.'),
        code && config.recovery
          ? h(
              'div',
              { class: 'dw-section' },
              h('h3', { class: 'dw-section-title' }, h('span', null, 'Recovery email')),
              meta.hasEmail
                ? [
                    h('p', { class: 'dw-note' }, 'An email is linked. If you lose the code, you can have a new one sent there.'),
                    h('div', { class: 'dw-row-actions' }, button('Remove email', { disabled: pending, onClick: unlinkEmail })),
                  ]
                : [
                    h('p', { class: 'dw-note' }, 'Optional. We mail the code there now, and a new one if you ever lose it. The address is stored scrambled, so it cannot be read back.'),
                    h('form', { class: 'dw-cloud-form', onSubmit: linkEmail }, emailInput, h('div', { class: 'dw-row-actions' }, button('Link email', { disabled: pending, onClick: linkEmail }))),
                  ],
            )
          : null,
        h(
          'div',
          { class: 'dw-section' },
          confirmDelete
            ? h('p', { class: 'dw-note is-warn' }, code ? 'Remove it from this device only (the code still loads it), or delete it everywhere for good?' : 'This deletes the save for good.')
            : null,
          h(
            'div',
            { class: 'dw-row-actions' },
            confirmDelete
              ? [
                  button(code ? 'Remove from this device' : 'Yes, delete', { variant: code ? undefined : 'danger', onClick: removeHere }),
                  code && config.cloud ? button('Delete everywhere', { variant: 'danger', disabled: pending, onClick: removeEverywhere }) : null,
                  button('Cancel', { onClick: () => go('manage') }),
                ]
              : button('Delete save', {
                  variant: 'danger',
                  onClick: () => {
                    confirmDelete = true;
                    notice = null;
                    render();
                  },
                  key: 'manage-delete',
                }),
          ),
        ),
      ];
    }

    function render() {
      const pages = { main: mainPage, legacy: legacyPage, new: newPage, load: loadPage, add: addPage, recover: recoverPage, manage: managePage };
      show((pages[page] ?? mainPage)());
    }

    render();
  });
}
