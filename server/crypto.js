'use strict';

// Save codes and keyed hashes.
//
// Save codes and emails are looked up by value, so they cannot carry a
// per-row salt. Instead they are hashed with HMAC-SHA256 under a server-side
// secret (the pepper) that never goes into the database: a database dump
// alone reveals neither codes nor emails.

const crypto = require('node:crypto');

const CODE_DIGITS = 16;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_DIGITS}}$`);

/** A new save code: 16 random digits as a string. */
function newSaveCode() {
  let digits = '';
  for (let i = 0; i < CODE_DIGITS; i++) digits += crypto.randomInt(10);
  return digits;
}

/** Strips spaces and dashes; returns the 16 digits, or null when it is not a code. */
function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s-]/g, '');
  return CODE_PATTERN.test(digits) ? digits : null;
}

/** 1234 5678 9012 3456 */
function formatCode(digits) {
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
    code: (digits) => hmac('code', digits),
    email: (email) => hmac('email', email),
  };
}

module.exports = { CODE_DIGITS, newSaveCode, normalizeCode, formatCode, normalizeEmail, createHasher };
