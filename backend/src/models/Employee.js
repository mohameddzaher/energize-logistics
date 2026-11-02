const mongoose = require('mongoose');

// HR profile for a person who works at the company. This is SEPARATE from the
// login account (User): HR can register employees who have no login at all, and
// a User may later be linked to one of these records (Employee.user /
// User.linkedEmployee). Saudi-specific identity & government fields live here.
const employeeSchema = new mongoose.Schema(
  {
    // Identity
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    arabicName: { type: String, trim: true },
    employeeNumber: { type: String, trim: true }, // internal staff number
    gender: { type: String, enum: ['male', 'female', ''], default: '' },
    dateOfBirth: { type: String }, // YYYY-MM-DD
    nationality: { type: String, trim: true },
    photo: { type: String }, // url

    // Saudi identity / residence (iqama for expats, national id for citizens)
    idType: { type: String, enum: ['iqama', 'national_id'], default: 'iqama' },
    iqamaNumber: { type: String, trim: true },
    iqamaExpiry: { type: String }, // YYYY-MM-DD — drives expiry alerts
    nationalId: { type: String, trim: true },
    passportNumber: { type: String, trim: true },
    passportExpiry: { type: String }, // YYYY-MM-DD

    // Government platforms (tracking only — no live integration)
    qiwaContractNumber: { type: String, trim: true },
    gosiNumber: { type: String, trim: true },
    absherStatus: { type: String, trim: true },
    sponsorName: { type: String, trim: true }, // kafala / employer of record
    workPermitExpiry: { type: String }, // YYYY-MM-DD

    // Job
    jobTitle: { type: String, trim: true },
    department: { type: String, trim: true },
    // Staff category: administrative, driver or technician. Only for B2C and heavy transport employees, who have all three. Closed list (utils/hrLists, hr_staff_category).
    staffCategory: { type: String, trim: true, default: '', index: true },
    // Today's status in the B2C section: leave, suspended or accident (blank means working). Written only on LightTransportEmployee.opStatus and copied here as a read-only snapshot for HR. Does not touch employment status or create a leave.
    b2cOpStatus: { type: String, enum: ['', 'leave', 'suspended', 'accident'], default: '' },
    hireDate: { type: String }, // YYYY-MM-DD
    // Actual first day on the job. Distinct from hireDate and contract dates; survives contract renewals.
    actualWorkStartDate: { type: String }, // YYYY-MM-DD
    workLocation: { type: String, trim: true },
    // Primary branch, used for reports and salaries.
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    // Additional branches: some employees really work in more than one (a driver serving two cities, a supervisor covering two branches). The primary stays single for reports; these make him appear and be selectable in both.
    branches: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }], default: [], index: true },
    employmentStatus: {
      type: String,
      enum: ['active', 'on_leave', 'suspended', 'terminated'],
      default: 'active',
    },
    // Set when the leave sync (utils/leaveReturn) put the employee on leave, so
    // only those are returned to work automatically — an "on leave" imported
    // from a sheet without a leave record is left to HR.
    leaveStatusSource: { type: String, default: '' },          // 'leave' | ''
    leaveStatusLeave: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
    // Did not come back after the leave and it was not extended.
    leaveViolation: {
      leave: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
      since: { type: String, default: '' },
      note: { type: String, default: '' },
    },
    terminatedAt: { type: Date },
    terminationReason: { type: String, trim: true },
    /**
     * Not working means service ended, in one of three states: transfer_pending (awaiting sponsorship transfer; HR alerted daily for a month, then archived), sister_company, final_exit.
     * See utils/hrEngagement (TERMINATION_KINDS) and jobs/hrTransferAlerts.
     */
    terminationKind: { type: String, enum: ['transfer_pending', 'sister_company', 'final_exit', ''], default: '' },
    transferDeadline: { type: Date, default: null },
    // Sister company is a work status, not a termination: a current employee on our sponsorship working for a sister company, treated as a normal employee in every section. See utils/hrEngagement.
    sisterCompany: { type: Boolean, default: false, index: true },
    // Last alert window sent (day plus morning/evening); prevents duplicates across the two server workers.
    transferAlertKey: { type: String, default: '' },

    // Contact
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },

    // Compensation snapshot (current contract is the source of truth; these are
    // convenience fields shown on the profile)
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },

    // ── Banking ──────────────────────────────────────────────────────────────
    iban: { type: String, trim: true },  // IBAN.
    bank: { type: String, trim: true },  // Bank code (RJHI / INMA / SNB ...).

    // ── Extra HR-sheet fields (Saudi payroll/compliance bookkeeping) ─────────
    fileStatus: { type: String, trim: true },        // File status (complete ...).
    absherNumber: { type: String, trim: true },      // Absher number (the number, distinct from absherStatus).
    companyNumber: { type: String, trim: true },     // Company number.
    originCountryNumber: { type: String, trim: true }, // Country-of-origin number.
    project: { type: String, trim: true },           // Project (Amazon / HungerStation / heavy transport ...).
    registerNumber: { type: String, trim: true },    // Commercial registration number (CR).
    systemStatus: { type: String, trim: true },      // System status (inside the system ...).
    workStatusText: { type: String, trim: true },    // Work status as text (working / on leave); employmentStatus stays the enum.
    penaltyClause: { type: Number, default: 0 },     // Penalty clause.
    iqamaProfession: { type: String, trim: true },   // Profession on the residence permit.
    classification: { type: String, trim: true },    // Classification.

    // ── Contract columns mirrored from the HR master sheet ───────────────────
    // Reference text only — the Contract collection stays the source of truth.
    contractStatusText: { type: String, trim: true, default: '' },  // Contract status (valid ...).
    contractStartDate: { type: String, default: '' },               // Creation date, YYYY-MM-DD.
    contractEndDate: { type: String, default: '' },                 // Expiry date 2, YYYY-MM-DD.
    // String, not number: the filter panel sends values as strings, and $in on a numeric field never matches them, returning an empty screen silently. The binding number stays on the contract (Contract.annualLeaveDays), which drives the leave balance; this is a snapshot of it.
    annualLeaveDays: { type: String, trim: true, default: '' },      // Annual leave.
    probationPeriod: { type: String, trim: true, default: '' },      // Probation period.

    // Insurance
    insuranceCompany: { type: String, trim: true },  // Insurance company.
    insuranceExpiry: { type: String },               // Insurance expiry date, YYYY-MM-DD.
    socialInsuranceStatus: { type: String, trim: true }, // Social insurance status (active ...).
    insuranceRequirements: { type: String, trim: true, default: '' },        // Insurance requirements.
    iqamaProfessionRequirements: { type: String, trim: true, default: '' },  // Residence-permit profession requirements.

    // Visa
    visaExpiry: { type: String },                    // Visa expiry, YYYY-MM-DD.

    // Travel (latest known trip)
    lastTravelDate: { type: String },                // Travel date, YYYY-MM-DD.
    lastReturnDate: { type: String },                // Return date, YYYY-MM-DD.

    // Driving / vehicle eligibility.
    // Vehicle: derived snapshot, never typed. Plates of what he holds in the vehicle registry (`VehicleMaster.authorizedPerson`); written only by utils/vehicleAuthorization.refreshPlateSnapshot after each authorization, transfer or plate change. The HR form shows it but does not accept it.
    vehiclePlate: { type: String, trim: true },
    licenseNumber: { type: String, trim: true },     // Driving license number.
    licenseType: { type: String, trim: true },       // License type (heavy transport / motorbike ...).
    licenseExpiry: { type: String },                 // License expiry, YYYY-MM-DD.
    driverCardNumber: { type: String, trim: true },  // Driver card number.
    driverCardType: { type: String, trim: true },    // Driver card type (annual ...).
    driverCardStatus: { type: String, trim: true },  // Driver card status.
    driverCardExpiry: { type: String },              // Driver card expiry, YYYY-MM-DD.
    workCard: { type: String, trim: true },          // Work card.
    ajeerStatus: { type: String, trim: true },       // Ajeer status.
    ajeerExpiry: { type: String },                   // Ajeer expiry, YYYY-MM-DD.

    // Links
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // login account, optional
    directManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // HR master v2.0 fields.
    companyEmail: { type: String, trim: true, default: '' },
    employerNumber: { type: String, trim: true, default: '' },
    directManagerName: { type: String, trim: true, default: '' }, // Name snapshot from the master.
    // `branch` above is an ObjectId of the branch record. The master supplies the branch name as text, which may have no record here, so it is stored here. The two are not substitutes.
    branchName: { type: String, trim: true, default: '', index: true },
    isOutsideKingdom: { type: Boolean, default: false, index: true },
    isFreelancer: { type: Boolean, default: false, index: true },
    // Engagement type: on our sponsorship or freelance. A boolean cannot hold a third type (seconded, vendor contractor) and is not manageable from settings, so the field is a key into a managed list. `isFreelancer` stays as a mirror because existing counters depend on it; both are written together. See utils/employmentType.
    employmentType: { type: String, trim: true, default: '', index: true },
    iqamaIssueDate: { type: Date, default: null },
    iqamaExpiryHijri: { type: String, trim: true, default: '' },
    contractOccupation: { type: String, trim: true, default: '' },
    insuranceClass: { type: String, trim: true, default: '' },
    // Medical insurance: policy number at the insurer and the registry it is under. Asked at each review or renewal; previously kept outside the file.
    medicalInsuranceNumber: { type: String, trim: true, default: '' },
    medicalInsuranceRegister: { type: String, trim: true, default: '' },
    healthCertNumber: { type: String, trim: true, default: '' },
    healthCertExpiry: { type: Date, default: null, index: true },

    // Per-field status: required, not required or none.
    // Open Map so adding a field in config/hrFields.js needs no change here. Required means missing and must be collected; not required means it does not apply to this employee. Keep them separate or the HR work list contains people who need no follow-up.
    // Removed automatically once the field is filled (pre-save below).
    fieldStatus: { type: Map, of: String, default: {} },

    // Whether this is a real HR record. Creating a login account auto-creates an employee record (utils/ensureSelfEmployee), which is not an employee: a system user is not an employee until linked to a real record. Such records are marked false so they leave department counters but stay for the linked account.
    isHrRecord: { type: Boolean, default: true, index: true },
    // Where the file was created. The people section adds its employee from the light transport registry with little data (name, residence, project), and HR completes the rest. The file is marked with its source (`b2c`) so HR can find what was added from there.
    createdVia: { type: String, trim: true, default: '', index: true },
    // Whether HR has seen it. The new-employees-from-people-section button is an alert, not a record. Any HR edit means HR has seen it, so it leaves the alert on its own, with no review button to forget. Set in the save hook below.
    hrPending: { type: Boolean, default: false, index: true },

    // Whether this employee is in the current master file. The master is the current employment file; those not in it left earlier and their record is kept as history. This distinction must stay clear or the employee count is meaningless.
    inCurrentMaster: { type: Boolean, default: false, index: true },

    // When the import last touched this record. The sheet is a paper snapshot; comparing `updatedAt` with this date shows a human wrote after the last import, so an empty sheet cell does not erase their edits. (Same rule as in the vehicles section.)
    lastImportAt: { type: Date, default: null },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Search & filter indexes. Search is by name / iqama / employee number / phone.
