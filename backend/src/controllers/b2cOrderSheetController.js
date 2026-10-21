/**
 * شيتاتُ الأوردرات — ربطُ ملفّ جوجل شيت لكلّ مشروع (services/b2cOrderSheetSync).
 *
 *   GET    /api/b2c/order-sheets              الملفّاتُ المربوطة وحالُ آخر قراءة
 *   POST   /api/b2c/order-sheets              { projectAr, url }
 *   DELETE /api/b2c/order-sheets/:id
 *   POST   /api/b2c/order-sheets/:id/sync     قراءةٌ الآن
 *
 * للمسؤولين عن القسم وحدَهم (isEntryHead) — الربطُ يكتب في أوردرات المشروع كلِّه.
 */
const mongoose = require('mongoose');
const E = require('../utils/b2cEntry');
const { B2COrderSheet } = require('../models/B2COrderSheet');
const sync = require('../services/b2cOrderSheetSync');
const logAudit = require('../utils/auditLogger');

const guard = (req, res) => {
  if (E.isEntryHead(req.user)) return false;
  res.status(403).json({ message: 'ربطُ الشيتات لمدير القسم ونائبه' });
  return true;
};

exports.list = async (req, res) => {
  if (guard(req, res)) return;
  const sheets = await B2COrderSheet.find().sort({ projectAr: 1 }).lean();
  const P = await E.projects();
  res.json({
    sheets,
    projects: P.rows.map((p) => p.nameAr),
    // مشاريعُ الشيتات (لها هدفُ أوردرات) — لـ«ترتيب المناديب».
    sheetProjects: P.rows.filter((p) => p.monthlyTarget).map((p) => p.nameAr),
    headEmails: (await sheetsApp().headEmails()).emails,
  });
};

const sheetsApp = () => require('./b2cSheetAppController');

/**
 * ترتيبُ المناديب في شيت المشروع (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) — يسري على كلّ شهور
 * الشيت وعلى «مدخلات الأوردرات». ويُغيَّر أيضًا بسحب الصفوف في الشيت نفسه.
 *   GET /api/b2c/order-sheets/order?project=&month=YYYY-MM   مناديبُ الشهر بالترتيب الحاليّ
 *   PUT /api/b2c/order-sheets/order   { project, lts: [ltId] }
 */
exports.getOrder = async (req, res) => {
  try {
    if (guard(req, res)) return;
    const A = sheetsApp();
    const project = await A.projectOf(req.query.project);
    if (!project || !project.monthlyTarget) return res.status(404).json({ message: 'المشروع غير موجود' });
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : A.today().slice(0, 7);
    const lay = await A._buildLayout(project, [month]);
    const rows = (lay.months[month]?.rows || []).filter((r) => r.lt)
      .map((r) => ({ lt: r.lt, id: r.id, name: r.name, sup: r.sup }));
    const ord = await A.orderOf(project._id);
    let by = '';
    if (ord?.updatedBy) {
      const u = await require('../models/User').findById(ord.updatedBy).select('name firstName lastName').lean();
      by = String(u?.name || `${u?.firstName || ''} ${u?.lastName || ''}`).trim();
    }
    res.json({ project: project.nameAr, month, rows, saved: !!ord?.order?.length, updatedAt: ord?.updatedAt || null, updatedBy: by, source: ord?.source || '' });
  } catch (e) {
    console.error('b2c order-sheets getOrder', e);
    res.status(500).json({ message: 'تعذّر تحميل الترتيب' });
  }
};

exports.saveOrder = async (req, res) => {
  try {
    if (guard(req, res)) return;
    const A = sheetsApp();
    const project = await A.projectOf(req.body.project);
    if (!project) return res.status(404).json({ message: 'المشروع غير موجود' });
    const lts = (Array.isArray(req.body.lts) ? req.body.lts : []).map(String).filter((x) => mongoose.isValidObjectId(x));
    if (!lts.length) return res.status(400).json({ message: 'لا مناديب في الترتيب' });
    const order = await A.saveOrder(project, lts, { user: req.user._id, source: 'system' });
    await logAudit({ user: req.user._id, action: 'b2c_sheet_order', entity: 'B2CProject', entityId: project._id,
      changes: { details: `ترتيب المناديب في شيت «${project.nameAr}» (${lts.length} مندوبًا)` }, ipAddress: req.ip }).catch(() => {});
    res.json({ ok: true, size: order.length });
  } catch (e) {
    console.error('b2c order-sheets saveOrder', e);
    res.status(500).json({ message: 'تعذّر حفظ الترتيب' });
  }
};

