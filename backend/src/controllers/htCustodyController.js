/**
 * Heavy-transport custody: cash, purchase card and workshop. See models/HtCustody.
 * Same ledger as light transport (custodyLedgerController), plus entries may optionally link to a vehicle in the Location Solutions fleet.
 * The holder is an employee or driver identified by ID number from HR only, not the light-transport rider register.
 */
const HtCustodyEntry = require('../models/HtCustody');
const Employee = require('../models/Employee');
const { makeCustodyController } = require('./custodyLedgerController');
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');

// Location Solutions manager, system admin and finance roles, like the sector manager in light transport.
const CUSTODY_ROLES = ['super_admin', 'admin', 'location_manager', 'vehicles_manager', ...FINANCE_FULL_ROLES];

/** Employee by ID number, matching both identity columns (see identity-number-two-columns). */
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
