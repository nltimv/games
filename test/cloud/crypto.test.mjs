import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { newAccountNumber, normalizeNumber, formatNumber, normalizeEmail, createHasher, newSessionToken, hashToken } = require('../../server/crypto.js');
const { createRateLimiter } = require('../../server/rateLimit.js');

const PEPPER = 'a-test-pepper-that-is-long-enough-123';

test('account numbers are 16 random digits', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const number = newAccountNumber();
    assert.match(number, /^\d{16}$/);
    seen.add(number);
  }
  assert.equal(seen.size, 200);
});

test('numbers are shown in groups of four and accepted with spaces or dashes', () => {
  assert.equal(formatNumber('1234567890123456'), '1234 5678 9012 3456');
  assert.equal(normalizeNumber('1234 5678 9012 3456'), '1234567890123456');
  assert.equal(normalizeNumber(' 1234-5678-9012-3456 '), '1234567890123456');
  assert.equal(normalizeNumber('1234 5678 9012 345'), null);
  assert.equal(normalizeNumber('abcd567890123456'), null);
  assert.equal(normalizeNumber(1234567890123456), null);
});

test('emails are trimmed and lowercased before hashing', () => {
  assert.equal(normalizeEmail('  Player@Example.COM '), 'player@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(undefined), null);
});

test('hashes are keyed: same input and pepper match, another pepper does not', () => {
  const a = createHasher(PEPPER);
  const b = createHasher(`${PEPPER}-other`);
  assert.deepEqual(a.number('1234567890123456'), a.number('1234567890123456'));
  assert.notDeepEqual(a.number('1234567890123456'), b.number('1234567890123456'));
  assert.equal(a.number('1234567890123456').length, 32);
  // A number and an email with the same text never share a hash.
  assert.notDeepEqual(a.number('x@y.z'), a.email('x@y.z'));
  // The hash does not contain the input.
  assert.ok(!a.email('player@example.com').toString('latin1').includes('player'));
});

test('a short or missing pepper is refused', () => {
  assert.throws(() => createHasher(undefined), /CLOUD_PEPPER/);
  assert.throws(() => createHasher('short'), /CLOUD_PEPPER/);
});

test('session tokens are random and stored as a hash', () => {
  const token = newSessionToken();
  assert.ok(token.length >= 43);
  assert.notEqual(token, newSessionToken());
  assert.equal(hashToken(token).length, 32);
  assert.deepEqual(hashToken(token), hashToken(token));
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.hit('ip').ok, true);
  assert.equal(limiter.hit('ip').ok, true);
  const blocked = limiter.hit('ip');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 1);
  assert.equal(limiter.hit('other').ok, true);
  now = 1000;
  assert.equal(limiter.hit('ip').ok, true);
});
