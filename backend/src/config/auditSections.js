/**
 * auditSections — إلى أيّ قسمٍ ينتمي كلُّ كيانٍ في سجلّ المراجعة.
 *
 * ── المشكلة التي يحلّها ─────────────────────────────────────────────────────
 * السجلُّ يقيّد الفعلَ باسم **نموذجِ قاعدة البيانات** الذي وقع عليه:
 * `WalletTransaction` و`DailyWallet` و`OperationsWorkflow`. وهذه أسماءٌ
 * برمجيّة لا يعرفها من يفتح الشاشة، وقائمةُ الفلتر كانت خمسةً وثلاثين منها
 * مسرودةً بلا ترتيب: بعضُها مترجَمٌ وبعضُها إنجليزيٌّ خام، وأربعةٌ منها
 * (`B2C` و`B2CRep` و`B2CProject` و`B2CDutyCheck`) تبدو للقارئ شيئًا واحدًا
 * مكرَّرًا أربعَ مرّات — فيختار واحدًا ويظنّ أنّه اختار الأربعة.
 *
 * والسؤالُ الذي يُسأل فعلًا ليس «أيُّ نموذج؟» بل **«أيُّ قسم؟»**: «ماذا جرى في
 * العهدة هذا الأسبوع؟»، «مَن لمس شيئًا في الموارد البشريّة؟». فالقسمُ هو
 * الفلترُ الأوّل، والكيانُ تفصيلٌ داخله لمن أراده.
 *
 * ── وأسماءُ الأقسام ليست جديدة ──────────────────────────────────────────────
 * هي مفاتيحُ `SECTIONS` نفسُها في `sectionWorkController` — الأقسامُ التي
 * يعرفها النظامُ في قائمته وصلاحيّاته. قائمةٌ ثانيةٌ بأسماءٍ أخرى كانت ستفترق
 * عنها عند أوّل قسمٍ يُضاف.
 *
 * وكلُّ كيانٍ لا يُذكر هنا يقع في `other` — لا يختفي من القائمة. الاختفاءُ
 * الصامت في سجلِّ مراجعةٍ أسوأُ من تصنيفٍ خاطئ: من يفلتر على الأقسام كلِّها
 * ولا يرى فعلًا يظنّ أنّه لم يقع.
 */

const { SECTION_LABELS_AR, SECTION_KEYS: SYSTEM_SECTION_KEYS } = require('./sections');

/**
 * القسم ← اسمُه المقروء. `other` آخرًا دائمًا: هو ما لم يُصنَّف بعد.
 *
 * ── وكلُّ قسمٍ في النظام له سطرٌ هنا ─────────────────────────────────────────
 * كانت القائمةُ خمسةَ عشرَ قسمًا والنظامُ واحدٌ وعشرون: تطويرُ الأعمال ومراجعةُ
 * الأعمال والمبيعات والمشتريات والتسويق والشؤون الإداريّة والعمل عن بُعد ومنصّة
 * الأوبريشن غائبةٌ كلُّها. وأفعالُ بعضها تُقيَّد فعلًا (`tender`، `BrMeeting`)
 * فكانت ستقع في «أخرى» يومَ تُكتب.
 *
 * `sys` مفتاحُ القسم في `config/sections` — منه يؤخذ الاسمُ العربيّ، فيقرأ
 * المستخدمُ هنا الاسمَ الذي يقرؤه في القائمة الجانبيّة.
 *
 * وثلاثةٌ لا مقابلَ لها هناك: العهدةُ النقديّة (شاشةٌ داخل العمليّات يُسأل عنها
 * وحدَها)، والمستخدمون والنظام، و«أخرى».
 */
