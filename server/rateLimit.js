'use strict';

// A small fixed-window rate limiter kept in memory. It is per process, so
// the Helm chart refuses to run cloud saves with more than one replica.

function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  let lastSweep = now();

  function sweep(at) {
    if (at - lastSweep < windowMs) return;
    lastSweep = at;
    for (const [key, entry] of hits) if (entry.resetAt <= at) hits.delete(key);
  }

  return {
    /** Counts a hit for `key`; returns { ok, retryAfter } (seconds). */
    hit(key) {
      const at = now();
      sweep(at);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= at) {
        entry = { count: 0, resetAt: at + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > limit) return { ok: false, retryAfter: Math.ceil((entry.resetAt - at) / 1000) };
      return { ok: true, retryAfter: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

module.exports = { createRateLimiter };
