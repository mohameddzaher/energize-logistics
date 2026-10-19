/**
 * hrDepartments — قسمُ الموظّف من القائمة لا من الكتابة.
 *
 * ── القاعدة (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────────────────────────────────
 * القسمُ يُختار من قائمةٍ في كلّ شاشةٍ تكتبه — الماستر، وملفّ الموظّف، والتطبيق —
 * ولا يُكتب بيد. والقائمةُ صفوفُ `Lookup` من نوع `hr_department` يعدّلها السوبر أدمن
 * وحدَه من «البيانات المرجعيّة» (config/lookupTypes ← superOnly).
 *
 * والمخزَّنُ في الملفّ هو الاسمُ العربيّ (`storeLabel`) كما كان منذ الاستيراد —
 * تقرؤه الفلاترُ والتصديراتُ وتقييمُ الأداء والنقلُ الخفيف مباشرةً. فلذلك:
 *   · تغييرُ اسم القسم يُكتب على ملفّات موظّفيه في اللحظة نفسِها (`renamed`)؛
 *   · والقسمُ الذي فيه موظّفون لا يُحذف (`usage`) — وإلّا بقي موظّفوه على اسمٍ
 *     ليس في القائمة.
 */
const cache = require('./ttlCache');

const TYPE = 'hr_department';
const NO_DEPARTMENT = 'بدون قسم';
const CK = 'hrdept:names';

/** أسماءُ الأقسام المعتمدة الآن (العربيّة) — بترتيب القائمة. */
const departmentNames = () => cache.wrap(CK, 30000, async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: TYPE, isActive: true, deleted: { $ne: true } })
    .sort({ order: 1, nameEn: 1 }).select('nameAr').lean();
  return rows.map((r) => String(r.nameAr || '').trim()).filter(Boolean);
});

// وقائمةُ اختيارات الماستر تحمل الأقسامَ أيضًا (hrm:choices).
const forget = () => { try { cache.clear('hrdept:'); cache.clear('hrm:choices'); } catch (_) { /* */ } };

/**
 * رسالةُ رفضٍ إن لم يكن القسمُ من القائمة، وإلّا null.
 * الفارغُ مقبول (لم يُحدَّد بعد). وما كان في الملفّ من قبل ولم يتغيّر لا يُرفض —
 * فحفظُ حقلٍ آخر في ملفٍّ قديمٍ لا يتعطّل بقسمه.
 */
async function departmentError(value, previous) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (previous != null && v === String(previous).trim()) return null;
  const names = await departmentNames();
  if (names.includes(v)) return null;
  return `القسم «${v}» ليس في قائمة الأقسام — اختر من القائمة (يضيف السوبر أدمن الأقسام من البيانات المرجعيّة)`;
}

/** كم ملفًّا على هذا القسم — ومنهم في الأرشيف. */
async function usage(name) {
  const Employee = require('../models/Employee');
  const { ARCHIVED } = require('./hrEngagement');
  const n = String(name || '').trim();
  if (!n) return { total: 0, archived: 0 };
  const [total, archived] = await Promise.all([
    Employee.countDocuments({ department: n }),
    Employee.countDocuments({ department: n, ...ARCHIVED }),
  ]);
  return { total, archived };
}

/** الاسمُ الجديدُ على ملفّات القسم كلِّها، ثمّ تتحدّث الشاشاتُ المفتوحة. */
async function renamed(from, to) {
  forget();
  const a = String(from || '').trim(); const b = String(to || '').trim();
  if (!a || !b || a === b) return { touched: 0 };
  const Employee = require('../models/Employee');
  const r = await Employee.updateMany({ department: a }, { $set: { department: b } });
  for (const p of ['hrm:', 'hr:', 'dash:', 'endedstaff:', 'lt:', 'perf:']) { try { cache.clear(p); } catch (_) { /* */ } }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('hr:master', { departmentRenamed: { from: a, to: b } });
    emitToAll('hr:employee', {});
  } catch (_) { /* */ }
  return { touched: r.modifiedCount || 0 };
}

module.exports = { TYPE, NO_DEPARTMENT, departmentNames, departmentError, usage, renamed, forget };
