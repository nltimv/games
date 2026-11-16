'use strict';

// Save codes and keyed hashes.
//
// Save codes and emails are looked up by value, so they cannot carry a
// per-row salt. Instead they are hashed with HMAC-SHA256 under a server-side
// secret (the pepper) that never goes into the database: a database dump
// alone reveals neither codes nor emails.
//
// The code is also kept encrypted (AES-256-GCM under a key derived from the
// pepper), so email recovery can mail a save's code again. A dump without
// the pepper still reveals no codes.

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
  const key = crypto.createHmac('sha256', pepper).update('code-encryption-key').digest();
  return {
    code: (digits) => hmac('code', digits),
    email: (email) => hmac('email', email),
    /** iv (12 bytes) + tag (16) + ciphertext. */
    encryptCode(digits) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    /** The code's digits, or null when the value is missing or does not decrypt under this pepper. */
    decryptCode(blob) {
      if (!Buffer.isBuffer(blob) || blob.length <= 28) return null;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
        decipher.setAuthTag(blob.subarray(12, 28));
        const digits = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
        return normalizeCode(digits);
      } catch {
        return null;
      }
    },
  };
}

module.exports = { CODE_DIGITS, newSaveCode, normalizeCode, formatCode, normalizeEmail, createHasher };
