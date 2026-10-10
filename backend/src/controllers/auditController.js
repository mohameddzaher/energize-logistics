const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { SECTIONS, sectionOf, entitiesOfSection } = require('../config/auditSections');
const { actionLabel, entityLabel } = require('../config/auditLabels');
const { describe } = require('../utils/auditDescribe');
const { startOfDay, endOfDay } = require('../utils/companyDay');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isId = (v) => OBJECT_ID.test(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** خطأٌ في الفلتر نفسِه — يُردّ بسببه لا بجدولٍ فارغٍ يُظنّ جوابًا. */
class FilterError extends Error {}

/**
 * ── يومٌ واحد، أو مدًى — بتوقيت الشركة ──────────────────────────────────────
 *
 * `date=YYYY-MM-DD` يومٌ بحدَّيه، و`dateFrom`/`dateTo` مدًى، وأيُّ واحدٍ منهما
 * وحدَه يعمل كما يُتوقَّع.
 *
 * وكان الحدُّ يُبنى `new Date('2026-10-09T00:00:00.000')` بلا منطقة — فيُقرأ
 * بتوقيت **الخادم**. والخادمُ على غرينتش: «يوم ٩ أكتوبر» كان يبدأ الثالثةَ
 * فجرًا بالرياض وينتهي الثالثةَ فجرَ العاشر، فيسقط ما جرى بعد منتصف الليل
 * ويدخل مكانَه أوّلُ اليوم التالي. راجع utils/companyDay.
 */
const dayBounds = (from, to) => {
  let a = from ? String(from).slice(0, 10) : '';
  let b = to ? String(to).slice(0, 10) : '';
  if ((a && !YMD.test(a)) || (b && !YMD.test(b))) throw new FilterError('تاريخ غير صالح');
  // مدًى مقلوبٌ يُعدَّل ولا يُردّ فارغًا: من كتب «من ١٠ إلى ٥» يقصد ما بينهما.
  if (a && b && a > b) [a, b] = [b, a];
  const range = {};
  if (a) range.$gte = startOfDay(a);
  if (b) range.$lte = endOfDay(b);
  return range;
};

/**
 * شرطُ الاستعلام من فلاتر الشاشة. `skip` أسماءُ فلاترَ تُهمَل — تُبنى بها
 * قوائمُ الخيارات: قائمةُ كلِّ فلترٍ تُحسَب بكلِّ الفلاتر **سواه**.
 */
async function buildFilter(q, skip = []) {
  const on = (k) => !skip.includes(k) && q[k] !== undefined && q[k] !== null && String(q[k]) !== '';
  const filter = {};

  // ── القسمُ أوّلًا، والكيانُ تفصيلٌ داخله ─────────────────────────────────
  // واختيارُ كيانٍ صريحٍ يَغلِب قسمَه: من اختار «حركة عهدة» يريدها وحدَها لا
  // قسمَ العهدة كلَّه. ولو جُمع الشرطان لأعطى الاختياران المتّسقان نتيجةً
  // صحيحةً والمتعارضان فراغًا لا يُفهَم سببُه.
  if (on('entity')) {
    filter.entity = String(q.entity);
  } else if (on('section')) {
    if (q.section === 'other') {
      // «أخرى» ليست قائمةً تُعَدّ — هي كلُّ ما ليس في القائمة، بما يشمل
      // كيانًا أُضيف في الخادم أمسِ ولم يُصنَّف بعد.
      const known = SECTIONS.flatMap((s) => entitiesOfSection(s.key));
      filter.entity = { $nin: known };
    } else {
      filter.entity = { $in: entitiesOfSection(String(q.section)) };
    }
  }

  // ── الفعلُ بمفتاحه كاملًا ────────────────────────────────────────────────
  // كان بحثًا نصّيًّا في المفتاح الإنجليزيّ (`update_workflow`) والشاشةُ تعرض
  // الفعلَ بالعربيّة: من كتب «تعديل» كما يقرؤها لم يجد شيئًا. وكان النصُّ
  // يُمرَّر تعبيرًا نمطيًّا كما هو، فقوسٌ واحدٌ يُسقط الطلب. فصار اختيارًا من
  // قائمة الأفعال الواقعة فعلًا، ومطابقةً تامّة.
  if (on('action')) {
    const list = String(q.action).split(',').map((s) => s.trim()).filter(Boolean);
    filter.action = list.length === 1 ? list[0] : { $in: list };
  }

  // ── الشخص ────────────────────────────────────────────────────────────────
  // `system` هو النظامُ نفسُه (الإقفالُ التلقائيّ): قيودٌ بلا فاعلٍ لم يكن
  // إليها سبيلٌ من هذا الفلتر.
  //
  // و`unnamed` حساباتٌ حُذفت قبل أن يبدأ السجلُّ يلتقط اسمَ الفاعل: أكثرُ من
  // ألفِ حسابِ اختبارٍ أُنشئ وحُذف، لا يُعرَف من كلٍّ منها إلّا معرّفُه. تُجمَع
  // في خيارٍ واحدٍ بدل ألفِ سطرٍ بلا اسم — ولا تُخفى: أفعالُها في السجلّ.
  let users = null; // null = الكلّ
  let systemOnly = false;
  let unnamedOnly = false;
  if (on('user')) {
    if (q.user === 'system') systemOnly = true;
    else if (q.user === 'unnamed') unnamedOnly = true;
    else if (isId(q.user)) users = [String(q.user)];
    else throw new FilterError('مستخدم غير صالح');
  }

  // ── الفرعُ يُقرأ من فاعله ────────────────────────────────────────────────
  // القيدُ لا يحمل فرعًا — وهو صحيح: الفعلُ يقع على كيانٍ قد لا يخصّ فرعًا
  // أصلًا (دورُ صلاحيّة، إعدادُ نظام). لكنّ **مَن فعله** ينتمي إلى فرع،
  // وهذا هو السؤال المقصود: «ماذا فعل ناسُ جدّة؟».
  if (on('branch')) {
    // `none` مَن لا فرعَ له — الإدارةُ ومديرو النظام، ولهم نصفُ السجلّ. وبلا
    // هذا الخيار لا يبلغهم فلترُ الفرع من أيّ باب.
    if (q.branch !== 'none' && !isId(q.branch)) throw new FilterError('فرع غير صالح');
    const cond = q.branch === 'none' ? { branch: null } : { branch: q.branch };
    const ids = (await User.find(cond).select('_id').lean()).map((u) => String(u._id));
    // ومع اختيارِ شخصٍ بعينه يتقاطع الشرطان لا يتجاوران: شخصٌ من فرعٍ آخرَ
    // مع فرعِ جدّة جوابُه «لا شيء»، لا «كلُّ ما فعله». والنظامُ لا فرعَ له.
    users = users ? users.filter((u) => ids.includes(u)) : ids;
    if (systemOnly || unnamedOnly) { systemOnly = false; unnamedOnly = false; users = []; }
  }
  if (unnamedOnly) {
    // «بلا اسم» صفةُ الحساب لا القيد: حسابٌ التُقط اسمُه في قيدٍ واحدٍ يُعرَف
    // به في قيوده كلِّها — وهو التعريفُ نفسُه الذي تُعَدّ به القائمة.
    const live = await User.distinct('_id');
    const rows = await AuditLog.aggregate([
      { $match: { user: { $nin: [...live, null] } } },
      { $group: { _id: '$user', name: { $max: '$userName' }, email: { $max: '$userEmail' } } },
      { $match: { name: { $in: ['', null] }, email: { $in: ['', null] } } },
    ]);
    filter.user = { $in: rows.map((r) => r._id) };
  } else
  if (systemOnly) filter.user = null; // يطابق الغائبَ والفارغ
  else if (users) filter.user = users.length === 1 ? oid(users[0]) : { $in: users.map(oid) };

  if (!skip.includes('date')) {
    const day = q.date;
    const from = day || q.dateFrom || q.from;
    const to = day || q.dateTo || q.to;
    if (from || to) filter.createdAt = dayBounds(from, to);
  }
  return filter;
}

/** كلُّ ما يشبه معرّفًا داخليًّا في `changes` — يُسأل عن أصحابه مرّةً للصفحة كلِّها. */
function collectIds(v, into, depth = 0) {
  if (v == null || depth > 3) return;
  if (typeof v === 'string') { if (OBJECT_ID.test(v)) into.add(v); return; }
  if (v._bsontype) { into.add(String(v)); return; }
  if (Array.isArray(v)) { v.slice(0, 20).forEach((x) => collectIds(x, into, depth + 1)); return; }
  if (typeof v === 'object' && !(v instanceof Date)) Object.values(v).forEach((x) => collectIds(x, into, depth + 1));
}

const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

/**
 * ── المعرّفُ يُقرأ اسمًا ─────────────────────────────────────────────────────
 * `branch: 6a0acb7f… ← 69cceb1c…` لا يقول شيئًا. فمعرّفاتُ الصفحة تُجمَع ويُسأل
 * عنها في الفروع والمستخدمين والموظّفين — ثلاثةُ استعلاماتٍ للصفحة لا لكلّ صفّ.
 * وما لم يُعرَف صاحبُه يُقال عنه «تغيّر» بلا رقم.
 */
async function resolveRefs(logs) {
  const ids = new Set();
  for (const l of logs) collectIds(l.changes, ids);
  if (!ids.size) return {};
  const list = [...ids].slice(0, 5000).map(oid);
  const Employee = require('../models/Employee');
  const [branches, users, employees] = await Promise.all([
    Branch.find({ _id: { $in: list } }).select('name').lean(),
    User.find({ _id: { $in: list } }).select('firstName lastName email').lean(),
    Employee.find({ _id: { $in: list } }).select('arabicName firstName lastName').lean(),
  ]);
  const refs = {};
  for (const b of branches) refs[String(b._id)] = b.name;
  for (const u of users) refs[String(u._id)] = fullName(u) || u.email;
  for (const e of employees) refs[String(e._id)] = e.arabicName || fullName(e);
  return refs;
}

/**
 * ── على أيِّ سجلٍّ وقع الفعل ──────────────────────────────────────────────────
 * العمودُ كان يعرض `entityId` — أربعةً وعشرين حرفًا لا يعرفها أحد. والسؤالُ
 * «كشفُ مَن؟ ملفُّ مَن؟». فيُقرأ اسمُ السجلّ من جدوله حيث يُعرَف الجدول.
 * وسجلٌّ حُذف بعد الفعل لا يُعثَر عليه — فيبقى ما التقطه القيدُ نفسُه.
 */
const SUBJECT_SOURCES = {
  Employee: ['Employee', 'arabicName firstName lastName', (d) => d.arabicName || fullName(d)],
  User: ['User', 'firstName lastName email', (d) => fullName(d) || d.email],
  OperationsWorkflow: ['OperationsWorkflow', 'reportNumber', (d) => (d.reportNumber ? `كشف ${d.reportNumber}` : '')],
  VehicleMaster: ['VehicleMaster', 'plateNumber', (d) => (d.plateNumber ? `لوحة ${d.plateNumber}` : '')],
  CustomsClearance: ['CustomsClearance', 'refNumber', (d) => (d.refNumber ? `معاملة ${d.refNumber}` : '')],
  CollectionsParty: ['CollectionsParty', 'name', (d) => d.name],
  B2CRep: ['B2CRep', 'arabicName englishName', (d) => d.arabicName || d.englishName],
  CompanyEmail: ['CompanyEmail', 'email', (d) => d.email],
  Branch: ['Branch', 'name', (d) => d.name],
};

async function resolveSubjects(logs) {
  const byEntity = {};
  for (const l of logs) {
    if (!l.entityId || !SUBJECT_SOURCES[l.entity]) continue;
    (byEntity[l.entity] = byEntity[l.entity] || new Set()).add(String(l.entityId));
  }
  const out = {};
  await Promise.all(Object.entries(byEntity).map(async ([entity, set]) => {
    const [file, select, name] = SUBJECT_SOURCES[entity];
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const Model = require(`../models/${file}`);
      const docs = await Model.find({ _id: { $in: [...set].map(oid) } }).select(select).lean();
      for (const d of docs) out[`${entity}:${d._id}`] = name(d) || '';
    } catch (e) { /* الاسمُ زيادةٌ على القيد لا شرطٌ لعرضه */ }
  }));
  return out;
}

