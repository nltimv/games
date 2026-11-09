// Building and salvaging ships, and the fleet allowance that caps them.
//
// Every hull takes points of the company's fleet allowance (see
// content/ships.js). The allowance starts at STARTING_ALLOWANCE; the Fleet
// licence research line raises it, each Fleet command level adds
// COMMAND_POINTS, and an old save may carry a bonus so its fleet still fits.
// A ship can only be built while its points fit.
//
// A shipyard builds a ship from its hull's recipe. Goods delivered there wait
// in the company's build store at that yard (state.stores). "Build now"
// takes what the store has and buys the rest at BUILD_MARKUP times the
// goods' value; "Plan the build" reserves the points and starts the build
// once deliveries complete the recipe. Each yard builds one ship at a time
// and queues the rest. Builds live in state.builds:
//   { id, hull, name, stationId, status: 'planned' | 'queued', fee,
//     startsAt, endsAt (queued only), commander (an Osprey's, hired) }
//
// Salvage takes a ship apart at a shipyard: it frees its points, costs the
// hull's fee and puts half its recipe into that yard's store.

import { BUILD_MARKUP, COMMAND_POINTS, HULLS, STARTING_ALLOWANCE } from '../content/ships.js';
import { GOODS, goodName } from '../content/goods.js';
import { findResearch } from '../content/research.js';
import { STATION_TYPES } from '../content/stations.js';
import { findStation } from '../content/galaxy.js';
import { formatCredits } from '../../../shared/js/format.js';
import { MINUTE } from '../core/time.js';
import { addLog } from './log.js';
import { removeCargo } from './cargo.js';
import { createShip, hullLock, hullsForSale } from './fleet.js';
import { researchLevel } from './research.js';

const fail = (error) => ({ ok: false, error });
const ofHull = (hullId) => HULLS[hullId] ?? null;

// ---------- The allowance ----------

/** The fleet allowance in points: licences, Fleet command levels and any bonus. */
export function allowance(state) {
  const licence = researchLevel(state, 'licence');
  const base = licence ? findResearch(`licence-${licence}`).allowance : STARTING_ALLOWANCE;
  return base + COMMAND_POINTS * commandLevel(state) + (state.allowanceBonus ?? 0);
}

/** How many Fleet command researches the company has (0 to 3). */
function commandLevel(state) {
  return ['fleet-1', 'fleet-2', 'fleet-3'].filter((id) => state.research.done.includes(id)).length;
}

/** Points the fleet takes: every ship, and every build planned or under way. */
export function pointsUsed(state) {
  const ships = state.ships.reduce((sum, ship) => sum + (ofHull(ship.hull)?.points ?? 1), 0);
  const builds = (state.builds ?? []).reduce((sum, build) => sum + (ofHull(build.hull)?.points ?? 1), 0);
  return ships + builds;
}

export function freePoints(state) {
  return allowance(state) - pointsUsed(state);
}

/** Why a hull's points don't fit, or null. */
export function pointsLock(state, hullId) {
  const short = (ofHull(hullId)?.points ?? 1) - freePoints(state);
  if (short <= 0) return null;
  return short === 1 ? 'Needs 1 more allowance point.' : `Needs ${short} more allowance points.`;
}

// ---------- The build store ----------

/** The company's goods in store at a shipyard: { good: tonnes }. */
export function storeAt(state, stationId) {
  return state.stores?.[stationId] ?? {};
}

/** Adds goods to a yard's store, and starts any planned build they complete. */
export function addToStore(state, stationId, good, qty, at = state.now) {
  if (qty <= 0) return;
  state.stores ??= {};
  const store = (state.stores[stationId] ??= {});
  store[good] = (store[good] ?? 0) + qty;
  startCompleted(state, stationId, at);
}

export function takeFromStore(state, stationId, good, qty) {
  const store = state.stores?.[stationId];
  if (!store || !qty) return;
  store[good] = (store[good] ?? 0) - qty;
  if (store[good] <= 0) delete store[good];
  if (!Object.keys(store).length) delete state.stores[stationId];
}

/** Each good of a hull's recipe at a yard: { good, need, have, missing }, from what the store holds now. */
export function recipeAt(state, hullId, stationId) {
  const store = storeAt(state, stationId);
  return Object.entries(ofHull(hullId)?.recipe ?? {}).map(([good, need]) => {
    const have = Math.min(need, Math.floor(store[good] ?? 0));
    return { good, need, have, missing: need - have };
  });
}

/** What a yard charges per tonne for a good missing from a recipe or a refit. */
export function markupPrice(good) {
  return Math.ceil((GOODS[good]?.value ?? 0) * BUILD_MARKUP);
}

