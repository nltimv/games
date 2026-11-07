import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSystems, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { HOUR } from '../../public/games/driftworks/core/time.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip, shipPrice } from '../../public/games/driftworks/systems/fleet.js';
import { candidates, commanderLevel, commanderPrice, hireCommander, hireLock, traitsOf, wingOf } from '../../public/games/driftworks/systems/commanders.js';
import { areaAround, canStartMission, doctrineOf, joinFleet, leaveFleet, recallMission, setDoctrine, startMission } from '../../public/games/driftworks/systems/missions.js';
import { cancelOrder, giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { newGame } from './helpers.mjs';

const ACT_2 = ['warp-drive', 'scout-licence', 'lane-charts', 'jump-1', 'kite-licence', 'sealed-holds', 'hold-1', 'hold-2', 'hold-3', 'laser-1', 'laser-2'];

/** A company early in act 3: one shielding, the near galaxy surveyed. */
function act3({ fleet = true } = {}) {
  const state = newGame({ credits: 1e8 });
  useGalaxy(state.seed);
  state.research.done.push(...ACT_2, 'shield-debris', ...(fleet ? ['fleet-1'] : []));
  for (const system of allSystems()) if (system.depth <= 2 && !system.hazard) markSurveyed(state, system.id, state.now);
  return state;
}

function hire(state, i = 0) {
  const result = hireCommander(state, candidates(state)[i].id, 'halcyon-shipyard');
  assert.ok(result.ok, result.error);
  return result.ship;
}

test('Fleet command I brings three commanders to hire, each with a different trait', () => {
  const state = act3({ fleet: false });
  assert.match(hireLock(state, 'halcyon-shipyard'), /Fleet command I/);
  state.research.done.push('fleet-1');
  assert.equal(hireLock(state, 'halcyon-shipyard'), null);
  assert.match(hireLock(state, 'halcyon-refinery'), /shipyards/);

  const offered = candidates(state);
  assert.equal(offered.length, 3);
  assert.equal(new Set(offered.map((c) => c.traits[0])).size, 3);
  assert.deepEqual(candidates(state), offered, 'the same three until a hire');

  const price = shipPrice(state);
  const credits = state.credits;
  const tamsin = hire(state, 1);
  assert.equal(tamsin.name, offered[1].name);
  assert.equal(tamsin.hull, 'osprey');
  assert.equal(state.credits, credits - 750000);
  assert.equal(shipPrice(state), price, 'a commander does not raise ship prices');
  assert.equal(commanderPrice(state), 1500000);
  assert.notDeepEqual(candidates(state).map((c) => c.name), offered.map((c) => c.name));
});

test('a wing holds 4 ships with Fleet command I, and ships can leave it', () => {
  const state = act3();
  const lead = hire(state);
  const ships = [state.ships[0], ...Array.from({ length: 4 }, () => createShip(state, 'mule', 'halcyon-shipyard'))];
  for (const ship of ships.slice(0, 4)) assert.ok(joinFleet(state, ship, lead).ok);
  assert.match(joinFleet(state, ships[4], lead).error, /full/);
  assert.match(joinFleet(state, lead, lead).error, /own/);
  assert.ok(leaveFleet(state, ships[0]).ok);
  assert.equal(wingOf(state, lead).length, 3);
  assert.ok(joinFleet(state, ships[4], lead).ok);
});

test('a mine mission works its area for the hours set, then the commander writes the log', () => {
  const state = act3();
  const lead = hire(state);
  const mules = [state.ships[0], createShip(state, 'mule', 'halcyon-refinery')];
  for (const mule of mules) joinFleet(state, mule, lead);
  assert.match(canStartMission(state, lead, { kind: 'trade', center: 'aurel', hours: 2 }).error, /needs a hauler/);
  assert.match(canStartMission(state, lead, { kind: 'mine', center: 'aurel', hours: 3 }).error, /hours/);
  const start = state.now;
  const started = startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 2 });
  assert.ok(started.ok, started.error);
  assert.ok(mules.every((m) => m.order?.missionBy === lead.id), 'the commander gives orders at once');

  // Between orders the commander takes a while to decide.
  let waited = false;
  for (let t = start; t < start + 2 * HOUR; t += 5 * 60_000) {
    advance(state, t);
    waited ||= mules.some((m) => m.order?.type === 'standby');
  }
  assert.ok(waited);
  assert.match(cancelOrder(state, mules.find((m) => m.order?.type === 'standby') ?? mules[0]).error ?? 'ok', /commander|ok/);

  advance(state, start + 4 * HOUR);
  assert.equal(lead.mission, null);
  const log = state.log.filter((e) => e.kind === 'fleet');
  assert.equal(log.length, 1);
  assert.match(log[0].text, new RegExp(`^${lead.name}, level 1`));
  assert.match(log[0].text, /Aurel area, 2 h/);
  assert.ok(lead.commander.report.credits > 0);
  assert.ok(lead.commander.report.mined > 0);
  assert.equal(lead.commander.missionTime, 2 * HOUR);
  assert.ok(mules.every((m) => !m.order), 'the ships wait once the mission is over');
});

