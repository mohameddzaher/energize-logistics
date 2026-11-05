const mongoose = require('mongoose');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Contract = require('../models/Contract');
// Employee contract status mirrors the contract and is refreshed on every change. See utils/contractStatus.
const { syncEmployeeContractStatus, twoStatus } = require('../utils/contractStatus');
// A contract is either active or expired; unmigrated legacy values are read that way before output.
const asTwo = (c) => (c ? { ...c, status: twoStatus(c.status) } : c);
const LeaveType = require('../models/LeaveType');
const LeaveRequest = require('../models/LeaveRequest');
const HRRequest = require('../models/HRRequest');
const Asset = require('../models/Asset');
const CompanyLicense = require('../models/CompanyLicense');
const EmployeeDocument = require('../models/EmployeeDocument');
const EmployeeRenewal = require('../models/EmployeeRenewal');
const AuditLog = require('../models/AuditLog');
const logAudit = require('../utils/auditLogger');
const { cappedFind, askedLimit, CAP_NOTE_AR } = require('../utils/capped');
const { saveEmployeeFile, deleteStoredFile } = require('../utils/fileStore');
const { createNotification } = require('../services/notificationService');
const { emitToUser, emitToAll } = require('../websocket/socketManager');
const { computeBalance, leaveDays, leaveDaysOf, fridayRuleOf, leaveDeducts } = require('../utils/leaveBalance');
// A period of Fridays only holds no leave day (Friday is the weekly day off).
const NO_WORKDAY = 'الفترة المختارة كلها أيام جمعة (إجازة أسبوعية) — لا تُحسب إجازة';
const chain = require('../utils/leaveChain');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const HR_STAFF_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'];
const isHRStaff = (user) => HR_STAFF_ROLES.includes(user.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const hrStaffReq = (req) => isHRStaff(req.user) || grantedBySection(req);
const denyNonStaff = (req, res) => {
  if (!hrStaffReq(req)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return true;
  }
  return false;
};

// Employee work status follows approved leaves (see utils/leaveReturn).
const syncLeaveStatus = (employeeId) => require('../utils/leaveReturn').syncEmployee(employeeId)
  .catch((e) => console.error('[leave-sync]', String(employeeId), e.message));

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

/**
 * Invalidate employee caches after any employee write.
 * Three screens read the same employee from three caches (hr:employees:, dash:hr:, hrm:), and writes cleared none, so edits reappeared stale for up to a minute. Also broadcast hr:master, since master pages do not hear hr:employee; this matches emit() in hrMasterController.
 */
// Exported so writers outside this controller (light transport register) clear the same caches and emit the same events.
exports._bustEmployeeCaches = () => bustEmployeeCaches();
const bustEmployeeCaches = () => {
  try {
    const cache = require('../utils/ttlCache');
    cache.clear('hr:employees:');
    cache.clear('dash:hr:');
    cache.clear('hrm:');
    // Fleet reads the driver name and status from this file (utils/fleetIdentity).
    cache.clear('fleet:');
    // The B2C register, every dashboard and the ended-staff rule read the file too, so an edit shows there at once.
    cache.clear('lt:');
    cache.clear('dash:');
    cache.clear('endedstaff:');
  } catch (e) {}
  // All three events: expiries and master hear hr:master, the employee file and list hear hr:employee, the contracts page hears hr:contract. One write changes what all three show.
  for (const ev of ['hr:master', 'hr:employee', 'hr:contract']) { try { emitToAll(ev, {}); } catch (e) {} }
};

// All active HR back-office users — the reviewers/recipients for HR events.
// The FULL_ACCESS roles (IT) see the same pages, so they get the same realtime
// refreshes; leaving them out kept their screens stale until manual reload.
const { FULL_ACCESS_ROLES } = require('../config/constants');
// Archived staff disappear from every list here, except when their file is opened from the archive.
const { endedStaff, notArchivedRef, notArchivedUserRef, andAll, withoutArchivedRef } = require('../utils/archivedHidden');
const hrStaffIds = async () => {
  const roles = [...new Set([...HR_STAFF_ROLES, ...FULL_ACCESS_ROLES])];
  const staff = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
  return staff.map((s) => s._id);
};

// Notify every HR staff member + emit a realtime event to each of them.
/**
 * A screen refresh is not news.
 * notifyHR both stores a bell notification and fires the live event. Doing both for every employee change flooded the bell (about 92% was bookkeeping events: document added/removed, employee updated), burying real notices. Those events are already in the audit log (logAudit) and the History tab.
 * So: notifyHR for what needs attention, refreshHR for the live event only, with no bell row.
 */
const refreshHR = async ({ relatedEntityId, event }) => {
  if (!event) return;
  const ids = await hrStaffIds();
  ids.forEach((rid) => { try { emitToUser(String(rid), event, { id: String(relatedEntityId || '') }); } catch (e) {} });
};

const notifyHR = async ({ title, message, relatedEntity, relatedEntityId, event }) => {
  // One row per department, not per employee: the old per-user fan-out used a hand-written role list, so new HR roles got nothing. The notice goes to the department and everyone granted HR sees it.
  const { notifySection } = require('../services/notificationService');
  await notifySection('HR', { title, message, relatedEntity, relatedEntityId }).catch(() => {});
  // The live event still goes to anyone with an open screen.
  if (event) {
    const ids = await hrStaffIds();
    ids.forEach((rid) => { try { emitToUser(String(rid), event, { id: String(relatedEntityId || '') }); } catch (e) {} });
  }
};

/** Notify the owners of a leave-chain stage (accounting or top management); otherwise a request reaches a stage nobody knows about and stalls. */
const notifyRoles = async (roles, { title, message, relatedEntity, relatedEntityId, event }) => {
  if (!roles || !roles.length) return;
  const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
  await Promise.all(users.map((u) =>
    createNotification({ recipient: u._id, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {})));
  if (event) users.forEach((u) => { try { emitToUser(String(u._id), event, { id: String(relatedEntityId || '') }); } catch (e) {} });
};

/** The top management accounts (User.isTopManagement), who sign the last leave stage. */
const notifyTopManagement = async ({ title, message, relatedEntity, relatedEntityId, event }) => {
  const users = await User.find({ isTopManagement: true, isActive: true }).select('_id').lean();
  await Promise.all(users.map((u) =>
    createNotification({ recipient: u._id, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {})));
  users.forEach((u) => { try { emitToUser(String(u._id), event || 'hr:leave', { id: String(relatedEntityId || '') }); } catch (e) {} });
};

/** The chairman account(s) (User.isChairman), who sign the final leave stage. */
const notifyChairman = async ({ title, message, relatedEntity, relatedEntityId, event }) => {
  const users = await User.find({ isChairman: true, isActive: true }).select('_id').lean();
  await Promise.all(users.map((u) =>
    createNotification({ recipient: u._id, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {})));
  users.forEach((u) => { try { emitToUser(String(u._id), event || 'hr:leave', { id: String(relatedEntityId || '') }); } catch (e) {} });
};

/** Tells the owners of `stage` that a request now waits on them; one place, so a stage added to the chain is announced everywhere it can be reached from. */
const notifyStage = async (stage, leave, message) => {
  const ref = { relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' };
  const title = `إجازة تنتظر ${chain.STAGE_AR[stage] || ''}`.trim();
  if (stage === 'manager' && leave.manager) return notifyUser(leave.manager, { title: 'إجازة تنتظر موافقتك', message, ...ref });
  if (stage === 'finance') return notifyRoles(chain.FINANCE_ROLES, { title, message, ...ref });
  if (stage === 'hr') return notifyHR({ title, message, ...ref });
  if (stage === 'executive') return notifyTopManagement({ title, message, ...ref });
  if (stage === 'chairman') return notifyChairman({ title, message, ...ref });
  return null;
};

/** A leave changed: everyone whose screens or counters it touches hears it — its owner, the manager who filed or reviews it, HR staff and top management. */
const announceLeave = async (leave) => {
  // Clear what the listeners re-read first: the HR dashboard and master count open leaves and balances.
  try { const cache = require('../utils/ttlCache'); cache.clear('dash:hr:'); cache.clear('hrm:'); } catch (e) { /* */ }
  const ids = new Set();
  for (const k of ['manager', 'requester', 'filedBy']) if (leave && leave[k]) ids.add(String(leave[k]._id || leave[k]));
  try { for (const id of await hrStaffIds()) ids.add(String(id)); } catch (e) { /* */ }
  try {
    const others = await User.find({ isActive: true, $or: [{ isTopManagement: true }, { isChairman: true }, { role: { $in: chain.FINANCE_ROLES } }] }).select('_id').lean();
    for (const u of others) ids.add(String(u._id));
  } catch (e) { /* */ }
  for (const id of ids) { try { emitToUser(id, 'hr:leave', { id: String(leave && leave._id || '') }); } catch (e) { /* */ } }
};

const notifyUser = async (userId, { title, message, relatedEntity, relatedEntityId, event }) => {
  if (!userId) return;
  await createNotification({ recipient: userId, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {});
  if (event) { try { emitToUser(String(userId), event, { id: String(relatedEntityId || '') }); } catch (e) {} }
};

// Active contract, else one expired by time: expiry does not zero the leave balance.
const getActiveContract = (employeeId) => require('../utils/contractStatus').currentContractOf(employeeId);

// Lazily provision + link an employee profile for the current login. See the
// shared util for details. Used so any staff login (incl. the demo super admin)
// can use HR self-service without HR registering them first.
const ensureSelfEmployeeUtil = require('../utils/ensureSelfEmployee');
const { saveUploadFile } = require('../utils/fileStore');
const { grantedBySection } = require('../utils/sectionAccess');
const ensureSelfEmployee = (req) => ensureSelfEmployeeUtil(req.user);

// Live leave balance for an employee: active contract + sum of approved,
// balance-affecting leave → progressive accrual maths.
const computeEmployeeBalance = async (employeeId, asOf = new Date()) => {
  const contract = await getActiveContract(employeeId);
  // The balance counts from the work start date, not the contract date, since a contract can be signed weeks before or after starting. See utils/leaveBalance.
  const [emp, contractCount] = await Promise.all([
    Employee.findById(employeeId).select('actualWorkStartDate').lean(),
    Contract.countDocuments({ employee: employeeId }),
  ]);
  const accrualOpts = { workStartDate: emp?.actualWorkStartDate || '', contracts: contractCount };
  // Days taken count from the start of the active contract: earlier usage was settled there and the remainder is carried in carriedOverDays. Counting it again would deduct twice.
  const takenFilter = { employee: employeeId, status: 'approved' };
  if (contract && contract.startDate) takenFilter.startDate = { $gte: contract.startDate };
  const approved = await LeaveRequest.find(takenFilter)
    .populate('leaveType', 'affectsBalance')
    .select('days leaveType deductsBalance')
    .lean();
  // HR's choice on the request decides; older records follow the leave type (utils/leaveBalance.leaveDeducts).
  const taken = approved.reduce((s, l) => s + (leaveDeducts(l) ? (l.days || 0) : 0), 0);
  return { contract, balance: computeBalance(contract, taken, asOf, accrualOpts) };
};

// ── Employees ─────────────────────────────────────────────────────────────────
exports.listEmployees = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, status } = req.query;
    // Advanced filters (nationality, department, branch, date range, ...) use the HR dashboard's own filter language, so web and app behave the same. Scope stays all records unless the caller asks otherwise, so no names vanish from the list.
    const master = require('./hrMasterController');
    const filter = master._buildFilter({ scope: 'all', ...req.query });
    if (status) filter.employmentStatus = status;
    if (q && q.trim()) {
      // Fold Arabic letter variants so searches match (alef and hamza forms, ha and ta marbuta); literal matching reported existing employees as missing.
      const rx = require('../utils/arabicSearch').arabicSearchRegex(q);
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { arabicName: rx },
        { iqamaNumber: rx }, { nationalId: rx }, { employeeNumber: rx },
        { passportNumber: rx }, { phone: rx }, { email: rx },
        { jobTitle: rx }, { iqamaProfession: rx }, { department: rx },
        { nationality: rx }, { workLocation: rx }, { branchName: rx },
        { licenseNumber: rx }, { driverCardNumber: rx }, { workCard: rx },
      ];
    }
    // List/table view needs ~20 of the 74 employee fields — projecting cuts the
    // BSON deserialization + payload ~3x (the profile screen fetches the full
    // doc separately via getEmployee). And because the whole office loads this
    // same list concurrently, a 30s cache collapses that into one query set;
    // writes (create/update/terminate/renew) clear it so edits show immediately.
    const cache = require('../utils/ttlCache');
    const cacheKey = `hr:employees:${JSON.stringify(req.query || {})}`;
    // Cache validity is keyed by a change stamp, not 30 seconds: the list is 380 KB and slow to send. It is served while the employees, users and branches stamp is unchanged. See utils/changeStamp.
    const rows = await require('../utils/changeStamp').freshWrap(cacheKey, 5 * 60 * 1000,
      [Employee, User, require('../models/Branch')], () => Employee.find(filter)
      // All date fields must be projected because the range predicate runs after fetch; an unfetched field looks undated and silently drops out of every range. They are taken from their source, not hand-listed, so a newly filterable date is not forgotten.
      .select(['firstName lastName arabicName employeeNumber jobTitle department employmentStatus leaveStatusSource leaveViolation workStatusText terminationKind',
        'phone email iqamaNumber nationalId nationality photo workLocation branchName',
        'project branch directManager user createdAt createdVia b2cOpStatus',
        ...master._DATE_FILTERABLE].join(' '))
      .populate('user', 'firstName lastName email role')
      .populate('directManager', 'firstName lastName email')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean());
    // Date range applies after fetch: these fields are strings that carry administrative words beside the date, so a DB comparison would mix types.
    const pred = master._dateRangePred(req.query);
    const employees = pred ? rows.filter(pred) : rows;
    // Count of files created from the individuals department, shown on the new-employees button.
    const fromB2c = await Employee.countDocuments({ isHrRecord: { $ne: false }, createdVia: 'b2c', hrPending: true });
    res.json({ employees, fromB2c });
  } catch (error) {
    console.error('listEmployees error:', error);
    res.status(500).json({ message: 'Failed to load employees' });
  }
};

// Lightweight search used by the Add-User dialog to link a login to an employee.
exports.searchEmployees = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q } = req.query;
    const filter = {};
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { arabicName: rx },
        { iqamaNumber: rx }, { nationalId: rx }, { employeeNumber: rx },
      ];
    }
    // The limit is opt-in. 25 suffices for typeahead but not for a dropdown that searches in the browser, which needs all names. Only seven fields are projected, so 400 rows are lighter than 20 full documents.
    const asked = Number(req.query.limit);
    const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 2000) : 25;
    // Archived people are not linked to an account or shown in dropdowns, as if deleted.
    const employees = await Employee.find(require('../utils/hrEngagement').withoutArchived(filter))
      .select('firstName lastName arabicName iqamaNumber nationalId employeeNumber jobTitle department user employmentStatus')
      .sort({ firstName: 1 })
      .limit(limit)
      .lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to search employees' });
  }
};

// Full profile aggregate: details + contracts + leaves + assets + requests + live balance.
exports.getEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

    const employee = await Employee.findById(id)
      .populate('user', 'firstName lastName email role isActive')
      .populate('directManager', 'firstName lastName email')
      .populate('branch', 'name')
      .lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    // Self-service users may only read their OWN profile via this route.
    if (!hrStaffReq(req) && String(employee.user?._id || employee.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const [contracts, leaves, assets, requests, documents, renewals, balanceData] = await Promise.all([
      Contract.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color affectsBalance').sort({ createdAt: -1 }).limit(200).lean(),
      // `status: { $ne: 'in_stock' }` is belt-and-braces — a store item has
      // employee: null so it cannot match this query anyway.
      Asset.find({ employee: id, status: { $ne: 'in_stock' } }).sort({ createdAt: -1 }).lean(),
      HRRequest.find({ employee: id }).sort({ createdAt: -1 }).limit(100).lean(),
      EmployeeDocument.find({ employee: id }).populate('uploadedBy', 'firstName lastName').sort({ createdAt: -1 }).lean(),
      EmployeeRenewal.find({ employee: id }).populate('renewedBy', 'firstName lastName').sort({ renewedAt: -1 }).limit(200).lean(),
      computeEmployeeBalance(id),
    ]);

    res.json({
      employee,
      contracts: contracts.map(asTwo),
      activeContract: balanceData.contract || null,
      balance: balanceData.balance,
      leaves,
      assets,
      requests,
      documents,
      renewals,
    });
  } catch (error) {
    console.error('getEmployee error:', error);
    res.status(500).json({ message: 'Failed to load employee' });
  }
};

// Field state is chosen on the form: the required, not-required, none and inactive states are decisions on an empty field; clear removes the flag so the state is read from the value. See EmployeeFormModal.
const MARKS = new Set(['required', 'not_required', 'none', 'inactive', 'cash_payroll']);
function applyMarks(employee, marks) {
  if (!marks || typeof marks !== 'object') return;
  const H = require('../config/hrFields');
  if (!employee.fieldStatus || typeof employee.fieldStatus.set !== 'function') employee.fieldStatus = new Map();
  for (const [k, code] of Object.entries(marks)) {
    if (!H.getField(k)) continue;
    const sk = H.statusKeyOf(k);
    if (code === 'clear' || code === '') employee.fieldStatus.delete(sk);
    else if (MARKS.has(code)) employee.fieldStatus.set(sk, code);
  }
}