/** What Build now costs at a yard: the missing goods at the markup, and the fee. */
export function buildNowCost(state, hullId, stationId, { feePaid = false } = {}) {
  const lines = recipeAt(state, hullId, stationId);
  const materials = lines.reduce((sum, line) => sum + line.missing * markupPrice(line.good), 0);
  const fee = feePaid ? 0 : buildFee(state, hullId, stationId);
  return { lines, materials, fee, total: materials + fee };
}

/** A faction's yard charges its fee for every build; the company's own yards will not. */
export function buildFee(state, hullId, stationId) {
  return findStation(stationId)?.faction ? (ofHull(hullId)?.fee ?? 0) : 0;
}

// ---------- Builds ----------

export const isShipyard = (stationId) => findStation(stationId)?.type === 'shipyard';

export function buildsAt(state, stationId) {
  return (state.builds ?? []).filter((build) => build.stationId === stationId);
}

/** Why the company can't build a hull at a yard now, or null. Credits are checked when it starts. */
export function buildLock(state, hullId, stationId) {
  // Command ships come with a commander, hired at any shipyard.
  const offered = hullsForSale(state, stationId).includes(hullId) || ofHull(hullId)?.hired;
  if (!isShipyard(stationId) || !offered) return 'That ship is not built here.';
  return hullLock(state, hullId, stationId) ?? pointsLock(state, hullId);
}

/** The next free name for a hull, counting ships being built. */
function nextName(state, hullId) {
  const hull = ofHull(hullId);
  const taken = new Set([...state.ships.map((s) => s.name), ...(state.builds ?? []).map((b) => b.name)]);
  let n = state.ships.filter((s) => s.hull === hullId).length + 1;
  while (taken.has(`${hull.namePrefix}-${n}`)) n += 1;
  return `${hull.namePrefix}-${n}`;
}

function newBuild(state, hullId, stationId, extra = {}) {
  state.builds ??= [];
  state.nextBuildId = (state.nextBuildId ?? 1) + 1;
  const build = { id: `build-${state.nextBuildId - 1}`, hull: hullId, name: extra.name ?? nextName(state, hullId), stationId, status: 'planned', fee: 0, ...extra };
  state.builds.push(build);
  return build;
}

/** When a yard is done with every build queued there. */
function yardFreeAt(state, stationId, at) {
  return Math.max(at, ...buildsAt(state, stationId).filter((b) => b.status === 'queued').map((b) => b.endsAt));
}

/** What went into growing the fleet: { licences, materials, fees }, for the reports. */
export function spend(state, kind, amount) {
  if (!amount) return;
  state.stats.shipSpend = { licences: 0, materials: 0, fees: 0, ...state.stats.shipSpend };
  state.stats.shipSpend[kind] += amount;
}

/** Takes the recipe from the store and puts the build in the yard's queue. */
function queueBuild(state, build, at) {
  for (const { good, have } of recipeAt(state, build.hull, build.stationId)) takeFromStore(state, build.stationId, good, have);
  state.stats.builds = (state.stats.builds ?? 0) + 1;
  build.startsAt = yardFreeAt(state, build.stationId, at);
  build.status = 'queued';
  build.endsAt = build.startsAt + ofHull(build.hull).buildMinutes * MINUTE;
}

/** Planned builds whose recipe the store now holds start, oldest first. */
function startCompleted(state, stationId, at) {
  for (const build of buildsAt(state, stationId)) {
    if (build.status !== 'planned') continue;
    if (recipeAt(state, build.hull, stationId).every((line) => line.missing === 0)) {
      queueBuild(state, build, at);
      addLog(state, at, `${build.name} is being built at ${findStation(stationId).name}`, 'purchase');
    }
  }
}

/**
 * Build now: uses what the yard's store holds, buys the rest at the markup,
 * pays the fee and queues the build. `extra` goes onto the build (an
 * Osprey's commander).
 */
export function buildShip(state, hullId, stationId, at = state.now, extra = {}) {
  const lock = buildLock(state, hullId, stationId);
  if (lock) return fail(lock);
  const cost = buildNowCost(state, hullId, stationId);
  if (state.credits < cost.total) return fail(`You need ${formatCredits(cost.total - state.credits)} more.`);
  state.credits -= cost.total;
  spend(state, 'materials', cost.materials);
  spend(state, 'fees', cost.fee);
  const build = newBuild(state, hullId, stationId, { fee: cost.fee, ...extra });
  queueBuild(state, build, at);
  addLog(state, at, `${build.name} is being built at ${findStation(stationId).name}, for ${formatCredits(cost.total)}`, 'purchase', -cost.total);
  return { ok: true, build, cost: cost.total };
}

