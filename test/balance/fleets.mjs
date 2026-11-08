// Fleet earnings against hand play for Driftworks. From a save, the same
// ships in the same area run one mission per commander trait and level,
// and once more as "hand play": the same picks with no wait between orders
// and with the traits that lift every limit (Prospector and Greedy for
// mining, Greedy and Thrifty for trade). Each line shows what a fleet makes
// as a share of that.
//
//   npm run balance:fleets -- <save.json> [mine|trade] [hours]
//
// A save comes from the bot, for example:
//   npm run balance -- worker 22 --save-at=first-shielding:/tmp/act3.json
//
// One mission is one sample: markets move, so shares vary by about ten
// points between saves.

import { readFileSync } from 'node:fs';
import { LEVEL_EFFICIENCY, LEVEL_HOURS, TRAIT_IDS } from '../../public/games/driftworks/content/commanders.js';
import { systemOf, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { HULLS } from '../../public/games/driftworks/content/ships.js';
import { deserialize } from '../../public/games/driftworks/core/save.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { HOUR } from '../../public/games/driftworks/core/time.js';
import { candidates, fleetCommand, hireCommander } from '../../public/games/driftworks/systems/commanders.js';
import { joinFleet, startMission } from '../../public/games/driftworks/systems/missions.js';

const [savePath, kind = 'mine', hoursArg = '4'] = process.argv.slice(2);
if (!savePath) {
  console.log('Usage: node test/balance/fleets.mjs <save.json> [mine|trade] [hours]');
  process.exit(1);
}
const hours = Number(hoursArg);
const EFFICIENCY = [...LEVEL_EFFICIENCY];
const role = kind === 'mine' ? 'miner' : 'hauler';

/** Credits one mission brings in, from the save, with these traits at this level. */
function run(traits, level, hand = false) {
  const state = deserialize(readFileSync(savePath, 'utf8'));
  useGalaxy(state.seed);
  if (!state.research.done.includes('fleet-1')) state.research.done.push('fleet-1');
  // Hand play: the commander never waits between orders.
  for (let i = 0; i < EFFICIENCY.length; i += 1) LEVEL_EFFICIENCY[i] = hand ? 1 : EFFICIENCY[i];
  // The ships finish what they are doing, with nothing queued.
  for (const ship of state.ships) ship.queue = [];
  advance(state, state.now + 3 * HOUR);
  const now = state.now;
  state.credits = Math.max(state.credits, 10_000_000);
  const commander = hireCommander(state, candidates(state)[0].id, 'halcyon-shipyard', now).ship;
  commander.commander.traits = traits;
  commander.commander.missionTime = LEVEL_HOURS[level - 1] * HOUR;
  const ships = state.ships.filter((ship) => HULLS[ship.hull].role === role && !ship.order && ship.at).slice(0, fleetCommand(state).wing);
  if (!ships.length) throw new Error(`No idle ${role}s in this save.`);
  // The fleet sets out from where the first ship is, with every ship aboard.
  commander.at = ships[0].at;
  for (const ship of ships) {
    ship.at = commander.at;
    joinFleet(state, ship, commander, now);
  }
  const center = systemOf(commander.at);
  const started = startMission(state, commander, { kind, center, hours }, now);
  if (!started.ok) throw new Error(started.error);
  advance(state, now + (hours + 6) * HOUR);
  const report = commander.commander.report;
  return { credits: report?.credits ?? NaN, ships: ships.length, center };
}

const hand = run(kind === 'mine' ? ['prospector', 'greedy'] : ['greedy', 'thrifty'], 5, true);
console.log(`${kind}, ${hours} h, ${hand.ships} ships around ${hand.center}: hand play ${Math.round(hand.credits)} cr`);
console.log(`  ${'first trait'.padEnd(11)}  level 1  level 3  level 5   (second trait Cautious, Curious for Cautious)`);
for (const trait of TRAIT_IDS) {
  const second = trait === 'cautious' ? 'curious' : 'cautious';
  const shares = [1, 3, 5].map((level) => `${((run([trait, second], level).credits / hand.credits) * 100).toFixed(0)}%`.padStart(7));
  console.log(`  ${trait.padEnd(11)}  ${shares.join('  ')}`);
}
