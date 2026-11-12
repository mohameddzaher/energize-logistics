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
    key: 'Operations',
    // Operations workflows section. The workflows API had no owning section, so the permission matrix could neither grant nor deny it; a role line in the route alone guarded it. Adding it was verified not to remove access from anyone: roles with operations denied are not in the route's role list already.
    apiPrefixes: ['/api/wallet', '/api/workflows', '/api/customer-requests'],
    // Accounting and collections are included: custody is a financial entry that is reviewed and closed, and the section guard runs before the route's role list, so leaving them out returns 403 even when the endpoint is open to them.
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'procurement_manager', 'procurement_team_leader', 'procurement_staff', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant', 'collections_manager', 'collections_team_leader', 'collections_staff',
      // Vendors manager and team leader: operations rights on the workflow (owner's rule).
      'vendors_manager', 'vendors_team_leader'],
  },
  {
    // Collections section: customers we collect from and vendors we pay. The prefix is /api/collections-dept, not /api/collections (taken by collection follow-ups under customers and finance). express matches on segment boundaries so they do not clash, but the explicit name avoids confusion.
    key: 'Collections',
    apiPrefixes: ['/api/collections-dept'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader'],
  },
  {
    key: 'Operations Platform',
    apiPrefixes: ['/api/ops'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'employee'],
  },
  {
    // Trial: shipments created natively instead of on the external UPL system.
    // Independent from Operations Platform on purpose.
    key: 'Shipment Orders',
    apiPrefixes: ['/api/shipment-orders'],
    // Sales asks for shipments and the vendors team places them, both from this section (owner, 2026-11-09).
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator',
      'sales_manager', 'sales_team_leader', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'],
  },
  {
    // Vendors management: carrier register, their trucks and freelance drivers, sales requests to place, and the section's analysis.
    key: 'Vendors Management',
    apiPrefixes: ['/api/vendors-mgmt'],
    // Vendors is a team inside Operations: the operations team works it by default; a super admin closes it per user (User.accessSections).
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff'],
  },
  {
    // Our own trucks — booking, drivers, follow-up calls. Sibling of the
    // Shipment Orders trial (that one books supplier trucks).
    key: 'Fleet Management',
    apiPrefixes: ['/api/fleet'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_team_leader', 'fleet_supervisor'],
  },
  {
    key: 'Customs',
    apiPrefixes: ['/api/customs-clearance'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'],
  },
  {
    key: 'Vehicles',
    apiPrefixes: ['/api/vehicles'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'],
  },
  {
    key: 'Location Solutions',
    apiPrefixes: ['/api/ls2'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'vehicles_manager', 'vehicles_team_leader'],
  },
  {
    key: 'Marketing',
    apiPrefixes: ['/api/marketing'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'marketing_manager', 'marketing_team_leader', 'marketing_specialist', 'bd_manager', 'bd_team_leader'],
  },
  {
    key: 'Business Development',
    apiPrefixes: ['/api/business-development'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'bd_manager', 'bd_team_leader', 'bd_specialist', 'sales_manager', 'sales_team_leader', 'crm_manager', 'crm_team_leader', 'operations_manager', 'operations_team_leader'],
  },
  {
    key: 'Software & IT',
    apiPrefixes: ['/api/it'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist'],
  },
  {
    // Business review meetings: the standing forum between department heads and the board. Broad by default because ordinary employees also open it to see work delegated to them; the controller, not this list, separates manager and employee views.
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
    // Administration (secretariat): the shared office task board.
    key: 'Administration',
    apiPrefixes: ['/api/admin-tasks'],
    defaultRoles: ['admin', 'administration_staff', 'bd_manager', 'bd_team_leader', 'it_manager', 'it_team_leader', 'it_specialist'],
  },
  {
    // Contracts: 3PL vendor contracts and analysis, other departments' contracts.
    key: 'Contracts',
    apiPrefixes: ['/api/contracts'],
    // Sales sign customer contracts and the vendors team signs carrier contracts here; vendors is a team inside Operations, so the operations team has it too. Narrowed per role from the permissions page.
    defaultRoles: ['admin', 'contracts_manager', 'contracts_team_leader', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff',
      'sales_manager', 'sales_team_leader', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'],
  },
  {
    key: 'B2C',
    apiPrefixes: ['/api/b2c', '/api/b2c-wallet'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'],
  },
  {
    key: 'Remote',
    apiPrefixes: ['/api/remote'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'remote_manager', 'remote_team_leader', 'remote_employee'],
  },
  {
    key: 'HR',
    apiPrefixes: ['/api/hr'],
    // /api/hr also serves self-service routes used by EVERY logged-in user
    // (their own profile/leaves/requests + a manager's team actions). Those
    // must never be blocked by removing back-office HR access, so they are
    // exempt from the gate.
    exemptSelfService: true,
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'hr_manager', 'hr_team_leader', 'hr_specialist'],
  },
  {
    key: 'CRM',
    apiPrefixes: ['/api/crm', '/api/crm-vendors'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'],
  },
  {
    key: 'Sales',
    apiPrefixes: ['/api/sales'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'],
  },
  {
    // Finance management. The internal key stays Accounting so stored permissions for accountant roles do not need migrating; only the displayed name changed.
    key: 'Accounting',
    apiPrefixes: ['/api/accounting', '/api/finance'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'],
  },
  {
    // Data & Decision Support: per-section analysis pages. Its roles are global (config/roles DATA_ROLES) and get it by default through defaultAccess.
    key: 'Data & Decision Support',
    apiPrefixes: ['/api/data-support'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo'],
  },
  {
    key: 'Procurement',
    apiPrefixes: ['/api/procurement'],
    defaultRoles: ['admin', 'it_manager', 'it_team_leader', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'],
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

// Arabic names for the section keys. The keys themselves are English because
// they are identifiers; anything PRINTED or shown to a user needs this. The
// frontend has its own copy for the sidebar — this one exists so server-rendered
// output (PDF reports, notifications) isn't the only place in an Arabic system
// that says "Software & IT".
const SECTION_LABELS_AR = {
  'Operations': 'العمليات',
  'Collections': 'التحصيل',
  'Operations Platform': 'منصة الأوبريشن',
  'Shipment Orders': 'طلبات الشحنات',
  'Vendors Management': 'إدارة الموردين',
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
  'Remote': 'العمل عن بُعد',
  'HR': 'الموارد البشرية',
  'CRM': 'إدارة العلاقات',
  'Sales': 'المبيعات',
  'Accounting': 'الإدارة المالية',
  'Procurement': 'المشتريات',
  'Data & Decision Support': 'إدارة البيانات ودعم القرار',
  'Executive': 'الإدارة العليا',
};

/** Print-ready name for a section key, in either language. */
const sectionLabel = (key, lang = 'ar') =>
  (lang === 'en' ? key : (SECTION_LABELS_AR[key] || key));
const ACCESS_LEVELS = ['none', 'view', 'edit'];

// Every role that can be assigned to a user (super_admin implicitly has everything, so it is excluded from editing). Derived from config/roles.js; a hand-written list kept missing roles. Scoped roles (Media Go) are outside the matrix; see config/scopedRoles.js.
const ALL_ROLES = require('./roles').ALL_ROLES
  .filter((r) => r !== 'super_admin' && !require('./scopedRoles').isScopedRole(r));

const getSection = (key) => SECTIONS.find((s) => s.key === key);

// Default (pre-configuration) access for a role on a section — mirrors the
// current sidebar/role behaviour. Used only for display + as the value the page
// starts from; not used to deny anything at the gate.
const { FULL_ACCESS_ROLES } = require('./constants');
const defaultAccess = (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  // Data team: all sections by default; the saved matrix narrows it (see config/roles).
  if (require('./roles').DATA_ROLES.includes(role)) return 'edit';
  // A scoped role has no section; its single screen is in config/scopedRoles.js.
  if (require('./scopedRoles').isScopedRole(role)) return 'none';
  const s = getSection(sectionKey);
  if (!s) return 'none';
  // A section's manager and staff always get their whole section. This rule overrides the hand-written defaultRoles lists, which kept forgetting people and left sections open with their buttons hidden.
  if (require('./roles').rolesOfSection(sectionKey).includes(role)) return 'edit';
  // A role holding another's rights (operations team leader → operations manager) gets that role's sections too.
  const heir = require('./roles').rightsRoleOf(role);
  if (heir !== role) return defaultAccess(heir, sectionKey);
  // A section marked `defaultAllRoles` is open to all STAFF by default — only
  // `client` (an outside partner, who has the portal instead) is excluded. This
  // is how a section stays reachable by roles that don't exist yet.
  if (s.defaultAllRoles) return require('./scopedRoles').isExternalRole(role) ? 'none' : 'edit';
  return s.defaultRoles.includes(role) ? 'edit' : 'none';
};

// Every section needs a manager and a staff role in config/roles.js. Checked here because this is where both lists are known. Business review is exempt: a forum for all managers, not a team section. Data & Decision Support is exempt: its roles are global (DATA_ROLES), not section roles.
require('./roles').assertRolesCoverSections(SECTION_KEYS, ['Business Review', 'Data & Decision Support']);

module.exports = {
  SECTIONS, SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES, getSection, defaultAccess,
  SECTION_LABELS_AR, sectionLabel,
};