exports.createEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // An empty field means absent, not a value. The form sends every field, mostly empty, and '' is not a valid id, date or enum choice, which made optional blanks reject the whole form.
    const body = { ...stripEmpty(req.body, Employee.schema), createdBy: req.user._id };
    // Department, nationality, city and project come only from their lists. See utils/hrLists.
    const listErr = await require('../utils/hrLists').bodyError(body)
      || await require('../utils/hrLists').categoryError(body.department, body.staffCategory);
    if (listErr) return res.status(400).json({ message: listErr });
    delete body.user; // linking is done from the Users screen, not here
    delete body.vehiclePlate; // Snapshot from the vehicle register; written only by the authorization flow.
    delete body.markStatus;
    const employee = new Employee(body);
    applyMarks(employee, req.body.markStatus);
    await employee.save();
    bustEmployeeCaches();
    // Someone whose department is light transport enters that department's register. A person is registered once; asking twice gets forgotten. See utils/lightTransportSync.
    const { syncEmployeeToLightTransport } = require('../utils/lightTransportSync');
    const ltSync = await syncEmployeeToLightTransport(employee, req.user);
    if (ltSync) { try { emitToAll('lt:updated', {}); } catch (e) { /* */ } }
    await logAudit({ user: req.user._id, action: 'create_employee', entity: 'Employee', entityId: employee._id, changes: { after: { name: fullName(employee), ...(ltSync ? { lightTransport: ltSync } : {}) } }, ipAddress: req.ip });
    try { emitToUser(String(req.user._id), 'hr:employee', { id: String(employee._id) }); } catch (e) {}
    await notifyHR({ title: 'New employee added', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.status(201).json({ employee });
  } catch (error) {
    // Report what failed and why instead of a generic save error. See utils/mongooseError.
    return sendMongooseError(res, error, 'تعذّر إنشاء الموظف');
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const fields = [
      'firstName', 'lastName', 'arabicName', 'employeeNumber', 'gender', 'dateOfBirth', 'nationality', 'photo',
      'idType', 'iqamaNumber', 'iqamaExpiry', 'nationalId', 'passportNumber', 'passportExpiry',
      'qiwaContractNumber', 'gosiNumber', 'absherStatus', 'sponsorName', 'workPermitExpiry',
      // `branch` is the main branch; `branches` are extra branches he actually works on. See models/Employee.
      'jobTitle', 'department', 'staffCategory', 'hireDate', 'actualWorkStartDate', 'workLocation', 'branchName', 'branch', 'branches',
      'phone', 'email', 'address', 'emergencyContactName', 'emergencyContactPhone',
      'basicSalary', 'allowances', 'directManager', 'notes',
      // Banking
      'iban', 'bank',
      // Extra HR-sheet fields
      'fileStatus', 'absherNumber', 'companyNumber', 'originCountryNumber', 'project', 'registerNumber',
      // Work status and system status are not set here; they change only through termination, reactivation and system exit. See utils/hrEngagement.
      'penaltyClause', 'iqamaProfession', 'classification',
      'insuranceCompany', 'insuranceExpiry', 'socialInsuranceStatus', 'visaExpiry',
      'lastTravelDate', 'lastReturnDate',
      // Driving / vehicle eligibility
      // `vehiclePlate` is excluded: it is a snapshot from the vehicle register (authorization), not written from the form.
      'licenseNumber', 'licenseType', 'licenseExpiry',
      'driverCardNumber', 'driverCardType', 'driverCardStatus', 'driverCardExpiry', 'workCard', 'ajeerStatus', 'ajeerExpiry',
      // The rest of the HR master's editable fields, so the form edits everything the master does.
      'companyEmail', 'employerNumber', 'isOutsideKingdom', 'iqamaIssueDate', 'iqamaProfessionRequirements',
      'contractOccupation', 'contractStartDate', 'contractEndDate', 'annualLeaveDays', 'probationPeriod',
      'insuranceClass', 'medicalInsuranceNumber', 'medicalInsuranceRegister', 'insuranceRequirements',
      'healthCertNumber', 'healthCertExpiry',
    ];
    const H = require('../config/hrFields');
    // Capture a before/after diff of only the fields that actually change, so the
    // audit log (and the profile "history" tab) shows exactly what HR edited.
    {
      const LISTS = require('../utils/hrLists');
      const listErr = await LISTS.bodyError(req.body, employee)
        || (req.body.project !== undefined ? await LISTS.projectError(employee, req.body.project) : null)
        || (req.body.staffCategory !== undefined && String(req.body.staffCategory || '') !== String(employee.staffCategory || '')
          ? await LISTS.categoryError(req.body.department ?? employee.department, req.body.staffCategory) : null);
      if (listErr) return res.status(400).json({ message: listErr });
    }
    const projectBefore = employee.project || '';
    const before = {};
    const after = {};
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      let next = req.body[f] === '' && ['branch', 'directManager'].includes(f) ? null : req.body[f];
      // A Hijri date typed into a Gregorian field is converted, as in the master (hrMasterController.updateFields).
      if (H.getField(f)?.type === 'date' && /^1[34]\d\d-\d{1,2}-\d{1,2}$/.test(String(next || '').trim())) {
        next = require('../utils/hijri').fromHijriString(String(next).trim()) || next;
      }
      if (f === 'isOutsideKingdom') next = next === true || next === 'true' || next === '1';
      // Extra branches are an array, but an old form may send a comma-separated string. The main branch must not repeat inside it.
      if (f === 'branches') {
        const arr = Array.isArray(next) ? next : String(next || '').split(',');
        const primary = String(req.body.branch ?? employee.branch ?? '');
        next = [...new Set(arr.map((x) => String(x || '').trim()).filter(Boolean))]
          .filter((x) => x !== primary);
      }
      const prev = employee[f];
      const prevCmp = Array.isArray(prev) ? prev.map(String).join(',') : (prev && prev.toString ? prev.toString() : prev);
      const nextCmp = Array.isArray(next) ? next.map(String).join(',') : (next && next.toString ? next.toString() : next);
      if (String(prevCmp ?? '') !== String(nextCmp ?? '')) {
        before[f] = prev;
        after[f] = next;
      }
      employee[f] = next;
    }
    applyMarks(employee, req.body.markStatus);
    await employee.save();
    // A B2C employee's project is also written to the B2C record. See utils/hrLists.
    if ((employee.project || '') !== projectBefore) await require('../utils/hrLists').projectToB2C(employee, employee.project).catch(() => {});
    // The driver card is written to the vehicle register (the reference) when edited here. See utils/driverCardSync.
    if (['driverCardNumber', 'driverCardExpiry', 'driverCardType'].some((k) => req.body[k] !== undefined)) {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(employee, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR profile → driver card:', e.message); }
    }
    bustEmployeeCaches();
    // Moving to light transport adds him to that department's register, as on create. Moving away does not remove him, since auto-removal would wipe his project, housing and transfer history. See utils/lightTransportSync.
    if (after.department !== undefined) {
      const { syncEmployeeToLightTransport } = require('../utils/lightTransportSync');
      if (await syncEmployeeToLightTransport(employee, req.user)) {
        try { emitToAll('lt:updated', {}); } catch (e) { /* */ }
      }
    }
    if (Object.keys(after).length) {
      await logAudit({ user: req.user._id, action: 'update_employee', entity: 'Employee', entityId: employee._id, changes: { before, after }, ipAddress: req.ip });
    }
    // File edit refreshes the screen with no notice; the audit log keeps what changed.
    await refreshHR({ relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('updateEmployee error:', error);
    return sendMongooseError(res, error, 'Failed to update employee');
  }
};

/**
 * No employee deletion.
 * Deleting erased documents, files on disk and renewals with no way back, and breaks references: custody stays on a missing name, authorizations point at a vehicle with no driver, paid salaries lose their owner. Staff who leave have their service ended, keeping contract, documents, leave balance, custody and vehicle for later audits.
 * The route stays blocked with a reply naming the alternative; hiding it in the UI alone is not enough since requests can be made without it.
 */
exports.deleteEmployee = async (req, res) => {
  /** Open to the system admin only: a wrongly entered or duplicate record has no reason to stay as ended. The guard lives in the controller because the route's authorize opens to anyone granted the section. The full record is saved to the audit log before deletion, so it records who deleted whom and allows restore. */
  if (!require('../config/constants').isTopRole(req.user.role)) {
    return res.status(405).json({
      code: 'EMPLOYEE_DELETE_DISABLED',
      message: 'حذفُ الموظّف لمدير النظام وحدَه. مَن ترك العمل تُنهى خدمتُه '
        + 'من ملفّه («إنهاء الخدمة»)، فيبقى عقدُه ومستنداتُه وأثرُ عهدته.',
    });
  }
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    // Block deletion of anyone holding custody or a vehicle authorization: deleting leaves custody on a missing name (IT register devices ended up with an empty name).
    const { employeeExitBlockers, returnEmployeeAssetsToStore } = require('../utils/employeeExit');
    const blockers = await employeeExitBlockers(employee._id);
    if (blockers.blocked && req.query.returnCustody !== 'true') {
      return res.status(400).json({
        code: 'EXIT_BLOCKED',
        message: `لا يمكن الحذف: ${blockers.reasons.join(' و')}. سلِّم العهدة وأنهِ التفويض أوّلًا.`,
        assets: blockers.assets,
        authorizations: blockers.authorizations,
        canAutoReturnAssets: blockers.assets > 0 && blockers.authorizations === 0,
      });
    }
    // Records in other sections that point at this file would be left pointing at nothing, so deletion stops and names them; ending service keeps them intact.
    {
      const id = employee._id;
      const LT = require('../models/LightTransport');
      const { FleetDriver } = require('../models/FleetModels');
      const counts = await Promise.all([
        ['سجل النقل الخفيف', LT.LightTransportEmployee.countDocuments({ employee: id })],
        ['سائق في إدارة الأسطول', FleetDriver.countDocuments({ employee: id })],
        ['سائق في طلبات الشحنات', require('../models/ShipmentOrderDriver').countDocuments({ employee: id })],
        ['بطاقة سائق', require('../models/DriverCard').countDocuments({ employee: id })],
        ['عقود', require('../models/Contract').countDocuments({ employee: id })],
        ['طلبات إجازة', require('../models/LeaveRequest').countDocuments({ employee: id })],
        ['بريد شركة', require('../models/CompanyEmail').countDocuments({ employee: id })],
      ].map(async ([label, q]) => [label, await q.catch(() => 0)]));
      const linked = counts.filter(([, n]) => n > 0);
      if (linked.length) {
        return res.status(400).json({
          code: 'EMPLOYEE_LINKED',
          message: `لا يمكن الحذف: للموظّف سجلّاتٌ في أقسامٍ أخرى (${linked.map(([l, n]) => `${l}: ${n}`).join('، ')}). أنهِ خدمتَه من ملفّه بدل الحذف، فتبقى سجلّاتُه سليمة.`,
          linked: Object.fromEntries(linked),
        });
      }
    }
    const returned = blockers.assets
      ? await returnEmployeeAssetsToStore(employee._id, { note: `أُعيدت للمستودع عند حذف سجلّ ${fullName(employee)}` })
      : 0;

    const snapshot = employee.toObject();
    const docs = await EmployeeDocument.find({ employee: employee._id }).select('fileUrl title type').lean();
    // Write the audit entry before erasing: if the erase fails the trace remains, if it succeeds the copy remains.
    await logAudit({
      user: req.user, action: 'delete_employee', entity: 'Employee', entityId: employee._id,
      changes: { before: snapshot, details: `حُذف سجلُّ ${fullName(employee)} — ${docs.length} مستندًا`, documents: docs.map((d) => d.title || d.type || '') },
      ipAddress: req.ip,
    });
    if (employee.user) await User.updateOne({ _id: employee.user }, { $unset: { linkedEmployee: 1 } });
    docs.forEach((d) => deleteStoredFile(d.fileUrl));
    await EmployeeDocument.deleteMany({ employee: employee._id });
    await EmployeeRenewal.deleteMany({ employee: employee._id });
    await employee.deleteOne();
    bustEmployeeCaches();
    await notifyHR({ title: 'Employee removed', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ message: 'Employee deleted', assetsReturnedToStore: returned });
  } catch (error) {
    console.error('deleteEmployee error:', error);
    res.status(500).json({ message: 'Failed to delete employee' });
  }
};

// ── Document renewals (iqama / license / insurance ...) ──────────────────────
// Maps a renewable document type → the employee fields it updates.
const RENEWAL_FIELDS = {
  iqama: { expiry: 'iqamaExpiry', number: 'iqamaNumber' },
  passport: { expiry: 'passportExpiry', number: 'passportNumber' },
  workPermit: { expiry: 'workPermitExpiry' },
  insurance: { expiry: 'insuranceExpiry' },
  visa: { expiry: 'visaExpiry' },
  license: { expiry: 'licenseExpiry', number: 'licenseNumber' },
  driverCard: { expiry: 'driverCardExpiry', number: 'driverCardNumber' },
  ajeer: { expiry: 'ajeerExpiry' },
  // Contract and health certificate were outside renewal, so manual date edits left no trace of who renewed and from which date, which is the most asked item in audits.
  contract: { expiry: 'contractEndDate', number: 'qiwaContractNumber' },
  healthCert: { expiry: 'healthCertExpiry', number: 'healthCertNumber' },
  other: {},
};

// Dashboard group to renewable document type. The dashboard uses Arabic-origin group names (`medicalInsurance`) while renewal uses document names (`insurance`); without this bridge the medical insurance page finds no renewals.
const GROUP_DOC_TYPE = {
  iqama: 'iqama',
  passport: 'passport',
  contract: 'contract',
  // Work permits: group and document names are the same, and listing them here makes the renew button work instead of returning an unknown document type.
  workPermit: 'workPermit',
  medicalInsurance: 'insurance',
  healthCertificate: 'healthCert',
  driverCard: 'driverCard',
  drivingLicense: 'license',
  // Visa and Ajeer groups (config/hrFields): the group name is the document name.
  visa: 'visa',
  ajeer: 'ajeer',
};
exports._RENEWAL_FIELDS = RENEWAL_FIELDS;
exports._GROUP_DOC_TYPE = GROUP_DOC_TYPE;

// Renew a dated document: bumps the matching expiry (+ number if supplied) on the
// employee AND records a renewal-history row so the profile keeps a trail.
exports.renewDocument = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const { docType, newExpiry, documentNumber, notes } = req.body;
    const map = RENEWAL_FIELDS[docType];
    if (!map) return res.status(400).json({ message: 'Invalid document type' });

    const previousExpiry = map.expiry ? employee[map.expiry] : undefined;
    if (map.expiry && newExpiry) employee[map.expiry] = newExpiry;
    if (map.number && documentNumber) employee[map.number] = documentNumber;
    await employee.save();
    if (docType === 'driverCard') {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(employee, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR renew → driver card:', e.message); }
    }

    const renewal = await EmployeeRenewal.create({
      employee: employee._id, docType,
      previousExpiry: previousExpiry || '', newExpiry: newExpiry || '',
      documentNumber: documentNumber || '', notes: notes || '',
      renewedBy: req.user._id, renewedAt: new Date(),
    });
    bustEmployeeCaches();
    await logAudit({ user: req.user._id, action: 'renew_document', entity: 'Employee', entityId: employee._id, changes: { before: { docType, expiry: previousExpiry }, after: { expiry: newExpiry, documentNumber } }, ipAddress: req.ip });
    await notifyHR({ title: 'Document renewed', message: `${docType} for ${fullName(employee)}`, relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.status(201).json({ employee, renewal });
  } catch (error) {
    console.error('renewDocument error:', error);
    return sendMongooseError(res, error, 'Failed to renew document');
  }
};

// End of service. Blocked while the employee still holds custody (same gate as
// terminating a contract). Also terminates any active contract.
/**
 * GET /employees/:id/clearance
 * What the employee holds before service is ended. Asked before the termination dialog so the user sees what to settle first; terminateEmployee enforces the same block, so the screen prevents the mistake and the server prevents bypass.
 */
exports.employeeClearance = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { checkClearance } = require('../services/employeeClearance');
    res.json(await checkClearance(req.params.id));
  } catch (e) {
    console.error('employeeClearance error:', e);
    res.status(500).json({ message: 'تعذّر فحص إخلاء الطرف' });
  }
};

/**
 * POST /contracts/:id/renew
 * The current contract is closed as expired, not deleted, since the contract sequence is work history. A new contract with new dates is created and the renewal is logged in EmployeeRenewal.
 * Leave balance accrues from the start of the active contract, so a new contract restarts from zero. Unused days are the employee's right: the balance is computed at renewal and stored as carriedOverDays on the new contract.
 */
