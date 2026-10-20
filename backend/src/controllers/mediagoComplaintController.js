/**
 * شكاوى Media Go — بلاغاتُ أعطال الشاشات على دبّاباتنا.
 *
 *   GET    /api/b2c/mediago-complaints               القائمة + العدّادات + المفردات + ما يملكه القارئ
 *   GET    /api/b2c/mediago-complaints/meta          المفرداتُ وحدها (للنموذج في التطبيق)
 *   GET    /api/b2c/mediago-complaints/motorcycles   دبّاباتُ النقل الخفيف من سجلّ المركبات (?q=)
 *   GET    /api/b2c/mediago-complaints/:id           البلاغُ كاملًا (المرفقات والسجلّ والردود)
 *   POST   /api/b2c/mediago-complaints               رفعُ بلاغ (قسمُ الأفراد)
 *   POST   /api/b2c/mediago-complaints/:id/files     إرفاقُ صورٍ أو مقاطعَ لاحقًا (قسمُ الأفراد)
 *   PATCH  /api/b2c/mediago-complaints/:id/status    تغييرُ الحالة (الطرفان — بحدود)
 *   POST   /api/b2c/mediago-complaints/:id/replies   ردٌّ في المحادثة (الطرفان)
 *   DELETE /api/b2c/mediago-complaints/:id           حذف (مدير القطاع ونائبه ومدير النظام)
 *
 * ── الطرفان ─────────────────────────────────────────────────────────────────
 * نحن نرفع البلاغ ونغلقه. وMedia Go (`mediago_account`) تقرأ كلَّ البلاغات،
 * وتقول «قيد المعالجة» ثمّ «تمّ الإصلاح»، وتردّ. ولا تُنشئ ولا تحذف ولا تعدّل
 * حقلًا من البلاغ — ولا تغيّر حالةَ بلاغٍ أُغلق. ويصل كلَّ طرفٍ إشعارٌ بما فعله
 * الآخر، ويتحدّث الطرفان حيًّا (`mediago:complaint`).
 *
 * ── حدُّ المرفقات ───────────────────────────────────────────────────────────
 * الخادمُ يقبل جسمَ طلبٍ حتى ٢٥ ميغا (server.js)، والملفُّ يُرسَل base64 فيكبر
 * الثلث. فالمرفقاتُ في الطلب الواحد لا تتجاوز ١٨ ميغا معًا: الصورةُ حتى ٨ والمقطعُ
 * حتى ١٥ — مقطعٌ قصيرٌ من الهاتف (عشرون ثانيةً تقريبًا). ومن احتاج أكثر أرفق
 * بعد الحفظ من تفصيل البلاغ (حتى خمسة ملفّاتٍ للبلاغ كلِّه).
 */
const mongoose = require('mongoose');
const MediaGoComplaint = require('../models/MediaGoComplaint');
const { MEDIAGO_VOCAB } = MediaGoComplaint;
const User = require('../models/User');
const { VehicleMaster } = require('../models/VehicleMaster');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { MEDIAGO_ROLE, isScopedRole } = require('../config/scopedRoles');
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v == null ? '' : v).trim();
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '';
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => S(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

const MAX_FILES = 5;
const MB = 1024 * 1024;
const LIMITS = { image: 8 * MB, video: 15 * MB, request: 18 * MB };

/** مَن يرفع البلاغ: رؤوسُ القسم ومديرو مشاريعه ومشرفوه — ومن مُنح القسمَ «تعديلًا». */
const CREATE_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];
/** والحذفُ فعلٌ لا يُستعاد: لمدير القطاع ونائبه ومدير النظام وحدَهم. */
const DELETE_ROLES = ['super_admin', 'b2c_manager', 'b2c_deputy'];
/** ما تقوله Media Go عن البلاغ — لا تفتحه من جديد ولا تغلقه. */
const PARTNER_STATUSES = ['in_progress', 'fixed'];

const isPartner = (user) => user?.role === MEDIAGO_ROLE || isScopedRole(user?.role);
const sideOf = (user) => (isPartner(user) ? 'mediago' : 'energize');
const canCreate = (req) => !isPartner(req.user)
  && (CREATE_ROLES.includes(req.user?.role) || req.sectionAccess === 'edit');

