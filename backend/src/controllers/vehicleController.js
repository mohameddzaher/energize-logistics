const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const VehicleAuthorization = require('../models/VehicleAuthorization');
const VehicleAccident = require('../models/VehicleAccident');
const Employee = require('../models/Employee');
const { emitToAll } = require('../websocket/socketManager');

// ── Roles / helpers ──────────────────────────────────────────────────────────
// The Vehicles section is shared by super admin, HR and Accounting.
const STAFF = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin', 'hr_manager', 'finance_manager'];
const isStaff = (user) => STAFF.includes(user.role);
const isAdmin = (user) => ADMIN.includes(user.role);

const today = () => new Date().toISOString().slice(0, 10);

const EMP_FIELDS = 'firstName lastName arabicName employeeNumber iqamaNumber jobTitle department phone';

const populateVehicle = (q) =>
  q.populate('branch', 'name')
    .populate('currentEmployee', EMP_FIELDS)
    .populate({ path: 'currentAuthorization', populate: { path: 'employee', select: EMP_FIELDS } });

const emit = (event, payload) => { try { emitToAll(event, payload); } catch (e) {} };

// Sync a vehicle's denormalized pointers to its single active authorization.
const syncVehiclePointers = async (vehicleId) => {
  const active = await VehicleAuthorization.findOne({ vehicle: vehicleId, status: 'active' }).sort({ createdAt: -1 });
  await Vehicle.findByIdAndUpdate(vehicleId, active
    ? { currentAuthorization: active._id, currentEmployee: active.employee, status: 'authorized' }
    : { $unset: { currentAuthorization: 1, currentEmployee: 1 }, status: 'parked' });
};

// Lightweight employee search for the authorize/transfer/accident pickers.
// Vehicle staff (which includes Accounting roles) can't call the HR endpoints,
// so the section exposes its own read-only search.
exports.searchEmployees = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { arabicName: rx },
        { iqamaNumber: rx }, { employeeNumber: rx }, { vehiclePlate: rx },
      ];
    }
    const employees = await Employee.find(filter).select(EMP_FIELDS).sort({ firstName: 1 }).limit(50).lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to search employees' });
  }
};

// ── Vehicles CRUD ──────────────────────────────────────────────────────────────
exports.listVehicles = async (req, res) => {
  try {
    const { q, type, status, branch, project } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (branch) filter.branch = branch;
    if (project) filter.project = project;
    let vehicles = await populateVehicle(Vehicle.find(filter)).sort({ plateNumber: 1 }).limit(5000).lean();
    if (q && q.trim()) {
      const s = q.trim().toLowerCase();
      vehicles = vehicles.filter((v) =>
        (v.plateNumber || '').toLowerCase().includes(s) ||
        (v.make || '').toLowerCase().includes(s) ||
        (v.model || '').toLowerCase().includes(s) ||
        (v.currentEmployee && `${v.currentEmployee.firstName || ''} ${v.currentEmployee.lastName || ''} ${v.currentEmployee.arabicName || ''}`.toLowerCase().includes(s))
      );
    }
    res.json({ vehicles });
  } catch (error) {
    console.error('listVehicles error:', error);
    res.status(500).json({ message: 'Failed to load vehicles' });
  }
};

exports.getVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const vehicle = await populateVehicle(Vehicle.findById(id)).lean();
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const [authorizations, accidents] = await Promise.all([
      VehicleAuthorization.find({ vehicle: id })
        .populate('employee', EMP_FIELDS)
        .populate('transferredTo', EMP_FIELDS)
        .populate('transferredFrom', EMP_FIELDS)
        .populate('createdBy', 'firstName lastName')
        .populate('endedBy', 'firstName lastName')
        .sort({ createdAt: -1 }).lean(),
      VehicleAccident.find({ vehicle: id })
        .populate('employee', EMP_FIELDS)
        .populate('createdBy', 'firstName lastName')
        .sort({ date: -1, createdAt: -1 }).lean(),
    ]);

    res.json({ vehicle, authorizations, accidents });
  } catch (error) {
    console.error('getVehicle error:', error);
    res.status(500).json({ message: 'Failed to load vehicle' });
  }
};

