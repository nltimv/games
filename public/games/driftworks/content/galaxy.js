// The galaxy: about 200 star systems joined by warp lanes, generated from
// the save's seed and the same every time after. Aurel, the home system, is
// hand-made (see homeSystem.js) and sits in the middle; its four neighbours
// keep their names in every save.
//
// Systems sit on the galaxy map in galaxy units. Inside a system, places
// (stations, fields, planets, gates) use map units with the star at the
// origin, as in Aurel. Every place id is unique across the galaxy.
//
// The game has one galaxy at a time: useGalaxy(seed) builds it (once per
// seed) and the find* lookups read it. Until then only Aurel exists, which
// is all act 1 needs.

import { HOME_SYSTEM } from './homeSystem.js';
import { createRng, hashString } from '../core/rng.js';

export const GALAXY_SIZE = 200;
const RADIUS = 1150;
const MIN_GAP = 84;
// Aurel's neighbours sit this far out, and nothing else comes closer.
const HOME_RING = 130;
const HOME_CLEAR = 185;
const MAX_LANES = 4;

/** From this depth on (lanes from Aurel), systems have hazards. */
export const HAZARD_DEPTH = 5;
export const HAZARDS = ['radiation', 'ion storms', 'dense debris'];

/** Jump time and fee range per lane, by its length. */
export const JUMP_MINUTES = { min: 6, max: 15 };
export const JUMP_FEE = { min: 300, max: 800 };
const LANE_SHORT = 80;
const LANE_LONG = 250;

/** Factories stand in about this share of the systems from HAZARD_DEPTH out. */
export const FACTORY_SHARE = 1 / 3;

/** What each component is made from, at factories. */
export const COMPONENTS = {
  'hull-plating': ['steel', 'titanium-alloy'],
  circuits: ['glass', 'optics'],
  'sensor-arrays': ['optics', 'titanium-alloy'],
};

/** What each refinery makes from each ore. */
export const REFINES = {
  'ferrite-ore': 'iron',
  'silicate-rock': 'silicon',
  'carbon-ore': 'graphite',
  ice: 'water',
  'titanium-ore': 'titanium',
  'crystal-ore': 'crystal',
};

export const HOME_FACTION = 'halcyon';

/** The factions a galaxy can have; Halcyon is always there. */
export const FACTION_POOL = [
  { id: 'verdant', name: 'Verdant Accord', short: 'Verdant', color: '#8fe388' },
  { id: 'orrin', name: 'Orrin Combine', short: 'Orrin', color: '#f5b453' },
  { id: 'sable', name: 'Sable Reach', short: 'Sable', color: '#b59cff' },
  { id: 'tessaly', name: 'Tessaly Union', short: 'Tessaly', color: '#ff8fae' },
  { id: 'kestrel', name: 'Kestrel League', short: 'Kestrel', color: '#69b7ff' },
  { id: 'lumen', name: 'Lumen Collective', short: 'Lumen', color: '#f4e76b' },
];
const HALCYON = { id: HOME_FACTION, name: 'Halcyon Compact', short: 'Halcyon', color: '#2ec5c0', pays: [], cheap: [] };
const OTHER_FACTIONS = 4;

/** How much more a faction pays for goods it wants, and less for goods it has plenty of. */
export const SPECIALITY = { pays: 1.1, cheap: 0.92 };

// Goods a faction may pay more for (ones stations buy) or sell cheaper (ones
// stations sell that someone else buys).
const PAYS_GOODS = ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'ice', 'iron', 'silicon', 'graphite', 'titanium-ore', 'titanium', 'crystal-ore', 'crystal'];
const CHEAP_GOODS = ['iron', 'silicon', 'graphite', 'ice', 'titanium', 'crystal'];

