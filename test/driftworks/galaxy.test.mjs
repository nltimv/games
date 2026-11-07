import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALAXY_SIZE,
  HAZARD_DEPTH,
  findStation,
  findSystem,
  gateTo,
  generateGalaxy,
  lanesFrom,
  systemOf,
  useGalaxy,
} from '../../public/games/driftworks/content/galaxy.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { chartedSystems, isSurveyed, markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { cancelOrder, giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { flightTime, plotCourse, shipPosition } from '../../public/games/driftworks/systems/travel.js';
import { MINUTE, firstShip, newGame } from './helpers.mjs';

function crosses(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

test('a seed always makes the same galaxy of about 200 linked systems', () => {
  const a = generateGalaxy(77);
  const b = generateGalaxy(77);
  assert.deepEqual(a, b);
  assert.equal(a.systems.length, GALAXY_SIZE);
  assert.notDeepEqual(generateGalaxy(78).systems.map((s) => s.name), a.systems.map((s) => s.name));

  const ids = a.systems.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'system ids are unique');
  const placeIds = a.systems.flatMap((s) => [...s.stations, ...s.fields, ...s.planets, ...s.gates].map((p) => p.id));
  assert.equal(new Set(placeIds).size, placeIds.length, 'place ids are unique');

  // Every system can be reached from Aurel, at a depth one more than a neighbour.
  assert.ok(a.systems.every((s) => Number.isFinite(s.depth)));
  assert.ok(a.systems.filter((s) => s.depth >= HAZARD_DEPTH).every((s) => s.hazard));
  assert.ok(a.systems.filter((s) => s.depth < HAZARD_DEPTH).every((s) => !s.hazard));
});

test('lanes never cross, and Aurel keeps its four neighbours', () => {
  const g = generateGalaxy(1234);
  const at = Object.fromEntries(g.systems.map((s) => [s.id, { x: s.gx, y: s.gy }]));
  for (let i = 0; i < g.lanes.length; i += 1) {
    for (let j = i + 1; j < g.lanes.length; j += 1) {
      const p = g.lanes[i];
      const q = g.lanes[j];
      if ([p.a, p.b].some((id) => id === q.a || id === q.b)) continue;
      assert.ok(!crosses(at[p.a], at[p.b], at[q.a], at[q.b]), `${p.a}-${p.b} crosses ${q.a}-${q.b}`);
    }
  }
  const home = g.lanes.filter((l) => l.a === 'aurel' || l.b === 'aurel').map((l) => (l.a === 'aurel' ? l.b : l.a));
  assert.deepEqual(home.sort(), ['brennan', 'dace', 'elm', 'fenn']);
  for (const lane of g.lanes) {
    assert.ok(lane.minutes >= 6 && lane.minutes <= 15);
    assert.ok(lane.fee >= 300 && lane.fee <= 800);
  }
});

test('every system has a gate per lane, and five factions share the galaxy', () => {
  const g = useGalaxy(1234);
  for (const system of g.systems) {
    const links = lanesFrom(system.id);
    assert.equal(system.gates.length, links.length, system.name);
    for (const { to } of links) assert.ok(gateTo(system.id, to), `${system.name} has a gate to ${to}`);
  }
  assert.equal(Object.keys(g.factions).length, 5);
  assert.equal(findSystem('aurel').faction, 'halcyon');
  assert.ok(g.systems.every((s) => g.factions[s.faction]));
  // Deeper systems have richer fields and new ores.
  const deep = g.systems.filter((s) => s.depth >= 3 && s.depth <= 4).flatMap((s) => s.fields);
  assert.ok(deep.some((f) => f.good === 'titanium-ore' || f.good === 'crystal-ore'));
  assert.ok(deep.every((f) => f.richness >= 1.4));
});

test('ships cannot jump before the warp drive', () => {
  const state = newGame();
  const mule = firstShip(state);
  const station = findSystem('brennan').stations[0];
  markSurveyed(state, 'brennan', state.now);
  const course = plotCourse(state, mule, mule.at, station.id);
  assert.equal(course.ok, false);
  assert.match(course.error, /warp drive/);
  assert.equal(giveOrder(state, mule, { type: 'fly', stationId: station.id }).ok, false);
});

