// ── Managed permission sections ──────────────────────────────────────────────
// The single source of truth for the dynamic role→section permission system.
// The super_admin "Permissions" page lets an admin grant each role
// none | view | edit on each of these sections. Enforcement:
//   • frontend  — the sidebar shows a section only when the role's effective
//                 access is 'view' or 'edit' (see layout.tsx).
//   • backend   — sectionGate() is mounted on each section's apiPrefixes; it
//                 blocks writes for 'view' and everything for 'none', and stamps
//                 req.sectionAccess so authorize() can GRANT a newly-permitted
//                 role (see middleware/sectionGate.js + rbac.js).
//
// IMPORTANT — no-lockout guarantee: a role with NO saved RolePermission doc is
// treated as "no override" and falls through to the legacy authorize() lists,
// so behaviour is identical to before the system existed. `defaultRoles` below
// is only used to seed the page's initial display (the current access), never
// to deny. super_admin always has full edit on everything and cannot be edited.
//
// `key` matches the sidebar `section` grouping string so the frontend mapping is
// a direct lookup. Sections deliberately NOT managed here (Main, Tools, Admin,
// Self Service, Portal) keep their existing role-based gating untouched.

const SECTIONS = [
  {
    key: 'Customers & Finance',
    apiPrefixes: ['/api/invoices', '/api/payments', '/api/collections', '/api/disputes'],
    defaultRoles: ['admin', 'it_manager', 'employee', 'operations_manager', 'moderator'],
  },
  {
    key: 'Operations',
    apiPrefixes: ['/api/wallet'],
    defaultRoles: ['admin', 'it_manager', 'employee', 'operations_manager', 'operations_staff', 'moderator', 'procurement_manager', 'procurement_staff'],
  },
  {
    key: 'Operations Platform',
    apiPrefixes: ['/api/ops'],
    defaultRoles: ['admin', 'it_manager', 'operations_manager', 'operations_staff', 'moderator', 'employee'],
  },
  {
    // Trial: shipments created natively instead of on the external UPL system.
    // Independent from Operations Platform on purpose.
    key: 'Shipment Orders',
    apiPrefixes: ['/api/shipment-orders'],
    defaultRoles: ['admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator'],
  },
  {
    // Our own trucks — booking, drivers, follow-up calls. Sibling of the
    // Shipment Orders trial (that one books supplier trucks).
    key: 'Fleet Management',
    apiPrefixes: ['/api/fleet'],
    defaultRoles: ['admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'],
  },
  {
    key: 'Customs',
    apiPrefixes: ['/api/customs-clearance'],
    defaultRoles: ['admin', 'it_manager', 'operations_manager', 'customs_manager', 'customs_officer'],
  },
  {
    key: 'Vehicles',
    apiPrefixes: ['/api/vehicles'],
    defaultRoles: ['admin', 'it_manager', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'],
  },
  {
    key: 'Location Solutions',
    apiPrefixes: ['/api/ls2'],
    defaultRoles: ['admin', 'it_manager', 'operations_manager', 'operations_staff', 'workshop_manager', 'moderator'],
  },
  {
    key: 'Marketing',
    apiPrefixes: ['/api/marketing'],
    defaultRoles: ['admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager'],
  },
  {
    key: 'Business Development',
    apiPrefixes: ['/api/business-development'],
    defaultRoles: ['admin', 'it_manager', 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
  },
  {
    key: 'Software & IT',
    apiPrefixes: ['/api/it'],
    defaultRoles: ['admin', 'it_manager', 'it_specialist'],
  },
  {
    // اجتماعات مراجعة الأعمال — the standing forum between the department heads
    // and the board. Broad by default because ORDINARY employees also open it,
    // to see work delegated to them; the controller is what separates a manager's
    // view from an employee's, not this list.
    key: 'Business Review',
    apiPrefixes: ['/api/business-review'],
    // EVERY staff role by default. A hand-written list here locked 14 roles out
    // of their OWN delegated tasks — and would lock out every role added after
    // it was written. `defaultAllRoles` means "anyone who isn't an outside
    // partner", which stays true however the org grows. The controller is what
    // separates a manager's view from an employee's, not this.
    defaultAllRoles: true,
    defaultRoles: [],
  },
  {
    // الشؤون الإدارية (السكرتارية) — the shared office task board.
    key: 'Administration',
    apiPrefixes: ['/api/admin-tasks'],
    defaultRoles: ['admin', 'administration_staff', 'bd_manager', 'it_manager', 'it_specialist'],
  },
  {
    // إدارة العقود — 3PL vendor contracts + analysis, other departments' contracts.
    key: 'Contracts',
    apiPrefixes: ['/api/contracts'],
    defaultRoles: ['admin', 'contracts_manager', 'it_manager', 'it_specialist', 'operations_manager'],
  },
  {
    key: 'B2C',
    apiPrefixes: ['/api/b2c', '/api/b2c-wallet'],
    defaultRoles: ['admin', 'it_manager', 'b2c_manager', 'b2c_project_lead'],
  },
  {
    key: 'Workshop',
    apiPrefixes: ['/api/workshop'],
    // مديرُ المشتريات مع موظّفه: كان الموظّفُ وحدَه في القائمة، فيفتح الورشةَ
    // ومديرُه لا يفتحها. القوائمُ تُكتب قسمًا قسمًا فيُنسى المديرُ حيث ذُكر
    // الموظّف — ولا يُكتشف إلّا بمقارنةِ الاثنين.
    defaultRoles: ['workshop_manager', 'workshop_employee', 'procurement_staff', 'procurement_manager'],
  },
  {
    key: 'Remote',
    apiPrefixes: ['/api/remote'],
    defaultRoles: ['admin', 'it_manager', 'remote_manager', 'remote_employee'],
  },
  {
    key: 'HR',
    apiPrefixes: ['/api/hr'],
    // /api/hr also serves self-service routes used by EVERY logged-in user
    // (their own profile/leaves/requests + a manager's team actions). Those
    // must never be blocked by removing back-office HR access, so they are
    // exempt from the gate.
    exemptSelfService: true,
    defaultRoles: ['admin', 'it_manager', 'hr_manager', 'hr_specialist'],
  },
  {
    key: 'CRM',
    apiPrefixes: ['/api/crm', '/api/crm-vendors'],
    defaultRoles: ['admin', 'it_manager', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_staff'],
  },
  {
    key: 'Sales',
    apiPrefixes: ['/api/sales'],
    defaultRoles: ['admin', 'it_manager', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'],
  },
  {
    key: 'Accounting',
    apiPrefixes: ['/api/accounting'],
    defaultRoles: ['admin', 'it_manager', 'finance_manager', 'accountant'],
  },
  {
    key: 'Procurement',
    apiPrefixes: ['/api/procurement'],
    defaultRoles: ['admin', 'it_manager', 'procurement_manager', 'procurement_staff'],
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

// Arabic names for the section keys. The keys themselves are English because
// they are identifiers; anything PRINTED or shown to a user needs this. The
// frontend has its own copy for the sidebar — this one exists so server-rendered
// output (PDF reports, notifications) isn't the only place in an Arabic system
// that says "Software & IT".
const SECTION_LABELS_AR = {
  'Customers & Finance': 'العملاء والمالية',
  'Operations': 'العمليات',
  'Operations Platform': 'منصة الأوبريشن',
  'Shipment Orders': 'طلبات الشحنات',
  'Fleet Management': 'إدارة الأسطول',
  'Customs': 'التخليص الجمركي',
  'Vehicles': 'المركبات والتفاويض',
  'Location Solutions': 'لوكيشن سوليوشن',
  'Marketing': 'التسويق',
  'Business Development': 'تطوير الأعمال',
  'Software & IT': 'تقنية المعلومات',
  'Administration': 'الشؤون الإدارية',
  'Business Review': 'مراجعة الأعمال',
  'Contracts': 'إدارة العقود',
  'B2C': 'قطاع الأفراد',
  'Workshop': 'الورشة',
  'Remote': 'العمل عن بُعد',
  'HR': 'الموارد البشرية',
  'CRM': 'إدارة العلاقات',
  'Sales': 'المبيعات',
  'Accounting': 'المحاسبة',
  'Procurement': 'المشتريات',
  'Executive': 'الإدارة العليا',
};

/** Print-ready name for a section key, in either language. */
const sectionLabel = (key, lang = 'ar') =>
  (lang === 'en' ? key : (SECTION_LABELS_AR[key] || key));
const ACCESS_LEVELS = ['none', 'view', 'edit'];

// كل دور ينفع يتعيّن لمستخدم (super_admin ليه كل حاجة ضمنيًا فمستثنى من
// التعديل). مصدرها config/roles.js — كانت مكتوبة بالإيد فكانت بتفضل ناقصة دور
// أو اتنين بعد أي إضافة.
const ALL_ROLES = require('./roles').ALL_ROLES.filter((r) => r !== 'super_admin');

const getSection = (key) => SECTIONS.find((s) => s.key === key);

// Default (pre-configuration) access for a role on a section — mirrors the
// current sidebar/role behaviour. Used only for display + as the value the page
// starts from; not used to deny anything at the gate.
const { FULL_ACCESS_ROLES } = require('./constants');
const defaultAccess = (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const s = getSection(sectionKey);
  if (!s) return 'none';
  // مدير القسم وموظفوه بياخدوا قسمهم كامل، دايمًا. القاعدة دي فوق قوائم
  // defaultRoles المكتوبة بالإيد: القوائم دي اتكتبت واحدة واحدة وكان بيتنسى
  // منها ناس، وده اللي خلّى أقسام تفتح لناس والأزرار جواها مخفية عنهم.
  if (require('./roles').rolesOfSection(sectionKey).includes(role)) return 'edit';
  // A section marked `defaultAllRoles` is open to all STAFF by default — only
  // `client` (an outside partner, who has the portal instead) is excluded. This
  // is how a section stays reachable by roles that don't exist yet.
  if (s.defaultAllRoles) return role === 'client' ? 'none' : 'edit';
  return s.defaultRoles.includes(role) ? 'edit' : 'none';
};

// كل قسم لازم يكون له مدير وموظف في config/roles.js. الفحص هنا لأن ده المكان
// اللي القايمتين معروفين فيه — «مراجعة الأعمال» مستثناة عن قصد: هي منتدى بيقعد
// فيه مديرو كل الأقسام، مش قسم له فريق.
require('./roles').assertRolesCoverSections(SECTION_KEYS, ['Business Review']);

module.exports = {
  SECTIONS, SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES, getSection, defaultAccess,
  SECTION_LABELS_AR, sectionLabel,
};
