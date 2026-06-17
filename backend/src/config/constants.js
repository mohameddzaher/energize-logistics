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
  },

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
