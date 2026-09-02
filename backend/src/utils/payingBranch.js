/**
 * الفرعُ المسدِّد — من معرّف الفرع إلى الاسم الذي يُكتب في الكشف.
 *
 * ── لماذا لا يُكتب `Branch.name` مباشرةً ──────────────────────────────────
 * عمودُ «الفرع المسدد» عربيٌّ في أربعةٍ وعشرين ألفَ صفّ: «جده»، «الرياض»،
 * «الدمام». وسجلاتُ الفروع إنجليزيّة: `Jeddah`, `Riyadh`, `Al Dammam`.
 *
 * فكتابةُ اسم السجلّ في العمود تُدخل «Jeddah» إلى جانب «جده» — قيمتان لفرعٍ
 * واحد، تنقسم عليهما كلُّ فلترةٍ وكلُّ تقريرٍ يُقرأ بالفرع، ولا يُلاحَظ إلّا
 * بعد أن يسأل أحدٌ لماذا لا تجمع الأرقام.
 *
 * والقائمةُ المرجعيّة `workflow_paying_branch` هي التي تُملأ منها الخانةُ حين
 * تُختار بيد، وفيها الاسمان معًا. فهي المرجعُ: يُطابَق الإنجليزيُّ ويُكتب
 * العربيُّ — فيتّفق ما تكتبه المحفظةُ مع ما يكتبه الموظّف.
 *
 * ── وما لا يُطابَق لا يُخمَّن ─────────────────────────────────────────────
 * فرعٌ لا نظيرَ له في القائمة يُترك فارغًا. الخانةُ الفارغة تُقرأ «لم يُسجَّل»
 * فتُملأ، أمّا اسمٌ بلغةٍ أخرى فيُقرأ فرعًا آخر ويفسد ما بُني عليه.
 */

/** يطوي الاسمَ الإنجليزيَّ: حالةُ الأحرف، والمسافات، و«Al » التعريف. */
const foldEn = (v) => String(v || '')
  .toLowerCase()
  .replace(/^al[\s-]+/, '')
  .replace(/[^a-z0-9]/g, '');

/**
 * @param {*} branchId معرّفُ الفرع (من العهدة أو الحركة).
 * @returns {Promise<string>} الاسمُ العربيُّ كما يُكتب في العمود، أو '' إن لم يُعرَف.
 */
async function arabicBranchName(branchId) {
  if (!branchId) return '';
  const Branch = require('../models/Branch');
  const Lookup = require('../models/Lookup');

  const b = await Branch.findById(branchId).select('name').lean();
  if (!b?.name) return '';

  const rows = await Lookup.find({ type: 'workflow_paying_branch' }).select('nameEn nameAr').lean();
  const key = foldEn(b.name);
  const hit = rows.find((r) => foldEn(r.nameEn) === key);
  return hit?.nameAr || '';
}

module.exports = { arabicBranchName, foldEn };