exports.getAuditLogs = async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = await buildFilter(req.query);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        // و`_id` يفصل بين قيودٍ كُتبت في اللحظة نفسِها (استيرادٌ جماعيّ) —
        // وبلا فاصلٍ ثابتٍ يتكرّر صفٌّ في صفحتين ويغيب آخر.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    // الفاعلون يُقرؤون باستعلامٍ واحدٍ لا بـ`populate`: هي تمحو المرجعَ حين يُحذَف
    // الحساب، فيضيع المعرّفُ الذي يُفلتَر به تاريخُ صاحبه.
    const actorIds = [...new Set(logs.map((l) => l.user && String(l.user)).filter(Boolean))];
    const [refs, subjects, actors] = await Promise.all([
      resolveRefs(logs), resolveSubjects(logs),
      User.find({ _id: { $in: actorIds } }).select('firstName lastName email role branch').lean(),
    ]);
    const actorById = Object.fromEntries(actors.map((u) => [String(u._id), u]));
    // التفصيلُ الكامل لصفحة الشاشة وحدَها؛ التصديرُ يكفيه السطرُ المقروء، ولقطةُ
    // كلِّ كشفٍ في عشرات الآلاف من الصفوف حمولةٌ لا يقرؤها أحد.
    const withDetail = limit <= 200;

    const shaped = logs.map((l) => {
      const o = {
        _id: l._id, action: l.action, entity: l.entity, entityId: l.entityId, entityKey: l.entityKey || '',
        ipAddress: l.ipAddress, createdAt: l.createdAt, bySystem: !!l.bySystem,
        userName: l.userName || '', userEmail: l.userEmail || '',
        user: (l.user && actorById[String(l.user)]) || null,
      };
      // ── الفاعلُ يُقرأ من اللقطة حين يُحذَف حسابُه ────────────────────────
      // `populate` تعود فارغةً لمستخدمٍ محذوف، فتقرأ الشاشةُ الفعلَ منسوبًا إلى
      // «النظام». فيُكمَّل من اللقطة المحفوظة ساعةَ الفعل، ويُعلَّم أنّ حسابَه
      // أُزيل — فلا يُنسَب فعلُ إنسانٍ إلى آلة.
      if (!o.user && l.user) {
        o.user = {
          _id: String(l.user), firstName: l.userName || l.userEmail || (lang === 'en' ? 'Deleted account (no name recorded)' : 'حساب محذوف (لم يُسجَّل اسمه)'), lastName: '', email: l.userEmail || '', deleted: true,
          unnamed: !l.userName && !l.userEmail,
        };
      }
      // واسمُ الفاعل جاهزٌ في حقلٍ واحد — التطبيقُ يعرضه كما هو.
      o.userName = o.user ? (fullName(o.user) || o.user.email || o.userName) : (lang === 'en' ? 'System' : 'النظام');

      // القسمُ يُحسَب هنا لا في الواجهة: الخريطةُ واحدةٌ يقرؤها الفلترُ والعمود،
      // فلا يقع صفٌّ في قسمٍ عند الفلترة وفي آخرَ عند العرض.
      o.section = sectionOf(l.entity);
      const sec = SECTIONS.find((s) => s.key === o.section);
      o.sectionLabel = sec ? sec[lang] : o.section;
      o.actionLabel = actionLabel(l.action, l.entity, lang);
      o.entityLabel = entityLabel(l.entity, lang);

      const d = describe(l, { lang, refs, subjectHint: subjects[`${l.entity}:${l.entityId}`] || '' });
      o.subject = d.subject;
      o.summary = d.summary;
      o.kind = d.kind;
      o.hasDetails = d.rows.length > 0 || d.unchanged.length > 0;
      if (withDetail) o.detail = { rows: d.rows, unchanged: d.unchanged, bulkCount: d.bulkCount };
      return o;
    });
    res.json({
      logs: shaped, total, page, pages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof FilterError) return res.status(400).json({ message: error.message });
    console.error('audit list error:', error.message);
    res.status(500).json({ message: 'Failed to load audit logs' });
  }
};

