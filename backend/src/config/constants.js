// Roles with unrestricted, super_admin-equivalent access to everything. The IT department owns the whole system technically, so they are never gated.
// Admin equals super admin: admin sees the whole system with full permissions, and `TOP_ROLES` replaces every check that asked 'is this super admin?' by name. The super admin account itself stays protected from edits (userController) and from the matrix (permissionController).
const FULL_ACCESS_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const TOP_ROLES = ['super_admin', 'admin'];
const isTopRole = (role) => TOP_ROLES.includes(String(role || ''));


/**
 * Human names for the role keys. The keys are snake_case identifiers; anything
 * a person READS (a printed report, a notification, an export) must go through
 * here or an Arabic document ends up saying "operations_manager".
 *
 * Unknown roles are not an error — a role added to the enum tomorrow is
 * title-cased into something readable rather than leaking the raw key.
 */
// Role names come from config/roles.js, which defines the whole org structure; they were duplicated here, so a new role had to be written in two places.
const { LABELS_AR: ROLE_LABELS_AR, LABELS_EN: ROLE_LABELS_EN } = require('./roles');

const titleCase = (k) => String(k || '').split('_').filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Print-ready name for a role key, in either language. */
const roleLabel = (key, lang = 'ar') => {
  if (!key) return '';
  const map = lang === 'en' ? ROLE_LABELS_EN : ROLE_LABELS_AR;
  return map[key] || titleCase(key);
};


/**
 * Status vocabularies that get PRINTED. Same keys as the fleet board, the
 * shipment-orders trial and the ops mirror — kept here so a server-rendered
 * document never shows a bare "loading" or "active" in an Arabic page.
 */
const SHIPMENT_STATUS_AR = {
  requesting: 'قيد الطلب', loading: 'جاري التحميل', uploaded: 'تم التحميل',
  on_way: 'في الطريق', arrived: 'وصلت', bond_sent: 'أُرسل السند',
  bond_received: 'استُلم السند', late: 'متأخرة', invoiced: 'تمت الفوترة',
  cancelled: 'ملغاة',
};

const EMPLOYMENT_STATUS_AR = {
  active: 'على رأس العمل', on_leave: 'في إجازة',
  suspended: 'موقوف', terminated: 'منتهية خدمته',
};

/** Print-ready status, in either language; unknown keys degrade readably. */
const statusLabel = (map, key, lang = 'ar') => {
  if (!key) return '';
  return lang === 'en' ? titleCase(key) : (map[key] || titleCase(key));
};

