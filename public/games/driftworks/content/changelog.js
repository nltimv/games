// Driftworks' own version and the player-facing changelog. The game version
// is separate from the Games Hub release: it changes only when Driftworks
// does. Each entry says what changed for the player, in plain words.
//
// The What's new card shows the entries newer than the version the save
// last saw (state.seenVersion), once, and the game menu shows them any time.

export const GAME_VERSION = '0.5.0';

/** Newest first. `title` is optional; `changes` are short sentences. */
export const CHANGELOG = [
  {
    version: '0.5.0',
    title: 'A proper menu, and a map that knows the way up',
    changes: [
      'A new game menu holds your settings, cloud save and the way back to the Games Hub.',
      'The button at the top left now takes you up from a system to the galaxy map.',
      'Scouts come with the warp drive. The Scout licence research is gone, and if it was still in your lab, its credits are back in your account.',
      'Cloud saves: make an account without any personal details, play on any device with autosave, and choose which save to keep when two devices disagree. Playing offline still works. Cloud saves replace backup codes.',
      'Research on a computer now shows the whole research tree, grouped by act, with what each research needs.',
      'This list shows up after each update, and the menu keeps it for later.',
    ],
  },
];

/** Compares two "major.minor.patch" versions: negative when a is older. */
export function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map(Number);
  const pb = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** Changelog entries the player has not seen: newer than `seen` (all of them when nothing was seen). */
export function unseenChanges(seen) {
  return CHANGELOG.filter((entry) => seen == null || compareVersions(entry.version, seen) > 0);
}
