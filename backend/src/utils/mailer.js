/**
 * الإرسالُ من صندوقٍ من صناديق الشركة (Hostinger) — صاحبُ الشركة، ٢٠٢٦/١٠/٢٤.
 *
 * كلمةُ مرور الصندوق لا تُكتب في الشيفرة ولا في .env: تُقرأ مشفّرةً من «إيميلات
 * الشركة» (CompanyEmail · utils/secretVault) لحظةَ الإرسال. فمن غيّرها هناك
 * يصل تغييرُه أوّلَ رسالةٍ بعده.
 *
 * والرسالةُ تُرسَل (SMTP) ثمّ تُنسَخ إلى «المرسل» في الصندوق نفسِه (IMAP) — فيراها
 * القسمُ في أوتلوك كأنّه أرسلها منه. والنسخُ تحسين: إن تعثّر لا تُعدّ الرسالةُ فاشلة.
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
 * يرسل رسالةً من صندوق الشركة.
 * @returns {{ messageId: string, savedToSent: boolean }}
 */
async function sendFromMailbox(address, { fromName, to, cc, subject, text, html, attachments, transport: given }) {
  let transport = given;
  const cred = await credentialsFor(address);
  const message = {
    from: { name: fromName || cred.name || cred.user, address: cred.user },
    to, cc: cc && cc.length ? cc : undefined, subject, text, html, attachments,
  };
  // للاختبار المحلّيّ وحدَه: MAIL_TRANSPORT=json يلتقط الرسالةَ بلا إرسال.
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