exports.renewContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const old = await Contract.findById(req.params.id);
    if (!old) return res.status(404).json({ message: 'العقد غير موجود' });

    const {
      startDate, endDate, annualLeaveDays, notes, carryOver = true,
      // The job title is reviewed at renewal, when it actually changes (promotion or transfer). Optional here: omitted keeps the old one, and no one has to reopen the new contract to fix it.
      contractProfession, jobTitle, contractNumber, basicSalary, allowances, type,
    } = req.body;
    if (!startDate) return res.status(400).json({ message: 'تاريخ بداية العقد الجديد مطلوب.' });

    // Balance at renewal time, measured on the expired contract, not the new one.
    const { balance } = await computeEmployeeBalance(old.employee, new Date());
    const carried = carryOver ? Math.max(0, Number(balance.available) || 0) : 0;

    // Exactly two states: old is expired, new is active; renewedFrom keeps the chain.
    old.status = 'expired';
    old.endDate = old.endDate || startDate;
    await old.save();

    // The new contract inherits the previous terms. The old code wrote `salary` and `contractType`, which are not fields here (they are `basicSalary` and `type`); mongoose dropped them silently and the renewed contract lost salary, allowances, type, duration and probation. Inherit everything and override only what the renewal form supplied.
    const pick = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : v);
    const fresh = await Contract.create({
      employee: old.employee,
      startDate,
      endDate: endDate || '',
      type: pick(type, old.type),
      durationMonths: old.durationMonths,
      annualLeaveDays: annualLeaveDays != null ? Number(annualLeaveDays) : old.annualLeaveDays,
      annualLeaveText: old.annualLeaveText,
      probationMonths: old.probationMonths,
      probationText: old.probationText,
      basicSalary: basicSalary != null ? Number(basicSalary) : old.basicSalary,
      allowances: allowances != null ? Number(allowances) : old.allowances,
      jobTitle: pick(jobTitle, old.jobTitle),
      contractProfession: pick(contractProfession, old.contractProfession),
      contractNumber: pick(contractNumber, old.contractNumber),
      iqamaNumber: old.iqamaNumber,
      employeeNameAr: old.employeeNameAr,
      sponsorRegistration: old.sponsorRegistration,
      status: 'active',
      carriedOverDays: carried,
      renewedFrom: old._id,
      notes: notes || '',
      createdBy: req.user._id,
    });

    await EmployeeRenewal.create({
      employee: old.employee,
      docType: 'contract',
      previousExpiry: old.endDate || '',
      newExpiry: endDate || '',
      notes: carried
        ? `رُحِّل ${carried} يومًا من رصيد الإجازات${notes ? ` — ${notes}` : ''}`
        : (notes || ''),
      renewedBy: req.user._id,
    });

    // Renewal creates an active contract and retires the old one; the employee file's status follows.
    await syncEmployeeContractStatus(old.employee);
    bustEmployeeCaches();
    await logAudit({
      user: req.user._id, action: 'renew_contract', entity: 'Contract', entityId: fresh._id,
      changes: { after: { from: old.endDate, to: endDate, carriedOverDays: carried } }, ipAddress: req.ip,
    });
    try { emitToAll('hr:contract', { employee: String(old.employee) }); } catch (e) {}

    res.status(201).json({
      contract: fresh,
      carriedOverDays: carried,
      message: carried
        ? `جُدِّد العقد ورُحِّل ${carried} يومًا من رصيد الإجازات.`
        : 'جُدِّد العقد.',
    });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تجديد العقد');
  }
};

exports.terminateEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    // Clearance covers more than asset custody. An employee was terminated while authorized on a vehicle, leaving it under someone who no longer works here. The list returns what he holds with the department that settles each item and what to do, since a block with no pointer stops work.
    const { checkClearance } = require('../services/employeeClearance');
    const clearance = await checkClearance(employee._id);
    if (!clearance.clear) {
      return res.status(400).json({
        code: 'CLEARANCE_PENDING',
        message: `لا يمكن إنهاء الخدمة قبل تسوية: ${clearance.blockers.map((b) => b.ar).join('، ')}`,
        blockers: clearance.blockers,
        warnings: clearance.warnings,
      });
    }

    /** 'Not working' means service ended, with one of three states required: awaiting sponsorship transfer, sister company, or final exit. Staff outside the system or freelancers are not asked; ending their service archives them immediately. */
    const ENG = require('../utils/hrEngagement');
    const kind = String(req.body.kind || '');
    const archivesNow = ENG.archivesOnTermination(employee);
    if (!archivesNow && !ENG.TERMINATION_KINDS[kind]) {
      return res.status(400).json({ code: 'KIND_REQUIRED', message: 'اختر حالة «لا يعمل»: انتظار نقل الكفالة، أو شركة شقيقة، أو خروج نهائي' });
    }
    const reason = req.body.reason || '';
    const when = req.body.date ? new Date(req.body.date) : new Date();
    employee.employmentStatus = 'terminated';
    employee.terminatedAt = when;
    employee.terminationReason = reason;
    employee.terminationKind = archivesNow ? (ENG.TERMINATION_KINDS[kind] ? kind : '') : kind;
    // Sponsorship transfer wait is one month; HR is alerted in that window to take him out of the system.
    employee.transferDeadline = employee.terminationKind === 'transfer_pending'
      ? new Date(when.getTime() + ENG.TRANSFER_DAYS * 86400000) : null;
    employee.transferAlertKey = '';
    employee.sisterCompany = false;
    employee.workStatusText = ENG.workStatusTextOf(employee);
    // Contract status is written here at termination. The column was filled only from import, so employees terminated on screen had it empty and a not-on-duty list could not show whether the contract was cancelled or active. Use the status the screen sent (the hr_contract_status list may hold a more exact value); else the standard text used since the first import.
    employee.contractStatusText = String(req.body.contractStatus || '').trim() || 'منتهي';
    await employee.save();

    // Terminate the active contract too so both records agree.
    // Mark it as ended by termination so reactivation can restore it.
    await Contract.updateMany(
      { employee: employee._id, status: 'active' },
      // Cancelled became expired (two states only); the reason and date are in their own fields.
      { $set: { status: 'expired', terminatedAt: when, terminationReason: reason, custodyReturned: true, endedByTermination: true, statusBeforeTermination: 'active' } }
    );
    // Then read the status from the contract itself: if one exists it is authoritative, and the value written above stays only for people with no contract.
    if (!String(req.body.contractStatus || '').trim()) await syncEmployeeContractStatus(employee._id);

    bustEmployeeCaches();
    await logAudit({ user: req.user._id, action: 'terminate_employee', entity: 'Employee', entityId: employee._id, changes: { after: { reason, date: when, contractStatus: employee.contractStatusText } }, ipAddress: req.ip });
    await notifyHR({ title: 'Employee terminated', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    try { emitToUser(String(req.user._id), 'hr:contract', { id: String(employee._id) }); } catch (e) {}
    if (employee.user) await notifyUser(employee.user, { title: 'Contract ended', message: 'Your employment has been terminated.', relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    // A terminated employee must not remain assigned to a light transport vehicle. See utils/ltVehicleRelease.
    require('../utils/ltVehicleRelease').after();
    res.json({ employee });
  } catch (error) {
    console.error('terminateEmployee error:', error);
    res.status(500).json({ message: 'Failed to terminate employee' });
  }
};

/**
 * POST /employees/:id/work-status { status: 'working' | 'sister_company' }
 * Switches between working and sister company for staff whose service has not ended; 'not working' is termination itself (terminateEmployee). Work status is never written by hand. The old suspended state is resolved here too.
 */
exports.setWorkStatus = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const ENG = require('../utils/hrEngagement');
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    if (employee.employmentStatus === 'terminated') {
      return res.status(400).json({ message: 'الموظف «لا يعمل» — أعِد تفعيله أولًا' });
    }
    const status = String(req.body.status || '');
    if (!['working', 'sister_company'].includes(status)) return res.status(400).json({ message: 'اختر: يعمل أو شركة شقيقة' });
    const before = employee.workStatusText || '';
    employee.sisterCompany = status === 'sister_company';
    if (employee.employmentStatus === 'suspended') employee.employmentStatus = 'active';
    employee.workStatusText = ENG.workStatusTextOf(employee);
    await employee.save();
    bustEmployeeCaches();
    await logAudit({ user: req.user._id, action: 'hr_work_status', entity: 'Employee', entityId: employee._id,
      changes: { details: `حالة العمل: «${before}» → «${employee.workStatusText}»`, before: { workStatusText: before }, after: { workStatusText: employee.workStatusText } }, ipAddress: req.ip });
    await notifyHR({ title: `حالة العمل: ${employee.workStatusText}`, message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('setWorkStatus error:', error);
    res.status(500).json({ message: 'تعذّر تغيير حالة العمل' });
  }
};

/** POST /api/hr/employees/:id/sponsor Move a freelancer (or trainee) onto our sponsorship, meaning one of our commercial registers. The register is picked from the hr_register list and stored in the commercial register number field, which every screen reads the type from (utils/hrEngagement). Also: - type becomes sponsored and contract fields become required (utils/employmentType); - system status becomes inside the system; - the B2C record, if any, gets the register and contract type sponsorship. */
exports.sponsorEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const ENG = require('../utils/hrEngagement');
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    if (employee.employmentStatus === 'terminated') return res.status(400).json({ message: 'الموظف «لا يعمل» — أعِد تفعيله أولًا' });
    if (ENG.engagementOf(employee) === 'sponsored') return res.status(400).json({ message: 'الموظف على كفالتنا بالفعل' });
    const register = String(req.body.registerNumber || '').trim();
    const ours = await require('../utils/hrLists').namesOf('hr_register');
    if (!ours.includes(register)) return res.status(400).json({ message: `اختر سجلًّا تجاريًّا من سجلّاتنا: ${ours.join('، ')}` });
    const before = { registerNumber: employee.registerNumber || '', employmentType: employee.employmentType || '', systemStatus: employee.systemStatus || '' };
    const set = require('../utils/employmentType').applyEmploymentType('sponsored');
    employee.registerNumber = register;
    employee.employmentType = set.employmentType;
    employee.isFreelancer = false;
    for (const f of require('../utils/employmentType').CONTRACT_FIELDS) {
      if (employee.fieldStatus?.get?.(`${f}Status`) === 'not_required') employee.fieldStatus.delete(`${f}Status`);
    }
    employee.systemStatus = ENG.SYSTEM_IN;
    await employee.save();
    try {
      const { LightTransportEmployee } = require('../models/LightTransport');
      const row = await LightTransportEmployee.findOne({ employee: employee._id });
      if (row) { row.registerNumber = register; row.contractTypeAr = 'كفالة'; row.$locals.fromHr = true; await row.save(); emitToAll('lt:updated', {}); }
    } catch (_) { /* A B2C record failure must not fail the conversion. */ }
    bustEmployeeCaches();
    require('../utils/hrLists').bust({ sponsored: String(employee._id) });
    await logAudit({ user: req.user._id, action: 'hr_sponsor', entity: 'Employee', entityId: employee._id,
      changes: { details: `تحويل إلى كفالتنا على السجل ${register}`, before, after: { registerNumber: register, employmentType: employee.employmentType, systemStatus: employee.systemStatus } }, ipAddress: req.ip });
    await notifyHR({ title: `تحويل إلى كفالتنا: السجل ${register}`, message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('sponsorEmployee error:', error);
    res.status(500).json({ message: 'تعذّر التحويل إلى الكفالة' });
  }
};

// Re-activate a previously terminated/suspended employee.
exports.reactivateEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    employee.employmentStatus = 'active';
    employee.terminatedAt = undefined;
    employee.terminationReason = '';
    employee.terminationKind = '';
    employee.transferDeadline = null;
    employee.transferAlertKey = '';
    employee.sisterCompany = false;
    employee.workStatusText = require('../utils/hrEngagement').WORKING;
    // Returning from the archive puts him back inside the system: someone exited then reinstated works for us. A freelancer was never in the system, so he is untouched.
    const ENG = require('../utils/hrEngagement');
    const systemBefore = employee.systemStatus || '';
    if (String(systemBefore).trim() === ENG.SYSTEM_OUT && ENG.engagementOf(employee) !== 'freelance') employee.systemStatus = ENG.SYSTEM_IN;
    await employee.save();
    /** The contract returns to its pre-termination state. Contracts closed by termination (endedByTermination) are restored, unless their end date passed meanwhile, in which case they stay expired by date, not by cancellation. */
    const ended = await Contract.find({ employee: employee._id, endedByTermination: true });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const c of ended) {
      const lapsed = c.endDate && new Date(c.endDate) < today;
      c.status = lapsed ? 'expired' : (c.statusBeforeTermination || 'active');
      c.terminatedAt = undefined;
      c.terminationReason = '';
      c.endedByTermination = false;
      c.statusBeforeTermination = '';
      await c.save(); // eslint-disable-line no-await-in-loop
    }
    if (ended.length) await syncEmployeeContractStatus(employee._id);
    bustEmployeeCaches();
    await logAudit({ user: req.user._id, action: 'reactivate_employee', entity: 'Employee', entityId: employee._id, changes: { after: { employmentStatus: 'active', ...(employee.systemStatus !== systemBefore ? { systemStatus: employee.systemStatus } : {}) }, ...(employee.systemStatus !== systemBefore ? { before: { systemStatus: systemBefore } } : {}) }, ipAddress: req.ip });
    await notifyHR({ title: 'Employee reactivated', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('reactivateEmployee error:', error);
    res.status(500).json({ message: 'Failed to reactivate employee' });
  }
};

// ── Employee documents (file uploads) ────────────────────────────────────────
exports.listDocuments = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const documents = await EmployeeDocument.find({ employee: req.params.id })
      .populate('uploadedBy', 'firstName lastName').sort({ createdAt: -1 }).lean();
    res.json({ documents });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load documents' });
  }
};

exports.uploadDocument = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id).select('_id firstName lastName arabicName').lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const { title, category, expiryDate, notes, dataUrl, fileName } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: 'Document name is required' });
    if (!dataUrl) return res.status(400).json({ message: 'A file is required' });

    let stored;
    try { stored = saveEmployeeFile(dataUrl, fileName); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    const doc = await EmployeeDocument.create({
      employee: employee._id, title: title.trim(), category: category || 'other',
      expiryDate: expiryDate || undefined, notes: notes || '',
      uploadedBy: req.user._id, ...stored,
    });
    // A document uploaded by HR means HR knows the employee, so he leaves the new-from-individuals list.
    if (employee.hrPending) await Employee.updateOne({ _id: employee._id }, { $set: { hrPending: false } });
    await logAudit({ user: req.user._id, action: 'add_employee_document', entity: 'Employee', entityId: employee._id, changes: { after: { title: doc.title } }, ipAddress: req.ip });
    // Document upload is bookkeeping, recorded in the audit log.
    await refreshHR({ relatedEntityId: employee._id, event: 'hr:employee' });
    const populated = await EmployeeDocument.findById(doc._id).populate('uploadedBy', 'firstName lastName').lean();
    res.status(201).json({ document: populated });
  } catch (error) {
    console.error('uploadDocument error:', error);
    res.status(500).json({ message: 'Failed to upload document' });
  }
};

exports.updateDocument = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const doc = await EmployeeDocument.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    ['title', 'category', 'expiryDate', 'notes'].forEach((f) => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
    await doc.save();
    await logAudit({ user: req.user._id, action: 'update_employee_document', entity: 'Employee', entityId: doc.employee, changes: { after: { title: doc.title } }, ipAddress: req.ip });
    try { emitToUser(String(req.user._id), 'hr:employee', { id: String(doc.employee) }); } catch (e) {}
    // Document edit is also in the audit log.
    await refreshHR({ relatedEntityId: doc.employee, event: 'hr:employee' });
    const populated = await EmployeeDocument.findById(doc._id).populate('uploadedBy', 'firstName lastName').lean();
    res.json({ document: populated });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update document');
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const doc = await EmployeeDocument.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    deleteStoredFile(doc.fileUrl);
    const employeeId = doc.employee;
    await doc.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_employee_document', entity: 'Employee', entityId: employeeId, changes: { before: { title: doc.title } }, ipAddress: req.ip });
    // Document deletion is also in the audit log.
    await refreshHR({ relatedEntityId: employeeId, event: 'hr:employee' });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete document' });
  }
};

// Change history for one employee — everything logAudit'd against this id.
exports.getEmployeeAudit = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // One employee's history reached 293 edits under the 300 cap, close to silent truncation; the cap now announces itself.
      const CAP = askedLimit(req.query, 2000, 20000);
      const { rows: logs, truncated } = await cappedFind(
        AuditLog.find({ entity: 'Employee', entityId: req.params.id })
          .populate('user', 'firstName lastName role').sort({ createdAt: -1 }),
        CAP,
      );
      res.json({ logs, ...(truncated && { truncated: true, limit: CAP, note: CAP_NOTE_AR }) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load history' });
  }
};

// Contracts
// Department settings

const HrConfig = require('../models/HrConfig');

const getHrConfig = async () => {
  let cfg = await HrConfig.findOne({ key: 'hr' });
  if (!cfg) cfg = await HrConfig.create({ key: 'hr', alerts: HrConfig.DEFAULT_ALERTS });
  return cfg;
};

exports.getHrSettings = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const cfg = await getHrConfig();
    const saved = cfg.alerts instanceof Map ? Object.fromEntries(cfg.alerts) : (cfg.alerts || {});
    // The default sits below the saved value: a document added after the last save gets its threshold instead of none.
    res.json({ alerts: { ...HrConfig.DEFAULT_ALERTS, ...saved } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load HR settings' });
  }
};

