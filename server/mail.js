'use strict';

// Sends the mails about save codes. Without SMTP_HOST there is no mailer
// and the recovery option is hidden from players.

const nodemailer = require('nodemailer');

/** "Driftworks <noreply@example.com>": the game's name with MAIL_FROM's address. */
function senderFor(mailFrom, game) {
  const address = /<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom.trim();
  const name = String(game || 'Games Hub').replace(/["\\\r\n<>]/g, '');
  return { name, address };
}

/**
 * Mails go out in the name of the game the save belongs to (its title from
 * src/games.json), from the address in MAIL_FROM.
 */
function createMailer(env = process.env, { transport: injected } = {}) {
  if (!env.SMTP_HOST && !injected) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const transport =
    injected ??
    nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  const mailFrom = env.MAIL_FROM || 'noreply@localhost';
  const line = (save) => `${save.name || 'Save'}: ${save.code}`;
  return {
    /** Confirms a recovery email for a save ({ game, name, code }), with its code. */
    async sendEmailLinked(to, save) {
      const game = save.game || 'Games Hub';
      return transport.sendMail({
        from: senderFor(mailFrom, game),
        to,
        subject: `Your ${game} save code`,
        text: [
          `This address is now the recovery email for a ${game} save.`,
          '',
          line(save),
          '',
          'Keep this mail: with the save code you can load the save on any device.',
          'If you lose the code, choose "Lost a code?" in the game and we send it here again.',
          'If you did not add this address, you can ignore this mail.',
        ].join('\n'),
      });
    },
    /** Sends the codes of the saves of one game ({ game, saves }) linked to the address. */
    async sendCodes(to, { game = 'Games Hub', saves }) {
      return transport.sendMail({
        from: senderFor(mailFrom, game),
        to,
        subject: saves.length > 1 ? `Your ${game} save codes` : `Your ${game} save code`,
        text: [
          `Someone asked for the codes of the ${game} saves linked to this email address.`,
          '',
          ...saves.map(line),
          '',
          'Add a save to a device with its code: Load game, Add a save with a code.',
          'If you did not ask for this, you can ignore this mail; nothing changed.',
        ].join('\n'),
      });
    },
  };
}

module.exports = { createMailer, senderFor };
