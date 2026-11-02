/**
 * fleetIdentity: a fleet truck and its driver are read from their registers, not from a copy.
 * `FleetVehicle.vehicleMaster` supplies identity (plate, make, model, year, chassis, colour) and dated documents; `FleetDriver.employee` supplies name, phone, ID number, nationality and IBAN, and work status follows leave and termination there.
 * Text stored on the fleet row is only a fallback for unlinked records.
 * Waybill snapshots (`FleetShipment.vehiclePlate` ...) stay untouched: a waybill is a legal document read as issued.
 */
const S = (v) => String(v == null ? '' : v).trim();
const cache = require('./ttlCache');

// Vehicle

/** What is read from the vehicle register for a fleet truck: identity and dated documents. */
const REGISTRY_SELECT = [
  'plateNumber', 'canonKey', 'brandAr', 'modelAr', 'modelYear', 'chassisNumber', 'colorAr',
  'sectorAr', 'serviceStatusAr', 'isActive',
  'insurance.expiryDate', 'insurance.statusCode',
  'operatingCard.expiryDate', 'operatingCard.statusCode', 'operatingCard.cardNumber',
  'vehicleLicense.expiryDate', 'vehicleLicense.statusCode',
  'inspection.expiryDate', 'inspection.statusCode',
  'authorizedPerson.expiryDate', 'authorizedPerson.statusCode', 'authorizedPerson.name',
].join(' ');

// Tracking subscription is excluded from the list: its alert is off by default and our fleet is on LS.
const FLEET_DOCS = ['insurance', 'operatingCard', 'vehicleLicense', 'inspection', 'authorization'];

/** Alert thresholds from the vehicles section settings, using the same computation (`VDOC.stateOf`), otherwise two screens would give one document two states. The key is under `vreg:` so it is cleared with every change to their settings. */
const docAlerts = () => cache.wrap('vreg:fleet-doc-alerts', 60000, async () => {
  const { VehicleRegistryConfig } = require('../models/VehicleMaster');
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean();
  return (cfg && cfg.alerts) || {};
});

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/** Vehicle image as the fleet reads it from the registry. */
function registryView(vm, alerts = {}) {
  if (!vm) return null;
  const VDOC = require('../config/vehicleDocuments');
  const docs = FLEET_DOCS.map((key) => {
    const d = VDOC.getDoc(key);
    const expiryDate = getPath(vm, d.path) || null;
    const st = VDOC.stateOf(expiryDate, getPath(vm, d.statusPath) || '', alerts[key] || {});
    return { key, ar: d.ar, en: d.en, expiryDate, state: VDOC.publicState(st.state), days: st.days };
  });
  return {
    _id: vm._id,
    plateNumber: vm.plateNumber || '',
    brand: vm.brandAr || '',
    model: vm.modelAr || '',
    year: vm.modelYear || null,
    chassis: vm.chassisNumber || '',
    color: vm.colorAr || '',
    sector: vm.sectorAr || '',
    serviceStatus: vm.serviceStatusAr || '',
    docs,
  };
}

/** Attaches to each `FleetVehicle` row its registry image (`registry`) and reads make and colour from it; the copy is a fallback for unlinked ones. One query for all rows. */
async function decorateVehicles(rows) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((v) => v.vehicleMaster && String(v.vehicleMaster._id || v.vehicleMaster)).filter(Boolean))];
  if (!ids.length) {
    for (const v of list) { v.registry = null; v.linked = false; }
    return rows;
  }
  const { VehicleMaster } = require('../models/VehicleMaster');
  const [vms, alerts] = await Promise.all([
    VehicleMaster.find({ _id: { $in: ids } }).select(REGISTRY_SELECT).lean(),
    docAlerts(),
  ]);
  const byId = new Map(vms.map((m) => [String(m._id), m]));
  for (const v of list) {
    const vm = v.vehicleMaster ? byId.get(String(v.vehicleMaster._id || v.vehicleMaster)) : null;
    const reg = registryView(vm, alerts);
    v.registry = reg;
    v.linked = !!reg;
    if (reg) {
      // What is in the registry is the answer; the copy is read only if the registry field is empty.
      v.brand = reg.brand || v.brand || '';
      v.color = reg.color || v.color || '';
    }
  }
  return rows;
}

/** Identity of one vehicle (waybill snapshot at creation). */
async function vehicleIdentity(fleetVehicle) {
  if (!fleetVehicle) return null;
  const row = { ...fleetVehicle };
  await decorateVehicles([row]);
  return row;
}