test('a course to another system flies to the gate, jumps and flies on', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
  const mule = firstShip(state);
  const brennan = findSystem('brennan');
  const station = brennan.stations[0];

  const blind = plotCourse(state, mule, mule.at, station.id);
  assert.equal(blind.ok, false, 'Brennan has not been surveyed');
  markSurveyed(state, 'brennan', state.now);

  const course = plotCourse(state, mule, mule.at, station.id);
  assert.ok(course.ok);
  assert.equal(course.jumps, 1);
  const [toGate, jump, onward] = course.legs;
  assert.equal(toGate.to, 'gate-brennan');
  assert.equal(toGate.end, flightTime(mule, mule.at, 'gate-brennan'));
  assert.ok(jump.jump);
  assert.equal(jump.to, gateTo('brennan', 'aurel').id);
  assert.ok(jump.end - jump.start >= 6 * MINUTE && jump.end - jump.start <= 15 * MINUTE);
  assert.equal(onward.to, station.id);
  assert.equal(course.fees, jump.fee);

  // The fee is paid when the order starts.
  const credits = state.credits;
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: station.id }).ok);
  assert.equal(state.credits, credits - course.fees);
  assert.equal(state.stats.jumps, 1);

  // Halfway through the jump the ship is between the two systems.
  const mid = (jump.start + jump.end) / 2 + state.now;
  assert.deepEqual(shipPosition(mule, mid).jump.from, 'aurel');
  assert.equal(shipPosition(mule, mid).system, null);
  advance(state, state.now + course.time + 1000);
  assert.equal(mule.at, station.id);
  assert.equal(systemOf(mule.at), 'brennan');
});

test('cancelling before a jump gives its fee back, and the ship waits at the gate', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const mule = firstShip(state);
  const station = findSystem('brennan').stations[0];
  const start = state.credits;
  giveOrder(state, mule, { type: 'fly', stationId: station.id });
  const result = cancelOrder(state, mule, state.now + 10_000);
  assert.ok(result.ok && result.flying);
  assert.equal(state.credits, start, 'the fee is back');
  advance(state, state.now + 10 * MINUTE);
  assert.equal(mule.at, 'gate-brennan');
});

test('a scout surveys a system next to a surveyed one, opening it to other ships', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive', 'scout-licence');
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  assert.ok(chartedSystems(state).has('brennan'));
  assert.ok(!isSurveyed(state, 'brennan'));

  const mule = firstShip(state);
  assert.equal(giveOrder(state, mule, { type: 'survey', systemId: 'brennan' }).ok, false, 'only scouts survey');
  const result = giveOrder(state, lark, { type: 'survey', systemId: 'brennan' });
  assert.ok(result.ok, result.error);
  assert.equal(lark.order.target, gateTo('brennan', 'aurel').id);
  advance(state, lark.order.endsAt);
  assert.ok(isSurveyed(state, 'brennan'));
  assert.equal(state.stats.surveys, 1);
  // Brennan's neighbours are now on the map, and a Mule can fly there.
  for (const { to } of lanesFrom('brennan')) assert.ok(chartedSystems(state).has(to));
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: findSystem('brennan').stations[0].id }).ok);
});

test('hazard systems cannot be entered or surveyed', () => {
  const state = newGame({ credits: 1e9 });
  const g = useGalaxy(state.seed);
  const deep = g.systems.find((s) => s.hazard);
  state.research.done.push('warp-drive', 'scout-licence');
  // Survey everything up to the hazard so the route is known.
  for (const s of g.systems) if (!s.hazard) markSurveyed(state, s.id, state.now);
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  const result = giveOrder(state, lark, { type: 'survey', systemId: deep.id });
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(deep.hazard));
});

test('an act 1 save upgrades with its company intact', () => {
  const state = newGame({ credits: 4321 });
  const old = JSON.parse(serialize(state));
  old.version = 2;
  delete old.surveyed;
  delete old.seen;
  delete old.standing;
  delete old.stats.jumps;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.version, 3);
  assert.equal(loaded.credits, 4321);
  assert.equal(loaded.ships.length, 1);
  assert.deepEqual(loaded.surveyed, []);
  assert.equal(loaded.stats.jumps, 0);
  assert.ok(findStation('halcyon-refinery'));
});
