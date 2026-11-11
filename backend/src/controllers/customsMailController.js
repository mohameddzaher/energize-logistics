/**
 * Follow-up email to the customer from inside a clearance transaction, sent from the customs mailbox.
 * A daily status note: where the shipment stands, what is next, per container. Optionally about one container only.
 * The template is edited in customs settings and read from the database on every draft (no cache). It reuses the collections
 * template model under its own key, and utils/mailer for sending (SMTP, then a copy to the mailbox's Sent folder).
 * The mailbox password comes from the company emails register (IT), never from code.
 */
const CustomsClearance = require('../models/CustomsClearance');
const Template = require('../models/CollectionsEmailTemplate');
const { normalizeEmails } = require('../utils/partyEmails');
const { stageLabel } = require('../config/customsStages');
const logAudit = require('../utils/auditLogger');

const MAILBOX = process.env.CUSTOMS_MAILBOX || 'custom.clearance@energize-logistics.com';
const TEMPLATE_KEY = 'customs_followup';
const FROM_NAME = 'إنرجايز - التخليص الجمركي';

const PLACEHOLDERS = [
  ['{العميل}', 'اسم العميل'],
  ['{رقم_المعاملة}', 'الرقم المرجعي للمعاملة'],
  ['{البوليصة}', 'رقم بوليصة الشحن'],
  ['{رقم_البيان}', 'رقم البيان الجمركي'],
  ['{الميناء}', 'الميناء'],
  ['{عدد_الحاويات}', 'عدد الحاويات أو السيارات'],
  ['{المرحلة_الحالية}', 'آخر مرحلة أُنجزت'],
  ['{الخطوة_التالية}', 'المرحلة التالية'],
  ['{نسبة_الإنجاز}', 'نسبة الإنجاز'],
  ['{حالة_الحاويات}', 'سطر لكل حاوية بحالتها (أو الحاوية المختارة وحدها)'],
  ['{التاريخ}', 'تاريخ اليوم'],
];

