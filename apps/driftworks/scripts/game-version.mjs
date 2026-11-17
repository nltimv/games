// Prints Driftworks' own version (GAME_VERSION in the game's changelog),
// which the apps show as their version in the stores and in Settings.
// The store build number comes from the Games Hub release instead (see
// build-number.mjs), so it still grows with every release.

import { GAME_VERSION } from '../../../public/games/driftworks/content/changelog.js';

console.log(GAME_VERSION);
