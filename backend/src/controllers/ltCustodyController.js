/**
 * عهدةُ النقل الخفيف — الكاش وكارت المشتريات والورشة. راجع models/LtCustody.
 *
 * الدفترُ نفسُه (القواعدُ والقيودُ والتحويلُ والتصحيح) مكتوبٌ مرّةً في
 * custodyLedgerController ويُبنى منه هنا وفي عهدة النقل الثقيل. وما يخصّ هذه
 * العهدة: مَن يفتحها، وأين يُبحث عن المندوب.
 */
const LtCustodyEntry = require('../models/LtCustody');
const { LightTransportEmployee } = require('../models/LightTransport');
const Employee = require('../models/Employee');
const { makeCustodyController } = require('./custodyLedgerController');
/**
 * ── مَن يفتح العهدةَ ومَن يصحّحها ───────────────────────────────────────────
 * تُفتَح لمدير القطاع ونائبه ومدير النظام وأهلِ المال (المحاسب ومدير الحسابات
 * والمدير الماليّ). وتعديلُ قيدٍ مسجَّلٍ وحذفُه لمدير النظام وأهل المال وحدَهم.
 */
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const CUSTODY_ROLES = ['super_admin', 'b2c_manager', 'b2c_deputy', ...FINANCE_FULL_ROLES];

/**
 * المندوبُ برقم هويّته: من سجلّ النقل الخفيف أوّلًا (فيه الفري لانسر الذين لا
 * ملفَّ لهم في الموارد البشريّة)، ثمّ من الموارد البشريّة بعمودَي الهويّة معًا
 * (راجع identity-number-two-columns). يردّ `null` إن لم يُعرَف.
 */
async function findRep(idNumber) {
  const id = String(idNumber || '').replace(/\s+/g, '').trim();
  if (!id) return null;
  const lt = await LightTransportEmployee.findOne({ idNumber: id })
    .select('idNumber name nationalityAr projectAr jobTitleAr employee').lean();
  const hr = await Employee.findOne(lt && lt.employee ? { _id: lt.employee } : { $or: [{ iqamaNumber: id }, { nationalId: id }] })
    .select('firstName lastName arabicName nationality employeeNumber employmentStatus project department').lean();
  if (!lt && !hr) return null;
  const hrName = hr ? (hr.arabicName || [hr.firstName, hr.lastName].filter(Boolean).join(' ').trim()) : '';
  return {
    idNumber: id,
    name: hrName || (lt && lt.name) || '',
    nationality: (hr && hr.nationality) || (lt && lt.nationalityAr) || '',
    project: (lt && lt.projectAr) || (hr && hr.project) || '',
    jobTitle: (lt && lt.jobTitleAr) || '',
    employeeNumber: (hr && hr.employeeNumber) || '',
    status: (hr && hr.employmentStatus) || '',
    employee: hr ? hr._id : null,
    inHr: !!hr, inLightTransport: !!lt,
  };
}

const ledger = makeCustodyController({
  Model: LtCustodyEntry,
  key: 'lt',
  event: 'lt:custody',
  findRep,
  repMissing: 'لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف',
});

module.exports = {
  ...ledger,
  CUSTODY_ROLES,
  _findRep: findRep,
};
