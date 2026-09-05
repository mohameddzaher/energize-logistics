const RolePermission = require('../models/RolePermission');
const CustomRole = require('../models/CustomRole');
const User = require('../models/User');
const { SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES, SECTION_LABELS_AR } = require('../config/sections');
const { PAGES, isPage } = require('../config/pages');
const { LABELS_AR: ROLE_LABELS_AR, LABELS_EN: ROLE_LABELS_EN } = require('../config/roles');
const { effectivePermissions, effectivePages, invalidate } = require('../utils/permissions');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

/** كلُّ دورٍ قابلٍ للضبط: المكتوبُ في الشيفرة، وما صُنع من الشاشة. */
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

    // ── وما أُشِّر عليه صراحةً غيرُ ما وُرث ────────────────────────────────────
    // الشاشةُ تحتاج أن تفرّق: صفحةٌ مسموحةٌ لأنّ قسمَها مسموح، وصفحةٌ مسموحةٌ
    // لأنّ أحدًا أشّر عليها. وبلا هذا الفرق يقرأ من يضبط أنّ كلَّ شيءٍ مضبوطٌ
    // باليد، فيتردّد في تغيير قسمٍ لأنّه يظنّ أنّ الصفحات لن تتبعه.
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

    // الأقسامُ تُرسَل كاملةً أو لا تُرسَل: إرسالُ جزءٍ منها يعني حذفَ الباقي.
    if (req.body?.sections) {
      const sections = {};
      for (const [key, level] of Object.entries(req.body.sections)) {
        if (!SECTION_KEYS.includes(key)) continue;
        if (!ACCESS_LEVELS.includes(level)) continue;
        sections[key] = level;
      }
      $set.sections = sections;
    }

    // ── والصفحاتُ تُحفَظ صراحةً فقط ──────────────────────────────────────────
    // ما يوافق قسمَه لا يُكتب: لو كُتبت الصفحاتُ كلُّها لكلّ دورٍ لصار تغييرُ
    // قسمٍ بلا أثرٍ على صفحاته — كلُّ صفحةٍ محفوظةٌ باليد تسبق القسم. فالمحفوظُ
    // هو الاستثناءُ وحدَه، والباقي يتبع.
    if (req.body?.pages) {
      const pages = {};
      for (const [key, on] of Object.entries(req.body.pages)) {
        if (!isPage(key)) continue;
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

// ── أنواعُ المستخدمين المصنوعة ───────────────────────────────────────────────

const KEY_RX = /^[a-z][a-z0-9_]{2,39}$/;

/**
 * POST /api/admin/roles — نوعُ مستخدمٍ جديد.
 *
 * يُولَد لا يملك شيئًا: لا قائمةَ `authorize` قديمةً تعرفه ولا قسمَ افتراضيًّا
 * له (راجع `getOverride` في utils/permissions). فما يُمنَح له يُمنَح صراحةً،
 * وما نُسي يبقى مغلقًا — وهو الاتّجاه الصحيح للنسيان.
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
    // ── ولاحقةُ `_manager` محجوزة ──────────────────────────────────────────
    // `businessReview.isManagerRole` تقرأ اللاحقةَ حرفيًّا، فدورٌ ينتهي بها
    // يجلس في اجتماعات مجلس الإدارة بلا أن يقصد أحد. راجع config/roles.js.
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
    // يُولَد بلا صلاحيّةٍ واحدة، فيُنشأ له سجلٌّ فارغٌ صراحةً — ووجودُ السجلّ
    // هو ما يجعل «لا شيء» قرارًا مكتوبًا لا صمتًا.
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

/** PUT /api/admin/roles/:key — تسميتُه ووصفُه. والمفتاحُ لا يُغيَّر: مكتوبٌ على مستخدميه. */
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
 * DELETE /api/admin/roles/:key — ولا يُحذَف وله أصحاب.
 *
 * حذفُ دورٍ يحمله مستخدمون يترك حساباتٍ تشير إلى دورٍ لا وجودَ له: لا تُقرأ
 * صلاحيّتُها ولا تظهر في شاشةٍ تُصلَّح منها. فيُقال بمن هو مشغولٌ ويُنقَلوا أوّلًا.
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

/** GET /api/admin/roles — الأنواعُ المصنوعة وحدَها (يقرؤها منشئُ المستخدمين). */
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