exports.updateHrSettings = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const cfg = await getHrConfig();
    const incoming = req.body.alerts || {};
    for (const [k, v] of Object.entries(incoming)) {
      const n = Number(v);
      // At least one day and at most a year: zero would mean never alert, which is never intended, and a thousand makes every document expired.
      if (Number.isFinite(n) && n >= 1 && n <= 365) cfg.alerts.set(k, Math.round(n));
    }
    cfg.updatedBy = req.user._id;
    await cfg.save();
    const saved = Object.fromEntries(cfg.alerts);
    res.json({ alerts: { ...HrConfig.DEFAULT_ALERTS, ...saved } });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to save HR settings');
  }
};

exports.listContracts = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    // Expired includes legacy cancelled and renewed values not yet migrated.
    if (req.query.status) {
      const st = twoStatus(String(req.query.status));
      filter.status = st === 'active' ? 'active' : { $in: ['expired', 'terminated', 'renewed'] };
    }
    // Fetch the department with the employee. The contracts filter panel reads employee.department, which was not among fetched columns, so every contract showed an empty department and the filter had a single value. Branch, work unit and employment status are included too. The contract list excludes archived staff; contracts of a specific file opened from the archive remain.
    const contracts = await Contract.find(req.query.employee ? filter : await withoutArchivedRef(filter))
      .populate({ path: 'employee', select: 'firstName lastName arabicName iqamaNumber nationalId idType employeeNumber jobTitle department branchName project employmentStatus' })
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    res.json({ contracts: contracts.map(asTwo) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load contracts' });
  }
};

exports.createContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { employee } = req.body;
    if (!employee || !mongoose.isValidObjectId(employee)) return res.status(400).json({ message: 'Employee is required' });
    if (!req.body.startDate) return res.status(400).json({ message: 'Start date is required' });

    // Only one active contract per employee — expire the previous active one.
    if ((req.body.status || 'active') === 'active') {
      await Contract.updateMany({ employee, status: 'active' }, { $set: { status: 'expired' } });
    }
    const contract = await Contract.create({ ...req.body, createdBy: req.user._id });
    await syncEmployeeContractStatus(employee);
    // Employee contract status changed, and master counters read it from a one-minute cache. Only renewal cleared it while create, edit, cancel and delete write the same field without clearing, leaving cards stale and hr:master never broadcast.
    bustEmployeeCaches();
    await notifyHR({ title: 'Contract created', message: `Contract for employee ${employee}`, relatedEntity: 'Contract', relatedEntityId: contract._id, event: 'hr:contract' });
    res.status(201).json({ contract });
  } catch (error) {
    console.error('createContract error:', error);
    return sendMongooseError(res, error, 'Failed to create contract');
  }
};

exports.updateContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });
    const fields = ['type', 'startDate', 'endDate', 'durationMonths', 'annualLeaveDays', 'jobTitle', 'basicSalary', 'allowances', 'probationMonths', 'status', 'notes',
      // Contract file fields are shown in the table, so they must be editable from the screen too; what can be read but not corrected stays wrong.
      'iqamaNumber', 'employeeNameAr', 'contractProfession', 'sponsorRegistration', 'annualLeaveText', 'probationText',
      'contractNumber'];
    for (const f of fields) if (req.body[f] !== undefined) contract[f] = req.body[f];
    await contract.save();
    await syncEmployeeContractStatus(contract.employee);
    // See createContract: clear the master cache, then announce to everyone. The event used to go only to the editor, leaving colleagues' screens stale.
    bustEmployeeCaches();
    try { emitToAll('hr:contract', { id: String(contract._id) }); } catch (e) {}
    res.json({ contract });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update contract');
  }
};

// Terminating a contract is blocked while the employee still holds custody.
exports.terminateContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });

    // Same rule as the delete guard. Custody was checked in one place and nothing in the other, then vehicle authorization was added to only one, so an employee could be blocked from termination yet allowed to be deleted. Answer the question once and let both read it.
    const { employeeExitBlockers } = require('../utils/employeeExit');
    const gate = await employeeExitBlockers(contract.employee);
    const outstanding = gate.assets;
    if (gate.blocked) {
      return res.status(400).json({
        message: `لا يمكن إنهاء الخدمة: ${gate.reasons.join(' و')}.`,
        code: 'CUSTODY_OUTSTANDING', outstanding, authorizations: gate.authorizations,
      });
    }

    // Cancellation also ends the employee's service, so the not-working state is asked as in termination.
    const ENG = require('../utils/hrEngagement');
    const empDoc = await Employee.findById(contract.employee).select('systemStatus registerNumber employmentStatus');
    const kind = String(req.body.kind || '');
    const archivesNow = empDoc ? ENG.archivesOnTermination(empDoc) : true;
    if (!archivesNow && !ENG.TERMINATION_KINDS[kind]) {
      return res.status(400).json({ code: 'KIND_REQUIRED', message: 'فسخُ العقد يُنهي الخدمة — اختر حالة «لا يعمل»: انتظار نقل الكفالة، أو شركة شقيقة، أو خروج نهائي' });
    }

    // Cancellation ends the contract as expired, with reason and date in their own fields.
    contract.status = 'expired';
    contract.endedByTermination = true;
    contract.statusBeforeTermination = 'active';
    contract.terminatedAt = new Date();
    contract.terminationReason = req.body.reason || '';
    contract.custodyReturned = true;
    await contract.save();

    // Reflect on the employee record + notify in real time everywhere.
    {
      const k = ENG.TERMINATION_KINDS[kind] ? kind : '';
      const now = new Date();
      await Employee.findByIdAndUpdate(contract.employee, {
        employmentStatus: 'terminated', terminatedAt: now, terminationReason: req.body.reason || '',
        terminationKind: k,
        transferDeadline: k === 'transfer_pending' ? new Date(now.getTime() + ENG.TRANSFER_DAYS * 86400000) : null,
        transferAlertKey: '',
        workStatusText: ENG.workStatusTextOf({ employmentStatus: 'terminated', terminationKind: k }),
      });
    }
    // Contract status is derived from the contract itself, not written here in different wording that would diverge from the contracts page. See utils/contractStatus.
    await syncEmployeeContractStatus(contract.employee);
    // Cancellation removes the employee from on-duty and from the expiry count; it moves the strip numbers most and did not clear their cache.
    bustEmployeeCaches();
    const emp = await Employee.findById(contract.employee).select('user').lean();
    await notifyHR({ title: 'Contract terminated', message: `Contract ${contract._id} terminated`, relatedEntity: 'Contract', relatedEntityId: contract._id, event: 'hr:contract' });
    try { emitToUser(String(req.user._id), 'hr:employee', { id: String(contract.employee) }); } catch (e) {}
    if (emp?.user) await notifyUser(emp.user, { title: 'Contract ended', message: 'Your contract has been terminated.', relatedEntity: 'Contract', relatedEntityId: contract._id, event: 'hr:employee' });

    res.json({ contract });
  } catch (error) {
    console.error('terminateContract error:', error);
    res.status(500).json({ message: 'Failed to terminate contract' });
  }
};

exports.deleteContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const contract = await Contract.findByIdAndDelete(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });
    // A deleted contract may change the governing status; re-read from what remains.
    await syncEmployeeContractStatus(contract.employee);
    bustEmployeeCaches();
    try { emitToAll('hr:contract', { id: String(contract._id) }); } catch (e) {}
    res.json({ message: 'Contract deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete contract' });
  }
};

// ── Leave types ──────────────────────────────────────────────────────────────
exports.listLeaveTypes = async (req, res) => {
  try {
    // Everyone can read; employees only see active ones for the dropdown.
    const filter = hrStaffReq(req) ? {} : { active: true };
    const leaveTypes = await LeaveType.find(filter).sort({ createdAt: 1 }).lean();
    res.json({ leaveTypes });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave types' });
  }
};

exports.createLeaveType = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { code, nameEn, nameAr } = req.body;
    if (!code || !nameEn || !nameAr) return res.status(400).json({ message: 'Code and names are required' });
    const exists = await LeaveType.findOne({ code: String(code).toLowerCase() });
    if (exists) return res.status(400).json({ message: 'A leave type with this code already exists' });
    const leaveType = await LeaveType.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json({ leaveType });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create leave type');
  }
};

exports.updateLeaveType = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const lt = await LeaveType.findById(req.params.id);
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });
    ['nameEn', 'nameAr', 'paid', 'affectsBalance', 'color', 'active', 'requiresAdvanceNotice', 'minAdvanceDays', 'countsFridays'].forEach((f) => {
      if (req.body[f] !== undefined) lt[f] = req.body[f];
    });
    await lt.save();
    res.json({ leaveType: lt });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update leave type');
  }
};

exports.deleteLeaveType = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    await LeaveType.findByIdAndDelete(req.params.id);
    res.json({ message: 'Leave type deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete leave type' });
  }
};

// ── Leave requests ───────────────────────────────────────────────────────────
const NO_SIG = '-employeeSignature -managerDecision.signature -financeDecision.signature -hrDecision.signature -executiveDecision.signature -chairmanDecision.signature';

/** A user's signature from self-service: the one with `pickId` if given, else the default, else the first; '' when none is saved. */
async function defaultSignatureOf(userId, pickId) {
  try {
    const u = await User.findById(userId).select('+signatures').lean();
    const sigs = (u && u.signatures) || [];
    const pick = pickId ? sigs.find((x) => String(x._id) === String(pickId)) : null;
    return ((pick || sigs.find((x) => x.isDefault) || sigs[0]) || {}).dataUrl || '';
  } catch (e) { return ''; }
}
const populateLeave = (q) => q
  .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId idType employeeNumber department')
  .populate('requester', 'firstName lastName email')
  .populate('manager', 'firstName lastName')
  .populate('leaveType', 'nameEn nameAr code color affectsBalance')
  .populate('managerDecision.by', 'firstName lastName')
  .populate('hrDecision.by', 'firstName lastName')
  .populate('financeDecision.by', 'firstName lastName')
  .populate('executiveDecision.by', 'firstName lastName')
  .populate('chairmanDecision.by', 'firstName lastName');

/**
 * Inbox: requests currently waiting on this user.
 * A direct manager sees only his team's requests; HR, accounting and management see what reached their stage. One query (inboxFilter), not a read-then-filter loop. Each request carries myStage, the stage the reader owns, so the UI builds its buttons from it.
 */
exports.listLeaveInbox = async (req, res) => {
  try {
    // An archived employee's request waits for no one; he left the system.
    const leaves = await populateLeave(LeaveRequest.find(await withoutArchivedRef(chain.inboxFilter(req.user))))
      .select(NO_SIG).sort({ createdAt: 1 }).limit(500).lean();
    res.json({
      leaves: leaves.map((l) => ({ ...l, myStage: l.currentStage })),
      stages: chain.stagesFor(req.user),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave inbox' });
  }
};

/** Count of requests waiting on me, for the list badge; the requests themselves are not loaded. */
exports.leaveInboxCount = async (req, res) => {
  try {
    res.json({ count: await LeaveRequest.countDocuments(await withoutArchivedRef(chain.inboxFilter(req.user))) });
  } catch (error) {
    res.json({ count: 0 });
  }
};

exports.listLeaves = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.employee) filter.employee = req.query.employee;
    // The general list excludes archived staff; leaves of a specific file remain.
    const leaves = await populateLeave(LeaveRequest.find(req.query.employee ? filter : await withoutArchivedRef(filter))).select(NO_SIG).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave requests' });
  }
};

/**
 * GET /api/hr/leave-register — every approved leave (from a request or recorded by HR),
 * with its state today, source, who approved it and when, and the employee's live balance.
 * Filters: employee, type, state, source, from, to (overlap), department, q.
 */
const LEAVE_STATES = ['upcoming', 'current', 'ended', 'returned', 'no_show'];
const leaveStateOf = (l, today) => {
  if (l.returnState === 'no_show') return 'no_show';
  if (l.returnState === 'returned') return 'returned';
  if (l.startDate > today) return 'upcoming';
  if (l.endDate >= today) return 'current';
  return 'ended';
};
const leaveSourceOf = (l) => (l.manual ? 'manual' : l.backdated ? 'backdated' : 'request');
exports.leaveRegister = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const q = req.query || {};
    const filter = { status: 'approved' };
    if (q.employee && mongoose.isValidObjectId(q.employee)) filter.employee = q.employee;
    if (q.type && mongoose.isValidObjectId(q.type)) filter.leaveType = q.type;
    if (q.from) filter.endDate = { $gte: String(q.from).slice(0, 10) };
    if (q.to) filter.startDate = { $lte: String(q.to).slice(0, 10) };
    if (q.source === 'manual') filter.manual = true;
    if (q.source === 'backdated') filter.backdated = true;
    if (q.source === 'request') { filter.manual = { $ne: true }; filter.backdated = { $ne: true }; }
    if (q.department || q.q) {
      const ef = { };
      if (q.department) ef.department = String(q.department);
      if (q.q) {
        const rx = require('../utils/arabicSearch').arabicSearchRegex(String(q.q));
        ef.$or = [{ arabicName: rx }, { firstName: rx }, { lastName: rx }, { employeeNumber: rx }, { iqamaNumber: rx }, { nationalId: rx }];
      }
      const ids = await Employee.find(ef).distinct('_id');
      filter.employee = filter.employee ? (ids.some((x) => String(x) === String(filter.employee)) ? filter.employee : null) : { $in: ids };
    }
    const rows = await LeaveRequest.find(q.employee ? filter : await withoutArchivedRef(filter))
      .populate('employee', 'firstName lastName arabicName employeeNumber iqamaNumber nationalId idType department jobTitle user')
      .populate('leaveType', 'nameEn nameAr code color affectsBalance')
      .populate('managerDecision.by hrDecision.by financeDecision.by executiveDecision.by', 'firstName lastName')
      .select(NO_SIG)
      .sort({ startDate: -1 }).limit(3000).lean();
    const today = todayKey();
    const nm = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
    let leaves = rows.map((l) => {
      const final = l.executiveDecision?.at ? l.executiveDecision : l.financeDecision?.at ? l.financeDecision : l.hrDecision?.at ? l.hrDecision : l.managerDecision;
      return {
        ...l,
        state: leaveStateOf(l, today),
        source: leaveSourceOf(l),
        approvedByName: l.recordedByName || nm(final?.by) || '',
        approvedAt: l.recordedAt || final?.at || null,
      };
    });
    if (q.state && LEAVE_STATES.includes(String(q.state))) leaves = leaves.filter((l) => l.state === q.state);
    // Live balance per employee in the result (bounded, in small parallel batches).
    const empIds = [...new Set(leaves.map((l) => String(l.employee?._id || '')).filter(Boolean))].slice(0, 400);
    const balances = {};
    for (let i = 0; i < empIds.length; i += 20) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(empIds.slice(i, i + 20).map(async (id) => {
        try { const { balance } = await computeEmployeeBalance(id); balances[id] = balance?.available ?? null; } catch (_) { balances[id] = null; }
      }));
    }
    const counts = Object.fromEntries(LEAVE_STATES.map((k) => [k, 0]));
    for (const l of leaves) counts[l.state] += 1;
    res.json({ leaves, balances, counts, today });
  } catch (error) {
    console.error('leaveRegister error:', error);
    res.status(500).json({ message: 'تعذّر تحميل سجل الإجازات' });
  }
};

// Single leave WITH signatures — used to render the official PDF sheet.
exports.getLeave = async (req, res) => {
  try {
    const leave = await populateLeave(LeaveRequest.findById(req.params.id)).lean();
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    // Access: HR staff, the requester, or the direct manager.
    const uid = String(req.user._id);
    const allowed = hrStaffReq(req)
      || String(leave.requester?._id || leave.requester) === uid
      || String(leave.manager?._id || leave.manager) === uid
      || String(leave.filedBy?._id || leave.filedBy || '') === uid;
    if (!allowed) return res.status(403).json({ message: 'Not allowed' });
    res.json({ leave });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave request' });
  }
};

/**
 * The official sheet as a PDF (services/leaveSheet), the same file on web and mobile.
 * Readable by whoever may open the request, plus every stage desk: finance, top management and the chairman follow requests before they reach them.
 */
exports.getLeaveSheet = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id)
      .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId idType employeeNumber department jobTitle registerNumber iqamaExpiry iqamaExpiryHijri')
      .populate('requester filedBy', 'firstName lastName')
      .populate('leaveType', 'nameEn nameAr')
      .populate(Object.values(chain.DECISION_FIELD).map((f) => `${f}.by`).join(' '), 'firstName lastName')
      .lean();
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    const uid = String(req.user._id);
    const own = [leave.requester, leave.manager, leave.filedBy].some((x) => x && String(x._id || x) === uid);
    const desk = chain.STAGES.some((st) => st !== 'manager' && chain.canActAt(st, req.user, leave));
    if (!own && !desk && !hrStaffReq(req)) return res.status(403).json({ message: 'Not allowed' });
    const pdf = await require('../services/leaveSheet').renderLeaveSheet(leave);
    const who = (leave.employee?.employeeNumber || String(leave._id)).replace(/[^\w-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="leave-${who}-${leave.startDate || ''}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('leave sheet error:', error);
    res.status(500).json({ message: 'تعذّر إصدار ورقة الإجازة' });
  }
};

