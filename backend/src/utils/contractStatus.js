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
const GOVERNING_FIELDS = 'status startDate endDate contractNumber type';
async function governingContract(employeeId) {
  const Contract = require('../models/Contract');
  const active = await Contract.findOne({ employee: employeeId, status: 'active' })
    .sort({ createdAt: -1 }).select(GOVERNING_FIELDS).lean();
  if (active) return active;
  return Contract.findOne({ employee: employeeId }).sort({ createdAt: -1 }).select(GOVERNING_FIELDS).lean();
}

const day = (v) => {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, 10);
};

/**
 * ── وتاريخا العقد ورقمُه صورةٌ منه كذلك ─────────────────────────────────────
 *
 * نهايةُ العقد مكتوبةٌ في موضعين: على العقد (`Contract.endDate`) تقرؤه صفحةُ
 * العقود وتبويبُ العقود في ملفّ الموظّف، وعلى الموظّف (`contractEndDate`) تقرؤه
 * صفحةُ الانتهاءات والماستر. وكانت الحالةُ وحدَها تُنقَل بينهما: فمن جُدِّد
 * عقدُه سنةً من صفحة العقود بقي في «الانتهاءات» منتهيًا بتاريخه القديم — تسعةَ
 * عشرَ موظّفًا كانوا كذلك، وسبعةَ عشرَ لهم عقدٌ بنهايةٍ ولا يظهرون في
 * الانتهاءات أصلًا لأنّ خانتَهم فارغة.
 *
 * فالعقدُ الحاكم هو المصدر، وخاناتُ الموظّف صورةٌ منه تُحدَّث مع كلّ كتابةٍ على
 * العقد. والعكسُ في models/Employee: من عدّل الخانةَ أو جدّدها من الماستر كُتب
 * تعديلُه في العقد الساري نفسِه (pushEmployeeContractFields).
 *
 * ورقمُ العقد لا يُمحى بفراغ: عقدٌ لم يُكتب رقمُه لا يمسح رقمًا في الملفّ.
 */
function mirrorOf(c) {
  const set = { contractStartDate: day(c.startDate), contractEndDate: day(c.endDate) };
  if (String(c.contractNumber || '').trim()) set.qiwaContractNumber = String(c.contractNumber).trim();
  return set;
}

/**
 * يكتب «حالة العقد» وتاريخَيه ورقمَه على الموظّف من عقده الحاكم.
 *
 * ولا يمسّ من لا عقدَ له: خاناتُه جاءت من ملفّ الاستيراد وهي كلُّ ما يُعرَف عنه،
 * ومحوُها لأنّنا لا نجد عقدًا في النظام يفقد معلومةً ولا يصحّح شيئًا.
 *
 * يكتب بـ`updateOne` عمدًا: لا يوقظ خطّافَ الحفظ في models/Employee، فلا تدور
 * الكتابةُ بين الموضعين.
 *
 * @returns {Promise<string|null>} لفظُ الحالة المكتوب، أو `null` إن لم يُكتب شيء.
 */
async function syncEmployeeContractStatus(employeeId) {
  if (!employeeId) return null;
  const Employee = require('../models/Employee');
  const c = await governingContract(employeeId);
  if (!c) return null;
  const text = CONTRACT_STATUS_AR[c.status] || c.status || '';
  await Employee.updateOne({ _id: employeeId }, { $set: { contractStatusText: text, ...mirrorOf(c) } });
  return text;
}

/**
 * العكس: خاناتُ العقد عُدِّلت على الموظّف (الماستر، التجديد، الاستيراد) فتُكتب
 * في عقده **الساري**. ومن لا عقدَ سارٍ له لا يُنشأ له عقدٌ هنا ولا يُمَسّ عقدُه
 * المفسوخ: الخانةُ تبقى كلَّ ما يُعرَف.
 *
 * @param {object} fields  ما تغيّر فقط: contractStartDate / contractEndDate / qiwaContractNumber
 */