exports.createVehicle = async (req, res) => {
  try {
    const { plateNumber } = req.body;
    if (!plateNumber || !plateNumber.trim()) return res.status(400).json({ message: 'Plate number is required' });
    const exists = await Vehicle.findOne({ plateNumber: plateNumber.trim() });
    if (exists) return res.status(400).json({ message: 'A vehicle with this plate number already exists' });

    const allowed = ['plateNumber', 'type', 'make', 'model', 'year', 'color', 'branch', 'department', 'project', 'registrationExpiry', 'insuranceExpiry', 'status', 'notes'];
    const body = { createdBy: req.user._id };
    for (const f of allowed) if (req.body[f] !== undefined && req.body[f] !== '') body[f] = req.body[f];
    const vehicle = await Vehicle.create(body);
    const populated = await populateVehicle(Vehicle.findById(vehicle._id)).lean();
    emit('vehicle:updated', { id: String(vehicle._id) });
    res.status(201).json({ vehicle: populated });
  } catch (error) {
    console.error('createVehicle error:', error);
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const fields = ['plateNumber', 'type', 'make', 'model', 'year', 'color', 'branch', 'department', 'project', 'registrationExpiry', 'insuranceExpiry', 'status', 'notes'];
    for (const f of fields) {
      if (req.body[f] !== undefined) vehicle[f] = req.body[f] === '' && f === 'branch' ? null : req.body[f];
    }
    await vehicle.save();
    const populated = await populateVehicle(Vehicle.findById(vehicle._id)).lean();
    emit('vehicle:updated', { id: String(vehicle._id) });
    res.json({ vehicle: populated });
  } catch (error) {
    console.error('updateVehicle error:', error);
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    await VehicleAuthorization.deleteMany({ vehicle: vehicle._id });
    await VehicleAccident.deleteMany({ vehicle: vehicle._id });
    await vehicle.deleteOne();
    emit('vehicle:updated', { id: String(vehicle._id) });
    res.json({ message: 'Vehicle deleted' });
  } catch (error) {
    console.error('deleteVehicle error:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
};

// ── Authorizations ─────────────────────────────────────────────────────────────
exports.listAuthorizations = async (req, res) => {
  try {
    const { status, employee, vehicle } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (employee) filter.employee = employee;
    if (vehicle) filter.vehicle = vehicle;
    const authorizations = await VehicleAuthorization.find(filter)
      .populate('vehicle', 'plateNumber type make model')
      .populate('employee', EMP_FIELDS)
      .populate('transferredTo', EMP_FIELDS)
      .sort({ createdAt: -1 }).limit(5000).lean();
    res.json({ authorizations });
  } catch (error) {
    console.error('listAuthorizations error:', error);
    res.status(500).json({ message: 'Failed to load authorizations' });
  }
};

// Authorize a vehicle to an employee (issue a new تفويض). Fails if the vehicle
// already has an active authorization — use transfer for that.
exports.authorizeVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const { employee, startDate, authorizationType, documentNumber, documentExpiry, issuedBy, notes } = req.body;
    if (!employee || !mongoose.isValidObjectId(employee)) return res.status(400).json({ message: 'Employee is required' });
    const emp = await Employee.findById(employee).select('_id');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const existing = await VehicleAuthorization.findOne({ vehicle: vehicle._id, status: 'active' });
    if (existing) return res.status(400).json({ message: 'Vehicle already has an active authorization — transfer it instead', code: 'ALREADY_AUTHORIZED' });

    const auth = await VehicleAuthorization.create({
      vehicle: vehicle._id, employee,
      startDate: startDate || today(),
      authorizationType, documentNumber, documentExpiry, issuedBy, notes,
      createdBy: req.user._id,
    });
    // Keep the denormalized plate on the employee in sync.
    await Employee.findByIdAndUpdate(employee, { vehiclePlate: vehicle.plateNumber });
    await syncVehiclePointers(vehicle._id);
    emit('vehicle:authorization', { vehicle: String(vehicle._id), employee: String(employee) });
    emit('hr:employee', { id: String(employee) });
    res.status(201).json({ authorization: auth });
  } catch (error) {
    console.error('authorizeVehicle error:', error);
    res.status(500).json({ message: 'Failed to authorize vehicle' });
  }
};

