/**
 * مسؤولُ التحصيل الفعليّ — ولا عميلَ «بلا مشرف».
 *
 * ── أين يعيش الإسناد ────────────────────────────────────────────────────────
 * الموظّفُ المسؤولُ عن حسابٍ هو `CollectionsParty.collectionOfficer`: اسمٌ
 * مكتوب («Yasser»، «Hossam»، «Orabi»، «Haitham») يكتبه الاستيرادُ من دفتر
 * التحصيل، وتنقله صفحةُ الفريق (`PUT /ledger/team/assign`) وملفُّ العميل.
 * و`assignedTo` (مرجعٌ إلى مستخدم) و`officer` حقلان قديمان لا يكتبهما أحد —
 * فارغان على الحسابات كلِّها في الإنتاج (٢٠٢٦/١٠/٢١).
 *
 * ── وما لا مسؤولَ له فهو على مدير القسم ─────────────────────────────────────
 * قرارُ صاحب الشركة (٢٠٢٦/١٠/٢١): «لا يكون عميلٌ بلا مشرف — من لم يُسنَد إلى
 * موظّف فهو على مدير التحصيل». فالمسؤولُ الفعليّ:
 *
 *     الموظّفُ المكتوبُ على الحساب إن وُجد، وإلّا مديرُ القسم.
 *
 * ويُشتقّ **ساعةَ القراءة** ولا يُكتب في السجلّات: لو كُتب اسمُ المدير في
 * أربعة آلافِ حسابٍ لصار إسنادًا حقيقيًّا لا يُميَّز من إسنادٍ مقصود، ولبقي
 * اسمُ المدير القديم عليها يومَ يتغيّر المدير. والاشتقاقُ يجعل المديرَ الجديد
 * أو الإسنادَ الجديد ساريًا في الحال (حدُّه ذاكرةُ دقيقة).
 *
 * ── ومَن هو المدير ─────────────────────────────────────────────────────────
 * مستخدمٌ نشطٌ دورُه `collections_manager` **وشخصٌ حقيقيّ**: تُستبعَد حساباتُ
 * الاختبار — بريدٌ ينتهي بـ`.invalid` أو نطاقُه `example.*` (في الإنتاج حسابُ
 * اختبارٍ قديم `zz-ledger-mgr@example.invalid` بجانب المدير الحقيقيّ).
 * وإن كان المديرون الحقيقيّون أكثرَ من واحد:
 *   ١. `COLLECTIONS_MANAGER_EMAIL` في متغيّرات البيئة إن طابق أحدَهم؛
 *   ٢. وإلّا أقدمُهم إنشاءً (`createdAt` ثمّ `_id`) — ثابتٌ لا يتقلّب بين قراءتين.
 * ولا مديرَ أصلًا ⇒ يبقى الحسابُ بلا اسم (ولا يُخترَع أحد).
 */
const cache = require('./ttlCache');

const MGR_KEY = 'cdr:mgr';
const MGR_TTL = 60 * 1000;

/** بريدُ حسابِ اختبارٍ لا شخص. */
const isTestEmail = (email) => {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e.endsWith('.invalid')) return true;
  const domain = e.split('@')[1] || '';
  return /^example\./.test(domain) || /\.example\./.test(`.${domain}`);
};