/** بريدُ جوجل لمسؤولي القسم — محرّرو الحماية في الشيتات الثلاثة. */
exports.setHeads = async (req, res) => {
  try {
    if (guard(req, res)) return;
    const emails = await sheetsApp().setHeadEmails(req.body.emails);
    await logAudit({ user: req.user._id, action: 'b2c_sheet_heads', entity: 'B2CSheetsKey', entityId: null,
      changes: { details: `بريد مسؤولي القسم في الشيتات: ${emails.join('، ') || '—'}` }, ipAddress: req.ip }).catch(() => {});
    try { require('../websocket/socketManager').emitToAll('b2c:sheet-order', { heads: true }); } catch (_) { /* */ }
    res.json({ ok: true, emails });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.status ? e.message : 'تعذّر حفظ البريد' });
  }
};

exports.create = async (req, res) => {
  try {
    if (guard(req, res)) return;
    const sheetId = sync.sheetIdOf(req.body.url);
    if (!sheetId) return res.status(400).json({ message: 'الصق رابط ملفّ جوجل شيت' });
    const proj = (await E.projects()).of(req.body.projectAr);
    if (!proj) return res.status(400).json({ message: 'اختر المشروع' });
    const doc = await B2COrderSheet.findOneAndUpdate(
      { sheetId },
      { $set: { projectAr: proj.nameAr, url: String(req.body.url).trim(), enabled: true, lastError: '' }, $setOnInsert: { createdBy: req.user._id } },
      { upsert: true, new: true },
    );
    await logAudit({ user: req.user._id, action: 'b2c_order_sheet_link', entity: 'B2COrderSheet', entityId: doc._id, changes: { after: { projectAr: proj.nameAr, sheetId } }, ipAddress: req.ip }).catch(() => {});
    // قراءةٌ أولى فورًا — فيُعرف في الحال إن كان الرابطُ مشارَكًا.
    try { await sync.syncSheet(doc); } catch (e) { doc.lastError = String(e.message).slice(0, 300); doc.lastSyncAt = new Date(); await doc.save(); }
    res.status(201).json({ sheet: await B2COrderSheet.findById(doc._id).lean() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر ربط الشيت', error: e.message });
  }
};

exports.remove = async (req, res) => {
  if (guard(req, res)) return;
  const doc = await B2COrderSheet.findByIdAndDelete(req.params.id);
  if (!doc) return res.status(404).json({ message: 'غير موجود' });
  await require('../models/B2COrderSheet').B2COrderSheetCell.deleteMany({ sheet: doc._id });
  res.json({ ok: true });
};

exports.syncNow = async (req, res) => {
  if (guard(req, res)) return;
  const doc = await B2COrderSheet.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'غير موجود' });
  try {
    const n = await sync.syncSheet(doc);
    if (n) {
      require('../utils/ttlCache').clear('b2c:');
      try { require('../websocket/socketManager').emitToAll('b2c:order:upserted', { bulk: true, source: 'sheet', count: n }); } catch (_) { /* */ }
    }
    res.json({ changed: n, sheet: await B2COrderSheet.findById(doc._id).lean() });
  } catch (e) {
    doc.lastError = String(e.message).slice(0, 300); doc.lastSyncAt = new Date(); await doc.save();
    res.status(400).json({ message: doc.lastError });
  }
};

/**
 * GET /api/b2c/order-sheets/script — سكربتُ جوجل جاهزًا بمفتاحه.
 * يُلصَق في script.google.com ويُشغَّل `setup` مرّةً. لمدير القسم ونائبه وحدَهم.
 */
exports.script = async (req, res) => {
  if (guard(req, res)) return;
  const fs = require('fs');
  const path = require('path');
  const token = await require('../models/B2COrderSheet').sheetsToken();
  const code = fs.readFileSync(path.join(__dirname, '../templates/b2cOrderSheets.gs'), 'utf8').replace('__TOKEN__', token);
  res.set('Content-Disposition', 'attachment; filename="energize-b2c-sheets.gs"').type('text/plain; charset=utf-8').send(code);
};
