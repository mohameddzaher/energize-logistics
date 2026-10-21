/**
 * personRef — مَن هذا الشخصُ في الموارد البشريّة؟ من أيّ قسمٍ جاء السؤال.
 *
 * الشخصُ سجلٌّ واحد (Employee)، وكلُّ قسمٍ يحمل إليه مرجعًا لا نسخة (صاحبُ
 * الشركة، ٢٠٢٦/١٠/٢١: «بيانات الشخص واحدة في كلّ مكان»). وحيث بقيت نسخةٌ من
 * الاسم أو الجوال على صفٍّ في قسمٍ آخر (النقل الخفيف، بطاقة السائق، ورقة
 * التفويض، القائد الفعليّ) فهي لقطةٌ تتبع الملفّ — يكتبها
 * utils/employeeIdentitySync.pushPersonChange عند كلّ حفظٍ في الموارد البشريّة.
 *
 * ── الربط ────────────────────────────────────────────────────────────────────
 * برقم الهويّة أوّلًا، في العمودين معًا (المقيمُ في `iqamaNumber` والسعوديُّ في
 * `nationalId`) — ثمّ بالاسم المطويّ مطابقةً تامّة، ولا يُقبَل اسمٌ يطابق أكثرَ
 * من ملفّ: التخمينُ بين اثنين أسوأُ من «لا أعرف».
 *
 * ── الاسم المعروض ────────────────────────────────────────────────────────────
 * اسمُ الموارد البشريّة يغلب: في الواجهة العربيّة `arabicName` إن كُتب وإلّا
 * الاسمُ الأوّل والأخير، وفي الإنجليزيّة الأوّلُ والأخير. واللقطةُ المخزَّنةُ في
 * الأقسام الأخرى هي الصيغةُ العربيّة (`canonicalName`).
 *
 * قسمٌ جديد: يخزّن `employee: ObjectId` (ومعه رقمُ الهويّة إن لزم) ويحلّه من هنا
 * عند الإنشاء، ويعرض الاسمَ من الملفّ بـ`displayName`، ويسمع `hr:employee`.
 * والمركبةُ كذلك من utils/vehicleRef ويسمع `vreg:updated`.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** طيُّ الاسم للمطابقة: الهمزاتُ والتاءُ المربوطةُ والياءُ، بلا مسافاتٍ ولا رموز. */
const foldName = (x) => S(x)
  .replace(/[أإآٱا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '')
  .toLowerCase();

/** أرقامُ هويّته — العمودان معًا، بلا فراغات. */
const idsOf = (emp) => [...new Set([emp?.iqamaNumber, emp?.nationalId].map((x) => S(x).replace(/\s+/g, '')).filter(Boolean))];

/** رقمُ هويّته الأساسيّ بحسب نوعها. */
const primaryId = (emp) => S(emp?.idType === 'national_id'
  ? (emp?.nationalId || emp?.iqamaNumber) : (emp?.iqamaNumber || emp?.nationalId)).replace(/\s+/g, '');

/** الاسمُ كما يُعرض — `lang` = 'ar' | 'en'. */
function displayName(emp, lang = 'ar') {
  if (!emp) return '';
  const fl = S(`${S(emp.firstName)} ${S(emp.lastName)}`).replace(/\s+/g, ' ');
  if (lang === 'en') return fl || S(emp.arabicName) || S(emp.fullName);
  return S(emp.arabicName) || fl || S(emp.fullName);
}

/** الاسمُ الذي تُكتب به اللقطاتُ في الأقسام الأخرى. */
const canonicalName = (emp) => displayName(emp, 'ar');

const SELECT = 'firstName lastName arabicName iqamaNumber nationalId idType phone nationality project department employmentStatus isHrRecord vehiclePlate';
// ملفُّ الموارد البشريّة الساري أوّلًا، ثمّ القائمُ على رأس عمله.
const rank = (e) => (e.isHrRecord !== false ? 2 : 0) + (e.employmentStatus !== 'terminated' ? 1 : 0);

/** الموظّفُ برقم هويّته (العمودان معًا) — أو null. */
async function byIdNumber(id, select = SELECT) {
  const n = S(id).replace(/\s+/g, '');
  if (!n) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] }).select(`${select} isHrRecord employmentStatus`).lean();
  if (!rows.length) return null;
  return rows.sort((a, b) => rank(b) - rank(a))[0];
}

/** الموظّفُ بالاسم المطويّ مطابقةً تامّة — ولا يُقبَل إلّا ملفٌّ واحد. */
async function byExactName(name, select = SELECT) {
  const want = foldName(name);
  if (!want) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ isHrRecord: { $ne: false } }).select(`${select} fullName`).lean();
  const hits = rows.filter((e) => [e.arabicName, `${S(e.firstName)} ${S(e.lastName)}`, e.fullName].some((n) => n && foldName(n) === want));
  return hits.length === 1 ? hits[0] : null;
}

/** بابُ الربط الواحد: { idNumber, name } ← ملفُّ الموارد البشريّة أو null. */
async function resolve({ idNumber, name } = {}, select = SELECT) {
  return (await byIdNumber(idNumber, select)) || (S(idNumber) ? null : await byExactName(name, select));
}

/** حلٌّ دفعةً واحدة برقم الهويّة: Map من الرقم إلى الملفّ. */
async function resolveManyByIds(ids, select = SELECT) {
  const want = [...new Set((ids || []).map((x) => S(x).replace(/\s+/g, '')).filter(Boolean))];
  if (!want.length) return new Map();
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: { $in: want } }, { nationalId: { $in: want } }] })
    .select(`${select} isHrRecord employmentStatus`).lean();
  const out = new Map();
  for (const e of rows.sort((a, b) => rank(b) - rank(a))) {
    for (const k of idsOf(e)) if (want.includes(k) && !out.has(k)) out.set(k, e);
  }
  return out;
}

module.exports = {
  S, foldName, idsOf, primaryId, displayName, canonicalName, byIdNumber, byExactName, resolve, resolveManyByIds, rank,
};
