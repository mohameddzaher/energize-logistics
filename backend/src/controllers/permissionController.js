const RolePermission = require('../models/RolePermission');
const CustomRole = require('../models/CustomRole');
const User = require('../models/User');
const { SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES, SECTION_LABELS_AR } = require('../config/sections');
const { PAGES, isPage, getPage } = require('../config/pages');
const { LABELS_AR: ROLE_LABELS_AR, LABELS_EN: ROLE_LABELS_EN } = require('../config/roles');
const {
  effectivePermissions, effectivePages, invalidate, isCustomRole, getOverrides,
  resolveSections, pageFollowsSection,
} = require('../utils/permissions');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

/** Every configurable role: those defined in code and those created from the screen. */
const allRoles = async () => {
  const custom = await CustomRole.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  return {
    custom,
    keys: [...ALL_ROLES, ...custom.map((c) => c.key).filter((k) => !ALL_ROLES.includes(k))],
  };
};

// GET /api/admin/permissions — the full matrix for the super_admin page.
exports.getPermissions = async (req, res) => {
  try {
    const { custom, keys } = await allRoles();
    const customByKey = new Map(custom.map((c) => [c.key, c]));

    const permissions = {};
    const pages = {};
    for (const role of keys) {
      permissions[role] = await effectivePermissions(role);
      pages[role] = await effectivePages(role);
    }

    // Explicitly set differs from inherited.
    // The screen must distinguish a page allowed because its section is allowed from one allowed because someone ticked it. Without that, the person configuring thinks everything is manual and hesitates to change a section, fearing pages will not follow.
    const explicit = {};
    const docs = await RolePermission.find({ role: { $in: keys } }).lean();
    for (const d of docs) {
      const m = {};
      for (const [k, v] of Object.entries(d.pages || {})) m[k] = !!v;
      explicit[d.role] = { pages: m, homePage: d.homePage || '' };
    }

    res.json({
      sections: SECTION_KEYS,
      sectionLabels: SECTION_LABELS_AR,
      roles: keys,
      roleLabels: Object.fromEntries(keys.map((k) => [k, {
        ar: customByKey.get(k)?.nameAr || ROLE_LABELS_AR[k] || k,
        en: customByKey.get(k)?.nameEn || ROLE_LABELS_EN[k] || k,
        custom: customByKey.has(k),
        description: customByKey.get(k)?.description || '',
      }])),
      accessLevels: ACCESS_LEVELS,
      catalog: PAGES,
      permissions,
      pages,
      explicit,
    });
  } catch (error) {
    console.error('getPermissions error:', error);
    res.status(500).json({ message: 'Failed to load permissions' });
  }
};

// PUT /api/admin/permissions/:role — replace one role's section + page access.
exports.updateRolePermissions = async (req, res) => {
  try {
    const { role } = req.params;
    const { keys } = await allRoles();
    if (!keys.includes(role)) return res.status(400).json({ message: 'دورٌ غير معروف' });
    if (role === 'super_admin') return res.status(400).json({ message: 'صاحبُ النظام له كلُّ شيءٍ دائمًا' });

    const $set = { updatedBy: req.user._id };

    // Sections are sent whole or not at all: sending a subset means deleting the rest.
    if (req.body?.sections) {
      const sections = {};
      for (const [key, level] of Object.entries(req.body.sections)) {
        if (!SECTION_KEYS.includes(key)) continue;
        if (!ACCESS_LEVELS.includes(level)) continue;
        sections[key] = level;
      }
      $set.sections = sections;
    }

    // Pages are stored only when explicit.
    // A page matching its section is not written: if all pages were written for every role, changing a section would not affect its pages, since each stored page overrides the section. Stored pages are the exceptions; the rest follow.
    // The shortcut lives here, not in the screen. The screen computed matches itself and sent only the differences, and its result differed from the server's for unmanaged sections, losing ticks already made while save said done. With `pagesAll` the screen sends the full map and the server reduces it by the same rule it applies when granting (`pageFollowsSection`), so they cannot diverge.
    if (req.body?.pages) {
      const pages = {};
      // A trainee behaves like a created role: inherits nothing, see permissions.inheritsNothing.
      const custom = await require('../utils/permissions').inheritsNothing(role);
      const after = resolveSections(role, $set.sections || (await getOverrides(role)), custom);
      for (const [key, on] of Object.entries(req.body.pages)) {
        if (!isPage(key)) continue;
        if (req.body.pagesAll === true && !!on === pageFollowsSection(getPage(key), after, custom)) continue;
        pages[key] = !!on;
      }
      $set.pages = pages;
    }

    if (typeof req.body?.homePage === 'string') {
      const h = req.body.homePage.trim();
      if (h && !isPage(h)) return res.status(400).json({ message: 'صفحةُ الدخول ليست صفحةً معروفة' });
      $set.homePage = h;
    }

    await RolePermission.findOneAndUpdate({ role }, { $set }, { upsert: true, new: true });
    invalidate(role);

    await logAudit({
      user: req.user._id,
      action: 'update_role_permissions',
      entity: 'RolePermission',
      entityId: role,
      changes: { after: { sections: $set.sections, pages: $set.pages, homePage: $set.homePage } },
      ipAddress: req.ip,
    }).catch(() => {});

    // Live update: every connected client of this role refetches /me so its
    // sidebar + access reflect the change without re-login.
    try { emitToAll('permissions:updated', { role }); } catch (e) {}

    res.json({
      role,
      permissions: await effectivePermissions(role),
      pages: await effectivePages(role),
    });
  } catch (error) {
    console.error('updateRolePermissions error:', error);
    res.status(500).json({ message: 'Failed to update permissions' });
  }
};

