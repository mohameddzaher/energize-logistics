/**
 * Company role structure: each section has a manager and a staff role, defined once. Enforced at load time, so a violation stops the server:
 * 1. Every section in config/sections.js has both roles.
 * 2. Manager roles end in _manager (businessReview.isManagerRole relies on it); staff roles must not.
 * 3. Every role has clear Arabic and English names.
 */

// Roles not tied to a section
const GLOBAL_ROLES = [
  { key: 'super_admin', ar: 'مدير النظام', en: 'System Administrator' },
  { key: 'admin', ar: 'الإدارة العليا', en: 'Executive Management' },
  { key: 'moderator', ar: 'مشرف عام', en: 'General Supervisor' },
  // The CFO sits above the department, not in it: sees all company finances and joins management. Key is cfo, not *_manager, since the suffix is for single-department managers. Counted as a manager in business review via EXTRA_MANAGER_ROLES; the finance section comes from sections.defaultRoles.
  { key: 'cfo', ar: 'المدير المالي', en: 'Chief Financial Officer' },
  // Data and decision-support team works across all sections, so it has no section of its own. Default is edit on every section (DATA_ROLES in sections.defaultAccess); a super admin narrows it per section on the permissions page. Not in FULL_ACCESS_ROLES, which bypass the matrix and cannot be narrowed. Its manager ends in _manager on purpose (sits in business review).
  { key: 'data_manager', ar: 'مدير إدارة البيانات ودعم القرار', en: 'Data & Decision Support Manager' },
  { key: 'data_analyst', ar: 'محلل بيانات', en: 'Data Analyst' },
  { key: 'data_entry', ar: 'مدخل بيانات', en: 'Data Entry Specialist' },
  { key: 'employee', ar: 'موظف', en: 'Employee' },
  // External partner (customer or vendor): gets the portal, not company sections.
  { key: 'client', ar: 'شريك خارجي', en: 'External Partner' },
  // Media Go account: a partner who sees one screen (fault reports we raised for them). Confined in config/scopedRoles.js. The key does not end in _manager despite the title (rule 2).
  { key: 'mediago_account', ar: 'مدير حساب Media Go', en: 'Media Go Account Manager' },
];