const label = (group, key, lang = 'ar') => {
  const x = (MEDIAGO_VOCAB[group] || []).find((v) => v.key === key);
  return x ? x[lang] : key || '';
};

/** ما يملكه القارئ — تقرؤه الشاشتان فلا تعرضان زرًّا يردّه الخادم. */
const abilities = (req) => {
  const partner = isPartner(req.user);
  return {
    partner,
    create: canCreate(req),
    delete: DELETE_ROLES.includes(req.user?.role),
    reply: true,
    statuses: partner ? PARTNER_STATUSES : MEDIAGO_VOCAB.status.map((s) => s.key),
  };
};

const kindOf = (mime) => (String(mime || '').startsWith('video/') ? 'video' : 'image');

/**
 * يحفظ مرفقاتِ الطلب ويعيد ما يُكتب على البلاغ. يرفض قبل أن يكتب شيئًا: نوعٌ
 * غيرُ صورةٍ أو مقطع، أو ملفٌّ فوق حدّه، أو مجموعٌ فوق حدّ الطلب.
 */
function saveFiles(list, already, user) {
  const files = Array.isArray(list) ? list.filter((f) => f && f.dataUrl) : [];
  if (!files.length) return [];
  if (already + files.length > MAX_FILES) {
    const e = new Error(`الحدّ ${MAX_FILES} ملفّات للبلاغ / At most ${MAX_FILES} files per complaint`); e.status = 400; throw e;
  }
  let total = 0;
  const parsed = files.map((f) => {
    const m = /^data:([^;]+);base64,/.exec(f.dataUrl);
    const mime = m ? m[1].toLowerCase() : '';
    if (!/^(image|video)\//.test(mime)) {
      const e = new Error('المرفقات صور أو مقاطع فيديو فقط / Images or videos only'); e.status = 400; throw e;
    }
    const bytes = Math.floor((f.dataUrl.length - f.dataUrl.indexOf(',') - 1) * 3 / 4);
    const kind = kindOf(mime);
    if (bytes > LIMITS[kind]) {
      const e = new Error(kind === 'video'
        ? 'المقطع أكبر من 15 ميغا / Video larger than 15 MB'
        : 'الصورة أكبر من 8 ميغا / Image larger than 8 MB');
      e.status = 400; throw e;
    }
    total += bytes;
    return { f, kind };
  });
  if (total > LIMITS.request) {
    const e = new Error('مجموع المرفقات أكبر من 18 ميغا — أرفق الباقي بعد الحفظ / Attachments exceed 18 MB in one go — add the rest after saving');
    e.status = 400; throw e;
  }
  const saved = [];
  try {
    for (const { f, kind } of parsed) {
      const meta = saveUploadFile(f.dataUrl, 'mediago', S(f.fileName || f.title).slice(0, 200), { allowVideo: true, maxBytes: LIMITS[kind] });
      saved.push({ ...meta, kind, uploadedBy: user?._id || null, uploadedAt: new Date() });
    }
  } catch (err) {
    saved.forEach((x) => deleteStoredFile(x.fileUrl));
    const e = new Error(err.message || 'تعذّر حفظ الملف'); e.status = 400; throw e;
  }
  return saved;
}

// ── الإشعارُ والبثّ ─────────────────────────────────────────────────────────
const announce = (id, action) => {
  try {
    const { emitToAll, emitToRole } = require('../websocket/socketManager');
    const payload = { id: String(id), action, at: Date.now() };
    emitToAll('mediago:complaint', payload);
    emitToRole(MEDIAGO_ROLE, 'mediago:complaint', payload);
  } catch (_) { /* البثُّ تحسينٌ لا شرط */ }
};

/** إلى حسابات Media Go كلِّها (عادةً حسابٌ واحد). */
async function notifyPartner({ type, title, message, id }) {
  try {
    const { createNotification } = require('../services/notificationService');
    const users = await User.find({ role: MEDIAGO_ROLE, isActive: true }).select('_id').lean();
    await Promise.all(users.map((u) => createNotification({
      recipient: u._id, type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: id,
    }).catch(() => null)));
  } catch (_) { /* الإشعارُ لا يُفشل الفعل */ }
}

/**
 * إلى جهتنا: إشعارُ القسم (يراه مديرُه) ورافعُ البلاغ باسمه إن لم يكن ممّن يرونه.
 */