// Created user types

const KEY_RX = /^[a-z][a-z0-9_]{2,39}$/;

/**
 * POST /api/admin/roles: a new user type.
 * It starts with nothing: no legacy `authorize` list knows it and no default section (see `getOverride` in utils/permissions). Anything granted is granted explicitly and anything forgotten stays closed, the safe direction for omissions.
 */
exports.createCustomRole = async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim().toLowerCase();
    const nameAr = String(req.body?.nameAr || '').trim();
    const nameEn = String(req.body?.nameEn || '').trim();
    if (!nameAr || !nameEn) return res.status(400).json({ message: 'الاسمُ بالعربيّة وبالإنجليزيّة مطلوبان' });
    if (!KEY_RX.test(key)) {
      return res.status(400).json({ message: 'المفتاحُ حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطةٌ سفليّة، يبدأ بحرفٍ وطولُه من ٣ إلى ٤٠' });
    }
    // The `_manager` suffix is reserved: `businessReview.isManagerRole` reads the suffix literally, so a role ending in it would sit in board meetings unintentionally. See config/roles.js.
    if (/_manager$/.test(key)) {
      return res.status(400).json({ message: 'لاحقةُ «_manager» محجوزةٌ لمديري الأقسام المعرَّفين في النظام — اختر مفتاحًا آخر' });
    }
    if (ALL_ROLES.includes(key) || key === 'super_admin') {
      return res.status(409).json({ message: `«${key}» دورٌ قائمٌ في النظام` });
    }
    if (await CustomRole.exists({ key })) return res.status(409).json({ message: `«${key}» موجودٌ بالفعل` });

    const role = await CustomRole.create({
      key, nameAr, nameEn,
      description: String(req.body?.description || '').trim(),
      createdBy: req.user._id,
    });
    // It starts with no permission, so an empty record is created explicitly; the record's existence makes nothing a written decision rather than silence.
    await RolePermission.findOneAndUpdate(
      { role: key },
      { $set: { sections: {}, pages: {}, updatedBy: req.user._id } },
      { upsert: true },
    );
    invalidate(key);

    await logAudit({
      user: req.user._id, action: 'create', entity: 'CustomRole', entityId: role._id,
      entityKey: key, changes: { after: { key, nameAr, nameEn } }, ipAddress: req.ip,
    }).catch(() => {});
    try { emitToAll('permissions:roles', { key }); } catch (e) {}

    res.status(201).json({ role });
  } catch (error) {
    console.error('createCustomRole error:', error);
    res.status(500).json({ message: 'تعذّر إنشاءُ النوع' });
  }
};

/** PUT /api/admin/roles/:key: name and description only. The key never changes because it is stored on its users. */
exports.updateCustomRole = async (req, res) => {
  try {
    const role = await CustomRole.findOne({ key: String(req.params.key || '').toLowerCase() });
    if (!role) return res.status(404).json({ message: 'النوعُ غير موجود' });
    if (req.body?.nameAr) role.nameAr = String(req.body.nameAr).trim();
    if (req.body?.nameEn) role.nameEn = String(req.body.nameEn).trim();
    if (req.body?.description !== undefined) role.description = String(req.body.description).trim();
    await role.save();
    invalidate(role.key);
    try { emitToAll('permissions:roles', { key: role.key }); } catch (e) {}
    res.json({ role });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

/**
 * DELETE /api/admin/roles/:key: refused while it has holders.
 * Deleting a role that users hold leaves accounts pointing at a missing role whose permissions cannot be read and that appear in no screen to fix them. So it reports how many hold it and they must be moved first.
 */
exports.deleteCustomRole = async (req, res) => {
  try {
    const key = String(req.params.key || '').toLowerCase();
    const role = await CustomRole.findOne({ key });
    if (!role) return res.status(404).json({ message: 'النوعُ غير موجود' });
    const holders = await User.countDocuments({ role: key });
    if (holders > 0) {
      const who = await User.find({ role: key }).select('firstName lastName email').limit(5).lean();
      return res.status(409).json({
        message: `${holders} مستخدمًا يحملون هذا النوع — انقلهم إلى نوعٍ آخر أوّلًا`,
        holders: who.map((u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email),
      });
    }
    await CustomRole.deleteOne({ _id: role._id });
    await RolePermission.deleteOne({ role: key });
    invalidate(key);
    await logAudit({
      user: req.user._id, action: 'delete', entity: 'CustomRole', entityId: role._id,
      entityKey: key, ipAddress: req.ip,
    }).catch(() => {});
    try { emitToAll('permissions:roles', { key }); } catch (e) {}
    res.json({ message: 'حُذف النوع' });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر الحذف' });
  }
};

/** GET /api/admin/roles: only the created types (read by the user creator). */
exports.listCustomRoles = async (req, res) => {
  try {
    const roles = await CustomRole.find({ isActive: true }).sort({ createdAt: 1 }).lean();
    const counts = await User.aggregate([
      { $match: { role: { $in: roles.map((r) => r.key) } } },
      { $group: { _id: '$role', n: { $sum: 1 } } },
    ]);
    const byRole = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    res.json({ roles: roles.map((r) => ({ ...r, users: byRole[r.key] || 0 })) });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر التحميل' });
  }
};
