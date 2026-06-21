const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Contract = require('../models/Contract');
const LeaveType = require('../models/LeaveType');
const LeaveRequest = require('../models/LeaveRequest');
const HRRequest = require('../models/HRRequest');
const Asset = require('../models/Asset');
const { createNotification } = require('../services/notificationService');
const { emitToUser } = require('../websocket/socketManager');
const { computeBalance, leaveDays } = require('../utils/leaveBalance');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const HR_STAFF_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'];
const isHRStaff = (user) => HR_STAFF_ROLES.includes(user.role);
const denyNonStaff = (req, res) => {
  if (!isHRStaff(req.user)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return true;
  }
  return false;
};

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

// All active HR back-office users — the reviewers/recipients for HR events.
const hrStaffIds = async () => {
  const staff = await User.find({ role: { $in: HR_STAFF_ROLES }, isActive: true }).select('_id').lean();
  return staff.map((s) => s._id);
};

// Notify every HR staff member + emit a realtime event to each of them.
const notifyHR = async ({ title, message, relatedEntity, relatedEntityId, event }) => {
  const ids = await hrStaffIds();
  await Promise.all(
    ids.map((rid) =>
      createNotification({ recipient: rid, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {})
    )
  );
  if (event) ids.forEach((rid) => { try { emitToUser(String(rid), event, { id: String(relatedEntityId || '') }); } catch (e) {} });
};

const notifyUser = async (userId, { title, message, relatedEntity, relatedEntityId, event }) => {
  if (!userId) return;
  await createNotification({ recipient: userId, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {});
  if (event) { try { emitToUser(String(userId), event, { id: String(relatedEntityId || '') }); } catch (e) {} }
};

const getActiveContract = (employeeId) =>
  Contract.findOne({ employee: employeeId, status: 'active' }).sort({ createdAt: -1 }).lean();

// Live leave balance for an employee: active contract + sum of approved,
// balance-affecting leave → progressive accrual maths.
const computeEmployeeBalance = async (employeeId, asOf = new Date()) => {
  const contract = await getActiveContract(employeeId);
  const approved = await LeaveRequest.find({ employee: employeeId, status: 'approved' })
    .populate('leaveType', 'affectsBalance')
    .select('days leaveType')
    .lean();
  const taken = approved.reduce(
    (s, l) => s + ((l.leaveType?.affectsBalance ?? true) ? (l.days || 0) : 0),
    0
  );
  return { contract, balance: computeBalance(contract, taken, asOf) };
};

// ── Employees ─────────────────────────────────────────────────────────────────
exports.listEmployees = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, status } = req.query;
    const filter = {};
    if (status) filter.employmentStatus = status;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { arabicName: rx },
        { iqamaNumber: rx }, { nationalId: rx }, { employeeNumber: rx },
        { phone: rx }, { email: rx }, { jobTitle: rx },
      ];
    }
    const employees = await Employee.find(filter)
      .populate('user', 'firstName lastName email role')
      .populate('directManager', 'firstName lastName email')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    res.json({ employees });
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
    const employees = await Employee.find(filter)
      .select('firstName lastName arabicName iqamaNumber employeeNumber jobTitle user')
      .sort({ firstName: 1 })
      .limit(25)
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
    if (!isHRStaff(req.user) && String(employee.user?._id || employee.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const [contracts, leaves, assets, requests, balanceData] = await Promise.all([
      Contract.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color').sort({ createdAt: -1 }).limit(200).lean(),
      Asset.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      HRRequest.find({ employee: id }).sort({ createdAt: -1 }).limit(100).lean(),
      computeEmployeeBalance(id),
    ]);

    res.json({
      employee,
      contracts,
      activeContract: balanceData.contract || null,
      balance: balanceData.balance,
      leaves,
      assets,
      requests,
    });
  } catch (error) {
    console.error('getEmployee error:', error);
    res.status(500).json({ message: 'Failed to load employee' });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const body = { ...req.body, createdBy: req.user._id };
    delete body.user; // linking is done from the Users screen, not here
    const employee = await Employee.create(body);
    try { emitToUser(String(req.user._id), 'hr:employee', { id: String(employee._id) }); } catch (e) {}
    await notifyHR({ title: 'New employee added', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.status(201).json({ employee });
  } catch (error) {
    console.error('createEmployee error:', error);
    res.status(500).json({ message: 'Failed to create employee' });
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
      'jobTitle', 'department', 'hireDate', 'workLocation', 'branch', 'employmentStatus',
      'phone', 'email', 'address', 'emergencyContactName', 'emergencyContactPhone',
      'basicSalary', 'allowances', 'directManager', 'notes',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) employee[f] = req.body[f] === '' && ['branch', 'directManager'].includes(f) ? null : req.body[f];
    }
    await employee.save();
    await notifyHR({ title: 'Employee updated', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('updateEmployee error:', error);
    res.status(500).json({ message: 'Failed to update employee' });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({ message: 'Only HR managers can delete employees' });
    }
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    // Detach any linked login account.
    if (employee.user) await User.updateOne({ _id: employee.user }, { $unset: { linkedEmployee: 1 } });
    await employee.deleteOne();
    await notifyHR({ title: 'Employee removed', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ message: 'Employee deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete employee' });
  }
};

// ── Contracts ────────────────────────────────────────────────────────────────
exports.listContracts = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.status) filter.status = req.query.status;
    const contracts = await Contract.find(filter)
      .populate({ path: 'employee', select: 'firstName lastName arabicName iqamaNumber employeeNumber jobTitle' })
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    res.json({ contracts });
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
    await notifyHR({ title: 'Contract created', message: `Contract for employee ${employee}`, relatedEntity: 'Contract', relatedEntityId: contract._id, event: 'hr:contract' });
    res.status(201).json({ contract });
  } catch (error) {
    console.error('createContract error:', error);
    res.status(500).json({ message: 'Failed to create contract' });
  }
};