const SECTIONS = [
  { key: 'operations', sys: 'Operations', en: 'Operations' },
  { key: 'wallet', ar: 'العهدة النقدية', en: 'Cash Wallet' },
  { key: 'collections', sys: 'Collections', en: 'Collections' },
  { key: 'ops', sys: 'Operations Platform', en: 'Operations Platform' },
  { key: 'shipment-orders', sys: 'Shipment Orders', en: 'Shipment Orders' },
  { key: 'fleet', sys: 'Fleet Management', en: 'Fleet Management' },
  { key: 'customs', sys: 'Customs', en: 'Customs Clearance' },
  { key: 'vehicles', sys: 'Vehicles', en: 'Vehicles' },
  { key: 'ls2', sys: 'Location Solutions', en: 'Location Solutions' },
  { key: 'marketing', sys: 'Marketing', en: 'Marketing' },
  { key: 'bd', sys: 'Business Development', en: 'Business Development' },
  { key: 'it', sys: 'Software & IT', en: 'Software & IT' },
  { key: 'business-review', sys: 'Business Review', en: 'Business Review' },
  { key: 'administration', sys: 'Administration', en: 'Administration' },
  { key: 'contracts', sys: 'Contracts', en: 'Contracts' },
  { key: 'b2c', sys: 'B2C', en: 'B2C' },
  { key: 'remote', sys: 'Remote', en: 'Remote' },
  { key: 'hr', sys: 'HR', en: 'HR' },
  { key: 'crm', sys: 'CRM', en: 'CRM' },
  { key: 'sales', sys: 'Sales', en: 'Sales' },
  { key: 'accounting', sys: 'Accounting', en: 'Accounting' },
  { key: 'procurement', sys: 'Procurement', en: 'Procurement' },
  { key: 'system', ar: 'المستخدمون والنظام', en: 'Users & System' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
].map((s) => ({ ...s, ar: s.ar || SECTION_LABELS_AR[s.sys] || s.en }));

// قسمٌ يُضاف إلى النظام ولا يُضاف هنا كان سيغيب عن فلتر السجلّ بصمت. فيُلحَق
// بالقائمة باسمه قبل «النظام» و«أخرى» — يظهر ناقصَ الترتيب لا غائبًا.
{
  const covered = new Set(SECTIONS.map((s) => s.sys).filter(Boolean));
  const missing = SYSTEM_SECTION_KEYS.filter((k) => !covered.has(k));
  const at = SECTIONS.findIndex((s) => s.key === 'system');
  SECTIONS.splice(at, 0, ...missing.map((k) => ({
    key: k.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sys: k, ar: SECTION_LABELS_AR[k] || k, en: k,
  })));
}

/**
 * الكيان ← قسمُه.
 *
 * يشمل كلَّ اسمٍ يمرَّر إلى `logAudit` في الخادم، لا ما وقع في القاعدة وحدَه:
 * كيانٌ لم يُقيَّد عليه فعلٌ بعدُ سيُقيَّد غدًا، ويجب أن يجد قسمَه جاهزًا.
 */
const ENTITY_SECTION = {
  // العهدة النقدية
  WalletTransaction: 'wallet', DailyWallet: 'wallet',
  // الموارد البشرية
  Employee: 'hr', CompanyLicense: 'hr', LeaveRequest: 'hr',
  HrFormTemplate: 'hr', StaffStatusRequest: 'hr',
  // العمليات — والسعرُ الخاصّ عمودٌ في كشف التشغيل نفسِه، والسائقون سجلُّها
  OperationsWorkflow: 'operations', PrivateSellingPrice: 'operations', Driver: 'operations',
  // التحصيل
  CollectionsParty: 'collections', CollectionsFollowUp: 'collections',
  // المركبات — السجلّ ووثائقه وبطاقات السائقين ووثائق تأمين الشركة
  VehicleMaster: 'vehicles', VehicleInsurancePolicy: 'vehicles',
  VehicleRegistryConfig: 'vehicles', DriverCard: 'vehicles', CorporatePolicy: 'vehicles',
  VehicleAuthorization: 'vehicles', VehicleAccident: 'vehicles', VehicleClaim: 'vehicles',
  // إدارة الأسطول
  FleetShipment: 'fleet', FleetVehicle: 'fleet', FleetVehicleLog: 'fleet',
  FleetDriver: 'fleet', FleetDriverExpense: 'fleet', FleetCustomer: 'fleet', FleetRequest: 'fleet',
  // طلبات الشحنات
  ShipmentOrder: 'shipment-orders',
  // التخليص الجمركي
  CustomsClearance: 'customs', CustomsContract: 'customs',
  // قطاع الأفراد — ومنه النقلُ الخفيف: شاشتُه داخل القسم وصلاحيّتُه صلاحيّتُه
  B2C: 'b2c', B2CRep: 'b2c', B2CProject: 'b2c', B2CDutyCheck: 'b2c', B2CWalletEntry: 'b2c',
  LightTransportEmployee: 'b2c', LightTransportOrder: 'b2c',
  // لوكيشن سوليوشن — الورشة والمستودع
  WorkshopPurchaseRequest: 'ls2', WorkshopTask: 'ls2', MaintenanceRequest: 'ls2',
  InventoryItem: 'ls2', Ls2StoreMovement: 'ls2', Ls2Asset: 'ls2',
  // العقود
  Contract: 'contracts',
  // إدارة العلاقات
  Customer: 'crm', Vendor: 'crm', CrmVendor: 'crm', Dispute: 'crm', Complaint: 'crm',
  // الإدارة المالية
  Payment: 'accounting', Invoice: 'accounting', JournalEntry: 'accounting',
  // تطوير الأعمال — أسماؤها صغيرةُ الحرف كما تُقيَّد في `bdController`
  tender: 'bd', partner: 'bd', opportunity: 'bd', activity: 'bd',
  // مراجعة الأعمال
  BrMeeting: 'business-review', BrAction: 'business-review', BrAssignment: 'business-review',
  // تقنية المعلومات
  CompanyEmail: 'it', Asset: 'it',
  // المستخدمون والنظام
  User: 'system', RolePermission: 'system', CustomRole: 'system',
  Branch: 'system', Lookup: 'system', System: 'system', PartnerAccount: 'system',
};

const sectionOf = (entity) => ENTITY_SECTION[entity] || 'other';

/** كلُّ كياناتِ قسمٍ ما — يُبنى منها شرطُ `$in` في الاستعلام. */
const entitiesOfSection = (key) =>
  Object.keys(ENTITY_SECTION).filter((e) => ENTITY_SECTION[e] === key);

const SECTION_KEYS = SECTIONS.map((s) => s.key);

module.exports = { SECTIONS, SECTION_KEYS, ENTITY_SECTION, sectionOf, entitiesOfSection };