const DEFAULT_TEMPLATE = {
  subject: 'متابعة شحنتكم — بوليصة {البوليصة} — {التاريخ}',
  body: [
    'السادة / {العميل} المحترمين،',
    '',
    'تحيّة طيّبة وبعد،',
    '',
    'نفيدكم بآخر مستجدّات معاملة التخليص الجمركي الخاصّة بشحنتكم:',
    '',
    'رقم المعاملة: {رقم_المعاملة}',
    'بوليصة الشحن: {البوليصة}',
    'الميناء: {الميناء}',
    'عدد الحاويات: {عدد_الحاويات}',
    '',
    'المرحلة الحالية: {المرحلة_الحالية}',
    'الخطوة التالية: {الخطوة_التالية}',
    'نسبة الإنجاز: {نسبة_الإنجاز}',
    '',
    'حالة الحاويات:',
    '{حالة_الحاويات}',
    '',
    'وسنوافيكم بأيّ مستجدّات أوّلًا بأوّل. وفي حال وجود أيّ استفسار يُرجى الردّ على هذه الرسالة.',
    '',
    'شاكرين لكم حسن تعاونكم،',
  ].join('\n'),
};

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const fail = (res, e, fallback) => {
  if (e && e.status && e.status < 500) return res.status(e.status).json({ message: e.message, code: e.code });
  console.error('[customs-mail]', e);
  return res.status(500).json({ message: fallback, error: e && e.message });
};
const nameOf = (u) => `${(u && u.firstName) || ''} ${(u && u.lastName) || ''}`.trim();
const fill = (text, vals) => String(text || '').replace(/\{([^{}]+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : all));
const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' });

async function loadTemplate() {
  const t = await Template.findOne({ key: TEMPLATE_KEY }).lean();
  return {
    subject: t ? t.subject : DEFAULT_TEMPLATE.subject, body: t ? t.body : DEFAULT_TEMPLATE.body,
    signature: t ? t.signature || '' : '', signatureImage: t ? t.signatureImage || '' : '', signatureImageName: t ? t.signatureImageName || '' : '',
    cc: t ? (t.cc || []) : [],
    updatedAt: t && t.updatedAt, updatedByName: t && t.updatedByName,
  };
}

/**
 * Customer addresses, filled automatically: the customer's customs file (every contact), then the same customer in the
 * other registers (its linked CRM company, the finance customer on the transaction, the CRM, collections and shipments
 * registers by folded name). The first register that has an email wins its place; all are merged without duplicates.
 */
async function customerEmails(c) {
  const fold = require('../models/CollectionsParty').fold;
  const key = fold(c.customerName || '');
  const out = [];
  const add = (...list) => { for (const e of list.flat()) if (e) out.push(e); };
  let crmId = null;
  if (c.customerParty) {
    const party = await require('../models/CustomsParty').findById(c.customerParty).select('email contacts crmCompany').lean();
    if (party) { add(party.email, (party.contacts || []).map((x) => x && x.email)); crmId = party.crmCompany; }
  }
  const CrmCompany = require('../models/CrmCompany');
  const [crm, cust, crmByName, coll, so] = await Promise.all([
    crmId ? CrmCompany.findById(crmId).select('email emails').lean() : null,
    c.customer ? require('../models/Customer').findById(c.customer).select('email').lean().catch(() => null) : null,
    key ? CrmCompany.findOne({ nameKey: key }).select('email emails').lean() : null,
    key ? require('../models/CollectionsParty').findOne({ kind: 'customer', $or: [{ nameKey: key }, { aliasKeys: key }] }).select('email emails').lean() : null,
    c.customerName ? require('../models/ShipmentOrderCustomer').findOne({ name: c.customerName }).select('email').lean() : null,
  ]);
  for (const r of [crm, cust, crmByName, coll, so]) if (r) add(r.emails || [], r.email);
  return normalizeEmails(out);
}

/** Last done and next step of a step list from `pipelineOf`. */
function where(steps, next, cargo) {
  const open = (steps || []).filter((s) => !s.locked);
  const last = [...open].reverse().find((s) => s.done);
  return {
    current: last ? stageLabel(last.key, cargo) : 'لم تبدأ بعد',
    next: next ? stageLabel(next, cargo) : 'اكتملت المراحل',
  };
}

/**
 * Values for the template. `unit` (index) narrows the container lines to one container.
 * Stages come from `pipelineOf`, the one rule for progress, never recomputed here.
 */
async function buildValues(c, unit) {
  const { pipelineOf } = CustomsClearance;
  const p = pipelineOf(c);
  const cargo = p.cargoType || 'containers';
  const head = where(p.steps, p.next, cargo);
  const containers = c.containers || [];
  const views = p.units && p.units.length ? p.units : [];
  const lineOf = (v) => {
    const num = (containers[v.index] && containers[v.index].containerNumber) || `#${v.index + 1}`;
    const w = where(v.steps, v.next, cargo);
    return `- ${num}: ${w.current} — التالي: ${w.next} (${v.percent}%)`;
  };
  let lines;
  let focus = null;
  if (unit !== null && unit !== undefined && unit !== '' && views[Number(unit)]) {
    focus = views[Number(unit)];
    lines = lineOf(focus);
  } else {
    lines = views.length ? views.map(lineOf).join('\n') : '—';
  }
  const fw = focus ? where(focus.steps, focus.next, cargo) : head;
  return {
    vals: {
      'العميل': c.customerName || 'العميل',
      'رقم_المعاملة': c.refNumber || '',
      'البوليصة': c.blNumber || c.billOfLading || '',
      'رقم_البيان': c.declarationNumber || '',
      'الميناء': c.port || '',
      'عدد_الحاويات': String(c.containerCount || containers.length || 0),
      'المرحلة_الحالية': fw.current,
      'الخطوة_التالية': fw.next,
      'نسبة_الإنجاز': `${focus ? focus.percent : p.percent}%`,
      'حالة_الحاويات': lines,
      'التاريخ': today(),
    },
    units: views.map((v) => ({ index: v.index, number: (containers[v.index] && containers[v.index].containerNumber) || `#${v.index + 1}` })),
  };
}

const unitOf = (raw) => (raw === undefined || raw === null || raw === '' || raw === 'all' ? null : Number(raw));

// GET /api/customs-clearance/email-template
exports.getTemplate = async (req, res) => {
  try {
    const tpl = await loadTemplate();
    res.json({ ...tpl, placeholders: PLACEHOLDERS, mailbox: MAILBOX, defaults: DEFAULT_TEMPLATE, signatureDept: 'customs' });
  }
  catch (e) { fail(res, e, 'تعذّر تحميل القالب'); }
};

// POST /api/customs-clearance/email-signature-preview { signature, signatureImage } — the closing block as it will be sent, for the settings editor while typing.
exports.signaturePreview = async (req, res) => {
  try {
    const img = String(req.body.signatureImage || '');
    res.json({ html: require('../utils/emailSignature').signaturePreviewHtml('customs', String(req.body.signature || '').slice(0, 2000), /^data:image\//i.test(img) && img.length < 420000 ? img : '') });
  } catch (e) { fail(res, e, 'تعذّر عرض التوقيع'); }
};

// PUT /api/customs-clearance/email-template
exports.saveTemplate = async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    if (!subject || !body.trim()) throw bad('اكتب الموضوع ونصّ الرسالة');
    const signature = String(req.body.signature || '').slice(0, 2000);
    const signatureImage = String(req.body.signatureImage || '');
    if (signatureImage && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(signatureImage)) throw bad('صورة التوقيع: PNG أو JPG فقط');
    if (signatureImage.length > 420000) throw bad('صورة التوقيع أكبر من 300 ك.ب — صغّرها');
    const doc = await Template.findOneAndUpdate({ key: TEMPLATE_KEY },
      { $set: { subject, body, signature, signatureImage, signatureImageName: String(req.body.signatureImageName || '').slice(0, 120), cc: normalizeEmails(req.body.cc), updatedBy: req.user._id, updatedByName: nameOf(req.user) } },
      { upsert: true, new: true }).lean();
    try { require('../websocket/socketManager').emitToAll('customs:email-template', { source: 'email-template' }); } catch (_) { /* */ }
    logAudit({ user: req.user, action: 'update', entity: 'CustomsEmailTemplate', entityId: doc._id, changes: { after: { subject } }, ipAddress: req.ip }).catch(() => {});
    res.json({ subject: doc.subject, body: doc.body, signature: doc.signature, signatureImage: doc.signatureImage, signatureImageName: doc.signatureImageName, cc: doc.cc || [], updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
  } catch (e) { fail(res, e, 'تعذّر حفظ القالب'); }
};

// GET /api/customs-clearance/:id/email-draft?unit=<index>
exports.draft = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const { vals, units } = await buildValues(c, unitOf(req.query.unit));
    const tpl = await loadTemplate();
    res.json({
      mailbox: MAILBOX, customerName: c.customerName || '', to: await customerEmails(c), cc: tpl.cc || [], units,
      companySignature: require('../utils/emailSignature').signatureText('customs'),
      // Exactly what closes the email, with the logo and the animated truck, for the dialog to show.
      signaturePreview: require('../utils/emailSignature').signaturePreviewHtml('customs', tpl.signature, tpl.signatureImage),
      subject: fill(tpl.subject, vals), body: fill(tpl.body, vals),
      signature: tpl.signature, signatureImage: tpl.signatureImage,
      sent: (c.emailLog || []).slice(-5).reverse(),
    });
  } catch (e) { fail(res, e, 'تعذّر إعداد الرسالة'); }
};

// POST /api/customs-clearance/:id/email  { to[], cc[], subject, body, unit }
exports.send = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id);
    if (!c) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const to = normalizeEmails(req.body.to);
    const cc = normalizeEmails(req.body.cc).filter((e) => !to.includes(e));
    if (!to.length) throw bad('أضف بريدًا صحيحًا واحدًا على الأقلّ في «إلى»');
    const subject = String(req.body.subject || '').trim();
    const text = String(req.body.body || '').trim();
    if (!subject || !text) throw bad('الموضوع والنصّ مطلوبان');

    const tpl = await loadTemplate();
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attachments = [];
    // The department's company signature (utils/emailSignature) closes every message; the settings' own text and image sit above it.
    const { signatureHtml, signatureText, signatureAttachments } = require('../utils/emailSignature');
    const sig = String(tpl.signature || '').trim();
    const sigImg = /^data:image\/([a-z+]+);base64,(.+)$/i.exec(tpl.signatureImage || '');
    if (sigImg) attachments.push({ filename: tpl.signatureImageName || `signature.${sigImg[1] === 'jpeg' ? 'jpg' : sigImg[1]}`, content: Buffer.from(sigImg[2], 'base64'), cid: 'sig@energize', contentDisposition: 'inline' });
    attachments.push(...signatureAttachments());
    const sigHtml = `${sigImg ? '<div style="margin-top:14px"><img src="cid:sig@energize" alt="" style="max-width:320px;max-height:140px"></div>' : ''}${signatureHtml('customs', sig)}`;
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8;color:#0f172a">${esc(text).replace(/\n/g, '<br>')}${sigHtml}</div>`;

    const { sendFromMailbox } = require('../utils/mailer');
    const sent = await sendFromMailbox(MAILBOX, { fromName: FROM_NAME, to, cc, subject, text: `${text}\n\n--\n${signatureText('customs', sig)}`, html, attachments });

    const unit = unitOf(req.body.unit);
    const unitNo = unit !== null && c.containers && c.containers[unit] ? (c.containers[unit].containerNumber || `#${unit + 1}`) : '';
    const entry = { at: new Date(), by: req.user._id, byName: nameOf(req.user), to, cc, subject, unit: unitNo };
    c.emailLog.push(entry);
    // Also in the transaction notes, so the team sees the follow-up where it reads the file's history.
    c.notesLog.push({ text: `أُرسل بريد متابعة للعميل إلى ${to.join('، ')}${unitNo ? ` — بخصوص الحاوية ${unitNo}` : ''}`, by: req.user._id, byName: nameOf(req.user), at: new Date() });
    await c.save();
    logAudit({
      user: req.user, action: 'send_customs_followup_email', entity: 'CustomsClearance', entityId: c._id,
      changes: { details: `${c.refNumber || ''} → ${to.join(', ')}`, to, cc, subject, unit: unitNo, savedToSent: sent.savedToSent }, ipAddress: req.ip,
    }).catch(() => {});
    try { require('../utils/ttlCache').clear('customs:'); } catch (_) { /* */ }
    try { require('../websocket/socketManager').emitToAll('customs:updated', { id: String(c._id) }); } catch (_) { /* */ }
    res.json({ ok: true, to, cc, savedToSent: sent.savedToSent, messageId: sent.messageId, entry });
  } catch (e) { fail(res, e, 'تعذّر إرسال الرسالة'); }
};

exports._DEFAULT_TEMPLATE = DEFAULT_TEMPLATE;
exports._buildValues = buildValues;