exports.listMyLeaves = async (req, res) => {
  try {
    // Resolve (auto-provisioning if needed) instead of trusting the cached req.user.linkedEmployee, which can predate the link.
    const employeeId = await ensureSelfEmployee(req);
    // Mine = requests I made for myself, plus any on my file (a manager filed it for me). Those I filed for my team are on the team tab.
    const or = [{ requester: req.user._id, filedByManager: { $ne: true } }];
    if (employeeId) or.push({ employee: employeeId });
    const leaves = await populateLeave(LeaveRequest.find({ $or: or })).select(NO_SIG).sort({ createdAt: -1 }).lean();
    let balance = null;
    if (employeeId) ({ balance } = await computeEmployeeBalance(employeeId));
    res.json({ leaves, balance, linked: !!employeeId });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load your leaves' });
  }
};

// Leave requests from the current user's direct reports awaiting their action.
exports.listTeamLeaves = async (req, res) => {
  try {
    const leaves = await populateLeave(LeaveRequest.find(await withoutArchivedRef({ $or: [{ manager: req.user._id }, { filedBy: req.user._id }] }))).select(NO_SIG).sort({ createdAt: -1 }).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load team leaves' });
  }
};

// Advance-notice policy
// Planned leave must be filed a month ahead. Types marked `requiresAdvanceNotice: false` (sick, emergency, bereavement, maternity) are exempt by design.
// Today is a plain YYYY-MM-DD so a request at 23:00 counts the same as at 08:00.
// Today is the Riyadh day, not GMT: toISOString() gave yesterday between midnight and 03:00, giving those requesters a free day of notice.
const { todayKey } = require('../utils/companyDay');
const DAY_MS = 86400000;
const daysUntil = (dateStr) =>
  Math.round((Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayKey()}T00:00:00Z`)) / DAY_MS);

// Evaluate the policy for one (leaveType, startDate). Returns the snapshot that
// gets stored on the request plus a ready-to-send bilingual refusal message.
const evaluateAdvanceNotice = (leaveType, startDate) => {
  const required = leaveType.requiresAdvanceNotice !== false;
  const requiredDays = required ? Number(leaveType.minAdvanceDays ?? 30) : 0;
  const daysAhead = daysUntil(startDate);
  const satisfied = !required || daysAhead >= requiredDays;
  return {
    required,
    requiredDays,
    daysAhead,
    satisfied,
    message: satisfied ? '' : `يجب تقديم طلب «${leaveType.nameAr}» قبل موعد بدايتها بـ ${requiredDays} يومًا على الأقل. `
      + `تاريخ البداية المطلوب بعد ${daysAhead} يوم فقط. `
      + `الإجازات الطارئة والمرضية معفاة من هذه القاعدة.`
      + ` | "${leaveType.nameEn}" must be requested at least ${requiredDays} day(s) before it starts; this one starts in ${daysAhead} day(s). Emergency and sick leave are exempt.`,
  };
};

/**
 * Save the request's files to disk and return the metadata stored with the record.
 * Data URLs arrive in the same request (no multer here) and are written under `uploads/hr`, which the daily backup covers. Errors are thrown with their text so the screen shows the real message.
 */
function saveLeaveFiles(files, user) {
  const out = [];
  for (const f of Array.isArray(files) ? files.slice(0, 10) : []) {
    if (!f?.dataUrl) continue;
    const stored = saveUploadFile(f.dataUrl, 'hr', f.fileName || '');
    out.push({
      ...stored,
      title: String(f.title || f.fileName || '').trim() || stored.fileName,
      uploadedBy: user._id,
      uploadedByName: fullName(user),
      uploadedAt: new Date(),
    });
  }
  return out;
}

/** An open or approved leave of this employee on any of these days; a day is never requested or deducted twice. */
const findLeaveClash = (employee, startDate, endDate, excludeId) => LeaveRequest.findOne({
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  employee, status: { $in: ['approved', ...chain.OPEN_STATUSES] },
  startDate: { $lte: endDate }, endDate: { $gte: startDate },
}).select('startDate endDate status').lean();
const clashMessage = (c) => `تتداخل مع إجازةٍ أخرى لنفس الموظّف (${c.startDate} → ${c.endDate}) | Overlaps another leave of the same employee`;

/** Tell the request's owner and, when different, the manager who filed it. */
const notifyLeaveOwners = async (leave, payload) => {
  const ids = new Set([leave.requester, leave.filedBy].filter(Boolean).map((x) => String(x._id || x)));
  for (const id of ids) await notifyUser(id, payload);
};

/** The requester or the manager who filed the request: both may reply to a question or withdraw it. */
const ownsLeave = (leave, user) => [leave.requester, leave.filedBy].filter(Boolean)
  .some((x) => String(x._id || x) === String(user._id));

exports.createMyLeave = async (req, res) => {
  try {
    const employeeId = await ensureSelfEmployee(req);
    if (!employeeId) {
      return res.status(400).json({ message: 'Your account is not linked to an employee profile yet. Contact HR.' });
    }
    const { leaveType, startDate, endDate, reason } = req.body;
    if (!leaveType || !startDate || !endDate) return res.status(400).json({ message: 'Leave type and dates are required' });
    const lt = await LeaveType.findById(leaveType).lean();
    if (!lt) return res.status(400).json({ message: 'Invalid leave type' });

    // Advance-notice rule. HR staff may override it for a genuine exception —
    // the override (who + why) is stamped on the request and shown to reviewers.
    const notice = evaluateAdvanceNotice(lt, startDate);
    const wantsOverride = req.body.policyOverride === true && hrStaffReq(req);
    if (!notice.satisfied && !wantsOverride) {
      return res.status(400).json({
        message: notice.message,
        code: 'ADVANCE_NOTICE_REQUIRED',
        policy: { requiredDays: notice.requiredDays, daysAhead: notice.daysAhead, leaveType: lt.code },
      });
    }

    if (String(endDate) < String(startDate)) return res.status(400).json({ message: 'تاريخ النهاية قبل تاريخ البداية' });
    const countsFridays = fridayRuleOf(null, lt);
    const days = leaveDays(startDate, endDate, { countFridays: countsFridays });
    if (!days) return res.status(400).json({ message: NO_WORKDAY, code: 'NO_LEAVE_DAYS' });
    const clash = await findLeaveClash(employeeId, startDate, endDate);
    if (clash) return res.status(400).json({ message: clashMessage(clash), code: 'LEAVE_OVERLAP' });
    const { balance } = await computeEmployeeBalance(employeeId);
    // A department manager is his own direct manager (utils/leaveChain.selfManaged): no manager stage, his approval recorded at once.
    const ownManager = chain.selfManaged(req.user);
    const hasManager = !!req.user.manager && !ownManager;

    // The requester's signature: the one picked, else the default. Saved later in self-service, it is still read on the sheet (services/leaveSheet).
    const employeeSignature = await defaultSignatureOf(req.user._id, req.body.signatureId);

    // A sick-leave report is attached to the request, not sent over WhatsApp.
    let attachments = [];
    try { attachments = saveLeaveFiles(req.body.files, req.user); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    const leave = await LeaveRequest.create({
      attachments,
      employee: employeeId,
      requester: req.user._id,
      manager: ownManager ? undefined : (req.user.manager || undefined),
      ...(ownManager ? { managerDecision: chain.selfManagerDecision(req.user, employeeSignature) } : {}),
      leaveType,
      leaveTypeCode: lt.code,
      startDate, endDate, days, reason, countsFridays,
      employeeSignature,
      ...chain.startOf(hasManager),
      balanceSnapshot: {
        accrued: balance.accrued,
        requested: days,
        remainingAfter: lt.affectsBalance ? Math.round((balance.available - days) * 100) / 100 : balance.available,
      },
      advanceNotice: {
        required: notice.required,
        requiredDays: notice.requiredDays,
        daysAhead: notice.daysAhead,
        satisfied: notice.satisfied,
        overridden: !notice.satisfied,
        overriddenBy: notice.satisfied ? undefined : req.user._id,
        overrideReason: notice.satisfied ? '' : String(req.body.overrideReason || '').trim().slice(0, 300),
      },
    });

    const name = fullName(req.user);
    await notifyStage(leave.currentStage, leave, `${name} طلب إجازة ${days} يوم (${startDate} → ${endDate}).`);
    await announceLeave(leave);
    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    res.status(201).json({ leave: populated });
  } catch (error) {
    console.error('createMyLeave error:', error);
    return sendMongooseError(res, error, 'Failed to create leave request');
  }
};

/** GET /api/hr/team/leave-members: the people this manager may file leave for (utils/leaveTeam), with their live balance. */
exports.listLeaveTeamMembers = async (req, res) => {
  try {
    const team = await require('../utils/leaveTeam').teamOf(req.user);
    team.sort((a, b) => String(a.arabicName || a.firstName || '').localeCompare(String(b.arabicName || b.firstName || ''), 'ar'));
    const balances = {};
    for (let i = 0; i < team.length; i += 8) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(team.slice(i, i + 8).map(async (e) => {
        try { balances[String(e._id)] = (await computeEmployeeBalance(e._id)).balance?.available ?? null; } catch (_) { balances[String(e._id)] = null; }
      }));
    }
    res.json({ members: team, balances });
  } catch (error) {
    console.error('listLeaveTeamMembers error:', error);
    res.status(500).json({ message: 'تعذّر تحميل فريقك' });
  }
};

/**
 * POST /api/hr/team/leaves { employee, leaveType, startDate, endDate, reason, files }
 * A manager files a leave for someone under him. His own stage is the filing, so it is stamped approved by him and the request starts at HR.
 * The request belongs to the employee's login when he has one (he sees it, replies, is notified); otherwise to the filing manager.
 */
exports.createTeamLeave = async (req, res) => {
  try {
    const { employee, leaveType, startDate, endDate, reason } = req.body || {};
    if (!employee || !mongoose.isValidObjectId(employee)) return res.status(400).json({ message: 'اختر الموظّف' });
    if (!leaveType || !mongoose.isValidObjectId(leaveType) || !startDate || !endDate) return res.status(400).json({ message: 'نوع الإجازة وتاريخا البداية والنهاية مطلوبة' });
    if (String(endDate) < String(startDate)) return res.status(400).json({ message: 'تاريخ النهاية قبل تاريخ البداية' });
    if (!(await require('../utils/leaveTeam').isUnder(req.user, employee))) {
      return res.status(403).json({ message: 'هذا الموظّف ليس ضمن فريقك أو قسمك | This employee is not under you', code: 'NOT_IN_TEAM' });
    }
    const emp = await Employee.findById(employee).select('firstName lastName arabicName user employmentStatus').lean();
    if (!emp) return res.status(404).json({ message: 'الموظّف غير موجود' });
    const lt = await LeaveType.findById(leaveType).lean();
    if (!lt) return res.status(400).json({ message: 'نوع إجازة غير صالح' });

    // The notice rule is the company's, whoever files.
    const notice = evaluateAdvanceNotice(lt, startDate);
    const wantsOverride = req.body.policyOverride === true && hrStaffReq(req);
    if (!notice.satisfied && !wantsOverride) {
      return res.status(400).json({ message: notice.message, code: 'ADVANCE_NOTICE_REQUIRED', policy: { requiredDays: notice.requiredDays, daysAhead: notice.daysAhead, leaveType: lt.code } });
    }
    const countsFridays = fridayRuleOf(null, lt);
    const days = leaveDays(startDate, endDate, { countFridays: countsFridays });
    if (!days || days < 1) return res.status(400).json({ message: NO_WORKDAY, code: 'NO_LEAVE_DAYS' });
    const clash = await findLeaveClash(employee, startDate, endDate);
    if (clash) return res.status(400).json({ message: clashMessage(clash), code: 'LEAVE_OVERLAP' });

    let attachments = [];
    try { attachments = saveLeaveFiles(req.body.files, req.user); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    const login = emp.user || (await User.findOne({ linkedEmployee: emp._id, isActive: { $ne: false } }).select('_id').lean())?._id;
    const { balance } = await computeEmployeeBalance(employee);
    const filer = fullName(req.user);
    const leave = await LeaveRequest.create({
      attachments,
      employee,
      requester: login || req.user._id,
      manager: req.user._id,
      filedByManager: true,
      filedBy: req.user._id,
      filedByName: filer,
      leaveType,
      leaveTypeCode: lt.code,
      startDate, endDate, days, countsFridays, reason: String(reason || '').trim(),
      ...chain.startOf(false),
      // The manager filed it, so he signs both the employee's and his own box (resolved live on the sheet, see services/leaveSheet).
      managerDecision: { by: req.user._id, at: new Date(), decision: 'approved', note: `قدّم الطلبَ المديرُ ${filer} بنفسه | Filed by the manager`, signature: await defaultSignatureOf(req.user._id) },
      balanceSnapshot: {
        accrued: balance.accrued,
        requested: days,
        remainingAfter: lt.affectsBalance ? Math.round((balance.available - days) * 100) / 100 : balance.available,
      },
      advanceNotice: {
        required: notice.required, requiredDays: notice.requiredDays, daysAhead: notice.daysAhead, satisfied: notice.satisfied,
        overridden: !notice.satisfied, overriddenBy: notice.satisfied ? undefined : req.user._id,
        overrideReason: notice.satisfied ? '' : String(req.body.overrideReason || '').trim().slice(0, 300),
      },
    });

    const name = emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    const ref = { relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' };
    try {
      await logAudit({
        user: req.user._id, action: 'leave_filed_by_manager', entity: 'LeaveRequest', entityId: leave._id,
        changes: { after: { employeeName: name, startDate, endDate, days, filedBy: filer } }, ipAddress: req.ip,
      });
    } catch (e) { /* the request stands even if its log line fails */ }
    await notifyStage(leave.currentStage, leave, `قدّم ${filer} إجازة ${days} يوم لـ ${name} (${startDate} → ${endDate}).`);
    if (login && String(login) !== String(req.user._id)) {
      await notifyUser(login, { title: 'قدّم مديرك إجازة لك', message: `${filer} قدّم لك إجازة ${days} يوم (${startDate} → ${endDate}) — هي الآن عند ${chain.STAGE_AR[leave.currentStage] || ''}.`, ...ref });
    }
    await announceLeave(leave);
    const populated = await populateLeave(LeaveRequest.findById(leave._id)).select(NO_SIG).lean();
    res.status(201).json({ leave: populated });
  } catch (error) {
    console.error('createTeamLeave error:', error);
    return sendMongooseError(res, error, 'تعذّر تقديم الإجازة');
  }
};

/**
 * POST /api/hr/leaves/backdated
 * Record a leave that already happened (HR).
 * It skips the approval chain: the absence is past, so manager approval a month later is meaningless and the advance-notice period does not apply. It is recorded as approved and deducted from the balance like others.
 * Marked `backdated` with the recorder's name, to keep 'requested then approved' distinct from 'told, then recorded'.
 */
exports.createBackdatedLeave = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { employee, leaveType, startDate, endDate, reason } = req.body;
    if (!employee || !mongoose.isValidObjectId(employee)) return res.status(400).json({ message: 'اختر الموظّف' });
    if (!leaveType || !startDate || !endDate) return res.status(400).json({ message: 'نوع الإجازة وتاريخا البداية والنهاية مطلوبة' });
    if (String(endDate) < String(startDate)) return res.status(400).json({ message: 'تاريخ النهاية قبل تاريخ البداية' });

    const emp = await Employee.findById(employee).select('firstName lastName arabicName user').lean();
    if (!emp) return res.status(404).json({ message: 'الموظّف غير موجود' });
    const lt = await LeaveType.findById(leaveType).lean();
    if (!lt) return res.status(400).json({ message: 'نوع إجازة غير صالح' });

    const countsFridays = fridayRuleOf(null, lt);
    const days = leaveDays(startDate, endDate, { countFridays: countsFridays });
    if (!days || days < 1) return res.status(400).json({ message: NO_WORKDAY, code: 'NO_LEAVE_DAYS' });

    // HR may state the deduction explicitly, as at its approval stage; otherwise the leave type decides.
    const rawDeduct = req.body.deductBalance;
    const deductChoice = rawDeduct === true || rawDeduct === 'true' ? true : rawDeduct === false || rawDeduct === 'false' ? false : null;
    const affects = deductChoice !== null ? deductChoice : lt.affectsBalance !== false;

    // No two leaves on the same days, at any open stage or approved: a day is not deducted twice.
    const clash = await findLeaveClash(employee, startDate, endDate);
    if (clash) return res.status(400).json({ message: clashMessage(clash), code: 'LEAVE_OVERLAP' });

    let attachments = [];
    try { attachments = saveLeaveFiles(req.body.files, req.user); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    // Balance is captured before the deduction, as in a normal request, so the reviewer sees the state when the leave occurred.
    const { balance } = await computeEmployeeBalance(employee);
    const now = new Date();
    // `mode: 'manual'` = a leave HR records from the register (past, current or future); otherwise back-dated.
    const manual = req.body.mode === 'manual';
    const stamp = { by: req.user._id, at: now, decision: 'approved', note: String(req.body.note || (manual ? 'تسجيل من الموارد البشرية' : 'قيدٌ بأثر رجعيّ')).slice(0, 300), signature: '' };

    const leave = await LeaveRequest.create({
      employee,
      requester: emp.user || req.user._id,
      leaveType,
      leaveTypeCode: lt.code,
      startDate, endDate, days, countsFridays, plannedEndDate: endDate,
      reason: String(reason || '').trim(),
      attachments,
      status: 'approved',
      currentStage: 'done',
      hrDecision: stamp,
      deductsBalance: deductChoice,
      backdated: !manual,
      manual,
      recordedBy: req.user._id,
      recordedByName: fullName(req.user),
      recordedAt: now,
      balanceSnapshot: {
        accrued: balance.accrued,
        requested: days,
        remainingAfter: affects ? Math.round((balance.available - days) * 100) / 100 : balance.available,
      },
      // The advance-notice period does not apply to a leave that already happened.
      advanceNotice: { required: false, requiredDays: 0, daysAhead: 0, satisfied: true, overridden: false },
    });

    await logAudit({
      user: req.user._id, action: manual ? 'record_manual_leave' : 'record_backdated_leave', entity: 'LeaveRequest', entityId: leave._id,
      changes: { after: { employee: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(), startDate, endDate, days } },
      ipAddress: req.ip,
    });
    if (emp.user) {
      await notifyUser(emp.user, {
        title: 'إجازة مسجَّلة على ملفّك',
        message: `سجّلت الموارد البشريّة إجازة ${days} يوم (${startDate} → ${endDate}).`,
        relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave',
      });
    }

    await syncLeaveStatus(employee);
    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    const after = await computeEmployeeBalance(employee);
    res.status(201).json({ leave: populated, balance: after.balance });
  } catch (error) {
    console.error('createBackdatedLeave error:', error);
    return sendMongooseError(res, error, error.message || 'تعذّر تسجيل الإجازة');
  }
};

/**
 * Edit and delete an employee's leave from HR's leave requests.
 * The requester cannot edit after the first action (updateMyLeave). HR corrects the record: wrong dates, wrong type, duplicate backdated entries. Status and chain stage are untouched; this is data correction, not a decision, and the balance follows because it is computed from approved leaves.
 */
exports.updateLeave = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'الطلب غير موجود' });

    const before = { leaveType: String(leave.leaveType), startDate: leave.startDate, endDate: leave.endDate, days: leave.days, reason: leave.reason };
    const { leaveType, startDate, endDate, reason } = req.body;
    const oldType = await LeaveType.findById(leave.leaveType).select('affectsBalance').lean();
    const oldDeducts = leaveDeducts({ deductsBalance: leave.deductsBalance, leaveType: oldType });
    let newType = oldType;
    if (leaveType && String(leaveType) !== String(leave.leaveType)) {
      if (!mongoose.isValidObjectId(leaveType)) return res.status(400).json({ message: 'نوع إجازة غير صالح' });
      newType = await LeaveType.findById(leaveType).lean();
      if (!newType) return res.status(400).json({ message: 'نوع إجازة غير صالح' });
      leave.leaveType = leaveType;
      leave.leaveTypeCode = newType.code;
      // A new type brings its own Friday rule.
      leave.countsFridays = fridayRuleOf(leave, newType);
    }
    if (startDate) leave.startDate = startDate;
    if (endDate) leave.endDate = endDate;
    if (String(leave.endDate) < String(leave.startDate)) return res.status(400).json({ message: 'تاريخ النهاية قبل تاريخ البداية' });
    const days = leaveDaysOf(leave, leave.startDate, leave.endDate);
    if (!days || days < 1) return res.status(400).json({ message: NO_WORKDAY, code: 'NO_LEAVE_DAYS' });
    if (reason !== undefined) leave.reason = String(reason || '').trim();

    // No two leaves on the same days, and a request does not overlap itself.
    if (['approved', ...chain.OPEN_STATUSES].includes(leave.status)) {
      const clash = await LeaveRequest.findOne({
        _id: { $ne: leave._id }, employee: leave.employee,
        status: { $in: ['approved', ...chain.OPEN_STATUSES] },
        startDate: { $lte: leave.endDate }, endDate: { $gte: leave.startDate },
      }).select('startDate endDate').lean();
      if (clash) return res.status(400).json({ message: `تتداخل مع إجازةٍ مسجّلة (${clash.startDate} → ${clash.endDate})` });
    }

    // The snapshot stays as it was when requested; only the duration-related parts are corrected.
    const oldDays = leave.days || 0;
    leave.days = days;
    if (leave.balanceSnapshot && typeof leave.balanceSnapshot.remainingAfter === 'number') {
      const oldCut = oldDeducts ? oldDays : 0;
      const newCut = leaveDeducts({ deductsBalance: leave.deductsBalance, leaveType: newType || oldType }) ? days : 0;
      leave.balanceSnapshot.requested = days;
      leave.balanceSnapshot.remainingAfter = Math.round((leave.balanceSnapshot.remainingAfter + oldCut - newCut) * 100) / 100;
    }

    // A correction redefines the plan, unless a return or extension already moved the end.
    if (!leave.returnState && !(leave.extensions || []).length) leave.plannedEndDate = leave.endDate;
    await leave.save();
    await logAudit({
      user: req.user._id, action: 'update_leave', entity: 'LeaveRequest', entityId: leave._id,
      changes: { before, after: { leaveType: String(leave.leaveType), startDate: leave.startDate, endDate: leave.endDate, days: leave.days, reason: leave.reason } },
      ipAddress: req.ip,
    });
    if (leave.requester && String(leave.requester) !== String(req.user._id)) {
      await notifyUser(leave.requester, {
        title: 'عُدِّلت إجازتك',
        message: `عدّلت الموارد البشريّة إجازتك إلى ${leave.days} يوم (${leave.startDate} → ${leave.endDate}).`,
        relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave',
      });
    }
    await announceLeave(leave);
    try { emitToAll('hr:leave', { id: String(leave._id) }); } catch (e) {}
    await syncLeaveStatus(leave.employee);

    const populated = await populateLeave(LeaveRequest.findById(leave._id)).select(NO_SIG).lean();
    res.json({ leave: populated });
  } catch (error) {
    console.error('updateLeave error:', error);
    return sendMongooseError(res, error, 'تعذّر تعديل الإجازة');
  }
};

/**
 * Return / extension / no-show on an approved leave (HR staff).
 * Logic lives in utils/leaveReturn; the balance follows the corrected end date.
 */
const leaveReturnAction = (fn, action, pick) => async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const LR = require('../utils/leaveReturn');
    const result = await LR[fn](req.params.id, pick(req.body || {}), req.user);
    await logAudit({
      user: req.user._id, action, entity: 'LeaveRequest', entityId: result.leave._id,
      changes: { after: { ...pick(req.body || {}), endDate: result.leave.endDate, days: result.leave.days, returnState: result.leave.returnState } },
      ipAddress: req.ip,
    }).catch(() => {});
    const populated = await populateLeave(LeaveRequest.findById(result.leave._id)).select(NO_SIG).lean();
    const { balance } = await computeEmployeeBalance(result.leave.employee);
    res.json({ ...result, leave: populated, balance });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fn} error:`, error);
    return sendMongooseError(res, error, 'تعذّر حفظ الإجراء');
  }
};

