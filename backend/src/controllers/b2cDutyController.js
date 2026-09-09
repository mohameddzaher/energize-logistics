/**
 * تفقُّد بداية الدوام — شاشةُ المشرف وسجلُّ الإدارة وتحليلُهما.
 *
 * ── القسمةُ التي يقوم عليها الملفّ ────────────────────────────────────────
 * المشرفُ يرى مندوبيه هو ويكتب فيهم (`myReps` / `submit`).
 * والإدارةُ ترى الجميعَ ولا تكتب إلّا مراجعتَها (`list` / `analytics` / `review`).
 *
 * وما يراه المشرفُ محسومٌ من `B2CRep.supervisor` لا من دورِه — فلو فتح الشاشةَ
 * مَن لا مندوبَ له لم يرَ شيئًا، ولو حاول أن يُفقّد مندوبَ غيره رُدَّ. راجع
 * `assertOwnsRep`.
 */
const mongoose = require('mongoose');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const B2CRep = require('../models/B2CRep');
const User = require('../models/User');
// يُطلَبان ليُسجَّل مخطّطاهما: `populate('branch')` يفشل بـ MissingSchemaError
// إن لم يُحمَّل الموديل، ولا يظهر ذلك إلّا خارج الخادم (سكربت، اختبار، عامل).
require('../models/Branch');
require('../models/B2CProject');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { sendMongooseError } = require('../utils/mongooseError');
const logAudit = require('../utils/auditLogger');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');

const FULL_VIEW_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager'];
const canSeeAll = (u) => FULL_VIEW_ROLES.includes(u?.role || '');

/** مفتاحُ اليوم بتوقيت الرياض — لا بتوقيت الخادم ولا بتوقيت متصفّح المستخدم. */
const RIYADH = 'Asia/Riyadh';
const dayKeyOf = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((m, x) => (m[x.type] = x.value, m), {});
  return `${p.year}-${p.month}-${p.day}`;
};
const partsOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d, date: new Date(`${key}T00:00:00.000Z`) };
};
const validKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));

const populate = (q) => q
  .populate('rep', 'englishName arabicName repId phone')
  .populate('supervisor', 'firstName lastName email role')
  .populate('branch', 'name code')
  .populate('project', 'name nameAr')
  .populate('review.by', 'firstName lastName');

// ═══════════════════════════════════════════════════════════════════════════
//  شاشةُ المشرف
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مندوبو هذا المشرف ومعهم تفقُّدُ اليوم إن وُجد.
 *
 * يعودان معًا لا في نداءين: الشاشةُ لا تعرض «اختر مندوبًا» ثمّ تكتشف بعد
 * الضغط أنّه فُقِّد صباحًا. ومَن فُقِّد يظهر منتهيًا ومعه صورتُه.
 */
