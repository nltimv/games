import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSystems, lanesFrom, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { findResearch } from '../../public/games/driftworks/content/research.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { SAVE_VERSION } from '../../public/games/driftworks/core/state.js';
import { buyCargo, canCarry } from '../../public/games/driftworks/systems/cargo.js';
import { isSurveyed, markSurveyed, surveyable } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { findEntry, marketEntries } from '../../public/games/driftworks/systems/market.js';
import { holdClassOf, refitTarget } from '../../public/games/driftworks/systems/modules.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { canStartResearch, researchCost, researchStatus, startResearch } from '../../public/games/driftworks/systems/research.js';
import { SHIELDED_DEPTH, hazardNote, isShielded } from '../../public/games/driftworks/systems/shielding.js';
import { plotCourse } from '../../public/games/driftworks/systems/travel.js';
import { newGame } from './helpers.mjs';

/** A company in late act 2 that has surveyed every system it can reach. */
function lateAct2() {
  const state = newGame({ credits: 1e9 });
  useGalaxy(state.seed);
  state.research.done.push('warp-drive', 'scout-licence', 'lane-charts', 'jump-1', 'kite-licence');
  for (const system of allSystems()) if (!system.hazard) markSurveyed(state, system.id, state.now);
  return state;
}

/** A hazard system next to one the company has surveyed. */
function hazardAtEdge(state, test = () => true) {
  return allSystems().find((s) => s.hazard && s.depth <= SHIELDED_DEPTH && test(s) && lanesFrom(s.id).some(({ to }) => isSurveyed(state, to)));
}

test('a hazard shielding opens systems with that hazard, out to depth 8', () => {
  const state = lateAct2();
  const target = hazardAtEdge(state);
  const shielding = { 'dense debris': 'shield-debris', 'ion storms': 'shield-ion', radiation: 'shield-radiation' }[target.hazard];
  const lark = createShip(state, 'lark', 'halcyon-shipyard');

  assert.equal(surveyable(state, target.id), false);
  const refused = giveOrder(state, lark, { type: 'survey', systemId: target.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, new RegExp(findResearch(shielding).name));

  state.research.done.push(shielding);
  assert.ok(isShielded(state, target));
  assert.ok(giveOrder(state, lark, { type: 'survey', systemId: target.id }).ok);

  // Other hazards, and the deep systems past depth 8, stay closed.
  const other = allSystems().find((s) => s.hazard && s.hazard !== target.hazard && s.depth <= SHIELDED_DEPTH);
  assert.equal(isShielded(state, other), false);
  const deep = allSystems().find((s) => s.hazard === target.hazard && s.depth > SHIELDED_DEPTH);
  if (deep) assert.match(hazardNote(state, deep), /Deep shielding/);
});

test('routes go through shielded hazard systems once they are surveyed', () => {
  const state = lateAct2();
  const target = hazardAtEdge(state, (s) => s.stations.length > 0);
  state.research.done.push({ 'dense debris': 'shield-debris', 'ion storms': 'shield-ion', radiation: 'shield-radiation' }[target.hazard]);
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  assert.equal(plotCourse(state, kite, kite.at, target.stations[0].id).ok, false, 'not surveyed yet');
  markSurveyed(state, target.id, state.now);
  assert.ok(plotCourse(state, kite, kite.at, target.stations[0].id).ok);
});

test('each hazard shielding costs more than the one before, whichever hazard it is', () => {
  const state = lateAct2();
  const debris = findResearch('shield-debris');
  const ion = findResearch('shield-ion');
  assert.equal(researchStatus(state, debris), 'open');
  assert.equal(researchCost(state, debris), 2_500_000);
  assert.equal(researchCost(state, ion), 2_500_000);
  assert.ok(startResearch(state, 'shield-ion', state.now).ok);
  // One in the lab counts too.
  assert.equal(researchCost(state, debris), 3_500_000);
  state.research.active = null;
  state.research.done.push('shield-ion', 'shield-radiation');
  assert.equal(researchCost(state, debris), 5_000_000);
  assert.equal(canStartResearch(state, 'station-blueprints').ok, false);
  state.research.done.push('shield-debris');
  assert.equal(researchStatus(state, findResearch('station-blueprints')), 'open');
});

test('sealed holds let refitted haulers carry processed materials; Mules keep standard holds', () => {
  const state = lateAct2();
  const kite = createShip(state, 'kite', 'halcyon-foundry');
  const mule = state.ships[0];
  assert.equal(canCarry(kite, 'steel'), false);
  assert.match(buyCargo(state, kite, 'steel', 10).error, /sealed hold/);

  state.research.done.push('sealed-holds');
  const refit = refitTarget(state, kite);
  assert.equal(refit.seal, 1);
  Object.assign(kite.modules, refit);
  assert.equal(holdClassOf(kite), 2);
  assert.ok(canCarry(kite, 'titanium-alloy'));
  assert.ok(buyCargo(state, kite, 'steel', 10).ok);
  assert.equal(refitTarget(state, mule)?.seal, undefined);
  assert.equal(canCarry(mule, 'steel'), false);
  // New haulers leave the shipyard with the sealed hold.
  assert.ok(canCarry(createShip(state, 'kite', 'halcyon-shipyard'), 'glass'));
});

test('shipyards buy steel and titanium alloy, and stations keep half as much of tier 3', () => {
  const state = lateAct2();
  const steel = findEntry('halcyon-shipyard', 'steel');
  assert.equal(steel.side, 'buys');
  assert.equal(steel.curve.cap, findEntry('halcyon-refinery', 'ferrite-ore').curve.cap / 2);
  assert.equal(findEntry('halcyon-shipyard', 'titanium-alloy').side, 'buys');
  assert.equal(findEntry('aurel-post', 'glass').side, 'buys');
  const foundry = allSystems().find((s) => s.depth >= 3 && s.stations.some((st) => st.type === 'foundry')).stations.find((st) => st.type === 'foundry');
  const sells = marketEntries(foundry.id).filter((e) => e.side === 'sells').map((e) => e.good);
  assert.deepEqual(sells, ['steel', 'glass', 'titanium-alloy', 'optics']);
  assert.ok(isSurveyed(state, 'aurel'));
});

test('a version 4 save gets standard holds on every ship', () => {
  const state = newGame();
  const old = JSON.parse(serialize(state));
  old.version = 4;
  for (const ship of old.ships) delete ship.modules.seal;
  delete old.stats.tierTonnes;
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(loaded.ships[0].modules.seal, 0);
  assert.deepEqual(loaded.stats.tierTonnes, {});
});
