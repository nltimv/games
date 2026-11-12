import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSystems, findSystem, lanesFrom, systemOf, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { HOUR } from '../../public/games/driftworks/core/time.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { allowance, finishBuild, pointsUsed } from '../../public/games/driftworks/systems/shipyard.js';
import { candidates, commanderLevel, commandersComing, hireCommander, hireCost, hireLock, joiningOf, mapShips, onMap, traitsOf, wingOf } from '../../public/games/driftworks/systems/commanders.js';
import * as missions from '../../public/games/driftworks/systems/missions.js';
import { areaAround, canStartMission, doctrineOf, joinFleet, leaveFleet, setDoctrine, startMission } from '../../public/games/driftworks/systems/missions.js';
import { cancelOrder, giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { plotCourse } from '../../public/games/driftworks/systems/travel.js';
import { buyersOf } from '../../public/games/driftworks/systems/advisor.js';
import { sellToStation } from '../../public/games/driftworks/systems/market.js';
import { newGame } from './helpers.mjs';

const ACT_2 = ['warp-drive', 'lane-charts', 'jump-1', 'sealed-holds', 'hold-1', 'hold-2', 'hold-3', 'laser-1', 'laser-2'];

/** A company early in act 3: one shielding, the near galaxy surveyed. */
function act3({ fleet = true } = {}) {
  const state = newGame({ credits: 1e8 });
  useGalaxy(state.seed);
  state.research.done.push(...ACT_2, 'shield-debris', ...(fleet ? ['fleet-1'] : []));
  for (const system of allSystems()) if (system.depth <= 2 && !system.hazard) markSurveyed(state, system.id, state.now);
  return state;
}

/** Hires a commander and finishes their Osprey at once. */
function hire(state, i = 0) {
  const result = hireCommander(state, candidates(state)[i].id, 'halcyon-shipyard');
  assert.ok(result.ok, result.error);
  return finishBuild(state, result.build, state.now);
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

  const credits = state.credits;
  const cost = hireCost(state, 'halcyon-shipyard');
  assert.equal(cost.price, 750000);
  assert.ok(cost.ship > 40000, 'the Osprey is built too');
  const tamsin = hire(state, 1);
  assert.equal(tamsin.name, offered[1].name);
  assert.equal(tamsin.hull, 'osprey');
  assert.equal(state.credits, credits - cost.total);
  assert.equal(hireCost(state, 'halcyon-shipyard').price, 1500000);
  assert.notDeepEqual(candidates(state).map((c) => c.name), offered.map((c) => c.name));
});

test('a commander takes command once their Osprey is built, and needs its points free', () => {
  const state = act3();
  const used = pointsUsed(state);
  const result = hireCommander(state, candidates(state)[0].id, 'halcyon-shipyard');
  assert.ok(result.ok, result.error);
  assert.ok(!state.ships.some((ship) => ship.commander), 'not yet');
  assert.deepEqual(commandersComing(state), [result.build]);
  assert.equal(pointsUsed(state), used + 2, 'its points are taken at once');
  assert.equal(result.build.endsAt - state.now, 2 * HOUR);
  advance(state, result.build.endsAt);
  const lead = state.ships.find((ship) => ship.commander);
  assert.equal(lead.name, result.build.name);
  assert.equal(lead.at, 'halcyon-shipyard');
  assert.deepEqual(commandersComing(state), []);
  // No room for another Osprey: the hire waits.
  while (pointsUsed(state) < allowance(state)) createShip(state, 'mule', 'halcyon-shipyard');
  const next = hireCommander(state, candidates(state)[0].id, 'halcyon-shipyard');
  assert.equal(next.ok, false);
  assert.match(next.error, /allowance point/);
});

/** Ships of a hull, new at the shipyard where commanders are hired, so they go aboard at once. */
function atYard(state, hull, n) {
  return Array.from({ length: n }, () => createShip(state, hull, 'halcyon-shipyard'));
}

