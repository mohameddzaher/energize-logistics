/**
 * Sending from a company mailbox (Hostinger).
 * The mailbox password is not in code or .env: it is read encrypted from the company emails register (CompanyEmail, utils/secretVault) at send time, so a change there applies from the next message.
 * The message is sent (SMTP) then copied to the Sent folder of the same mailbox (IMAP), so the department sees it in Outlook as sent from there. Copying is an extra: if it fails the send still counts as successful.
 */
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');

const SMTP_HOST = process.env.MAIL_SMTP_HOST || 'smtp.hostinger.com';
const IMAP_HOST = process.env.MAIL_IMAP_HOST || 'imap.hostinger.com';

const bad = (msg, status = 409, code) => Object.assign(new Error(msg), { status, code });

async function credentialsFor(address) {
  const CompanyEmail = require('../models/CompanyEmail');
  const vault = require('./secretVault');
  const doc = await CompanyEmail.findOne({ email: String(address).toLowerCase().trim() }).select('+passwordEnc email displayName').lean();
  if (!doc) throw bad(`الصندوق ${address} غير مسجَّل في «إيميلات الشركة»`, 409, 'MAILBOX_MISSING');
  if (!doc.passwordEnc) throw bad(`ضع كلمة مرور ${address} في «تقنية المعلومات ← إيميلات الشركة» أوّلًا`, 409, 'MAILBOX_NO_PASSWORD');
  return { user: doc.email, pass: vault.decrypt(doc.passwordEnc), name: doc.displayName || '' };
}

/**
 * Sends a message from the company mailbox.
 * @returns {{ messageId: string, savedToSent: boolean }}
 */
async function sendFromMailbox(address, { fromName, to, cc, subject, text, html, attachments, transport: given }) {
  let transport = given;
  const cred = await credentialsFor(address);
  const message = {
    from: { name: fromName || cred.name || cred.user, address: cred.user },
    to, cc: cc && cc.length ? cc : undefined, subject, text, html, attachments,
  };
  // Local testing only: MAIL_TRANSPORT=json captures the message without sending.
  if (!transport && process.env.MAIL_TRANSPORT === 'json') transport = nodemailer.createTransport({ jsonTransport: true });
  const t = transport || nodemailer.createTransport({
    host: SMTP_HOST, port: 465, secure: true, auth: { user: cred.user, pass: cred.pass },
    connectionTimeout: 20000, socketTimeout: 60000,
  });
  const info = await t.sendMail(message);

  let savedToSent = false;
  if (!transport) {
    try {
      const raw = await new MailComposer({ ...message, messageId: info.messageId, date: new Date() }).compile().build();
      const { ImapFlow } = require('imapflow');
      const imap = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: cred.user, pass: cred.pass }, logger: false });
      await imap.connect();
      const boxes = await imap.list();
      const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /sent/i.test(b.path));
      if (sent) { await imap.append(sent.path, raw, ['\\Seen']); savedToSent = true; }
      await imap.logout();
    } catch (e) { console.error('[mailer] copy to Sent failed:', e.message); }
  }
  return { messageId: info.messageId, savedToSent, raw: process.env.MAIL_TRANSPORT === 'json' ? info.message : undefined };
}

module.exports = { sendFromMailbox, credentialsFor };