async function pushEmployeeContractFields(employeeId, fields) {
  if (!employeeId || !fields) return false;
  const Contract = require('../models/Contract');
  const set = {};
  if ('contractEndDate' in fields) set.endDate = day(fields.contractEndDate);
  // بدايةُ العقد إلزاميّةٌ على العقد: فراغُها في الملفّ لا يمحوها هناك.
  if ('contractStartDate' in fields && day(fields.contractStartDate)) set.startDate = day(fields.contractStartDate);
  if ('qiwaContractNumber' in fields) set.contractNumber = String(fields.qiwaContractNumber || '').trim();
  if (!Object.keys(set).length) return false;
  // السارِي، وإلّا المنتهي بمرور مدّته: «تجديدٌ» من صفحة الانتهاءات لعقدٍ انقضى
  // يُكتب فيه ويعيده ساريًا. والمفسوخُ والمجدَّد لا يُمَسّان.
  const target = await Contract.findOne({ employee: employeeId, status: 'active' }).sort({ createdAt: -1 }).select('_id status endDate').lean()
    || await Contract.findOne({ employee: employeeId, status: 'expired' }).sort({ createdAt: -1 }).select('_id status endDate').lean();
  if (!target) return false;
  const end = 'endDate' in set ? set.endDate : day(target.endDate);
  set.status = isLapsed(end) ? 'expired' : 'active';
  await Contract.updateOne({ _id: target._id }, { $set: set });
  if (set.status !== target.status) await syncEmployeeContractStatus(employeeId);
  return true;
}

/**
 * ── والعقدُ الذي انقضت مدّتُه «منتهي» ───────────────────────────────────────
 * «ساري» كانت تُكتب يومَ يُنشأ العقد ولا يغيّرها مرورُ الوقت: خمسةَ عشرَ عقدًا
 * انقضت مدّتُها وبقيت «ساري»، والانتهاءاتُ تقول عنها «منتهي». فالتاريخُ هو
 * الحَكَم: ما عدّى موعدُه منتهٍ، وما مُدَّ موعدُه عاد ساريًا.
 *
 * وهو في ثلاثة مواضع: عند حفظ العقد (models/Contract)، وعند الكتابة من ملفّ
 * الموظّف (أعلاه)، ودورةٌ كلَّ ساعةٍ لما ينقضي وحدَه دون أن يمسّه أحد (server).
 */
const todayKey = () => require('./companyDay').todayKey();
const isLapsed = (endDate) => { const e = day(endDate); return !!e && e < todayKey(); };

async function expireLapsedContracts() {
  const Contract = require('../models/Contract');
  const rows = await Contract.find({ status: 'active', endDate: { $nin: ['', null], $lt: todayKey() } }).select('_id employee').lean();
  if (!rows.length) return 0;
  await Contract.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { status: 'expired' } });
  for (const id of new Set(rows.map((r) => String(r.employee)))) {
    // eslint-disable-next-line no-await-in-loop
    await syncEmployeeContractStatus(id);
  }
  try {
    const cache = require('./ttlCache');
    cache.clear('hrm:'); cache.clear('hr:employees:'); cache.clear('dash:hr:');
    const { emitToAll } = require('../websocket/socketManager');
    for (const ev of ['hr:master', 'hr:employee', 'hr:contract']) emitToAll(ev, {});
  } catch (e) { /* */ }
  return rows.length;
}

/**
 * العقدُ الجاري لكلّ موظّف: السارِي، وإلّا المنتهي بمرور مدّته. شروطُه (الراتب،
 * الإجازة) تبقى ما يُحاسَب عليه الموظّفُ حتى يُجدَّد — انقضاءُ المدّة لا يُصفِّر
 * راتبَه في الماليّة ولا رصيدَ إجازته.
 */
async function currentContractOf(employeeId) {
  const Contract = require('../models/Contract');
  return await Contract.findOne({ employee: employeeId, status: 'active' }).sort({ createdAt: -1 }).lean()
    || Contract.findOne({ employee: employeeId, status: 'expired' }).sort({ createdAt: -1 }).lean();
}
async function currentContractsByEmployee(select = '') {
  const Contract = require('../models/Contract');
  const rows = await Contract.find({ status: { $in: ['active', 'expired'] } }).sort({ createdAt: -1 }).select(`employee status ${select}`).lean();
  const out = new Map();
  for (const c of rows) {
    const k = String(c.employee); const cur = out.get(k);
    if (!cur || (cur.status !== 'active' && c.status === 'active')) out.set(k, c);
  }
  return out;
}

module.exports = {
  CONTRACT_STATUS_AR, NORMALISE, normaliseContractStatus, governingContract, syncEmployeeContractStatus,
  pushEmployeeContractFields, mirrorOf, isLapsed, expireLapsedContracts, currentContractOf, currentContractsByEmployee,
};
