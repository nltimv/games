// The Cloud save slot in the game menu, and the two prompts that open on
// their own: "move your company to the cloud" (once) and "two saves differ".
//
// Text stays short and factual: what happens, and what the player must do.

import { formatCredits, formatDuration } from '../../../shared/js/format.js';
import { h } from './dom.js';
import { button } from './components.js';
import { cloud } from '../core/cloud.js';

const CLOUD_ICON =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.2 4.5 4.5 0 0 0 7 18z"/></svg>';

const BADGES = {
  'signed-out': null,
  synced: { text: 'Saved', variant: 'ok' },
  saving: { text: 'Saving', variant: 'ok' },
  offline: { text: 'Offline', variant: 'warn' },
  conflict: { text: 'Choose save', variant: 'warn' },
  error: { text: 'Not saving', variant: 'warn' },
};

const TITLES = {
  number: 'Your account number',
  login: 'Log in',
  email: 'Recovery email',
  recover: 'Lost your number',
  'recover-sent': 'Lost your number',
  conflict: 'Choose a save',
};

function ago(at) {
  if (!at) return 'unknown';
  const ms = Date.now() - at;
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

function field({ label, ...props }) {
  return h('label', { class: 'dw-cloud-field' }, h('span', null, label), h('input', { class: 'dw-cloud-input', ...props }));
}

/**
 * The cloud save pages. `nav.show(nodes)` replaces the page body (the page
 * head is added by the caller), `nav.done()` closes, `nav.toast(text)`.
 */
function createCloudPages(cloud, nav) {
  let view = 'home';
  let number = null; // shown once, right after sign up
  let error = null;
  let pending = false;
  let confirmDelete = false;

  const go = (next) => {
    view = next;
    error = null;
    confirmDelete = false;
    render();
  };

  async function run(task) {
    if (pending) return;
    pending = true;
    error = null;
    render();
    try {
      await task();
    } finally {
      pending = false;
      render();
    }
  }

  const reload = () => setTimeout(() => location.reload(), 300);

  function home() {
    const s = cloud.status();
    if (!s.signedIn) {
      return [
        h('p', { class: 'dw-note' }, 'Save your company online and continue on any device. No name or email needed: you get an account number to log in with.'),
        h(
          'div',
          { class: 'dw-row-actions' },
          button('Create account', { variant: 'primary', disabled: pending, onClick: () => run(signUp) }),
          button('Log in', { onClick: () => go('login') }),
        ),
      ];
    }
    const state = {
      synced: `Saved to the cloud ${ago(s.lastSyncedAt)}.`,
      saving: 'Saving to the cloud…',
      offline: 'Offline. Your company is saved on this device and goes to the cloud when you are back online.',
      conflict: 'This device and the cloud have different saves. Choose one to continue saving.',
      error: 'The cloud save is from a newer version of the game. Reload the page to update.',
    }[s.state];
    return [
      h('p', { class: 'dw-note' }, state ?? 'Logged in.'),
      s.state === 'conflict' ? h('div', { class: 'dw-row-actions' }, button('Choose save', { variant: 'primary', onClick: () => go('conflict') })) : null,
      h('div', { class: 'dw-row-actions' }, button('Save now', { disabled: pending || s.state === 'conflict', onClick: () => run(() => cloud.sync()) })),
      emailSection(),
      s.backup ? backupSection(s.backup) : null,
      h(
        'div',
        { class: 'dw-section' },
        confirmDelete ? h('p', { class: 'dw-note is-warn' }, 'This deletes your account and its cloud save. Your company stays on this device.') : null,
        h(
          'div',
          { class: 'dw-row-actions' },
          button('Log out', { disabled: pending, onClick: () => run(logOut) }),
          button(confirmDelete ? 'Yes, delete account' : 'Delete account', { variant: 'danger', disabled: pending, onClick: () => run(deleteAccount) }),
        ),
      ),
    ];
  }

  let account = null;
  function emailSection() {
    const s = cloud.status();
    if (!s.recovery) return null;
    if (!account) {
      cloud.account().then((a) => {
        account = a ?? { hasEmail: false };
        if (view === 'home') render();
      });
      return null;
    }
    return h(
      'div',
      { class: 'dw-section' },
      h('h3', { class: 'dw-section-title' }, h('span', null, 'Recovery email')),
      h(
        'p',
        { class: 'dw-note' },
        account.hasEmail
          ? 'An email is linked. If you lose your number, you can get a new one sent there.'
          : 'Optional. If you lose your number, you can get a new one sent to this address.',
      ),
      h(
        'div',
        { class: 'dw-row-actions' },
        button(account.hasEmail ? 'Change email' : 'Add email', { onClick: () => go('email') }),
        account.hasEmail
          ? button('Remove email', {
              disabled: pending,
              onClick: () =>
                run(async () => {
                  if ((await cloud.removeEmail()).ok) account = { hasEmail: false };
                }),
            })
          : null,
      ),
    );
  }

  function backupSection(backup) {
    return h(
      'div',
      { class: 'dw-section' },
      h('h3', { class: 'dw-section-title' }, h('span', null, 'Replaced save')),
      h('p', { class: 'dw-note' }, `The save you did not keep (${backup.from === 'cloud' ? 'from the cloud' : 'from this device'}, replaced ${ago(backup.at)}). Credits: ${formatCredits(backup.data?.credits ?? 0)}.`),
      h(
        'div',
        { class: 'dw-row-actions' },
        button('Load it instead', {
          onClick: () => {
            if (cloud.restoreBackup()) reload();
          },
        }),
      ),
    );
  }

  async function signUp() {
    const result = await cloud.signUp();
    if (!result.ok) {
      error = result.error;
      return;
    }
    number = result.number;
    view = 'number';
  }

  async function logOut() {
    await cloud.logOut();
    account = null;
    nav.toast('Logged out. Your company stays on this device.');
  }

  async function deleteAccount() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    const result = await cloud.deleteAccount();
    if (!result.ok) error = result.error;
    else nav.toast('Account deleted.');
    account = null;
    confirmDelete = false;
  }

  function numberPage() {
    let wroteDown = false;
    const next = button('Continue', { variant: 'primary', disabled: true, onClick: () => go(cloud.status().recovery ? 'email' : 'home') });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(number.replace(/ /g, ''));
        nav.toast('Number copied.');
      } catch {
        nav.toast('Select the number and copy it.');
      }
    };
    return [
      h('p', { class: 'dw-note' }, 'Your account number:'),
      h('output', { class: 'dw-cloud-number', 'aria-label': 'Account number' }, number),
      h('div', { class: 'dw-row-actions' }, button('Copy number', { onClick: copy })),
      h('p', { class: 'dw-note is-warn' }, 'Write it down now. You need it to log in on another device, and it is not shown again.'),
      h(
        'label',
        { class: 'dw-cloud-check' },
        h('input', {
          type: 'checkbox',
          onChange: (e) => {
            wroteDown = e.target.checked;
            next.disabled = !wroteDown;
          },
        }),
        h('span', null, 'I wrote down my number'),
      ),
      h('div', { class: 'dw-row-actions' }, next),
    ];
  }

  function loginPage() {
    const input = field({ label: 'Account number', inputmode: 'numeric', autocomplete: 'username', placeholder: '0000 0000 0000 0000', maxlength: 24 });
    const submit = (e) => {
      e.preventDefault();
      const value = input.querySelector('input').value;
      run(async () => {
        const result = await cloud.logIn(value);
        if (!result.ok) {
          error = result.error;
          return;
        }
        if (result.reload) {
          nav.toast('Loading your cloud save…');
          reload();
        } else if (result.conflict) {
          view = 'conflict';
        } else {
          nav.toast(result.outdated ? 'The cloud save needs a newer version. Reload the page.' : 'Logged in. Your company is saved to the cloud.');
          view = 'home';
        }
      });
    };
    return [
      h(
        'form',
        { class: 'dw-cloud-form', onSubmit: submit },
        input,
        h('div', { class: 'dw-row-actions' }, button('Log in', { variant: 'primary', disabled: pending, onClick: submit }), button('Cancel', { onClick: () => go('home') })),
      ),
      cloud.status().recovery ? h('button', { type: 'button', class: 'dw-link', onClick: () => go('recover') }, 'Lost your number?') : null,
    ];
  }

  function emailPage() {
    const input = field({ label: 'Email', type: 'email', autocomplete: 'email', inputmode: 'email' });
    const submit = (e) => {
      e.preventDefault();
      run(async () => {
        const result = await cloud.setEmail(input.querySelector('input').value);
        if (!result.ok) {
          error = result.error;
          return;
        }
        account = { hasEmail: true };
        nav.toast('Recovery email saved.');
        view = 'home';
      });
    };
    return [
      h('p', { class: 'dw-note' }, 'Optional. Used only to send you a new number if you lose yours. It is stored scrambled, so it cannot be read back.'),
      h(
        'form',
        { class: 'dw-cloud-form', onSubmit: submit },
        input,
        h('div', { class: 'dw-row-actions' }, button('Save email', { variant: 'primary', disabled: pending, onClick: submit }), button('Skip', { onClick: () => go('home') })),
      ),
    ];
  }

  function recoverPage() {
    const input = field({ label: 'Recovery email', type: 'email', autocomplete: 'email', inputmode: 'email' });
    const submit = (e) => {
      e.preventDefault();
      run(async () => {
        const result = await cloud.recover(input.querySelector('input').value);
        if (!result.ok) {
          error = result.error;
          return;
        }
        view = 'recover-sent';
      });
    };
    return [
      h('p', { class: 'dw-note' }, 'If this email is linked to an account, we send it a new number. Your old number stops working.'),
      h(
        'form',
        { class: 'dw-cloud-form', onSubmit: submit },
        input,
        h('div', { class: 'dw-row-actions' }, button('Send new number', { variant: 'primary', disabled: pending, onClick: submit }), button('Cancel', { onClick: () => go('login') })),
      ),
    ];
  }

  function render() {
    let body;
    if (view === 'number') body = numberPage();
    else if (view === 'login') body = loginPage();
    else if (view === 'email') body = emailPage();
    else if (view === 'recover') body = recoverPage();
    else if (view === 'recover-sent')
      body = [
        h('p', { class: 'dw-note' }, 'Check your inbox. If the address is linked to an account, a new number is on its way.'),
        h('div', { class: 'dw-row-actions' }, button('Log in', { variant: 'primary', onClick: () => go('login') })),
      ];
    else if (view === 'conflict') body = conflictBody(cloud, { toast: nav.toast, onDone: () => go('home'), onLater: () => go('home') });
    else body = home();
    nav.show([body, error ? h('p', { class: 'dw-note is-warn', role: 'alert' }, error) : null], TITLES[view] ?? 'Cloud save');
  }

  return {
    render,
    open(next = 'home') {
      go(next);
    },
    signUp() {
      view = 'home';
      run(signUp);
    },
  };
}