async function notifyOurSide(doc, { type, title, message }) {
  try {
    const { createNotification, notifySection } = require('../services/notificationService');
    await notifySection('B2C', { type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: doc._id });
    if (doc.createdBy) {
      const creator = await User.findById(doc.createdBy).select('role isActive').lean();
      if (creator && creator.isActive && !['super_admin', 'b2c_manager'].includes(creator.role)) {
        await createNotification({ recipient: creator._id, type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: doc._id });
      }
    }
  } catch (_) { /* الإشعارُ لا يُفشل الفعل */ }
}

// ── الصفّ كما يُعرَض ─────────────────────────────────────────────────────────
const listRow = (d) => ({
  _id: d._id, ref: d.ref, seq: d.seq,
  motorcycleNumber: d.motorcycleNumber, plateNumber: d.plateNumber || '', serialNumber: d.serialNumber || '', project: d.project || '',
  screenNumber: d.screenNumber || '',
  issue: d.issue, issueOther: d.issueOther || '',
  location: d.location, availability: d.availability, availabilityOther: d.availabilityOther || '',
  status: d.status, fixedAt: d.fixedAt, closedAt: d.closedAt,
  fileCount: (d.files || []).length,
  cover: ((d.files || []).find((f) => f.kind === 'image') || {}).fileUrl || '',
  hasVideo: (d.files || []).some((f) => f.kind === 'video'),
  replyCount: (d.replies || []).length,
  lastReply: (d.replies || []).length ? d.replies[d.replies.length - 1] : null,
  createdByName: d.createdByName || '', createdAt: d.createdAt, updatedAt: d.updatedAt,
});

const fullRow = (d) => ({
  ...listRow(d),
  files: d.files || [],
  statusHistory: d.statusHistory || [],
  replies: d.replies || [],
});

const dayStart = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(S(iso)) ? new Date(`${iso}T00:00:00+03:00`) : null);

