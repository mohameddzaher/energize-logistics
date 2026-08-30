// Registry of every editable reference list (lookup type) in the system.
// Each entry declares: a stable `type` id, the module it belongs to, bilingual
// labels, the roles allowed to manage it, and the default rows to seed once.
//
// To add a new editable dropdown anywhere in the app you only need to:
//   1. add an entry here (with seed rows), and
//   2. point a <ManagedSelect type="..."> at it on the frontend.
// No new model / controller / route is required.
const crmDefaults = require('./crmDefaults');
const procurementDefaults = require('./procurementDefaults');
const assetDefaults = require('./assetDefaults');
const vehicleDefaults = require('./vehicleDefaults');

// Roles that can manage every lookup regardless of module.
const BASE_WRITE_ROLES = ['super_admin', 'admin'];

const FLEET_ROLES = ['fleet_manager', 'operations_manager', 'operations_staff'];
const VEHICLE_ROLES = ['vehicles_manager', 'vehicles_staff', 'hr_manager', 'finance_manager'];

/**
 * قوائم قسم المركبات: كلُّ حقلٍ ذي اختياراتٍ ثابتة صار قائمةً تُدار من إعدادات
 * القسم بدل حقلٍ حرٍّ يُكتب بألف صيغة. راجع config/vehicleDefaults.js للسبب.
 *
 * وهي تُخزَّن بالاسم العربيّ لا بالمفتاح — الحقول تحمل النصّ العربيّ منذ أوّل
 * استيراد وتقرؤه الفلاتر والتصديرات، فالمقصود حصرُ ما يُكتب لا تغييرُ ما يُخزَّن.
 */
const vehicleList = (type, nameAr, nameEn, seed) => ({
  type, module: 'vehicles', nameAr, nameEn, roles: VEHICLE_ROLES, storeLabel: true, seed,
});

