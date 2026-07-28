// Roles with unrestricted, super_admin-equivalent access to everything. The IT
// department owns the whole system technically, so they are never gated.
const FULL_ACCESS_ROLES = ['super_admin', 'it_manager', 'it_specialist'];

module.exports = {
  FULL_ACCESS_ROLES,
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    EMPLOYEE: 'employee',
    OPERATIONS_MANAGER: 'operations_manager',
    CLIENT: 'client',
    WORKSHOP_MANAGER: 'workshop_manager',
    WORKSHOP_EMPLOYEE: 'workshop_employee',
    PURCHASING: 'purchasing',
    REMOTE_EMPLOYEE: 'remote_employee',
    REMOTE_MANAGER: 'remote_manager',
    HR_MANAGER: 'hr_manager',
    HR_SPECIALIST: 'hr_specialist',
    CRM_MANAGER: 'crm_manager',
    CRM_TEAM_LEAD: 'crm_team_lead',
    CRM_SPECIALIST: 'crm_specialist',
    CRM_AGENT: 'crm_agent',
    FINANCE_MANAGER: 'finance_manager',
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
    ADMINISTRATOR: 'administrator',
    CONTRACTS_MANAGER: 'contracts_manager',
  },

  // Org chart: each role's DEFAULT direct-manager role. Used to auto-suggest a
  // manager when creating a user (the actual manager user is resolved at runtime
  // — see utils/orgChart.js). Top roles map to null (they have no manager).
  // This is a suggestion, never a hard requirement.
  ROLE_HIERARCHY: {
    super_admin: null,            // CEO / COO — top of the tree
    admin: 'super_admin',
    moderator: 'admin',
    employee: 'admin',
    operations_manager: 'admin',
    operations: 'operations_manager',
    workshop_manager: 'admin',
    workshop_employee: 'workshop_manager',
    purchasing: 'workshop_manager',
    b2c_head: 'admin',
    b2c_project_manager: 'b2c_head',
    hr_manager: 'admin',
    hr_specialist: 'hr_manager',
    crm_manager: 'admin',
    crm_team_lead: 'crm_manager',
    crm_specialist: 'crm_team_lead',
    crm_agent: 'crm_team_lead',
    finance_manager: 'admin',
    accountant: 'finance_manager',
    sales_manager: 'admin',
    sales_rep: 'sales_manager',
    procurement_manager: 'admin',
    remote_manager: 'admin',
    remote_employee: 'remote_manager',
    customs_manager: 'admin',
    customs_officer: 'customs_manager',
    it_manager: 'admin',
    fleet_manager: 'admin',
    fleet_supervisor: 'fleet_manager',
    it_specialist: 'it_manager',
    marketing_manager: 'admin',
    marketing_specialist: 'marketing_manager',
    bd_manager: 'admin',
    bd_specialist: 'bd_manager',
    administrator: 'admin', // السكرتارية تتبع الإدارة مباشرة
    contracts_manager: 'admin',
    client: null,
  },

  // Roles that can access the Accounting section.
  MARKETING_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'moderator', 'bd_manager'],
  MARKETING_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager'],
  BD_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
  BD_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist'],
  // قسم الشؤون الإدارية (السكرتارية) — the office task board.
  ADMINISTRATION_STAFF_ROLES: ['super_admin', 'admin', 'administrator', 'bd_manager', 'it_manager', 'it_specialist'],
  IT_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist'],
  IT_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager'],
  FINANCE_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'finance_manager', 'accountant'],
  // Roles that can access the Sales section (+ the operations team — they need
  // visibility across CRM/Sales for the 3PL workflow).
  SALES_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'],
  // Roles that can access the Procurement section. Reuses the existing
  // `purchasing` role (officer level) and adds a procurement_manager.
  PROCUREMENT_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'procurement_manager', 'purchasing'],

  // Roles that can see/manage the HR back-office (employees, contracts, all
  // leaves/requests, custody, leave types). Everyone else only gets the HR
  // self-service pages (their own profile, requests and leaves).
  HR_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],

  // Roles that can access the CRM section (companies, contacts, deals, tasks,
  // activities, calendar). Tiered: crm_manager (full) > crm_team_lead (delete /
  // reassign) > crm_specialist (write, no delete) > crm_agent (entry level).
  // crm_manager + crm_team_lead are the "admin" tier (delete + privileged ops).
  CRM_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'],
  CRM_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead'],

  // Roles that can access the Customs Clearance section (التخليص الجمركى).
  CUSTOMS_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'customs_manager', 'customs_officer'],

  // Roles that can access the Operations Platform (قسم الأوبريشن): the live
  // mirror of the external UPL field-ops system (B2B — Fleet Management + 3PL).
  // READ access is broad (every internal staff role except the B2C team + the
  // client portal) so the live ops data can be embedded across all the section
  // dashboards. The admin tier alone can create/update/delete (writes proxied
  // through to UPL).
  OPS_PLATFORM_STAFF_ROLES: [
    'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee', 'operations_manager', 'operations',
    'workshop_manager', 'workshop_employee', 'purchasing',
    'hr_manager', 'hr_specialist',
    'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent',
    'finance_manager', 'accountant',
    'sales_manager', 'sales_rep',
    'procurement_manager',
    'customs_manager', 'customs_officer',
    'remote_manager',
  ],
  OPS_PLATFORM_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'],

  // Roles that can access the Location Solutions section (قسم لوكيشن سوليوشن): the
  // live Wialon GPS/telemetry mirror (sensors, tires, engine temp, maintenance
  // alerts). READ is broad across the fleet/ops/workshop side; the admin tier
  // (super_admin, admin, operations_manager, workshop_manager) can acknowledge
  // alerts, mark vehicles serviced and tune the alert thresholds.
  LS2_STAFF_ROLES: [
    'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee', 'operations_manager', 'operations',
    'workshop_manager', 'workshop_employee', 'purchasing',
  ],
  LS2_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'workshop_manager'],
  // Core roles that see the section in their sidebar (others can still reach the
  // data via direct link / embeds but it isn't pinned to their nav).
  LS2_SECTION_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'workshop_manager', 'moderator'],

  // Roles that can access the Vehicles & Authorizations section (المركبات
  // والتفاويض): super admin + HR + Accounting. Delete ops are further limited to
  // the admin tier (super_admin, admin, hr_manager, finance_manager).
  VEHICLE_STAFF_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'],
  VEHICLE_ADMIN_ROLES: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'finance_manager'],

  // Pages inside the Remote (work-from-home) section. A remote_employee is
  // granted a subset of these via User.remoteAccess; remote_manager and
  // super_admin see all of them.
  REMOTE_PAGES: ['attendance', 'dashboard', 'leave', 'chat', 'tasks', 'report', 'announcements'],

  REMOTE_LEAVE_TYPES: ['annual', 'sick', 'personal', 'unpaid', 'other'],

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
