import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSystems, findFaction, findSystem, HOME_FACTION, SPECIALITY } from '../../public/games/driftworks/content/galaxy.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { saleValue } from '../../public/games/driftworks/systems/advisor.js';
import { sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { hullLock } from '../../public/games/driftworks/systems/fleet.js';
import { planBuild } from '../../public/games/driftworks/systems/shipyard.js';
import { isLive, knownAt, seenAt } from '../../public/games/driftworks/systems/knowledge.js';
import { marketView, sellToStation } from '../../public/games/driftworks/systems/market.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { earnStanding, openStanding, priceFactor, standingLevel } from '../../public/games/driftworks/systems/standing.js';
import { MINUTE, firstShip, newGame } from './helpers.mjs';

test('standing only counts from the warp drive, so act 1 prices stay the same', () => {
  const state = newGame();
  const before = marketView(state, 'halcyon-refinery', 'iron').price;
  earnStanding(state, 'halcyon-refinery', 500_000);
  assert.equal(state.standing[HOME_FACTION] ?? 0, 0);
  state.standing[HOME_FACTION] = 5000;
  assert.equal(marketView(state, 'halcyon-refinery', 'iron').price, before, 'no bonus before the warp drive');
});

test('the warp drive opens standing, with Halcyon seeded from act 1 earnings', () => {
  const state = newGame();
  state.stats.earned = 400_000;
  state.research.done.push('warp-drive');
  openStanding(state);
  assert.equal(standingLevel(state, HOME_FACTION).id, 'trusted');
  // Selling to a faction earns 1 point per 1,000 cr, and levels bring better prices.
  const other = allSystems().find((s) => s.faction !== HOME_FACTION && s.stations.length);
  const station = other.stations[0];
  assert.equal(standingLevel(state, other.faction).id, 'neutral');
  earnStanding(state, station.id, 60_000);
  assert.equal(standingLevel(state, other.faction).id, 'friendly');
  assert.ok(state.log.some((e) => e.text.startsWith('Friendly with the')));
  const faction = findFaction(other.faction);
  const good = 'iron';
  const expected = (faction.pays.includes(good) ? SPECIALITY.pays : 1) * (1 + standingLevel(state, other.faction).bonus);
  assert.ok(Math.abs(priceFactor(state, station.id, good, 'buys') - expected) < 1e-9);
});

test("a faction's specialities change its prices", () => {
  const state = newGame();
  state.research.done.push('warp-drive');
  const system = allSystems().find((s) => s.faction !== HOME_FACTION && s.stations.some((st) => st.buys?.some((g) => findFaction(s.faction).pays.includes(g))));
  const station = system.stations.find((st) => st.buys?.some((g) => findFaction(system.faction).pays.includes(g)));
  const good = station.buys.find((g) => findFaction(system.faction).pays.includes(g));
  assert.equal(priceFactor(state, station.id, good, 'buys'), SPECIALITY.pays);
  const plain = station.buys.find((g) => !findFaction(system.faction).pays.includes(g));
  if (plain) assert.equal(priceFactor(state, station.id, plain, 'buys'), 1);
});

test('Heron freighters need Trusted standing with the shipyard faction', () => {
  const state = newGame({ credits: 1e7 });
  assert.match(hullLock(state, 'heron', 'halcyon-shipyard'), /Warp drive/);
  state.research.done.push('warp-drive');
  assert.match(hullLock(state, 'heron', 'halcyon-shipyard'), /Trusted standing with the Halcyon Compact/);
  assert.equal(planBuild(state, 'heron', 'halcyon-shipyard').ok, false);
  state.standing[HOME_FACTION] = 300;
  state.research.done.push('licence-1');
  assert.equal(hullLock(state, 'heron', 'halcyon-shipyard'), null);
  const result = planBuild(state, 'heron', 'halcyon-shipyard');
  assert.ok(result.ok, result.error);
  assert.equal(result.build.name, 'Heron-1');
});

test('away from your ships, prices are the ones last seen', () => {
  const state = newGame({ credits: 100_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const station = findSystem('brennan').stations[0];
  assert.equal(isLive(state, 'brennan'), false);
  assert.equal(seenAt(state, 'brennan'), state.now);
  // A ship there sees live prices; when it leaves, they are kept as seen then.
  const mule = firstShip(state);
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: station.id }).ok);
  advance(state, mule.order.endsAt);
  assert.ok(isLive(state, 'brennan'));
  const good = station.buys[0];
  sellToStation(state, station.id, good, 300, state.now);
  const left = state.now;
  const seenPrice = marketView(state, station.id, good, left).price;
  assert.ok(giveOrder(state, mule, { type: 'fly', stationId: 'halcyon-refinery' }).ok);
  advance(state, mule.order.endsAt);
  assert.equal(isLive(state, 'brennan'), false);
  const later = state.now + 120 * MINUTE;
  assert.ok(knownAt(state, station.id, later) <= left + 60_000);
  // The real market has recovered; what you know has not.
  assert.ok(marketView(state, station.id, good, later).price > seenPrice);
  const qty = 100;
  const estimate = saleValue(state, station.id, good, qty, later).total;
  assert.ok(estimate < sellToStation(structuredClone(state), station.id, good, qty, later).total);
  // Saves keep it.
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.seen.brennan, state.seen.brennan);
});

test('selling outside Aurel counts as a far sale', () => {
  const state = newGame({ credits: 100_000 });
  state.research.done.push('warp-drive');
  markSurveyed(state, 'brennan', state.now);
  const station = findSystem('brennan').stations[0];
  const mule = firstShip(state);
  mule.cargo[station.buys[0]] = 20;
  mule.at = station.id;
  assert.ok(sellCargo(state, mule, station.buys[0]).ok);
  assert.equal(state.stats.farSales, 1);
});