// POST /leaves/:id/return { returnDate, startsSameDay, note }
exports.recordLeaveReturn = leaveReturnAction('recordReturn', 'leave_return',
  (b) => ({ returnDate: String(b.returnDate || ''), startsSameDay: b.startsSameDay === true, note: String(b.note || '').trim().slice(0, 500) }));
// POST /leaves/:id/extend { newEndDate, note }
exports.extendLeave = leaveReturnAction('extendLeave', 'leave_extend',
  (b) => ({ newEndDate: String(b.newEndDate || ''), note: String(b.note || '').trim().slice(0, 500) }));
// POST /leaves/:id/no-show { note }
exports.markLeaveNoShow = leaveReturnAction('markNoShow', 'leave_no_show',
  (b) => ({ note: String(b.note || '').trim().slice(0, 500) }));

exports.deleteLeave = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'الطلب غير موجود' });
    const emp = await Employee.findById(leave.employee).select('firstName lastName arabicName').lean();
    const files = [
      ...(leave.attachments || []),
      ...['managerDecision', 'hrDecision', 'financeDecision', 'executiveDecision'].flatMap((k) => leave[k]?.attachments || []),
      ...(leave.thread || []).flatMap((m) => m.attachments || []),
    ].map((a) => a.fileUrl).filter(Boolean);
    const { requester, manager, startDate, endDate, days, status } = leave;

    await leave.deleteOne();
    for (const url of files) { try { deleteStoredFile(url); } catch (e) {} }

    await logAudit({
      user: req.user._id, action: 'delete_leave', entity: 'LeaveRequest', entityId: leave._id,
      changes: { before: { employee: emp ? (emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()) : String(leave.employee), startDate, endDate, days, status } },
      ipAddress: req.ip,
    });
    if (requester && String(requester) !== String(req.user._id)) {
      await notifyUser(requester, {
        title: 'حُذفت إجازة من ملفّك',
        message: `حذفت الموارد البشريّة إجازة ${days} يوم (${startDate} → ${endDate}).`,
        relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave',
      });
    }
    if (manager) { try { emitToUser(String(manager), 'hr:leave', {}); } catch (e) {} }
    try { emitToAll('hr:leave', {}); } catch (e) {}
    await syncLeaveStatus(leave.employee);
    res.json({ message: 'حُذفت الإجازة' });
  } catch (error) {
    console.error('deleteLeave error:', error);
    res.status(500).json({ message: 'تعذّر حذف الإجازة' });
  }
};

exports.decideLeave = async (req, res) => {
  try {
    const { decision, note, signatureId } = req.body;
    // 'info' is a request for clarification from the requester, not a rejection. See leaveChain.
    if (!['approved', 'rejected', 'info'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approved, rejected or info' });
    }
    if (decision === 'info' && !String(note || '').trim()) {
      return res.status(400).json({ message: 'اكتب سؤالك أو ما تريد تعديله' });
    }
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (['approved', 'rejected', 'cancelled'].includes(leave.status)) {
      return res.status(400).json({ message: 'This request has already been finalised' });
    }


    // Optional: the approver signs. Resolve the chosen signature (by id) from
    // their own signatures and snapshot it onto this decision.
    // An approval carries the approver's signature: the one picked, else his default from self-service. A rejection or a question signs nothing.
    const signature = decision === 'approved' ? await defaultSignatureOf(req.user._id, signatureId) : '';
    let decisionFiles = [];
    try { decisionFiles = saveLeaveFiles(req.body.files, req.user); }
    catch (e) { return res.status(400).json({ message: e.message }); }
    const stamp = { by: req.user._id, at: new Date(), decision, note: note || '', signature, attachments: decisionFiles };

    // A decision is made only at the request's current stage, by that stage's owner (utils/leaveChain).
    const stage = leave.currentStage;

    if (stage === 'employee') {
      return res.status(400).json({ message: 'الطلب عند صاحبه للردّ على استفسار' });
    }
    if (!chain.STAGES.includes(stage)) {
      return res.status(400).json({ message: 'هذا الطلب ليس في محطّة قرار' });
    }
    if (!chain.canActAt(stage, req.user, leave)) {
      return res.status(403).json({ message: 'You cannot act on this request at its current stage' });
    }

    // HR's approval states whether the days come off the balance; nothing is assumed from the leave type.
    let deduct = null;
    if (stage === 'hr' && decision === 'approved') {
      const raw = req.body.deductBalance;
      deduct = raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null;
      if (deduct === null) {
        return res.status(400).json({ message: 'اختر: تُخصم الإجازة من الرصيد أم بدون خصم | Choose whether the leave is deducted from the balance', code: 'DEDUCTION_CHOICE_REQUIRED' });
      }
    }

    leave[chain.DECISION_FIELD[stage]] = stamp;
    if (deduct !== null) {
      const snap = leave.balanceSnapshot;
      const lt = await LeaveType.findById(leave.leaveType).select('affectsBalance').lean();
      // The snapshot was estimated from the leave type; restate it with HR's choice.
      if (snap && typeof snap.remainingAfter === 'number') {
        const before = snap.remainingAfter + (leaveDeducts({ deductsBalance: leave.deductsBalance, leaveType: lt }) ? (leave.days || 0) : 0);
        snap.remainingAfter = Math.round((before - (deduct ? (leave.days || 0) : 0)) * 100) / 100;
      }
      leave.deductsBalance = deduct;
    }

    if (decision === 'rejected') {
      leave.status = 'rejected';
      leave.currentStage = 'done';
    } else if (decision === 'info') {
      // A question, not a rejection: the request returns to its owner to answer, edit or attach a document.
      leave[chain.DECISION_FIELD[stage]] = undefined;      // Not decided yet.
      leave.thread.push({
        kind: 'question', stage, by: req.user._id,
        byName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        text: note || '',
      });
      chain.askEmployee(leave);
    } else {
      chain.advance(leave, stage);
    }
    await leave.save();
    // A named entry, so the log reads «الموافقة على إجازة …» instead of the generic path the safety net writes.
    try {
      const emp = await Employee.findById(leave.employee).select('arabicName firstName lastName employeeNumber').lean();
      const stageAr = chain.STAGE_AR[stage] || stage;
      await logAudit({
        user: req.user, action: { approved: 'leave_approve', rejected: 'leave_reject', info: 'leave_ask' }[decision], entity: 'LeaveRequest', entityId: leave._id,
        changes: { after: { employeeName: emp ? (emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()) : '', stage: stageAr,
          startDate: leave.startDate, endDate: leave.endDate, days: leave.days, ...(deduct !== null ? { deductsBalance: deduct } : {}), ...(note ? { note } : {}) } },
        ipAddress: req.ip,
      });
    } catch (e) { /* the decision stands even if its log line fails */ }

    // Notify the requester always, plus the next stage's owners. A mid-chain approver used to tell the requester it was approved when it had only moved on, so he planned travel on partial approval. The message now says where the request stands.
    const { STAGE_AR } = chain;
    const ref = { relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' };
    const period = `${leave.startDate} → ${leave.endDate}`;

    if (leave.status === 'info_requested') {
      await notifyLeaveOwners(leave, {
        title: 'مطلوب إيضاح على طلب الإجازة',
        message: `${STAGE_AR[stage] || 'أحد المراجعين'} طلب إيضاحًا: ${note || ''}`.trim(),
        ...ref,
      });
    } else if (leave.status === 'approved') {
      const cut = leaveDeducts(await LeaveRequest.findById(leave._id).populate('leaveType', 'affectsBalance').select('deductsBalance leaveType').lean());
      await notifyLeaveOwners(leave, { title: 'اعتُمدت إجازتك', message: `إجازتك (${period}) اعتُمدت بعد اكتمال الموافقات حتى رئيس مجلس الإدارة — ${cut ? `تُخصم ${leave.days} يوم من الرصيد` : 'بدون خصم من الرصيد'}.`, ...ref });
      await notifyHR({ title: 'إجازة اعتُمدت', message: `اكتملت سلسلةُ الموافقات على إجازة (${period}).`, ...ref });
    } else if (leave.status === 'rejected') {
      await notifyLeaveOwners(leave, { title: 'رُفض طلب الإجازة', message: `رفضت ${STAGE_AR[stage] || ''} طلبك (${period}). ${note || ''}`.trim(), ...ref });
    } else {
      // Moved to the next stage: the requester is told where it stands and the stage owners are notified.
      const next = leave.currentStage;
      await notifyLeaveOwners(leave, {
        title: 'تقدّم طلب الإجازة',
        message: `وافقت ${STAGE_AR[stage] || ''} على طلبك (${period}) — وهو الآن عند ${STAGE_AR[next] || ''}.`,
        ...ref,
      });
      await notifyStage(next, leave, `طلب إجازة (${period}) وصل محطّتكم بعد موافقة ${STAGE_AR[stage] || ''}.`);
    }
    await announceLeave(leave);
    if (leave.status === 'approved') {
      if (!leave.plannedEndDate) { leave.plannedEndDate = leave.endDate; await leave.save(); }
      await syncLeaveStatus(leave.employee);
    }

    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    res.json({ leave: populated });
  } catch (error) {
    console.error('decideLeave error:', error);
    res.status(500).json({ message: 'Failed to update leave request' });
  }
};

/**
 * The requester's reply to a question - POST /leaves/:id/reply { text, attachment }
 * The chain restarts: the approvals are cleared and the request returns to the direct manager as new, since an edited or extended request is no longer the one approved earlier. The question and reply stay in the request log.
 */
exports.replyToLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (!ownsLeave(leave, req.user)) {
      return res.status(403).json({ message: 'Not your request' });
    }
    if (leave.status !== 'info_requested') {
      return res.status(400).json({ message: 'لا يوجد استفسار مفتوح على هذا الطلب' });
    }
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ message: 'اكتب ردّك' });

    // The attachment is written to disk, not inside the document: the inbox reads dozens of requests at once and a base64 receipt in the document makes the list pull megabytes on a throughput-limited database.
    let stored = null;
    if (req.body.attachment) {
      try { stored = saveEmployeeFile(req.body.attachment, req.body.attachmentName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }

    leave.thread.push({
      kind: 'reply',
      by: req.user._id,
      byName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
      text,
      attachment: stored ? stored.fileUrl : '',
      attachmentName: stored ? (stored.fileName || String(req.body.attachmentName || '')) : '',
    });

    chain.restart(leave, req.user);
    await leave.save();

    if (leave.currentStage === 'manager' && leave.manager) {
      try { emitToUser(String(leave.manager), 'hr:leave', { id: String(leave._id) }); } catch (e) { /* */ }
      await notifyUser(leave.manager, {
        title: 'طلب إجازة عاد بعد الردّ',
        message: 'ردّ الموظّف على الاستفسار — الطلب ينتظر موافقتك من جديد.',
        relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave',
      });
    } else {
      await notifyStage(leave.currentStage, leave, 'ردّ الموظّف على الاستفسار — الطلب عاد إلى بداية المسار.');
    }
    await announceLeave(leave);

    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    res.json({ leave: populated });
  } catch (error) {
    console.error('replyToLeave error:', error);
    res.status(500).json({ message: 'Failed to reply' });
  }
};

