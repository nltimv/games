import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALAXY_SIZE,
  HAZARD_DEPTH,
  allSystems,
  findStation,
  findSystem,
  gateTo,
  generateGalaxy,
  lanesFrom,
  systemOf,
  useGalaxy,
} from '../../public/games/driftworks/content/galaxy.js';
import { HOME_SKY, sceneryOf, stationTint } from '../../public/games/driftworks/content/scenery.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { SAVE_VERSION } from '../../public/games/driftworks/core/state.js';
import { chartedSystems, isSurveyed, markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { cancelOrder, feesDue, giveOrder, shipRoute } from '../../public/games/driftworks/systems/orders.js';
import { orderOptions } from '../../public/games/driftworks/systems/advisor.js';
import { findEntry } from '../../public/games/driftworks/systems/market.js';
import { carryOut } from '../../public/games/driftworks/systems/commands.js';
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

  // The fee is paid as the ship enters the warp, not when the order starts.
  const credits = state.credits;
  const t0 = state.now;
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: station.id }).ok);
  assert.equal(state.credits, credits);
  advance(state, t0 + jump.start - 1);
  assert.equal(state.credits, credits, 'still flying to the gate');
  assert.equal(state.stats.jumps, 0);
  advance(state, t0 + jump.start);
  assert.equal(state.credits, credits - course.fees);
  assert.equal(state.stats.jumps, 1);
  assert.equal(state.stats.jumpFees, course.fees);

  // Halfway through the jump the ship is between the two systems.
  const mid = (jump.start + jump.end) / 2 + t0;
  assert.deepEqual(shipPosition(mule, mid).jump.from, 'aurel');
  assert.equal(shipPosition(mule, mid).system, null);
  advance(state, t0 + course.time + 1000);
  assert.equal(mule.at, station.id);
  assert.equal(systemOf(mule.at), 'brennan');
  assert.equal(state.credits, credits - course.fees, 'paid once');
});

test('a ship that cannot pay at the gate waits there', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const mule = firstShip(state);
  const station = findSystem('brennan').stations[0];
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: station.id }).ok);
  const jump = mule.order.legs.find((leg) => leg.jump);
  state.credits = jump.fee - 1;
  advance(state, mule.order.endsAt);
  assert.equal(mule.order, null);
  assert.equal(mule.at, 'gate-brennan');
  assert.equal(state.credits, jump.fee - 1, 'nothing was paid');
  assert.equal(state.stats.jumps, 0);
  assert.ok(state.log.some((entry) => /waits at Gate to Brennan: the jump to Brennan costs/.test(entry.text)));
});

test('cancelling before a jump costs nothing, and the ship waits at the gate', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const mule = firstShip(state);
  const station = findSystem('brennan').stations[0];
  const start = state.credits;
  giveOrder(state, mule, { type: 'fly', stationId: station.id });
  const result = cancelOrder(state, mule, state.now + 10_000);
  assert.ok(result.ok && result.flying);
  advance(state, state.now + 10 * MINUTE);
  assert.equal(mule.at, 'gate-brennan');
  assert.equal(state.credits, start, 'no fee was paid');
});

test('a scout surveys a system next to a surveyed one, opening it to other ships', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
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
  state.research.done.push('warp-drive');
  // Survey everything up to the hazard so the route is known.
  for (const s of g.systems) if (!s.hazard) markSurveyed(state, s.id, state.now);
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  const result = giveOrder(state, lark, { type: 'survey', systemId: deep.id });
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(deep.hazard));
});

