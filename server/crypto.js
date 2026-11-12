'use strict';

// Account numbers, keyed hashes and session tokens.
//
// Account numbers and emails are looked up by value, so they cannot carry a
// per-row salt. Instead they are hashed with HMAC-SHA256 under a server-side
// secret (the pepper) that never goes into the database: a database dump
// alone reveals neither numbers nor emails.

const crypto = require('node:crypto');

const NUMBER_DIGITS = 16;

/** A new account number: 16 random digits as a string. */
function newAccountNumber() {
  let digits = '';
  for (let i = 0; i < NUMBER_DIGITS; i++) digits += crypto.randomInt(10);
  return digits;
}

/** Strips spaces and dashes; returns the 16 digits, or null when it is not a number. */
function normalizeNumber(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${NUMBER_DIGITS}}$`).test(digits) ? digits : null;
}

/** 1234 5678 9012 3456 */
function formatNumber(digits) {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Lowercased and trimmed, or null when it does not look like an email. */
function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function createHasher(pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('CLOUD_PEPPER must be set to a secret of at least 32 characters');
  }
  const hmac = (kind, value) => crypto.createHmac('sha256', pepper).update(`${kind}:${value}`).digest();
  return {
    number: (digits) => hmac('number', digits),
    email: (email) => hmac('email', email),
  };
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest();
}

module.exports = {
  NUMBER_DIGITS,
  newAccountNumber,
  normalizeNumber,
  formatNumber,
  normalizeEmail,
  createHasher,
  newSessionToken,
  hashToken,
};
