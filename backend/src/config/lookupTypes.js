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
const SO_ROLES = ['shipment_orders_manager', 'shipment_orders_staff', 'operations_manager', 'operations_staff'];
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
  // الإدارةُ والمدينة: كانتا حقلين حرّين لا خانةَ لهما في نموذج التعديل أصلًا،
  // فتُقرآن في الفلاتر ولا تُصحَّحان في أيّ مكان. بُذرتا بما في البيانات فعلًا.
  vehicleList('vehicle_department', 'إدارات المركبات', 'Vehicle Departments', [
    { key: 'heavy_transport', nameAr: 'النقل الثقيل', nameEn: 'Heavy transport' },
    { key: 'customs', nameAr: 'التخليص الجمركي', nameEn: 'Customs clearance' },
    { key: 'collection', nameAr: 'التحصيل', nameEn: 'Collection' },
    { key: 'rental', nameAr: 'الايجار', nameEn: 'Rental' },
    { key: 'maintenance', nameAr: 'صيانه', nameEn: 'Maintenance' },
    { key: 'general_admin', nameAr: 'اداريين عموميين', nameEn: 'General admin' },
    { key: 'amazon', nameAr: 'امازون', nameEn: 'Amazon' },
    { key: 'ninja', nameAr: 'نينجا', nameEn: 'Ninja' },
    { key: 'kita', nameAr: 'كيتا', nameEn: 'Kita' },
    { key: 'hungerstation', nameAr: 'هنجرستيشن', nameEn: 'HungerStation' },
    { key: 'jamarat', nameAr: 'منقل الجمار', nameEn: 'Jamarat transport' },
    { key: 'owner', nameAr: 'مالك', nameEn: 'Owner' },
  ]),
  vehicleList('vehicle_city', 'مدن المركبات', 'Vehicle Cities', [
    { key: 'riyadh', nameAr: 'الرياض', nameEn: 'Riyadh' },
    { key: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah' },
    { key: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
    { key: 'yanbu', nameAr: 'ينبع', nameEn: 'Yanbu' },
    { key: 'rabigh', nameAr: 'رابغ', nameEn: 'Rabigh' },
    { key: 'sudair', nameAr: 'حوطة سدير', nameEn: 'Hawtat Sudair' },
    { key: 'makkah', nameAr: 'مكه المكرمه', nameEn: 'Makkah' },
  ]),
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
  // ── قوائمُ الموارد البشريّة ────────────────────────────────────────────────
  // ما كان يُكتب بالحرّيّة في خانةٍ نصّيّة فيصير في القاعدة عشرَ صيغٍ للشيء
  // الواحد («سائق»، «سائق شاحنة»، «سايق») — فلا يُفلتَر ولا يُعدّ.
  {
    type: 'hr_job_title',
    module: 'hr',
    nameEn: 'Job Titles',
    nameAr: 'المسمّيات الوظيفية',
    roles: ['hr_manager', 'hr_specialist'],
    storeLabel: true,
    seed: [
      { key: 'driver', nameEn: 'Driver', nameAr: 'سائق' },
      { key: 'accountant', nameEn: 'Accountant', nameAr: 'محاسب' },
      { key: 'admin_assistant', nameEn: 'Administrative Assistant', nameAr: 'مساعد إداري' },
      { key: 'technician', nameEn: 'Technician', nameAr: 'فني' },
      { key: 'supervisor', nameEn: 'Supervisor', nameAr: 'مشرف' },
    ],
  },
  {
    type: 'hr_termination_reason',
    module: 'hr',
    nameEn: 'Termination Reasons',
    nameAr: 'أسباب إنهاء الخدمة',
    roles: ['hr_manager', 'hr_specialist'],
    storeLabel: true,
    seed: [
      { key: 'resigned', nameEn: 'Resignation', nameAr: 'استقالة' },
      { key: 'contract_end', nameEn: 'Contract ended', nameAr: 'انتهاء العقد' },
      { key: 'terminated', nameEn: 'Terminated', nameAr: 'إنهاء من الشركة' },
      { key: 'absconded', nameEn: 'Absconded', nameAr: 'تغيّب' },
      { key: 'transferred', nameEn: 'Sponsorship transfer', nameAr: 'نقل كفالة' },
    ],
  },
  // ── قوائمُ طلبات الشحنات ──────────────────────────────────────────────────
  // القسمُ وسيطٌ: يشتري الحمولةَ من مورّدٍ ويبيعها لعميل. وهذه مفرداتُ عمله
  // اليوميّ — تُزاد وتُحذف من إعدادات القسم لا من نشرةٍ برمجيّة.
  {
    type: 'so_branch',
    module: 'shipment_orders',
    nameEn: 'Branches (Shipment Orders)',
    nameAr: 'الفروع (طلبات الشحنات)',
    roles: SO_ROLES,
    storeLabel: true,
    seed: [
      { key: 'jeddah', nameEn: 'Jeddah', nameAr: 'جدة' },
      { key: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
      { key: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام' },
    ],
  },
  {
    type: 'so_payment_method',
    module: 'shipment_orders',
    nameEn: 'Payment Methods (Shipment Orders)',
    nameAr: 'طرق الدفع (طلبات الشحنات)',
    roles: SO_ROLES,
    storeLabel: true,
    seed: [
      { key: 'cash', nameEn: 'Cash', nameAr: 'كاش' },
      { key: 'transfer', nameEn: 'Bank transfer', nameAr: 'تحويل بنكي' },
      { key: 'credit', nameEn: 'Credit', nameAr: 'آجل' },
    ],
  },
  {
    type: 'so_cancel_reason',
    module: 'shipment_orders',
    nameEn: 'Cancellation Reasons',
    nameAr: 'أسباب الإلغاء',
    roles: SO_ROLES,
    storeLabel: true,
    seed: [
      { key: 'customer', nameEn: 'Cancelled by customer', nameAr: 'إلغاء من العميل' },
      { key: 'no_truck', nameEn: 'No truck available', nameAr: 'لا تتوفّر شاحنة' },
      { key: 'price', nameEn: 'Price not agreed', nameAr: 'لم يُتّفق على السعر' },
      { key: 'duplicate', nameEn: 'Duplicate order', nameAr: 'طلب مكرّر' },
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
  // ── الفرعُ المسدِّد ─────────────────────────────────────────────────────────
  // كان حقلًا حرًّا يُكتب بالبد، فدخلت فيه «جد» و«جدهخ» بجانب «جده» — وهي أخطاءُ
  // كتابةٍ تُفرِّق صفوفًا هي فرعٌ واحد، فيقول التقريرُ تسعةَ فروعٍ ولدينا سبعة.
  // وصار قائمةً تُدار من الإعدادات: تُختار ولا تُكتب.
  //
  // ويُخزَّن الاسمُ العربيُّ لا المفتاح (`storeLabel`) لأنّ عشرين ألفَ صفٍّ تحمله
  // نصًّا منذ أوّل استيراد، وتقرؤه الفلاتر والتصديرات كما هو.
  {
    type: 'workflow_paying_branch',
    module: 'operations',
    nameEn: 'Paying Branches',
    nameAr: 'الفروع المسدِّدة',
    roles: ['operations_manager', 'operations_staff', 'moderator', 'finance_manager', 'accountant'],
    storeLabel: true,
    seed: [
      { key: 'jeddah', nameEn: 'Jeddah', nameAr: 'جده' },
      { key: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
      { key: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام' },
      { key: 'yanbu', nameEn: 'Yanbu', nameAr: 'ينبع' },
      { key: 'sudair', nameEn: 'Sudair', nameAr: 'سدير' },
      { key: 'rabigh', nameEn: 'Rabigh', nameAr: 'رابغ' },
      { key: 'jazan', nameEn: 'Jazan', nameAr: 'جازان' },
    ],
  },
  // ── وجهةُ الكشف النهائيّة ────────────────────────────────────────────────
  // الفرعُ الذي يستقرّ عنده الكشفُ في آخره. وهو من الفروع نفسِها، لكنّه سؤالٌ
  // آخر غيرُ «مَن سدّد»: قد يُسدَّد في فرعٍ ويستقرّ ملفُّه في غيره. فقائمتان
  // بالقيم نفسِها لا قائمةٌ واحدةٌ لعمودين، كي يُدار كلٌّ على حدة إن افترقا.
  {
    type: 'workflow_final_destination',
    module: 'operations',
    nameEn: 'Final Report Destinations',
    nameAr: 'وجهات الكشف النهائية',
    roles: ['operations_manager', 'operations_staff', 'moderator', 'finance_manager', 'accountant'],
    storeLabel: true,
    seed: [
      { key: 'jeddah', nameEn: 'Jeddah', nameAr: 'جده' },
      { key: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام' },
      { key: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
      { key: 'jazan', nameEn: 'Jazan', nameAr: 'جازان' },
      { key: 'yanbu', nameEn: 'Yanbu', nameAr: 'ينبع' },
      { key: 'rabigh', nameEn: 'Rabigh', nameAr: 'رابغ' },
      { key: 'sudair', nameEn: 'Sudair', nameAr: 'سدير' },
    ],
  },
  // ── قوائمُ التخليص الجمركيّ ────────────────────────────────────────────────
  // الميناءُ والعملةُ ونوعُ الفاتورة وبلدُ المنشأ كانت حقولًا حرّةً تُكتب في كلّ
  // معاملة. والقيمُ فيها قليلةٌ ومعروفة، فالكتابةُ الحرّةُ لا تضيف خيارًا بل
  // تضيف صيغةَ كتابةٍ أخرى للشيء نفسِه.
  ...[
    ['customs_port', 'الموانئ', 'Ports', [
      { key: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah' },
      { key: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
      { key: 'jubail', nameAr: 'الجبيل', nameEn: 'Jubail' },
      { key: 'yanbu', nameAr: 'ينبع', nameEn: 'Yanbu' },
      { key: 'riyadh_dry', nameAr: 'الميناء الجاف - الرياض', nameEn: 'Riyadh Dry Port' },
    ]],
    ['customs_currency', 'العملات', 'Currencies', [
      { key: 'usd', nameAr: 'USD', nameEn: 'USD' },
      { key: 'sar', nameAr: 'SAR', nameEn: 'SAR' },
      { key: 'eur', nameAr: 'EUR', nameEn: 'EUR' },
      { key: 'cny', nameAr: 'CNY', nameEn: 'CNY' },
      { key: 'aed', nameAr: 'AED', nameEn: 'AED' },
    ]],
    ['customs_invoice_type', 'أنواع الفواتير', 'Invoice Types', [
      { key: 'fob', nameAr: 'FOB', nameEn: 'FOB' },
      { key: 'cif', nameAr: 'CIF', nameEn: 'CIF' },
      { key: 'cfr', nameAr: 'CFR', nameEn: 'CFR' },
      { key: 'exw', nameAr: 'EXW', nameEn: 'EXW' },
      { key: 'ddp', nameAr: 'DDP', nameEn: 'DDP' },
    ]],
    ['customs_origin_country', 'بلدان المنشأ', 'Countries of Origin', [
      { key: 'china', nameAr: 'الصين', nameEn: 'China' },
      { key: 'india', nameAr: 'الهند', nameEn: 'India' },
      { key: 'turkey', nameAr: 'تركيا', nameEn: 'Turkey' },
      { key: 'uae', nameAr: 'الإمارات', nameEn: 'UAE' },
      { key: 'egypt', nameAr: 'مصر', nameEn: 'Egypt' },
      { key: 'germany', nameAr: 'ألمانيا', nameEn: 'Germany' },
    ]],
    ['customs_city', 'مدن التخليص', 'Customs Cities', [
      { key: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah' },
      { key: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
      { key: 'riyadh', nameAr: 'الرياض', nameEn: 'Riyadh' },
    ]],
  ].map(([type, nameAr, nameEn, seed]) => ({
    type, module: 'customs', nameAr, nameEn,
    roles: ['customs_manager', 'customs_officer', 'operations_manager'],
    storeLabel: true, seed,
  })),
];

const byType = (type) => REGISTRY.find((r) => r.type === type) || null;

// Roles allowed to create/update/delete a given type.
const writeRolesFor = (type) => {
  const entry = byType(type);
  return [...BASE_WRITE_ROLES, ...((entry && entry.roles) || [])];
};

const canManage = (type, role) => writeRolesFor(type).includes(role);

/**
 * قوائمُ هذا الدور — ما يخصُّه وحدَه.
 *
 * ── لماذا لا تُعرض كلُّها ──────────────────────────────────────────────────
 * كانت تُعاد كاملةً موسومةً بـ`canManage`، فيفتح مديرُ الأسطول الصفحةَ فيجد
 * قوائمَ الموارد البشريّة والمشتريات والمركبات أمامه. لا يعدّلها — الخادمُ
 * يمنعه — لكنّه يراها ويقرأ فيها ما ليس من شأنه، ويبحث عن قائمته بين ما لا
 * يعنيه. وليس هذا حجبًا أمنيًّا بقدر ما هو ترتيب: القائمةُ تعيش عند قسمِها.
 *
 * فالإدارةُ العليا وتقنيةُ المعلومات يرَون الجميع — هم أصحابُ الصفحة العامّة —
 * وكلُّ دورٍ آخر يرى ما يملك تعديلَه فقط. و`all` تُبقي الباب مفتوحًا لمن
 * يحتاج القائمةَ كاملةً عمدًا.
 */
const GLOBAL_LOOKUP_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

const typesForRole = (role, { all = false } = {}) => {
  const meta = REGISTRY.map((r) => ({
    type: r.type,
    module: r.module,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    canManage: canManage(r.type, role),
  }));
  if (all || GLOBAL_LOOKUP_ROLES.includes(role)) return meta;
  return meta.filter((r) => r.canManage);
};

// Idempotent seeding: insert any missing default rows. Existing rows (including
// user edits) are never overwritten.
const ensureDefaultLookups = async () => {
  const Lookup = require('../models/Lookup');
  for (const entry of REGISTRY) {
    for (let i = 0; i < (entry.seed || []).length; i++) {
      const row = entry.seed[i];
      // يشمل المحذوفَ بشاهدة: وجودُ الشاهدة يعني «أُزيلت قصدًا» فلا تُعاد.
      const exists = await Lookup.findOne({ type: entry.type, key: row.key }).select('_id deleted').lean();
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

module.exports = { REGISTRY, byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups, GLOBAL_LOOKUP_ROLES };