const SYLLABLES = ['al', 'an', 'ar', 'bel', 'cor', 'da', 'del', 'en', 'fa', 'gal', 'hes', 'is', 'ka', 'kel', 'la', 'lor', 'ma', 'mir', 'na', 'nor', 'or', 'pel', 'qua', 'ra', 'ren', 'sa', 'sel', 'ta', 'tor', 'ul', 'va', 'vel', 'wyn', 'xa', 'ze', 'zor', 'thal', 'cas', 'mer', 'io'];
const ENDINGS = ['', '', 'a', 'is', 'on', 'us', 'ara', 'eth', 'ine', 'or', 'ia', 'ux'];
const FIELD_WORDS = ['Drift', 'Shoal', 'Reach', 'Veil', 'Scatter', 'Reef', 'Spill', 'Cluster', 'Wake', 'Tumble'];
const FIELD_ADJECTIVES = ['Pale', 'Ember', 'Glass', 'Frost', 'Amber', 'Quiet', 'Hollow', 'Bright', 'Grey', 'Silver', 'Long', 'Low'];

const HOME_NEIGHBOURS = HOME_SYSTEM.gates.map((gate) => ({ id: gate.to, name: gate.short, angle: gate.angle }));

const deg = (radians) => (radians * 180) / Math.PI;
const rad = (degrees) => (degrees * Math.PI) / 180;

function polar(radius, degrees) {
  return { x: Math.round(radius * Math.cos(rad(degrees))), y: Math.round(radius * Math.sin(rad(degrees))) };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function between(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

// ---------- Layout ----------

function placeSystems(rng) {
  const points = [{ id: HOME_SYSTEM.id, name: HOME_SYSTEM.name, x: 0, y: 0, fixed: true }];
  for (const nb of HOME_NEIGHBOURS) points.push({ ...nb, ...polar(HOME_RING, nb.angle), fixed: true });
  const far = (p) => points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= MIN_GAP) && Math.hypot(p.x, p.y) >= HOME_CLEAR;
  for (let tries = 0; points.length < GALAXY_SIZE && tries < 60000; tries += 1) {
    const r = RADIUS * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    const p = { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) };
    if (far(p)) points.push(p);
  }
  return points;
}