test('the order menu jumps, surveys, buys and sells across systems', () => {
  const state = newGame({ credits: 100_000 });
  // By act 2 the haulers carry hundreds of tonnes, which is what makes a jump fee pay.
  state.research.done.push('warp-drive', 'kite-licence', 'hold-2', 'hold-3', 'hold-4');
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  const kite = createShip(state, 'kite', 'halcyon-refinery');

  // An unsurveyed system: the scout may survey it, the hauler has no way in.
  const survey = orderOptions(state, lark, { kind: 'system', id: 'brennan' });
  assert.deepEqual(survey.map((o) => o.kind), ['survey']);
  assert.ok(survey[0].fees > 0 && survey[0].endsAt > state.now);
  assert.deepEqual(orderOptions(state, kite, { kind: 'system', id: 'brennan' }), []);
  assert.ok(carryOut(state, lark.id, survey[0]).ok);
  // A second survey of the same system is refused while the first runs.
  const lark2 = createShip(state, 'lark', 'halcyon-shipyard');
  assert.equal(giveOrder(state, lark2, { type: 'survey', systemId: 'brennan' }).ok, false);
  advance(state, lark.order.endsAt);
  assert.ok(isSurveyed(state, 'brennan'));

  // Now the hauler can jump there, from the galaxy map or from the gate.
  const jump = orderOptions(state, kite, { kind: 'system', id: 'brennan' });
  assert.deepEqual(jump.map((o) => o.kind), ['jump']);
  assert.equal(jump[0].jumps, 1);
  const viaGate = orderOptions(state, kite, { kind: 'gate', id: 'gate-brennan' });
  assert.deepEqual(viaGate.map((o) => o.kind), ['jump', 'fly']);
  assert.equal(viaGate[0].stationId, gateTo('brennan', 'aurel').id);

  // Goods bought here sell at a neighbour's foundry: one order each, and the
  // sale's order shows the jump and its fee.
  const station = ['brennan', 'dace', 'elm', 'fenn'].flatMap((id) => findSystem(id).stations).find((s) => s.type === 'foundry');
  markSurveyed(state, systemOf(station.id), state.now);
  const buy = orderOptions(state, kite, { kind: 'station', id: kite.at }).find((o) => o.kind === 'buy' && findEntry(station.id, o.good)?.side === 'buys');
  assert.ok(buy, `${station.name} buys what the refinery sells`);
  assert.ok(carryOut(state, kite.id, buy).ok);
  const sell = orderOptions(state, kite, { kind: 'station', id: station.id }).find((o) => o.kind === 'sell');
  assert.ok(sell.goods.includes(buy.good));
  assert.equal(sell.jumps, 1);
  assert.ok(sell.fees > 0);
  assert.ok(carryOut(state, kite.id, sell).ok);
  advance(state, state.now + 60 * MINUTE);
  assert.equal(kite.at, station.id);
  assert.deepEqual(kite.cargo, {});
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
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(loaded.credits, 4321);
  assert.equal(loaded.ships.length, 2);
  assert.deepEqual(loaded.surveyed, []);
  assert.equal(loaded.stats.jumps, 0);
  assert.ok(findStation('halcyon-refinery'));
});

test('each system has its own star and sky, and foreign stations wear their faction colour', () => {
  useGalaxy(1234);
  const home = sceneryOf(HOME_SYSTEM);
  assert.equal(home.starClass, 'G');
  assert.equal(home.sky, HOME_SKY);
  const systems = allSystems().filter((system) => system.id !== HOME_SYSTEM.id);
  const looks = systems.map((system) => sceneryOf(system));
  assert.ok(new Set(looks.map((look) => look.starClass)).size >= 3, 'stars vary');
  assert.ok(new Set(looks.map((look) => look.sky.base.join())).size >= 2, 'skies vary');
  assert.equal(sceneryOf(findSystem('dace')), sceneryOf(findSystem('dace')), 'the same system looks the same');
  assert.equal(stationTint(findStation('halcyon-refinery')), null);
  const foreign = systems.flatMap((system) => system.stations).find((station) => station.faction !== 'halcyon');
  assert.match(stationTint(foreign), /^#[0-9a-f]{6}$/);
});

test('the fees a ship still pays at its gates count as due until it jumps', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const mule = firstShip(state);
  assert.equal(feesDue(state), 0);
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: findSystem('brennan').stations[0].id }).ok);
  const jump = mule.order.legs.find((leg) => leg.jump);
  assert.equal(feesDue(state), jump.fee);
  advance(state, jump.start);
  assert.equal(feesDue(state), 0);
});

test("a ship's route lists the jumps ahead, queued ones last", () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('warp-drive', 'queue-1');
  markSurveyed(state, 'brennan', state.now);
  const mule = firstShip(state);
  assert.deepEqual(shipRoute(state, mule), []);
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: findSystem('brennan').stations[0].id }).ok);
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: 'halcyon-refinery' }).ok);
  const route = shipRoute(state, mule);
  assert.deepEqual(route.map((hop) => [hop.from, hop.to, hop.queued]), [
    ['aurel', 'brennan', false],
    ['brennan', 'aurel', true],
  ]);
  advance(state, route[0].end);
  assert.deepEqual(shipRoute(state, mule).map((hop) => hop.to), ['aurel'], 'a finished jump drops off');
});