/** Plan the build: pays the fee and reserves the points; the build starts once the store holds the recipe. */
export function planBuild(state, hullId, stationId, at = state.now) {
  const lock = buildLock(state, hullId, stationId);
  if (lock) return fail(lock);
  const fee = buildFee(state, hullId, stationId);
  if (state.credits < fee) return fail(`You need ${formatCredits(fee - state.credits)} more.`);
  state.credits -= fee;
  spend(state, 'fees', fee);
  const build = newBuild(state, hullId, stationId, { fee });
  addLog(state, at, `Planned ${build.name} at ${findStation(stationId).name}`, 'purchase', fee ? -fee : undefined);
  startCompleted(state, stationId, at);
  return { ok: true, build };
}

/** A planned build switches to Build now: the missing goods at the markup. */
export function buildPlannedNow(state, buildId, at = state.now) {
  const build = (state.builds ?? []).find((b) => b.id === buildId);
  if (!build || build.status !== 'planned') return fail('That build is already under way.');
  const cost = buildNowCost(state, build.hull, build.stationId, { feePaid: true });
  if (state.credits < cost.total) return fail(`You need ${formatCredits(cost.total - state.credits)} more.`);
  state.credits -= cost.total;
  spend(state, 'materials', cost.materials);
  queueBuild(state, build, at);
  addLog(state, at, `${build.name} is being built at ${findStation(build.stationId).name}${cost.total ? `, for ${formatCredits(cost.total)}` : ''}`, 'purchase', cost.total ? -cost.total : undefined);
  return { ok: true, build, cost: cost.total };
}

/** Drops a planned build: its points are free again and its fee comes back. Delivered goods stay in store. */
export function cancelPlan(state, buildId, at = state.now) {
  const build = (state.builds ?? []).find((b) => b.id === buildId);
  if (!build || build.status !== 'planned') return fail('That build is already under way.');
  state.builds = state.builds.filter((b) => b !== build);
  state.credits += build.fee;
  spend(state, 'fees', -build.fee);
  addLog(state, at, `Dropped the plan for ${build.name}`, 'info', build.fee || undefined);
  return { ok: true };
}

/** The build finishing first, or null. */
export function nextBuild(state) {
  let best = null;
  for (const build of state.builds ?? []) {
    if (build.status === 'queued' && (!best || build.endsAt < best.endsAt)) best = build;
  }
  return best;
}

/** A finished build leaves the yard as a ship, docked there. */
export function finishBuild(state, build, at) {
  state.builds = state.builds.filter((b) => b !== build);
  const ship = createShip(state, build.hull, build.stationId, build.name);
  if (build.commander) ship.commander = build.commander;
  addLog(state, at, `${ship.name} is built at ${findStation(build.stationId).name}`, 'arrival');
  return ship;
}

/** Planned builds at a yard that still need `good`, oldest first, with how much: [{ build, missing }]. */
export function plansNeeding(state, good, stationId = null) {
  return (state.builds ?? [])
    .filter((build) => build.status === 'planned' && (!stationId || build.stationId === stationId))
    .map((build) => ({ build, missing: recipeAt(state, build.hull, build.stationId).find((line) => line.good === good)?.missing ?? 0 }))
    .filter((row) => row.missing > 0);
}

/**
 * A ship hands `good` to the build store at the yard it is docked at: as
 * much as the builds planned there still need (all of it when `qty` is
 * null), or `qty` tonnes. Goods past what they need stay in store for later
 * builds.
 */
export function storeCargo(state, ship, good, qty = null, at = state.now) {
  const stationId = ship.at;
  if (!isShipyard(stationId)) return fail('Only a shipyard keeps a build store.');
  const aboard = Math.floor(ship.cargo[good] ?? 0);
  if (aboard < 1) return fail(`${ship.name} has no ${goodName(good).toLowerCase()} aboard.`);
  const amount = Math.min(aboard, qty ?? stillNeededAt(state, stationId, good));
  if (amount < 1) return fail(`No build planned at ${findStation(stationId).name} needs ${goodName(good).toLowerCase()}.`);
  // Names the builds it goes to before they take it.
  const forBuilds = plansNeeding(state, good, stationId).map((row) => row.build.name);
  const basis = removeCargo(ship, good, amount);
  state.stats.stored = (state.stats.stored ?? 0) + amount;
  addLog(state, at, `${ship.name} delivered ${amount} t ${goodName(good).toLowerCase()} to ${findStation(stationId).name}${forBuilds.length ? ` for ${listNames(forBuilds)}` : ''}`, 'arrival');
  addToStore(state, stationId, good, amount, at);
  return { ok: true, qty: amount, basis };
}

const listNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

