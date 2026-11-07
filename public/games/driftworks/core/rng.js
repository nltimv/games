// Small deterministic random helpers. A save stores only its seed, and
// everything generated from it (prices, star positions) comes out the same
// every time.

/** Hashes any string to an unsigned 32-bit integer (FNV-1a). */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a fast seeded generator returning floats in [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable value in [0, 1) for a seed plus a label, e.g. a station's good. */
export function seededUnit(seed, label) {
  return createRng(hashString(`${seed}:${label}`))();
}

/** A fresh seed for a new save. */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
