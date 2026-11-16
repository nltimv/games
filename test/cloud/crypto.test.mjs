import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { newSaveCode, normalizeCode, formatCode, normalizeEmail, createHasher } = require('../../server/crypto.js');
const { createRateLimiter } = require('../../server/rateLimit.js');

const PEPPER = 'a-test-pepper-that-is-long-enough-123';

test('save codes are 16 random digits', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = newSaveCode();
    assert.match(code, /^\d{16}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 200);
});

test('codes are shown in groups of four and accepted with spaces or dashes', () => {
  assert.equal(formatCode('1234567890123456'), '1234 5678 9012 3456');
  assert.equal(normalizeCode('1234 5678 9012 3456'), '1234567890123456');
  assert.equal(normalizeCode(' 1234-5678-9012-3456 '), '1234567890123456');
  assert.equal(normalizeCode('1234 5678 9012 345'), null);
  assert.equal(normalizeCode('abcd567890123456'), null);
  assert.equal(normalizeCode(1234567890123456), null);
});

test('emails are trimmed and lowercased before hashing', () => {
  assert.equal(normalizeEmail('  Player@Example.COM '), 'player@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(undefined), null);
});

test('hashes are keyed: same input and pepper match, another pepper does not', () => {
  const a = createHasher(PEPPER);
  const b = createHasher(`${PEPPER}-other`);
  assert.deepEqual(a.code('1234567890123456'), a.code('1234567890123456'));
  assert.notDeepEqual(a.code('1234567890123456'), b.code('1234567890123456'));
  assert.equal(a.code('1234567890123456').length, 32);
  // A code and an email with the same text never share a hash.
  assert.notDeepEqual(a.code('x@y.z'), a.email('x@y.z'));
  // The hash does not contain the input.
  assert.ok(!a.email('player@example.com').toString('latin1').includes('player'));
});

test('a short or missing pepper is refused', () => {
  assert.throws(() => createHasher(undefined), /CLOUD_PEPPER/);
  assert.throws(() => createHasher('short'), /CLOUD_PEPPER/);
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.blocked('ip').ok, true);
  assert.equal(limiter.hit('ip').ok, true);
  assert.equal(limiter.blocked('ip').ok, true);
  assert.equal(limiter.hit('ip').ok, true);
  assert.equal(limiter.blocked('ip').ok, false);
  const blocked = limiter.hit('ip');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 1);
  assert.equal(limiter.hit('other').ok, true);
  now = 1000;
  assert.equal(limiter.blocked('ip').ok, true);
  assert.equal(limiter.hit('ip').ok, true);
});
