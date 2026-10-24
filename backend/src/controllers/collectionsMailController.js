/**
 * إرسالُ كشف الحساب إلى العميل بالبريد — من صندوق التحصيل (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * في صفحتي الفواتير (الكاش والضريبيّة) يُفلتِر الموظّفُ ما يشاء — عميلًا، فاتورةً،
 * حالةً، فترة — ثمّ «إرسال للعميل»: تُفتَح مسودّةٌ فيها بريدُ العميل (كلُّ عناوينه
 * من ملفّه)، والموضوعُ والنصُّ من قالب القسم بخاناته ممتلئة، وكشفُ الحساب PDF
 * نفسُه الذي يُطبَع من الصفحة (services/invoiceStatement) ومعه Excel إن شاء.
 * يراجع ويعدّل ثمّ يرسل، فتخرج الرسالةُ من collections@ وتُنسَخ في «المرسل»،
 * وتُقيَّد متابعةً في ملفّ العميل.
 *
 * القالبُ يُقرأ من القاعدة في كلّ مسودّة — ما عُدِّل في الإعدادات يصل فورًا.
 */
const XLSX = require('xlsx');
const CollectionsParty = require('../models/CollectionsParty');
const Template = require('../models/CollectionsEmailTemplate');
const { emailsOf, normalizeEmails } = require('../utils/partyEmails');
const logAudit = require('../utils/auditLogger');

const MAILBOX = process.env.COLLECTIONS_MAILBOX || 'collections@energize-logistics.com';

/** الخاناتُ التي تُملأ في القالب — تُعرض في الإعدادات كما هي. */
const PLACEHOLDERS = [
  ['{العميل}', 'اسم العميل'],
  ['{رقم_الحساب}', 'كود العميل'],
  ['{النوع}', 'فواتير كاش / فواتير ضريبية'],
  ['{التاريخ}', 'تاريخ الكشف'],
  ['{عدد_الفواتير}', 'عدد الفواتير غير المسدّدة'],
  ['{المبلغ_المستحق}', 'إجمالي المستحق'],
  ['{أقدم_فاتورة_بالأيام}', 'عمر أقدم فاتورة مستحقّة'],
];

const DEFAULT_TEMPLATE = {
  subject: 'كشف حساب {النوع} — {العميل} — {التاريخ}',
  body: [
    'السادة / {العميل} المحترمين،',
    '',
    'تحيّة طيّبة وبعد،',
    '',
    'نرفق لكم كشف حساب {النوع} حتى تاريخ {التاريخ}، ويتضمّن {عدد_الفواتير} فاتورة غير مسدّدة بإجمالي {المبلغ_المستحق} ريال، أقدمُها مستحقّة منذ {أقدم_فاتورة_بالأيام} يومًا.',
    '',
    'نأمل التكرّم بمراجعة الكشف المرفق وسداد المستحقّات في أقرب وقت. وفي حال وجود أيّ ملاحظة يُرجى الردّ على هذه الرسالة أو التواصل مع إدارة التحصيل على الرقم 920031911.',
    '',
    'شاكرين لكم حسن تعاونكم،',
    'إدارة التحصيل',
    'إنرجايز للخدمات اللوجستية',
  ].join('\n'),
};

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const fail = (res, e, fallback) => {
  if (e && e.status && e.status < 500) return res.status(e.status).json({ message: e.message, code: e.code });
  console.error('[collections-mail]', e);
  return res.status(500).json({ message: fallback, error: e && e.message });
};
const nameOf = (u) => `${(u && u.firstName) || ''} ${(u && u.lastName) || ''}`.trim();
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadTemplate() {
  const t = await Template.findOne({ key: 'statement' }).lean();
  return { subject: t ? t.subject : DEFAULT_TEMPLATE.subject, body: t ? t.body : DEFAULT_TEMPLATE.body, updatedAt: t && t.updatedAt, updatedByName: t && t.updatedByName };
}

