import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNumber } from '../../apps/driftworks/scripts/build-number.mjs';

test('buildNumber: releases sort above their release candidates', () => {
  assert.equal(buildNumber('1.4.2'), 1040299);
  assert.equal(buildNumber('1.4.2-rc.3'), 1040203);
  assert.ok(buildNumber('1.4.2-rc.3') < buildNumber('1.4.2'));
  assert.ok(buildNumber('1.4.2') < buildNumber('1.4.3-rc.1'));
  assert.ok(buildNumber('1.99.99') < buildNumber('2.0.0-beta'));
  assert.equal(buildNumber('2.0.0-beta'), 2000000);
});

test('buildNumber: dev builds use the run number', () => {
  assert.equal(buildNumber('0.0.0-dev', '57'), 57);
  assert.equal(buildNumber('0.0.0-dev'), 1);
});

test('buildNumber: refuses what it cannot number', () => {
  assert.throws(() => buildNumber('v1.2.3'));
  assert.throws(() => buildNumber('1.100.0'));
});
