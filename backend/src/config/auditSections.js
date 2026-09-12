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

/** القسم ← اسمُه المقروء. `other` آخرًا دائمًا: هو ما لم يُصنَّف بعد. */
const SECTIONS = [
  { key: 'wallet', ar: 'العهدة النقدية', en: 'Cash Wallet' },
  { key: 'hr', ar: 'الموارد البشرية', en: 'HR' },
  { key: 'operations', ar: 'العمليات', en: 'Operations' },
  { key: 'collections', ar: 'التحصيل', en: 'Collections' },
  { key: 'vehicles', ar: 'المركبات', en: 'Vehicles' },
  { key: 'fleet', ar: 'إدارة الأسطول', en: 'Fleet Management' },
  { key: 'shipment-orders', ar: 'طلبات الشحنات', en: 'Shipment Orders' },
  { key: 'customs', ar: 'التخليص الجمركي', en: 'Customs Clearance' },
  { key: 'b2c', ar: 'B2C', en: 'B2C' },
  { key: 'ls2', ar: 'الورشة والمستودع', en: 'Workshop & Store' },
  { key: 'contracts', ar: 'العقود', en: 'Contracts' },
  { key: 'crm', ar: 'العملاء والموردون', en: 'CRM' },
  { key: 'accounting', ar: 'الحسابات', en: 'Accounting' },
  { key: 'it', ar: 'تقنية المعلومات', en: 'IT' },
  { key: 'system', ar: 'المستخدمون والنظام', en: 'Users & System' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
];

/** الكيان ← قسمُه. */
const ENTITY_SECTION = {
  // العهدة النقدية
  WalletTransaction: 'wallet', DailyWallet: 'wallet',
  // الموارد البشرية
  Employee: 'hr', CompanyLicense: 'hr', LeaveRequest: 'hr',
  // العمليات
  OperationsWorkflow: 'operations',
  // التحصيل
  CollectionsParty: 'collections', CollectionsFollowUp: 'collections',
  // المركبات — السجلّ ووثائقه وبطاقات السائقين
  VehicleMaster: 'vehicles', VehicleInsurancePolicy: 'vehicles',
  VehicleRegistryConfig: 'vehicles', DriverCard: 'vehicles',
  VehicleAuthorization: 'vehicles', VehicleAccident: 'vehicles',
  // إدارة الأسطول
  FleetShipment: 'fleet', FleetVehicle: 'fleet', FleetVehicleLog: 'fleet',
  FleetDriver: 'fleet', FleetDriverExpense: 'fleet',
  // طلبات الشحنات
  ShipmentOrder: 'shipment-orders',
  // التخليص الجمركي
  CustomsClearance: 'customs',
  // B2C — أربعةُ نماذجَ يقرؤها المستخدمُ قسمًا واحدًا
  B2C: 'b2c', B2CRep: 'b2c', B2CProject: 'b2c', B2CDutyCheck: 'b2c', B2CWalletEntry: 'b2c',
  // الورشة والمستودع
  WorkshopPurchaseRequest: 'ls2', WorkshopTask: 'ls2', MaintenanceRequest: 'ls2',
  InventoryItem: 'ls2', Ls2StoreMovement: 'ls2', Ls2Asset: 'ls2',
  // العقود
  Contract: 'contracts',
  // العملاء والموردون
  Customer: 'crm', Vendor: 'crm', CrmVendor: 'crm', Dispute: 'crm',
  // الحسابات
  Payment: 'accounting', Invoice: 'accounting', JournalEntry: 'accounting',
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
