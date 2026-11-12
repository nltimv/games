// The game menu: Continue, What's new, Settings, the save being played, the
// main menu and the way back to the Games Hub, with the game version at the
// bottom. It opens in the shared modal dialog; What's new and Settings open
// as pages inside it, with a Back button to the menu.

import { CHANGELOG, GAME_VERSION, unseenChanges } from '../content/changelog.js';
import { h, svgIcon } from './dom.js';
import { button } from './components.js';
import { settingsPage } from './modals.js';
import { cloudSaveItem } from './cloudSave.js';

const HUB_URL = '/';

const ICONS = {
  play: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2Z"/></svg>',
  news: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m10 2.5 1.9 4.4 4.6.4-3.5 3 1 4.6L10 12.5l-4 2.4 1-4.6-3.5-3 4.6-.4Z"/></svg>',
  settings: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" /></svg>',
  hub: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5.5" height="5.5" rx="1.4"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.4"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.4"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.4"/></svg>',
  back: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  chevron: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 2.5 4.5 4.5L5 11.5"/></svg>',
};

/** One row of the menu: an icon, a label, a line under it, and a chevron when it opens a page. */
export function menuItem({ icon, label, sub, onClick, href, key, chevron = false, badge }) {
  const children = [
    h('span', { class: 'dw-gm-icon' }, svgIcon(ICONS[icon] ?? icon)),
    h('span', { class: 'dw-gm-text' }, h('strong', null, label, badge ? h('span', { class: 'dw-gm-badge' }, badge) : null), sub ? h('span', null, sub) : null),
    chevron ? h('span', { class: 'dw-gm-chevron' }, svgIcon(ICONS.chevron)) : null,
  ];
  if (href) return h('a', { class: 'dw-gm-item glass-btn', href, dataset: { key } }, children);
  return h('button', { type: 'button', class: 'dw-gm-item glass-btn', onClick, dataset: { key } }, children);
}

/** A page's heading, with a Back button when it was opened from the menu. */
export function pageHead(title, { eyebrow = 'Driftworks', onBack } = {}) {
  return h(
    'div',
    { class: 'dw-modal-head' },
    onBack ? h('button', { type: 'button', class: 'dw-round glass-btn', onClick: onBack, 'aria-label': 'Back to the menu', title: 'Back to the menu', dataset: { key: 'menu-back' } }, svgIcon(ICONS.back)) : null,
    h('div', null, h('span', { class: 'dw-eyebrow' }, eyebrow), h('h2', { id: 'modal-title' }, title)),
  );
}

/** The changelog entries, newest first. */
function changelogList(entries) {
  return h(
    'div',
    { class: 'dw-changelog' },
    entries.map((entry) =>
      h(
        'section',
        { class: 'dw-changelog-entry' },
        h('h3', null, h('span', { class: 'dw-changelog-version' }, `Version ${entry.version}`), entry.title ? h('span', null, entry.title) : null),
        h(
          'ul',
          null,
          entry.changes.map((text) => h('li', null, text)),
        ),
      ),
    ),
  );
}

/**
 * The game menu. `open()` shows the menu; `whatsNew()` shows What's new on
 * its own (after an update), and returns false when there is nothing new.
 */
export function createGameMenu({ dialog, session, toast }) {
  let page = 'menu';
  let afterClose = null;

  dialog.addEventListener('close', () => {
    const next = afterClose;
    afterClose = null;
    page = 'menu';
    next?.();
  });

  function show(children) {
    dialog.replaceChildren(...[children].flat(Infinity).filter(Boolean));
    dialog.classList.add('is-menu');
    if (!dialog.open) dialog.showModal();
    // Focus the first control, so keyboard players can move through it, and
    // start at the top (the dialog's own focus can scroll to a lower button).
    dialog.querySelector('[data-key]')?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function goTo(next) {
    page = next;
    render();
  }

  /** The main menu shows when the game opens: save, then open it again. */
  function toMainMenu() {
    session.save();
    location.reload();
  }

  function render() {
    if (page === 'whats-new') return show(whatsNewPage({ fromMenu: true }));
    if (page === 'settings') return show(settingsPage({ session, onToast: toast, onDone: close, head: pageHead('Settings', { onBack: () => goTo('menu') }) }));
    const fresh = unseenChanges(session.state.seenVersion).length > 0;
    return show([
      pageHead('Menu'),
      h(
        'nav',
        { class: 'dw-gm-list', 'aria-label': 'Game menu' },
        menuItem({ icon: 'play', label: 'Continue', sub: 'Back to your company', onClick: close, key: 'menu-continue' }),
        menuItem({ icon: 'news', label: "What's new", sub: `Changes in version ${GAME_VERSION}`, onClick: () => goTo('whats-new'), key: 'menu-whats-new', chevron: true, badge: fresh ? 'New' : null }),
        menuItem({ icon: 'settings', label: 'Settings', sub: 'Start over', onClick: () => goTo('settings'), key: 'menu-settings', chevron: true }),
        cloudSaveItem({ session, toast, menuItem, pageHead, show, close, back: () => goTo('menu') }),
        menuItem({ icon: 'back', label: 'Main menu', sub: 'New game, load another save', onClick: toMainMenu, key: 'menu-main' }),
        menuItem({ icon: 'hub', label: 'Back to Games Hub', sub: 'Your company keeps working while you are away', href: HUB_URL, key: 'menu-hub' }),
      ),
      h('p', { class: 'dw-gm-version' }, `Driftworks ${GAME_VERSION}`),
    ]);
  }

  function whatsNewPage({ fromMenu }) {
    const unseen = unseenChanges(session.state.seenVersion);
    // Reading it counts as seen.
    session.markVersionSeen(GAME_VERSION);
    const entries = fromMenu ? CHANGELOG : unseen.length ? unseen : CHANGELOG.slice(0, 1);
    return [
      pageHead("What's new", { eyebrow: `Driftworks ${GAME_VERSION}`, onBack: fromMenu ? () => goTo('menu') : null }),
      changelogList(entries),
      fromMenu ? null : h('div', { class: 'dw-row-actions' }, button('Continue', { variant: 'primary', onClick: close, key: 'whats-new-continue' })),
    ];
  }

  return {
    open(start = 'menu') {
      page = start;
      render();
    },
    /** Opens What's new when the game changed since the player last looked; `then` runs once it closes. */
    whatsNew({ then } = {}) {
      if (!unseenChanges(session.state.seenVersion).length) return false;
      afterClose = then ?? null;
      page = 'whats-new-alone';
      show(whatsNewPage({ fromMenu: false }));
      return true;
    },
    close,
    get page() {
      return dialog.open ? page : null;
    },
  };
}
