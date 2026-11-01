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

  const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true } }).select('key nameEn nameAr').lean();
  return matchPayingBranch(b.name, rows);
}

/** يطوي الاسمَ العربيّ: التشكيل والتاء المربوطة والألف والمسافات. */
const foldAr = (v) => String(v || '')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, '');

/**
 * ── النقلُ الثقيل فرعٌ كغيره (٢٠٢٦/١٠/٢٦) ─────────────────────────────────
 * «لما المحفظة بتتم كيوزر النقل الثقيل مبيتكتبش الفرع في الفرع المسدد». لم يكن
 * في القائمة المرجعيّة نظيرٌ له، وسجلُّه قد يُكتب «Heavy Trucks» أو «Heavy
 * Transport» أو بالعربيّة — فيُطابَق بأيٍّ منها إلى صفّ `heavy_trucks`.
 */
const isHeavy = (name) => /heavy|fleet/i.test(String(name || ''))
  || foldAr(name).includes('ثقيل') || foldAr(name).includes('اسطول');

/** اسمُ الفرع (إنجليزيًّا أو عربيًّا) → الاسمُ العربيُّ في القائمة، أو ''. */
function matchPayingBranch(branchName, rows) {
  const key = foldEn(branchName);
  const ar = foldAr(branchName);
  const hit = (key && rows.find((r) => foldEn(r.nameEn) === key))
    || (ar && rows.find((r) => foldAr(r.nameAr) === ar))
    || (isHeavy(branchName) && rows.find((r) => r.key === 'heavy_trucks' || isHeavy(r.nameEn) || isHeavy(r.nameAr)));
  return hit?.nameAr || '';
}

// Who pays for heavy transport: their purchases belong to that branch whichever wallet they used.
const HEAVY_RECORDER_ROLES = ['fleet_manager', 'fleet_supervisor', 'location_manager'];

/**
 * Paying branch of one purchase. The recorder's section decides first, then the wallet's
 * branch; a fleet row catches a wallet whose branch record has no match in the list.
 */
function resolvePayingBranch({ branchName, role, workflow }, rows) {
  const heavy = () => matchPayingBranch('Heavy Trucks', rows);
  if (HEAVY_RECORDER_ROLES.includes(role)) return heavy();
  return matchPayingBranch(branchName, rows)
    || (workflow?.fleetShipment || isHeavy(workflow?.branch) ? heavy() : '');
}

/** Same as `resolvePayingBranch`, reading the branch name and the list from the database. */
async function payingBranchOf({ branchId, role, workflow }) {
  const Branch = require('../models/Branch');
  const Lookup = require('../models/Lookup');
  const b = branchId ? await Branch.findById(branchId).select('name').lean() : null;
  const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true } }).select('key nameEn nameAr').lean();
  return resolvePayingBranch({ branchName: b?.name, role, workflow }, rows);
}

module.exports = { arabicBranchName, matchPayingBranch, resolvePayingBranch, payingBranchOf, foldEn, foldAr };
