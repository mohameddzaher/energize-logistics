/**
 * contractStatus — «حالة العقد» في ملفّ الموظّف تُشتقّ من عقده، لا تُكتب بيد.
 *
 * ── المفردتان اللتان كانتا لشيءٍ واحد ──────────────────────────────────────
 * الحالةُ مكتوبةٌ في موضعين: على العقد نفسِه (`Contract.status`) تقرؤه صفحةُ
 * العقود فتقول «مفسوخ»، وعلى الموظّف نصًّا (`Employee.contractStatusText`)
 * جاء من ملفّ الاستيراد فيقول «تم انهاء العقد». والمعنى واحد واللفظُ لفظان،
 * فلا يُفلتَر عليهما معًا ولا يُعَدّان واحدًا — سبعةَ عشرَ موظّفًا كانوا كذلك.
 *
 * وأسوأُ منه أنّهما يفترقان في المعنى أيضًا: أربعةٌ عقدُهم سارٍ وخانتُهم فارغة،
 * وواحدٌ عقدُه سارٍ وخانتُه تقول «تم انهاء العقد».
 *
 * فالعقدُ هو المصدر — هو المستند، والخانةُ صورةٌ منه تُحدَّث كلّما تغيّر. ومفرداتُ
 * صفحة العقود هي المعتمدة (`CONTRACT_STATUS` في lib/hr): ساري · منتهي · مفسوخ.
 *
 * ── والعقدُ الحاكم واحدٌ من عدّة ────────────────────────────────────────────
 * للموظّف عقودٌ متتابعة: يُجدَّد فيصير القديمُ `renewed` والجديدُ `active`. فما
 * يُقرأ في ملفّه هو السارِي إن وُجد، وإلّا فآخرُ ما أُنشئ — لا أوّلُ ما تجده
 * قاعدةُ البيانات.
 */

/** حالةُ العقد ← لفظُها في صفحة العقود. */
const CONTRACT_STATUS_AR = {
  active: 'ساري',
  expired: 'منتهي',
  terminated: 'مفسوخ',
  renewed: 'مجدَّد',
};

/**
 * ألفاظُ ملفّ الاستيراد ← الألفاظ المعتمدة.
 *
 * الملفُّ كتب «تم انهاء العقد» و«غير ساري»، وهما «مفسوخ» و«منتهي» بعينهما.
 * ويبقى «لا يوجد» كما هو: ليس حالةَ عقدٍ بل نفيُ وجوده.
 */
const NORMALISE = {
  'تم انهاء العقد': 'مفسوخ',
  'تم إنهاء العقد': 'مفسوخ',
  'غير ساري': 'منتهي',
};

const normaliseContractStatus = (text) => {
  const t = String(text || '').trim();
  return NORMALISE[t] || t;
};

/** العقدُ الحاكم: السارِي، وإلّا آخرُ ما أُنشئ. */
async function governingContract(employeeId) {
  const Contract = require('../models/Contract');
  const active = await Contract.findOne({ employee: employeeId, status: 'active' })
    .sort({ createdAt: -1 }).select('status').lean();
  if (active) return active;
  return Contract.findOne({ employee: employeeId }).sort({ createdAt: -1 }).select('status').lean();
}

/**
 * يكتب «حالة العقد» على الموظّف من عقده الحاكم.
 *
 * ولا يمسّ من لا عقدَ له: خانتُه جاءت من ملفّ الاستيراد وهي كلُّ ما يُعرَف عنه،
 * ومحوُها لأنّنا لا نجد عقدًا في النظام يفقد معلومةً ولا يصحّح شيئًا.
 *
 * @returns {Promise<string|null>} اللفظُ المكتوب، أو `null` إن لم يُكتب شيء.
 */
async function syncEmployeeContractStatus(employeeId) {
  if (!employeeId) return null;
  const Employee = require('../models/Employee');
  const c = await governingContract(employeeId);
  if (!c) return null;
  const text = CONTRACT_STATUS_AR[c.status] || c.status || '';
  await Employee.updateOne({ _id: employeeId }, { $set: { contractStatusText: text } });
  return text;
}

module.exports = {
  CONTRACT_STATUS_AR, NORMALISE, normaliseContractStatus, governingContract, syncEmployeeContractStatus,
};