/**
 * What `cargo` ({ good: t }) could hand to the builds planned at a yard:
 * { good: t } for each good they still need, less what `stored` ({
 * 'stationId:good': t }, from earlier orders) already brings.
 */
export function storeGoods(state, stationId, cargo, stored = {}) {
  const goods = {};
  for (const good of Object.keys(cargo)) {
    const needed = stillNeededAt(state, stationId, good) - (stored[`${stationId}:${good}`] ?? 0);
    const qty = Math.min(Math.floor(cargo[good] ?? 0), needed);
    if (qty >= 1) goods[good] = qty;
  }
  return goods;
}

/** Whether handing `goods` to a yard leaves its planned builds wanting nothing more. */
export function completesPlans(state, stationId, goods, stored = {}) {
  const wanted = new Set(buildsAt(state, stationId).filter((b) => b.status === 'planned').flatMap((b) => Object.keys(ofHull(b.hull).recipe)));
  return [...wanted].every((good) => stillNeededAt(state, stationId, good) - (stored[`${stationId}:${good}`] ?? 0) - (goods[good] ?? 0) < 1);
}

/** The planned builds at a yard that any of `goods` go to. */
export function buildsFor(state, stationId, goods) {
  return buildsAt(state, stationId).filter((b) => b.status === 'planned' && Object.keys(goods).some((good) => (ofHull(b.hull).recipe[good] ?? 0) > 0));
}

/** A docked ship hands the yard's planned builds everything aboard they need. */
export function storeAll(state, ship, at = state.now) {
  const goods = storeGoods(state, ship.at, ship.cargo);
  if (!Object.keys(goods).length) return fail(`${ship.name} carries nothing the builds here need.`);
  let qty = 0;
  for (const [good, amount] of Object.entries(goods)) qty += storeCargo(state, ship, good, amount, at).qty ?? 0;
  return { ok: true, qty };
}

/** The planned builds whose recipe uses `good`, at any yard: their names, for the "For Mule-3" tag. */
export function buildsWanting(state, good) {
  return plansNeeding(state, good).map((row) => row.build);
}

/** How many tonnes of `good` the planned builds at a yard still need, in all. */
export function stillNeededAt(state, stationId, good) {
  // Builds earlier in line take from the store first.
  const store = storeAt(state, stationId);
  let have = Math.floor(store[good] ?? 0);
  let missing = 0;
  for (const build of buildsAt(state, stationId)) {
    if (build.status !== 'planned') continue;
    const need = ofHull(build.hull).recipe[good] ?? 0;
    const used = Math.min(need, have);
    have -= used;
    missing += need - used;
  }
  return missing;
}

// ---------- Salvage ----------

/** Why a ship can't be salvaged now, or null. */
export function salvageLock(state, ship) {
  if (!ship || !isShipyard(ship.at)) return 'Salvage happens at a shipyard.';
  if (ship.commander) return 'A command ship stays with its commander.';
  if (ship.fleet) return 'It flies in a wing: take it out first.';
  if (ship.order || ship.queue.length) return 'It has orders to finish first.';
  if (Object.values(ship.cargo).some((qty) => qty > 0)) return 'Empty its hold first.';
  if (state.ships.length <= 1) return 'It is the company’s last ship.';
  const fee = ofHull(ship.hull).fee;
  if (state.credits < fee) return `You need ${formatCredits(fee - state.credits)} more.`;
  return null;
}

/** What salvage returns to the yard's store: half the recipe, rounded down. */
export function salvageReturn(hullId) {
  return Object.fromEntries(Object.entries(ofHull(hullId)?.recipe ?? {}).map(([good, qty]) => [good, Math.floor(qty / 2)]));
}

export function salvageShip(state, shipId, at = state.now) {
  const ship = state.ships.find((s) => s.id === shipId);
  const lock = salvageLock(state, ship);
  if (lock) return fail(lock);
  const hull = ofHull(ship.hull);
  state.credits -= hull.fee;
  spend(state, 'fees', hull.fee);
  state.stats.shipsSalvaged = (state.stats.shipsSalvaged ?? 0) + 1;
  state.ships = state.ships.filter((s) => s !== ship);
  const back = salvageReturn(ship.hull);
  for (const [good, qty] of Object.entries(back)) addToStore(state, ship.at, good, qty, at);
  const goods = Object.entries(back).map(([good, qty]) => `${qty} t ${goodName(good).toLowerCase()}`).join(', ');
  addLog(state, at, `Salvaged ${ship.name} at ${findStation(ship.at).name}: ${goods} went into store`, 'purchase', -hull.fee);
  return { ok: true, back };
}

/** Hulls a yard type builds, for the panel. */
export function yardHulls(stationId) {
  return STATION_TYPES[findStation(stationId)?.type]?.hulls ?? [];
}