exports.cancelMyLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (!ownsLeave(leave, req.user)) return res.status(403).json({ message: 'Not your request' });
    // The owner (or the manager who filed it) may withdraw anything not finally decided, including requests returned with a question.
    if (!chain.OPEN_STATUSES.includes(leave.status)) return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    leave.status = 'cancelled';
    leave.currentStage = 'done';
    await leave.save();
    await announceLeave(leave);
    res.json({ leave });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel leave request' });
  }
};

/**
 * While pending, it belongs to its owner.
 * Correcting a mistake used to mean cancelling and rewriting, leaving the manager two requests. Now edit and delete are allowed while nobody has acted on it. The first action by the manager or HR locks it: changing a date after approval makes the approval cover something other than what is approved.
 * The lock is measured by decision, not status alone: a request awaiting HR may already have manager approval.
 */
// Measure by decision, not stage: someone with no manager starts after the manager stage, so requiring awaiting-manager locked out requests nobody had touched.
// A department manager's own approval at the manager stage (selfManaged) is not someone else's action, so it does not lock his request.
const ownApproval = (l, f) => f === 'managerDecision' && l[f]?.by && String(l[f].by._id || l[f].by) === String(l.requester?._id || l.requester);
const leaveIsUntouched = (l) => chain.OPEN_STATUSES.includes(l.status) && l.status !== 'info_requested'
  && Object.values(chain.DECISION_FIELD).every((f) => !l[f]?.at || ownApproval(l, f));

exports.updateMyLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (String(leave.requester) !== String(req.user._id)) return res.status(403).json({ message: 'ليس طلبك' });
    if (!leaveIsUntouched(leave)) {
      return res.status(400).json({ message: 'لا يُعدَّل الطلب بعد أن اتُّخذ فيه إجراء — ألغِه واكتب غيره' });
    }

    const { leaveType, startDate, endDate, reason } = req.body;
    if (leaveType) {
      const lt = await LeaveType.findById(leaveType).lean();
      if (!lt) return res.status(400).json({ message: 'نوع إجازة غير صالح' });
      // Recheck the notice period: editing the date to tomorrow would bypass the rule and admit a date that would not have been accepted originally.
      const notice = evaluateAdvanceNotice(lt, startDate || leave.startDate);
      if (!notice.satisfied && !(req.body.policyOverride === true && hrStaffReq(req))) {
        return res.status(400).json({ message: notice.message, code: 'ADVANCE_NOTICE_REQUIRED' });
      }
      leave.leaveType = leaveType;
      leave.countsFridays = fridayRuleOf(leave, lt);
    }
    if (startDate) leave.startDate = startDate;
    if (endDate) leave.endDate = endDate;
    if (reason !== undefined) leave.reason = reason;
    if (startDate || endDate) {
      if (String(leave.endDate) < String(leave.startDate)) return res.status(400).json({ message: 'تاريخ النهاية قبل تاريخ البداية' });
      leave.days = leaveDaysOf(leave, leave.startDate, leave.endDate);
      if (!leave.days) return res.status(400).json({ message: NO_WORKDAY, code: 'NO_LEAVE_DAYS' });
      const clash = await findLeaveClash(leave.employee, leave.startDate, leave.endDate, leave._id);
      if (clash) return res.status(400).json({ message: clashMessage(clash), code: 'LEAVE_OVERLAP' });
    }

    // Attachments can be added or removed while the request is untouched; a forgotten medical report should not force cancelling and rewriting.
    if (Array.isArray(req.body.files) && req.body.files.length) {
      try { leave.attachments.push(...saveLeaveFiles(req.body.files, req.user)); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }
    if (Array.isArray(req.body.removeAttachments)) {
      const { deleteStoredFile } = require('../utils/fileStore');
      for (const attId of req.body.removeAttachments) {
        const att = leave.attachments.id(attId);
        if (!att) continue;
        const url = att.fileUrl;
        att.deleteOne();
        deleteStoredFile(url);
      }
    }

    await leave.save();
    await announceLeave(leave);
    const populated = await LeaveRequest.findById(leave._id).populate('leaveType', 'nameAr nameEn code').lean();
    res.json({ leave: populated });
  } catch (error) {
    console.error('updateMyLeave error:', error);
    return sendMongooseError(res, error, 'تعذّر تعديل الطلب');
  }
};

exports.deleteMyLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (String(leave.requester) !== String(req.user._id)) return res.status(403).json({ message: 'ليس طلبك' });
    if (!leaveIsUntouched(leave)) {
      return res.status(400).json({ message: 'لا يُحذف الطلب بعد أن اتُّخذ فيه إجراء — ألغِه بدل ذلك' });
    }
    await leave.deleteOne();
    // HR counts it too when the requester has no manager, so everyone on the chain hears it.
    await announceLeave(leave);
    res.json({ message: 'حُذف الطلب' });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر حذف الطلب' });
  }
};

// ── HR requests (general) ────────────────────────────────────────────────────
const populateRequest = (q) => q
  .populate('requester', 'firstName lastName email')
  .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId idType employeeNumber')
  .populate('assignedTo', 'firstName lastName')
  .populate('thread.sender', 'firstName lastName role');

exports.listRequests = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    // An archived employee's requests are hidden, by his file or his login account.
    const sets = await endedStaff();
    const requests = await populateRequest(HRRequest.find(andAll(filter, notArchivedRef(sets, 'employee'), notArchivedUserRef(sets, 'requester')))).sort({ updatedAt: -1 }).limit(1000).lean();
    res.json({ requests });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load requests' });
  }
};

exports.listMyRequests = async (req, res) => {
  try {
    const requests = await populateRequest(HRRequest.find({ requester: req.user._id })).sort({ updatedAt: -1 }).lean();
    res.json({ requests });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load your requests' });
  }
};

exports.createMyRequest = async (req, res) => {
  try {
    const { category, subject, body } = req.body;
    if (!subject || !subject.trim()) return res.status(400).json({ message: 'Subject is required' });
    await ensureSelfEmployee(req);
    const request = await HRRequest.create({
      requester: req.user._id,
      employee: req.user.linkedEmployee || undefined,
      manager: req.user.manager || undefined,
      category: category || 'other',
      subject: subject.trim(),
      thread: body && body.trim() ? [{ sender: req.user._id, body: body.trim() }] : [],
      status: 'open',
      readByRequester: true,
      readByHR: false,
    });
    await notifyHR({ title: 'New HR request', message: `${fullName(req.user)}: ${subject.trim().slice(0, 80)}`, relatedEntity: 'HRRequest', relatedEntityId: request._id, event: 'hr:request' });
    const populated = await populateRequest(HRRequest.findById(request._id)).lean();
    res.status(201).json({ request: populated });
  } catch (error) {
    console.error('createMyRequest error:', error);
    return sendMongooseError(res, error, 'Failed to create request');
  }
};

exports.replyRequest = async (req, res) => {
  try {
    const request = await HRRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    const staff = hrStaffReq(req);
    const owner = String(request.requester) === String(req.user._id);
    if (!staff && !owner) return res.status(403).json({ message: 'No access to this request' });

    const { body, link, files } = req.body;
    // Attachments are saved with the message. They arrive as a data URL in the same request (no multer here) and are written under uploads/hr, which the daily backup covers.
    const attachments = [];
    for (const f of Array.isArray(files) ? files.slice(0, 10) : []) {
      if (!f?.dataUrl) continue;
      try {
        const stored = saveUploadFile(f.dataUrl, 'hr', f.fileName || '');
        attachments.push({ title: String(f.title || f.fileName || '').trim() || stored.fileName, ...stored });
      } catch (e) { return res.status(400).json({ message: e.message }); }
    }
    if (!String(body || '').trim() && !String(link || '').trim() && !attachments.length) {
      return res.status(400).json({ message: 'اكتب رسالةً أو أرفق ملفًّا' });
    }
    request.thread.push({ sender: req.user._id, body: (body || '').trim(), link: (link || '').trim(), attachments });

    if (staff) {
      request.readByHR = true;
      request.readByRequester = false;
      if (request.status === 'open') request.status = 'in_progress';
      if (!request.assignedTo) request.assignedTo = req.user._id;
      await notifyUser(request.requester, { title: 'HR replied to your request', message: (body || 'A link was shared').slice(0, 100), relatedEntity: 'HRRequest', relatedEntityId: request._id, event: 'hr:request' });
    } else {
      request.readByRequester = true;
      request.readByHR = false;
      await notifyHR({ title: 'Reply on HR request', message: `${fullName(req.user)} replied.`, relatedEntity: 'HRRequest', relatedEntityId: request._id, event: 'hr:request' });
    }
    await request.save();
    const populated = await populateRequest(HRRequest.findById(request._id)).lean();
    res.json({ request: populated });
  } catch (error) {
    console.error('replyRequest error:', error);
    res.status(500).json({ message: 'Failed to reply' });
  }
};

exports.updateRequestStatus = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const request = await HRRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    const { status } = req.body;
    if (!['open', 'in_progress', 'received', 'resolved', 'closed'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    request.status = status;
    await request.save();
    await notifyUser(request.requester, { title: 'Request status updated', message: `Your request is now: ${status}.`, relatedEntity: 'HRRequest', relatedEntityId: request._id, event: 'hr:request' });
    res.json({ request });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update request');
  }
};

// ── Assets / custody ─────────────────────────────────────────────────────────

// SIM cards sit on IT's register for convenience, but the line itself is an HR
// matter (it follows the employee, not the device), so HR keeps full control of
// them regardless of who issued them.
const HR_MANAGED_TYPES = new Set(['sim']);

// Everything else handed out by the Software & IT section stays IT's to manage.
// HR sees every detail of it (who holds what, since when, serial, notes) but the
// edit / return / delete actions belong to /system/it/custody, so they are
// refused here. super_admin is exempt — it owns every section anyway.
const denyItOwned = (req, res, asset) => {
  if (asset.issuedBySection !== 'it' || require('../config/constants').isTopRole(req.user.role)) return false;
  if (HR_MANAGED_TYPES.has(asset.type)) return false;
  res.status(403).json({ message: 'This is IT custody — view only. It is managed from the Software & IT section.' });
  return true;
};

exports.listAssets = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // HR custody is strictly employee-held property. Items sitting in the IT
    // store (`status: 'in_stock'`, `employee: null`) live in the SAME collection
    // but are not custody yet, so they must never surface on HR screens.
    const filter = { employee: { $ne: null }, status: { $ne: 'in_stock' } };
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.status && req.query.status !== 'in_stock') filter.status = req.query.status;
    // An archived employee's custody is hidden from the general register; custody of a specific file remains.
    const assets = await Asset.find(req.query.employee ? filter : await withoutArchivedRef(filter))
      .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId idType employeeNumber')
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    res.json({ assets });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load assets' });
  }
};

exports.createAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.employee || !req.body.name) return res.status(400).json({ message: 'Employee and name are required' });
    // The uniform set was removed as a category in HR, as in IT. See config/itCustody.
    const retired = require('../config/itCustody').retiredTypeError(req.body.type);
    if (retired) return res.status(400).json({ message: retired });
    // HR custody is tagged with its department. It used to be saved without one and the form defaults to the laptop type, so a SIM card was recorded as a laptop and showed in IT custody (which sorts by type). A SIM is recognised by name if no type is chosen and saved under communications like the imported Mobily lines; everything else goes to HR.
    const data = { ...req.body };
    if (data.type !== 'sim' && /\bsim\b|شريح|خط (جوال|موبايل)/i.test(String(data.name || ''))) data.type = 'sim';
    data.issuedBySection = data.type === 'sim' ? 'telecom' : 'hr';
    if (data.type === 'sim' && !data.category) data.category = 'TELECOM';
    const asset = await Asset.create({ ...data, createdBy: req.user._id });
    await notifyHR({ title: 'Custody assigned', message: `${asset.name}`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    const emp = await Employee.findById(asset.employee).select('user').lean();
    if (emp?.user) await notifyUser(emp.user, { title: 'New custody item', message: `${asset.name} was assigned to you.`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    res.status(201).json({ asset });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create asset');
  }
};

exports.updateAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    // IT store stock lives in this collection but is not custody — HR never
    // lists it, so reaching one by id means something went wrong upstream.
    if (asset.status === 'in_stock') return res.status(404).json({ message: 'Asset not found' });
    if (denyItOwned(req, res, asset)) return;
    // The uniform set was removed as a category in HR, as in IT. See config/itCustody.
    const retired = require('../config/itCustody').retiredTypeError(req.body.type, asset.type);
    if (retired) return res.status(400).json({ message: retired });
    ['name', 'type', 'serialNumber', 'brand', 'model', 'condition', 'value', 'assignedDate', 'notes'].forEach((f) => {
      if (req.body[f] !== undefined) asset[f] = req.body[f];
    });
    await asset.save();
    try { emitToUser(String(req.user._id), 'hr:asset', { id: String(asset._id) }); } catch (e) {}
    res.json({ asset });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update asset');
  }
};

// Returning custody is the gate that unlocks contract termination — emit an
// employee event too so any open profile/contract screen refreshes instantly.
exports.returnAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    // IT store stock lives in this collection but is not custody — HR never
    // lists it, so reaching one by id means something went wrong upstream.
    if (asset.status === 'in_stock') return res.status(404).json({ message: 'Asset not found' });
    if (denyItOwned(req, res, asset)) return;
    // Captured before the shelf branch below can clear it — the profile screen
    // still has to be told whose custody changed.
    const holderId = String(asset.employee || '');
    asset.status = 'returned';
    asset.returnedDate = req.body.returnedDate || new Date().toISOString().slice(0, 10);
    if (req.body.returnedCondition) asset.returnedCondition = req.body.returnedCondition;
    asset.returnedTo = req.user._id;
    // Opt-in: gear that goes back on the HR shelf to be handed to the next
    // person, rather than being retired. Default stays the old terminal
    // 'returned' so every existing caller behaves exactly as before.
    if (req.body.toStock && asset.issuedBySection === 'hr') {
      asset.status = 'in_stock';
      asset.employee = null;
      asset.assignedDate = undefined;
    }
    await asset.save();
    await notifyHR({ title: 'Custody returned', message: `${asset.name} returned`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    try { emitToUser(String(req.user._id), 'hr:employee', { id: holderId }); } catch (e) {}
    res.json({ asset });
  } catch (error) {
    res.status(500).json({ message: 'Failed to return asset' });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Scoped so an HR delete can never reach an IT store item (see updateAsset).
    const asset = await Asset.findOne({ _id: req.params.id, status: { $ne: 'in_stock' } });
    if (!asset) return res.json({ message: 'Asset deleted' });
    if (denyItOwned(req, res, asset)) return;
    await asset.deleteOne();
    res.json({ message: 'Asset deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete asset' });
  }
};

// HR store
// HR keeps its own shelf (uniforms, safety gear, access cards, office kit), separate from the IT store. Both live in the one Asset collection so a handed-out item is custody without changing collections, and are kept apart by `issuedBySection`. Everything below is scoped to 'hr'; the IT endpoints are scoped away from it.
const HR_STOCK_EDITABLE = [
  'name', 'type', 'serialNumber', 'brand', 'model', 'condition', 'value',
  'notes', 'quantity', 'location', 'specs',
];
const HR_STORE = { status: 'in_stock', issuedBySection: 'hr' };

const pickFields = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

exports.listStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = { ...HR_STORE };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.condition) filter.condition = req.query.condition;
    const items = await Asset.find(filter)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load stock items' });
  }
};

exports.createStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'Item name is required' });
    }
    // The uniform set was removed as a category in HR, as in IT. See config/itCustody.
    const retired = require('../config/itCustody').retiredTypeError(req.body.type);
    if (retired) return res.status(400).json({ message: retired });
    const data = pickFields(req.body, HR_STOCK_EDITABLE);
    if (data.quantity === undefined || Number(data.quantity) < 1) data.quantity = 1;
    data.status = 'in_stock';
    data.employee = null;
    data.issuedBySection = 'hr';
    data.category = 'HR';
    data.createdBy = req.user._id;
    const item = await Asset.create(data);
    res.status(201).json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create stock item');
  }
};

