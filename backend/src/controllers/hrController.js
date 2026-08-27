const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Contract = require('../models/Contract');
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
const { emitToUser } = require('../websocket/socketManager');
const { computeBalance, leaveDays } = require('../utils/leaveBalance');

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

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

// All active HR back-office users — the reviewers/recipients for HR events.
// The FULL_ACCESS roles (IT) see the same pages, so they get the same realtime
// refreshes; leaving them out kept their screens stale until manual reload.
const { FULL_ACCESS_ROLES } = require('../config/constants');
const hrStaffIds = async () => {
  const roles = [...new Set([...HR_STAFF_ROLES, ...FULL_ACCESS_ROLES])];
  const staff = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
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

// Lazily provision + link an employee profile for the current login. See the
// shared util for details. Used so any staff login (incl. the demo super admin)
// can use HR self-service without HR registering them first.
const ensureSelfEmployeeUtil = require('../utils/ensureSelfEmployee');
const { grantedBySection } = require('../utils/sectionAccess');
const ensureSelfEmployee = (req) => ensureSelfEmployeeUtil(req.user);

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
    // الفلاتر المتقدّمة (جنسية، قسم، فرع، مدى تاريخ…) تُقرأ بلغة لوحة الموارد
    // البشرية نفسها، فالفلتر الذي يعمل في الموقع يعمل هنا وفي التطبيق بلا فرق.
    // النطاق يبقى كما كان (كل السجلات) ما لم يطلب الطالب غير ذلك، حتى لا تختفي
    // من القائمة أسماءٌ كانت تظهر فيها.
    const master = require('./hrMasterController');
    const filter = master._buildFilter({ scope: 'all', ...req.query });
    if (status) filter.employmentStatus = status;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { arabicName: rx },
        { iqamaNumber: rx }, { nationalId: rx }, { employeeNumber: rx },
        { phone: rx }, { email: rx }, { jobTitle: rx },
      ];
    }
    // List/table view needs ~20 of the 74 employee fields — projecting cuts the
    // BSON deserialization + payload ~3x (the profile screen fetches the full
    // doc separately via getEmployee). And because the whole office loads this
    // same list concurrently, a 30s cache collapses that into one query set;
    // writes (create/update/terminate/renew) clear it so edits show immediately.
    const cache = require('../utils/ttlCache');
    const cacheKey = `hr:employees:${JSON.stringify(req.query || {})}`;
    const rows = await cache.wrap(cacheKey, 30000, () => Employee.find(filter)
      // حقول التواريخ كلها مطلوبة في المشروع لأن شرط المدى يُطبَّق على القيمة
      // بعد جلبها؛ الحقل غير المجلوب يبدو «بلا تاريخ» فيسقط من كل مدى بصمت.
      // ولذلك تُؤخَذ من مصدرها لا تُكتب هنا: كانت مكتوبةً بيدٍ، فكلُّ تاريخٍ
      // يُضاف إلى الفلترة يبقى ساقطًا هنا حتى يتذكّره أحد — وأثرُه صامت.
      .select(['firstName lastName arabicName employeeNumber jobTitle department employmentStatus',
        'phone email iqamaNumber nationalId nationality photo workLocation branchName',
        'project branch directManager user createdAt',
        ...master._DATE_FILTERABLE].join(' '))
      .populate('user', 'firstName lastName email role')
      .populate('directManager', 'firstName lastName email')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean());
    // مدى التاريخ يُطبَّق بعد الجلب: حقول التواريخ هنا نصوص تحمل كلمات إدارية
    // بجانب التاريخ، فمقارنتها في قاعدة البيانات تقارن نوعين مختلفين.
    const pred = master._dateRangePred(req.query);
    const employees = pred ? rows.filter(pred) : rows;
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
    if (!hrStaffReq(req) && String(employee.user?._id || employee.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const [contracts, leaves, assets, requests, documents, renewals, balanceData] = await Promise.all([
      Contract.find({ employee: id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color').sort({ createdAt: -1 }).limit(200).lean(),
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
      contracts,
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

exports.createEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const body = { ...req.body, createdBy: req.user._id };
    delete body.user; // linking is done from the Users screen, not here
    const employee = await Employee.create(body);
    await logAudit({ user: req.user._id, action: 'create_employee', entity: 'Employee', entityId: employee._id, changes: { after: { name: fullName(employee) } }, ipAddress: req.ip });
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
      // `branch` الفرع الأساسي، و`branches` الفروع الإضافية التي يعمل عليها
      // فعلًا — انظر models/Employee.
      'jobTitle', 'department', 'hireDate', 'actualWorkStartDate', 'workLocation', 'branch', 'branches', 'employmentStatus',
      'phone', 'email', 'address', 'emergencyContactName', 'emergencyContactPhone',
      'basicSalary', 'allowances', 'directManager', 'notes',
      // Banking
      'iban', 'bank',
      // Extra HR-sheet fields
      'fileStatus', 'absherNumber', 'companyNumber', 'originCountryNumber', 'project', 'registerNumber',
      'systemStatus', 'workStatusText', 'penaltyClause', 'iqamaProfession', 'classification',
      'insuranceCompany', 'insuranceExpiry', 'socialInsuranceStatus', 'visaExpiry',
      'lastTravelDate', 'lastReturnDate',
      // Driving / vehicle eligibility
      'vehiclePlate', 'licenseNumber', 'licenseType', 'licenseExpiry',
      'driverCardNumber', 'driverCardType', 'driverCardStatus', 'driverCardExpiry', 'workCard', 'ajeerStatus', 'ajeerExpiry',
    ];
    // Capture a before/after diff of only the fields that actually change, so the
    // audit log (and the profile "history" tab) shows exactly what HR edited.
    const before = {};
    const after = {};
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      let next = req.body[f] === '' && ['branch', 'directManager'].includes(f) ? null : req.body[f];
      // الفروع الإضافية مصفوفة، وقد تصل نصًّا مفصولًا بفواصل من نموذج قديم.
      // ولا يصحّ أن يتكرّر الفرع الأساسي داخلها — يبقى أساسيًّا مرةً واحدة.
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
    await employee.save();
    if (Object.keys(after).length) {
      await logAudit({ user: req.user._id, action: 'update_employee', entity: 'Employee', entityId: employee._id, changes: { before, after }, ipAddress: req.ip });
    }
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
    // Clean up the employee's stored document files, then their sub-records.
    const docs = await EmployeeDocument.find({ employee: employee._id }).select('fileUrl').lean();
    docs.forEach((d) => deleteStoredFile(d.fileUrl));
    await EmployeeDocument.deleteMany({ employee: employee._id });
    await EmployeeRenewal.deleteMany({ employee: employee._id });
    await employee.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_employee', entity: 'Employee', entityId: employee._id, changes: { before: { name: fullName(employee) } }, ipAddress: req.ip });
    await notifyHR({ title: 'Employee removed', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ message: 'Employee deleted' });
  } catch (error) {
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
  // العقد والشهادة الصحية كانا خارج التجديد، فيُعدَّل تاريخهما يدويًّا بلا أثر
  // يقول مَن جدّده ومن أي تاريخ — وهما أكثر ما يُسأل عنه عند المراجعة.
  contract: { expiry: 'contractEndDate', number: 'qiwaContractNumber' },
  healthCert: { expiry: 'healthCertExpiry', number: 'healthCertNumber' },
  other: {},
};

// مجموعة اللوحة → نوع المستند القابل للتجديد.
//
// اللوحة تسمّي المجموعات بأسماء عربية الأصل (`medicalInsurance`) والتجديد يسمّي
// المستندات بأسمائه (`insurance`). بغير هذا الجسر تفتح صفحة «التأمين الطبي»
// فلا تجد فيها تجديدًا، لأن الاسمين لا يلتقيان في أي مكان.
const GROUP_DOC_TYPE = {
  iqama: 'iqama',
  passport: 'passport',
  contract: 'contract',
  // رخص العمل: اسم المجموعة واسم المستند واحدٌ هنا، ووجودُه في هذا الجسر هو ما
  // يجعل زرَّ التجديد في صفحتها يعمل بدل أن يردّ «نوع المستند غير معروف».
  workPermit: 'workPermit',
  medicalInsurance: 'insurance',
  healthCertificate: 'healthCert',
  driverCard: 'driverCard',
  drivingLicense: 'license',
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

    const renewal = await EmployeeRenewal.create({
      employee: employee._id, docType,
      previousExpiry: previousExpiry || '', newExpiry: newExpiry || '',
      documentNumber: documentNumber || '', notes: notes || '',
      renewedBy: req.user._id, renewedAt: new Date(),
    });
    await logAudit({ user: req.user._id, action: 'renew_document', entity: 'Employee', entityId: employee._id, changes: { before: { docType, expiry: previousExpiry }, after: { expiry: newExpiry, documentNumber } }, ipAddress: req.ip });
    await notifyHR({ title: 'Document renewed', message: `${docType} for ${fullName(employee)}`, relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.status(201).json({ employee, renewal });
  } catch (error) {
    console.error('renewDocument error:', error);
    res.status(500).json({ message: 'Failed to renew document' });
  }
};

// End of service. Blocked while the employee still holds custody (same gate as
// terminating a contract). Also terminates any active contract.
exports.terminateEmployee = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const outstanding = await Asset.countDocuments({ employee: employee._id, status: 'assigned' });
    if (outstanding > 0) {
      return res.status(400).json({ message: `Cannot terminate: ${outstanding} custody item(s) not returned`, code: 'CUSTODY_OUTSTANDING', outstanding });
    }

    const reason = req.body.reason || '';
    const when = req.body.date ? new Date(req.body.date) : new Date();
    employee.employmentStatus = 'terminated';
    employee.terminatedAt = when;
    employee.terminationReason = reason;
    await employee.save();

    // Terminate the active contract too so both records agree.
    await Contract.updateMany(
      { employee: employee._id, status: 'active' },
      { $set: { status: 'terminated', terminatedAt: when, terminationReason: reason, custodyReturned: true } }
    );

    await logAudit({ user: req.user._id, action: 'terminate_employee', entity: 'Employee', entityId: employee._id, changes: { after: { reason, date: when } }, ipAddress: req.ip });
    await notifyHR({ title: 'Employee terminated', message: fullName(employee), relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    try { emitToUser(String(req.user._id), 'hr:contract', { id: String(employee._id) }); } catch (e) {}
    if (employee.user) await notifyUser(employee.user, { title: 'Contract ended', message: 'Your employment has been terminated.', relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
    res.json({ employee });
  } catch (error) {
    console.error('terminateEmployee error:', error);
    res.status(500).json({ message: 'Failed to terminate employee' });
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
    await employee.save();
    await logAudit({ user: req.user._id, action: 'reactivate_employee', entity: 'Employee', entityId: employee._id, changes: { after: { employmentStatus: 'active' } }, ipAddress: req.ip });
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
    await logAudit({ user: req.user._id, action: 'add_employee_document', entity: 'Employee', entityId: employee._id, changes: { after: { title: doc.title } }, ipAddress: req.ip });
    await notifyHR({ title: 'Document added', message: `${doc.title} — ${fullName(employee)}`, relatedEntity: 'Employee', relatedEntityId: employee._id, event: 'hr:employee' });
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
    await notifyHR({ title: 'Document updated', message: doc.title, relatedEntity: 'Employee', relatedEntityId: doc.employee, event: 'hr:employee' });
    const populated = await EmployeeDocument.findById(doc._id).populate('uploadedBy', 'firstName lastName').lean();
    res.json({ document: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update document' });
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
    await notifyHR({ title: 'Document removed', message: doc.title, relatedEntity: 'Employee', relatedEntityId: employeeId, event: 'hr:employee' });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete document' });
  }
};

// Change history for one employee — everything logAudit'd against this id.
exports.getEmployeeAudit = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // سجلُّ موظّفٍ واحد بلغ مئتين وثلاثةً وتسعين تعديلًا تحت سقف الثلاثمئة —
      // على بُعد سبعةٍ من أن يبتر تاريخَه بصمت. والسقف يُعلن نفسه الآن.
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
    res.status(500).json({ message: 'Failed to create leave type' });
  }
};

exports.updateLeaveType = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const lt = await LeaveType.findById(req.params.id);
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });
    ['nameEn', 'nameAr', 'paid', 'affectsBalance', 'color', 'active', 'requiresAdvanceNotice', 'minAdvanceDays'].forEach((f) => {
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
const NO_SIG = '-employeeSignature -managerDecision.signature -hrDecision.signature';
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
    const leaves = await populateLeave(LeaveRequest.find(filter)).select(NO_SIG).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave requests' });
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
      || String(leave.manager?._id || leave.manager) === uid;
    if (!allowed) return res.status(403).json({ message: 'Not allowed' });
    res.json({ leave });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave request' });
  }
};

exports.listMyLeaves = async (req, res) => {
  try {
    const leaves = await populateLeave(LeaveRequest.find({ requester: req.user._id })).select(NO_SIG).sort({ createdAt: -1 }).lean();
    // Resolve (auto-provisioning if needed) instead of trusting the cached
    // req.user.linkedEmployee — a stale token copy made this report "not
    // linked" for accounts that were linked all along.
    const employeeId = await ensureSelfEmployee(req);
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
    const leaves = await populateLeave(LeaveRequest.find({ manager: req.user._id })).select(NO_SIG).sort({ createdAt: -1 }).lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load team leaves' });
  }
};

// ── Advance-notice policy (سياسة الإخطار المسبق) ─────────────────────────────
// Planned leave must be filed a month ahead: nobody asks on Sunday to travel on
// Tuesday. Types marked `requiresAdvanceNotice: false` (مرضية / طارئة / وفاة /
// وضع) are exempt by design — you cannot plan an emergency.
//
// Today is taken as a plain YYYY-MM-DD so a request filed at 23:00 counts the
// same as one filed at 08:00 the same day.
const todayKey = () => new Date().toISOString().slice(0, 10);
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

    const days = leaveDays(startDate, endDate);
    const { balance } = await computeEmployeeBalance(req.user.linkedEmployee);
    const hasManager = !!req.user.manager;

    // Attach the requester's signature: the one they picked (signatureId), else
    // their default. No signature is fine (the sheet just shows a blank line).
    let employeeSignature = '';
    try {
      const me = await User.findById(req.user._id).select('+signatures').lean();
      const sigs = (me && me.signatures) || [];
      if (req.body.signatureId) employeeSignature = (sigs.find((s) => String(s._id) === String(req.body.signatureId)) || {}).dataUrl || '';
      else employeeSignature = ((sigs.find((s) => s.isDefault) || sigs[0]) || {}).dataUrl || '';
    } catch (e) { /* no signature is fine */ }

    const leave = await LeaveRequest.create({
      employee: req.user.linkedEmployee,
      requester: req.user._id,
      manager: req.user.manager || undefined,
      leaveType,
      leaveTypeCode: lt.code,
      startDate, endDate, days, reason,
      employeeSignature,
      status: hasManager ? 'pending_manager' : 'pending_hr',
      currentStage: hasManager ? 'manager' : 'hr',
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
    const { decision, note, signatureId } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'decision must be approved or rejected' });
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (['approved', 'rejected', 'cancelled'].includes(leave.status)) {
      return res.status(400).json({ message: 'This request has already been finalised' });
    }

    const staff = hrStaffReq(req);
    const isManager = String(leave.manager || '') === String(req.user._id);

    // Optional: the approver signs. Resolve the chosen signature (by id) from
    // their own signatures and snapshot it onto this decision.
    let signature = '';
    if (signatureId) {
      try {
        const me = await User.findById(req.user._id).select('+signatures').lean();
        signature = ((me && me.signatures) || []).find((s) => String(s._id) === String(signatureId))?.dataUrl || '';
      } catch (e) { /* ignore */ }
    }
    const stamp = { by: req.user._id, at: new Date(), decision, note: note || '', signature };

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
    res.status(500).json({ message: 'Failed to create request' });
  }
};

exports.replyRequest = async (req, res) => {
  try {
    const request = await HRRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    const staff = hrStaffReq(req);
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

// SIM cards sit on IT's register for convenience, but the line itself is an HR
// matter (it follows the employee, not the device), so HR keeps full control of
// them regardless of who issued them.
const HR_MANAGED_TYPES = new Set(['sim']);

// Everything else handed out by the Software & IT section stays IT's to manage.
// HR sees every detail of it (who holds what, since when, serial, notes) but the
// edit / return / delete actions belong to /system/it/custody, so they are
// refused here. super_admin is exempt — it owns every section anyway.
const denyItOwned = (req, res, asset) => {
  if (asset.issuedBySection !== 'it' || req.user.role === 'super_admin') return false;
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
    const assets = await Asset.find(filter)
      .populate('employee', 'firstName lastName arabicName iqamaNumber employeeNumber')
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
    // IT store stock lives in this collection but is not custody — HR never
    // lists it, so reaching one by id means something went wrong upstream.
    if (asset.status === 'in_stock') return res.status(404).json({ message: 'Asset not found' });
    if (denyItOwned(req, res, asset)) return;
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

// ── HR store (مستودع الموارد البشرية) ────────────────────────────────────────
// HR keeps its own shelf — uniforms, safety gear, access cards, office kit —
// which has nothing to do with the IT store. Both live in the one Asset
// collection (so a handed-out item is custody without changing collections) and
// are kept apart by `issuedBySection`. Everything below is scoped to 'hr'; the
// IT endpoints are scoped away from it.
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
    res.status(500).json({ message: 'Failed to create stock item' });
  }
};

exports.updateStock = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Scoped to the HR shelf, so this can never reach an IT store item.
    const item = await Asset.findOne({ _id: req.params.id, ...HR_STORE });
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    Object.assign(item, pickFields(req.body, HR_STOCK_EDITABLE));
    await item.save();
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update stock item' });
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
    res.status(500).json({ message: 'Failed to assign stock item' });
  }
};

// ── Company licenses & subscriptions (التراخيص والاشتراكات) ──────────────────
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

exports.createLicense = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.name || !req.body.category) return res.status(400).json({ message: 'Category and name are required' });
    const license = await CompanyLicense.create({ ...req.body, createdBy: req.user._id });
    await notifyHR({ title: 'License added', message: license.name, relatedEntity: 'CompanyLicense', relatedEntityId: license._id, event: 'hr:license' });
    res.status(201).json({ license });
  } catch (error) {
    console.error('createLicense error:', error);
    res.status(500).json({ message: 'Failed to create license' });
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
    res.json({ license });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update license' });
  }
};

