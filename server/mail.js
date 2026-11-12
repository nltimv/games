'use strict';

// Sends the mails about save codes. Without SMTP_HOST there is no mailer
// and the recovery option is hidden from players.

const nodemailer = require('nodemailer');

function createMailer(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  const from = env.MAIL_FROM || 'Games Hub <noreply@localhost>';
  const line = (save) => `${save.name || 'Save'}: ${save.code}`;
  return {
    /** Confirms a recovery email for a save, with its code. */
    async sendEmailLinked(to, save) {
      await transport.sendMail({
        from,
        to,
        subject: 'Your Games Hub save code',
        text: [
          'This address is now the recovery email for a Games Hub save.',
          '',
          line(save),
          '',
          'Keep this mail: with the save code you can load the save on any device.',
          'If you lose the code, choose "Lost a code?" in the game and we send a new one here.',
          'If you did not add this address, you can ignore this mail.',
        ].join('\n'),
      });
    },
    /** Sends the new codes of every save linked to the address. */
    async sendNewCodes(to, saves) {
      await transport.sendMail({
        from,
        to,
        subject: saves.length > 1 ? 'Your new Games Hub save codes' : 'Your new Games Hub save code',
        text: [
          'Someone asked to recover the Games Hub saves linked to this email address.',
          '',
          ...saves.map(line),
          '',
          'The old codes no longer work. Add a save to a device with its new code.',
          'If you did not ask for this, use the new codes from now on; nothing else changed.',
        ].join('\n'),
      });
    },
  };
}

module.exports = { createMailer };