// Transfer the active authorization from the current holder to a new employee.
exports.transferVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const { employee, startDate, authorizationType, documentNumber, documentExpiry, issuedBy, notes } = req.body;
    if (!employee || !mongoose.isValidObjectId(employee)) return res.status(400).json({ message: 'New employee is required' });
    const emp = await Employee.findById(employee).select('_id');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const active = await VehicleAuthorization.findOne({ vehicle: vehicle._id, status: 'active' });
    if (!active) return res.status(400).json({ message: 'Vehicle has no active authorization to transfer — authorize it instead', code: 'NOT_AUTHORIZED' });
    if (String(active.employee) === String(employee)) return res.status(400).json({ message: 'Vehicle is already authorized to this employee' });

    const date = startDate || today();
    const previousEmployee = active.employee;
    // Close the current authorization, pointing at the new holder.
    active.status = 'transferred';
    active.endDate = date;
    active.endReason = 'transferred';
    active.transferredTo = employee;
    active.endedBy = req.user._id;
    await active.save();
    // Clear the old holder's denormalized plate.
    await Employee.findByIdAndUpdate(previousEmployee, { vehiclePlate: '' });

    const auth = await VehicleAuthorization.create({
      vehicle: vehicle._id, employee,
      startDate: date,
      authorizationType: authorizationType || active.authorizationType,
      documentNumber, documentExpiry, issuedBy, notes,
      transferredFrom: previousEmployee,
      createdBy: req.user._id,
    });
    await Employee.findByIdAndUpdate(employee, { vehiclePlate: vehicle.plateNumber });
    await syncVehiclePointers(vehicle._id);
    emit('vehicle:authorization', { vehicle: String(vehicle._id), employee: String(employee) });
    emit('hr:employee', { id: String(employee) });
    emit('hr:employee', { id: String(previousEmployee) });
    res.status(201).json({ authorization: auth });
  } catch (error) {
    console.error('transferVehicle error:', error);
    res.status(500).json({ message: 'Failed to transfer authorization' });
  }
};

// Revoke the active authorization (vehicle parked / returned).
exports.revokeVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const { endDate, revokedReason } = req.body;
    const active = await VehicleAuthorization.findOne({ vehicle: vehicle._id, status: 'active' });
    if (!active) return res.status(400).json({ message: 'Vehicle has no active authorization to revoke', code: 'NOT_AUTHORIZED' });

    const previousEmployee = active.employee;
    active.status = 'revoked';
    active.endDate = endDate || today();
    active.endReason = 'revoked';
    active.revokedReason = revokedReason || '';
    active.endedBy = req.user._id;
    await active.save();
    await Employee.findByIdAndUpdate(previousEmployee, { vehiclePlate: '' });
    await syncVehiclePointers(vehicle._id);
    emit('vehicle:authorization', { vehicle: String(vehicle._id) });
    emit('hr:employee', { id: String(previousEmployee) });
    res.json({ authorization: active });
  } catch (error) {
    console.error('revokeVehicle error:', error);
    res.status(500).json({ message: 'Failed to revoke authorization' });
  }
};

// Edit metadata on an authorization record (does not change the holder).
exports.updateAuthorization = async (req, res) => {
  try {
    const auth = await VehicleAuthorization.findById(req.params.authId);
    if (!auth) return res.status(404).json({ message: 'Authorization not found' });
    const fields = ['startDate', 'endDate', 'authorizationType', 'documentNumber', 'documentExpiry', 'issuedBy', 'revokedReason', 'notes'];
    for (const f of fields) if (req.body[f] !== undefined) auth[f] = req.body[f];
    await auth.save();
    emit('vehicle:authorization', { vehicle: String(auth.vehicle) });
    res.json({ authorization: auth });
  } catch (error) {
    console.error('updateAuthorization error:', error);
    res.status(500).json({ message: 'Failed to update authorization' });
  }
};

exports.deleteAuthorization = async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
    const auth = await VehicleAuthorization.findById(req.params.authId);
    if (!auth) return res.status(404).json({ message: 'Authorization not found' });
    const vehicleId = auth.vehicle;
    await auth.deleteOne();
    await syncVehiclePointers(vehicleId);
    emit('vehicle:authorization', { vehicle: String(vehicleId) });
    res.json({ message: 'Authorization deleted' });
  } catch (error) {
    console.error('deleteAuthorization error:', error);
    res.status(500).json({ message: 'Failed to delete authorization' });
  }
};

