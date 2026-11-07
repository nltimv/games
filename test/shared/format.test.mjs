import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCredits, formatCreditsDelta, formatDuration, formatNumber } from '../../public/shared/js/format.js';

test('formatNumber groups thousands and compacts big numbers', () => {
  assert.equal(formatNumber(1234), '1,234');
  assert.equal(formatNumber(12_345, { compact: true }), '12.3k');
  assert.equal(formatNumber(2_000_000, { compact: true }), '2M');
  assert.equal(formatNumber(-50), '−50');
  assert.equal(formatNumber(Number.NaN), '–');
});

test('credits read naturally', () => {
  assert.equal(formatCredits(1240.4), '1,240 cr');
  assert.equal(formatCreditsDelta(300), '+300 cr');
  assert.equal(formatCreditsDelta(-80), '−80 cr');
});

test('durations round up so a running timer never shows zero', () => {
  assert.equal(formatDuration(0), 'now');
  assert.equal(formatDuration(45_000), '45 s');
  assert.equal(formatDuration(60_001), '2 min');
  assert.equal(formatDuration(8 * 60_000), '8 min');
  assert.equal(formatDuration(65 * 60_000), '1 h 05');
  assert.equal(formatDuration(120 * 60_000), '2 h');
});