const REGISTRY = [
  vehicleList('vehicle_coverage_type', 'نوع تغطية التأمين', 'Insurance Coverage Types', vehicleDefaults.coverageTypes),
  vehicleList('vehicle_insurance_company', 'شركات التأمين', 'Insurance Companies', vehicleDefaults.insuranceCompanies),
  vehicleList('vehicle_premium_status', 'حالة قسط التأمين', 'Premium Statuses', vehicleDefaults.premiumStatuses),
  vehicleList('vehicle_sector', 'قطاعات المركبات', 'Vehicle Sectors', vehicleDefaults.sectors),
  vehicleList('vehicle_registration_type', 'أنواع التسجيل', 'Registration Types', vehicleDefaults.registrationTypes),
  vehicleList('vehicle_possession_status', 'حالة الحيازة', 'Possession Statuses', vehicleDefaults.possessionStatuses),
  vehicleList('vehicle_service_status', 'حالة تشغيل المركبة', 'Service Statuses', vehicleDefaults.serviceStatuses),
  vehicleList('vehicle_color', 'ألوان المركبات', 'Vehicle Colours', vehicleDefaults.colors),
  vehicleList('vehicle_brand', 'ماركات المركبات', 'Vehicle Brands', vehicleDefaults.brands),
  vehicleList('vehicle_fuel_provider', 'مزوّدو شرائح الوقود', 'Fuel-card Providers', vehicleDefaults.fuelProviders),
  vehicleList('vehicle_fuel_card_status', 'حالة شريحة الوقود', 'Fuel-card Statuses', vehicleDefaults.fuelCardStatuses),
  vehicleList('vehicle_consumption_type', 'نوع استهلاك الوقود', 'Consumption Types', vehicleDefaults.consumptionTypes),
  vehicleList('vehicle_gps_provider', 'شركات التتبّع', 'GPS Providers', vehicleDefaults.gpsProviders),
  vehicleList('vehicle_gps_device', 'أجهزة التتبّع', 'GPS Devices', vehicleDefaults.gpsDevices),
  vehicleList('vehicle_gps_device_status', 'حالة جهاز التتبّع', 'GPS Device Statuses', vehicleDefaults.gpsDeviceStatuses),
  vehicleList('vehicle_inspection_status', 'حالة الفحص', 'Inspection Statuses', vehicleDefaults.inspectionStatuses),
  vehicleList('vehicle_job_title', 'وظائف المفوَّضين', 'Authorised-person Job Titles', vehicleDefaults.jobTitles),

  // ── إدارة الأسطول — قوائم منسدلة قابلة للتعديل ────────────────────────────
  {
    type: 'fleet_rent_type',
    module: 'fleet',
    nameEn: 'Fleet Rent Types',
    nameAr: 'أنواع الإيجار (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'forward', nameEn: 'Forward', nameAr: 'قدام' },
      { key: 'return', nameEn: 'Return', nameAr: 'راجعة' },
    ],
  },
  {
    type: 'fleet_payment_type',
    module: 'fleet',
    nameEn: 'Fleet Payment Types',
    nameAr: 'أنواع الدفع (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'cash', nameEn: 'Cash', nameAr: 'كاش' },
      { key: 'tax', nameEn: 'Tax invoice', nameAr: 'ضريبي' },
    ],
  },
  {
    type: 'fleet_load_type',
    module: 'fleet',
    nameEn: 'Fleet Load Types',
    nameAr: 'أنواع الحمولة (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'general', nameEn: 'General cargo', nameAr: 'بضائع عامة' },
      { key: 'containers', nameEn: 'Containers', nameAr: 'حاويات' },
      { key: 'vehicles', nameEn: 'Vehicles', nameAr: 'سيارات' },
      { key: 'equipment', nameEn: 'Equipment', nameAr: 'معدات' },
      { key: 'reefer', nameEn: 'Refrigerated', nameAr: 'مبرّدة' },
      { key: 'liquids', nameEn: 'Liquids', nameAr: 'سوائل' },
    ],
  },
  // ── ملاحظاتُ المتابعة الجاهزة ─────────────────────────────────────────────
  // ثمانيةُ سطورٍ كانت مكتوبةً في الشيفرة: يضغط المشرفُ عليها فتُملأ خانةُ
  // الملاحظة بلمسة. وهي أكثرُ ما يُكتب في اليوم، فلمّا نقص سطرٌ يحتاجه الفريق
  // («في الجمرك»، «تعطّل ونُقلت الحمولة») لم يكن له سبيلٌ إلّا نشرةُ برمجيّة.
  // صارت قائمةً كسائر القوائم: تُزاد وتُحذف وتُرتَّب من إعدادات القسم.
  {
    type: 'fleet_followup_note',
    module: 'fleet',
    nameEn: 'Follow-up Quick Notes',
    nameAr: 'ملاحظات المتابعة الجاهزة',
    roles: FLEET_ROLES,
    storeLabel: true,   // النصُّ نفسُه هو ما يُكتب في الملاحظة، لا مفتاحٌ يرمز إليه
    seed: [
      { key: 'to_unload', nameEn: 'On the way to the unloading site', nameAr: 'في الطريق إلى موقع التنزيل' },
      { key: 'to_load', nameEn: 'On the way to the loading site', nameAr: 'في الطريق إلى موقع التحميل' },
      { key: 'loaded_moving', nameEn: 'Loaded and moving', nameAr: 'حمَّل وتحرّك' },
      { key: 'rest_stop', nameEn: 'Stopped — rest', nameAr: 'متوقف — استراحة' },
      { key: 'empty', nameEn: 'Empty', nameAr: 'فارغ' },
      { key: 'breakdown', nameEn: 'Stopped — breakdown on the road', nameAr: 'متوقف — عُطل على الطريق' },
      { key: 'arrived', nameEn: 'Arrived at the unloading site', nameAr: 'وصل موقع التنزيل' },
      { key: 'unloading', nameEn: 'Unloading', nameAr: 'جارٍ التفريغ' },
    ],
  },
  {
    type: 'procurement_category',
    module: 'procurement',
    nameEn: 'Procurement Categories',
    nameAr: 'فئات المشتريات',
    roles: ['procurement_manager', 'procurement_staff'],
    seed: procurementDefaults.CATEGORIES,
  },
  {
    type: 'vendor_category',
    module: 'procurement',
    nameEn: 'Vendor Categories',
    nameAr: 'فئات الموردين',
    roles: ['procurement_manager', 'procurement_staff', 'operations_manager', 'operations_staff'],
    seed: [
      { key: 'spare_parts', nameEn: 'Spare Parts', nameAr: 'قطع غيار' },
      { key: 'fuel', nameEn: 'Fuel', nameAr: 'وقود' },
      { key: 'services', nameEn: 'Services', nameAr: 'خدمات' },
      { key: 'logistics', nameEn: 'Logistics', nameAr: 'لوجستيات' },
      { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
    ],
  },
  {
    type: 'crm_industry',
    module: 'crm',
    nameEn: 'CRM Industries',
    nameAr: 'صناعات العملاء',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.INDUSTRIES,
  },
  {
    type: 'crm_source',
    module: 'crm',
    nameEn: 'Lead Sources',
    nameAr: 'مصادر العملاء',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.SOURCES,
  },
  {
    type: 'crm_company_type',
    module: 'crm',
    nameEn: 'Company Types',
    nameAr: 'أنواع الشركات',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.COMPANY_TYPES,
  },
  {
    type: 'crm_company_size',
    module: 'crm',
    nameEn: 'Company Sizes',
    nameAr: 'أحجام الشركات',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.COMPANY_SIZES,
  },
  {
    type: 'asset_type',
    module: 'it',
    nameEn: 'Custody & Store Item Types',
    nameAr: 'أنواع أصناف العهد والمستودع',
    roles: ['it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],
    seed: assetDefaults.TYPE_SEED,
  },
  {
    type: 'asset_condition',
    module: 'it',
    nameEn: 'Item Conditions',
    nameAr: 'حالات الأصناف',
    roles: ['it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],
    seed: assetDefaults.CONDITION_SEED,
  },
];

const byType = (type) => REGISTRY.find((r) => r.type === type) || null;

// Roles allowed to create/update/delete a given type.
const writeRolesFor = (type) => {
  const entry = byType(type);
  return [...BASE_WRITE_ROLES, ...((entry && entry.roles) || [])];
};

const canManage = (type, role) => writeRolesFor(type).includes(role);

// Public metadata (no seed payload) for the management UI, annotated with whether
// the requesting role may manage each type.
const typesForRole = (role) =>
  REGISTRY.map((r) => ({
    type: r.type,
    module: r.module,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    canManage: canManage(r.type, role),
  }));

// Idempotent seeding: insert any missing default rows. Existing rows (including
// user edits) are never overwritten.
const ensureDefaultLookups = async () => {
  const Lookup = require('../models/Lookup');
  for (const entry of REGISTRY) {
    for (let i = 0; i < (entry.seed || []).length; i++) {
      const row = entry.seed[i];
      const exists = await Lookup.findOne({ type: entry.type, key: row.key }).select('_id').lean();
      if (!exists) {
        await Lookup.create({
          type: entry.type,
          key: row.key,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          color: row.color,
          order: i,
          isActive: true,
          isSystem: true,
        });
      }
    }
  }
};

module.exports = { REGISTRY, byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups };
