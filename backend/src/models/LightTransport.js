/**
 * Light transport: employees, housing and operating orders.
 * Name, identity, nationality, hire date and service status are read from the HR file; section-only data (project, city, supervisor, vehicle, sponsor registry, housing) lives here.
 * Freelancers without an HR file are owned wholly here (`employee: null`). Vehicles are referenced, not copied; authorization lives in `VehicleMaster.authorizedPerson`.
 */
const mongoose = require('mongoose');

/** Permanent trace: every move or status change is stamped with who and when. */
const historyEntrySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  // What changed: project | city | supervisor | dutySupervisor | vehicle | housing | status | created | order
  kind: { type: String, default: '' },
  fromValue: { type: String, default: '' },
  toValue: { type: String, default: '' },
  note: { type: String, trim: true, default: '' },
}, { _id: true });

// Housing.
/** Rooms rather than one capacity: a riders' room takes eight and a supervisors' room three. Total capacity is the sum of rooms, not a typed number, and a person is housed in a room of his type; otherwise housing would read as having space when it has none for a supervisor. */
const housingRoomSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true },     // Room name, for example room 1.
  // Who the room is for: riders | administrative | everyone
  kind: { type: String, enum: ['rep', 'admin', 'any'], default: 'any' },
  capacity: { type: Number, default: 0, min: 0 },
  notes: { type: String, trim: true, default: '' },
}, { _id: true });

const housingSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true, unique: true },
  cityAr: { type: String, trim: true, default: '' },
  addressAr: { type: String, trim: true, default: '' },
  /** Written capacity, used while no rooms are registered. Once rooms exist, capacity is their sum; see `totalCapacity`. */
  declaredCapacity: { type: Number, default: 0, min: 0 },
  rooms: [housingRoomSchema],
  isActive: { type: Boolean, default: true, index: true },
  notes: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/** Real capacity: sum of rooms, otherwise the written one. */
housingSchema.virtual('totalCapacity').get(function () {
  const rooms = (this.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0);
  return rooms || Number(this.declaredCapacity) || 0;
});
housingSchema.set('toJSON', { virtuals: true });
housingSchema.set('toObject', { virtuals: true });