exports.updateContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });
    const fields = ['type', 'startDate', 'endDate', 'durationMonths', 'annualLeaveDays', 'jobTitle', 'basicSalary', 'allowances', 'probationMonths', 'status', 'notes'];
    for (const f of fields) if (req.body[f] !== undefined) contract[f] = req.body[f];
    await contract.save();
    try { emitToUser(String(req.user._id), 'hr:contract', { id: String(contract._id) }); } catch (e) {}
    res.json({ contract });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update contract' });
  }
};

// Terminating a contract is blocked while the employee still holds custody.
exports.terminateContract = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });

    const outstanding = await Asset.countDocuments({ employee: contract.employee, status: 'assigned' });
    if (outstanding > 0) {
      return res.status(400).json({ message: `Cannot terminate: ${outstanding} custody item(s) not returned`, code: 'CUSTODY_OUTSTANDING', outstanding });
    }

    contract.status = 'terminated';
    contract.terminatedAt = new Date();
    contract.terminationReason = req.body.reason || '';
    contract.custodyReturned = true;
    await contract.save();

    // Reflect on the employee record + notify in real time everywhere.
    await Employee.findByIdAndUpdate(contract.employee, {
      employmentStatus: 'terminated', terminatedAt: new Date(), terminationReason: req.body.reason || '',
    });
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
    try { emitToUser(String(req.user._id), 'hr:contract', { id: String(contract._id) }); } catch (e) {}
    res.json({ message: 'Contract deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete contract' });
  }
};

// ── Leave types ──────────────────────────────────────────────────────────────
exports.listLeaveTypes = async (req, res) => {
  try {
    // Everyone can read; employees only see active ones for the dropdown.
    const filter = isHRStaff(req.user) ? {} : { active: true };
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
    res.status(500).json({ message: 'Failed to create leave type' });
  }
};

exports.updateLeaveType = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const lt = await LeaveType.findById(req.params.id);
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });
    ['nameEn', 'nameAr', 'paid', 'affectsBalance', 'color', 'active'].forEach((f) => {
      if (req.body[f] !== undefined) lt[f] = req.body[f];
    });
    await lt.save();
    res.json({ leaveType: lt });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update leave type' });
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
const populateLeave = (q) => q
  .populate('employee', 'firstName lastName arabicName iqamaNumber employeeNumber')
  .populate('requester', 'firstName lastName email')
  .populate('manager', 'firstName lastName')
  .populate('leaveType', 'nameEn nameAr code color affectsBalance')
  .populate('managerDecision.by', 'firstName lastName')
  .populate('hrDecision.by', 'firstName lastName');

exports.listLeaves = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.employee) filter.employee = req.query.employee;
    const leaves = await populateLeave(LeaveRequest.find(filter)).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave requests' });
  }
};

exports.listMyLeaves = async (req, res) => {
  try {
    const leaves = await populateLeave(LeaveRequest.find({ requester: req.user._id })).sort({ createdAt: -1 }).lean();
    let balance = null;
    if (req.user.linkedEmployee) ({ balance } = await computeEmployeeBalance(req.user.linkedEmployee));
    res.json({ leaves, balance });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load your leaves' });
  }
};

// Leave requests from the current user's direct reports awaiting their action.
exports.listTeamLeaves = async (req, res) => {
  try {
    const leaves = await populateLeave(LeaveRequest.find({ manager: req.user._id })).sort({ createdAt: -1 }).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load team leaves' });
  }
};

