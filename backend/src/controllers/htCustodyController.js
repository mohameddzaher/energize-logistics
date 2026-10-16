/**
 * عهدةُ النقل الثقيل — الكاش وكارت المشتريات والورشة. راجع models/HtCustody.
 *
 * الدفترُ نفسُه دفترُ النقل الخفيف (custodyLedgerController)، ويزيد عليه أنّ
 * الواردَ والصادرَ يُنسبان — اختيارًا — إلى سيّارةٍ من أسطول لوكيشن سوليوشن.
 *
 * والمتحمِّلُ هنا موظّفٌ أو سائقٌ يُعرَف برقم هويّته من الموارد البشريّة وحدَها:
 * سجلُّ النقل الخفيف لمناديب الأفراد، ولا شأنَ له بسائقي الشاحنات.
 */
const HtCustodyEntry = require('../models/HtCustody');
const Employee = require('../models/Employee');
const { makeCustodyController } = require('./custodyLedgerController');
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');

// مديرُ لوكيشن سوليوشن ومديرُ النظام وأهلُ المال — كمدير القطاع في الخفيف.
const CUSTODY_ROLES = ['super_admin', 'location_manager', ...FINANCE_FULL_ROLES];

/** الموظّفُ برقم هويّته — بعمودَي الهويّة معًا (راجع identity-number-two-columns). */
async function findRep(idNumber) {
  const id = String(idNumber || '').replace(/\s+/g, '').trim();
  if (!id) return null;
  const hr = await Employee.findOne({ $or: [{ iqamaNumber: id }, { nationalId: id }] })
    .select('firstName lastName arabicName nationality employeeNumber employmentStatus project department jobTitle').lean();
  if (!hr) return null;
  return {
    idNumber: id,
    name: hr.arabicName || [hr.firstName, hr.lastName].filter(Boolean).join(' ').trim(),
    nationality: hr.nationality || '',
    project: hr.project || hr.department || '',
    jobTitle: hr.jobTitle || '',
    employeeNumber: hr.employeeNumber || '',
    status: hr.employmentStatus || '',
    employee: hr._id,
    inHr: true, inLightTransport: false,
  };
}

const ledger = makeCustodyController({
  Model: HtCustodyEntry,
  key: 'ht',
  event: 'ht:custody',
  findRep,
  repWord: 'الموظف',
  repMissing: 'لا موظّفَ بهذا الرقم في الموارد البشريّة',
  vehicles: true,
});

module.exports = {
  ...ledger,
  CUSTODY_ROLES,
  _findRep: findRep,
};