// Employee.
const employeeSchema = new mongoose.Schema({
  /** Identity number is the key, not the name. Sheet names come in variants (a supervisor field versus the full HR name), so name matching fails. The identity number is the same in both records. */
  idNumber: { type: String, trim: true, required: true, unique: true, index: true },
  /** His HR file; `null` for those without one (freelancers). */
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

  // Read from HR when linked, written here when not.
  name: { type: String, trim: true, required: true },
  nationalityAr: { type: String, trim: true, default: '' },
  hireDate: { type: Date, default: null },
  phone: { type: String, trim: true, default: '' },

  // What belongs to this section alone; all are managed lists from section settings.
  cityAr: { type: String, trim: true, default: '', index: true },       // Branch.
  projectAr: { type: String, trim: true, default: '', index: true },    // Project.
  jobTitleAr: { type: String, trim: true, default: '', index: true },   // Rider / supervisor / mechanic ...
  contractTypeAr: { type: String, trim: true, default: '', index: true }, // Sponsored / freelance.
  registerNumber: { type: String, trim: true, default: '', index: true }, // Which registry he is sponsored under.
  vehicleTypeAr: { type: String, trim: true, default: '', index: true },  // Motorbike / van / Kia ...

  /** Rider or administrative. The section runs on this split: a rider delivers and is measured by orders; everyone else (supervisor, mechanic, cleaner) is administrative and serves operations. Derived from the job title, not typed twice, so they cannot differ. */
  // Four kinds, not two. There were only `rep` and `admin`, with admin as the else branch, so anyone whose title was not exactly rider became administrative, including those with no title; the screen then counted administrative and technical staff wrongly, hiding nineteen with no title and three drivers among them.
  // The owner's rule: whoever is neither a delivery rider nor a driver is administrative. A driver is its own kind, not folded into administrative.
  // Unknown is not a class: with no title written the rule does not apply (not a non-rider, just unwritten). So `unknown` is counted and shown as a number to fill, not hidden inside another.
  staffKind: { type: String, enum: ['rep', 'driver', 'admin', 'unknown'], default: 'unknown', index: true },

  /**
   * Responsible supervisor is a system account, not a name in a list: `supervisorUser` is an active account with a supervision role, so the rider appears in that supervisor's start-of-shift inspection.
   * `supervisorName` is a name snapshot for tables and history; `supervisor` is the HR file derived from the account. Neither is typed.
   */
  supervisorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '', index: true },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

  /**
   * Two supervisions, not one.
   * The field above is the operational supervisor: the man's owner in the field (project, branch, daily work), recorded from the start.
   * This is the inspection supervisor: who stands over him in the morning and photographs him before he leaves. They are not necessarily the same: inspection is allocation to stations at one hour, operations is responsibility all day.
   * The inspection screen used to read the operational supervisor in the absence of another, blaming him for work that is not his and leaving the station owner without his riders. So they are two independently assigned fields: either or both.
   */
  dutySupervisorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  dutySupervisorName: { type: String, trim: true, default: '', index: true },

  /** Work status. Read from HR when linked, so ending service there shows here without another step; written here for those with no file. */
  workStatusAr: { type: String, trim: true, default: '', index: true },

  /** Today's operating status, written by this section: working (blank) / leave / suspended / accident, edited from the employee row. Separate from employment status, which belongs to HR alone; HR leave and suspension override this in display (utils/b2cBoard.shownStatus). Not copied to the HR file, where suspended means in sponsorship transfer stage. */
  opStatus: { type: String, enum: ['', 'leave', 'suspended', 'accident'], default: '', index: true },
  opStatusAt: { type: Date, default: null },
  opStatusNote: { type: String, trim: true, default: '' },

  // Vehicle he works on now: a reference to the vehicle registry, not a copy.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehiclePlate: { type: String, trim: true, default: '' },
  // On hold, not cancelled: when someone's service ended while he still holds a vehicle, it is not released automatically; the order is held and the section alerted to act (take the vehicle back or hand it to someone else). See utils/ltVehicleRelease.
  vehicleHold: {
    at: { type: Date, default: null },
    reason: { type: String, trim: true, default: '' },
  },

  housing: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportHousing', default: null, index: true },
  housingRoom: { type: String, trim: true, default: '' },

  notesAr: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true, index: true },

  history: [historyEntrySchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

employeeSchema.index({ projectAr: 1, cityAr: 1 });
employeeSchema.index({ staffKind: 1, workStatusAr: 1 });
employeeSchema.index({ name: 'text' });

/** Only rider is a rider; anything else is administrative. Computed before every save. */
const REP_TITLES = ['مندوب', 'مندوب توصيل', 'rep', 'delivery rep'];
// A driver is not administrative: he is field staff like a rider, though not a rider. Counting him as administrative would inflate a number read as office burden.
const DRIVER_TITLES = ['سائق', 'سايق', 'driver'];
/**
 * The derived value is not computed on a field that was not read. `staffKind` derives from the job title. Saving a row loaded with `select` fields runs this hook with `jobTitleAr` unloaded, reading it empty so every rider became administrative and dropped from screens asking for riders. This happened in a bulk assignment.
 * Derivation happens only if the field is present: absence means no information, not empty.
 */
/** B2C employee's project in his HR file. The project is owned by the B2C record and the employee file reads it. So every save that changes the project, or links the row to its file for the first time, writes it to the file. Changes that came from the file itself (`$locals.fromHr`) are not echoed back. See utils/hrLists. */
employeeSchema.pre('save', function (next) {
  // Linking alone does not erase a project in the file: it is carried over only if the record has one. A change of project in the record, even clearing it, is carried as is.
  const linkedWithProject = this.isModified('employee') && !!String(this.projectAr || '').trim() && this.projectAr !== '(غير محدد)';
  this.$locals.projectToHr = !this.$locals.fromHr && !!this.employee && (this.isNew ? linkedWithProject : (this.isModified('projectAr') || linkedWithProject));
  next();
});
employeeSchema.pre('save', function (next) {
  // His orders' project (`B2CRep`) follows his project and city; utils/b2cEntry.
  this.$locals.repSync = !this.isNew && (this.isModified('projectAr') || this.isModified('cityAr'));
  next();
});
// The actual driver is one across both sections. Whoever is on the vehicle in this record is the actual driver in the vehicle registry (`VehicleMaster.actualDriver`), written there whenever his vehicle changes and removed from the vehicle he left. Authorization is separate and not touched here.
employeeSchema.pre('save', function (next) {
  this.$locals.driverSync = this.isModified('vehicle') || (!!this.vehicle && (this.isModified('name') || this.isModified('idNumber')));
  next();
});
employeeSchema.post('save', async function (doc) {
  if (!doc.$locals.driverSync) return;
  try {
    const VM = mongoose.model('VehicleMaster');
    const id = String(doc.idNumber || '').replace(/\s+/g, '');
    if (id) {
      // The vehicle he left: his name is removed from it, and no other driver is touched.
      await VM.updateMany(
        { 'actualDriver.idNumber': id, ...(doc.vehicle ? { _id: { $ne: doc.vehicle } } : {}) },
        { $set: { 'actualDriver.idNumber': '', 'actualDriver.name': '' } },
      );
    }
    if (doc.vehicle) {
      await VM.updateOne({ _id: doc.vehicle }, { $set: { 'actualDriver.idNumber': id, 'actualDriver.name': String(doc.name || '').trim() } });
    }
  } catch (_) { /* Sync must not fail the record save. */ }
});
/** Today's status is heard everywhere. Leave, suspended and accident are written here only, and copied as a read snapshot to his HR file (`Employee.b2cOpStatus`) and to the vehicle he rides (`VehicleMaster.b2cRider`), so HR sees it on file and list and vehicles sees it on the vehicle. His name is removed from the vehicle he left. Then the three sections' caches are cleared before announcing. */
// The rider is written to the vehicle whenever his link changes, not only when status changes. `b2cRider` was empty on all vehicles with 160 riders linked because it was written only on status change. Now it is written on any change to vehicle, name or activity, from any path: save or query write. (Existing rows are filled by scripts/backfillPersonVehicleLinks.)
async function syncRider(doc, { emit = true } = {}) {
  const op = doc.isActive === false ? '' : String(doc.opStatus || '');
  if (doc.employee) await mongoose.model('Employee').updateOne({ _id: doc.employee }, { $set: { b2cOpStatus: op } });
  const VM = mongoose.model('VehicleMaster');
  await VM.updateMany(
    { 'b2cRider.lt': doc._id, ...(doc.vehicle && doc.isActive !== false ? { _id: { $ne: doc.vehicle } } : {}) },
    { $set: { 'b2cRider.lt': null, 'b2cRider.name': '', 'b2cRider.opStatus': '' } }, { timestamps: false },
  );
  if (doc.vehicle && doc.isActive !== false) {
    await VM.updateOne({ _id: doc.vehicle },
      { $set: { 'b2cRider.lt': doc._id, 'b2cRider.name': String(doc.name || '').trim(), 'b2cRider.opStatus': op } }, { timestamps: false });
  }
  if (!emit) return;
  require('../utils/vehicleAnnounce').announceVehicles({ lt: String(doc._id) }, {
    extraCaches: ['hr:', 'dash:'],
    events: [['hr:employee', { lt: String(doc._id) }], ['hr:master', { lt: String(doc._id) }]],
  });
}
const RIDER_FIELDS = ['opStatus', 'vehicle', 'isActive', 'name', 'employee'];
employeeSchema.pre('save', function (next) {
  this.$locals.opSync = this.isModified('opStatus') || this.isModified('vehicle') || this.isModified('isActive')
    || (!!this.vehicle && this.isModified('name'))
    || (this.isNew && (!!this.opStatus || !!this.vehicle));
  next();
});
employeeSchema.post('save', async function (doc) {
  if (!doc.$locals.opSync) return;
  try { await syncRider(doc); } catch (_) { /* Sync must not fail the record save. */ }
});
const touchedKeys = (update) => {
  const keys = [];
  for (const [k, v] of Object.entries(update || {})) {
    if (k.startsWith('$') && v && typeof v === 'object') keys.push(...Object.keys(v));
    else keys.push(k);
  }
  return keys;
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  employeeSchema.pre(op, async function () {
    if (!touchedKeys(this.getUpdate()).some((k) => RIDER_FIELDS.includes(k))) return;
    this._riderIds = await this.model.find(this.getFilter()).distinct('_id');
  });
  employeeSchema.post(op, async function () {
    const ids = this._riderIds || [];
    if (!ids.length) return;
    try {
      const rows = await this.model.find({ _id: { $in: ids } }).select('_id employee vehicle name opStatus isActive').lean();
      for (const r of rows) await syncRider(r, { emit: false }); // eslint-disable-line no-await-in-loop
      if (rows.length) await syncRider(rows[rows.length - 1]);
    } catch (_) { /* */ }
  });
}
employeeSchema.statics.syncRider = syncRider;
employeeSchema.post('save', async function (doc) {
  if (!doc.$locals.repSync) return;
  try { await require('../utils/b2cEntry').syncRepOf(doc); } catch (_) { /* */ }
  // The active user rental moves with his project. A project transfer is written here from any path, and the rental record follows; see utils/ltRental.
  try { await require('../utils/ltRental').followProject(doc); } catch (_) { /* */ }
});
employeeSchema.post('save', async function (doc) {
  if (!doc.$locals.projectToHr) return;
  try {
    const LISTS = require('../utils/hrLists');
    const Employee = mongoose.model('Employee');
    const want = LISTS.projectFromB2C(doc.projectAr);
    const r = await Employee.updateOne({ _id: doc.employee, project: { $ne: want } }, { $set: { project: want } });
    if (r.modifiedCount) LISTS.bust({ projectFromB2C: String(doc.employee) });
  } catch (_) { /* Sync must not fail the record save. */ }
});
employeeSchema.pre('save', function (next) {
  if (this.jobTitleAr === undefined && !this.isNew) return next();
  const j = String(this.jobTitleAr || '').trim().toLowerCase();
  if (!j) { this.staffKind = 'unknown'; return next(); }
  if (REP_TITLES.some((t) => j === t.toLowerCase())) this.staffKind = 'rep';
  else if (DRIVER_TITLES.some((t) => j === t.toLowerCase())) this.staffKind = 'driver';
  else this.staffKind = 'admin';
  next();
});

// Operating order.
/**
 * This employee works on this vehicle, in this project, at this branch, under this supervisor, and lives here. One active order per employee; earlier ones are closed, not erased, so the history of who rode what and when reads backwards.
 * Creating it writes the present state on the employee (vehicle, project, housing) and records the move in his log; a transfer of authorization writes in the vehicle registry itself.
 */
const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, trim: true, unique: true, index: true },
  ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', required: true, index: true },
  employeeName: { type: String, trim: true, default: '' },
  employeeIdNumber: { type: String, trim: true, default: '' },

  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehiclePlate: { type: String, trim: true, default: '' },
  vehicleTypeAr: { type: String, trim: true, default: '' },

  projectAr: { type: String, trim: true, default: '', index: true },
  cityAr: { type: String, trim: true, default: '', index: true },
  // Supervisor at assignment time: account, name and file. See `supervisorUser` above.
  supervisorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

  housing: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportHousing', default: null },
  housingRoom: { type: String, trim: true, default: '' },

  startDate: { type: Date, default: Date.now, index: true },
  endDate: { type: Date, default: null },
  // hold: held because the holder's service ended while the vehicle is still with him; awaits action.
  status: { type: String, enum: ['active', 'hold', 'ended'], default: 'active', index: true },
  endReasonAr: { type: String, trim: true, default: '' },

  /** Whether the vehicle authorization was transferred with this order. The actual write is in the vehicle registry; this records what happened, not its source. */
  authorizationMoved: { type: Boolean, default: false },
  authorizationNumber: { type: String, trim: true, default: '' },
  authorizationStart: { type: Date, default: null },
  authorizationEnd: { type: Date, default: null },

  notesAr: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

orderSchema.index({ status: 1, startDate: -1 });
orderSchema.index({ ltEmployee: 1, startDate: -1 });

module.exports = {
  LightTransportEmployee: mongoose.models.LightTransportEmployee
    || mongoose.model('LightTransportEmployee', employeeSchema),
  LightTransportHousing: mongoose.models.LightTransportHousing
    || mongoose.model('LightTransportHousing', housingSchema),
  LightTransportOrder: mongoose.models.LightTransportOrder
    || mongoose.model('LightTransportOrder', orderSchema),
};