exports.createMyLeave = async (req, res) => {
  try {
    if (!req.user.linkedEmployee) {
      return res.status(400).json({ message: 'Your account is not linked to an employee profile yet. Contact HR.' });
    }
    const { leaveType, startDate, endDate, reason } = req.body;
    if (!leaveType || !startDate || !endDate) return res.status(400).json({ message: 'Leave type and dates are required' });
    const lt = await LeaveType.findById(leaveType).lean();
    if (!lt) return res.status(400).json({ message: 'Invalid leave type' });

    const days = leaveDays(startDate, endDate);
    const { balance } = await computeEmployeeBalance(req.user.linkedEmployee);
    const hasManager = !!req.user.manager;

    const leave = await LeaveRequest.create({
      employee: req.user.linkedEmployee,
      requester: req.user._id,
      manager: req.user.manager || undefined,
      leaveType,
      leaveTypeCode: lt.code,
      startDate, endDate, days, reason,
      status: hasManager ? 'pending_manager' : 'pending_hr',
      currentStage: hasManager ? 'manager' : 'hr',
      balanceSnapshot: {
        accrued: balance.accrued,
        requested: days,
        remainingAfter: lt.affectsBalance ? Math.round((balance.available - days) * 100) / 100 : balance.available,
      },
    });

    const name = fullName(req.user);
    if (hasManager) {
      await notifyUser(req.user.manager, { title: 'Leave request to review', message: `${name} requested ${days} day(s) (${startDate} → ${endDate}).`, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' });
    } else {
      await notifyHR({ title: 'New leave request', message: `${name} requested ${days} day(s).`, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' });
    }
    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    res.status(201).json({ leave: populated });
  } catch (error) {
    console.error('createMyLeave error:', error);
    res.status(500).json({ message: 'Failed to create leave request' });
  }
};

// Manager advances to HR; HR is the final authority. A rejection at any stage ends it.
exports.decideLeave = async (req, res) => {
  try {
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'decision must be approved or rejected' });
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (['approved', 'rejected', 'cancelled'].includes(leave.status)) {
      return res.status(400).json({ message: 'This request has already been finalised' });
    }

    const staff = isHRStaff(req.user);
    const isManager = String(leave.manager || '') === String(req.user._id);
    const stamp = { by: req.user._id, at: new Date(), decision, note: note || '' };

    if (staff) {
      // HR decision is final regardless of current stage.
      leave.hrDecision = stamp;
      leave.status = decision === 'approved' ? 'approved' : 'rejected';
      leave.currentStage = 'done';
    } else if (isManager && leave.currentStage === 'manager') {
      leave.managerDecision = stamp;
      if (decision === 'rejected') {
        leave.status = 'rejected';
        leave.currentStage = 'done';
      } else {
        leave.status = 'pending_hr';
        leave.currentStage = 'hr';
      }
    } else {
      return res.status(403).json({ message: 'You cannot act on this request at its current stage' });
    }
    await leave.save();

    // Notify the requester of the outcome / progress, and HR when it reaches them.
    if (leave.status === 'pending_hr') {
      await notifyHR({ title: 'Leave awaiting HR', message: `A leave request advanced to HR review.`, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' });
      await notifyUser(leave.requester, { title: 'Leave approved by manager', message: 'Your leave was approved by your manager and is now with HR.', relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' });
    } else {
      await notifyUser(leave.requester, { title: decision === 'approved' ? 'Leave approved' : 'Leave rejected', message: `Your leave (${leave.startDate} → ${leave.endDate}) was ${decision}.`, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id, event: 'hr:leave' });
    }
    if (leave.manager) { try { emitToUser(String(leave.manager), 'hr:leave', { id: String(leave._id) }); } catch (e) {} }

    const populated = await populateLeave(LeaveRequest.findById(leave._id)).lean();
    res.json({ leave: populated });
  } catch (error) {
    console.error('decideLeave error:', error);
    res.status(500).json({ message: 'Failed to update leave request' });
  }
};

exports.cancelMyLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (String(leave.requester) !== String(req.user._id)) return res.status(403).json({ message: 'Not your request' });
    if (!['pending_manager', 'pending_hr'].includes(leave.status)) return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    leave.status = 'cancelled';
    leave.currentStage = 'done';
    await leave.save();
    if (leave.manager) { try { emitToUser(String(leave.manager), 'hr:leave', { id: String(leave._id) }); } catch (e) {} }
    res.json({ leave });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel leave request' });
  }
};

// ── HR requests (general) ────────────────────────────────────────────────────
const populateRequest = (q) => q
  .populate('requester', 'firstName lastName email')
  .populate('employee', 'firstName lastName iqamaNumber employeeNumber')
  .populate('assignedTo', 'firstName lastName')
  .populate('thread.sender', 'firstName lastName role');

exports.listRequests = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const requests = await populateRequest(HRRequest.find(filter)).sort({ updatedAt: -1 }).limit(1000).lean();
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
    res.status(500).json({ message: 'Failed to create request' });
  }
};

exports.replyRequest = async (req, res) => {
  try {
    const request = await HRRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    const staff = isHRStaff(req.user);
    const owner = String(request.requester) === String(req.user._id);
    if (!staff && !owner) return res.status(403).json({ message: 'No access to this request' });

    const { body, link } = req.body;
    if ((!body || !body.trim()) && (!link || !link.trim())) return res.status(400).json({ message: 'Message cannot be empty' });
    request.thread.push({ sender: req.user._id, body: (body || '').trim(), link: (link || '').trim() });

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
    res.status(500).json({ message: 'Failed to update request' });
  }
};

// ── Assets / custody ─────────────────────────────────────────────────────────
exports.listAssets = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.status) filter.status = req.query.status;
    const assets = await Asset.find(filter)
      .populate('employee', 'firstName lastName arabicName iqamaNumber employeeNumber')
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
    const asset = await Asset.create({ ...req.body, createdBy: req.user._id });
    await notifyHR({ title: 'Custody assigned', message: `${asset.name}`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    const emp = await Employee.findById(asset.employee).select('user').lean();
    if (emp?.user) await notifyUser(emp.user, { title: 'New custody item', message: `${asset.name} was assigned to you.`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    res.status(201).json({ asset });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create asset' });
  }
};

exports.updateAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    ['name', 'type', 'serialNumber', 'brand', 'model', 'condition', 'value', 'assignedDate', 'notes'].forEach((f) => {
      if (req.body[f] !== undefined) asset[f] = req.body[f];
    });
    await asset.save();
    try { emitToUser(String(req.user._id), 'hr:asset', { id: String(asset._id) }); } catch (e) {}
    res.json({ asset });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update asset' });
  }
};

// Returning custody is the gate that unlocks contract termination — emit an
// employee event too so any open profile/contract screen refreshes instantly.
exports.returnAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    asset.status = 'returned';
    asset.returnedDate = req.body.returnedDate || new Date().toISOString().slice(0, 10);
    if (req.body.returnedCondition) asset.returnedCondition = req.body.returnedCondition;
    asset.returnedTo = req.user._id;
    await asset.save();
    await notifyHR({ title: 'Custody returned', message: `${asset.name} returned`, relatedEntity: 'Asset', relatedEntityId: asset._id, event: 'hr:asset' });
    try { emitToUser(String(req.user._id), 'hr:employee', { id: String(asset.employee) }); } catch (e) {}
    res.json({ asset });
  } catch (error) {
    res.status(500).json({ message: 'Failed to return asset' });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    await Asset.findByIdAndDelete(req.params.id);
    res.json({ message: 'Asset deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete asset' });
  }
};