function saveCard(title, summary, onPick) {
  return h(
    'div',
    { class: 'dw-cloud-card' },
    h('h3', null, title),
    h(
      'dl',
      null,
      h('dt', null, 'Last played'),
      h('dd', null, ago(summary?.lastPlayed ?? summary?.updatedAt)),
      h('dt', null, 'Credits'),
      h('dd', null, summary?.credits != null ? formatCredits(summary.credits) : '?'),
      h('dt', null, 'Act'),
      h('dd', null, summary?.act ?? '?'),
      h('dt', null, 'Ships'),
      h('dd', null, summary?.ships ?? '?'),
    ),
    button('Keep this one', { variant: 'primary', block: true, onClick: onPick }),
  );
}

/** The two saves side by side, and a choice. */
function conflictBody(cloud, { toast, onDone, onLater }) {
  const { conflict } = cloud.status();
  if (!conflict) return [h('p', { class: 'dw-note' }, 'Nothing to choose: your saves agree.')];
  const pick = async (choice) => {
    const result = await cloud.resolve(choice);
    if (!result.ok) return toast(result.error ?? 'Could not reach the cloud. Try again.', 'warning');
    if (result.reload) {
      toast('Loading the cloud save…');
      setTimeout(() => location.reload(), 300);
      return;
    }
    toast('Saved this device’s company to the cloud.');
    onDone();
  };
  return [
    h('p', { class: 'dw-note' }, 'This device and the cloud have different saves. Keep one. The other stays available under Cloud save.'),
    h(
      'div',
      { class: 'dw-cloud-cards' },
      saveCard('This device', conflict.local, () => pick('device')),
      saveCard(conflict.cloud.otherDevice ? 'Other device' : 'Cloud', conflict.cloud, () => pick('cloud')),
    ),
    h('div', { class: 'dw-row-actions' }, button('Decide later', { onClick: onLater })),
    h('p', { class: 'dw-note' }, 'Until you choose, your progress is saved on this device only.'),
  ];
}

