module.exports = {
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
    client: null,
  },

  // Roles that can access the Accounting section.
  FINANCE_STAFF_ROLES: ['super_admin', 'admin', 'finance_manager', 'accountant'],
  // Roles that can access the Sales section.
  SALES_STAFF_ROLES: ['super_admin', 'admin', 'sales_manager', 'sales_rep'],
  // Roles that can access the Procurement section. Reuses the existing
  // `purchasing` role (officer level) and adds a procurement_manager.
  PROCUREMENT_STAFF_ROLES: ['super_admin', 'admin', 'procurement_manager', 'purchasing'],

  // Roles that can see/manage the HR back-office (employees, contracts, all
  // leaves/requests, custody, leave types). Everyone else only gets the HR
  // self-service pages (their own profile, requests and leaves).
  HR_STAFF_ROLES: ['super_admin', 'admin', 'hr_manager', 'hr_specialist'],

  // Roles that can access the CRM section (companies, contacts, deals, tasks,
  // activities, calendar). Tiered: crm_manager (full) > crm_team_lead (delete /
  // reassign) > crm_specialist (write, no delete) > crm_agent (entry level).
  // crm_manager + crm_team_lead are the "admin" tier (delete + privileged ops).
  CRM_STAFF_ROLES: ['super_admin', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent'],
  CRM_ADMIN_ROLES: ['super_admin', 'admin', 'crm_manager', 'crm_team_lead'],

  // Roles that can access the Customs Clearance section (التخليص الجمركى).
  CUSTOMS_STAFF_ROLES: ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'],

  // Roles that can access the Vehicles & Authorizations section (المركبات
  // والتفاويض): super admin + HR + Accounting. Delete ops are further limited to
  // the admin tier (super_admin, admin, hr_manager, finance_manager).
  VEHICLE_STAFF_ROLES: ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'],
  VEHICLE_ADMIN_ROLES: ['super_admin', 'admin', 'hr_manager', 'finance_manager'],

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