module.exports = {
  SHIPMENT_STATUS_AR,
  EMPLOYMENT_STATUS_AR,
  statusLabel,
  ROLE_LABELS_AR,
  ROLE_LABELS_EN,
  roleLabel,
  FULL_ACCESS_ROLES,
  TOP_ROLES,
  isTopRole,
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    EMPLOYEE: 'employee',
    OPERATIONS_MANAGER: 'operations_manager',
    CLIENT: 'client',
    PURCHASING: 'procurement_staff',
    REMOTE_EMPLOYEE: 'remote_employee',
    REMOTE_MANAGER: 'remote_manager',
    HR_MANAGER: 'hr_manager',
    HR_SPECIALIST: 'hr_specialist',
    CRM_MANAGER: 'crm_manager',
    CRM_TEAM_LEAD: 'crm_team_lead',
    CRM_SPECIALIST: 'crm_specialist',
    CRM_AGENT: 'crm_agent',
    FINANCE_MANAGER: 'cfo',
    ACCOUNTING_MANAGER: 'accounting_manager',
    ACCOUNTANT: 'accountant',
    SALES_MANAGER: 'sales_manager',
    SALES_REP: 'sales_rep',
    PROCUREMENT_MANAGER: 'procurement_manager',
    CUSTOMS_MANAGER: 'customs_manager',
    CUSTOMS_OFFICER: 'customs_officer',
    IT_MANAGER: 'it_manager',
    IT_SPECIALIST: 'it_specialist',
    MARKETING_MANAGER: 'marketing_manager',
    MARKETING_SPECIALIST: 'marketing_specialist',
    BD_MANAGER: 'bd_manager',
    BD_SPECIALIST: 'bd_specialist',
    ADMINISTRATOR: 'administration_staff',
    CONTRACTS_MANAGER: 'contracts_manager',
  },

  // Org chart: each role's DEFAULT direct-manager role, used to auto-suggest a manager when creating a user (the actual manager user is resolved at runtime, see utils/orgChart.js). Top roles map to null.
  // Derived from config/roles.js: section staff report to their section manager, section managers to top management (admin). A hand-written list kept stale keys after renames, leaving new staff without a manager. A suggestion, never a requirement.
  ROLE_HIERARCHY: (() => {
    const R = require('./roles');
    const h = { super_admin: null, admin: 'super_admin', moderator: 'admin', employee: 'admin', client: null, mediago_account: null };
    for (const s of R.SECTION_ROLES) {
      h[s.manager.key] = 'admin';
      for (const st of s.staff) h[st.key] = s.manager.key;
    }
    // The secretariat reports directly to top management, not to a department manager.
    h.administration_staff = 'admin';
    // The finance manager is above the accounts manager, who reports to the finance manager, not to top management.
    // Without a finance manager the chain goes up to top management (orgChart).
    h.cfo = 'admin';
    h.accounting_manager = 'cfo';
    // The two rider supervisors report to the project manager who distributes riders to them, not to the sector manager.
    h.b2c_rep_supervisor = 'b2c_project_lead';
    h.b2c_inspection_supervisor = 'b2c_project_lead';
    // Project managers report to the sector deputy manager if one exists (orgChart goes up to the manager otherwise).
    h.b2c_project_lead = 'b2c_deputy';
    // Data team: the analyst and data entry report to the data management manager, who reports to top management.
    h.data_manager = 'admin';
    h.data_analyst = 'data_manager';
    h.data_entry = 'data_manager';
    return h;
  })(),

  // Roles that can access the Accounting section.
  MARKETING_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'moderator', 'bd_manager'],
  MARKETING_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager'],
  BD_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
  BD_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist'],
  // Administration section (secretariat): the office task board.
  ADMINISTRATION_STAFF_ROLES: ['super_admin', 'admin', 'administration_staff', 'bd_manager', 'it_manager', 'it_specialist'],
  IT_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist'],
  IT_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager'],
  FINANCE_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'],
  // Roles that can access the Sales section (+ the operations team — they need
  // visibility across CRM/Sales for the 3PL workflow).
  SALES_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'],
  // Roles that can access the Procurement section. Reuses the existing
  // `purchasing` role (officer level) and adds a procurement_manager.
  PROCUREMENT_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'procurement_manager', 'procurement_staff'],

  // Roles that can see/manage the HR back-office (employees, contracts, all
  // leaves/requests, custody, leave types). Everyone else only gets the HR
  // self-service pages (their own profile, requests and leaves).
  HR_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],

  // Roles that can access the CRM section (companies, contacts, deals, tasks,
  // activities, calendar). Tiered: crm_manager (full) > crm_team_lead (delete /
  // reassign) > crm_specialist (write, no delete) > crm_agent (entry level).
  // crm_manager + crm_team_lead are the "admin" tier (delete + privileged ops).
  CRM_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_staff'],
  CRM_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead'],

  // Roles that can access the Customs Clearance section.
  CUSTOMS_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'customs_manager', 'customs_officer'],

  // Roles that can access the Operations Platform: the live mirror of the external UPL field-ops system (B2B, Fleet Management + 3PL).
  // READ is broad (every internal staff role except the B2C team and the client portal) so live ops data can be embedded in all section dashboards. Only the admin tier can create/update/delete (writes proxied to UPL).
  OPS_PLATFORM_STAFF_ROLES: [
    'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee', 'operations_manager', 'operations_staff',
    'procurement_staff',
    'hr_manager', 'hr_specialist',
    'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent',
    'cfo', 'accounting_manager', 'accountant',
    'sales_manager', 'sales_rep',
    'procurement_manager',
    'customs_manager', 'customs_officer',
    'remote_manager',
  ],
  OPS_PLATFORM_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'],

  // Roles that can access the Location Solutions section: the live Wialon GPS/telemetry mirror (sensors, tires, engine temp, maintenance alerts). READ is broad across the fleet/ops/workshop side; the admin tier (super_admin, admin, operations_manager) can acknowledge alerts, mark vehicles serviced and tune thresholds.
  // The section's own roles are listed too: `location_manager` and `location_staff` (config/roles.js) were missing, so their access came only from the permission matrix grant, which name-based guards (sidebar section settings) cannot see. Each section lists its manager and staff in its lists (see role-structure).
  LS2_STAFF_ROLES: [
    'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee', 'operations_manager', 'operations_staff',
    'procurement_staff', 'location_manager', 'location_staff',
    // The vehicles and authorizations manager works in the section.
    'vehicles_manager',
  ],
  LS2_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'location_manager', 'vehicles_manager'],
  // Core roles that see the section in their sidebar (others can still reach the
  // data via direct link / embeds but it isn't pinned to their nav).
  LS2_SECTION_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'location_manager', 'location_staff'],

  // Roles that can access the Vehicles & Authorizations section: super admin + HR + Accounting. Delete ops are further limited to the admin tier (super_admin, admin, hr_manager, cfo, accounting_manager).
  VEHICLE_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'],
  VEHICLE_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'cfo', 'accounting_manager'],

  // Pages inside the Remote (work-from-home) section. A remote_employee is
  // granted a subset of these via User.remoteAccess; remote_manager and
  // super_admin see all of them.
  REMOTE_PAGES: ['attendance', 'dashboard', 'leave', 'chat', 'tasks', 'report', 'announcements'],

  REMOTE_LEAVE_TYPES: ['annual', 'sick', 'emergency', 'personal', 'unpaid', 'other'],
  // Remote leave kinds you cannot plan — exempt from the advance-notice rule.
  REMOTE_LEAVE_NO_NOTICE: ['sick', 'emergency'],
  // Company rule: a planned leave must be requested this many days ahead.
  LEAVE_ADVANCE_NOTICE_DAYS: 30,

  CREDIT_TERMS: [15, 30, 45, 60],

  INVOICE_STATUSES: ['pending', 'partial', 'paid', 'overdue', 'frozen', 'disputed', 'refunded'],

  COLLECTION_TYPES: ['call', 'email', 'visit', 'promise', 'follow_up', 'note', 'whatsapp'],

  COLLECTION_CONTACT_TYPES: ['call', 'visit', 'email', 'whatsapp'],

  COLLECTION_STATUSES: ['done', 'postponed', 'cancelled'],

  GRADES: ['A', 'B', 'C', 'D'],

  CLIENT_STATUSES: [
    'good_client',
    'late_payment',
    'stopped_by_us',
    'stopped_by_client',
    'under_review',
    'legal_action',
    'write_off',
    'payment_plan',
    'new_client',
    'vip_client',
  ],

  DISPUTE_STATUSES: ['open', 'under_review', 'resolved'],

  RISK_LEVELS: ['low', 'medium', 'high'],

  AGING_BUCKETS: [
    { label: '0-15 days', min: 0, max: 15 },
    { label: '15-30 days', min: 15, max: 30 },
    { label: '30-45 days', min: 30, max: 45 },
    { label: '45-60 days', min: 45, max: 60 },
    { label: '60-90 days', min: 60, max: 90 },
    { label: '90+ days', min: 90, max: Infinity },
  ],

  NOTIFICATION_TYPES: [
    'invoice_due_soon',
    'invoice_overdue',
    'payment_received',
    'risk_updated',
    'dispute_opened',
    'dispute_resolved',
    'credit_term_changed',
    'follow_up_reminder',
    'system_alert',
    'client_stopped',
    'invoice_refunded',
  ],

  // For cross-origin (Netlify ↔ Render), cookies MUST be sameSite=none+secure.
  // On localhost dev we use sameSite=lax with secure=false so they work over HTTP.
  COOKIE_OPTIONS: (() => {
    const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.FRONTEND_URL?.startsWith('https');
    return {
      httpOnly: true,
      secure: !isLocalDev,
      sameSite: isLocalDev ? 'lax' : 'none',
      path: '/',
    };
  })(),
};