test('a trade mission sends haulers on runs inside the area', () => {
  const state = act3();
  const lead = hire(state);
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  joinFleet(state, kite, lead);
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'trade', center: 'aurel', hours: 4 }).ok);
  advance(state, start + 5 * HOUR);
  const report = lead.commander.report;
  assert.ok(report.sold > 0, 'it sold something');
  assert.ok(report.credits > 0);
});

test('a survey mission surveys the systems around its centre', () => {
  const state = newGame({ credits: 1e8 });
  useGalaxy(state.seed);
  state.research.done.push(...ACT_2, 'shield-debris', 'fleet-1');
  const lead = hire(state);
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  joinFleet(state, lark, lead);
  const surveyed = state.surveyed.length;
  assert.ok(startMission(state, lead, { kind: 'survey', center: 'aurel', hours: 4 }).ok);
  advance(state, state.now + 5 * HOUR);
  assert.ok(state.surveyed.length > surveyed);
  assert.equal(lead.commander.report.surveyed, state.surveyed.length - surveyed);
});

test('a recall ends the mission early, and levels come from hours on missions', () => {
  const state = act3();
  const lead = hire(state);
  joinFleet(state, state.ships[0], lead);
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 4 }).ok);
  advance(state, start + HOUR);
  assert.ok(recallMission(state, lead).ok);
  advance(state, start + 3 * HOUR);
  assert.equal(lead.mission, null);
  assert.match(state.log.filter((e) => e.kind === 'fleet').at(-1).text, /called back after 1 h/);

  assert.equal(traitsOf(lead).length, 1);
  lead.commander.missionTime = 12 * HOUR;
  assert.equal(commanderLevel(lead), 3);
  assert.equal(traitsOf(lead).length, 2);
  lead.commander.missionTime = 100 * HOUR;
  assert.equal(commanderLevel(lead), 5);
});

test('a player order replaces a commander\'s wait, and fleets are kept in the save', () => {
  const state = act3();
  const lead = hire(state);
  const mule = state.ships[0];
  joinFleet(state, mule, lead);
  assert.ok(startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 4 }).ok);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.ships.find((s) => s.id === lead.id).mission.kind, 'mine');
  assert.equal(loaded.ships[0].fleet, lead.id);
  assert.equal(loaded.hires, 1);

  let t = state.now;
  while (mule.order?.type !== 'standby' && t < state.now + 4 * HOUR) advance(state, (t += 60_000));
  assert.equal(mule.order.type, 'standby');
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: 'aurel-post' }).ok);
  assert.equal(mule.order.type, 'fly');
});

test('Fleet command II brings standing orders, bigger wings and wider areas', () => {
  const state = act3();
  const lead = hire(state);
  assert.match(setDoctrine(state, lead, { feeLimit: 0 }).error, /Fleet command II/);
  assert.equal(areaAround(state, 'aurel', 1).length < areaAround(state, 'aurel', 2).length, true);
  state.research.done.push('fleet-2');
  assert.ok(setDoctrine(state, lead, { feeLimit: 0 }).ok);
  assert.equal(doctrineOf(lead).feeLimit, 0);
  assert.equal(doctrineOf(lead).factions, 'any');

  // With no fees allowed, a trade fleet stays in its own system.
  const kites = [createShip(state, 'kite', 'halcyon-shipyard'), createShip(state, 'kite', 'halcyon-shipyard')];
  for (const kite of kites) joinFleet(state, kite, lead);
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'trade', center: 'aurel', hours: 8 }).ok);
  advance(state, start + 9 * HOUR);
  assert.equal(lead.commander.report.fees, 0);
  assert.equal(lead.commander.report.jumps, 0);
  assert.ok(lead.commander.report.sold > 0);
});
