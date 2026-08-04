/**
 * companyEmailController — سجل بريد الشركة (@energize-logistics.com).
 *
 * الفرق اللي كل حاجة هنا مبنية عليه: ده سجل صناديق بريد على هوستنجر، **مش**
 * حسابات الدخول للسيستم. مفيش أي مسار هنا بيلمس `User` ولا بيغيّر باسوورد دخول،
 * والعكس صحيح — تغيير باسوورد الموظف في السيستم ما بيأثرش على بريده إطلاقًا.
 *
 * كلمة المرور مشفّرة في `utils/secretVault` وبترجع **بس** من endpoint الكشف،
 * ومع كل كشف بيتسجّل مين وامتى في السجل وفي audit log.
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

/** مين يشوف كلمة المرور. أضيق من «يقدر يعدّل» عن قصد. */
const REVEAL_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const canReveal = (user) => REVEAL_ROLES.includes(user?.role) || user?.sectionAccess === 'edit';

// ── القائمة ──────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mailboxType) filter.mailboxType = req.query.mailboxType;
    if (req.query.linked === 'yes') filter.employee = { $ne: null };
    if (req.query.linked === 'no') filter.employee = null;
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ email: r }, { displayName: r }, { employeeName: r }, { employeeNumber: r }, { department: r }, { functionAr: r }];
    }

    // passwordEnc عليها select:false، فهي أصلاً مش هتيجي — بس نكون صريحين.
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
        // «كام صندوق لسه من غير كلمة مرور مسجّلة» هو الرقم اللي بيقول لتقنية
        // المعلومات فيه شغل ناقص — أهم من إجمالي عدد الصناديق.
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

/** موظفو الموارد البشرية للربط — نفس بحث بقية الأقسام. */
exports.searchEmployees = async (req, res) => {
  try {
    const filter = {};
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ firstName: r }, { lastName: r }, { arabicName: r }, { employeeNumber: r }, { department: r }];
    }
    const employees = await Employee.find(filter)
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

// نجمع بيانات الموظف مرة واحدة عشان اللقطة (الرقم/القسم) تفضل متسقة.
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
    // الاسم لوحده كفاية: بنكمّل الدومين بتاع الشركة بدل ما المستخدم يكتبه كل مرة.
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
      doc.passwordEnc = vault.encrypt(pw);   // بيرمي 503 لو الخزنة مش مهيأة
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

    // الربط بموظف — أو فكّه بإرسال null صراحةً.
    if (req.body.employee !== undefined) {
      const snap = await employeeSnapshot(req.body.employee || null);
      Object.assign(doc, snap);
      if (!doc.displayName && snap.employeeName) doc.displayName = snap.employeeName;
    }

    // كلمة مرور جديدة: بنستبدلها، وبنسجّل مين غيّرها وامتى. إرسال قيمة فاضية
    // مش معناه «امسحها» — ده هيبقى فقدان بيانات بالسكوت.
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

/**
 * كشف كلمة المرور. مسار منفصل عن القراءة العادية عن قصد: ده حدث بيتسجّل، مش
 * حقل بيرجع مع باقي الصف. لو رجعت مع القائمة كانت هتوصل لأي حد يفتح الصفحة
 * وهتقعد في تاريخ المتصفح والـ logs.
 */
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
 * تصدير القائمة مع كلمات المرور.
 *
 * ملف إكسل فيه كلمات مرور بيسيب الخزنة ويقعد على ديسك توب حد وفي مرفقات إيميل،
 * فده مسار منفصل بنفس صلاحية الكشف، وبيتسجّل في سجل التدقيق **مرة واحدة بعدد
 * الصناديق** — تصدير ٨٠ كلمة مرور حدث أخطر من عرض واحدة، ولازم يبان كده.
 *
 * بيحترم نفس الفلاتر بتاعة الشاشة، عشان اللي اتصدّر هو اللي كان معروض.
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
        // صندوق واحد بايظ ما يوقّعش التصدير كله — نعلّم عليه ونكمّل.
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