function openDialog(dialog, children) {
  dialog.replaceChildren(...[children].flat(Infinity).filter(Boolean));
  if (!dialog.open) dialog.showModal();
}

function dialogNav(dialog, title, toast) {
  return {
    show: (nodes, pageTitle = title) => openDialog(dialog, [h('span', { class: 'dw-eyebrow' }, 'Cloud save'), h('h2', { id: 'modal-title' }, pageTitle), nodes]),
    toast,
    done: () => dialog.close(),
  };
}

/** Opens the conflict prompt in the game's dialog. */
export function showConflict(dialog, { toast }) {
  const nav = dialogNav(dialog, 'Choose a save', toast);
  nav.show(conflictBody(cloud, { toast, onDone: () => dialog.close(), onLater: () => dialog.close() }));
}

/** The one-time offer to move a local company to the cloud. */
export function showMigrationOffer(dialog, { toast }) {
  const nav = dialogNav(dialog, 'Keep your company safe', toast);
  const pages = createCloudPages(cloud, nav);
  const later = () => {
    cloud.dismissMigration();
    dialog.close();
  };
  dialog.addEventListener('close', () => cloud.dismissMigration(), { once: true });
  nav.show([
    h('p', { class: 'dw-note' }, 'Your company is saved only in this browser. Move it to a cloud save to keep it if browser data is cleared, and to play on other devices. No name or email needed.'),
    h(
      'div',
      { class: 'dw-row-actions' },
      button('Create account', {
        variant: 'primary',
        onClick: () => {
          cloud.dismissMigration();
          pages.signUp();
        },
      }),
      button('I have a number', {
        onClick: () => {
          cloud.dismissMigration();
          pages.open('login');
        },
      }),
    ),
    h('div', { class: 'dw-row-actions' }, button('Not now', { onClick: later })),
    h('p', { class: 'dw-note' }, 'You can do this later from the menu: Cloud save.'),
  ]);
}

/**
 * The menu row and page (see the game menu). Returns null when the server
 * has no cloud saves, which hides the row.
 */
export function cloudSaveItem({ toast, menuItem, pageHead, show, close, back }) {
  const s = cloud.status();
  if (!s.enabled) return null;
  const badge = s.signedIn ? BADGES[s.state] : null;
  return menuItem({
    icon: CLOUD_ICON,
    label: 'Cloud save',
    sub: s.signedIn ? 'Autosave on' : 'Play on any device',
    badge: badge?.text,
    badgeVariant: badge?.variant,
    key: 'menu-cloud',
    chevron: true,
    onClick: () => {
      const pages = createCloudPages(cloud, { show: (nodes, title) => show([pageHead(title, { onBack: back }), nodes]), toast, done: close });
      pages.open(s.state === 'conflict' ? 'conflict' : 'home');
    },
  });
}