exports.deleteLicense = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    await CompanyLicense.findByIdAndDelete(req.params.id);
    res.json({ message: 'License deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete license' });
  }
};

// ── Dashboard (HR staff) ─────────────────────────────────────────────────────
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Build an "expiring documents" feed across every dated field on the employee so
// HR sees ONE list of everything about to lapse (iqama, passport, license ...).
// المستندات دي **مصدرها config/hrFields** — نفس السبعة اللي في الماستر النهائي.
// كانت مكتوبة بالإيد وفيها حقول (التأشيرة، رخصة العمل، أجير) مش في الماستر
// أصلاً، وبياناتها بايتة من استيرادات قديمة — فكانت الداشبورد بتعرض أكتر من ١٠٠
// «تأشيرة منتهية» لناس محدش سألهم عن تأشيرة.
const EXPIRY_DOCS = require('../config/hrFields').DOCUMENT_GROUPS.map((g) => ({
  field: g.expiryField, type: g.key, en: g.en, ar: g.ar,
}));

// سجلات حسابات الدخول التلقائية مش موظفين — بتخرج من كل عدّاد.
// من غير الشرط ده الداشبورد كانت بتقول ٤٣٧ موظف والماستر بيقول ٣٧٨.
// نطاق «عدد الموظفين» — الملف الوظيفي الحالي، وهو نفسه الذي تعدّ به لوحة
// الموارد البشرية. كانت اللوحة تقول ٣٧٨ وهذه الصفحة ٣٨٠ في القسم نفسه، والرقمان
// معًا على شاشة واحدة يجعلان القارئ لا يصدّق أيًّا منهما. مَن خرج قبل بناء
// الملف سجلّه محفوظ تاريخًا ولا يُعدّ مع الموظفين.
const HR_ONLY = { isHrRecord: { $ne: false }, inCurrentMaster: true };

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
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 30000); return _send(b); };
    const today = new Date().toISOString().slice(0, 10);
    const in60 = addDays(60);
    const in90 = addDays(90);

    const [
      totalEmployees, activeEmployees, onLeaveCount, suspendedCount, terminatedCount,
      pendingLeaves, openRequests, assignedAssets, expiringContracts,
      byStatusAgg, byDeptAgg, byProjectAgg, byNationalityAgg, recentHiresRaw, docFieldEmployees,
      licensesAll,
    ] = await Promise.all([
      Employee.countDocuments(HR_ONLY),
      Employee.countDocuments({ ...HR_ONLY, employmentStatus: 'active' }),
      Employee.countDocuments({ ...HR_ONLY, employmentStatus: 'on_leave' }),
      Employee.countDocuments({ ...HR_ONLY, employmentStatus: 'suspended' }),
      Employee.countDocuments({ ...HR_ONLY, employmentStatus: 'terminated' }),
      LeaveRequest.countDocuments({ status: { $in: ['pending_manager', 'pending_hr'] } }),
      HRRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      // Employee-held custody only — IT store items are `in_stock`/employee null.
      Asset.countDocuments({ status: 'assigned', employee: { $ne: null } }),
      Contract.find({ status: 'active', endDate: { $gte: today, $lte: in90 } }).populate('employee', 'firstName lastName arabicName').sort({ endDate: 1 }).limit(50).lean(),
      Employee.aggregate([{ $match: HR_ONLY }, { $group: { _id: '$employmentStatus', count: { $sum: 1 } } }]),
      Employee.aggregate([{ $match: { ...HR_ONLY, department: { $nin: [null, ''] } } }, { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
      Employee.aggregate([{ $match: { ...HR_ONLY, project: { $nin: [null, ''] } } }, { $group: { _id: '$project', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
      Employee.aggregate([{ $match: { ...HR_ONLY, nationality: { $nin: [null, ''] } } }, { $group: { _id: '$nationality', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
      Employee.find({ ...HR_ONLY, hireDate: { $nin: [null, ''] } }).select('firstName lastName arabicName jobTitle hireDate').sort({ hireDate: -1 }).limit(8).lean(),
      // Pull only the fields we scan for expiry, for the whole active-ish workforce.
      Employee.find({ ...HR_ONLY, employmentStatus: { $ne: 'terminated' } })
        .select('firstName lastName arabicName iqamaNumber ' + EXPIRY_DOCS.map((d) => d.field).join(' '))
        .limit(5000).lean(),
      // Company licenses & subscriptions — few rows, pull all and compute in JS.
      CompanyLicense.find({}).select('name category location expiryDate').lean(),
    ]);

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
      },
      byStatus: byStatusAgg.map((r) => ({ status: r._id || 'unknown', count: r.count })),
      byDepartment: byDeptAgg.map((r) => ({ name: r._id, count: r.count })),
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
      LeaveRequest.find({ employee: id }).populate('leaveType', 'nameEn nameAr code color').sort({ createdAt: -1 }).limit(100).lean(),
      // `status: { $ne: 'in_stock' }` is belt-and-braces — a store item has
      // employee: null so it cannot match this query anyway.
      Asset.find({ employee: id, status: { $ne: 'in_stock' } }).sort({ createdAt: -1 }).lean(),
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