test('a ship docked with its commander goes aboard at once, and one elsewhere flies there first', () => {
  const state = act3();
  const lead = hire(state);
  const mule = state.ships[0];
  assert.notEqual(mule.at, lead.at);
  const [a, b, c, d] = atYard(state, 'mule', 4);
  for (const ship of [a, b, c]) assert.deepEqual(joinFleet(state, ship, lead), { ok: true, boarded: true });
  assert.ok([a, b, c].every((ship) => ship.fleet === lead.id && ship.at === null && !onMap(ship)), 'aboard, off the maps');

  // The fourth place goes to the mule on its way, so the wing is full.
  const far = joinFleet(state, mule, lead);
  assert.ok(far.ok && !far.boarded);
  assert.equal(mule.order.type, 'join');
  assert.deepEqual(joiningOf(state, lead), [mule]);
  assert.match(joinFleet(state, d, lead).error, /full/);
  assert.match(joinFleet(state, lead, lead).error, /own/);
  assert.match(giveOrder(state, mule, { type: 'fly', stationId: 'halcyon-refinery' }).error, /join a fleet/);

  advance(state, state.now + 30 * 60_000);
  assert.equal(mule.fleet, lead.id);
  assert.equal(mule.at, null);
  assert.equal(wingOf(state, lead).length, 4);
  assert.ok(!mapShips(state).includes(mule));

  // Aboard, a ship takes no orders of the player's until it leaves, where the command ship docks.
  assert.match(giveOrder(state, a, { type: 'fly', stationId: 'halcyon-refinery' }).error, /fleet/);
  assert.match(cancelOrder(state, a).error, /fleet/);
  assert.ok(leaveFleet(state, a).ok);
  assert.equal(a.fleet, null);
  assert.equal(a.at, lead.at);
  assert.ok(giveOrder(state, a, { type: 'fly', stationId: 'halcyon-refinery' }).ok);
  assert.ok(joinFleet(state, d, lead).ok);
});

test('a ship on its way follows its commander when the command ship moves on', () => {
  const state = act3();
  const lead = hire(state);
  const mule = state.ships[0];
  assert.ok(joinFleet(state, mule, lead).ok);
  assert.ok(giveOrder(state, lead, { type: 'fly', stationId: 'halcyon-foundry' }).ok);
  advance(state, state.now + 60 * 60_000);
  assert.equal(lead.at, 'halcyon-foundry');
  assert.equal(mule.fleet, lead.id);
  assert.equal(mule.at, null);
});

test('a command ship pays each jump for every ship aboard, and they move with it', () => {
  const state = act3();
  const lead = hire(state);
  const ships = atYard(state, 'kite', 2);
  for (const ship of ships) joinFleet(state, ship, lead);
  const next = lanesFrom('aurel').map(({ to }) => findSystem(to)).find((system) => system.stations.length);
  const target = next.stations[0].id;
  const alone = plotCourse(state, createShip(state, 'kite', 'halcyon-shipyard'), 'halcyon-shipyard', target).fees;
  assert.ok(alone > 0);
  assert.equal(plotCourse(state, lead, lead.at, target).fees, alone * 3);
  const credits = state.credits;
  assert.ok(giveOrder(state, lead, { type: 'fly', stationId: target }).ok);
  advance(state, state.now + 3 * HOUR);
  assert.equal(lead.at, target);
  assert.equal(credits - state.credits, alone * 3);
  assert.ok(leaveFleet(state, ships[0]).ok);
  assert.equal(ships[0].at, target);
});

test('a mine mission works its area for the hours set, off the maps, then the commander writes the log', () => {
  const state = act3();
  const lead = hire(state);
  const mules = atYard(state, 'mule', 2);
  for (const mule of mules) joinFleet(state, mule, lead);
  assert.match(canStartMission(state, lead, { kind: 'trade', center: 'aurel', hours: 2 }).error, /needs a hauler/);
  assert.match(canStartMission(state, lead, { kind: 'mine', center: 'aurel', hours: 3 }).error, /hours/);
  const start = state.now;
  const started = startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 2 });
  assert.ok(started.ok, started.error);
  assert.ok(mules.every((m) => m.order?.missionBy === lead.id), 'the commander gives orders at once');
  assert.ok(![lead, ...mules].some(onMap), 'the fleet is off the maps');
  assert.equal(missions.recallMission, undefined, 'a mission cannot be called back');
  assert.match(giveOrder(state, lead, { type: 'fly', stationId: 'halcyon-refinery' }).error, /away on a mission/);
  assert.match(cancelOrder(state, mules[0]).error, /fleet/);

  // Between orders the commander takes a while to decide.
  let waited = false;
  for (let t = start; t < start + 2 * HOUR; t += 5 * 60_000) {
    advance(state, t);
    waited ||= mules.some((m) => m.order?.type === 'standby');
  }
  assert.ok(waited);

  advance(state, start + 4 * HOUR);
  assert.equal(lead.mission, null);
  const log = state.log.filter((e) => e.kind === 'fleet');
  assert.equal(log.length, 1);
  assert.match(log[0].text, new RegExp(`^${lead.name}, level 1`));
  assert.match(log[0].text, /Aurel area, 2 h/);
  assert.ok(lead.commander.report.credits > 0);
  assert.ok(lead.commander.report.mined > 0);
  assert.equal(lead.commander.missionTime, 2 * HOUR);
  assert.ok(mules.every((m) => !m.order && m.at === null && m.fleet === lead.id), 'the wing is back aboard');
  assert.ok(onMap(lead));
  // Out of contact: the company log has only the captain's log of the mission, with what it brought in.
  const during = state.log.filter((e) => e.at > start && [lead, ...mules].some((ship) => e.text.startsWith(ship.name)));
  assert.deepEqual(during.map((e) => e.kind), ['fleet']);
  assert.equal(during[0].amount, Math.round(lead.commander.report.credits));
});

