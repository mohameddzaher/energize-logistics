/**
 * contractStatus: the 'contract status' on the employee file is derived from his contract, not typed.
 * The status was stored in two places with two wordings for one meaning: `Contract.status` (read by the contracts page) and `Employee.contractStatusText` (from the import file). They cannot be filtered or counted together, and they also diverge in meaning (some employees have an active contract and an empty field, or the 'contract ended' text).
 * The contract is the source; the field is a copy updated on every change. The contracts page vocabulary is authoritative (`CONTRACT_STATUS` in lib/hr): active or expired, no third state. A terminated contract is expired; a renewed one is active.
 * The governing contract is one of several: on renewal the old becomes `expired` and the new `active`. The file shows the active one if any, otherwise the latest created, not whatever the database returns first.
 */

/** Contract status mapped to its wording on the contracts page. */
const CONTRACT_STATUS_AR = {
  active: 'ساري',
  expired: 'منتهي',
  // Values not yet reached by the migration (scripts/contractTwoStatuses) are read with the two-status wording.
  terminated: 'منتهي',
  renewed: 'منتهي',
};

/** The status as displayed: only `active` or `expired`; legacy stored values are folded. */
const twoStatus = (s) => (s === 'active' ? 'active' : s ? 'expired' : '');

/**
 * Import-file wordings mapped to the approved ones.
 * The file wrote 'contract ended' and 'not valid', both 'expired', and 'terminated' too now that there are two states. 'Does not exist' stays as is: it is not a contract state but the absence of one.
 */
const NORMALISE = {
  'تم انهاء العقد': 'منتهي',
  'تم إنهاء العقد': 'منتهي',
  'غير ساري': 'منتهي',
  'مفسوخ': 'منتهي',
  'مجدَّد': 'ساري',
  'مجدد': 'ساري',
};

const normaliseContractStatus = (text) => {
  const t = String(text || '').trim();
  return NORMALISE[t] || t;
};

/** Governing contract: the active one, otherwise the latest created. */
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
 * Contract dates and number are a copy of the contract as well.
 * The end date lived in two places: `Contract.endDate` (read by the contracts page and the contracts tab) and `Employee.contractEndDate` (read by the expiries page and master). Only the status was synced, so an employee renewed for a year from the contracts page stayed expired with the old date in expiries, and some with an end date never appeared there because their field was empty.
 * The governing contract is the source and the employee fields are a copy refreshed on every contract write. The reverse is in models/Employee: editing or renewing the field from master is written into the active contract (pushEmployeeContractFields).
 * A contract number is never erased by an empty value: a contract without a number does not clear one on the file.
 */
function mirrorOf(c) {
  const set = { contractStartDate: day(c.startDate), contractEndDate: day(c.endDate) };
  if (String(c.contractNumber || '').trim()) set.qiwaContractNumber = String(c.contractNumber).trim();
  return set;
}

/**
 * Writes the contract status, its two dates and its number onto the employee from the governing contract.
 * Does not touch employees without a contract: their fields came from the import file and are all that is known, and wiping them because the system has no contract would lose information.
 * Uses `updateOne` on purpose: it does not trigger the save hook in models/Employee, so writes do not loop between the two places.
 * @returns {Promise<string|null>} the status wording written, or `null` when nothing was written.
 */
async function syncEmployeeContractStatus(employeeId) {
  if (!employeeId) return null;
  const Employee = require('../models/Employee');
  const c = await governingContract(employeeId);
  if (!c) return null;
  const text = CONTRACT_STATUS_AR[c.status] || c.status || '';
  // An employee with a contract means HR knew of it and wrote his contract (see `hrPending`).
  await Employee.updateOne({ _id: employeeId }, { $set: { contractStatusText: text, hrPending: false, ...mirrorOf(c) } });
  return text;
}

/**
 * The reverse: contract fields edited on the employee (master, renewal, import) are written into his active contract. An employee with no active contract gets none created here: the field remains all that is known.
 * @param {object} fields  only what changed: contractStartDate / contractEndDate / qiwaContractNumber
 */
async function pushEmployeeContractFields(employeeId, fields) {
  if (!employeeId || !fields) return false;
  const Contract = require('../models/Contract');
  const set = {};
  if ('contractEndDate' in fields) set.endDate = day(fields.contractEndDate);
  // Contract start is mandatory on the contract: emptying it on the file does not erase it there.
  if ('contractStartDate' in fields && day(fields.contractStartDate)) set.startDate = day(fields.contractStartDate);
  if ('qiwaContractNumber' in fields) set.contractNumber = String(fields.qiwaContractNumber || '').trim();
  if (!Object.keys(set).length) return false;
  // Active, otherwise expired by lapse: a 'renewal' from the expiries page on a lapsed contract is written into it and makes it active again.
  const target = await Contract.findOne({ employee: employeeId, status: 'active' }).sort({ createdAt: -1 }).select('_id status endDate').lean()
    // A contract ended by termination is not written to: it did not lapse, so a new date does not revive it.
    || await Contract.findOne({ employee: employeeId, status: 'expired', terminatedAt: null }).sort({ createdAt: -1 }).select('_id status endDate').lean();
  if (!target) return false;
  const end = 'endDate' in set ? set.endDate : day(target.endDate);
  set.status = isLapsed(end) ? 'expired' : 'active';
  await Contract.updateOne({ _id: target._id }, { $set: set });
  if (set.status !== target.status) await syncEmployeeContractStatus(employeeId);
  return true;
}

/**
 * A contract whose term has passed is expired.
 * 'Active' used to be set at creation and never changed with time, so contracts past their term stayed active while expiries called them expired. The date decides: past its date is expired, and an extended date returns to active.
 * It runs in three places: on contract save (models/Contract), on writes from the employee file (above), and an hourly pass for contracts that lapse untouched (server).
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

/** Current contract per employee: the active one, otherwise the one expired by lapse. Its terms (salary, leave) remain what the employee is accounted by until renewal; lapse does not zero his finance salary or leave balance. */
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
  CONTRACT_STATUS_AR, twoStatus, NORMALISE, normaliseContractStatus, governingContract, syncEmployeeContractStatus,
  pushEmployeeContractFields, mirrorOf, isLapsed, expireLapsedContracts, currentContractOf, currentContractsByEmployee,
};