const HR_SELECT = 'firstName lastName arabicName phone nationality iban idType iqamaNumber nationalId '
  + 'employmentStatus leaveViolation department jobTitle staffCategory employeeNumber';

const hrName = (e) => S(e && (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`));
/** ID number from either column (idType decides). */
const hrIdNumber = (e) => (e ? S(e.idType === 'national_id' ? (e.nationalId || e.iqamaNumber) : (e.iqamaNumber || e.nationalId)) : '');

/**
 * Decorates `FleetDriver` rows with their linked HR file: identity fields from
 * the file (stored values are the fallback), and work status. Terminated,
 * suspended, on leave (status or an approved leave covering today) or a leave
 * no-show means not working, with `offSource: 'hr'`. Read per request, never
 * written to the fleet row: HR alone writes work status. Two queries for all rows.
 */
async function decorateDrivers(rows) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((d) => d.employee && String(d.employee._id || d.employee)).filter(Boolean))];
  for (const d of list) { d.hr = null; d.hrLinked = false; }
  if (!ids.length) return rows;
  const Employee = require('../models/Employee');
  const LeaveRequest = require('../models/LeaveRequest');
  const today = require('./companyDay').todayKey();
  const [emps, leaves] = await Promise.all([
    Employee.find({ _id: { $in: ids } }).select(HR_SELECT).lean(),
    LeaveRequest.find({ employee: { $in: ids }, status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } })
      .select('employee').lean(),
  ]);
  const byId = new Map(emps.map((e) => [String(e._id), e]));
  const onLeave = new Set(leaves.map((l) => String(l.employee)));
  for (const d of list) {
    const e = d.employee ? byId.get(String(d.employee._id || d.employee)) : null;
    if (!e) continue;
    const status = e.employmentStatus || 'active';
    const leave = status === 'on_leave' || onLeave.has(String(e._id));
    d.hr = {
      _id: e._id,
      name: hrName(e),
      employeeNumber: e.employeeNumber || '',
      employmentStatus: status,
      department: e.department || '',
      jobTitle: e.jobTitle || '',
      onLeave: leave,
      leaveNoShow: !!e.leaveViolation?.since,
    };
    d.hrLinked = true;
    d.employee = e._id;
    d.name = hrName(e) || d.name;
    d.phone = S(e.phone) || d.phone || '';
    d.iqama = hrIdNumber(e) || d.iqama || '';
    d.nationality = S(e.nationality) || d.nationality || '';
    d.iban = S(e.iban) || d.iban || '';
    // An HR "not working" overrides the section's status; otherwise the section's stands.
    if (status === 'terminated') {
      d.working = false; d.offReason = 'other'; d.offNote = 'انتهت خدمته في الموارد البشرية'; d.offSource = 'hr';
    } else if (status === 'suspended') {
      d.working = false; d.offReason = 'other'; d.offNote = 'موقوف في الموارد البشرية'; d.offSource = 'hr';
    } else if (e.leaveViolation?.since) {
      d.working = false; d.offReason = 'leave'; d.offNote = `لم يعد من الإجازة منذ ${e.leaveViolation.since} — مخالفة`; d.offSource = 'hr';
    } else if (leave) {
      d.working = false; d.offReason = 'leave'; d.offNote = d.offNote || 'إجازة معتمدة في الموارد البشرية'; d.offSource = 'hr';
    }
  }
  return rows;
}

/** One driver: the waybill snapshot at creation is read from his file. */
async function driverIdentity(driver) {
  if (!driver) return null;
  const row = driver.toObject ? driver.toObject() : { ...driver };
  await decorateDrivers([row]);
  return row;
}

/** Fields owned by the HR file once the driver is linked; they are not written from the fleet. */
const HR_OWNED_DRIVER_FIELDS = ['name', 'phone', 'iqama', 'nationality', 'iban'];

/** The employee holding this ID number, matched in both columns; accepted only if exactly one. */
async function employeeByIdNumber(idNumber) {
  const n = S(idNumber).replace(/\s+/g, '');
  if (!n) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] }).select('_id').limit(2).lean();
  return rows.length === 1 ? rows[0] : null;
}

/** Announces a vehicle-register change the way the vehicles section does: its caches are cleared and then its event is sent (invalidate before announce; see announce-before-invalidate). */
function announceRegistry() {
  require('./vehicleAnnounce').announceVehicles({ from: 'fleet' });
}

module.exports = {
  REGISTRY_SELECT, registryView, decorateVehicles, vehicleIdentity, docAlerts,
  HR_SELECT, hrName, hrIdNumber, decorateDrivers, driverIdentity, HR_OWNED_DRIVER_FIELDS,
  employeeByIdNumber, announceRegistry,
};
