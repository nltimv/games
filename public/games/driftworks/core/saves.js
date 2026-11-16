// Driftworks' saves: several named saves on this device, each with a save
// code that loads it on any device (see shared/js/saveSlots.js and
// cloudSync.js). main.js picks a save in the main menu, then starts the
// cloud sync for it and keeps it here for the in-game menu.

import { createCloudApi, createCloudSync } from '../../../shared/js/cloudSync.js';
import { createSaveSlots } from '../../../shared/js/saveSlots.js';
import { GOALS } from '../content/goals.js';
import { deserialize, isOutdated } from './save.js';

const GAME = 'driftworks';
/** Where the one save of versions before 0.5.0 lived. */
const LEGACY_SAVE_KEY = 'driftworks-save';
export const LEGACY_SAVE_NAME = 'My company';

export const slots = createSaveSlots({ game: GAME });
export const cloudApi = createCloudApi({ game: GAME });

/** The act a save is in: the act of its first unfinished goal. */
function actOf(save) {
  const done = new Set(save.goals ?? []);
  const next = GOALS.find((goal) => !done.has(goal.id));
  return next ? (next.act ?? 1) : Math.max(...GOALS.map((goal) => goal.act ?? 1));
}

/** What the save list and the conflict prompt show of a save. A save with no goals done counts as fresh. */
export function summarizeSave(save) {
  return {
    lastPlayed: save.lastSeenAt ?? save.now,
    credits: Math.round(save.credits ?? 0),
    act: actOf(save),
    ships: save.ships?.length ?? 0,
    fresh: !(save.goals?.length > 0),
  };
}

export const canLoadSave = (data) => deserialize(data) != null;

/** A slot's summary for the save list: null for a new save, { outdated } for one this version cannot load. */
export function slotSummary(id) {
  const data = slots.data(id);
  if (!data) return null;
  if (isOutdated(data) || !Number.isFinite(data.credits)) return { outdated: true };
  try {
    return summarizeSave(data);
  } catch {
    return { outdated: true };
  }
}

/** Moves the single save of earlier versions into a named save, once. */
export function adoptLegacySave() {
  return slots.list().length ? null : slots.adoptLegacy(LEGACY_SAVE_KEY, LEGACY_SAVE_NAME);
}

let current = null;

/** The save being played: { slot, cloud }, or null in the main menu. */
export function currentSave() {
  return current;
}

/** Starts playing a save: creates its cloud sync. Call `cloud.start()` before the game reads the save. */
export function openSave(id) {
  slots.touch(id);
  const cloud = createCloudSync({
    game: GAME,
    saveKey: slots.saveKey(id),
    metaKey: slots.metaKey(id),
    getName: () => slots.get(id)?.name ?? '',
    summarize: summarizeSave,
    canLoad: canLoadSave,
  });
  current = { id, cloud, saveName: slots.saveName(id) };
  return current;
}

const RESUME_KEY = 'driftworks-resume';

/** Reloads the page straight back into the save being played, skipping the main menu (after a cloud save replaced the local one). */
export function reloadIntoSave() {
  try {
    if (current) sessionStorage.setItem(RESUME_KEY, current.id);
  } catch {
    // Without it the main menu shows, and Continue leads back here.
  }
  location.reload();
}

/** The save to go straight back into after reloadIntoSave(), once. */
export function takeResume() {
  try {
    const id = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return id && slots.get(id) ? id : null;
  } catch {
    return null;
  }
}