const fill = (text, vals) => String(text || '').replace(/\{([^{}]+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : all));

/** طرفُ الكشف من اسمه كما في الصفوف — بالاسم المطويّ أو صيغه البديلة. */
async function partyByName(name) {
  if (!name) return null;
  const key = CollectionsParty.fold(name);
  return CollectionsParty.findOne({ kind: 'customer', $or: [{ nameKey: key }, { aliasKeys: key }] })
    .select('name code email emails').lean();
}

/** الكشفُ وما يُملأ به القالب — يقرؤه المسودّةُ والإرسالُ معًا. */
async function buildDraft(kind, query, user, lang) {
  const { buildInvoiceStatement } = require('../services/invoiceStatement');
  const built = await buildInvoiceStatement(kind, query || {}, user, lang);
  const m = built.mail || {};
  const party = await partyByName(m.partyName);
  const vals = {
    'العميل': m.partyName || 'العميل',
    'رقم_الحساب': (party && party.code) || (m.codes && m.codes[0]) || '',
    'النوع': kind === 'cash' ? 'الفواتير الكاش' : 'الفواتير الضريبية',
    'التاريخ': m.today || '',
    'عدد_الفواتير': String(m.openCount || 0),
    'المبلغ_المستحق': money(m.openValue),
    'أقدم_فاتورة_بالأيام': String(m.oldestDays || 0),
  };
  return { built, party, vals };
}

const kindOf = (req) => (req.params.kind === 'cash' ? 'cash' : req.params.kind === 'tax' ? 'tax' : null);

// GET /api/collections-dept/email-template
exports.getTemplate = async (req, res) => {
  try { res.json({ ...(await loadTemplate()), placeholders: PLACEHOLDERS, mailbox: MAILBOX, defaults: DEFAULT_TEMPLATE }); }
  catch (e) { fail(res, e, 'تعذّر تحميل القالب'); }
};

// PUT /api/collections-dept/email-template
exports.saveTemplate = async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    if (!subject || !body.trim()) throw bad('اكتب الموضوع ونصّ الرسالة');
    const doc = await Template.findOneAndUpdate({ key: 'statement' },
      { $set: { subject, body, updatedBy: req.user._id, updatedByName: nameOf(req.user) } },
      { upsert: true, new: true }).lean();
    logAudit({ user: req.user, action: 'update', entity: 'CollectionsEmailTemplate', entityId: doc._id, changes: { after: { subject } }, ipAddress: req.ip }).catch(() => {});
    try { require('../websocket/socketManager').emitToAll('collections:changed', { source: 'email-template' }); } catch (_) { /* */ }
    res.json({ subject: doc.subject, body: doc.body, updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
  } catch (e) { fail(res, e, 'تعذّر حفظ القالب'); }
};

// GET /api/collections-dept/invoices/:kind/send-draft?<فلاتر الصفحة>
exports.draft = async (req, res) => {
  try {
    const kind = kindOf(req); if (!kind) return res.status(404).json({ message: 'Unknown invoice kind' });
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const { built, party, vals } = await buildDraft(kind, req.query, req.user, lang);
    const tpl = await loadTemplate();
    const m = built.mail || {};
    res.json({
      mailbox: MAILBOX,
      partyName: m.partyName || '', partyId: party ? party._id : null, partyCode: vals['رقم_الحساب'],
      to: party ? emailsOf(party) : [],
      subject: fill(tpl.subject, vals), body: fill(tpl.body, vals),
      rows: built.check.rows, openCount: m.openCount || 0, openValue: m.openValue || 0,
      multipleCustomers: !m.partyName && built.check.rows > 0,
    });
  } catch (e) { fail(res, e, 'تعذّر إعداد الرسالة'); }
};

// POST /api/collections-dept/invoices/:kind/send  { query, to[], cc[], subject, body, attachExcel, lang }
exports.send = async (req, res) => {
  try {
    const kind = kindOf(req); if (!kind) return res.status(404).json({ message: 'Unknown invoice kind' });
    const lang = req.body.lang === 'en' ? 'en' : 'ar';
    const to = normalizeEmails(req.body.to);
    const cc = normalizeEmails(req.body.cc).filter((e) => !to.includes(e));
    if (!to.length) throw bad('أضف بريدًا صحيحًا واحدًا على الأقلّ في «إلى»');
    const subject = String(req.body.subject || '').trim();
    const text = String(req.body.body || '').trim();
    if (!subject || !text) throw bad('الموضوع والنصّ مطلوبان');

    const { built, party } = await buildDraft(kind, req.body.query || {}, req.user, lang);
    const m = built.mail || {};
    const { renderReportPdf } = require('../services/reportBuilder');
    const pdf = await renderReportPdf(built.doc);
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = (s) => String(s || 'statement').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
    const base = `${kind === 'cash' ? 'كشف حساب - فواتير كاش' : 'كشف حساب - فواتير ضريبية'} - ${safe(m.partyName || 'العميل')} - ${stamp}`;
    const attachments = [{ filename: `${base}.pdf`, content: pdf, contentType: 'application/pdf' }];
    if (req.body.attachExcel && m.sheet) {
      const ws = XLSX.utils.aoa_to_sheet([m.sheet.head, ...m.sheet.rows]);
      if (lang === 'ar') ws['!rtl'] = true;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الفواتير');
      if (lang === 'ar') wb.Workbook = { Views: [{ RTL: true }] };
      attachments.push({ filename: `${base}.xlsx`, content: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) });
    }
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8;color:#0f172a">${esc(text).replace(/\n/g, '<br>')}</div>`;

    const { sendFromMailbox } = require('../utils/mailer');
    const sent = await sendFromMailbox(MAILBOX, { fromName: 'إنرجايز - إدارة التحصيل', to, cc, subject, text, html, attachments });

    // ── ويُقيَّد في ملفّ العميل: مَن أرسل، ومتى، وإلى مَن، وبأيّ مبلغ ──────────
    const note = `أُرسل كشف حساب (${kind === 'cash' ? 'فواتير كاش' : 'فواتير ضريبية'}) بالبريد إلى ${to.join('، ')}${cc.length ? ` — نسخة: ${cc.join('، ')}` : ''} · ${m.openCount || 0} فاتورة غير مسدّدة بـ ${money(m.openValue)} ريال`;
    if (party) {
      await require('../models/CollectionsFollowUp').create({
        party: party._id, collector: req.user._id, type: 'email', status: 'done', notes: note,
      }).catch((e) => console.error('[collections-mail] follow-up log:', e.message));
    }
    logAudit({
      user: req.user, action: 'send_statement_email', entity: 'CollectionsParty', entityId: party ? party._id : undefined,
      changes: { details: note, to, cc, subject, rows: built.check.rows, savedToSent: sent.savedToSent }, ipAddress: req.ip,
    }).catch(() => {});
    try { require('../websocket/socketManager').emitToAll('collections:changed', { source: 'email', party: party ? String(party._id) : null }); } catch (_) { /* */ }
    res.json({ ok: true, to, cc, savedToSent: sent.savedToSent, messageId: sent.messageId, partyLogged: !!party });
  } catch (e) { fail(res, e, 'تعذّر إرسال الرسالة'); }
};

exports._DEFAULT_TEMPLATE = DEFAULT_TEMPLATE;
exports._fill = fill;
