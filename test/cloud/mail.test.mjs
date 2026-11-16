import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');
const { createMailer, senderFor } = require('../../server/mail.js');

const jsonMailer = () => createMailer({ MAIL_FROM: 'Games Hub <noreply@example.com>' }, { transport: nodemailer.createTransport({ jsonTransport: true }) });
const read = (info) => JSON.parse(info.message);

test('mails go out in the game\'s name, from the MAIL_FROM address', async () => {
  const mail = read(await jsonMailer().sendEmailLinked('p@example.com', { game: 'Driftworks', name: 'Aurel Mining', code: '1234 5678 9012 3456' }));
  assert.deepEqual(mail.from, { address: 'noreply@example.com', name: 'Driftworks' });
  assert.equal(mail.subject, 'Your Driftworks save code');
  assert.match(mail.text, /recovery email for a Driftworks save/);
  assert.match(mail.text, /Aurel Mining: 1234 5678 9012 3456/);
  assert.doesNotMatch(mail.text, /Games Hub/);
});

test('recovery mails name the game too', async () => {
  const mail = read(await jsonMailer().sendCodes('p@example.com', { game: 'Driftworks', saves: [{ name: 'A', code: '1' }, { name: 'B', code: '2' }] }));
  assert.equal(mail.from.name, 'Driftworks');
  assert.equal(mail.subject, 'Your Driftworks save codes');
  assert.match(mail.text, /codes of the Driftworks saves/);
});

test('the sender name cannot break the header', () => {
  assert.deepEqual(senderFor('noreply@example.com', 'Bad"<x>\r\nGame'), { name: 'BadxGame', address: 'noreply@example.com' });
});
