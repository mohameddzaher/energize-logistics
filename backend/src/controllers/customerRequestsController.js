/**
 * Customer requests: sent from the portal, answered by Operations (the customer communication screen) or by email from a company mailbox.
 * Live events carry no content; screens refetch.
 */
const mongoose = require('mongoose');
const CustomerRequest = require('../models/CustomerRequest');
const logAudit = require('../utils/auditLogger');
const { createNotification, notifySection } = require('../services/notificationService');

const S = (v) => (v == null ? '' : String(v).trim());
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const emit = (userId) => {
  try {
    const sm = require('../websocket/socketManager');
    sm.emitToAll('customer-requests:changed', {});
    if (userId) sm.emitToUser(String(userId), 'customer-requests:mine', {});
  } catch (_) { /* best effort */ }
};
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emails = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => S(x).toLowerCase()).filter(Boolean))];

function cleanItems(raw) {
  return (Array.isArray(raw) ? raw : []).map((it) => ({
    text: S(it && it.text).slice(0, 2000),
    refType: ['invoice', 'shipment', 'date', 'other'].includes(S(it && it.refType)) ? S(it.refType) : '',
    ref: S(it && it.ref).slice(0, 120),
  })).filter((it) => it.text || it.ref).slice(0, 30);
}

/** Staff list view: the request without the long thread. */
const summary = (r) => ({
  _id: r._id, number: r.number, subject: r.subject, customerName: r.customerName, accountName: r.accountName,
  accountEmail: r.accountEmail, status: r.status, unreadStaff: r.unreadStaff, items: (r.items || []).length,
  messages: (r.messages || []).length, lastActivityAt: r.lastActivityAt, createdAt: r.createdAt,
  lastFrom: (r.messages || []).length ? r.messages[r.messages.length - 1].side : '',
});

// ── Portal side (the customer) ──────────────────────────────────────────────

async function identityOf(req) {
  const portal = require('./portalController');
  const partner = portal.partnerOf(req);
  if (!partner) return null;
  const identity = await portal.resolveIdentity(partner);
  return { partner, identity };
}

// GET /api/portal/requests
exports.myList = async (req, res) => {
  try {
    const rows = await CustomerRequest.find({ account: req.user._id }).sort({ lastActivityAt: -1 }).limit(500).lean();
    res.json({ items: rows.map((r) => ({ ...summary(r), unread: r.unreadCustomer })) });
  } catch (e) { res.status(500).json({ message: 'Could not load your requests' }); }
};

// GET /api/portal/requests/:id
exports.myOne = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
    const r = await CustomerRequest.findOne({ _id: req.params.id, account: req.user._id });
    if (!r) return res.status(404).json({ message: 'Not found' });
    if (r.unreadCustomer) { r.unreadCustomer = false; await r.save(); }
    const o = r.toObject();
    // The customer sees the replies, not our mailbox headers.
    o.messages = o.messages.map((m) => ({ _id: m._id, side: m.side, byName: m.side === 'staff' ? 'Energize Logistics' : m.byName, text: m.text, at: m.at }));
    res.json({ request: o });
  } catch (e) { res.status(500).json({ message: 'Could not load the request' }); }
};

// GET /api/portal/requests/options — what a point can refer to (the customer's own numbers).
exports.myOptions = async (req, res) => {
  try {
    const who = await identityOf(req);
    if (!who) return res.status(403).json({ message: 'Not a partner account' });
    const portal = require('./portalController');
    const { invoices, shipments } = await portal.referenceOptions(who.identity);
    res.json({ invoices, shipments });
  } catch (e) { res.status(500).json({ message: 'Could not load options' }); }
};

