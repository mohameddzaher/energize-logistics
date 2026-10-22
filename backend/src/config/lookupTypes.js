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
const VEHICLE_ROLES = ['vehicles_manager', 'vehicles_staff', 'hr_manager', 'cfo', 'accounting_manager'];

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


const B2C_LOOKUP_ROLES = ['b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager'];
/**
 * قائمةٌ من قوائم النقل الخفيف. تُخزَّن بالاسم العربيّ لا بالمفتاح: الحقولُ
 * تحمل النصَّ العربيَّ منذ الاستيراد وتقرؤه الفلاتر والتصديرات، والمقصودُ حصرُ
 * ما يُكتب لا تغييرُ ما يُخزَّن.
 */
const ltList = (type, nameAr, nameEn, seed) => ([{
  type, module: 'b2c', nameAr, nameEn, roles: B2C_LOOKUP_ROLES, storeLabel: true,
  seed: seed.map((name, i) => ({ key: `lt_${type}_${i}`, nameEn: name, nameAr: name, order: i + 1 })),
}]);

const REGISTRY = [
  // نوعُ النقل الذي تُخوِّله بطاقةُ السائق — يُكتب عند الإنشاء، والمشتقُّ من
  // مركباته يملأ الفارغ. راجع `transportTypeAr` في models/DriverCard.
  // نوعُ بطاقة السائق — كان خانةً حرّة، فكُتبت «سنوية» و«سنويه» و«مطلوب».
  vehicleList('vehicle_driver_card_type', 'نوع بطاقة السائق', 'Driver Card Types',
    [{ key: 'annual', nameEn: 'Annual', nameAr: 'سنوية' },
      { key: 'restricted', nameEn: 'Restricted', nameAr: 'مقيدة' },
      { key: 'required', nameEn: 'Required (not issued)', nameAr: 'مطلوبة' }]),
  vehicleList('vehicle_transport_type', 'نوع النقل (بطاقة السائق)', 'Transport Types',
    [{ key: 'heavy', nameEn: 'Heavy transport', nameAr: 'نقل ثقيل' },
      { key: 'light', nameEn: 'Light transport', nameAr: 'نقل خفيف' },
      { key: 'motorcycle', nameEn: 'Motorcycle', nameAr: 'دراجة آلية' },
      { key: 'private', nameEn: 'Private vehicle', nameAr: 'مركبة خاصة' }]),
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
  vehicleList('vehicle_owner_company', 'الشركة المالكة للمركبة', 'Vehicle Owning Companies', vehicleDefaults.ownerCompanies),
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
  // جهةُ الإبلاغ عن الحادث: «نجم» أو «المرور». كانت خانةً حرّة، فكُتبت
  // «Najm» في ستٍّ وعشرين واقعة و«المرور» في إحدى وعشرين — فلا يُعَدُّ منها
  // شيء. راجع scripts/normalizeReportedVia.js.
  vehicleList('vehicle_reported_via', 'جهة الإبلاغ عن الحادث', 'Accident Reported Via', [
    { key: 'najm', nameAr: 'نجم', nameEn: 'Najm' },
    { key: 'traffic', nameAr: 'المرور', nameEn: 'Traffic police' },
  ]),

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
  /**
   * ── قسمُ الموظّف: قائمةٌ لا خانةٌ حرّة ──────────────────────────────────────
   * كانت تُكتب حرًّا، فصار في ملفّات الموظّفين ثمانيةٌ وعشرون «قسمًا»: «مؤامة»
   * و«مواءمة» للشيء الواحد، و«B2C» و«b2c» و«ادارة B2C» ثلاثةً، وواحدٌ اسمُه
   * «سامح» — وهو اسمُ رجلٍ لا قسم. فلا يُفلتَر القسمُ ولا يُعَدّ، ويُقرأ الملاكُ
   * موزَّعًا على أقسامٍ لا وجودَ لها.
   *
   * والقائمةُ أقسامُ الشركة كما يعرفها أهلُها، لا أقسامُ النظام: لكلّ قسمٍ في
   * النظام صفحةٌ، ولكنّ الموظّفين لا يُوزَّعون على الصفحات.
   */
  {
    type: 'hr_department',
    module: 'hr',
    nameEn: 'Departments',
    nameAr: 'الأقسام',
    /**
     * ── والقائمةُ يملكها المديرُ العامّ وحدَه (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────
     * القسمُ يُختار من القائمة في كلّ شاشة — الماستر وملفّ الموظّف والتطبيق —
     * ولا يُكتب. وزيادةُ قسمٍ أو حذفُه أو تغييرُ اسمه من «البيانات المرجعيّة»
     * للسوبر أدمن فقط. والاسمُ الجديدُ يسري على ملفّات موظّفيه (utils/hrLists)،
     * والقسمُ الذي فيه موظّفون لا يُحذَف حتّى يُنقَلوا.
     */
    superOnly: true,
    roles: [],
    storeLabel: true,
    // أقسامُ الشركة كما هي في ملفّات الموظّفين بعد توحيدها (scripts/hrDepartmentsUnify.js):
    // MD وCEO ← الإدارة · الكافيه ← الموارد البشرية · «ادارة B2C» ← B2C ·
    // «بدون مشروع» ← بدون قسم. والمفاتيحُ القديمةُ باقيةٌ لأنّ تقييمَ الأداء يقرؤها.
    seed: [
      { key: 'management', nameEn: 'Management', nameAr: 'الإدارة' },
      { key: 'light_transport', nameEn: 'B2C', nameAr: 'B2C' },
      { key: 'heavy_transport', nameEn: 'Heavy Transport', nameAr: 'النقل الثقيل' },
      { key: 'saudization', nameEn: 'Saudization', nameAr: 'التوطين' },
      { key: 'operations', nameEn: 'Operations', nameAr: 'التشغيل' },
      { key: 'alignment', nameEn: 'Alignment', nameAr: 'مواءمة' },
      { key: 'maintenance', nameEn: 'Maintenance', nameAr: 'الصيانة' },
      { key: 'finance', nameEn: 'Finance', nameAr: 'المالية' },
      { key: 'hr', nameEn: 'Human Resources', nameAr: 'الموارد البشرية' },
      { key: 'customs', nameEn: 'Customs', nameAr: 'تخليص جمركي' },
      { key: 'sales', nameEn: 'Sales', nameAr: 'المبيعات' },
      { key: 'collections', nameEn: 'Collections', nameAr: 'التحصيل' },
      { key: 'it', nameEn: 'IT', nameAr: 'IT' },
      { key: 'marketing', nameEn: 'Marketing & Advertising', nameAr: 'التسويق والاعلان' },
      { key: 'no_department', nameEn: 'No department', nameAr: 'بدون قسم' },
    ],
  },
  /**
   * ── الفئةُ الوظيفيّة لموظّفي B2C والنقل الثقيل ─────────────────────────────
   * ثلاثٌ لا غير — والقائمةُ للسوبر أدمن وحدَه كقائمة الأقسام.
   */
  /**
   * ── «فري لانسر» و«تدريب» — قيمتا «رقم السجل التجاري» لغير المكفولين ──────────
   * الخانةُ تُختار ولا تُكتب (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠): سجلّاتُنا (`hr_register`)
   * ومعها هاتان. ومنها يُعرف نوعُ الموظّف (utils/hrEngagement).
   */
  {
    type: 'hr_register_kind',
    module: 'hr', nameEn: 'Non-sponsored register values', nameAr: 'قيم السجل لغير المكفولين',
    superOnly: true, roles: [], storeLabel: true,
    seed: [
      { key: 'freelance', nameEn: 'Freelance', nameAr: 'فري لانسر' },
      { key: 'trainee', nameEn: 'Training', nameAr: 'تدريب' },
    ],
  },
  {
    type: 'hr_staff_category',
    module: 'hr', nameEn: 'Staff categories', nameAr: 'الفئات الوظيفية',
    superOnly: true, roles: [], storeLabel: true,
    seed: [
      { key: 'admin', nameEn: 'Administrative', nameAr: 'إداري' },
      { key: 'driver', nameEn: 'Driver', nameAr: 'سائق' },
      { key: 'technician', nameEn: 'Technician', nameAr: 'فني' },
    ],
  },
  /**
   * ── سجلّاتُنا التجاريّة ────────────────────────────────────────────────────
   * «على كفالتنا» = على سجلٍّ منها. منها يُختار السجلُّ عند تحويل فريلانسر إلى
   * كفالتنا (POST /employees/:id/sponsor). والسجلّاتُ يملكها السوبر أدمن.
   */
  {
    type: 'hr_register',
    module: 'hr', nameEn: 'Our commercial registers', nameAr: 'سجلاتنا التجارية',
    superOnly: true, roles: [], storeLabel: true,
    seed: ['7025667531', '7038387267', '7041762761', '7053403049', '7012953373', '7040732641', '7001621395']
      .map((n) => ({ key: `cr_${n}`, nameEn: n, nameAr: n })),
  },
  /**
   * ── مشاريعُ الموظّفين (غيرُ مشاريع B2C) ────────────────────────────────────
   * مشروعُ موظّف B2C يُختار من `lt_project` ويملكه قسمُ B2C. وهذه لبقيّة الموظّفين.
   * وخيارُ «المشروع» في ملفّ الموظّف القائمتان معًا (utils/hrLists).
   */
  {
    type: 'hr_project',
    module: 'hr', nameEn: 'Projects', nameAr: 'المشاريع',
    roles: ['hr_manager', 'hr_specialist'], storeLabel: true,
    seed: [
      { key: 'heavy_transport', nameEn: 'Heavy Transport', nameAr: 'النقل الثقيل' },
      { key: 'customer_service', nameEn: 'Customer Service', nameAr: 'خدمة عملاء' },
      { key: 'branches', nameEn: 'Branches', nameAr: 'الفروع' },
    ],
  },
  // ── وبقيّةُ خانات ملفّ الموظّف ذاتِ الاختيارات المحدودة ────────────────────
  // «Saudi Arabia» و«السعودية» جنسيّةٌ واحدةٌ في خانتين، و«لايوجد» و«غير مطلوب»
  // تصنيفان لشيءٍ واحد. والبذورُ ما هو مكتوبٌ فعلًا في الملفّات — لا قائمةٌ
  // مُتخيَّلة — فما في الشاشة هو ما في السجلّ من أوّل يوم.
  {
    type: 'hr_nationality',
    module: 'hr', nameEn: 'Nationalities', nameAr: 'الجنسيات',
    roles: ['hr_manager', 'hr_specialist'], storeLabel: true,
    seed: ['السعودية', 'مصر', 'باكستان', 'بنجلاديش', 'الهند', 'اليمن', 'السودان', 'سوريا', 'الأردن', 'الفلبين', 'نيبال', 'سريلانكا']
      .map((n, i) => ({ key: `nat_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_iqama_profession',
    module: 'hr', nameEn: 'Iqama Professions', nameAr: 'المهنة في الإقامة',
    roles: ['hr_manager', 'hr_specialist'], storeLabel: true,
    seed: ['سائق دراجة نارية', 'عامل دراجة نقل', 'عامل تحميل وتنزيل', 'سائق شاحنة ثقيلة', 'سائق', 'فني', 'محاسب', 'مشرف', 'عامل نظافة', 'غير مطلوب']
      .map((n, i) => ({ key: `prof_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_classification',
    module: 'hr', nameEn: 'Classifications', nameAr: 'التصنيف',
    roles: ['hr_manager', 'hr_specialist'], storeLabel: true,
    seed: ['A', 'B', 'C', 'E1', 'لا يوجد'].map((n, i) => ({ key: `cls_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_work_location',
    module: 'hr', nameEn: 'Work Locations', nameAr: 'مواقع العمل',
    roles: ['hr_manager', 'hr_specialist'], storeLabel: true,
    seed: ['جدة', 'مكة المكرمة', 'الرياض', 'الدمام', 'جازان', 'ينبع', 'أبها', 'المدينة المنورة']
      .map((n, i) => ({ key: `loc_${i}`, nameEn: n, nameAr: n })),
  },
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
  {
    // ── حالةُ العقد تُكتب عند الإنهاء، لا تُترك لمن يفتح الملفّ بعد شهر ──────
    //
    // «حالة العقد» عمودٌ في ملفّ الموارد البشريّة يُقرأ ليُعرَف موقفُ الموظّف:
    // أساري عقدُه أم أُنهي. وكان يُملأ من ملفّ الاستيراد وحدَه، ولا يكتبه إنهاءُ
    // الخدمة من الشاشة — فمن أُنهيت خدمتُه في النظام بقي عموده فارغًا. أربعةٌ
    // وأربعون من واحدٍ وستّين ليسوا على رأس العمل بلا حالةِ عقدٍ مكتوبة.
    //
    // وهو قائمةٌ لا نصٌّ حرّ: أربعُ حالاتٍ في الملفّ كلِّه، وكتابتُها باليد
    // تجعلها أربعين صيغةً بعد شهر فلا تُفلتَر ولا تُعَدّ. ومن نقصه خيارٌ يزيده
    // من القائمة نفسِها فيراه كلُّ من بعده.
    type: 'hr_contract_status',
    module: 'hr',
    nameEn: 'Contract Status',
    nameAr: 'حالة العقد',
    roles: ['hr_manager', 'hr_specialist'],
    storeLabel: true,
    // ── وبألفاظ صفحة العقود لا بألفاظ ملفّ الاستيراد ────────────────────────
    // الحالةُ مكتوبةٌ على العقد نفسِه (`Contract.status`) وتقرؤها صفحةُ العقود
    // «ساري · منتهي» — حالتان لا غير منذ ٢٠٢٦/١٠/١٩، و«مفسوخ» منتهٍ. وكان الاستيرادُ يكتب في ملفّ الموظّف «تم انهاء
    // العقد» و«غير ساري» — المعنى واحدٌ واللفظُ لفظان، فلا يُفلتَر عليهما معًا
    // ولا يُعَدّان واحدًا. وُحِّدت على ألفاظ صفحة العقود لأنّ العقدَ هو المستند.
    // راجع utils/contractStatus.
    seed: [
      { key: 'active', nameEn: 'Active', nameAr: 'ساري' },
      { key: 'expired', nameEn: 'Expired', nameAr: 'منتهي' },
      { key: 'none', nameEn: 'None', nameAr: 'لا يوجد' },
    ],
  },
  // ── قوائمُ طلبات الشحنات ──────────────────────────────────────────────────
  // القسمُ وسيطٌ: يشتري الحمولةَ من مورّدٍ ويبيعها لعميل. وهذه مفرداتُ عمله
  // اليوميّ — تُزاد وتُحذف من إعدادات القسم لا من نشرةٍ برمجيّة.
  // ── حالاتُ الشحنة ─────────────────────────────────────────────────────────
  // الحالةُ مفتاحٌ لا تسمية: التحليلاتُ تعدّ على `arrived`، والتنبيهاتُ تُطلق من
  // `late`، والمنصّةُ الخارجيّة تتكلّم بهذه المفاتيح نفسِها. فالمفاتيحُ العشرةُ
  // عقدٌ مكتوبٌ في الشيفرة (`utils/shipmentOrderStatuses`)، ولا تُحذَف من شاشة.
  //
  // والذي يُضبَط من هنا: **الاسمُ الظاهر، ولونُه، وترتيبُه، وأهو مُستعمَلٌ اليوم**
  // — ومن احتاج حالةً حادية عشرةَ أضافها فتظهر في البطاقات وفي نموذج الإنشاء بلا
  // نشرة. راجع `statusVocabulary` في `shipmentOrdersController`.
  {
    type: 'so_status',
    module: 'shipment_orders',
    nameEn: 'Shipment Statuses',
    nameAr: 'حالات الشحنة',
    roles: SO_ROLES,
    seed: [
      { key: 'requesting', nameEn: 'Requesting', nameAr: 'قيد الطلب', color: '#64748b', order: 1 },
      { key: 'loading', nameEn: 'Loading', nameAr: 'جاري التحميل', color: '#d97706', order: 2 },
      { key: 'uploaded', nameEn: 'Uploaded', nameAr: 'تم التحميل', color: '#ca8a04', order: 3 },
      { key: 'on_way', nameEn: 'On Way', nameAr: 'في الطريق', color: '#2563eb', order: 4 },
      { key: 'arrived', nameEn: 'Arrived', nameAr: 'وصلت', color: '#4f46e5', order: 5 },
      { key: 'bond_sent', nameEn: 'Bond Sent', nameAr: 'أُرسل السند', color: '#0891b2', order: 6 },
      { key: 'bond_received', nameEn: 'Bond Received', nameAr: 'استُلم السند', color: '#059669', order: 7 },
      { key: 'late', nameEn: 'Late', nameAr: 'متأخرة', color: '#ea580c', order: 8 },
      { key: 'invoiced', nameEn: 'Invoiced', nameAr: 'تمت الفوترة', color: '#7c3aed', order: 9 },
      { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغاة', color: '#dc2626', order: 10 },
    ],
  },
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
  // ── وباقاتُ خطوط الجوّال قائمةٌ تُدار ──────────────────────────────────────
  // اسمُ الباقة يُكتب كما هو في عقد المزوّد («Business Ctrl Plus 200»)، وكتابتُه
  // حرًّا في كلّ خطٍّ تعني تسعةً وسبعين تهجئةً لبضع باقات — ثمّ لا يُعرف كم خطًّا
  // على كلّ باقة. فهي قائمةٌ يُختار منها، ويزيدها المزوّدُ حين يزيد.
  {
    type: 'telecom_package',
    module: 'hr',
    nameEn: 'Mobile line packages',
    nameAr: 'باقات خطوط الجوّال',
    roles: ['hr_manager', 'hr_specialist', 'it_manager', 'it_specialist'],
    seed: [
      { key: 'Business Ctrl Plus 200', nameEn: 'Business Ctrl Plus 200', nameAr: 'Business Ctrl Plus 200' },
      { key: 'Business Ctrl Plus 400', nameEn: 'Business Ctrl Plus 400', nameAr: 'Business Ctrl Plus 400' },
    ],
  },
  {
    type: 'telecom_provider',
    module: 'hr',
    nameEn: 'Mobile providers',
    nameAr: 'مزوّدو خدمة الجوّال',
    roles: ['hr_manager', 'hr_specialist', 'it_manager', 'it_specialist'],
    seed: [
      { key: 'mobily', nameEn: 'Mobily', nameAr: 'موبايلي' },
      { key: 'stc', nameEn: 'STC', nameAr: 'STC' },
      { key: 'zain', nameEn: 'Zain', nameAr: 'زين' },
    ],
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
    roles: ['operations_manager', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accountant'],
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
    roles: ['operations_manager', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accountant'],
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
    // ── مراحلُ السداد ────────────────────────────────────────────────────
    // كانت ثمانيَ خانةٍ مكتوبةً في المخطَّط، فمن أراد مرحلةً تاسعة انتظر نشرةً
    // جديدة. صارت قائمةً تُدار من إعدادات القسم: تُضاف المرحلةُ وتُسمّى ويُعاد
    // ترتيبُها، ويظهر ذلك في كلّ معاملة.
    //
    // و`transportInvoice` مرحلةٌ لها حكمٌ خاصّ: لا تُقفَل معاملةٌ قبل أن يكون
    // لها تاريخٌ ومرفق (راجع `completeClearance`). فمفتاحُها يُقرأ في الشيفرة،
    // ولذلك تبقى موجودةً ولو أُعيدت تسميتُها — والاسمُ وحدَه هو ما يُعدَّل.
    ['customs_payment_stage', 'مراحل السداد', 'Payment Stages', [
      { key: 'doInvoiceEmailed', nameAr: 'مراسلة الوكيل بطلب فاتورة إذن التسليم', nameEn: 'DO invoice emailed' },
      { key: 'doInvoicePaid', nameAr: 'سداد فاتورة إذن التسليم', nameEn: 'DO invoice paid' },
      { key: 'doLinkEmailed', nameAr: 'مراسلة الوكيل بطلب ربط إذن التسليم', nameEn: 'DO link emailed' },
      { key: 'dutyPaid', nameAr: 'سداد الرسوم الجمركية', nameEn: 'Customs duty paid' },
      { key: 'portFeesPaid', nameAr: 'سداد أجور الموانئ', nameEn: 'Port fees paid' },
      { key: 'unloadingFeesPaid', nameAr: 'سداد أجور التفريغ', nameEn: 'Unloading paid' },
      // «إرجاع الحاويات» و«فاتورة الإرجاع» أُزيلتا بطلب القسم وحلّ محلَّهما
      // «التمديد»؛ و«فاتورة النقل» صارت ثلاثةَ أجزاء — راجع REMOVED_DEFAULTS.
      { key: 'extension', nameAr: 'التمديد', nameEn: 'Extension' },
      { key: 'transportPortToCustomer', nameAr: 'فاتورة النقل من الميناء إلى العميل', nameEn: 'Transport: port → customer' },
      { key: 'transportPortToYard', nameAr: 'فاتورة النقل من الميناء إلى الساحة', nameEn: 'Transport: port → yard' },
      { key: 'transportYardToCustomer', nameAr: 'فاتورة النقل من الساحة إلى العميل', nameEn: 'Transport: yard → customer' },
      { key: 'appointmentBooking', nameAr: 'حجز الموعد', nameEn: 'Appointment booking' },
      { key: 'inspection', nameAr: 'أجور الكشف', nameEn: 'Inspection fees' },
      { key: 'exitPermit', nameAr: 'تصريح الخروج (الأرضيات)', nameEn: 'Exit permit (demurrage)' },
      { key: 'consolidator', nameAr: 'الدامج', nameEn: 'Consolidator' },
      { key: 'commissions', nameAr: 'عمولات', nameEn: 'Commissions' },
      { key: 'labourExpenses', nameAr: 'مصاريف عمال', nameEn: 'Labour expenses' },
    ]],
    /**
     * ── بنودُ فاتورة العميل ─────────────────────────────────────────────────
     * «مراحل السداد» ما **ندفعه** نحن؛ وهذه ما **نفوتره للعميل** عند إقفال
     * المعاملة. والبندُ الواحدُ قد يكون في القائمتين بسعرين مختلفين: فاتورةُ
     * النقل نُسدّدها ١٨٠٠ ونفوترها ٢٢٠٠ — فما كان هنا يُؤخَذ سعرُه من هنا،
     * ولا يُكرَّر سعرُ التكلفة في الفاتورة. راجع utils/customsInvoice.
     */
    ['customs_sale_item', 'بنود فاتورة العميل', 'Customer Invoice Items', [
      { key: 'transportInvoice', nameAr: 'فاتورة النقل', nameEn: 'Transport invoice' },
      { key: 'dutyPaid', nameAr: 'الرسوم الجمركية', nameEn: 'Customs duty' },
      { key: 'appointmentBooking', nameAr: 'حجز الموعد', nameEn: 'Appointment booking' },
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
  // ── قوائمُ قسم التحصيل ─────────────────────────────────────────────────────
  // كلُّ قائمةٍ منسدلةٍ في القسم تُدار من إعداداته. القيمُ قليلةٌ ومعروفة،
  // والكتابةُ الحرّة فيها لا تضيف خيارًا بل صيغةَ كتابةٍ أخرى للشيء نفسِه —
  // فيصير «متأخر» و«متاخر» حالتين في التقرير الواحد.
  ...[
    ['collections_party_type', 'تصنيف الطرف', 'Party Types', [
      { key: 'company', nameAr: 'شركة', nameEn: 'Company' },
      { key: 'establishment', nameAr: 'مؤسسة', nameEn: 'Establishment' },
      { key: 'individual', nameAr: 'فرد', nameEn: 'Individual' },
      { key: 'government', nameAr: 'جهة حكومية', nameEn: 'Government' },
    ]],
    ['collections_payment_terms', 'شروط السداد', 'Payment Terms', [
      { key: 'cash', nameAr: 'نقدي', nameEn: 'Cash' },
      { key: 'net_15', nameAr: '١٥ يوم', nameEn: 'Net 15' },
      { key: 'net_30', nameAr: '٣٠ يوم', nameEn: 'Net 30' },
      { key: 'net_45', nameAr: '٤٥ يوم', nameEn: 'Net 45' },
      { key: 'net_60', nameAr: '٦٠ يوم', nameEn: 'Net 60' },
      { key: 'net_90', nameAr: '٩٠ يوم', nameEn: 'Net 90' },
    ]],
    ['collections_status', 'حالة التحصيل', 'Collection Statuses', [
      { key: 'regular', nameAr: 'منتظم', nameEn: 'Regular' },
      { key: 'late', nameAr: 'متأخر', nameEn: 'Late' },
      { key: 'defaulting', nameAr: 'متعثر', nameEn: 'Defaulting' },
      { key: 'on_hold', nameAr: 'متوقف', nameEn: 'On hold' },
      { key: 'under_review', nameAr: 'تحت المراجعة', nameEn: 'Under review' },
      { key: 'legal', nameAr: 'إجراء قضائي', nameEn: 'Legal action' },
    ]],
    // ── تفصيلُ التحصيل ─────────────────────────────────────────────────────
    // «من أين وصلنا المال؟» سؤالٌ يُسأل عن كلّ كشفٍ نقديّ: قبضه الفرعُ، أو
    // قُبض نقدًا في الطريق، أو ذهب المحصِّلُ إلى العميل فأخذه. وهي ثلاثةٌ اليوم
    // وقد تصير أربعة — فمكانُها قائمةٌ تُدار لا ثلاثةُ أسطرٍ في الشيفرة.
    ['collections_detail', 'تفاصيل التحصيل', 'Collection Details', [
      { key: 'branch', nameAr: 'تحصيل فرع', nameEn: 'Branch collection' },
      { key: 'cash', nameAr: 'تحصيل كاش', nameEn: 'Cash collection' },
      { key: 'customer', nameAr: 'تحصيل عميل', nameEn: 'Customer collection' },
    ]],
    ['collections_channel', 'وسيلة المتابعة', 'Follow-up Channels', [
      { key: 'call', nameAr: 'اتصال', nameEn: 'Call' },
      { key: 'whatsapp', nameAr: 'واتساب', nameEn: 'WhatsApp' },
      { key: 'email', nameAr: 'بريد إلكتروني', nameEn: 'Email' },
      { key: 'visit', nameAr: 'زيارة', nameEn: 'Visit' },
    ]],
    ['collections_city', 'مدن التحصيل', 'Collections Cities', [
      { key: 'riyadh', nameAr: 'الرياض', nameEn: 'Riyadh' },
      { key: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah' },
      { key: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
      { key: 'jazan', nameAr: 'جازان', nameEn: 'Jazan' },
      { key: 'yanbu', nameAr: 'ينبع', nameEn: 'Yanbu' },
      { key: 'rabigh', nameAr: 'رابغ', nameEn: 'Rabigh' },
      { key: 'sudair', nameAr: 'سدير', nameEn: 'Sudair' },
    ]],
  ].map(([type, nameAr, nameEn, seed]) => ({
    type, module: 'collections', nameAr, nameEn,
    roles: ['collections_manager', 'collections_staff', 'cfo', 'accounting_manager'],
    storeLabel: true, seed,
  })),

  // ── النقلُ الخفيف: كلُّ خانةٍ ذاتِ اختياراتٍ ثابتة ──────────────────────────
  // الشيتُ كان يكتبها حرًّا فجاءت الواحدةُ بصيغتين: «كفاله» و«كفالة»، و«دراجه
  // ناريه» و«دراجة نارية»، و«غير مستخدم» و«غيرمستخدم» بلا مسافة. وكلُّ صيغةٍ
  // تصير في التحليل بندًا مستقلًّا، فتُقسَم الأعدادُ على بنودٍ وهميّة.
  //
  // والبذورُ هي القيمُ الموجودةُ فعلًا في الداتا بعد توحيدها عند الاستيراد، لا
  // قائمةٌ مُتخيَّلة — فما في الشاشة هو ما في السجلّ من أوّل يوم.
  ...ltList('lt_project', 'مشاريع النقل الخفيف', 'Light-transport Projects',
    ['كيتا', 'امازون', 'هنجرستيشن', 'نينجا', 'صيانة', '(غير محدد)']),
  ...ltList('lt_city', 'فروع النقل الخفيف', 'Light-transport Branches', ['جدة', 'مكة المكرمة']),
  ...ltList('lt_job_title', 'وظائف النقل الخفيف', 'Light-transport Job Titles',
    ['مندوب', 'مشرف', 'إداري', 'ميكانيكي', 'عامل نظافة']),
  ...ltList('lt_contract_type', 'نوع التعاقد', 'Contract Types', ['كفالة', 'فري لانسر']),
  // ورقمُ السجلّ التجاريّ الذي يكفل الموظّف — و«خارج النظام» لمن ليس على كفالتنا.
  ...ltList('lt_register', 'السجلات التجارية', 'Commercial Registers',
    ['7025667531', '7038387267', '7012953373', 'خارج النظام']),
  ...ltList('lt_vehicle_type', 'أنواع مركبات النقل الخفيف', 'Light-transport Vehicle Types',
    ['دراجة نارية', 'فان', 'كيا', 'كيا بيجاز']),
  ...ltList('lt_work_status', 'حالات العمل', 'Work Statuses', ['يعمل', 'إجازة', 'متوقف', 'إنهاء خدمة']),

  // ── قسمُ الأفراد: تفقُّد بداية الدوام ─────────────────────────────────────
  // حالةُ المركبة تُقال من قائمةٍ لا تُكتب حرًّا: «سليمة» و«سليم» و«تمام» ثلاثةُ
  // نصوصٍ لشيءٍ واحد، فيصير التحليلُ ثلاثةَ أعمدةٍ لحالةٍ واحدة.
  {
    type: 'b2c_vehicle_condition',
    module: 'b2c',
    nameEn: 'Rider Vehicle Condition',
    nameAr: 'حالة مركبة المندوب',
    roles: ['b2c_manager', 'b2c_deputy', 'b2c_project_lead'],
    storeLabel: true,
    seed: [
      { key: 'good', nameAr: 'سليمة', nameEn: 'Good', color: '#16a34a' },
      { key: 'minor', nameAr: 'خدوش بسيطة', nameEn: 'Minor scratches', color: '#f59e0b' },
      { key: 'damaged', nameAr: 'بها تلف', nameEn: 'Damaged', color: '#dc2626' },
      { key: 'unfit', nameAr: 'غير صالحة للعمل', nameEn: 'Unfit for work', color: '#7f1d1d' },
    ],
  },

  // ── قوائمُ ورشة النقل الثقيل والمخزنين ─────────────────────────────────────
  // ماركةُ الكاوتش ومقاسُه ووحدةُ الصنف كانت خاناتٍ حرّة: «ميشلان» و«Michelin»
  // و«ميشلين» ثلاثُ ماركاتٍ في التقرير. فصارت قوائمَ تُدار من إعدادات القسم،
  // ويُضاف إليها من الخانة نفسِها. ومخزنُ النقل الخفيف يقرأ قائمةَ الوحدات ذاتَها.
  ...[
    ['ls2_tire_brand', 'ماركات الكاوتش', 'Tyre brands', []],
    ['ls2_tire_size', 'مقاسات الكاوتش', 'Tyre sizes', []],
    ['ls2_store_unit', 'وحدات أصناف المخزن', 'Store units', [
      { key: 'piece', nameAr: 'قطعة', nameEn: 'Piece' },
      { key: 'litre', nameAr: 'لتر', nameEn: 'Litre' },
    ]],
  ].map(([type, nameAr, nameEn, seed]) => ({
    type, module: 'ls2', nameAr, nameEn,
    roles: ['location_manager', 'location_staff', 'operations_manager', 'it_manager', 'it_specialist', 'vehicles_manager', 'procurement_staff', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'],
    storeLabel: true, seed,
  })),
];

// ── عناوينُ مهامّ خطّة العمل لكلّ قسم (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────────
// المهمّةُ تُختار من قائمة القسم بدل نصٍّ حرٍّ — فتُجمَع في اليوميّة باسمٍ واحد
// («الاجتماع» لا «اجتماع» و«إجتماع»). ويضيف إليها فريقُ القسم من الشاشة نفسِها.
// والبذورُ للموارد البشريّة كما أعطاها صاحبُ الشركة.
const HR_JP_TITLES = [
  'الاجتماع', 'تحديث المنصات', 'شهادة مواءمة', 'ترخيص لوجستي', 'تصريح الدفاع المدني', 'إضافة ٤ سعوديين',
  'مقابلة وظيفية', 'عمل جدول بالسيفيات الجديدة', 'متابعة سكن العاملين', 'متابعة سكن الموظفين', 'متابعة النظافة',
  'وثيقة الدليفري و عقد التشغيل', 'رفع الإجازات', 'موضوع أميرة وهيثم وأحمد قصي', 'جمع بيانات نقل الكفالة',
  'لوحة السيستم كاملة للشؤون الإدارية', 'خطة السوشل ميديا', 'المتدربات', 'لوجستي', 'السكن الجديد', 'المهن',
  'تغيير المهن', 'وضع الـ 67', 'مطابقة داخل النظام وخارج النظام', 'رخص السائقين', 'مطابقة وتحليل', 'تقرير',
  'جدول الحضور', 'جدول التدريب', 'جدول الجرد والمشتريات', 'السيستم', 'متابعة المتطلبات', 'متابعة ومراجعة الأعمال',
];
for (const [slug, def] of Object.entries(require('./jpSections').JP_SECTIONS)) {
  REGISTRY.push({
    type: `jp_task_${slug}`, module: 'jp', nameAr: `مهام خطة العمل — ${def.ar}`, nameEn: `Work-plan tasks — ${def.en}`,
    roles: def.memberRoles, storeLabel: true,
    seed: (slug === 'hr' ? HR_JP_TITLES : []).map((n, i) => ({ key: `t${i + 1}`, nameAr: n, nameEn: n })),
  });
}

const byType = (type) => REGISTRY.find((r) => r.type === type) || null;

// Roles allowed to create/update/delete a given type.
const writeRolesFor = (type) => {
  const entry = byType(type);
  if (entry && entry.superOnly) return ['super_admin'];
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
  await applyDefaultRenames();
  await applyRemovedDefaults();
};

/**
 * ── قيمٌ مبذورةٌ أُزيلت ─────────────────────────────────────────────────────
 * تُعلَّم محذوفةً (شاهدةُ قبر) فتختفي من القائمة ولا يعيدها البذر. والإدخالاتُ
 * القديمةُ التي تحملها في المعاملات تبقى مقروءةً كما هي — الاسمُ ملقوطٌ فيها.
 * لا تمسّ إلّا الصفَّ المبذور (`isSystem`) — ما أضافه المديرُ بيده بمفتاحٍ آخر يبقى.
 */
const REMOVED_DEFAULTS = [
  // بطلب قسم التخليص (٢٠٢٦-١٠-١٩): الإرجاعُ وفاتورتُه يحلّ محلَّهما «التمديد»،
  // و«فاتورة النقل» صارت ثلاثةَ أجزاءٍ لكلٍّ منها بندُه في التكاليف.
  ['customs_payment_stage', 'containersReturned'],
  ['customs_payment_stage', 'returnInvoiceDate'],
  ['customs_payment_stage', 'transportInvoice'],
];
const applyRemovedDefaults = async () => {
  const Lookup = require('../models/Lookup');
  for (const [type, key] of REMOVED_DEFAULTS) {
    await Lookup.updateOne({ type, key, isSystem: true, deleted: { $ne: true } }, { $set: { deleted: true, isActive: false } }).catch(() => {});
  }
};

/**
 * ── اسمٌ افتراضيٌّ صُحِّح ──────────────────────────────────────────────────
 * البذرُ لا يكتب فوق ما في القاعدة، فتصحيحُ اسمٍ في القائمة أعلاه لا يبلغ صفًّا
 * بُذِر من قبل. فيُذكَر التصحيحُ هنا: الصفُّ الذي ما زال يحمل الاسمَ القديمَ
 * **حرفًا بحرف** يأخذ الجديد (ومعه لقطاتُه — راجع services/customsLookupSync)،
 * وما غيّره مديرُ القسم بيده من الإعدادات لا يُمسّ. تُنفَّذ مرّةً ثمّ لا تجد
 * ما تغيّره.
 */
const DEFAULT_RENAMES = [
  // أسماءٌ عامّيّةٌ أو ناقصةٌ في مراحل سداد التخليص — بطلب صاحب الشركة: فصحى.
  ['customs_payment_stage', 'doInvoiceEmailed', 'ميل فاتورة إذن التسليم', 'مراسلة الوكيل بطلب فاتورة إذن التسليم'],
  ['customs_payment_stage', 'doLinkEmailed', 'ميل ربط إذن التسليم', 'مراسلة الوكيل بطلب ربط إذن التسليم'],
  ['customs_payment_stage', 'portFeesPaid', 'سداد الموانى', 'سداد أجور الموانئ'],
  ['customs_payment_stage', 'unloadingFeesPaid', 'سداد التفريغ', 'سداد أجور التفريغ'],
  ['customs_payment_stage', 'containersReturned', 'الإرجاع', 'إرجاع الحاويات'],
];
const applyDefaultRenames = async () => {
  const Lookup = require('../models/Lookup');
  for (const [type, key, from, to] of DEFAULT_RENAMES) {
    const r = await Lookup.updateOne({ type, key, nameAr: from }, { $set: { nameAr: to } });
    if (r.modifiedCount) {
      await require('../services/customsLookupSync').lookupRenamed({ type, key, from, to }).catch(() => {});
    }
  }
};

module.exports = { REGISTRY, byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups, GLOBAL_LOOKUP_ROLES };