/** Section to its manager and staff roles. `section` must match a key in config/sections.js exactly. */
const SECTION_ROLES = [
  { section: 'Operations',
    manager: { key: 'operations_manager', ar: 'مدير العمليات', en: 'Operations Manager' },
    staff: [{ key: 'operations_staff', ar: 'موظف العمليات', en: 'Operations Team' }] },

  // Collections section: collections used to be spread across a follow-up page and workflow columns with no owner; it now has its own section and roles, covering customers we collect from and vendors we pay.
  { section: 'Collections',
    manager: { key: 'collections_manager', ar: 'مدير التحصيل', en: 'Collections Manager' },
    staff: [{ key: 'collections_staff', ar: 'موظف التحصيل', en: 'Collections Officer' }] },

  { section: 'Operations Platform',
    manager: { key: 'ops_platform_manager', ar: 'مدير منصة الأوبريشن', en: 'Operations Platform Manager' },
    staff: [{ key: 'ops_platform_staff', ar: 'موظف منصة الأوبريشن', en: 'Operations Platform Team' }] },

  { section: 'Shipment Orders',
    manager: { key: 'shipment_orders_manager', ar: 'مدير طلبات الشحنات', en: 'Shipment Orders Manager' },
    staff: [
      { key: 'shipment_orders_staff', ar: 'موظف طلبات الشحنات', en: 'Shipment Orders Team' },
      // The follow-up role: tracks shipments from mobile (changes status with details, calls, adds a note). Its screen is shipment cards first.
      { key: 'shipment_orders_followup', ar: 'المتابعة', en: 'Shipment Follow-up',
        distinct: 'يتابع الشحناتِ القائمة: يغيّر حالتَها بتفاصيلها (سببُ الإلغاء، رفعُ السند)، '
          + 'ويتّصل بالسائق ويكتب ملاحظةَ متابعة. وشاشتُه الشحناتُ بطاقاتٍ كبيرةً للجوّال أوّلًا.' },
    ] },

  { section: 'Fleet Management',
    manager: { key: 'fleet_manager', ar: 'مدير الأسطول', en: 'Fleet Manager' },
    staff: [{ key: 'fleet_supervisor', ar: 'مشرف الأسطول', en: 'Fleet Supervisor' }] },

  { section: 'Customs',
    manager: { key: 'customs_manager', ar: 'مدير التخليص الجمركي', en: 'Customs Manager' },
    staff: [{ key: 'customs_officer', ar: 'مخلّص جمركي', en: 'Customs Officer' }] },

  { section: 'Vehicles',
    manager: { key: 'vehicles_manager', ar: 'مدير المركبات والتفاويض', en: 'Vehicles & Authorizations Manager' },
    staff: [{ key: 'vehicles_staff', ar: 'موظف المركبات والتفاويض', en: 'Vehicles & Authorizations Officer' }] },

  { section: 'Location Solutions',
    manager: { key: 'location_manager', ar: 'مدير لوكيشن سوليوشن', en: 'Location Solutions Manager' },
    staff: [{ key: 'location_staff', ar: 'موظف لوكيشن سوليوشن', en: 'Location Solutions Team' }] },

  { section: 'Marketing',
    manager: { key: 'marketing_manager', ar: 'مدير التسويق', en: 'Marketing Manager' },
    staff: [{ key: 'marketing_specialist', ar: 'أخصائي تسويق', en: 'Marketing Specialist' }] },

  { section: 'Business Development',
    manager: { key: 'bd_manager', ar: 'مدير تطوير الأعمال', en: 'Business Development Manager' },
    staff: [{ key: 'bd_specialist', ar: 'أخصائي تطوير الأعمال', en: 'Business Development Specialist' }] },

  { section: 'Software & IT',
    manager: { key: 'it_manager', ar: 'مدير تقنية المعلومات', en: 'IT Manager' },
    staff: [{ key: 'it_specialist', ar: 'أخصائي تقنية المعلومات', en: 'IT Specialist' }] },

  { section: 'Administration',
    manager: { key: 'administration_manager', ar: 'مدير الشؤون الإدارية', en: 'Administration Manager' },
    staff: [{ key: 'administration_staff', ar: 'موظف الشؤون الإدارية', en: 'Administration Officer' }] },

  { section: 'Contracts',
    manager: { key: 'contracts_manager', ar: 'مدير العقود', en: 'Contracts Manager' },
    staff: [{ key: 'contracts_staff', ar: 'موظف العقود', en: 'Contracts Officer' }] },

  { section: 'B2C',
    manager: { key: 'b2c_manager', ar: 'مدير قطاع الأفراد', en: 'B2C Manager' },
    // Project manager is a real title, but a _manager key would wrongly seat it in management meetings, so the key is _lead.
    // Rep supervisor has two roles that do not overlap: operational (the rep's day: entry, orders, performance, custody, store) and inspection (start-of-duty live-camera check, b2cDutyController).
    // Neither distributes reps (middleware/b2cGuards).
    staff: [
      // Sector deputy: above project managers, below the sector manager. Has the manager's rights within the section (adds staff from the light transport register; custody and section vehicles open). Key does not end in _manager (rule 3); the section's management-meeting seat stays with its manager.
      { key: 'b2c_deputy', ar: 'نائب مدير قطاع الأفراد', en: 'B2C Deputy Manager',
        distinct: 'له صلاحيّاتُ مدير القطاع في القسم كلِّه، ويعلو مديري المشاريع.' },
      { key: 'b2c_project_lead', ar: 'مدير مشروع - أفراد', en: 'B2C Project Lead' },
      { key: 'b2c_rep_supervisor', ar: 'مشرف المناديب التشغيلي', en: 'B2C Ops Rep Supervisor',
        distinct: 'يقف على يوم المندوب: الإدخالُ اليوميّ وأوامرُ التشغيل والأداءُ والعهدة. '
          + 'ولا يوزّع المناديب ولا يعدّلهم — ذاك لمدير المشروع ومدير القطاع.' },
      { key: 'b2c_inspection_supervisor', ar: 'مشرف المناديب التفقدي', en: 'B2C Inspection Supervisor',
        distinct: 'للتفقّد وحدَه: «تفقّد بداية الدوام» بالكاميرا الحيّة وسجلُّه وتحليلُه. '
          + 'لا يُدخِل يومًا ولا يصدر أمرَ تشغيلٍ ولا يوزّع المناديب. '
          + 'والتفقّدُ يبقى إسنادًا يُكتب على كلّ مندوبٍ من سجلّ النقل الخفيف، '
          + 'ويصحّ لمدير المشروع ومدير القطاع أيضًا.' },
    ] },

  { section: 'Remote',
    manager: { key: 'remote_manager', ar: 'مدير العمل عن بُعد', en: 'Remote Work Manager' },
    staff: [{ key: 'remote_employee', ar: 'موظف عن بُعد', en: 'Remote Employee' }] },

  { section: 'HR',
    manager: { key: 'hr_manager', ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    staff: [{ key: 'hr_specialist', ar: 'أخصائي موارد بشرية', en: 'HR Specialist' }] },

  // This section had three staff roles that differed only by title, not permission. Merged into one; the old titles stay in RENAMED so old accounts still resolve and migrate.
  { section: 'CRM',
    manager: { key: 'crm_manager', ar: 'مدير إدارة العلاقات', en: 'CRM Manager' },
    staff: [{ key: 'crm_specialist', ar: 'أخصائي علاقات العملاء', en: 'CRM Specialist' }] },

  { section: 'Sales',
    manager: { key: 'sales_manager', ar: 'مدير المبيعات', en: 'Sales Manager' },
    staff: [{ key: 'sales_rep', ar: 'مندوب مبيعات', en: 'Sales Representative' }] },

  { section: 'Accounting',
    manager: { key: 'accounting_manager', ar: 'مدير الحسابات', en: 'Accounting Manager' },
    staff: [{ key: 'accountant', ar: 'محاسب', en: 'Accountant' }] },

  { section: 'Procurement',
    manager: { key: 'procurement_manager', ar: 'مدير المشتريات', en: 'Procurement Manager' },
    staff: [{ key: 'procurement_staff', ar: 'موظف المشتريات', en: 'Procurement Officer' }] },

  // Business review intentionally has no manager or staff role: it is a forum for all section managers with management, so access follows the role in the user's own section.
];

// Every section also has a trainee role. It differs in permission, not title: it inherits nothing and sees only what is granted on the permissions page, section by section and page by page. Matrix silence means none (utils/permissions.inheritsNothing). Not part of `staff`, since staff gets the section by default (sections.defaultAccess reads rolesOfSection). Key and name derive from the section manager.
for (const s of SECTION_ROLES) {
  s.trainee = {
    key: s.manager.key.replace(/_manager$/, '_trainee'),
    ar: s.manager.ar.replace(/^مدير\s+/, 'متدرّب '),
    en: s.manager.en.replace(/\s+Manager$/, ' Trainee'),
  };
}

// Ready-made keys
const MANAGER_ROLES = SECTION_ROLES.map((s) => s.manager.key);
const STAFF_ROLES = SECTION_ROLES.flatMap((s) => s.staff.map((x) => x.key));
const TRAINEE_ROLES = SECTION_ROLES.map((s) => s.trainee.key);
const ALL_ROLE_DEFS = [
  ...GLOBAL_ROLES,
  ...SECTION_ROLES.flatMap((s) => [s.manager, ...s.staff, s.trainee]),
];
const ALL_ROLES = ALL_ROLE_DEFS.map((r) => r.key);

const LABELS_AR = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const LABELS_EN = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** The section this role belongs to, or null for general roles. */
const sectionOfRole = (role) => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.trainee.key === role || x.staff.some((y) => y.key === role));
  return s ? s.section : null;
};