/**
 * مفرداتُ الفلاتر — وكلُّ قائمةٍ تتبع ما اختير في غيرها.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كانت الأعدادُ تُحسَب مرّةً على السجلّ كلِّه: يُختار «أمس» ثمّ يُقرأ أمام
 * «الموارد البشرية» ٦٬٦٩٠ — وهو عددُ القسم منذ بدأ السجلّ، لا عددُه أمس.
 * فيُفتَح القسمُ على جدولٍ فيه ثلاثةُ صفوف.
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * قائمةُ كلِّ فلترٍ تُحسَب بكلِّ الفلاتر الأخرى سواه، وبما هو أعلى منه:
 *   القسم   ← الشخص والفرع والزمن
 *   الكيان  ← ما سبق + القسم
 *   الفعل   ← ما سبق + الكيان
 *   الشخص   ← الفرع والزمن والقسم والكيان والفعل
 */
exports.getAuditOptions = async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const q = req.query;
    const [base, userScope] = await Promise.all([
      buildFilter(q, ['section', 'entity', 'action']),
      buildFilter(q, ['user']),
    ]);
    const [pairs, actorRows, branches] = await Promise.all([
      AuditLog.aggregate([
        { $match: base },
        { $group: { _id: { e: '$entity', a: '$action' }, count: { $sum: 1 } } },
      ]),
      // الفاعلون من القيود نفسِها بلقطة أسمائهم — فمن حُذف حسابُه يبقى في
      // القائمة باسمه، ويبقى تاريخُه مقروءًا.
      AuditLog.aggregate([
        { $match: userScope },
        { $group: { _id: '$user', count: { $sum: 1 }, name: { $max: '$userName' }, email: { $max: '$userEmail' } } },
      ]),
      // والفروعُ كاملةً: الفلترُ يسأل «مَن في هذا الفرع فعل شيئًا؟»، وفرعٌ لم
      // يفعل أحدٌ فيه شيئًا جوابٌ صحيحٌ لا خيارٌ يُخفى.
      Branch.find({}).select('name').sort({ name: 1 }).lean(),
    ]);

    // ── الأقسام: كلُّها، بعددها ────────────────────────────────────────────
    // قسمٌ بلا قيودٍ يُعرَض بصفره: القائمةُ تقول أيضًا «هذا القسمُ لم يُقيَّد
    // فيه شيء»، وإخفاؤه يُقرأ «هذا القسمُ ليس في السجلّ أصلًا».
    const sectionCounts = {};
    const entityCounts = {};
    for (const p of pairs) {
      if (!p._id.e) continue;
      const s = sectionOf(p._id.e);
      sectionCounts[s] = (sectionCounts[s] || 0) + p.count;
      entityCounts[p._id.e] = (entityCounts[p._id.e] || 0) + p.count;
    }
    const sections = SECTIONS
      .filter((s) => s.key !== 'other' || sectionCounts.other)
      .map((s) => ({ key: s.key, ar: s.ar, en: s.en, count: sectionCounts[s.key] || 0 }));

    // ── الكيانات: كلُّها مع قسمها — الواجهةُ تعرض ما في القسم المختار ──────
    const entities = Object.entries(entityCounts)
      .map(([key, count]) => ({ key, section: sectionOf(key), count, label: entityLabel(key, lang) }))
      .sort((a, b) => b.count - a.count);

    // ── الأفعال: داخل القسم والكيان المختارَين ─────────────────────────────
    const inSection = (e) => {
      if (q.entity) return e === q.entity;
      if (q.section) return sectionOf(e) === q.section;
      return true;
    };
    const actionCounts = {};
    for (const p of pairs) {
      if (!p._id.e || !inSection(p._id.e)) continue;
      const slot = actionCounts[p._id.a] || (actionCounts[p._id.a] = { count: 0, entities: new Set() });
      slot.count += p.count;
      slot.entities.add(p._id.e);
    }
    const actions = Object.entries(actionCounts)
      .map(([key, v]) => ({
        key,
        count: v.count,
        // الفعلُ العامّ («create») يُسمّى مع كيانه متى كان كيانُه واحدًا.
        label: actionLabel(key, v.entities.size === 1 ? [...v.entities][0] : '', lang),
      }))
      .sort((a, b) => b.count - a.count);

    // ── الأشخاص ────────────────────────────────────────────────────────────
    const ids = actorRows.map((r) => r._id).filter(Boolean);
    const live = await User.find({ _id: { $in: ids } }).select('firstName lastName email role branch').lean();
    const liveById = Object.fromEntries(live.map((u) => [String(u._id), u]));
    const users = [];
    let systemCount = 0;
    let unnamedCount = 0;
    for (const r of actorRows) {
      if (!r._id) { systemCount += r.count; continue; }
      const u = liveById[String(r._id)];
      if (!u && !r.name && !r.email) { unnamedCount += r.count; continue; }
      users.push(u
        ? { _id: String(u._id), firstName: u.firstName || '', lastName: u.lastName || '', email: u.email || '', role: u.role, branch: u.branch, count: r.count }
        : { _id: String(r._id), firstName: r.name || r.email, lastName: '', email: r.email || '', deleted: true, count: r.count });
    }
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

    res.json({
      entities, sections, actions, users, branches, systemCount, unnamedCount,
    });
  } catch (error) {
    if (error instanceof FilterError) return res.status(400).json({ message: error.message });
    console.error('audit options error:', error.message);
    res.status(500).json({ message: 'Failed to load audit options' });
  }
};

exports._buildFilter = buildFilter;