exports.updateStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Scoped to the HR shelf, so this can never reach an IT store item.
    const item = await Asset.findOne({ _id: req.params.id, ...HR_STORE });
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    // The uniform set was removed as a category in HR, as in IT. See config/itCustody.
    const retired = require('../config/itCustody').retiredTypeError(req.body.type, item.type);
    if (retired) return res.status(400).json({ message: retired });
    Object.assign(item, pickFields(req.body, HR_STOCK_EDITABLE));
    await item.save();
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update stock item');
  }
};

exports.deleteStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Only shelf stock — deleting an assigned item here would wipe someone's
    // custody record.
    const item = await Asset.findOneAndDelete({ _id: req.params.id, ...HR_STORE });
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    res.json({ message: 'Stock item deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete stock item' });
  }
};

// The handover: in_stock → assigned, same document, so the item keeps its
// serial and its history and lands on the employee's HR profile at once.
exports.assignFromStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.employee) return res.status(400).json({ message: 'Employee is required' });

    const item = await Asset.findOne({ _id: req.params.id, ...HR_STORE });
    if (!item) return res.status(404).json({ message: 'Stock item not found or already handed out' });

    const employee = await Employee.findById(req.body.employee).select('_id user').lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    item.employee = employee._id;
    item.status = 'assigned';
    item.assignedDate = req.body.assignedDate || new Date().toISOString().slice(0, 10);
    item.assignedBy = req.user._id;
    if (req.body.condition) item.condition = req.body.condition;
    if (req.body.notes) item.notes = req.body.notes;
    // The item has left the shelf — clear the leftovers from its last return.
    item.returnedDate = undefined;
    item.returnedCondition = undefined;
    item.returnedTo = undefined;
    await item.save();

    await notifyHR({ title: 'Custody assigned', message: `${item.name}`, relatedEntity: 'Asset', relatedEntityId: item._id, event: 'hr:asset' });
    if (employee.user) await notifyUser(employee.user, { title: 'New custody item', message: `${item.name} was assigned to you.`, relatedEntity: 'Asset', relatedEntityId: item._id, event: 'hr:asset' });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to assign stock item');
  }
};

// Company licenses and subscriptions
exports.listLicenses = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, category, location } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (location) filter.location = location;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { category: rx }, { location: rx }, { duration: rx }];
    }
    const licenses = await CompanyLicense.find(filter).sort({ expiryDate: 1 }).limit(2000).lean();
    res.json({ licenses });
  } catch (error) {
    console.error('listLicenses error:', error);
    res.status(500).json({ message: 'Failed to load licenses' });
  }
};

// The licenses page listens to `hr:license` on web and app, and the event was never emitted.
const announceLicense = () => { try { require('../websocket/socketManager').emitToAll('hr:license', { at: Date.now() }); } catch (_) { /* */ } };
exports.createLicense = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.name || !req.body.category) return res.status(400).json({ message: 'Category and name are required' });
    const license = await CompanyLicense.create({ ...req.body, createdBy: req.user._id });
    await notifyHR({ title: 'License added', message: license.name, relatedEntity: 'CompanyLicense', relatedEntityId: license._id, event: 'hr:license' });
    announceLicense();
    res.status(201).json({ license });
  } catch (error) {
    console.error('createLicense error:', error);
    return sendMongooseError(res, error, 'Failed to create license');
  }
};

exports.updateLicense = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const license = await CompanyLicense.findById(req.params.id);
    if (!license) return res.status(404).json({ message: 'License not found' });
    ['category', 'name', 'duration', 'expiryDate', 'location', 'notes'].forEach((f) => {
      if (req.body[f] !== undefined) license[f] = req.body[f];
    });
    await license.save();
    try { emitToUser(String(req.user._id), 'hr:license', { id: String(license._id) }); } catch (e) {}
    announceLicense();
    res.json({ license });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update license');
  }
};

exports.deleteLicense = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    await CompanyLicense.findByIdAndDelete(req.params.id);
    announceLicense();
    res.json({ message: 'License deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete license' });
  }
};

// ── Dashboard (HR staff) ─────────────────────────────────────────────────────
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Build an "expiring documents" feed across every dated field on the employee so HR sees ONE list of everything about to lapse (iqama, passport, license ...).
// The documents come from config/hrFields, the same seven as the final master. The list was hand-written and included fields (visa, work permit, Ajeer) not in the master, with stale imported data, so the dashboard showed over 100 expired visas for people nobody asked about.
const EXPIRY_DOCS = require('../config/hrFields').DOCUMENT_GROUPS.map((g) => ({
  field: g.expiryField, type: g.key, en: g.en, ar: g.ar,
}));

// Auto-created login account records are not employees and are excluded from every counter. Without this the dashboard and master disagreed (437 vs 378).
// Scope of the employee count is the current job file, the same one the HR dashboard counts with; two numbers for one department on one screen make readers trust neither. Those who left before the file was built stay as history and are not counted.
// Not restricted to the import file: the old scope `inCurrentMaster: true` is set only by the import script, so employees added in the system later were not counted. The sheet is only the first source of entry; after that the system is the reference and an employee is an employee by record, not by origin. Archived staff are outside this dashboard entirely; their place is the archive page (utils/hrEngagement).
const HR_ONLY = { isHrRecord: { $ne: false }, ...require('../utils/hrEngagement').NOT_ARCHIVED };

exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Same data for every staff viewer — cache briefly so concurrent loads and
    // socket-driven reloads share one computation. See crm dashboard.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:hr:${JSON.stringify(req.query)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);
    const _send = res.json.bind(res);
    // The dashboard filter (department, city, work status, project, nationality, ...) governs every employee number here, as it does the overview (same buildFilter).
    const filtered = Object.keys(req.query || {}).length > 0;
    const HRQ = filtered ? { ...HR_ONLY, $and: [require('./hrMasterController')._buildFilter({ ...req.query })] } : HR_ONLY;
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 30000); return _send(b); };
    const today = new Date().toISOString().slice(0, 10);
    const in60 = addDays(60);
    const in90 = addDays(90);
    // Requests, custody and expired contracts exclude archived staff, like the counts above them.
    const sets = await endedStaff();
    const noArch = notArchivedRef(sets, 'employee');

    const [
      totalEmployees, activeEmployees, onLeaveCount, suspendedCount, terminatedCount,
      pendingLeaves, openRequests, assignedAssets, expiringContracts,
      byStatusAgg, byDeptAgg, byProjectAgg, byNationalityAgg, recentHiresRaw, docFieldEmployees,
      licensesAll,
    ] = await Promise.all([
      Employee.countDocuments(HRQ),
      Employee.countDocuments({ ...HRQ, employmentStatus: 'active' }),
      Employee.countDocuments({ ...HRQ, employmentStatus: 'on_leave' }),
      Employee.countDocuments({ ...HRQ, employmentStatus: 'suspended' }),
      Employee.countDocuments({ ...HRQ, employmentStatus: 'terminated' }),
      LeaveRequest.countDocuments(andAll({ status: { $in: chain.OPEN_STATUSES } }, noArch)),
      HRRequest.countDocuments(andAll({ status: { $in: ['open', 'in_progress'] } }, noArch, notArchivedUserRef(sets, 'requester'))),
      // Employee-held custody only — IT store items are `in_stock`/employee null.
      Asset.countDocuments(andAll({ status: 'assigned', employee: { $ne: null } }, noArch)),
      Contract.find(andAll({ status: 'active', endDate: { $gte: today, $lte: in90 } }, noArch)).populate('employee', 'firstName lastName arabicName').sort({ endDate: 1 }).limit(50).lean(),
      Employee.aggregate([{ $match: HRQ }, { $group: { _id: '$employmentStatus', count: { $sum: 1 } } }]),
      Employee.aggregate([{ $match: { ...HRQ, department: { $nin: [null, ''] } } }, { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
      Employee.aggregate([{ $match: { ...HRQ, project: { $nin: [null, ''] } } }, { $group: { _id: '$project', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
      Employee.aggregate([{ $match: { ...HRQ, nationality: { $nin: [null, ''] } } }, { $group: { _id: '$nationality', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
      Employee.find({ ...HRQ, hireDate: { $nin: [null, ''] } }).select('firstName lastName arabicName jobTitle hireDate').sort({ hireDate: -1 }).limit(8).lean(),
      // Pull only the fields we scan for expiry — everyone not in the archive
      // (HR_ONLY already drops the archive; see hrMasterController EXPIRY_SCOPE).
      Employee.find(HRQ)
        .select('firstName lastName arabicName iqamaNumber ' + EXPIRY_DOCS.map((d) => d.field).join(' '))
        .limit(5000).lean(),
      // Company licenses & subscriptions — few rows, pull all and compute in JS.
      CompanyLicense.find({}).select('name category location expiryDate').lean(),
    ]);

    // Employees with no recorded contract, and others whose contract lapsed without renewal. Anyone on the workforce who needs a contract and has none is counted until it is created, which clears the count at once (creating a contract clears the dashboard cache and broadcasts).
    // Freelancers and trainees have no contract at all, so neither no-contract nor expired applies; they are read from the commercial register number, not employmentType (utils/hrEngagement).
    const { contractRequired } = require('../utils/hrEngagement');
    const current = await require('../utils/contractStatus').currentContractsByEmployee('endDate');
    const anyContract = new Set((await Contract.distinct('employee')).map(String));
    // The dashboard filter also governs these two numbers, since they are about employees and count those the dashboard shows. Licenses belong to the company and are not filtered.
    const workforce = (await Employee.find({ ...HRQ, employmentStatus: { $ne: 'terminated' } })
      .select('firstName lastName arabicName employeeNumber department jobTitle employmentType registerNumber').sort({ employeeNumber: 1 }).lean())
      .filter(contractRequired);
    const person = (e, extra = {}) => ({ _id: e._id, employeeNumber: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(), department: e.department || '', jobTitle: e.jobTitle || '', ...extra });
    const noContract = workforce.filter((e) => !anyContract.has(String(e._id))).map((e) => person(e));
    const lapsedContracts = workforce
      .filter((e) => current.get(String(e._id))?.status === 'expired')
      .map((e) => person(e, { endDate: current.get(String(e._id)).endDate || '' }))
      .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));

    // Licenses about to lapse (or already expired), soonest first.
    const expiringLicenses = (licensesAll || [])
      .filter((l) => l.expiryDate && l.expiryDate <= in60)
      .map((l) => ({ _id: l._id, name: l.name, category: l.category, location: l.location, expiryDate: l.expiryDate, expired: l.expiryDate < today }))
      .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : 1));

    // Flatten every employee × document into a single sorted "expiring/expired" feed.
    const expiringDocs = [];
    for (const e of docFieldEmployees) {
      for (const d of EXPIRY_DOCS) {
        const v = e[d.field];
        if (v && v <= in60) {
          expiringDocs.push({ employeeId: e._id, employeeName: `${e.firstName || ''} ${e.lastName || ''}`.trim(), arabicName: e.arabicName || '', docType: d.type, docEn: d.en, docAr: d.ar, expiry: v, expired: v < today });
        }
      }
    }
    expiringDocs.sort((a, b) => (a.expiry < b.expiry ? -1 : 1));

    // Keep the iqama-only list for back-compat with the existing dashboard table.
    const expiringIqamas = expiringDocs
      .filter((d) => d.docType === 'iqama')
      .map((d) => ({ _id: d.employeeId, firstName: d.employeeName.split(' ')[0], lastName: d.employeeName.split(' ').slice(1).join(' '), iqamaExpiry: d.expiry }));

    res.json({
      summary: {
        totalEmployees, activeEmployees, onLeaveCount, suspendedCount, terminatedCount,
        pendingLeaves, openRequests, assignedAssets,
        expiringDocsCount: expiringDocs.length,
        expiredDocsCount: expiringDocs.filter((d) => d.expired).length,
        licensesTotal: (licensesAll || []).length,
        licensesExpiringCount: expiringLicenses.length,
        licensesExpiredCount: expiringLicenses.filter((l) => l.expired).length,
        noContractCount: noContract.length,
        lapsedContractsCount: lapsedContracts.length,
      },
      noContract, lapsedContracts,
      byStatus: byStatusAgg.map((r) => ({ status: r._id || 'unknown', count: r.count })),
      byDepartment: byDeptAgg.map((r) => ({ name: r._id, count: r.count })),
      // For dashboards other than HR (executive view): on-duty staff only. The HR dashboard stays on `byDepartment`, which covers those who left its work.
      activeByDepartment: (await Employee.aggregate([
        { $match: { ...HRQ, employmentStatus: { $ne: 'terminated' }, department: { $nin: [null, ''] } } },
        { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 },
      ])).map((r) => ({ name: r._id, count: r.count })),
      byProject: byProjectAgg.map((r) => ({ name: r._id, count: r.count })),
      byNationality: byNationalityAgg.map((r) => ({ name: r._id, count: r.count })),
      recentHires: recentHiresRaw,
      expiringDocs: expiringDocs.slice(0, 100),
      expiringIqamas,
      expiringContracts,
      expiringLicenses: expiringLicenses.slice(0, 100),
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Self-service profile + team detection ────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const id = await ensureSelfEmployee(req);
    if (!id) return res.json({ employee: null });
    const [employee, contracts, leaves, assets, balanceData] = await Promise.all([
      Employee.findById(id).populate('directManager', 'firstName lastName email').populate('branch', 'name').lean(),
      Contract.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color affectsBalance').sort({ createdAt: -1 }).limit(100).lean(),
      // `status: { $ne: 'in_stock' }` is belt-and-braces — a store item has
      // employee: null so it cannot match this query anyway.
      Asset.find({ employee: id, status: { $ne: 'in_stock' } }).sort({ createdAt: -1 }).lean(),
      computeEmployeeBalance(id),
    ]);
    res.json({ employee, contracts: contracts.map(asTwo), activeContract: balanceData.contract || null, balance: balanceData.balance, leaves, assets });
  } catch (error) {
    console.error('getMyProfile error:', error);
    res.status(500).json({ message: 'Failed to load your profile' });
  }
};

// Dropdown options for the HR forms: managers (any active login) + branches.
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const Branch = require('../models/Branch');
    const [managers, branches] = await Promise.all([
      // An archived manager cannot be selected, as if deleted.
      endedStaff().then((sets) => User.find(andAll({ isActive: true, role: { $nin: require('../config/scopedRoles').EXTERNAL_ROLES } }, notArchivedUserRef(sets, '_id'))).select('firstName lastName email role').sort({ firstName: 1 }).lean()),
      Branch.find({}).select('name').sort({ name: 1 }).lean().catch(() => []),
    ]);
    res.json({ managers, branches });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load options' });
  }
};

// Does this user manage anyone? Drives the "Team" tabs in self-service pages.
exports.getMyTeam = async (req, res) => {
  try {
    const sets = await endedStaff();
    const [reports, members] = await Promise.all([
      User.find(andAll({ manager: req.user._id }, notArchivedUserRef(sets, '_id'))).select('firstName lastName email role linkedEmployee').lean(),
      require('../utils/leaveTeam').teamOf(req.user, { select: '_id user isHrRecord' }).catch(() => []),
    ]);
    // A section manager has a team even when nobody's login names him: the people he may file leave for (utils/leaveTeam).
    res.json({ hasTeam: reports.length > 0 || members.length > 0, teamCount: reports.length, team: reports, leaveMembers: members.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load team' });
  }
};


/** A general request can be edited and deleted while open and unanswered. The first reply in the thread or status change locks it: a reply answers specific text, and changing it afterwards makes the reply answer a question never asked. */
const requestIsUntouched = (r) => r.status === 'open'
  && (r.thread || []).filter((m) => String(m.sender) !== String(r.requester)).length === 0;

exports.updateMyRequest = async (req, res) => {
  try {
    const r = await HRRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (String(r.requester) !== String(req.user._id)) return res.status(403).json({ message: 'ليس طلبك' });
    if (!requestIsUntouched(r)) {
      return res.status(400).json({ message: 'لا يُعدَّل الطلب بعد أن رُدَّ عليه أو تغيّرت حالته' });
    }
    for (const f of ['subject', 'body', 'category', 'priority', 'attachmentUrl', 'attachments']) {
      if (req.body[f] !== undefined) r[f] = req.body[f];
    }
    if (!String(r.subject || '').trim()) return res.status(400).json({ message: 'اكتب موضوع الطلب' });
    r.readByHR = false;
    await r.save();
    const populated = await populateRequest(HRRequest.findById(r._id)).lean();
    res.json({ request: populated });
  } catch (error) {
    console.error('updateMyRequest error:', error);
    return sendMongooseError(res, error, 'تعذّر تعديل الطلب');
  }
};

exports.deleteMyRequest = async (req, res) => {
  try {
    const r = await HRRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (String(r.requester) !== String(req.user._id)) return res.status(403).json({ message: 'ليس طلبك' });
    if (!requestIsUntouched(r)) {
      return res.status(400).json({ message: 'لا يُحذف الطلب بعد أن رُدَّ عليه أو تغيّرت حالته' });
    }
    await r.deleteOne();
    res.json({ message: 'حُذف الطلب' });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر حذف الطلب' });
  }
};
