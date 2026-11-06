import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashString, seededUnit } from '../../public/games/driftworks/core/rng.js';

test('the same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 5 }, a);
  const seqB = Array.from({ length: 5 }, b);
  assert.deepEqual(seqA, seqB);
  for (const value of seqA) assert.ok(value >= 0 && value < 1);
});

test('different seeds give different sequences', () => {
  assert.notEqual(createRng(1)(), createRng(2)());
});

test('hashString and seededUnit are stable', () => {
  assert.equal(hashString('aurel'), hashString('aurel'));
  assert.notEqual(hashString('aurel'), hashString('aurel2'));
  assert.equal(seededUnit(7, 'refinery:iron'), seededUnit(7, 'refinery:iron'));
  assert.notEqual(seededUnit(7, 'refinery:iron'), seededUnit(8, 'refinery:iron'));
});