/**
 * Once a field is filled, its required status is removed automatically.
 * Keeps the dashboard required counter honest. Done here rather than in the controller so it works for any edit source: screen, import or script.
 */
/**
 * The identity number stays in both columns.
 * A Saudi's number is in `nationalId` and a resident's in `iqamaNumber`, but all screens read `iqamaNumber` (tables, exports, pickers) as the person's identity number whatever its type. Otherwise a written number reads as missing and is counted as a gap. The dual read in config/hrFields fixes the master but not screens reading the column directly.
 * So a Saudi number is copied to `iqamaNumber` on save. Never the reverse: an iqama number is not a national number and would make a resident look Saudi.
 */
employeeSchema.pre('save', function mirrorNationalId(next) {
  if (this.idType === 'national_id') {
    const nid = String(this.nationalId || '').trim();
    if (nid && String(this.iqamaNumber || '').trim() !== nid) this.iqamaNumber = nid;
  }
  next();
});

// Branch name text is filled from the selected branch. The master filters and groups by `branchName` (import text), while the employee form picks `branch` as an id and does not write the text; without this, system-created employees fall under a blank bucket.
employeeSchema.pre('save', async function fillBranchName(next) {
  try {
    if (this.branch && !String(this.branchName || '').trim()
      && (this.isNew || this.isModified('branch'))) {
      const b = await mongoose.model('Branch').findById(this.branch).select('name').lean();
      if (b?.name) this.branchName = b.name;
    }
  } catch (_) { /* Must not fail the save. */ }
  next();
});