exports.myReps = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    // الإدارةُ قد تفتح الشاشةَ نيابةً عن مشرف — تُمرَّر `supervisor` صراحةً.
    const asUser = canSeeAll(req.user) && req.query.supervisor ? req.query.supervisor : req.user._id;

    const repFilter = { isActive: { $ne: false }, supervisor: asUser };
    const reps = await B2CRep.find(repFilter)
      .select('englishName arabicName repId phone branch project supervisor')
      .populate('branch', 'name code')
      .populate('project', 'name nameAr')
      .sort({ englishName: 1 }).lean();

    const checks = reps.length
      ? await B2CDutyCheck.find({ dateKey, rep: { $in: reps.map((r) => r._id) } })
        .select('rep outcome checkedAt photos conditionAr hasDamage damageNotes notes vehicleType vehiclePlate supervisorName')
        .lean()
      : [];
    const byRep = new Map(checks.map((c) => [String(c.rep), c]));

    res.json({
      dateKey,
      isToday: dateKey === dayKeyOf(),
      reps: reps.map((r) => ({ ...r, check: byRep.get(String(r._id)) || null })),
      done: checks.length,
      total: reps.length,
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل مندوبيك' }); }
};

/** حارسٌ واحد: أهذا المندوبُ من رجال هذا المشرف؟ */
const assertOwnsRep = async (req, repId) => {
  const rep = await B2CRep.findById(repId).select('supervisor branch project englishName isActive').lean();
  if (!rep) return { error: 404, message: 'المندوب غير موجود' };
  if (rep.isActive === false) return { error: 400, message: 'هذا المندوب غير نشط' };
  if (canSeeAll(req.user)) return { rep };
  if (String(rep.supervisor || '') !== String(req.user._id)) {
    return { error: 403, message: 'هذا المندوب ليس ضمن مندوبيك' };
  }
  return { rep };
};

/**
 * تسجيلُ التفقّد.
 *
 * ── ولماذا لا تُقبَل صورةٌ بلا التقاط ────────────────────────────────────
 * الصورةُ هي الحجّة كلُّها؛ فإن جاز أن تُرفَع من الملفّات صار الصفُّ ورقةً
 * تُملأ من المكتب. ولا يُصدَّق المتصفّحُ فيما يقوله عن نفسه، لكنّ الواجهةَ لا
 * تعرض بابًا آخرَ أصلًا، والمصدرُ يُثبَّت في الصفّ فيُسأل عنه لو خالف.
 *
 * ولا يُقبَل «بدأ الدوام» بلا صورة: هذا هو الشرطُ الذي وُجدت الشاشةُ لأجله.
 * أمّا الغائبُ والممنوعُ فلا صورةَ لهما — لا مركبةَ خرجت لتُصوَّر.
 */
exports.submit = async (req, res) => {
  const saved = [];
  try {
    const { rep: repId, outcome = 'started', photos = [] } = req.body;
    if (!repId) return res.status(400).json({ message: 'اختر المندوب' });
    if (!['started', 'absent', 'blocked'].includes(outcome)) {
      return res.status(400).json({ message: 'حالة غير معروفة' });
    }
    const own = await assertOwnsRep(req, repId);
    if (own.error) return res.status(own.error).json({ message: own.message });

    if (outcome === 'started' && !photos.length) {
      return res.status(400).json({ message: 'لا بدّ من صورة المركبة لتسجيل بدء الدوام' });
    }

    const dateKey = validKey(req.body.date) && canSeeAll(req.user) ? req.body.date : dayKeyOf();
    const { year, month, day, date } = partsOf(dateKey);

    for (const p of photos.slice(0, 4)) {
      const src = String(p?.dataUrl || '');
      if (!src.startsWith('data:image/')) {
        return res.status(400).json({ message: 'الصورة يجب أن تُلتقَط من الكاميرا' });
      }
      try {
        const f = saveUploadFile(src, 'b2c-duty', p.fileName || 'duty.jpg');
        saved.push({ ...f, captureSource: p.captureSource === 'camera' ? 'camera' : 'unknown', takenAt: new Date() });
      } catch (err) { return res.status(400).json({ message: err.message }); }
    }

    const me = await User.findById(req.user._id).select('firstName lastName').lean();
    const doc = {
      rep: own.rep._id,
      supervisor: req.user._id,
      supervisorName: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
      branch: own.rep.branch || null,
      project: own.rep.project || null,
      date, dateKey, year, month, day,
      checkedAt: new Date(),
      outcome,
      vehicleType: req.body.vehicleType || '',
      vehiclePlate: String(req.body.vehiclePlate || '').trim(),
      conditionAr: String(req.body.conditionAr || '').trim(),
      hasDamage: !!req.body.hasDamage,
      damageNotes: String(req.body.damageNotes || '').trim(),
      notes: String(req.body.notes || '').trim(),
      location: req.body.location && Number.isFinite(Number(req.body.location.lat))
        ? {
          lat: Number(req.body.location.lat),
          lng: Number(req.body.location.lng),
          accuracy: Number(req.body.location.accuracy) || undefined,
        } : undefined,
      createdBy: req.user._id,
    };

    // التصحيحُ يُعدِّل صفَّ اليوم ولا يضيف ثانيًا — راجع الفهرس الفريد.
    const existing = await B2CDutyCheck.findOne({ rep: own.rep._id, dateKey });
    let check;
    if (existing) {
      // الصورُ تُضاف ولا تُمحى: صورةُ الصباح حجّةٌ لا تُستبدَل بأخرى بعد الحادث.
      doc.photos = [...(existing.photos || []), ...saved];
      Object.assign(existing, doc);
      check = await existing.save();
    } else {
      check = await B2CDutyCheck.create({ ...doc, photos: saved });
    }

    await logAudit({
      user: req.user._id, action: existing ? 'update_b2c_duty_check' : 'create_b2c_duty_check',
      entity: 'B2CDutyCheck', entityId: check._id,
      changes: { after: { rep: own.rep.englishName, dateKey, outcome } }, ipAddress: req.ip,
    });

    // ما لا يُخرَج يُعلَم به فورًا: مركبةٌ بها تلفٌ أو مندوبٌ مُنع من العمل.
    if (doc.hasDamage || outcome === 'blocked') {
      const heads = await User.find({ role: { $in: ['b2c_manager', 'super_admin'] }, isActive: true })
        .select('_id').lean();
      await Promise.all(heads.map((h) => createNotification({
        recipient: h._id, type: 'system_alert',
        title: outcome === 'blocked' ? 'مندوب مُنع من الخروج' : 'تلف في مركبة مندوب',
        message: `${own.rep.englishName || ''} — ${doc.damageNotes || doc.conditionAr || ''}`.trim(),
        relatedEntity: 'B2CDutyCheck', relatedEntityId: check._id,
      }).catch(() => {})));
    }

    try { emitToAll('b2c:duty', { dateKey }); } catch (e) { /* */ }
    const out = await populate(B2CDutyCheck.findById(check._id)).lean();
    res.status(existing ? 200 : 201).json({ check: out });
  } catch (e) {
    // ملفٌّ كُتب ثمّ فشل الحفظ لا يُترَك يتيمًا على القرص.
    saved.forEach((f) => { try { deleteStoredFile(f.fileUrl); } catch (x) { /* */ } });
    if (e?.code === 11000) return res.status(409).json({ message: 'سُجِّل تفقّدٌ لهذا المندوب اليوم' });
    return sendMongooseError(res, e, 'تعذّر حفظ التفقّد');
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  سجلُّ الإدارة
// ═══════════════════════════════════════════════════════════════════════════

/** شرطُ القراءة: الإدارةُ ترى الكلَّ، والمشرفُ يرى ما سجّله هو. */
const scopeOf = (req) => (canSeeAll(req.user) ? {} : { supervisor: req.user._id });

const listFilter = (req) => {
  const q = req.query || {};
  const and = [scopeOf(req)];
  // يومٌ واحد، أو مدًى بين تاريخين. وغيابُ الاثنين يعني اليوم.
  if (validKey(q.from) && validKey(q.to)) and.push({ dateKey: { $gte: q.from, $lte: q.to } });
  else if (validKey(q.date)) and.push({ dateKey: q.date });
  else if (validKey(q.from)) and.push({ dateKey: { $gte: q.from } });
  else if (validKey(q.to)) and.push({ dateKey: { $lte: q.to } });
  else and.push({ dateKey: dayKeyOf() });

  const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
  if (oid(q.supervisor)) and.push({ supervisor: oid(q.supervisor) });
  if (oid(q.branch)) and.push({ branch: oid(q.branch) });
  if (oid(q.project)) and.push({ project: oid(q.project) });
  if (oid(q.rep)) and.push({ rep: oid(q.rep) });
  if (['started', 'absent', 'blocked'].includes(q.outcome)) and.push({ outcome: q.outcome });
  if (q.damage === '1') and.push({ hasDamage: true });
  if (q.flagged === '1') and.push({ 'review.verdict': 'flagged' });
  if (q.unreviewed === '1') and.push({ $or: [{ 'review.verdict': '' }, { 'review.verdict': { $exists: false } }] });
  if (q.withPhoto === '1') and.push({ 'photos.0': { $exists: true } });
  return and.length === 1 ? and[0] : { $and: and };
};

exports.list = async (req, res) => {
  try {
    const filter = listFilter(req);
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [rows, total] = await Promise.all([
      populate(B2CDutyCheck.find(filter)).sort({ checkedAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      B2CDutyCheck.countDocuments(filter),
    ]);
    res.json({ rows, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل السجلّ' }); }
};

exports.getOne = async (req, res) => {
  try {
    const row = await populate(B2CDutyCheck.findById(req.params.id)).lean();
    if (!row) return res.status(404).json({ message: 'غير موجود' });
    if (!canSeeAll(req.user) && String(row.supervisor?._id || row.supervisor) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرّح' });
    }
    res.json({ check: row });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/**
 * مراجعةُ الإدارة على صفٍّ بعينه.
 *
 * وهي نصفُ الغرض من الشاشة: الصورةُ تُلتقَط ليقرأها أحدٌ ويقول «سليم» أو
 * «يُحاسَب». وبلا هذا الحقل يبقى السجلُّ أرشيفًا لا يُبنى عليه قرار.
 */
exports.review = async (req, res) => {
  try {
    if (!canSeeAll(req.user)) return res.status(403).json({ message: 'المراجعة للإدارة' });
    const verdict = req.body.verdict === 'flagged' ? 'flagged' : req.body.verdict === 'ok' ? 'ok' : '';
    const row = await B2CDutyCheck.findByIdAndUpdate(
      req.params.id,
      { $set: { review: { by: req.user._id, at: new Date(), verdict, note: String(req.body.note || '').trim() } } },
      { new: true },
    );
    if (!row) return res.status(404).json({ message: 'غير موجود' });
    // المشرفُ يُخبَر بما قيل عن تفقّده — وإلّا كانت المحاسبةُ بلا علم.
    if (verdict === 'flagged') {
      await createNotification({
        recipient: row.supervisor, type: 'system_alert',
        title: 'ملاحظة على تفقّد بداية الدوام',
        message: String(req.body.note || '').trim() || 'راجع الإدارةُ أحد تفقّداتك.',
        relatedEntity: 'B2CDutyCheck', relatedEntityId: row._id,
      }).catch(() => {});
    }
    try { emitToAll('b2c:duty', { dateKey: row.dateKey }); } catch (e) { /* */ }
    res.json({ check: await populate(B2CDutyCheck.findById(row._id)).lean() });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حفظ المراجعة'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  التحليل
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تحليلُ الالتزام — لا تحليلَ الطلبات.
 *
 * السؤالُ هنا واحد: هل وقف المشرفُ على رجاله؟ فالمقياسُ ليس عددَ التفقّدات بل
 * **نسبتُها إلى مَن كان يجب أن يُفقَّد** — عشرةُ تفقّداتٍ من عشرة التزامٌ تامّ،
 * وعشرةٌ من ثلاثين تقصير. ولا يُعرَف المقامُ من جدول التفقّد نفسِه (الصفُّ لا
 * يُكتب أصلًا لمن أُهمل)، فيُقرأ من `B2CRep`.
 *
 * والحسابُ في قاعدة البيانات لا في Node — راجع dashboard-performance.
 */
exports.analytics = async (req, res) => {
  try {
    const q = req.query || {};
    const to = validKey(q.to) ? q.to : dayKeyOf();
    const from = validKey(q.from) ? q.from : to;
    const base = { ...scopeOf(req), dateKey: { $gte: from, $lte: to } };
    const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
    if (oid(q.branch)) base.branch = oid(q.branch);
    if (oid(q.project)) base.project = oid(q.project);
    if (oid(q.supervisor)) base.supervisor = oid(q.supervisor);

    // عددُ الأيّام في المدى — مقامُ نسبة الالتزام.
    const days = Math.max(
      1,
      Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1,
    );

    const repScope = { isActive: { $ne: false }, supervisor: { $ne: null } };
    if (base.branch) repScope.branch = base.branch;
    if (base.project) repScope.project = base.project;
    if (base.supervisor) repScope.supervisor = base.supervisor;
    else if (!canSeeAll(req.user)) repScope.supervisor = req.user._id;

    const [totals, bySupervisor, byDay, byCondition, byBranch, expected, topDamage] = await Promise.all([
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: null,
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$outcome', 'absent'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$outcome', 'blocked'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
          withPhoto: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$photos', []] } }, 0] }, 1, 0] } },
          flagged: { $sum: { $cond: [{ $eq: ['$review.verdict', 'flagged'] }, 1, 0] } },
          reviewed: { $sum: { $cond: [{ $in: ['$review.verdict', ['ok', 'flagged']] }, 1, 0] } },
        } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: '$supervisor',
          name: { $last: '$supervisorName' },
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$outcome', 'absent'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$outcome', 'blocked'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
          flagged: { $sum: { $cond: [{ $eq: ['$review.verdict', 'flagged'] }, 1, 0] } },
          reps: { $addToSet: '$rep' },
          // متى يقف عادةً؟ متأخّرٌ كلَّ يومٍ سؤالٌ في ذاته.
          avgHour: { $avg: { $hour: { date: '$checkedAt', timezone: RIYADH } } },
        } },
        { $project: { name: 1, checks: 1, started: 1, absent: 1, blocked: 1, damaged: 1, flagged: 1, avgHour: 1, repCount: { $size: '$reps' } } },
        { $sort: { checks: -1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: '$dateKey',
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
        } },
        { $sort: { _id: 1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: { ...base, conditionAr: { $nin: ['', null] } } },
        { $group: { _id: '$conditionAr', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: { _id: '$branch', checks: { $sum: 1 }, damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } } } },
        { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } },
        { $project: { name: { $ifNull: [{ $first: '$b.name' }, '—'] }, checks: 1, damaged: 1 } },
        { $sort: { checks: -1 } },
      ]),
      // المقام: كم مندوبًا لكلّ مشرفٍ كان يجب أن يُفقَّد كلَّ يوم.
      B2CRep.aggregate([
        { $match: repScope },
        { $group: { _id: '$supervisor', reps: { $sum: 1 } } },
      ]),
      // مَن تتكرّر مركبتُه تالفة — الرجلُ لا اليوم.
      B2CDutyCheck.aggregate([
        { $match: { ...base, hasDamage: true } },
        { $group: { _id: '$rep', times: { $sum: 1 }, last: { $max: '$dateKey' } } },
        { $sort: { times: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'b2creps', localField: '_id', foreignField: '_id', as: 'r' } },
        { $project: { times: 1, last: 1, name: { $ifNull: [{ $first: '$r.englishName' }, '—'] } } },
      ]),
    ]);

    const expectedBySup = new Map(expected.map((e) => [String(e._id), e.reps]));
    const totalExpected = expected.reduce((a, b) => a + b.reps, 0) * days;
    const t = totals[0] || {};

    // اسمُ المشرف يُقرأ من الحساب لا من اللقطة وحدَها — قد يكون له مندوبون
    // ولم يُفقّد أحدًا قطّ، فلا لقطةَ اسمٍ له في الجدول أصلًا.
    const supIds = [...new Set([...bySupervisor.map((x) => String(x._id)), ...expected.map((x) => String(x._id))])]
      .filter((x) => mongoose.isValidObjectId(x));
    const users = await User.find({ _id: { $in: supIds } }).select('firstName lastName').lean();
    const nameById = new Map(users.map((u) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(' ')]));

    const supervisors = supIds.map((id) => {
      const row = bySupervisor.find((x) => String(x._id) === id) || {};
      const reps = expectedBySup.get(id) || 0;
      const due = reps * days;
      return {
        _id: id,
        name: nameById.get(id) || row.name || '—',
        reps,
        due,
        checks: row.checks || 0,
        started: row.started || 0,
        absent: row.absent || 0,
        blocked: row.blocked || 0,
        damaged: row.damaged || 0,
        flagged: row.flagged || 0,
        avgHour: row.avgHour != null ? Math.round(row.avgHour * 10) / 10 : null,
        compliance: due ? Math.round(((row.checks || 0) / due) * 1000) / 10 : null,
      };
    }).sort((a, b) => (b.compliance ?? -1) - (a.compliance ?? -1));

    res.json({
      from, to, days,
      totals: {
        checks: t.checks || 0,
        started: t.started || 0,
        absent: t.absent || 0,
        blocked: t.blocked || 0,
        damaged: t.damaged || 0,
        withPhoto: t.withPhoto || 0,
        flagged: t.flagged || 0,
        reviewed: t.reviewed || 0,
        expected: totalExpected,
        compliance: totalExpected ? Math.round(((t.checks || 0) / totalExpected) * 1000) / 10 : null,
      },
      supervisors,
      byDay,
      byCondition,
      byBranch,
      topDamage,
    });
  } catch (e) {
    console.error('b2c duty analytics', e);
    res.status(500).json({ message: 'تعذّر تحميل التحليل' });
  }
};

/**
 * مَن لم يُفقَّد اليوم — القائمةُ التي لا يعرضها جدولُ التفقّد لأنّ صفَّها
 * غيرُ مكتوب. وهي أهمُّ ما تفتحه الإدارةُ صباحًا.
 */
exports.missing = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    const repScope = { isActive: { $ne: false }, supervisor: { $ne: null } };
    if (!canSeeAll(req.user)) repScope.supervisor = req.user._id;
    else if (mongoose.isValidObjectId(req.query.supervisor)) repScope.supervisor = new mongoose.Types.ObjectId(String(req.query.supervisor));
    if (mongoose.isValidObjectId(req.query.branch)) repScope.branch = new mongoose.Types.ObjectId(String(req.query.branch));

    const reps = await B2CRep.find(repScope)
      .select('englishName arabicName repId supervisor branch')
      .populate('branch', 'name').populate('supervisor', 'firstName lastName').lean();
    const done = new Set((await B2CDutyCheck.find({ dateKey, rep: { $in: reps.map((r) => r._id) } })
      .select('rep').lean()).map((c) => String(c.rep)));

    const rows = reps.filter((r) => !done.has(String(r._id)));
    res.json({ dateKey, missing: rows, total: reps.length, done: done.size });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** المشرفون الذين لهم مندوبون — تُبنى منهم قوائمُ الفلترة والإسناد. */
exports.supervisors = async (req, res) => {
  try {
    const rows = await B2CRep.aggregate([
      { $match: { isActive: { $ne: false }, supervisor: { $ne: null } } },
      { $group: { _id: '$supervisor', reps: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: {
        reps: 1,
        firstName: { $first: '$u.firstName' }, lastName: { $first: '$u.lastName' },
        role: { $first: '$u.role' },
      } },
      { $sort: { reps: -1 } },
    ]);
    res.json({ supervisors: rows.map((r) => ({ ...r, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || '—' })) });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** إسنادُ مندوبين إلى مشرف — دفعةً واحدة من شاشة المندوبين. */
exports.assign = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.reps) ? req.body.reps : []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'اختر مندوبًا واحدًا على الأقلّ' });
    const sup = req.body.supervisor;
    // فراغٌ يعني «بلا مشرف» — وهو فعلٌ مقصودٌ لا خطأ إدخال.
    if (sup && !mongoose.isValidObjectId(sup)) return res.status(400).json({ message: 'مشرف غير صالح' });
    const r = await B2CRep.updateMany({ _id: { $in: ids } }, { $set: { supervisor: sup || null } });
    await logAudit({
      user: req.user._id, action: 'assign_b2c_supervisor', entity: 'B2CRep',
      changes: { after: { reps: ids.length, supervisor: sup || null } }, ipAddress: req.ip,
    });
    try { emitToAll('b2c:duty', {}); } catch (e) { /* */ }
    res.json({ updated: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الإسناد'); }
};

module.exports.dayKeyOf = dayKeyOf;
module.exports.canSeeAll = canSeeAll;
module.exports.populate = populate;
module.exports.validKey = validKey;