// ── القائمة ─────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const base = {};
    const from = dayStart(q.from); const to = dayStart(q.to);
    if (from || to) {
      base.createdAt = {};
      if (from) base.createdAt.$gte = from;
      if (to) base.createdAt.$lt = new Date(to.getTime() + 86400000);
    }
    const docs = await MediaGoComplaint.find(base).sort({ createdAt: -1 }).limit(5000).lean();

    // البحثُ يقرأ ما يُكتب في البلاغ — بالعربيّة مطويّةً كما في بقيّة النظام.
    const needle = fold(q.q);
    const searched = needle
      ? docs.filter((d) => fold([d.ref, d.motorcycleNumber, d.plateNumber, d.serialNumber, d.screenNumber, d.project,
        d.issueOther, d.availabilityOther, d.createdByName, label('issue', d.issue), label('issue', d.issue, 'en')].join(' ')).includes(needle))
      : docs;

    // ── العدّاداتُ لا تقفز تحت الضغطة ─────────────────────────────────────
    // كلُّ مجموعةٍ تُعَدّ بكلّ الفلاتر إلّا فلترِها هي: بطاقاتُ الحالات تبقى
    // كما هي حين تُختار إحداها، ومجموعُها يساوي المعروضَ قبل اختيارها.
    const FIELDS = ['status', 'issue', 'location', 'availability'];
    const want = Object.fromEntries(FIELDS.map((f) => [f, S(q[f])]));
    const pass = (d, skip) => FIELDS.every((f) => f === skip || !want[f] || d[f] === want[f]);
    const counts = {};
    for (const f of FIELDS) {
      counts[f] = {};
      for (const d of searched) if (pass(d, f)) counts[f][d[f]] = (counts[f][d[f]] || 0) + 1;
    }
    const rows = searched.filter((d) => pass(d, null));
    res.json({
      items: rows.map(listRow),
      total: rows.length,
      grandTotal: searched.filter((d) => pass(d, 'status')).length,
      counts,
      meta: MEDIAGO_VOCAB,
      can: abilities(req),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.meta = async (req, res) => {
  res.json({ meta: MEDIAGO_VOCAB, can: abilities(req), limits: { maxFiles: MAX_FILES, imageMB: 8, videoMB: 15, requestMB: 18 } });
};

// ── دبّاباتُ النقل الخفيف ──────────────────────────────────────────────────
// من سجلّ المركبات نفسِه (قطاع النقل الخفيف أو مشاريعه)، والنوعُ دراجة —
// «دراجة آلية» في السجلّ و«دراجة نارية» في شيت القسم (راجع lightTransportController).
const LT_VEHICLE_PROJECTS = /^(كيتا|هنجرستيشن|هنقرستيشن|امازون|أمازون|نينجا)$/;
exports.motorcycles = async (req, res) => {
  try {
    const q = S(req.query.q).slice(0, 40);
    const and = [
      { isActive: { $ne: false } },
      { $or: [{ sectorAr: /خفيف/ }, { departmentAr: LT_VEHICLE_PROJECTS }] },
      { registrationTypeAr: /دراج/ },
    ];
    if (q) {
      const rx = new RegExp(esc(q).replace(/\s+/g, '\\s*'), 'i');
      const digits = q.replace(/\D/g, '');
      and.push({ $or: [
        { plateNumber: rx }, { serialNumber: rx }, { 'actualDriver.name': rx }, { departmentAr: rx },
        ...(digits ? [{ plateDigits: new RegExp(esc(digits)) }] : []),
      ] });
    }
    const rows = await VehicleMaster.find({ $and: and })
      .select('plateNumber serialNumber departmentAr cityAr actualDriver registrationTypeAr')
      .sort({ plateNumber: 1 }).limit(q ? 40 : 400).lean();
    res.json({
      items: rows.map((v) => ({
        _id: v._id, plateNumber: v.plateNumber || '', serialNumber: v.serialNumber || '',
        project: v.departmentAr || '', city: v.cityAr || '', driverName: v.actualDriver?.name || '',
      })),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const d = await MediaGoComplaint.findById(req.params.id).lean();
    if (!d) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    res.json({ item: fullRow(d), meta: MEDIAGO_VOCAB, can: abilities(req) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── رفعُ بلاغ ───────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  if (!canCreate(req)) return res.status(403).json({ message: 'رفع البلاغات لقسم الأفراد' });
  const b = req.body || {};
  const keys = (g) => MEDIAGO_VOCAB[g].map((x) => x.key);
  const issue = S(b.issue); const location = S(b.location); const availability = S(b.availability);
  const problems = [];
  if (!keys('issue').includes(issue)) problems.push('المشكلة / Issue');
  if (issue === 'other' && !S(b.issueOther)) problems.push('وصف المشكلة / Describe the issue');
  if (!keys('location').includes(location)) problems.push('موقع الصيانة / Maintenance location');
  if (!keys('availability').includes(availability)) problems.push('وقت التوفّر / Availability');
  if (availability === 'other' && !S(b.availabilityOther)) problems.push('الوقت المناسب / Preferred time');

  // ── الدبّاب: من السجلّ إن اختير، وإلّا ما كُتب ────────────────────────────
  let vehicle = null;
  if (b.vehicle && mongoose.Types.ObjectId.isValid(String(b.vehicle))) {
    vehicle = await VehicleMaster.findById(b.vehicle).select('plateNumber serialNumber departmentAr').lean();
  }
  const motorcycleNumber = S(b.motorcycleNumber) || (vehicle ? (vehicle.plateNumber || vehicle.serialNumber) : '');
  if (!motorcycleNumber) problems.push('رقم الدبّاب / Motorcycle number');
  if (problems.length) return res.status(400).json({ message: `حقول مطلوبة: ${problems.join('، ')}`, fields: problems });

  let files = [];
  try {
    files = saveFiles(b.files, 0, req.user);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }
  try {
    const by = nameOf(req.user);
    const doc = new MediaGoComplaint({
      vehicle: vehicle?._id || null,
      motorcycleNumber: motorcycleNumber.slice(0, 60),
      plateNumber: vehicle?.plateNumber || '', serialNumber: vehicle?.serialNumber || '', project: vehicle?.departmentAr || '',
      screenNumber: S(b.screenNumber).slice(0, 60),
      files,
      issue, issueOther: issue === 'other' ? S(b.issueOther).slice(0, 500) : '',
      location,
      availability, availabilityOther: availability === 'other' ? S(b.availabilityOther).slice(0, 200) : '',
      status: 'new',
      statusHistory: [{ status: 'new', by: req.user._id, byName: by, side: 'energize', at: new Date() }],
      createdBy: req.user._id, createdByName: by,
    });
    await doc.save();
    await logAudit({ user: req.user, action: 'create', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — ${doc.motorcycleNumber}` });
    announce(doc._id, 'created');
    await notifyPartner({
      type: 'complaint_assigned', id: doc._id,
      title: `بلاغ جديد ${doc.ref} / New complaint ${doc.ref}`,
      message: `${label('issue', issue)} — ${doc.motorcycleNumber} / ${label('issue', issue, 'en')}`,
    });
    res.status(201).json({ item: fullRow(doc.toObject()) });
  } catch (e) {
    files.forEach((f) => deleteStoredFile(f.fileUrl));
    res.status(400).json({ message: e.message });
  }
};

// ── إرفاقٌ لاحق ─────────────────────────────────────────────────────────────
exports.addFiles = async (req, res) => {
  if (!canCreate(req)) return res.status(403).json({ message: 'الإرفاق لقسم الأفراد' });
  try {
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    let files;
    try { files = saveFiles(req.body?.files, doc.files.length, req.user); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }
    if (!files.length) return res.status(400).json({ message: 'لا ملفات / No files' });
    doc.files.push(...files);
    await doc.save();
    await logAudit({ user: req.user, action: 'update', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — +${files.length} مرفق` });
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

// ── الحالة ─────────────────────────────────────────────────────────────────
exports.setStatus = async (req, res) => {
  try {
    const status = S(req.body?.status);
    const note = S(req.body?.note).slice(0, 500);
    const can = abilities(req);
    if (!can.statuses.includes(status)) {
      return res.status(can.partner ? 403 : 400).json({ message: 'حالة غير مسموحة / Status not allowed' });
    }
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    if (can.partner && doc.status === 'closed') {
      return res.status(403).json({ message: 'البلاغ مغلق / This complaint is closed' });
    }
    if (doc.status === status && !note) return res.json({ item: fullRow(doc.toObject()) });
    const side = sideOf(req.user);
    const by = nameOf(req.user);
    const prev = doc.status;
    doc.status = status;
    if (status === 'fixed' && !doc.fixedAt) doc.fixedAt = new Date();
    if (status === 'closed') doc.closedAt = new Date();
    if (status === 'new' || status === 'in_progress') { doc.closedAt = null; if (status === 'new') doc.fixedAt = null; }
    doc.statusHistory.push({ status, note, by: req.user._id, byName: by, side, at: new Date() });
    // الملاحظةُ مع الحالة تُقرأ في المحادثة أيضًا — هناك يبحث عنها الطرفُ الآخر.
    if (note) doc.replies.push({ text: note, by: req.user._id, byName: by, side, at: new Date() });
    await doc.save();
    await logAudit({ user: req.user, action: 'status_change', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref}: ${prev} → ${status}` });
    announce(doc._id, 'status');
    const msg = {
      type: 'status_changed',
      title: `${doc.ref}: ${label('status', status)} / ${label('status', status, 'en')}`,
      message: `${doc.motorcycleNumber}${note ? ` — ${note}` : ''}`,
    };
    if (side === 'mediago') await notifyOurSide(doc, msg);
    else await notifyPartner({ ...msg, id: doc._id });
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

// ── الردود ─────────────────────────────────────────────────────────────────
exports.reply = async (req, res) => {
  try {
    const text = S(req.body?.text).slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الرد / Write a reply' });
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    const side = sideOf(req.user);
    doc.replies.push({ text, by: req.user._id, byName: nameOf(req.user), side, at: new Date() });
    await doc.save();
    await logAudit({ user: req.user, action: 'reply', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref}: ${text.slice(0, 120)}` });
    announce(doc._id, 'reply');
    const msg = {
      type: 'general',
      title: side === 'mediago' ? `ردّ من Media Go على ${doc.ref}` : `Reply from Energize on ${doc.ref} / ردّ على ${doc.ref}`,
      message: text.slice(0, 200),
    };
    if (side === 'mediago') await notifyOurSide(doc, msg);
    else await notifyPartner({ ...msg, id: doc._id });
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    await doc.deleteOne();
    (doc.files || []).forEach((f) => deleteStoredFile(f.fileUrl));
    await logAudit({ user: req.user, action: 'delete', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — ${doc.motorcycleNumber}` });
    announce(doc._id, 'deleted');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.CREATE_ROLES = CREATE_ROLES;
exports.DELETE_ROLES = DELETE_ROLES;
