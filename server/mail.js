'use strict';

// Sends the recovery mail. Without SMTP_HOST there is no mailer and the
// recovery option is hidden from players.

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
  return {
    async sendNewNumber(to, formattedNumber) {
      await transport.sendMail({
        from,
        to,
        subject: 'Your new Games Hub account number',
        text: [
          'Someone asked to recover the Games Hub account linked to this email address.',
          '',
          `Your new account number is: ${formattedNumber}`,
          '',
          'Your old number no longer works, and every device was logged out.',
          'If you did not ask for this, log in with the new number; nothing else changed.',
        ].join('\n'),
      });
    },
  };
}

module.exports = { createMailer };