// ── Accidents ──────────────────────────────────────────────────────────────────
exports.listAccidents = async (req, res) => {
  try {
    const { status, vehicle, employee, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vehicle) filter.vehicle = vehicle;
    if (employee) filter.employee = employee;
    let accidents = await VehicleAccident.find(filter)
      .populate('vehicle', 'plateNumber type make model')
      .populate('employee', EMP_FIELDS)
      .sort({ date: -1, createdAt: -1 }).limit(5000).lean();
    if (q && q.trim()) {
      const s = q.trim().toLowerCase();
      accidents = accidents.filter((a) =>
        (a.vehicle?.plateNumber || '').toLowerCase().includes(s) ||
        (a.description || '').toLowerCase().includes(s) ||
        (a.location || '').toLowerCase().includes(s) ||
        (a.employee && `${a.employee.firstName || ''} ${a.employee.lastName || ''} ${a.employee.arabicName || ''}`.toLowerCase().includes(s))
      );
    }
    res.json({ accidents });
  } catch (error) {
    console.error('listAccidents error:', error);
    res.status(500).json({ message: 'Failed to load accidents' });
  }
};

exports.createAccident = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const { date, description } = req.body;
    if (!date) return res.status(400).json({ message: 'Accident date is required' });
    if (!description || !description.trim()) return res.status(400).json({ message: 'Description is required' });

    // Default the involved employee/authorization to whoever held the vehicle then.
    const active = await VehicleAuthorization.findOne({ vehicle: vehicle._id, status: 'active' });
    const allowed = ['date', 'location', 'description', 'faultParty', 'severity', 'thirdPartyDetails', 'injuries', 'actionTaken', 'reportNumber', 'estimatedCost', 'actualCost', 'status', 'resolution', 'notes'];
    const body = { vehicle: vehicle._id, createdBy: req.user._id };
    for (const f of allowed) if (req.body[f] !== undefined && req.body[f] !== '') body[f] = req.body[f];
    body.employee = (req.body.employee && mongoose.isValidObjectId(req.body.employee)) ? req.body.employee : (active ? active.employee : undefined);
    body.authorization = active ? active._id : undefined;

    const accident = await VehicleAccident.create(body);
    await Vehicle.findByIdAndUpdate(vehicle._id, { $inc: { accidentCount: 1 } });
    emit('vehicle:accident', { vehicle: String(vehicle._id) });
    if (body.employee) emit('hr:employee', { id: String(body.employee) });
    res.status(201).json({ accident });
  } catch (error) {
    console.error('createAccident error:', error);
    res.status(500).json({ message: 'Failed to report accident' });
  }
};

exports.updateAccident = async (req, res) => {
  try {
    const accident = await VehicleAccident.findById(req.params.accId);
    if (!accident) return res.status(404).json({ message: 'Accident not found' });
    const fields = ['date', 'location', 'description', 'faultParty', 'severity', 'thirdPartyDetails', 'injuries', 'actionTaken', 'reportNumber', 'estimatedCost', 'actualCost', 'status', 'resolution', 'employee', 'notes'];
    for (const f of fields) {
      if (req.body[f] !== undefined) accident[f] = req.body[f] === '' && f === 'employee' ? null : req.body[f];
    }
    await accident.save();
    emit('vehicle:accident', { vehicle: String(accident.vehicle) });
    res.json({ accident });
  } catch (error) {
    console.error('updateAccident error:', error);
    res.status(500).json({ message: 'Failed to update accident' });
  }
};

exports.deleteAccident = async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Insufficient permissions' });
    const accident = await VehicleAccident.findById(req.params.accId);
    if (!accident) return res.status(404).json({ message: 'Accident not found' });
    const vehicleId = accident.vehicle;
    await accident.deleteOne();
    await Vehicle.findByIdAndUpdate(vehicleId, { $inc: { accidentCount: -1 } });
    emit('vehicle:accident', { vehicle: String(vehicleId) });
    res.json({ message: 'Accident deleted' });
  } catch (error) {
    console.error('deleteAccident error:', error);
    res.status(500).json({ message: 'Failed to delete accident' });
  }
};

