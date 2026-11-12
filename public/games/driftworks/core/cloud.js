// Driftworks' cloud save: the shared cloud sync, told how to read a
// Driftworks save. One instance for the page; main.js starts it before the
// game loads its save.

import { createCloudSync } from '../../../shared/js/cloudSync.js';
import { GOALS } from '../content/goals.js';
import { deserialize } from './save.js';

export const SAVE_STORAGE_KEY = 'driftworks-save';

/** The act a save is in: the act of its first unfinished goal. */
function actOf(save) {
  const done = new Set(save.goals ?? []);
  const next = GOALS.find((goal) => !done.has(goal.id));
  return next ? (next.act ?? 1) : Math.max(...GOALS.map((goal) => goal.act ?? 1));
}

/** What the conflict prompt shows of a save. A save with no goals done counts as fresh. */
export function summarizeSave(save) {
  return {
    lastPlayed: save.lastSeenAt ?? save.now,
    credits: Math.round(save.credits ?? 0),
    act: actOf(save),
    ships: save.ships?.length ?? 0,
    fresh: !(save.goals?.length > 0),
  };
}

export const cloud = createCloudSync({
  game: 'driftworks',
  saveKey: SAVE_STORAGE_KEY,
  summarize: summarizeSave,
  canLoad: (data) => deserialize(data) != null,
});
