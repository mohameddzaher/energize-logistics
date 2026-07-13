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
    defaultRoles: ['admin', 'it_manager', 'employee', 'operations_manager', 'operations', 'moderator', 'procurement_manager', 'purchasing'],
  },
  {
    key: 'Operations Platform',
    apiPrefixes: ['/api/ops'],
    defaultRoles: ['admin', 'it_manager', 'operations_manager', 'operations', 'moderator', 'employee'],
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
    defaultRoles: ['admin', 'it_manager', 'operations_manager', 'operations', 'workshop_manager', 'moderator'],
  },
  {
    key: 'B2C',
    apiPrefixes: ['/api/b2c', '/api/b2c-wallet'],
    defaultRoles: ['admin', 'it_manager', 'b2c_head', 'b2c_project_manager'],
  },
  {
    key: 'Workshop',
    apiPrefixes: ['/api/workshop'],
    defaultRoles: ['workshop_manager', 'workshop_employee', 'purchasing'],
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
    defaultRoles: ['admin', 'it_manager', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'],
  },
  {
    key: 'Sales',
    apiPrefixes: ['/api/sales'],
    defaultRoles: ['admin', 'it_manager', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'],
  },
  {
    key: 'Accounting',
    apiPrefixes: ['/api/accounting'],
    defaultRoles: ['admin', 'it_manager', 'finance_manager', 'accountant'],
  },
  {
    key: 'Procurement',
    apiPrefixes: ['/api/procurement'],
    defaultRoles: ['admin', 'it_manager', 'procurement_manager', 'purchasing'],
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const ACCESS_LEVELS = ['none', 'view', 'edit'];

// Every assignable role (super_admin is implicit-all and excluded from editing).
const ALL_ROLES = [
  'admin', 'employee', 'operations_manager', 'operations', 'moderator', 'client',
  'workshop_manager', 'workshop_employee', 'purchasing', 'b2c_head', 'b2c_project_manager',
  'remote_employee', 'remote_manager', 'hr_manager', 'hr_specialist',
  'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent',
  'finance_manager', 'accountant', 'sales_manager', 'sales_rep',
  'procurement_manager', 'customs_manager', 'customs_officer',
  'it_manager', 'it_specialist',
];

const getSection = (key) => SECTIONS.find((s) => s.key === key);

// Default (pre-configuration) access for a role on a section — mirrors the
// current sidebar/role behaviour. Used only for display + as the value the page
// starts from; not used to deny anything at the gate.
const { FULL_ACCESS_ROLES } = require('./constants');
const defaultAccess = (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const s = getSection(sectionKey);
  if (!s) return 'none';
  return s.defaultRoles.includes(role) ? 'edit' : 'none';
};

module.exports = { SECTIONS, SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES, getSection, defaultAccess };
