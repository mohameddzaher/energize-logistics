/**
 * Light-transport custody: cash, purchase card and workshop. See models/LtCustody.
 * The ledger itself (rules, entries, transfer, correction) is written once in custodyLedgerController and built on here and in heavy-transport custody. This file holds what is specific: who can open it and where a rep is looked up.
 */
const LtCustodyEntry = require('../models/LtCustody');
const { LightTransportEmployee } = require('../models/LightTransport');
const Employee = require('../models/Employee');
const { makeCustodyController } = require('./custodyLedgerController');
/** Who opens the custody and who corrects it: the sector manager, deputy, system admin and finance roles (accountant, accounts manager, finance manager). Editing or deleting a recorded entry is limited to the system admin and finance roles. */
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const CUSTODY_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'vehicles_manager', 'vehicles_team_leader', ...FINANCE_FULL_ROLES];

/** Rep by ID number: first from the light-transport register (which includes freelancers with no HR file), then from HR using both identity columns (see identity-number-two-columns). Returns `null` if unknown. */
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
