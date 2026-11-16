// The Save row of the in-game menu (the save being played: its name, save
// code and cloud state), and the prompt that opens on its own when this
// device and the cloud hold different saves.
//
// Picking, naming and adding saves is the main menu's job (mainMenu.js).

import { formatCredits, formatDuration } from '../../../shared/js/format.js';
import { formatCode } from '../../../shared/js/cloudSync.js';
import { h } from './dom.js';
import { button } from './components.js';
import { currentSave, reloadIntoSave, slots } from '../core/saves.js';

const CLOUD_ICON =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.2 4.5 4.5 0 0 0 7 18z"/></svg>';

const BADGES = { synced: 'Saved', saving: 'Saving', offline: 'Offline', conflict: 'Choose save', error: 'Not saving' };

function ago(at) {
  if (!at) return 'unknown';
  const ms = Date.now() - at;
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

const reload = () => setTimeout(reloadIntoSave, 300);

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
      reload();
      return;
    }
    toast('Saved this device’s save to the cloud.');
    onDone();
  };
  return [
    h('p', { class: 'dw-note' }, 'This save was played on another device, and both have progress the other lacks. Keep one. The other stays available under Save in the menu.'),
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

/** Opens the conflict prompt in the game's dialog. */
export function showConflict(dialog, { toast }) {
  const cloud = currentSave()?.cloud;
  if (!cloud) return;
  const close = () => dialog.close();
  dialog.replaceChildren(
    ...[h('span', { class: 'dw-eyebrow' }, 'Cloud save'), h('h2', { id: 'modal-title' }, 'Choose a save'), conflictBody(cloud, { toast, onDone: close, onLater: close })].flat(Infinity).filter(Boolean),
  );
  if (!dialog.open) dialog.showModal();
}

/** The Save row of the in-game menu and its page. */
export function cloudSaveItem({ toast, menuItem, pageHead, show, back }) {
  const save = currentSave();
  if (!save) return null;
  const { cloud } = save;
  const name = () => slots.get(save.id)?.name ?? 'Save';
  const s = cloud.status();

  let view = s.state === 'conflict' ? 'conflict' : 'home';
  function render() {
    const status = cloud.status();
    if (view === 'conflict' && status.conflict) {
      return show([pageHead('Choose a save', { eyebrow: name(), onBack: back }), conflictBody(cloud, { toast, onDone: () => ((view = 'home'), render()), onLater: back })]);
    }
    const code = status.code ? formatCode(status.code) : null;
    const state = !status.enabled
      ? 'This save is kept in this browser.'
      : {
          synced: `Saved to the cloud ${ago(status.lastSyncedAt)}.`,
          saving: 'Saving to the cloud…',
          offline: 'Offline. The save is kept on this device and goes to the cloud when you are back online.',
          conflict: 'This device and the cloud have different saves. Choose one to continue saving.',
          error: 'The cloud save is from a newer version of the game. Reload the page to update.',
          local: 'Not saved to the cloud yet.',
        }[status.state];
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(status.code);
        toast('Code copied.');
      } catch {
        toast('Select the code and copy it.');
      }
    };
    show([
      pageHead(name(), { eyebrow: 'Save', onBack: back }),
      h('p', { class: 'dw-note' }, state),
      status.state === 'conflict' ? h('div', { class: 'dw-row-actions' }, button('Choose save', { variant: 'primary', onClick: () => ((view = 'conflict'), render()) })) : null,
      code
        ? h(
            'div',
            { class: 'dw-section' },
            h('h3', { class: 'dw-section-title' }, h('span', null, 'Save code')),
            h('output', { class: 'dw-cloud-number', 'aria-label': 'Save code' }, code),
            h('p', { class: 'dw-note' }, 'Enter this code on another device (Load game, Add a save with a code) to play this save there.'),
            h(
              'div',
              { class: 'dw-row-actions' },
              button('Copy code', { onClick: copy, key: 'save-copy' }),
              button('Save now', { disabled: status.state === 'conflict' || status.state === 'saving', onClick: () => cloud.sync().then(render) }),
            ),
          )
        : status.enabled
          ? h('div', { class: 'dw-row-actions' }, button('Try again', { onClick: () => cloud.sync().then(render) }))
          : null,
      status.backup
        ? h(
            'div',
            { class: 'dw-section' },
            h('h3', { class: 'dw-section-title' }, h('span', null, 'Replaced save')),
            h('p', { class: 'dw-note' }, `The save you did not keep (${status.backup.from === 'cloud' ? 'from the cloud' : 'from this device'}, replaced ${ago(status.backup.at)}). Credits: ${formatCredits(status.backup.data?.credits ?? 0)}.`),
            h(
              'div',
              { class: 'dw-row-actions' },
              button('Load it instead', {
                onClick: () => {
                  if (cloud.restoreBackup()) reload();
                },
              }),
            ),
          )
        : null,
    ]);
  }

  return menuItem({
    icon: CLOUD_ICON,
    label: 'Save',
    sub: s.code ? `${name()} · ${formatCode(s.code)}` : name(),
    badge: s.enabled ? BADGES[s.state] : null,
    key: 'menu-cloud',
    chevron: true,
    onClick: render,
  });
}