// New employee: empty document fields are marked required until stated otherwise. Previously an empty field on a system-created employee read as none, so it was not counted as required nor shown on expiry screens, since only the import wrote required. Every empty document field with no status is marked required at creation; if not needed, choose not required on the form or master.
// Not marked where it never applies: Saudis have no residence or work permit, the Hijri date is derived, and auto-created login accounts are not employees.
employeeSchema.pre('save', function defaultRequiredDocs(next) {
  try {
    if (!this.isNew || this.isHrRecord === false) return next();
    const H = require('../config/hrFields');
    const saudi = this.idType === 'national_id';
    const skipGroups = new Set(saudi ? ['iqama', 'workPermit'] : []);
    if (!this.fieldStatus || typeof this.fieldStatus.set !== 'function') this.fieldStatus = new Map();
    const empty = (v) => v === null || v === undefined || v === '' || (v instanceof Date && isNaN(v));
    for (const g of H.DOCUMENT_GROUPS) {
      // Visa and Ajeer are not held by every employee (`optional`), so not required of everyone.
      if (skipGroups.has(g.key) || g.optional) continue;
      for (const f of g.fields) {
        if (/Hijri$/.test(f.key) || f.optional || f.readOnly) continue;
        const sk = H.statusKeyOf(f.key);
        if (this.fieldStatus.get(sk)) continue;
        if (empty(H.valueOf(this, f.key))) this.fieldStatus.set(sk, 'required');
      }
    }
  } catch (_) { /* Must not fail the create. */ }
  next();
});

