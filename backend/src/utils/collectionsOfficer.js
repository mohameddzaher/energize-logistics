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

/** المسؤولُ الفعليّ لاسمٍ مكتوب: هو نفسُه، أو المديرُ إن كان فارغًا. */
const effectiveOfficer = (raw, mgr) => clean(raw) || (mgr?.name || '');
/** أهذا الاسمُ الفعليّ آتٍ من المدير لا من إسنادٍ مكتوب؟ */
const isDefaultOfficer = (raw) => !clean(raw);

/**
 * شرطُ `CollectionsParty` لفلترٍ بأسماء المسؤولين الفعليّين.
 * اسمُ المدير يعني حساباتِه المكتوبةَ باسمه **وكلَّ حسابٍ بلا اسم**؛ و`none`
 * (الرابطُ القديم «بلا مسؤول») يُقرأ مديرًا كذلك — فلا يفتح رابطٌ محفوظٌ شيئًا آخر.
 */
function officerCondition(values, mgr) {
  const list = [].concat(values || []).flatMap((v) => String(v || '').split(',')).map(clean).filter(Boolean);
  if (!list.length) return null;
  const mgrName = clean(mgr?.name).toLowerCase();
  const wantsDefault = list.some((v) => v === 'none' || (mgrName && v.toLowerCase() === mgrName));
  const named = list.filter((v) => v !== 'none');
  const or = [];
  if (named.length) or.push({ collectionOfficer: { $in: named } });
  if (wantsDefault) or.push({ collectionOfficer: { $in: ['', null] } }, { collectionOfficer: { $exists: false } });
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
};