const fullName = (u) => [u?.firstName, u?.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
  || String(u?.email || '').trim();

/** يختار المديرَ من قائمة مستخدمين — مفصولةٌ ليُختبَر الاختيارُ وحدَه. */
function pickManager(users = [], preferredEmail = process.env.COLLECTIONS_MANAGER_EMAIL) {
  const real = users.filter((u) => u && u.isActive !== false && !isTestEmail(u.email));
  if (!real.length) return null;
  const pref = String(preferredEmail || '').trim().toLowerCase();
  const chosen = (pref && real.find((u) => String(u.email || '').trim().toLowerCase() === pref))
    || [...real].sort((a, b) => (new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      || String(a._id).localeCompare(String(b._id)))[0];
  return { _id: chosen._id, name: fullName(chosen), email: chosen.email || '' };
}

/** مديرُ قسم التحصيل — `{ _id, name, email }` أو `null`. */
async function collectionsManager() {
  return cache.wrap(MGR_KEY, MGR_TTL, async () => {
    const User = require('../models/User');
    const users = await User.find({ role: 'collections_manager', isActive: { $ne: false } })
      .select('firstName lastName email isActive createdAt').lean();
    return pickManager(users);
  });
}

const clean = (v) => String(v == null ? '' : v).trim();

/**
 * ── الإسنادُ مرجعٌ إلى مستخدم، والاسمُ المكتوبُ لقبُه ──────────────────────
 *
 * `CollectionsParty.collectionOfficerUser` هو الإسناد (٢٠٢٦/١٠/٢١)، و`collectionOfficer`
 * يبقى نصًّا للعرض والفلاتر — «Orabi» لقبُ «ahmed orabi» في دفتر التحصيل، ولا
 * يُستبدَل به اسمُه الكامل فتتغيّر الأسماءُ في كلّ لوحةٍ وكلّ رابطٍ محفوظ.
 *
 * فدليلُ الموظّفين: كلُّ مستخدمٍ نشطٍ في القسم (موظّفٌ أو مدير، بلا حسابات
 * الاختبار)، ولقبُه = أكثرُ نصٍّ كُتب على حساباته، وإلّا اسمُه الأوّل.
 */
const DIR_KEY = 'cdr:dir';
const ROLES = ['collections_staff', 'collections_manager'];
const lower = (v) => clean(v).toLowerCase();
const cap = (v) => { const x = clean(v); return x ? x[0].toUpperCase() + x.slice(1) : ''; };

async function officerDirectory() {
  return cache.wrap(DIR_KEY, MGR_TTL, async () => {
    const User = require('../models/User');
    const CollectionsParty = require('../models/CollectionsParty');
    const [users, aliasRows] = await Promise.all([
      User.find({ role: { $in: ROLES }, isActive: { $ne: false } }).select('firstName lastName email role').lean(),
      CollectionsParty.aggregate([
        { $match: { collectionOfficerUser: { $ne: null }, collectionOfficer: { $gt: '' } } },
        { $group: { _id: { u: '$collectionOfficerUser', t: '$collectionOfficer' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);
    const alias = new Map();
    for (const r of aliasRows) { const k = String(r._id.u); if (!alias.has(k)) alias.set(k, r._id.t); }
    return users.filter((u) => !isTestEmail(u.email)).map((u) => ({
      _id: String(u._id), name: fullName(u), email: u.email || '', role: u.role,
      firstName: clean(u.firstName), lastName: clean(u.lastName),
      label: alias.get(String(u._id)) || cap(u.firstName) || fullName(u),
    })).sort((a, b) => a.label.localeCompare(b.label));
  });
}

/**
 * أيُّ مستخدمٍ يعنيه هذا الاسمُ المكتوب؟ لقبُه، أو اسمُه الكامل، أو اسمُه الأوّل
 * أو الأخير **إن لم يشترك فيه اثنان**. والملتبسُ لا يُخمَّن: `null`.
 */
function userForName(name, dir = []) {
  const n = lower(name);
  if (!n) return null;
  const hit = (pred) => { const xs = dir.filter(pred); return xs.length === 1 ? xs[0] : (xs.length > 1 ? 'ambiguous' : null); };
  for (const pred of [
    (u) => lower(u.label) === n,
    (u) => lower(u.name) === n,
    (u) => lower(u.firstName) === n || lower(u.lastName) === n,
  ]) {
    const r = hit(pred);
    if (r === 'ambiguous') return null;
    if (r) return r;
  }
  return null;
}

/** صاحبُ المرجع في الدليل، أو null. */
const userById = (id, dir = []) => (id ? dir.find((u) => u._id === String(id)) || null : null);

/**
 * المسؤولُ الفعليّ: صاحبُ المرجع إن وُجد (بلقبه المكتوب إن كان لقبَه، وإلّا
 * بلقبه في الدليل) — ثمّ الاسمُ المكتوب — ثمّ مديرُ القسم.
 * `ref` و`dir` اختياريّان: من لا يمرّرهما يقرأ النصَّ كما كان.
 */
const effectiveOfficer = (raw, mgr, ref, dir) => {
  const u = userById(ref, dir);
  if (u) {
    const t = clean(raw);
    return t && userForName(t, dir)?._id === u._id ? t : u.label;
  }
  return clean(raw) || (mgr?.name || '');
};
/** أهذا الاسمُ الفعليّ آتٍ من المدير لا من إسنادٍ مكتوب؟ */
const isDefaultOfficer = (raw, ref) => !ref && !clean(raw);

/**
 * يحلّ ما يُرسَل في الإسناد إلى `{ user, text }`: معرّفُ مستخدمٍ من الدليل، أو
 * اسمٌ مكتوب (عملاءُ قديمة) يُطابَق بـ`userForName`. والفراغُ رفعٌ للإسناد.
 * الاسمُ الذي لا يطابق أحدًا يُقبَل نصًّا بلا مرجع — كما كان قبل المرجع.
 */
async function resolveAssignment({ userId, name } = {}) {
  const dir = await officerDirectory();
  const byId = userById(userId, dir);
  if (byId) return { user: byId._id, text: byId.label };
  const t = clean(name);
  if (!t) return { user: null, text: '' };
  const u = userForName(t, dir);
  return { user: u ? u._id : null, text: u ? (lower(u.label) === lower(t) ? u.label : t) : t };
}

/** يُمسَح الدليلُ بعد كلّ إسناد — لقبُ موظّفٍ جديدٍ يظهر في الحال. */
const invalidateDirectory = () => { try { cache.clear(DIR_KEY); } catch (_) { /* */ } };

/**
 * شرطُ `CollectionsParty` لفلترٍ بأسماء المسؤولين الفعليّين.
 * اسمُ المدير يعني حساباتِه المكتوبةَ باسمه **وكلَّ حسابٍ بلا اسم**؛ و`none`
 * (الرابطُ القديم «بلا مسؤول») يُقرأ مديرًا كذلك — فلا يفتح رابطٌ محفوظٌ شيئًا آخر.
 */
function officerCondition(values, mgr, dir) {
  const list = [].concat(values || []).flatMap((v) => String(v || '').split(',')).map(clean).filter(Boolean);
  if (!list.length) return null;
  const mgrName = clean(mgr?.name).toLowerCase();
  const wantsDefault = list.some((v) => v === 'none' || (mgrName && v.toLowerCase() === mgrName));
  const named = list.filter((v) => v !== 'none');
  const or = [];
  if (named.length) or.push({ collectionOfficer: { $in: named } });
  // والمرجعُ يُفلتَر به كذلك: حسابٌ مُسنَدٌ إلى «Orabi» يظهر تحت لقبه ولو كُتب
  // نصُّه بصيغةٍ أخرى. (يمرّر المنادي الدليلَ ليُحسَب هذا؛ وإلّا فالنصُّ وحدَه.)
  const ids = dir ? named.map((n) => userForName(n, dir)?._id).filter(Boolean) : [];
  if (ids.length) {
    const mongoose = require('mongoose');
    or.push({ collectionOfficerUser: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
  }
  // «بلا إسناد» = لا نصَّ ولا مرجع (`null` في Mongo يطابق الغائبَ أيضًا).
  if (wantsDefault) or.push({ collectionOfficer: { $in: ['', null] }, collectionOfficerUser: null });
  return or.length === 1 ? or[0] : { $or: or };
}

/** يضمّ اسمَ المدير إلى قائمة أسماء المسؤولين (لقوائم الفلاتر). */
const withManager = (names, mgr) => {
  const set = new Set((names || []).map(clean).filter(Boolean));
  if (mgr?.name) set.add(mgr.name);
  return [...set].sort((a, b) => a.localeCompare(b));
};

module.exports = {
  collectionsManager, pickManager, isTestEmail, effectiveOfficer, isDefaultOfficer,
  officerCondition, withManager, MGR_KEY,
  officerDirectory, userForName, userById, resolveAssignment, invalidateDirectory, DIR_KEY,
};