// POST /api/portal/requests { subject, items:[{text, refType, ref}], message }
exports.create = async (req, res) => {
  try {
    const who = await identityOf(req);
    if (!who) return res.status(403).json({ message: 'Not a partner account' });
    const subject = S(req.body.subject).slice(0, 200);
    const items = cleanItems(req.body.items);
    const message = S(req.body.message).slice(0, 5000);
    if (!subject) return res.status(400).json({ message: 'Write a subject' });
    if (!items.length && !message) return res.status(400).json({ message: 'Write at least one point' });
    const r = await CustomerRequest.create({
      account: req.user._id, accountEmail: S(req.user.email), accountName: nameOf(req.user),
      customerName: who.identity.name || '', partnerSource: who.partner.source || '', partnerRef: S(who.partner.refId),
      subject, items,
      messages: message ? [{ side: 'customer', by: req.user._id, byName: nameOf(req.user), text: message }] : [],
      status: 'open', unreadStaff: true, lastActivityAt: new Date(),
    });
    await notifySection('Operations', {
      title: `طلب جديد من العميل ${r.customerName || r.accountName} (#${r.number})`,
      message: subject, relatedEntity: 'CustomerRequest', relatedEntityId: r._id,
    }).catch(() => {});
    emit(req.user._id);
    res.status(201).json({ request: r });
  } catch (e) {
    console.error('customer request create', e);
    res.status(500).json({ message: 'Could not send the request' });
  }
};

// POST /api/portal/requests/:id/reply { text }
exports.myReply = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
    const r = await CustomerRequest.findOne({ _id: req.params.id, account: req.user._id });
    if (!r) return res.status(404).json({ message: 'Not found' });
    const text = S(req.body.text).slice(0, 5000);
    if (!text) return res.status(400).json({ message: 'Write your message' });
    r.messages.push({ side: 'customer', by: req.user._id, byName: nameOf(req.user), text });
    r.status = 'open';
    r.unreadStaff = true;
    r.lastActivityAt = new Date();
    await r.save();
    await notifySection('Operations', {
      title: `ردّ من العميل ${r.customerName || r.accountName} على الطلب #${r.number}`,
      message: text.slice(0, 140), relatedEntity: 'CustomerRequest', relatedEntityId: r._id,
    }).catch(() => {});
    emit(req.user._id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Could not send' }); }
};

// Operations side (customer communication)

