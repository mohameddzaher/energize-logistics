/**
 * jpSections — الأقسامُ التي لها خطّةُ عملٍ (JP)، ومن يديرها ومن يعمل فيها.
 *
 * المفتاحُ هو سلسلةُ القسم في المسار (`fleet`، `ls2`)، و`roleSection` هو مفتاحُه
 * في config/roles.js — ومنه يُعرَف المديرُ والموظّفون، فلا تُكتب قائمةُ أدوارٍ
 * ثانيةٌ هنا تشيخ وحدَها. قسمٌ يُضاف في roles.js يكفيه سطرٌ واحدٌ هنا.
 *
 * `extraManagers`: من يدير القسمَ وليس دورُه دورَ مديره — المديرُ الماليُّ فوق
 * مدير الحسابات، فيرى خطّةَ قسمه ولوحتَها ويُسند فيها.
 */
const { SECTION_ROLES } = require('./roles');

const JP_SECTIONS = {
  operations: { roleSection: 'Operations', path: '/system/operations', ar: 'التشغيل', en: 'Operations' },
  collections: { roleSection: 'Collections', path: '/system/collections-dept', ar: 'التحصيل', en: 'Collections' },
  ops: { roleSection: 'Operations Platform', path: '/system/ops', ar: 'منصّة التشغيل', en: 'Operations Platform' },
  'shipment-orders': { roleSection: 'Shipment Orders', path: '/system/shipment-orders', ar: 'طلبات الشحنات', en: 'Shipment Orders' },
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
  // قسمٌ بلا أدوارٍ لا مديرَ له ولا فريق — خطّتُه تُفتَح فلا يدخلها أحد.
  if (!def) throw new Error(`jpSections: «${slug}» يشير إلى قسمٍ غير معرَّف في roles.js (${s.roleSection})`);
  s.slug = slug;
  s.managerRoles = [def.manager.key, ...(s.extraManagers || [])];
  s.staffRoles = def.staff.map((x) => x.key);
  s.memberRoles = [...s.managerRoles, ...s.staffRoles];
}

/** القسمُ الذي ينتمي إليه دورٌ ما — لفتح الإشعار على خطّة صاحبه. */
const sectionOfRole = (role) => Object.values(JP_SECTIONS).find((s) => s.memberRoles.includes(role)) || null;

module.exports = { JP_SECTIONS, sectionOfRole };
