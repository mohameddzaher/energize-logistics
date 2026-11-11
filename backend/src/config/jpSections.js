/**
 * jpSections: sections that have a work plan (JP), who manages it and who works in it.
 * The key is the section slug in the path; `roleSection` is its key in config/roles.js, from which manager and staff are known, so no second role list ages here.
 * `extraManagers`: people who manage the section without its manager role (e.g. the finance manager above the accounts manager).
 */
const { SECTION_ROLES } = require('./roles');

const JP_SECTIONS = {
  // Operations is the umbrella of workflow, vendors and follow-up (config/roles ORG_PARENT/ORG_ROLE): its plan counts them all.
  operations: { roleSection: 'Operations', path: '/system/operations', ar: 'التشغيل', en: 'Operations',
    extraStaff: ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'shipment_orders_followup'] },
  collections: { roleSection: 'Collections', path: '/system/collections-dept', ar: 'التحصيل', en: 'Collections' },
  ops: { roleSection: 'Operations Platform', path: '/system/ops', ar: 'منصّة التشغيل', en: 'Operations Platform' },
  'shipment-orders': { roleSection: 'Shipment Orders', path: '/system/shipment-orders', ar: 'طلبات الشحنات', en: 'Shipment Orders' },
  // Vendors is a team inside Operations: the operations manager and team leader run its plan, and the operations team works in it.
  vendors: { roleSection: 'Vendors Management', path: '/system/vendors-mgmt', ar: 'إدارة الموردين', en: 'Vendors Management',
    extraManagers: ['operations_manager', 'operations_team_leader'], extraStaff: ['operations_staff'] },
  fleet: { roleSection: 'Fleet Management', path: '/system/fleet', ar: 'إدارة الأسطول', en: 'Fleet Management' },
  customs: { roleSection: 'Customs', path: '/system/customs', ar: 'التخليص الجمركي', en: 'Customs' },
  vehicles: { roleSection: 'Vehicles', path: '/system/vehicles', ar: 'المركبات والتفاويض', en: 'Vehicles' },
  ls2: { roleSection: 'Location Solutions', path: '/system/ls2', ar: 'النقل الثقيل', en: 'Location Solutions' },
  marketing: { roleSection: 'Marketing', path: '/system/marketing', ar: 'التسويق', en: 'Marketing' },
  bd: { roleSection: 'Business Development', path: '/system/bd', ar: 'تطوير الأعمال', en: 'Business Development' },
  it: { roleSection: 'Software & IT', path: '/system/it', ar: 'تقنية المعلومات', en: 'Software & IT' },
  administration: { roleSection: 'Administration', path: '/system/administration', ar: 'الشؤون الإدارية', en: 'Administration' },
  contracts: { roleSection: 'Contracts', path: '/system/contracts', ar: 'إدارة العقود', en: 'Contracts' },
  b2c: { roleSection: 'B2C', path: '/system/b2c', ar: 'قطاع الأفراد', en: 'B2C' },
  remote: { roleSection: 'Remote', path: '/system/remote', ar: 'العمل عن بُعد', en: 'Remote' },
  hr: { roleSection: 'HR', path: '/system/hr', ar: 'الموارد البشرية', en: 'HR' },
  crm: { roleSection: 'CRM', path: '/system/crm', ar: 'إدارة العلاقات', en: 'CRM' },
  sales: { roleSection: 'Sales', path: '/system/sales', ar: 'المبيعات', en: 'Sales' },
  accounting: { roleSection: 'Accounting', path: '/system/accounting', ar: 'الإدارة المالية', en: 'Finance', extraManagers: ['cfo'] },
  procurement: { roleSection: 'Procurement', path: '/system/procurement', ar: 'المشتريات', en: 'Procurement' },
};

for (const [slug, s] of Object.entries(JP_SECTIONS)) {
  const def = SECTION_ROLES.find((x) => x.section === s.roleSection);
  // A section with no roles has no manager or team: its plan opens but nobody can enter.
  if (!def) throw new Error(`jpSections: «${slug}» يشير إلى قسمٍ غير معرَّف في roles.js (${s.roleSection})`);
  s.slug = slug;
  // A staff role holding the manager's rights (config/roles RIGHTS_OF, e.g. the operations team leader) manages the plan too.
  const { rightsRoleOf } = require('./roles');
  const heirs = def.staff.map((x) => x.key).filter((k) => rightsRoleOf(k) === def.manager.key);
  s.managerRoles = [...new Set([def.manager.key, ...heirs, ...(s.extraManagers || [])])];
  // A trainee counts as team once the plan page is opened to them: tasks can be assigned to them and they can write a request.
  s.staffRoles = [...new Set([...def.staff.map((x) => x.key), def.trainee.key, ...(s.extraStaff || [])])].filter((k) => !s.managerRoles.includes(k));
  s.memberRoles = [...s.managerRoles, ...s.staffRoles];
}

/** The section a role belongs to; used to open a notification on its owner's plan. */
const sectionOfRole = (role) => Object.values(JP_SECTIONS).find((s) => s.memberRoles.includes(role)) || null;

module.exports = { JP_SECTIONS, sectionOfRole };
