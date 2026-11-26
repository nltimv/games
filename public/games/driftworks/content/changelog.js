// Driftworks' own version and the player-facing changelog. The game version
// is separate from the Games Hub release: it changes only when Driftworks
// does. Each entry says what changed for the player, in plain words.
//
// The What's new card shows the entries newer than the version the save
// last saw (state.seenVersion), once, and the game menu shows them any time.

export const GAME_VERSION = '0.6.0';

/** Newest first. `title` is optional; `changes` are short sentences. */
export const CHANGELOG = [
  {
    version: '0.6.0',
    title: 'Engines through the gates',
    changes: [
      'Engines now set how fast a ship jumps through a warp gate, as well as how fast it flies. A Lark jumps quickest, a Heron beats a Kite, and a Mule takes its time.',
      'Jump drive I and II are now Engines III and IV, at the same price. If you had them, your ships already have the new engines; one still in the lab carries on as the engines.',
      'Warp lanes and gates no longer show a jump time, as it depends on the ship. Orders still show the whole trip.',
      'Asteroid fields get richer the further you go: the systems next to Aurel are no richer than its own fields, and the best fields are far out. Fields show their richness, such as ×1.6.',
      'Market charts on the galaxy map show how much the cheapest seller has in stock.',
    ],
  },
  {
    version: '0.5.1',
    title: 'Driftworks as an app',
    changes: [
      'Driftworks now also comes as an app for Android and iOS. Save codes work there too: enter yours in the app to carry on with the same company.',
      'The map now frames your system correctly when the screen around it has borders, such as a phone’s notch.',
      'On a phone, press and hold a ship to pick several at once: tap more ships to add them (or take them out), then hold a place to give them all an order.',
    ],
  },
  {
    version: '0.5.0',
    title: 'A proper menu, and a map that knows the way up',
    changes: [
      'The game opens with a main menu: continue, start a new game, or load another save. You can keep several saves and name them.',
      'A new in-game menu holds What’s new, settings, your save and the way back to the Games Hub.',
      'The button at the top left now takes you up from a system to the galaxy map.',
      'Scouts come with the warp drive. The Scout licence research is gone, and if it was still in your lab, its credits are back in your account.',
      'Cloud saves: every save gets a save code. Enter the code on another device to play the same save there, with autosave. No account or personal details needed, and playing offline still works. Save codes replace backup codes.',
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