// GET /api/customer-requests?status=&q=
exports.list = async (req, res) => {
  try {
    const f = {};
    if (['open', 'answered', 'closed'].includes(S(req.query.status))) f.status = S(req.query.status);
    const rows = await CustomerRequest.find(f).sort({ lastActivityAt: -1 }).limit(1000).lean();
    const all = await CustomerRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const unread = await CustomerRequest.countDocuments({ unreadStaff: true });
    res.json({ items: rows.map(summary), counts: Object.fromEntries(all.map((x) => [x._id, x.n])), unread });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الطلبات' }); }
};

// GET /api/customer-requests/:id
exports.one = async (req, res) => {
  try {
    const r = await CustomerRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (r.unreadStaff) { r.unreadStaff = false; await r.save(); emit(); }
    res.json({ request: r });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الطلب' }); }
};

const notifyCustomer = async (r, title, message) => {
  await createNotification({ recipient: r.account, type: 'system_alert', title, message, relatedEntity: 'CustomerRequest', relatedEntityId: r._id }).catch(() => {});
  emit(r.account);
};

// POST /api/customer-requests/:id/reply { text } — answered inside the portal.
exports.reply = async (req, res) => {
  try {
    const r = await CustomerRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    const text = S(req.body.text).slice(0, 5000);
    if (!text) return res.status(400).json({ message: 'اكتب الرد' });
    r.messages.push({ side: 'staff', by: req.user._id, byName: nameOf(req.user), text, via: 'system' });
    r.status = 'answered';
    r.unreadCustomer = true;
    r.unreadStaff = false;
    r.lastActivityAt = new Date();
    await r.save();
    await notifyCustomer(r, `Reply to your request #${r.number}`, text.slice(0, 140));
    logAudit({ user: req.user._id, action: 'customer_request_reply', entity: 'CustomerRequest', entityId: r._id, ipAddress: req.ip }).catch(() => {});
    res.json({ request: r });
  } catch (e) { res.status(500).json({ message: 'تعذّر حفظ الرد' }); }
};

// GET /api/customer-requests/mailboxes — company mailboxes that can send (password stored).
exports.mailboxes = async (req, res) => {
  try {
    const CompanyEmail = require('../models/CompanyEmail');
    const rows = await CompanyEmail.find({ passwordEnc: { $nin: [null, ''] } }).select('email displayName').sort({ email: 1 }).lean();
    // Replies to customers go out from operation@ unless configured otherwise (owner's choice).
    const preferred = (S(process.env.CUSTOMER_REQUESTS_MAILBOX) || 'operation@energize-logistics.com').toLowerCase();
    res.json({ mailboxes: rows.map((m) => ({ email: m.email, name: m.displayName || '' })), preferred });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل صناديق البريد' }); }
};

/**
 * POST /api/customer-requests/:id/email { from, to[], cc[], subject, text, lang }
 * Answers by email from a company mailbox; the customer's message is quoted
 * under the reply, and the reply is also kept in the request's thread.
 */
exports.email = async (req, res) => {
  try {
    const r = await CustomerRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    const from = S(req.body.from).toLowerCase();
    const to = emails(req.body.to);
    const cc = emails(req.body.cc);
    const subject = S(req.body.subject).slice(0, 250);
    const text = S(req.body.text).slice(0, 20000);
    const rtl = req.body.lang === 'ar';
    if (!from) return res.status(400).json({ message: 'اختر صندوق الإرسال' });
    if (!to.length) return res.status(400).json({ message: 'اكتب إيميل المستلم' });
    const bad = [...to, ...cc].filter((x) => !EMAIL_RX.test(x));
    if (bad.length) return res.status(400).json({ message: `إيميل غير صحيح: ${bad.join('، ')}` });
    if (!subject) return res.status(400).json({ message: 'اكتب الموضوع' });
    if (!text) return res.status(400).json({ message: 'اكتب الرسالة' });

    // The customer's request, quoted under the reply.
    const original = [
      `#${r.number} — ${r.subject}`,
      ...(r.items || []).map((it, i) => `${i + 1}. ${it.text}${it.ref ? ` [${it.refType === 'invoice' ? 'Invoice' : it.refType === 'shipment' ? 'Shipment' : it.refType === 'date' ? 'Date' : 'Ref'}: ${it.ref}]` : ''}`),
      ...(r.messages || []).filter((m) => m.side === 'customer').slice(-1).map((m) => m.text),
    ].join('\n');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div dir="${rtl ? 'rtl' : 'ltr'}" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8;color:#0f172a">${esc(text).replace(/\n/g, '<br>')}`
      + `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0"><div style="color:#64748b;font-size:12.5px" dir="auto">${esc(original).replace(/\n/g, '<br>')}</div></div>`;
    const plain = `${text}\n\n----\n${original}`;

    const { sendFromMailbox } = require('../utils/mailer');
    let sent;
    try {
      // Files attached to the reply on the screen.
      const attachments = require('../utils/emailAttachments').emailAttachments(req.body.attachments);
      sent = await sendFromMailbox(from, { fromName: 'Energize Logistics', to, cc, subject, text: plain, html, attachments });
    } catch (err) {
      return res.status(err.status || 502).json({ message: err.message || 'تعذّر إرسال البريد', code: err.code });
    }
    r.messages.push({
      side: 'staff', by: req.user._id, byName: nameOf(req.user), text, via: 'email',
      email: { from, to, cc, subject, messageId: S(sent && sent.messageId) },
    });
    r.status = 'answered';
    r.unreadCustomer = true;
    r.unreadStaff = false;
    r.lastActivityAt = new Date();
    await r.save();
    await notifyCustomer(r, `Reply to your request #${r.number}`, text.slice(0, 140));
    logAudit({
      user: req.user._id, action: 'customer_request_email', entity: 'CustomerRequest', entityId: r._id,
      changes: { details: `${from} → ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`, subject, savedToSent: sent && sent.savedToSent }, ipAddress: req.ip,
    }).catch(() => {});
    res.json({ request: r, savedToSent: !!(sent && sent.savedToSent) });
  } catch (e) {
    console.error('customer request email', e);
    res.status(500).json({ message: 'تعذّر إرسال البريد' });
  }
};

// PATCH /api/customer-requests/:id/status { status }
exports.setStatus = async (req, res) => {
  try {
    const status = S(req.body.status);
    if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ message: 'حالة غير معروفة' });
    const r = await CustomerRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    r.status = status;
    r.lastActivityAt = new Date();
    await r.save();
    if (status === 'closed') await notifyCustomer(r, `Request #${r.number} closed`, r.subject);
    else emit(r.account);
    res.json({ request: r });
  } catch (e) { res.status(500).json({ message: 'تعذّر الحفظ' }); }
};

// GET /api/customer-requests/unread-count — for the sidebar badge.
exports.unreadCount = async (req, res) => {
  try { res.json({ count: await CustomerRequest.countDocuments({ unreadStaff: true }) }); }
  catch (e) { res.json({ count: 0 }); }
};