employeeSchema.pre('save', function clearSatisfiedStatuses(next) {
  if (!this.fieldStatus || typeof this.fieldStatus.forEach !== 'function') return next();
  const filled = (v) => !(v === null || v === undefined || v === '' || (v instanceof Date && isNaN(v)));
  for (const [statusKey, code] of [...this.fieldStatus.entries()]) {
    // Not required is an administrative decision: not removed just because something was typed. Inactive is the state of the field, not a decision: entering an insurance company again means it became active.
    if (code !== 'required' && code !== 'inactive') continue;
    const fieldKey = statusKey.replace(/Status$/, '');
    if (filled(this.get(fieldKey))) this.fieldStatus.delete(statusKey);
  }
  next();
});

/**
 * Contract fields are written to the contract itself.
 * Contract end, start and number mirror the active contract (utils/contractStatus). An edit here (master, renew on the expiries page, bulk renewal) is written to the contract, otherwise expiries and the contracts tab show different dates.
 * A save hook rather than a line per controller, since there are several edit paths and a missed line silently reintroduces the bug. Sync from the contract uses `updateOne` and bypasses this hook, so no loop.
 */
// Any save of an existing file is HR's hand on it (the people section writes to its own record), so the alert is cleared. See `hrPending`.
// Work status text is derived from the status; a blank one read as not set in filters.
employeeSchema.pre('save', function deriveWorkStatusText(next) {
  if (this.isHrRecord === false) return next();
  const want = require('../utils/hrEngagement').workStatusTextOf(this);
  if (this.workStatusText !== want) this.workStatusText = want;
  next();
});

// The manager is chosen by account; every screen shows the name HR holds for that person.
employeeSchema.pre('save', async function followDirectManager() {
  if (!this.isModified('directManager')) return;
  this.directManagerName = await require('../utils/hrManagerName').managerNameOf(this.directManager);
});

employeeSchema.pre('save', function clearHrPending(next) {
  if (!this.isNew && this.hrPending && this.modifiedPaths().some((p) => p !== 'hrPending' && p !== 'updatedAt')) this.hrPending = false;
  next();
});

const CONTRACT_MIRROR = ['contractStartDate', 'contractEndDate', 'qiwaContractNumber'];
employeeSchema.pre('save', function noteContractFields(next) {
  if (!this.isNew) {
    const changed = CONTRACT_MIRROR.filter((k) => this.isModified(k));
    if (changed.length) this.$locals.contractFields = Object.fromEntries(changed.map((k) => [k, this[k]]));
  }
  next();
});
employeeSchema.post('save', async function pushContractFields(doc) {
  const fields = doc.$locals && doc.$locals.contractFields;
  if (!fields) return;
  doc.$locals.contractFields = null;
  try { await require('../utils/contractStatus').pushEmployeeContractFields(doc._id, fields); }
  catch (e) { console.error('employee → contract:', e.message); }
});

employeeSchema.index({ firstName: 1, lastName: 1 });
employeeSchema.index({ iqamaNumber: 1 });
employeeSchema.index({ nationalId: 1 });
employeeSchema.index({ employeeNumber: 1 });
employeeSchema.index({ employmentStatus: 1 });
// The employees list sorts by createdAt (optionally filtered by status) — index
// it so a busy office doesn't pay an in-memory sort of the whole collection.
employeeSchema.index({ createdAt: -1 });
employeeSchema.index({ employmentStatus: 1, createdAt: -1 });
employeeSchema.index({ user: 1 });