test('after a mission elsewhere the wing flies back to the command ship at the centre', () => {
  const state = act3();
  const lead = hire(state);
  const mules = atYard(state, 'mule', 2);
  for (const mule of mules) joinFleet(state, mule, lead);
  const center = lanesFrom('aurel').map(({ to }) => findSystem(to)).find((system) => system.stations.length && areaAround(state, system.id, 1).length);
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'mine', center: center.id, hours: 2 }).ok);
  advance(state, start + 6 * HOUR);
  assert.equal(lead.mission, null);
  assert.equal(lead.at, center.stations[0].id);
  assert.ok(mules.every((m) => m.at === null && !m.order));
  assert.ok(leaveFleet(state, mules[0]).ok);
  assert.equal(mules[0].at, center.stations[0].id);
});

test('a wing ship holding ore that no station has room for waits instead of spinning in place', () => {
  const state = act3();
  const lead = hire(state);
  // Every station that buys ferrite ore is full, and the fleet sets out from the first one in Aurel.
  const buyers = buyersOf(state, 'ferrite-ore');
  for (const { station } of buyers) sellToStation(state, station.id, 'ferrite-ore', 1e7);
  lead.at = buyers.find(({ station }) => systemOf(station.id) === 'aurel').station.id;
  const mule = createShip(state, 'mule', lead.at);
  assert.ok(joinFleet(state, mule, lead).boarded);
  mule.cargo['ferrite-ore'] = 100;
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 2 }).ok);
  for (let t = start; t <= start + 4 * HOUR; t += HOUR) {
    advance(state, t);
    assert.ok(!mule.order || mule.order.endsAt >= state.now, 'orders never fall behind the clock');
  }
  assert.equal(lead.mission, null);
});

test('a trade mission sends haulers on runs inside the area', () => {
  const state = act3();
  const lead = hire(state);
  const [kite] = atYard(state, 'kite', 1);
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
  const [lark] = atYard(state, 'lark', 1);
  joinFleet(state, lark, lead);
  const surveyed = state.surveyed.length;
  assert.ok(startMission(state, lead, { kind: 'survey', center: 'aurel', hours: 4 }).ok);
  advance(state, state.now + 5 * HOUR);
  assert.ok(state.surveyed.length > surveyed);
  assert.equal(lead.commander.report.surveyed, state.surveyed.length - surveyed);
});

test('levels come from hours on missions, and a second trait shows at level 3', () => {
  const state = act3();
  const lead = hire(state);
  assert.equal(traitsOf(lead).length, 1);
  lead.commander.missionTime = 24 * HOUR;
  assert.equal(commanderLevel(lead), 3);
  assert.equal(traitsOf(lead).length, 2);
  lead.commander.missionTime = 120 * HOUR;
  assert.equal(commanderLevel(lead), 5);
});

test('a commander sets out only once docked, and fleets are kept in the save', () => {
  const state = act3();
  const lead = hire(state);
  const [mule] = atYard(state, 'mule', 1);
  joinFleet(state, mule, lead);
  assert.ok(giveOrder(state, lead, { type: 'fly', stationId: 'halcyon-refinery' }).ok);
  assert.match(canStartMission(state, lead, { kind: 'mine', center: 'aurel', hours: 4 }).error, /docks/);
  assert.ok(joinFleet(state, createShip(state, 'mule', 'halcyon-shipyard'), lead).ok, 'ships can still join while it flies');
  advance(state, state.now + HOUR);
  assert.ok(startMission(state, lead, { kind: 'mine', center: 'aurel', hours: 4 }).ok);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.ships.find((s) => s.id === lead.id).mission.kind, 'mine');
  assert.equal(loaded.ships.find((s) => s.id === mule.id).fleet, lead.id);
  assert.equal(loaded.hires, 1);
  assert.match(joinFleet(state, createShip(state, 'mule', 'halcyon-shipyard'), lead).error, /away on a mission/);
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
  for (const kite of atYard(state, 'kite', 2)) joinFleet(state, kite, lead);
  const start = state.now;
  assert.ok(startMission(state, lead, { kind: 'trade', center: 'aurel', hours: 8 }).ok);
  advance(state, start + 9 * HOUR);
  assert.equal(lead.commander.report.fees, 0);
  assert.equal(lead.commander.report.jumps, 0);
  assert.ok(lead.commander.report.sold > 0);
});