/** Roles (manager + staff) that own this section. Trainees are excluded: they are granted access, not owners. */
const rolesOfSection = (section) => {
  const s = SECTION_ROLES.find((x) => x.section === section);
  return s ? [s.manager.key, ...s.staff.map((y) => y.key)] : [];
};

const isManager = (role) => MANAGER_ROLES.includes(role);
const isStaff = (role) => STAFF_ROLES.includes(role);
const isTrainee = (role) => TRAINEE_ROLES.includes(role);

// Old role key names, kept so legacy stored data and settings still resolve. scripts/migrateRoleKeys.js converts users and permissions.
const RENAMED = {
  operations: 'operations_staff',
  purchasing: 'procurement_staff',
  administrator: 'administration_staff',
  b2c_head: 'b2c_manager',
  b2c_project_manager: 'b2c_project_lead',
  // The old financial manager was the accounting department manager; now cfo sits above, and the department manager is accounting_manager.
  finance_manager: 'cfo',
  // The three CRM titles became one role.
  crm_team_lead: 'crm_specialist',
  crm_agent: 'crm_specialist',
};
/** Returns the current key for any role, even if given by its old name. */
const canonicalRole = (role) => RENAMED[role] || role;

// Load-time checks: an error stops the server on purpose, since a wrong role is worse than a down server. This file must not require sections.js (circular: roles, sections, constants, roles); coverage is checked in sections.js (assertRolesCoverSections).
(function selfCheck() {
  const problems = [];

  for (const s of SECTION_ROLES) {
    if (!/_manager$/.test(s.manager.key)) problems.push(`دور المدير «${s.manager.key}» لازم ينتهي بـ _manager`);
    if (!s.staff.length) problems.push(`قسم «${s.section}» مفيهوش دور موظف`);
    // Two roles per section: manager and staff, no third. Each extra role shows up in the user-create list, the permissions page and every section guard, and titles do not change permissions; use the job title on the employee file instead. Checked at load time. The only exception is a role that differs in permission, with the reason stated in `distinct`.
    const plain = s.staff.filter((x) => !x.distinct);
    if (plain.length > 1) {
      problems.push(`قسم «${s.section}» فيه ${s.staff.length} أدوار موظّفين (${s.staff.map((x) => x.key).join('، ')}) — القاعدة: دور مدير ودور موظّف فقط`);
    }
    for (const st of s.staff) {
      if (/_manager$/.test(st.key)) problems.push(`دور الموظف «${st.key}» بينتهي بـ _manager — هيتحسب مدير بالغلط`);
    }
    if (!/_trainee$/.test(s.trainee.key) || /^مدير/.test(s.trainee.ar)) problems.push(`متدرّبُ قسم «${s.section}» لم يُشتقّ اسمُه (${s.trainee.key} / ${s.trainee.ar})`);
  }
  const dupes = ALL_ROLES.filter((r, i) => ALL_ROLES.indexOf(r) !== i);
  if (dupes.length) problems.push(`مفاتيح مكرّرة: ${[...new Set(dupes)].join(', ')}`);
  for (const r of ALL_ROLE_DEFS) {
    if (!r.ar || !r.en) problems.push(`الدور «${r.key}» ناقصه اسم عربي أو إنجليزي`);
  }
  if (problems.length) {
    throw new Error('config/roles.js — الهيكل الوظيفي غير سليم:\n  · ' + problems.join('\n  · '));
  }
})();

