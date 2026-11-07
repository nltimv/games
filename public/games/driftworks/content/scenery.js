// How each system looks: its star's class and its sky. Seeded from the
// system's id, so a system looks the same on every visit, and kept apart
// from the galaxy's generation so the galaxy itself never changes. Aurel
// keeps its yellow star and blue sky.

import { HOME_SYSTEM } from './homeSystem.js';
import { findFaction, HOME_FACTION } from './galaxy.js';
import { createRng, hashString } from '../core/rng.js';

/**
 * Star classes, coolest first. `size` scales the star's disc and glow;
 * `body` is the disc from its hot middle to its edge, `glow` the light
 * around it. `weight` is how common the class is.
 */
export const STAR_CLASSES = {
  M: { name: 'Red dwarf', weight: 28, size: 0.7, glowSize: 0.75, body: ['#fff0e8', '#ffb092', '#ec6446', '#c8402f'], glow: ['#ffb09a', '#ff6a4a', '#d9402c'] },
  K: { name: 'Orange star', weight: 24, size: 0.88, glowSize: 0.9, body: ['#ffffff', '#ffe2b8', '#ffa45a', '#ff7f33'], glow: ['#ffd2a0', '#ff9a4e', '#ff7a32'] },
  G: { name: 'Yellow star', weight: 20, size: 1, glowSize: 1, body: ['#ffffff', '#fff1c2', '#ffbd5c', '#ff9b3a'], glow: ['#ffe3a3', '#ffb45e', '#ff9a3d'] },
  F: { name: 'Yellow-white star', weight: 13, size: 1.06, glowSize: 1.08, body: ['#ffffff', '#fffcf0', '#fff0bf', '#ffd67e'], glow: ['#fff6d6', '#ffe6a0', '#ffd27a'] },
  A: { name: 'White star', weight: 9, size: 1.14, glowSize: 1.2, body: ['#ffffff', '#f8fbff', '#dde9ff', '#b9d0ff'], glow: ['#f2f6ff', '#cfdcff', '#a9c2ff'] },
  B: { name: 'Blue giant', weight: 6, size: 1.34, glowSize: 1.45, body: ['#ffffff', '#e6f1ff', '#a2c6ff', '#6596ff'], glow: ['#dcebff', '#9cc0ff', '#5d8cff'] },
};

// Sky colours: a dark base gradient and soft nebula glows.
const BASES = [
  ['#081634', '#040a1d'],
  ['#0b1030', '#05061a'],
  ['#0a1a2c', '#030c14'],
  ['#120c2a', '#06041a'],
  ['#06141f', '#020a10'],
  ['#140d1c', '#07050e'],
];
const NEBULAE = [
  'rgba(21, 64, 122, 0.85)',
  'rgba(15, 85, 96, 0.8)',
  'rgba(70, 36, 120, 0.75)',
  'rgba(110, 32, 84, 0.6)',
  'rgba(120, 66, 24, 0.55)',
  'rgba(24, 92, 60, 0.6)',
  'rgba(30, 40, 110, 0.8)',
  'rgba(112, 40, 40, 0.55)',
];

// Aurel's sky.
export const HOME_SKY = {
  base: BASES[0],
  glows: [
    { x: 0.28, y: 0.3, r: 0.55, color: NEBULAE[0] },
    { x: 0.72, y: 0.95, r: 0.45, color: NEBULAE[1] },
  ],
  stars: 1,
  seed: hashString('sky'),
};

/** The colour a station's art is tinted: its faction's (Halcyon's art is already its colour). */
export function stationTint(station) {
  return station && station.faction !== HOME_FACTION ? (findFaction(station.faction)?.color ?? null) : null;
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function weighted(rng, entries) {
  const total = entries.reduce((sum, [, entry]) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const [id, entry] of entries) {
    roll -= entry.weight;
    if (roll < 0) return id;
  }
  return entries.at(-1)[0];
}

const looks = new Map();

/**
 * A system's look: { starClass, star (its STAR_CLASSES entry), sky:
 * { base, glows: [{ x, y, r, color }], stars, seed }, planetTints:
 * { [planetId]: colour or null } }. Glow positions and sizes are
 * fractions of the screen.
 */
export function sceneryOf(system) {
  if (!system) return sceneryOf(HOME_SYSTEM);
  const cached = looks.get(system.id);
  if (cached) return cached;
  let look;
  if (system.id === HOME_SYSTEM.id) {
    look = { starClass: 'G', star: STAR_CLASSES.G, sky: HOME_SKY, planetTints: {} };
  } else {
    const rng = createRng(hashString(`${system.id}:scenery`));
    const starClass = weighted(rng, Object.entries(STAR_CLASSES));
    const pickFrom = (list) => list[Math.floor(rng() * list.length)];
    const first = pickFrom(NEBULAE);
    const second = pickFrom(NEBULAE.filter((color) => color !== first));
    const faction = findFaction(system.faction);
    const glows = [
      { x: 0.1 + rng() * 0.4, y: 0.1 + rng() * 0.4, r: 0.45 + rng() * 0.25, color: first },
      { x: 0.5 + rng() * 0.45, y: 0.55 + rng() * 0.45, r: 0.35 + rng() * 0.2, color: second },
    ];
    // A faint wash of the owner's colour in one corner.
    if (faction) glows.push({ x: rng() < 0.5 ? 0.95 : 0.05, y: rng() < 0.5 ? 0.05 : 0.95, r: 0.4, color: rgba(faction.color, 0.16) });
    const planetTints = {};
    for (const planet of system.planets) {
      const tints = planet.kind === 'ice' ? [null, null, '#c9c2ff', '#a9f0e4', '#bcd7ff'] : [null, '#d9b27a', '#a7a29b', '#c77a5a', '#9fb38a'];
      planetTints[planet.id] = pickFrom(tints);
    }
    look = { starClass, star: STAR_CLASSES[starClass], sky: { base: pickFrom(BASES), glows, stars: 0.6 + rng() * 0.9, seed: hashString(`${system.id}:sky`) }, planetTints };
  }
  looks.set(system.id, look);
  return look;
}
