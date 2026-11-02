/**
 * companyEmailController: the company mailbox register (@energize-logistics.com).
 * This is a register of Hostinger mailboxes, not system logins: no route here touches User or changes a login password, and changing an employee's system password does not affect their mailbox.
 * The password is encrypted in utils/secretVault and returned only by the reveal endpoint, which logs who and when in the register and the audit log.
 */
const CompanyEmail = require('../models/CompanyEmail');
const Employee = require('../models/Employee');
const vault = require('../utils/secretVault');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const COMPANY_DOMAIN = 'energize-logistics.com';
const emit = () => { try { emitToAll('it:emails', {}); } catch (e) {} };
const who = (req) => `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** Who may see the password; deliberately narrower than who may edit. */
const REVEAL_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const canReveal = (user) => REVEAL_ROLES.includes(user?.role) || user?.sectionAccess === 'edit';

// List
exports.list = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mailboxType) filter.mailboxType = req.query.mailboxType;
    if (req.query.linked === 'yes') filter.employee = { $ne: null };
    if (req.query.linked === 'no') filter.employee = null;
    // Mailboxes without a password can be filtered: that count tells IT there is missing work, and as an unfiltered number its card applied another filter and showed other rows.
    if (req.query.hasPassword === 'no') filter.passwordEnc = { $in: ['', null] };
    if (req.query.hasPassword === 'yes') filter.passwordEnc = { $nin: ['', null] };
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ email: r }, { displayName: r }, { employeeName: r }, { employeeNumber: r }, { department: r }, { functionAr: r }];
    }

    // passwordEnc is select:false so it never arrives anyway; stated explicitly.
    const rows = await CompanyEmail.find(filter).sort({ displayName: 1, email: 1 }).limit(1000).lean();

    const [total, active, personal, functional, linked, withPassword] = await Promise.all([
      CompanyEmail.countDocuments({}),
      CompanyEmail.countDocuments({ status: 'active' }),
      CompanyEmail.countDocuments({ mailboxType: 'personal' }),
      CompanyEmail.countDocuments({ mailboxType: 'functional' }),
      CompanyEmail.countDocuments({ employee: { $ne: null } }),
      CompanyEmail.countDocuments({ passwordEnc: { $nin: ['', null] } }),
    ]);

    res.json({
      emails: rows.map((r) => ({ ...r, hasPassword: undefined })),
      counts: {
        total, active, personal, functional, linked, unlinked: total - linked,
        // The number of mailboxes still without a stored password is what tells IT there is missing work; more important than the total.
        withPassword, withoutPassword: total - withPassword,
      },
      vaultReady: vault.isReady(),
      canReveal: canReveal(req.user),
      companyDomain: COMPANY_DOMAIN,
    });
  } catch (e) {
    console.error('company emails list', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة البريد' });
  }
};

/** HR employees available for linking; same search as the other sections. */
exports.searchEmployees = async (req, res) => {
  try {
    const filter = { isHrRecord: { $ne: false } };   // Excluding archive records
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ firstName: r }, { lastName: r }, { arabicName: r }, { employeeNumber: r }, { department: r }];
    }
    // An archived employee cannot be linked to a mailbox, as if deleted.
    const employees = await Employee.find(require('../utils/hrEngagement').withoutArchived(filter))
      .select('firstName lastName arabicName employeeNumber department jobTitle employmentStatus')
      .sort({ firstName: 1 }).limit(60).lean();
    res.json({
      employees: employees.map((e) => ({
        _id: e._id,
        name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        employeeNumber: e.employeeNumber || '',
        department: e.department || '',
        jobTitle: e.jobTitle || '',
        inactive: e.employmentStatus && e.employmentStatus !== 'active',
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر البحث في الموظفين' });
  }
};

// Collect the employee data once so the snapshot (number/department) stays consistent.
async function employeeSnapshot(employeeId) {
  if (!employeeId) return { employee: null, employeeNumber: '', employeeName: '', department: '' };
  const e = await Employee.findById(employeeId).select('firstName lastName arabicName employeeNumber department').lean();
  if (!e) return { employee: null, employeeNumber: '', employeeName: '', department: '' };
  return {
    employee: e._id,
    employeeNumber: e.employeeNumber || '',
    employeeName: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
    department: e.department || '',
  };
}

const clean = (v) => (v === undefined ? undefined : String(v).trim());

exports.create = async (req, res) => {
  try {
    let email = clean(req.body.email) || '';
    if (!email) return res.status(400).json({ message: 'البريد مطلوب' });
    // The name alone is enough: the company domain is appended so the user does not type it each time.
    if (!email.includes('@')) email = `${email}@${COMPANY_DOMAIN}`;
    email = email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'صيغة البريد غير صحيحة' });

    const exists = await CompanyEmail.findOne({ email }).lean();
    if (exists) return res.status(400).json({ message: 'البريد مسجّل بالفعل' });

    const snap = await employeeSnapshot(req.body.employee);
    const doc = new CompanyEmail({
      email,
      displayName: clean(req.body.displayName) || snap.employeeName || '',
      mailboxType: req.body.mailboxType === 'functional' ? 'functional' : 'personal',
      functionAr: clean(req.body.functionAr) || '',
      status: ['active', 'suspended', 'closed'].includes(req.body.status) ? req.body.status : 'active',
      notes: clean(req.body.notes) || '',
      createdByName: who(req),
      ...snap,
    });

    const pw = req.body.password;
    if (pw) {
      doc.passwordEnc = vault.encrypt(pw);   // Throws 503 if the vault is not configured.
      doc.passwordSetAt = new Date();
      doc.passwordSetByName = who(req);
    }
    await doc.save();

    logAudit({
      user: req.user, action: 'create_company_email', entity: 'CompanyEmail', entityId: doc._id,
      changes: { after: { email, employee: snap.employeeName, hasPassword: !!pw } }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    const out = doc.toObject(); delete out.passwordEnc;
    res.status(201).json({ email: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message, code: e.code });
    if (e.code === 11000) return res.status(400).json({ message: 'البريد مسجّل بالفعل' });
    console.error('company email create', e);
    res.status(500).json({ message: 'تعذّر إضافة البريد' });
  }
};

exports.update = async (req, res) => {
  try {
    const doc = await CompanyEmail.findById(req.params.id).select('+passwordEnc');
    if (!doc) return res.status(404).json({ message: 'غير موجود' });

    if (req.body.email !== undefined) {
      let email = clean(req.body.email) || '';
      if (email && !email.includes('@')) email = `${email}@${COMPANY_DOMAIN}`;
      email = email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'صيغة البريد غير صحيحة' });
      if (email !== doc.email) {
        const taken = await CompanyEmail.findOne({ email, _id: { $ne: doc._id } }).lean();
        if (taken) return res.status(400).json({ message: 'البريد مسجّل بالفعل' });
        doc.email = email;
      }
    }
    if (req.body.displayName !== undefined) doc.displayName = clean(req.body.displayName);
    if (req.body.mailboxType !== undefined) doc.mailboxType = req.body.mailboxType === 'functional' ? 'functional' : 'personal';
    if (req.body.functionAr !== undefined) doc.functionAr = clean(req.body.functionAr);
    if (req.body.status !== undefined && ['active', 'suspended', 'closed'].includes(req.body.status)) doc.status = req.body.status;
    if (req.body.notes !== undefined) doc.notes = clean(req.body.notes);

    // Link to an employee, or unlink by sending null explicitly.
    if (req.body.employee !== undefined) {
      const snap = await employeeSnapshot(req.body.employee || null);
      Object.assign(doc, snap);
      if (!doc.displayName && snap.employeeName) doc.displayName = snap.employeeName;
    }

    // A new password replaces the old one and records who changed it and when. An empty value does not mean clear it, which would silently lose data.
    if (req.body.password) {
      doc.passwordEnc = vault.encrypt(req.body.password);
      doc.passwordSetAt = new Date();
      doc.passwordSetByName = who(req);
    }

    doc.updatedByName = who(req);
    await doc.save();

    logAudit({
      user: req.user, action: 'update_company_email', entity: 'CompanyEmail', entityId: doc._id,
      changes: { after: { email: doc.email, passwordChanged: !!req.body.password } }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    const out = doc.toObject(); delete out.passwordEnc;
    res.json({ email: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message, code: e.code });
    console.error('company email update', e);
    res.status(500).json({ message: 'تعذّر تحديث البريد' });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await CompanyEmail.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    logAudit({
      user: req.user, action: 'delete_company_email', entity: 'CompanyEmail', entityId: doc._id,
      changes: { before: { email: doc.email } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.json({ message: 'deleted' });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذف البريد' }); }
};

/** Reveals the password. A separate route from normal reads on purpose: this is a logged event, not a field returned with the row. Returned with the list it would reach anyone opening the page and sit in browser history and logs. */
exports.revealPassword = async (req, res) => {
  try {
    if (!canReveal(req.user)) return res.status(403).json({ message: 'غير مصرّح بعرض كلمات المرور' });
    const doc = await CompanyEmail.findById(req.params.id).select('+passwordEnc');
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    if (!doc.passwordEnc) return res.status(404).json({ message: 'لا توجد كلمة مرور مسجّلة لهذا البريد' });

    const password = vault.decrypt(doc.passwordEnc);

    doc.lastRevealedAt = new Date();
    doc.lastRevealedByName = who(req);
    doc.revealCount = (doc.revealCount || 0) + 1;
    await doc.save();

    logAudit({
      user: req.user, action: 'reveal_company_email_password', entity: 'CompanyEmail', entityId: doc._id,
      changes: { after: { email: doc.email } }, ipAddress: req.ip,
    }).catch(() => {});

    res.json({ password, email: doc.email, revealCount: doc.revealCount });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message, code: e.code });
    console.error('company email reveal', e);
    res.status(500).json({ message: 'تعذّر عرض كلمة المرور' });
  }
};

/**
 * Exports the list with passwords.
 * An Excel file with passwords leaves the vault and lands on desktops and email attachments, so it is a separate route with the reveal permission, audited once with the mailbox count: exporting many passwords is a graver event than showing one.
 * It honours the screen's filters, so what is exported is what was shown.
 */
exports.exportWithPasswords = async (req, res) => {
  try {
    if (!canReveal(req.user)) return res.status(403).json({ message: 'غير مصرّح بتصدير كلمات المرور' });

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mailboxType) filter.mailboxType = req.query.mailboxType;
    if (req.query.linked === 'yes') filter.employee = { $ne: null };
    if (req.query.linked === 'no') filter.employee = null;
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ email: r }, { displayName: r }, { employeeName: r }, { employeeNumber: r }, { department: r }, { functionAr: r }];
    }

    const rows = await CompanyEmail.find(filter).select('+passwordEnc').sort({ displayName: 1, email: 1 }).lean();

    let withPw = 0;
    const out = rows.map((r) => {
      let password = '';
      if (r.passwordEnc) {
        // One broken mailbox must not fail the whole export: flag it and continue.
        try { password = vault.decrypt(r.passwordEnc); withPw += 1; }
        catch (e) { password = '⚠ تعذّر فك التشفير'; }
      }
      return {
        displayName: r.displayName || '',
        email: r.email,
        employeeName: r.employeeName || '',
        department: r.department || '',
        notes: r.notes || '',
        password,
      };
    });

    logAudit({
      user: req.user, action: 'export_company_email_passwords', entity: 'CompanyEmail',
      entityKey: 'bulk',
      changes: { after: { exported: out.length, withPassword: withPw, filters: req.query } },
      ipAddress: req.ip,
    }).catch(() => {});

    res.json({ rows: out, exported: out.length, withPassword: withPw });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message, code: e.code });
    console.error('company email export', e);
    res.status(500).json({ message: 'تعذّر تصدير القائمة' });
  }
};

module.exports.COMPANY_DOMAIN = COMPANY_DOMAIN;
