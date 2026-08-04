/**
 * partnerController — إنشاء وإدارة حسابات دخول العملاء والموردين.
 *
 * Two jobs:
 *   1. Present EVERY customer/supplier the company has, from every section's own
 *      register, as one searchable list with the register's name beside each row
 *      ("شركة كذا — عميل تخليص جمركي"), so the users page can offer them in a
 *      dropdown and the profile pages can look themselves up.
 *   2. Turn any of those rows into a portal login (email + password) and manage
 *      it afterwards — reset the password, deactivate, unlink.
 *
 * The account it creates is an ordinary User with `role: 'client'` (the existing
 * external-user role, so every RBAC rule already treats it as an outsider) plus
 * `accountType` + `partner` telling the portal WHICH outsider it is.
 */
const User = require('../models/User');
const { REGISTERS, REGISTER_BY_KEY, modelFor, registerMeta, SERVICES } = require('../config/partnerRegisters');
const { nameKey, nameRegex } = require('../utils/nameKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { invalidateUserCache } = require('../middleware/auth');

// Who may mint an outside login. Deliberately narrow: this hands somebody
// outside the company a key to their own data.
const ACCOUNT_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const canAdmin = (req) => ACCOUNT_ADMIN_ROLES.includes(req.user.role);

exports.getRegisters = async (req, res) => {
  res.json({ registers: registerMeta(), services: SERVICES });
};

/**
 * Load one register's rows as picker items. Virtual registers (customs) have no
 * collection of their own, so their rows are the distinct names on the files.
 */
async function loadRegister(reg, q, limit) {
  const Model = modelFor(reg.key);
  if (!Model) return [];

  if (reg.virtual) {
    const match = { customerName: { $nin: [null, ''] } };
    if (q) match.customerName = { $regex: nameRegex(q), $nin: [null, ''] };
    const rows = await Model.aggregate([
      { $match: match },
      { $group: { _id: '$customerName', jobs: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $sort: { jobs: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => ({
      source: reg.key,
      kind: reg.kind,
      refId: nameKey(r._id), // virtual rows are identified by their folded name
      name: r._id,
      nameKey: nameKey(r._id),
      registerAr: reg.ar,
      registerEn: reg.en,
      service: reg.service,
      detail: `${r.jobs} معاملة تخليص`,
      email: '',
      phone: '',
      active: true,
    }));
  }

  const filter = {};
  if (q) filter[reg.nameField] = nameRegex(q);
  const rows = await Model.find(filter).select(reg.select || '').limit(limit).lean();
  return rows.map((d) => ({
    source: reg.key,
    kind: reg.kind,
    refId: String(d._id),
    name: d[reg.nameField] || '—',
    nameKey: nameKey(d[reg.nameField]),
    registerAr: reg.ar,
    registerEn: reg.en,
    service: reg.service,
    detail: reg.detail ? reg.detail(d) : '',
    email: d.email || '',
    phone: d.phone || d.mobile || '',
    active: d.isActive !== false,
    profilePath: reg.profilePath ? reg.profilePath(String(d._id)) : null,
  }));
}

/**
 * GET /api/partners?kind=customer|vendor&q=&source=&limit=
 * The unified picker feed. Every row carries the label of the register it came
 * from and whether it already has a login.
 */
exports.listPartners = async (req, res) => {
  try {
    const { kind, q, source } = req.query;
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 200));
    const wanted = REGISTERS.filter((r) => (!kind || r.kind === kind) && (!source || r.key === source));

    const perRegister = await Promise.all(
      wanted.map((reg) => loadRegister(reg, q ? String(q).trim() : '', limit).catch(() => []))
    );
    const items = perRegister.flat();

    // Which of these already have a portal login?
    const accounts = await User.find({ accountType: { $in: ['customer', 'vendor'] } })
      .select('email firstName lastName isActive isLocked partner lastLogin').lean();
    const byRef = new Map(accounts.map((a) => [`${a.partner?.source}|${a.partner?.refId}`, a]));

    for (const it of items) {
      const acc = byRef.get(`${it.source}|${it.refId}`);
      it.account = acc
        ? {
          _id: String(acc._id), email: acc.email, isActive: acc.isActive, isLocked: acc.isLocked,
          name: `${acc.firstName || ''} ${acc.lastName || ''}`.trim(), lastLogin: acc.lastLogin,
        }
        : null;
    }
    items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    res.json({ items, total: items.length, registers: registerMeta() });
  } catch (error) {
    console.error('listPartners error:', error);
    res.status(500).json({ message: 'Failed to load partners' });
  }
};

/** Resolve one register row (used by the profile "create login" card). */
async function resolvePartner(source, refId) {
  const reg = REGISTER_BY_KEY[source];
  if (!reg) return null;
  if (reg.virtual) {
    // The ref IS the folded name — recover a readable display name from any file
    // filed under it. If none matches the name is simply unknown to us, which is
    // a 404 rather than a silently-empty account.
    const Model = modelFor(source);
    const rows = await Model.find({ customerName: { $nin: [null, ''] } })
      .select('customerName').limit(20000).lean();
    const hit = rows.find((r) => nameKey(r.customerName) === refId);
    return hit ? { reg, name: hit.customerName, doc: null } : null;
  }
  const Model = modelFor(source);
  const doc = await Model.findById(refId).lean();
  if (!doc) return null;
  return { reg, name: doc[reg.nameField], doc };
}

/** GET /api/partners/account?source=&refId= — the existing login for a row, if any. */
exports.getAccount = async (req, res) => {
  try {
    const { source, refId } = req.query;
    if (!source || !refId) return res.status(400).json({ message: 'source and refId are required' });
    const reg = REGISTER_BY_KEY[source];
    if (!reg) return res.status(400).json({ message: 'Unknown register' });
    const account = await User.findOne({ 'partner.source': source, 'partner.refId': String(refId) })
      .select('email firstName lastName isActive isLocked lastLogin accountType partner createdAt').lean();
    res.json({
      account: account || null,
      register: { key: reg.key, kind: reg.kind, ar: reg.ar, en: reg.en, service: reg.service },
      canManage: canAdmin(req),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load partner account' });
  }
};

/**
 * POST /api/partners/account
 * { source, refId, email, password, firstName?, lastName? }
 * Creates the portal login for a customer/supplier row.
 */
exports.createAccount = async (req, res) => {
  try {
    if (!canAdmin(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const { source, refId, email, password } = req.body;
    if (!source || !refId) return res.status(400).json({ message: 'source and refId are required' });
    if (!email || !password) return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    if (String(password).length < 8) return res.status(400).json({ message: 'كلمة المرور 8 أحرف على الأقل' });

    const resolved = await resolvePartner(source, String(refId));
    if (!resolved) return res.status(404).json({ message: 'لم يتم العثور على هذا العميل/المورد' });
    const { reg, name } = resolved;

    const clean = String(email).toLowerCase().trim();
    if (await User.findOne({ email: clean })) {
      return res.status(400).json({ message: 'هذا البريد مستخدم بالفعل' });
    }
    const existing = await User.findOne({ 'partner.source': source, 'partner.refId': String(refId) }).lean();
    if (existing) {
      return res.status(400).json({ message: `يوجد حساب بالفعل لهذا ${reg.kind === 'vendor' ? 'المورد' : 'العميل'}: ${existing.email}` });
    }

    // Split the company name into first/last so the existing UI (which shows
    // firstName + lastName everywhere) reads sensibly without special-casing.
    const parts = String(req.body.firstName || name || '—').trim().split(/\s+/);
    const firstName = req.body.firstName || parts[0] || 'Partner';
    const lastName = req.body.lastName || parts.slice(1).join(' ') || (reg.kind === 'vendor' ? 'مورد' : 'عميل');

    const user = await User.create({
      email: clean,
      password,
      firstName,
      lastName,
      role: 'client', // external user — every RBAC rule already knows this role
      accountType: reg.kind,
      partner: {
        source, refId: String(refId), name, nameKey: nameKey(name), kind: reg.kind,
      },
      // The finance register IS the `Customer` collection the legacy portal
      // endpoints read, so keep that pointer in sync when it applies.
      linkedCustomer: source === 'customer' ? refId : undefined,
      manager: undefined,
    });

    await logAudit({
      user: req.user._id,
      action: 'create_partner_account',
      entity: 'User',
      entityId: user._id,
      changes: { after: { email: clean, source, refId: String(refId), name, kind: reg.kind } },
      ipAddress: req.ip,
    });
    try { emitToAll('partner:account', { source, refId: String(refId) }); } catch (e) {}

    const out = user.toJSON();
    res.status(201).json({ account: out, message: 'تم إنشاء حساب الدخول' });
  } catch (error) {
    console.error('createAccount error:', error);
    res.status(500).json({ message: 'تعذّر إنشاء الحساب' });
  }
};

/**
 * PATCH /api/partners/account/:id
 * { password?, isActive?, email?, firstName?, lastName? } — reset / enable / rename.
 */
exports.updateAccount = async (req, res) => {
  try {
    if (!canAdmin(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const user = await User.findById(req.params.id);
    if (!user || !['customer', 'vendor'].includes(user.accountType)) {
      return res.status(404).json({ message: 'حساب الشريك غير موجود' });
    }
    const { password, isActive, email, firstName, lastName } = req.body;
    if (email && email.toLowerCase().trim() !== user.email) {
      const clean = String(email).toLowerCase().trim();
      if (await User.findOne({ email: clean, _id: { $ne: user._id } })) {
        return res.status(400).json({ message: 'هذا البريد مستخدم بالفعل' });
      }
      user.email = clean;
    }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ message: 'كلمة المرور 8 أحرف على الأقل' });
      user.password = password;
      // A password reset must end every live session on the old one.
      user.refreshTokens = [];
      user.refreshToken = undefined;
    }
    if (isActive !== undefined) user.isActive = !!isActive;
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    await user.save();
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: 'update_partner_account',
      entity: 'User',
      entityId: user._id,
      changes: { after: { email: user.email, isActive: user.isActive, passwordReset: !!password } },
      ipAddress: req.ip,
    });
    try { emitToAll('partner:account', { source: user.partner?.source, refId: user.partner?.refId }); } catch (e) {}
    res.json({ account: user.toJSON(), message: 'تم تحديث الحساب' });
  } catch (error) {
    console.error('updateAccount error:', error);
    res.status(500).json({ message: 'تعذّر تحديث الحساب' });
  }
};

/** DELETE /api/partners/account/:id — remove the login (the register row stays). */
exports.deleteAccount = async (req, res) => {
  try {
    if (!canAdmin(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const user = await User.findById(req.params.id);
    if (!user || !['customer', 'vendor'].includes(user.accountType)) {
      return res.status(404).json({ message: 'حساب الشريك غير موجود' });
    }
    const snapshot = { email: user.email, partner: user.partner };
    const Notification = require('../models/Notification');
    await Notification.deleteMany({ recipient: user._id });
    await User.findByIdAndDelete(user._id);
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: 'delete_partner_account',
      entity: 'User',
      entityId: user._id,
      changes: { before: snapshot },
      ipAddress: req.ip,
    });
    try { emitToAll('partner:account', { source: snapshot.partner?.source, refId: snapshot.partner?.refId }); } catch (e) {}
    res.json({ message: 'تم حذف الحساب' });
  } catch (error) {
    console.error('deleteAccount error:', error);
    res.status(500).json({ message: 'تعذّر حذف الحساب' });
  }
};

/** GET /api/partners/accounts — every partner login, for the users page. */
exports.listAccounts = async (req, res) => {
  try {
    const accounts = await User.find({ accountType: { $in: ['customer', 'vendor'] } })
      .select('email firstName lastName isActive isLocked lastLogin accountType partner createdAt')
      .sort({ createdAt: -1 }).lean();
    res.json({ accounts });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load partner accounts' });
  }
};

module.exports.resolvePartner = resolvePartner;
module.exports.ACCOUNT_ADMIN_ROLES = ACCOUNT_ADMIN_ROLES;