/** Checks every section has a manager and a staff role; called from sections.js after both load. `exempt` lists sections intentionally without roles (business review is a shared forum). */
const assertRolesCoverSections = (sectionKeys, exempt = []) => {
  const covered = new Set(SECTION_ROLES.map((s) => s.section));
  const unknown = SECTION_ROLES.map((s) => s.section).filter((k) => !sectionKeys.includes(k));
  const missing = sectionKeys.filter((k) => !covered.has(k) && !exempt.includes(k));
  const problems = [];
  if (unknown.length) problems.push(`أقسام غير معروفة في roles.js: ${unknown.join(', ')}`);
  if (missing.length) problems.push(`أقسام من غير مدير/موظف: ${missing.join(', ')}`);
  if (problems.length) throw new Error('config/roles.js — ' + problems.join(' · '));
};

/** Data team: edit by default on every section; a super admin narrows it. */
const DATA_ROLES = ['data_manager', 'data_analyst', 'data_entry'];

module.exports = {
  DATA_ROLES,
  GLOBAL_ROLES, SECTION_ROLES, assertRolesCoverSections,
  ALL_ROLES, ALL_ROLE_DEFS, MANAGER_ROLES, STAFF_ROLES, TRAINEE_ROLES, isTrainee,
  LABELS_AR, LABELS_EN,
  sectionOfRole, rolesOfSection, isManager, isStaff,
  RENAMED, canonicalRole,
};