// ── Dashboard (HR staff) ─────────────────────────────────────────────────────
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const today = new Date().toISOString().slice(0, 10);
    const in60 = addDays(60);

    const [totalEmployees, activeEmployees, pendingLeaves, openRequests, assignedAssets, expiringIqamas, expiringContracts] = await Promise.all([
      Employee.countDocuments({}),
      Employee.countDocuments({ employmentStatus: 'active' }),
      LeaveRequest.countDocuments({ status: { $in: ['pending_manager', 'pending_hr'] } }),
      HRRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      Asset.countDocuments({ status: 'assigned' }),
      Employee.find({ iqamaExpiry: { $gte: today, $lte: in60 } }).select('firstName lastName iqamaNumber iqamaExpiry').sort({ iqamaExpiry: 1 }).limit(50).lean(),
      Contract.find({ status: 'active', endDate: { $gte: today, $lte: in60 } }).populate('employee', 'firstName lastName').sort({ endDate: 1 }).limit(50).lean(),
    ]);

    res.json({
      summary: { totalEmployees, activeEmployees, pendingLeaves, openRequests, assignedAssets },
      expiringIqamas,
      expiringContracts,
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Self-service profile + team detection ────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    if (!req.user.linkedEmployee) return res.json({ employee: null });
    const id = req.user.linkedEmployee;
    const [employee, contracts, leaves, assets, balanceData] = await Promise.all([
      Employee.findById(id).populate('directManager', 'firstName lastName email').populate('branch', 'name').lean(),
      Contract.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color').sort({ createdAt: -1 }).limit(100).lean(),
      Asset.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      computeEmployeeBalance(id),
    ]);
    res.json({ employee, contracts, activeContract: balanceData.contract || null, balance: balanceData.balance, leaves, assets });
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
      User.find({ isActive: true, role: { $ne: 'client' } }).select('firstName lastName email role').sort({ firstName: 1 }).lean(),
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
    const reports = await User.find({ manager: req.user._id }).select('firstName lastName email role linkedEmployee').lean();
    res.json({ hasTeam: reports.length > 0, teamCount: reports.length, team: reports });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load team' });
  }
};