function segmentsCross(a, b, c, d) {
  if (a === c || a === d || b === c || b === d) return false;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** How close the segment a-b passes to point p. */
function clearance(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

function connectLanes(rng, points) {
  const n = points.length;
  const edges = [];
  const degree = new Array(n).fill(0);
  const parent = points.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const crosses = (i, j) => edges.some(([a, b]) => segmentsCross(points[i], points[j], points[a], points[b]));
  const clear = (i, j) => points.every((p, k) => k === i || k === j || clearance(points[i], points[j], p) > 30);
  const add = (i, j) => {
    edges.push([i, j]);
    degree[i] += 1;
    degree[j] += 1;
    parent[find(i)] = find(j);
  };

  // Aurel (index 0) links to its four named neighbours, and nothing else.
  for (let i = 1; i <= HOME_NEIGHBOURS.length; i += 1) add(0, i);

  const pairs = [];
  for (let i = 1; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) pairs.push([i, j, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)]);
  }
  pairs.sort((p, q) => p[2] - q[2]);

  // A spanning tree of short lanes that never cross, so every system can
  // be reached. The first pass also keeps lanes away from other systems.
  for (const strict of [true, false]) {
    for (const [i, j] of pairs) {
      if (find(i) === find(j)) continue;
      if (crosses(i, j) || (strict && !clear(i, j))) continue;
      add(i, j);
    }
  }

  // Extra lanes make loops, so there is more than one way around.
  const angleAt = (i, j) => Math.atan2(points[j].y - points[i].y, points[j].x - points[i].x);
  const tooParallel = (i, j) =>
    edges.some(([a, b]) => {
      if (a !== i && b !== i && a !== j && b !== j) return false;
      const at = a === i || b === i ? i : j;
      const other = at === i ? j : i;
      const theirs = a === at ? b : a;
      const diff = Math.abs(angleAt(at, other) - angleAt(at, theirs)) % (Math.PI * 2);
      return Math.min(diff, Math.PI * 2 - diff) < rad(28);
    });
  const linked = new Set(edges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  for (const [i, j, length] of pairs) {
    if (length > LANE_LONG) break;
    if (linked.has(`${i}-${j}`) || degree[i] >= MAX_LANES || degree[j] >= MAX_LANES) continue;
    if (rng() > 0.6 || crosses(i, j) || !clear(i, j) || tooParallel(i, j)) continue;
    add(i, j);
    linked.add(`${i}-${j}`);
  }
  return edges;
}

function depthsFrom(n, adjacency, start) {
  const depth = new Array(n).fill(Infinity);
  depth[start] = 0;
  const queue = [start];
  while (queue.length) {
    const i = queue.shift();
    for (const j of adjacency[i]) {
      if (depth[j] === Infinity) {
        depth[j] = depth[i] + 1;
        queue.push(j);
      }
    }
  }
  return depth;
}

// ---------- Names ----------

function systemNames(rng, count, taken) {
  const names = [];
  const used = new Set(taken.map((t) => t.toLowerCase()));
  while (names.length < count) {
    const parts = 1 + (rng() < 0.7 ? 1 : 0);
    let word = '';
    for (let i = 0; i < parts; i += 1) word += pick(rng, SYLLABLES);
    word += pick(rng, ENDINGS);
    if (word.length < 4 || word.length > 9 || used.has(word)) continue;
    used.add(word);
    names.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return names;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// ---------- Factions ----------

function chooseFactions(rng) {
  const pool = [...FACTION_POOL];
  const chosen = [];
  while (chosen.length < OTHER_FACTIONS) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return chosen.map((faction) => {
    const take = (goods) => goods.splice(Math.floor(rng() * goods.length), 1)[0];
    const paysFrom = [...PAYS_GOODS];
    const pays = [take(paysFrom), take(paysFrom)];
    const cheapFrom = CHEAP_GOODS.filter((good) => !pays.includes(good));
    return { ...faction, pays, cheap: [take(cheapFrom), take(cheapFrom)] };
  });
}

/** Regions grow out from each faction's capital, one lane at a time. */
function claimRegions(rng, points, adjacency, depth, factions) {
  const owner = new Array(points.length).fill(null);
  const queue = [];
  owner[0] = HOME_FACTION;
  queue.push(0);
  const start = rng() * Math.PI * 2;
  factions.forEach((faction, k) => {
    const want = start + (k * Math.PI * 2) / factions.length;
    let best = -1;
    let bestScore = Infinity;
    points.forEach((p, i) => {
      if (owner[i] || depth[i] < 3 || depth[i] > 4) return;
      let diff = Math.abs(Math.atan2(p.y, p.x) - want) % (Math.PI * 2);
      diff = Math.min(diff, Math.PI * 2 - diff);
      const score = diff + Math.abs(depth[i] - 3.5) * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      owner[best] = faction.id;
      faction.capital = best;
      queue.push(best);
    }
  });
  while (queue.length) {
    const i = queue.shift();
    for (const j of adjacency[i]) {
      if (owner[j]) continue;
      owner[j] = owner[i];
      queue.push(j);
    }
  }
  return owner;
}

// ---------- System contents ----------

function fieldGoods(depthOf) {
  const pool = ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'ice'];
  if (depthOf >= 2) pool.push('titanium-ore', 'titanium-ore');
  if (depthOf >= 3) pool.push('crystal-ore', 'crystal-ore');
  return pool;
}

function richnessFor(rng, depthOf) {
  if (depthOf <= 1) return between(rng, 1.0, 1.3);
  if (depthOf === 2) return between(rng, 1.2, 1.5);
  if (depthOf <= 4) return between(rng, 1.4, 2.0);
  return between(rng, 1.8, 2.6);
}

function fieldName(rng, used) {
  for (;;) {
    const name =
      rng() < 0.4
        ? `${String.fromCharCode(65 + Math.floor(rng() * 26))}${String.fromCharCode(65 + Math.floor(rng() * 26))}-${10 + Math.floor(rng() * 89)}`
        : `${pick(rng, FIELD_ADJECTIVES)} ${pick(rng, FIELD_WORDS)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

const STATION_LABELS = { refinery: 'Refinery', foundry: 'Foundry', tradingPost: 'Trading Post', shipyard: 'Shipyard', factory: 'Factory' };

/** The goods a generated station trades, by its type and depth. */
function stationTrade(type, depthOf) {
  const ores = fieldGoods(depthOf).filter((g, i, all) => all.indexOf(g) === i);
  if (type === 'refinery') return { buys: ores, sells: ores.map((ore) => REFINES[ore]) };
  if (type === 'tradingPost') {
    const extra = ores.filter((g) => g === 'titanium-ore' || g === 'crystal-ore');
    const processed = ['steel', 'glass', ...(depthOf >= 3 ? ['optics'] : []), 'circuits'];
    return { buys: ['ferrite-ore', 'silicate-rock', 'carbon-ore', ...extra, 'iron', 'silicon', 'graphite', ...processed], sells: ['ice', 'water'] };
  }
  if (type === 'foundry') {
    const extra = depthOf >= 2 ? ['titanium'] : [];
    if (depthOf >= 3) extra.push('crystal');
    const made = [...(depthOf >= 2 ? ['titanium-alloy'] : []), ...(depthOf >= 3 ? ['optics'] : [])];
    return { buys: ['iron', 'graphite', 'silicon', ...extra], sells: ['steel', 'glass', ...made] };
  }
  if (type === 'shipyard') return { buys: ['steel', 'titanium-alloy', ...Object.keys(COMPONENTS)], sells: [] };
  return { buys: [], sells: [] };
}

function stationTypes(rng, depthOf) {
  const count = depthOf <= 1 ? 1 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * (depthOf <= 4 ? 3 : 4));
  const types = ['refinery'];
  const others = [
    ['tradingPost', 0.45],
    ['foundry', 0.3],
    ['shipyard', 0.25],
  ];
  while (types.length < Math.min(count, 4)) {
    let roll = rng();
    for (const [type, weight] of others) {
      roll -= weight;
      if (roll <= 0) {
        if (!types.includes(type)) types.push(type);
        break;
      }
    }
  }
  // Some systems have no refinery, only a market.
  if (types.length > 1 && rng() < 0.2) types.shift();
  return types;
}

function buildSystem(seed, point, depthOf, faction, neighbours, hazard) {
  const rng = createRng(hashString(`${seed}:system:${point.id}`));
  const id = point.id;
  const orbits = [between(rng, 100, 140), between(rng, 180, 230), between(rng, 340, 400)].map(Math.round);
  const belt = { radius: Math.round(between(rng, 260, 320)), width: 36 };

  const planets = [];
  const planetCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < planetCount; i += 1) {
    const orbit = orbits[Math.min(orbits.length - 1, i === 0 ? 0 : 1 + Math.floor(rng() * 2))];
    planets.push({ id: `${id}-planet-${i + 1}`, name: `${point.name} ${['I', 'II', 'III'][i]}`, kind: rng() < 0.5 ? 'rocky' : 'ice', radius: Math.round(between(rng, 9, 18)), ...polar(orbit, rng() * 360) });
  }

  // Gates point the way their lane goes on the galaxy map.
  const gateAngles = neighbours.map((nb) => deg(Math.atan2(nb.point.y - point.y, nb.point.x - point.x)));
  const gates = neighbours.map((nb, i) => ({
    id: `gate-${id}-${nb.point.id}`,
    name: `Gate to ${nb.point.name}`,
    short: nb.point.name,
    to: nb.point.id,
    angle: gateAngles[i],
    ...polar(470, gateAngles[i]),
  }));
  const awayFromGates = (angle) => gateAngles.every((a) => Math.min(Math.abs(a - angle) % 360, 360 - (Math.abs(a - angle) % 360)) > 18);

  const usedNames = new Set();
  const goods = fieldGoods(depthOf);
  const fieldCount = depthOf <= 1 ? 2 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3);
  const fields = [];
  const start = rng() * 360;
  for (let i = 0; i < fieldCount; i += 1) {
    let angle = start + (i * 360) / fieldCount + between(rng, -20, 20);
    for (let k = 0; k < 6 && !awayFromGates(angle); k += 1) angle += 15;
    const good = pick(rng, goods);
    const radius = good === 'ice' ? between(rng, 360, 410) : belt.radius + between(rng, -10, 10);
    fields.push({
      id: `${id}-field-${i + 1}`,
      name: fieldName(rng, usedNames),
      good,
      richness: Math.round(richnessFor(rng, depthOf) * 100) / 100,
      ...polar(radius, angle),
    });
  }

  const stations = stationTypes(rng, depthOf).map((type, i, all) => {
    const angle = (i * 360) / all.length + between(rng, 0, 360 / all.length) + start / 3;
    return {
      id: `${id}-${slug(type)}`,
      name: `${point.name} ${STATION_LABELS[type]}`,
      short: STATION_LABELS[type],
      type,
      faction,
      ...stationTrade(type, depthOf),
      ...polar(between(rng, 150, 220), angle),
    };
  });

  const factory = factoryFor(seed, point, depthOf, faction, stations);
  if (factory) stations.push(factory);
  addImports(seed, point, faction, stations);

  return {
    id,
    name: point.name,
    faction,
    depth: depthOf,
    hazard,
    gx: point.x,
    gy: point.y,
    star: { radius: Math.round(between(rng, 26, 40)) },
    orbits,
    belt,
    planets,
    fields,
    stations,
    gates,
    extent: 480,
  };
}

/**
 * A factory for a deep system, or null. It rolls on its own seed, so the
 * rest of the system is the same as before factories existed. Each makes
 * two of the three components, and buys what goes into them.
 */
function factoryFor(seed, point, depthOf, faction, stations) {
  if (depthOf < HAZARD_DEPTH) return null;
  const rng = createRng(hashString(`${seed}:factory:${point.id}`));
  if (rng() >= FACTORY_SHARE) return null;
  const all = Object.keys(COMPONENTS);
  const skip = Math.floor(rng() * all.length);
  const sells = all.filter((_, i) => i !== skip);
  const buys = [...new Set(sells.flatMap((good) => COMPONENTS[good]))];
  return {
    id: `${point.id}-factory`,
    name: `${point.name} ${STATION_LABELS.factory}`,
    short: STATION_LABELS.factory,
    type: 'factory',
    faction,
    buys,
    sells,
    ...polar(between(rng, 165, 215), widestGap(rng, stations)),
  };
}

/** The angle in the widest gap between a system's stations (a random one when it has none). */
function widestGap(rng, stations) {
  const angles = stations.map((s) => deg(Math.atan2(s.y, s.x))).sort((a, b) => a - b);
  let angle = rng() * 360;
  if (angles.length) {
    let widest = -1;
    angles.forEach((a, i) => {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 360;
      if (next - a > widest) {
        widest = next - a;
        angle = a + (next - a) / 2;
      }
    });
  }
  return angle;
}

/**
 * Aurel's four neighbours are short of goods Aurel's refinery makes, and pay
 * well for them (the `imports` curve), so the first trade through a gate
 * pays for its jumps. The goods are the same in every save.
 */
export const HOME_IMPORTS = {
  brennan: ['iron', 'graphite'],
  dace: ['silicon', 'iron'],
  elm: ['graphite', 'silicon'],
  fenn: ['iron', 'silicon'],
};

/**
 * Gives a home neighbour its imports: its foundry or trading post buys them,
 * and a system with neither gets a trading post. The new post rolls on its
 * own seed, so the rest of the system is the same as before imports existed.
 */
function addImports(seed, point, faction, stations) {
  const imports = HOME_IMPORTS[point.id];
  if (!imports) return;
  const host = stations.find((s) => s.type === 'foundry') ?? stations.find((s) => s.type === 'tradingPost');
  if (host) {
    host.imports = imports;
    return;
  }
  const rng = createRng(hashString(`${seed}:imports:${point.id}`));
  stations.push({
    id: `${point.id}-${slug('tradingPost')}`,
    name: `${point.name} ${STATION_LABELS.tradingPost}`,
    short: STATION_LABELS.tradingPost,
    type: 'tradingPost',
    faction,
    ...stationTrade('tradingPost', 1),
    imports,
    ...polar(between(rng, 150, 220), widestGap(rng, stations)),
  });
}

// ---------- Signals ----------

/** About this share of the systems from HAZARD_DEPTH out hold a signal. */
export const SIGNAL_SHARE = 0.3;
/** Of the other signals, this share are derelicts; the rest are rich fields. */
const DERELICT_SHARE = 0.6;
/** What a derelict may hold: processed materials and components. */
const SALVAGE_GOODS = ['steel', 'glass', 'titanium-alloy', 'optics', 'hull-plating', 'circuits', 'sensor-arrays'];
/** Ores a rich field may hold, titanium and crystal more often. */
const RICH_ORES = ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'ice', 'titanium-ore', 'titanium-ore', 'crystal-ore', 'crystal-ore'];
/** How many ancient gate pairs a galaxy has, and how far apart their ends are at least (galaxy units). */
const ANCIENT_PAIRS = [2, 3];
const ANCIENT_GAP = 850;
/** An ancient lane's jump: as long as the longest lane, and nobody charges for it. */
const ANCIENT_LANE = { minutes: 15, fee: 0 };

/** Where a system's signal sits: out past the planets, clear of the gates. */
function signalSpot(rng, system) {
  const gateAngles = system.gates.map((gate) => gate.angle);
  let angle = rng() * 360;
  for (let k = 0; k < 12; k += 1) {
    if (gateAngles.every((a) => Math.min(Math.abs(a - angle) % 360, 360 - (Math.abs(a - angle) % 360)) > 22)) break;
    angle += 30;
  }
  return polar(between(rng, 420, 440), angle);
}

/**
 * Seeds the signals of the deep systems: derelicts and rich fields, then
 * turns a few far-apart pairs into ancient gates. Each system rolls on its
 * own seed. Returns the ancient lanes.
 */
function placeSignals(seed, systems, lanes) {
  const linked = new Set(lanes.map((lane) => `${lane.a}|${lane.b}`));
  for (const system of systems) {
    if (system.depth < HAZARD_DEPTH) continue;
    const rng = createRng(hashString(`${seed}:signal:${system.id}`));
    if (rng() >= SIGNAL_SHARE) continue;
    const base = { id: `${system.id}-signal`, name: 'Unknown signal', ...signalSpot(rng, system) };
    if (rng() < DERELICT_SHARE) {
      system.signal = { ...base, kind: 'derelict', good: pick(rng, SALVAGE_GOODS), qty: Math.round(between(rng, 100, 400) / 10) * 10 };
    } else {
      const field = {
        id: `${system.id}-lode`,
        name: `${pick(rng, FIELD_ADJECTIVES)} Lode`,
        good: pick(rng, RICH_ORES),
        richness: Math.round(between(rng, 3, 4) * 100) / 100,
        signal: base.id,
        x: base.x,
        y: base.y,
      };
      system.signal = { ...base, kind: 'rich', field };
    }
  }

  const rng = createRng(hashString(`${seed}:ancient`));
  const [fewest, most] = ANCIENT_PAIRS;
  const pairs = fewest + Math.floor(rng() * (most - fewest + 1));
  const ancient = [];
  const used = new Set();
  for (let k = 0; k < pairs; k += 1) {
    const free = systems.filter((s) => s.signal && !used.has(s.id));
    const a = free.length ? pick(rng, free) : null;
    const far = free.filter((b) => b !== a && Math.hypot(b.gx - a.gx, b.gy - a.gy) >= ANCIENT_GAP && !linked.has(`${a.id}|${b.id}`) && !linked.has(`${b.id}|${a.id}`));
    if (!far.length) continue;
    const b = pick(rng, far);
    used.add(a.id);
    used.add(b.id);
    for (const [here, there] of [
      [a, b],
      [b, a],
    ]) {
      const { id, name, x, y } = here.signal;
      const angle = deg(Math.atan2(there.gy - here.gy, there.gx - here.gx));
      const gate = { id: `${here.id}-ancient-gate`, name: `Ancient gate to ${there.name}`, short: there.name, to: there.id, angle, ancient: true, x, y };
      here.signal = { id, name, x, y, kind: 'gate', to: there.id, gate };
    }
    ancient.push({ a: a.id, b: b.id, length: Math.round(Math.hypot(a.gx - b.gx, a.gy - b.gy)), ...ANCIENT_LANE, ancient: true });
  }
  return ancient;
}

function laneFor(a, b) {
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  const t = Math.min(1, Math.max(0, (length - LANE_SHORT) / (LANE_LONG - LANE_SHORT)));
  return {
    a: a.id,
    b: b.id,
    length: Math.round(length),
    minutes: Math.round(JUMP_MINUTES.min + t * (JUMP_MINUTES.max - JUMP_MINUTES.min)),
    fee: Math.round((JUMP_FEE.min + t * (JUMP_FEE.max - JUMP_FEE.min)) / 50) * 50,
  };
}

/** The whole galaxy for a seed: { seed, systems, lanes, factions }. */
export function generateGalaxy(seed) {
  const rng = createRng(hashString(`${seed}:galaxy`));
  const points = placeSystems(rng);
  const fixedNames = points.filter((p) => p.fixed).map((p) => p.name);
  const names = systemNames(rng, points.length - fixedNames.length, fixedNames);
  let next = 0;
  for (const p of points) {
    if (p.fixed) continue;
    p.name = names[next];
    p.id = slug(names[next]);
    next += 1;
  }

  const edges = connectLanes(rng, points);
  const adjacency = points.map(() => []);
  for (const [i, j] of edges) {
    adjacency[i].push(j);
    adjacency[j].push(i);
  }
  const depth = depthsFrom(points.length, adjacency, 0);
  const others = chooseFactions(rng);
  const owner = claimRegions(rng, points, adjacency, depth, others);

  const systems = points.map((p, i) => {
    if (i === 0) return { ...HOME_SYSTEM, gx: 0, gy: 0, depth: 0, hazard: null };
    const hazard = depth[i] >= HAZARD_DEPTH ? HAZARDS[hashString(`${seed}:${p.id}:hazard`) % HAZARDS.length] : null;
    const neighbours = adjacency[i].map((j) => ({ point: points[j] }));
    return buildSystem(seed, p, depth[i], owner[i], neighbours, hazard);
  });
  const lanes = edges.map(([i, j]) => laneFor(points[i], points[j]));
  const ancientLanes = placeSignals(seed, systems, lanes);
  const factions = { [HOME_FACTION]: { ...HALCYON, capital: HOME_SYSTEM.id } };
  for (const f of others) factions[f.id] = { ...f, capital: points[f.capital]?.id ?? null };
  return { seed, systems, lanes, ancientLanes, factions };
}

// ---------- The galaxy in play ----------

function indexGalaxy(galaxy) {
  const systems = new Map();
  const places = new Map();
  const links = new Map();
  for (const system of galaxy.systems) {
    systems.set(system.id, system);
    links.set(system.id, []);
    for (const kind of ['stations', 'fields', 'planets', 'gates']) {
      for (const place of system[kind]) places.set(place.id, { place, system: system.id, kind });
    }
    // A signal is a place of its own; what it turns out to be (a rich
    // field, an ancient gate) is one too, found by the usual lookups.
    const signal = system.signal;
    if (signal) {
      places.set(signal.id, { place: signal, system: system.id, kind: 'signals' });
      if (signal.field) places.set(signal.field.id, { place: signal.field, system: system.id, kind: 'fields' });
      if (signal.gate) places.set(signal.gate.id, { place: signal.gate, system: system.id, kind: 'gates' });
    }
  }
  for (const lane of galaxy.lanes) {
    links.get(lane.a)?.push({ to: lane.b, lane });
    links.get(lane.b)?.push({ to: lane.a, lane });
  }
  const ancient = new Map();
  for (const lane of galaxy.ancientLanes ?? []) {
    ancient.set(lane.a, { to: lane.b, lane });
    ancient.set(lane.b, { to: lane.a, lane });
  }
  return { ...galaxy, byId: systems, places, links, ancient };
}

const HOME_ONLY = indexGalaxy({
  seed: null,
  systems: [{ ...HOME_SYSTEM, gx: 0, gy: 0, depth: 0, hazard: null }],
  lanes: [],
  ancientLanes: [],
  factions: { [HOME_FACTION]: { ...HALCYON, capital: HOME_SYSTEM.id } },
});

let active = HOME_ONLY;
const cache = new Map();

/** Makes the galaxy for `seed` the one in play. Cheap after the first call. */
export function useGalaxy(seed) {
  if (active.seed === seed) return active;
  if (!cache.has(seed)) {
    cache.clear();
    cache.set(seed, indexGalaxy(generateGalaxy(seed)));
  }
  active = cache.get(seed);
  return active;
}

export function currentGalaxy() {
  return active;
}

export function allSystems() {
  return active.systems;
}

export function findSystem(id) {
  return active.byId.get(id) ?? null;
}

export function findFaction(id) {
  return active.factions[id] ?? null;
}

export function allFactions() {
  return Object.values(active.factions);
}

function placeOfKind(id, kind) {
  const entry = active.places.get(id);
  return entry && entry.kind === kind ? entry.place : null;
}

export function findStation(id) {
  return placeOfKind(id, 'stations');
}

export function findField(id) {
  return placeOfKind(id, 'fields');
}

export function findGate(id) {
  return placeOfKind(id, 'gates');
}

/** Any placed thing (station, field, planet or gate) by id. */
export function findPlace(id) {
  return active.places.get(id)?.place ?? null;
}

/** The id of the system a place is in. */
export function systemOf(placeId) {
  return active.places.get(placeId)?.system ?? null;
}

/** The lanes out of a system: [{ to, lane }]. */
export function lanesFrom(systemId) {
  return active.links.get(systemId) ?? [];
}

/** The ancient lane out of a system, { to, lane }, or null. It works only once both ends are investigated (systems/signals.js). */
export function ancientLaneFrom(systemId) {
  return active.ancient.get(systemId) ?? null;
}

/** A system's signal, or null. */
export function signalIn(systemId) {
  return findSystem(systemId)?.signal ?? null;
}

/** A signal by id. */
export function findSignal(id) {
  return placeOfKind(id, 'signals');
}

/** The lane between two systems, or null. */
export function laneBetween(a, b) {
  return lanesFrom(a).find((link) => link.to === b)?.lane ?? null;
}

/** The gate in `systemId` that leads to `toSystemId`. */
export function gateTo(systemId, toSystemId) {
  return findSystem(systemId)?.gates.find((g) => g.to === toSystemId) ?? null;
}

/** Every station in the galaxy, or in one system. */
export function allStations(systemId = null) {
  if (systemId) return findSystem(systemId)?.stations ?? [];
  return active.systems.flatMap((s) => s.stations);
}

/** The faction that owns a station. */
export function factionOf(stationId) {
  const station = findStation(stationId);
  return station ? findFaction(station.faction) : null;
}