// Any employee write clears the cached list so edits/new hires/terminations show
// immediately (the list is cached ~30s to survive concurrent office-wide loads).
employeeSchema.post('save', function () {
  try { require('../utils/ttlCache').clear('hr:employees'); } catch (e) { /* noop */ }
});
employeeSchema.index({ directManager: 1 });
employeeSchema.index({ vehiclePlate: 1 });

// The identity number is the join key with vehicles and B2C; correcting it here corrects it there. The vehicle authorization paper (`VehicleMaster.authorizedPerson.iqamaNumber`), the actual driver, the driver card and the light transport row all identify him by it. Fixing it only in HR breaks the link: his authorization vanishes from his file and clearance, and the vehicle keeps an unknown number. See utils/employeeIdentitySync.
// Personal data (name, phone, nationality, project, department, employment status) follows too: copies in light transport, driver card, authorization paper and actual driver are pushed from here, number first then data so copies match by the new number. See utils/employeeIdentitySync.pushPersonChange and utils/personRef.
employeeSchema.post('init', function () {
  this.$locals.idsAtLoad = [this.iqamaNumber, this.nationalId].map((x) => String(x || '').trim());
  this.$locals.personAtLoad = require('../utils/employeeIdentitySync').personSnapshot(this);
});
employeeSchema.pre('save', function (next) {
  this.$locals.wasNew = this.isNew;
  next();
});
employeeSchema.post('save', async function (doc) {
  const sync = require('../utils/employeeIdentitySync');
  const before = doc.$locals && doc.$locals.idsAtLoad;
  const now = [doc.iqamaNumber, doc.nationalId].map((x) => String(x || '').trim());
  if (before && (before[0] !== now[0] || before[1] !== now[1])) {
    doc.$locals.idsAtLoad = now;
    try { await sync.pushIdChange(doc, before, now); }
    catch (e) { console.error('employee id → vehicles/b2c:', e.message); }
  }
  // An auto-created login account is not an HR person and writes to nobody's copies.
  if (doc.isHrRecord === false) return;
  const pBefore = doc.$locals && doc.$locals.personAtLoad;
  const pNow = sync.personSnapshot(doc);
  // New file: existing copies may already carry its identity number (the people section created it from its row).
  const fields = pBefore ? sync.changedPersonFields(pBefore, pNow) : (doc.$locals && doc.$locals.wasNew ? sync.COPIED_FIELDS : []);
  if (doc.$locals) doc.$locals.personAtLoad = pNow;
  if (!fields.length) return;
  try { await sync.pushPersonChange(doc, { fields }); }
  catch (e) { console.error('employee person → copies:', e.message); }
});
// Query writes (`updateOne`/`updateMany`/`findOneAndUpdate`) bypass the save hook: nationality, department and project list unification, and project sync from the people section. So ids of affected records are captured before the write and their data pushed afterwards.
const touchedPersonFields = (update) => {
  if (!update) return [];
  const keys = [];
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$') && v && typeof v === 'object') keys.push(...Object.keys(v));
    else keys.push(k);
  }
  const { PERSON_FIELDS } = require('../utils/employeeIdentitySync');
  return PERSON_FIELDS.filter((f) => keys.includes(f));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  employeeSchema.pre(op, async function () {
    const fields = touchedPersonFields(this.getUpdate());
    if (!fields.length || this.getOptions().skipPersonSync) return;
    this._personFields = fields;
    this._personIds = await this.model.find(this.getFilter()).distinct('_id');
  });
  employeeSchema.post(op, async function () {
    const ids = this._personIds || [];
    if (!ids.length) return;
    const sync = require('../utils/employeeIdentitySync');
    try {
      const rows = await this.model.find({ _id: { $in: ids }, isHrRecord: { $ne: false } }).lean();
      for (const e of rows) await sync.pushPersonChange(e, { fields: this._personFields, emit: false }); // eslint-disable-line no-await-in-loop
      if (rows.length) sync.announcePerson(rows[0]);
    } catch (e) { console.error('employee person → copies (query):', e.message); }
  });
}

// Staff category is dropped when the employee leaves both its departments (B2C, heavy transport).
employeeSchema.pre('save', async function () {
  if (!this.isModified('department') || !this.staffCategory) return;
  try {
    const deps = await require('../utils/hrLists').categoryDepartments();
    if (!deps.includes(String(this.department || '').trim())) this.staffCategory = '';
  } catch (_) { /* */ }
});

module.exports = mongoose.model('Employee', employeeSchema);
