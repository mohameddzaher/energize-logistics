/**
 * endedStaff — مَن انتهت خدمتُه، من ملفّه في الموارد البشريّة.
 *
 * ── القاعدة (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────────────────────────────────
 * الموارد البشريّة وحدَها تكتب حالةَ العمل وإنهاءَ الخدمة. ولوحتُها تعرض
 * المنتهين في كارتهم — ذاك عملُها. أمّا لوحاتُ الأقسام الأخرى فلا تعدّ إلّا مَن
 * هو على رأس العمل: السائقون والمناديب وحمَلةُ التفاويض والفِرَق.
 *
 * ── ولماذا ثلاثُ مجموعات ───────────────────────────────────────────────────
 * سجلّاتُ الأقسام لا ترتبط بالملفّ بطريقةٍ واحدة:
 *   · بمرجعٍ إلى الملفّ (`employee`)            ← `ids`
 *   · برقم الهويّة وحدَه (سائقو الأسطول، المفوَّضون) ← `idNumbers` (العمودان معًا:
 *     iqamaNumber و nationalId — راجع identity-number-two-columns)
 *   · بحساب الدخول (`User.linkedEmployee`)     ← `userIds` (الفِرَقُ المبنيّةُ من الحسابات)
 *
 * تُقرأ مرّةً وتُحفَظ ثلاثين ثانية: لوحاتٌ كثيرةٌ تسأل في الطلب نفسِه.
 */
const cache = require('./ttlCache');

const TTL = 30000;

async function load() {
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const ended = await Employee.find({ employmentStatus: 'terminated' })
    .select('_id iqamaNumber nationalId').lean();
  const ids = new Set(ended.map((e) => String(e._id)));
  const idNumbers = new Set();
  for (const e of ended) {
    for (const n of [e.iqamaNumber, e.nationalId]) {
      const k = String(n || '').replace(/\s+/g, '');
      if (k) idNumbers.add(k);
    }
  }
  const users = ids.size
    ? await User.find({ linkedEmployee: { $in: [...ids] } }).select('_id').lean()
    : [];
  /**
   * ── والأرشيفُ أشدّ: كأنّه حُذف ──────────────────────────────────────────
   * المنتهي لا يُعَدّ في اللوحات ويبقى في القوائم للمراجعة. والمؤرشَفُ (انتهت
   * خدمتُه وخرج من النظام، أو فريلانسرٌ منتهٍ) لا يظهر في أيّ صفحةٍ ولا قائمةٍ ولا
   * منسدلة — إلّا صفحةَ الأرشيف (صاحبُ الشركة، ٢٠٢٦/١٠/١٩). راجع utils/hrEngagement.
   */
  const { ARCHIVED } = require('./hrEngagement');
  const arch = await Employee.find(ARCHIVED).select('_id iqamaNumber nationalId').lean();
  const archivedIds = new Set(arch.map((e) => String(e._id)));
  const archivedIdNumbers = new Set();
  for (const e of arch) for (const n of [e.iqamaNumber, e.nationalId]) { const k = String(n || '').replace(/\s+/g, ''); if (k) archivedIdNumbers.add(k); }
  const archivedUsers = archivedIds.size ? await User.find({ linkedEmployee: { $in: [...archivedIds] } }).select('_id').lean() : [];
  return {
    ids, idNumbers, userIds: new Set(users.map((u) => String(u._id))),
    archivedIds, archivedIdNumbers, archivedUserIds: new Set(archivedUsers.map((u) => String(u._id))),
  };
}

/** { ids, idNumbers, userIds } — مجموعاتٌ من النصوص. */
const endedStaff = () => cache.wrap('endedstaff:all', TTL, load);

/** رقمُ هويّةٍ لمنتهٍ؟ (يُطبَّع بلا مسافات) */
const idNumberEnded = (sets, n) => !!n && sets.idNumbers.has(String(n).replace(/\s+/g, ''));
/** مرجعُ ملفٍّ لمنتهٍ؟ يقبل المعرِّفَ أو الوثيقةَ المأهولة. */
const employeeEnded = (sets, ref) => {
  if (!ref) return false;
  if (typeof ref === 'object' && ref.employmentStatus) return ref.employmentStatus === 'terminated';
  return sets.ids.has(String(ref._id || ref));
};
/** حسابُ دخولٍ مربوطٌ بملفّ منتهٍ؟ */
const userEnded = (sets, user) => !!user && sets.userIds.has(String(user._id || user));

/** مؤرشَف؟ بمرجع الملفّ (أو الوثيقة المأهولة) أو برقم الهويّة. */
// بالمعرِّف دائمًا: الوثيقةُ المأهولة قد لا تحمل الحقولَ التي يُعرَف بها الأرشيف.
const employeeArchived = (sets, ref) => !!ref && sets.archivedIds.has(String(ref._id || ref));
const idNumberArchived = (sets, n) => !!n && sets.archivedIdNumbers.has(String(n).replace(/\s+/g, ''));
const userArchived = (sets, user) => !!user && sets.archivedUserIds.has(String(user._id || user));
/** شرطُ استعلامٍ يُسقط المؤرشَفين من مجموعةٍ تحمل مرجعَ الملفّ في `field`. */
const notArchivedRef = (sets, field = 'employee') => ({ [field]: { $nin: [...sets.archivedIds].map((x) => new (require('mongoose').Types.ObjectId)(x)) } });

module.exports = { endedStaff, idNumberEnded, employeeEnded, userEnded, employeeArchived, idNumberArchived, userArchived, notArchivedRef };