// ── Per-employee history (for the employee profile "Authorizations" tab) ─────────
exports.getEmployeeHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!mongoose.isValidObjectId(employeeId)) return res.status(400).json({ message: 'Invalid id' });
    const [authorizations, accidents] = await Promise.all([
      VehicleAuthorization.find({ employee: employeeId })
        .populate('vehicle', 'plateNumber type make model status')
        .populate('transferredTo', EMP_FIELDS)
        .populate('transferredFrom', EMP_FIELDS)
        .sort({ createdAt: -1 }).lean(),
      VehicleAccident.find({ employee: employeeId })
        .populate('vehicle', 'plateNumber type make model')
        .sort({ date: -1, createdAt: -1 }).lean(),
    ]);
    const current = authorizations.find((a) => a.status === 'active') || null;
    res.json({ current, authorizations, accidents });
  } catch (error) {
    console.error('getEmployeeHistory error:', error);
    res.status(500).json({ message: 'Failed to load employee vehicle history' });
  }
};

// ── Dashboard ───────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const now = today();
    const soon = new Date(); soon.setDate(soon.getDate() + 30);
    const soonStr = soon.toISOString().slice(0, 10);

    const [
      byStatus, byType, byBranch, totalVehicles, activeAuths, openAccidents,
      recentAccidents, recentAuths,
      accBySeverity, accByFault, accByStatus, accCosts, totalAccidents,
      expiringAuths,
    ] = await Promise.all([
      Vehicle.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Vehicle.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Vehicle.aggregate([
        { $match: { branch: { $ne: null } } },
        { $group: { _id: '$branch', count: { $sum: 1 } } },
        { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
        { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 1, count: 1, name: '$branch.name' } },
        { $sort: { count: -1 } },
      ]),
      Vehicle.countDocuments({}),
      VehicleAuthorization.countDocuments({ status: 'active' }),
      VehicleAccident.countDocuments({ status: { $in: ['reported', 'investigating'] } }),
      VehicleAccident.find({}).populate('vehicle', 'plateNumber').populate('employee', EMP_FIELDS).sort({ date: -1, createdAt: -1 }).limit(8).lean(),
      VehicleAuthorization.find({}).populate('vehicle', 'plateNumber').populate('employee', EMP_FIELDS).populate('transferredTo', EMP_FIELDS).sort({ createdAt: -1 }).limit(8).lean(),
      VehicleAccident.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
      VehicleAccident.aggregate([{ $group: { _id: '$faultParty', count: { $sum: 1 } } }]),
      VehicleAccident.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      VehicleAccident.aggregate([{ $group: { _id: null, estimated: { $sum: '$estimatedCost' }, actual: { $sum: '$actualCost' } } }]),
      VehicleAccident.countDocuments({}),
      // Active authorizations whose document expires soon (or already expired).
      VehicleAuthorization.find({ status: 'active', documentExpiry: { $ne: null, $lte: soonStr } })
        .populate('vehicle', 'plateNumber type')
        .populate('employee', EMP_FIELDS)
        .sort({ documentExpiry: 1 }).limit(20).lean(),
    ]);

    const toMap = (arr) => arr.reduce((a, x) => { if (x._id != null) a[x._id] = x.count; return a; }, {});
    const statusMap = toMap(byStatus);
    const typeMap = toMap(byType);
    const costs = accCosts[0] || { estimated: 0, actual: 0 };
    const openExpiring = expiringAuths.filter((a) => a.documentExpiry); // already filtered, guard
    const expiredCount = openExpiring.filter((a) => a.documentExpiry < now).length;

    res.json({
      totals: {
        vehicles: totalVehicles,
        authorized: statusMap.authorized || 0,
        parked: statusMap.parked || 0,
        available: statusMap.available || 0,
        maintenance: statusMap.maintenance || 0,
        outOfService: statusMap.out_of_service || 0,
        activeAuthorizations: activeAuths,
        openAccidents,
        totalAccidents,
        estimatedAccidentCost: costs.estimated || 0,
        actualAccidentCost: costs.actual || 0,
        expiringAuthorizations: openExpiring.length,
        expiredAuthorizations: expiredCount,
      },
      byStatus: statusMap,
      byType: typeMap,
      byBranch,
      accidents: {
        bySeverity: toMap(accBySeverity),
        byFault: toMap(accByFault),
        byStatus: toMap(accByStatus),
      },
      expiringAuthorizations: openExpiring,
      recentAccidents,
      recentAuthorizations: recentAuths,
    });
  } catch (error) {
    console.error('vehicle getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};
