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
const BASE_WRITE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];

const FLEET_ROLES = ['fleet_manager', 'fleet_team_leader', 'operations_manager', 'operations_team_leader', 'operations_staff'];
const SO_ROLES = ['shipment_orders_manager', 'shipment_orders_team_leader', 'shipment_orders_staff', 'shipment_orders_followup', 'operations_manager', 'operations_team_leader', 'operations_staff'];
const VEHICLE_ROLES = ['vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader'];

/**
 * Vehicles section lists: every field with fixed choices is now a list managed from the section settings instead of a free field typed in a thousand ways. See config/vehicleDefaults.js.
 * Stored by Arabic name, not key: fields have held the Arabic text since the first import and filters and exports read it, so this limits what is written without changing what is stored.
 */
const vehicleList = (type, nameAr, nameEn, seed) => ({
  type, module: 'vehicles', nameAr, nameEn, roles: VEHICLE_ROLES, storeLabel: true, seed,
});


const B2C_LOOKUP_ROLES = ['b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'it_team_leader'];
/** A light transport list. Stored by Arabic name, not key: fields have held the Arabic text since import and filters and exports read it, so this limits what is written without changing what is stored. */
const ltList = (type, nameAr, nameEn, seed) => ([{
  type, module: 'b2c', nameAr, nameEn, roles: B2C_LOOKUP_ROLES, storeLabel: true,
  seed: seed.map((name, i) => ({ key: `lt_${type}_${i}`, nameEn: name, nameAr: name, order: i + 1 })),
}]);

const REGISTRY = [
  // Transport type authorized by the driver card; written on creation, and the type derived from his vehicles fills it when empty. See `transportTypeAr` in models/DriverCard.
  // Driver card type was a free field, so 'annual' was typed in several spellings.
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
  // Administration and city: two free fields with no input in the edit form, so filters read them but nothing corrected them. Seeded with what the data actually holds.
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
    { key: 'unused', nameAr: 'غير مستخدمة', nameEn: 'Not in use' },
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
  // Accident reporting party: Najm or Traffic. It was a free field, so 'Najm' was written in twenty-six incidents and the Arabic name in twenty-one, which made them uncountable. See scripts/normalizeReportedVia.js.
  vehicleList('vehicle_reported_via', 'جهة الإبلاغ عن الحادث', 'Accident Reported Via', [
    { key: 'najm', nameAr: 'نجم', nameEn: 'Najm' },
    { key: 'traffic', nameAr: 'المرور', nameEn: 'Traffic police' },
  ]),

  // Fleet management: editable dropdown lists.
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
  // Ready follow-up notes.
  // Eight lines were hard-coded: the supervisor taps one to fill the note field. They are the most-written text each day, and a missing line the team needed ('at customs', 'broke down and load transferred') required a code release. Now a normal list: added, deleted and ordered from the section settings.
  {
    type: 'fleet_followup_note',
    module: 'fleet',
    nameEn: 'Follow-up Quick Notes',
    nameAr: 'ملاحظات المتابعة الجاهزة',
    roles: FLEET_ROLES,
    storeLabel: true,   // The text itself is what is written in the note, not a key standing for it.
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
  // HR lists.
  // These were free text, so one thing had ten spellings ('driver', 'truck driver', a misspelling), which cannot be filtered or counted.
  /**
   * Employee department: a list, not a free field.
   * It was typed freely and the employee files held twenty-eight 'departments': two spellings of the same one, three of B2C, and one that was a person's name. So department could not be filtered or counted and headcount was spread over departments that do not exist.
   * The list is the company's departments as its people know them, not the system sections: every system section has a page, but employees are not distributed by page.
   */
  {
    type: 'hr_department',
    module: 'hr',
    nameEn: 'Departments',
    nameAr: 'الأقسام',
    /**
     * The general manager alone owns this list.
     * Department is chosen from the list on every screen (master, employee file, app), not typed. Adding, deleting or renaming one is for the super admin from reference data. A new name applies to its employees' files (utils/hrLists), and a department with employees cannot be deleted until they are moved.
     */
    superOnly: true,
    roles: [],
    storeLabel: true,
    // Company departments as in employee files after unification (scripts/hrDepartmentsUnify.js): MD and CEO to management, cafe to HR, the 'B2C management' variant to B2C, 'no project' to no department. Old keys remain because performance evaluation reads them.
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
  /** Job category for B2C and heavy transport employees: exactly three; the list belongs to the super admin alone, like departments. */
  /**
   * Freelance and training: values of 'commercial register number' for non-sponsored staff.
   * The field is chosen, not typed: our registers (`hr_register`) plus these two. The employee type is derived from it (utils/hrEngagement).
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
      { key: 'delivery_rep', nameEn: 'Delivery rep', nameAr: 'مندوب توصيل' },
      { key: 'supervisor', nameEn: 'Supervisor', nameAr: 'مشرف' },
    ],
  },
  /**
   * Our commercial registers.
   * 'Sponsored by us' means on one of them. The register is chosen from here when converting a freelancer to our sponsorship (POST /employees/:id/sponsor). The super admin owns the registers.
   */
  {
    type: 'hr_register',
    module: 'hr', nameEn: 'Our commercial registers', nameAr: 'سجلاتنا التجارية',
    superOnly: true, roles: [], storeLabel: true,
    seed: ['7025667531', '7038387267', '7041762761', '7053403049', '7012953373', '7040732641', '7001621395']
      .map((n) => ({ key: `cr_${n}`, nameEn: n, nameAr: n })),
  },
  /**
   * Employee projects (not B2C projects).
   * A B2C employee's project is chosen from `lt_project`, owned by the B2C section; this list is for other employees. The employee file's 'project' choice is both lists together (utils/hrLists).
   */
  // Advertising content companies Media Go shoots for. `energize` is our own company: its request selects light transport vehicles (mediagoAdController).
  {
    type: 'mediago_ad_company',
    module: 'b2c', nameEn: 'Ad content companies', nameAr: 'شركات المحتوى الإعلاني',
    roles: ['b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'it_team_leader'],
    seed: [
      { key: 'energize', nameAr: 'إنرجايز', nameEn: 'Energize' },
      { key: 'hero_mile', nameAr: 'هيرو مايل', nameEn: 'Hero Mile' },
    ],
  },
  {
    type: 'hr_project',
    module: 'hr', nameEn: 'Projects', nameAr: 'المشاريع',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'], storeLabel: true,
    seed: [
      { key: 'heavy_transport', nameEn: 'Heavy Transport', nameAr: 'النقل الثقيل' },
      { key: 'customer_service', nameEn: 'Customer Service', nameAr: 'خدمة عملاء' },
      { key: 'branches', nameEn: 'Branches', nameAr: 'الفروع' },
      { key: 'saudization', nameEn: 'Saudization', nameAr: 'التوطين' },
      { key: 'training', nameEn: 'Training', nameAr: 'التدريب' },
      { key: 'disabilities', nameEn: 'People of Determination', nameAr: 'ذوي الهمم' },
      { key: 'remote_work', nameEn: 'Remote Work', nameAr: 'عمل عن بعد' },
    ],
  },
  // Other employee file fields with limited choices.
  // 'Saudi Arabia' and 'Saudi' are one nationality in two entries, and two labels meant the same 'none'. Seeds are what is actually written in the files, not an imagined list, so the screen matches the record from day one.
  {
    type: 'hr_nationality',
    module: 'hr', nameEn: 'Nationalities', nameAr: 'الجنسيات',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'], storeLabel: true,
    seed: ['السعودية', 'مصر', 'باكستان', 'بنجلاديش', 'الهند', 'اليمن', 'السودان', 'سوريا', 'الأردن', 'الفلبين', 'نيبال', 'سريلانكا']
      .map((n, i) => ({ key: `nat_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_iqama_profession',
    module: 'hr', nameEn: 'Iqama Professions', nameAr: 'المهنة في الإقامة',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'], storeLabel: true,
    seed: ['سائق دراجة نارية', 'عامل دراجة نقل', 'عامل تحميل وتنزيل', 'سائق شاحنة ثقيلة', 'سائق', 'فني', 'محاسب', 'مشرف', 'عامل نظافة', 'غير مطلوب']
      .map((n, i) => ({ key: `prof_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_classification',
    module: 'hr', nameEn: 'Classifications', nameAr: 'التصنيف',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'], storeLabel: true,
    seed: ['A', 'B', 'C', 'E1', 'لا يوجد'].map((n, i) => ({ key: `cls_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_work_location',
    module: 'hr', nameEn: 'Work Locations', nameAr: 'مواقع العمل',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'], storeLabel: true,
    seed: ['جدة', 'مكة المكرمة', 'الرياض', 'الدمام', 'جازان', 'ينبع', 'أبها', 'المدينة المنورة']
      .map((n, i) => ({ key: `loc_${i}`, nameEn: n, nameAr: n })),
  },
  {
    type: 'hr_job_title',
    module: 'hr',
    nameEn: 'Job Titles',
    nameAr: 'المسمّيات الوظيفية',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'],
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
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'],
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
    // Contract status is written on termination.
    // 'Contract status' is an HR file column read to know whether a contract is valid or ended. It was filled only by the import and not by terminating service from the screen, so an employee terminated in the system kept an empty column.
    // It is a list, not free text: free typing would drift into dozens of spellings and become unfilterable and uncountable. A missing option is added from the same list for everyone.
    type: 'hr_contract_status',
    module: 'hr',
    nameEn: 'Contract Status',
    nameAr: 'حالة العقد',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist'],
    storeLabel: true,
    // Uses the contracts page wording, not the import file's.
    // Status is written on the contract itself (`Contract.status`) and the contracts page reads it: valid or ended only, and 'terminated' counts as ended. The import wrote two labels with one meaning into the employee file, which cannot be filtered or counted together. Unified on the contracts page wording because the contract is the document. See utils/contractStatus.
    seed: [
      { key: 'active', nameEn: 'Active', nameAr: 'ساري' },
      { key: 'expired', nameEn: 'Expired', nameAr: 'منتهي' },
      { key: 'none', nameEn: 'None', nameAr: 'لا يوجد' },
    ],
  },
  // Shipment orders lists.
  // The section is a broker: it buys a load from a supplier and sells it to a customer. These are its daily vocabulary, edited from the section settings, not by a code release.
  // Shipment status is a key, not a label: analytics count on `arrived`, alerts fire from `late`, and the external platform uses these same keys. So the ten keys are a contract in code (`utils/shipmentOrderStatuses`) and are never removed from a screen.
  // What is configurable here is the display name, its color, its order and whether it is in use today. An eleventh status can be added and appears in cards and the create form with no release. See `statusVocabulary` in `shipmentOrdersController`.
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
  // Shipment cancellation reasons: a shipment is never cancelled without a reason. The list is managed from the section settings and can be extended from the cancel field itself.
  {
    type: 'so_cancel_reason',
    module: 'shipment_orders',
    nameEn: 'Cancellation reasons',
    nameAr: 'أسباب إلغاء الشحنة',
    roles: SO_ROLES,
    storeLabel: true,
    seed: [
      { key: 'by_driver', nameEn: 'Cancelled by the driver', nameAr: 'إلغاء من السائق' },
      { key: 'by_customer', nameEn: 'Cancelled by the customer', nameAr: 'إلغاء من العميل' },
      { key: 'by_rep', nameEn: 'Cancelled by the representative', nameAr: 'إلغاء من المندوب' },
      // Merged from a second registration of this type, which listed the 'cancelled by customer' label twice.
      { key: 'no_truck', nameEn: 'No truck available', nameAr: 'لا تتوفّر شاحنة' },
      { key: 'price', nameEn: 'Price not agreed', nameAr: 'لم يُتّفق على السعر' },
      { key: 'duplicate', nameEn: 'Duplicate order', nameAr: 'طلب مكرّر' },
    ],
  },
  // Vendors management lists: a carrier's contract stage and its tax classification, as the team's master sheet writes them.
  {
    type: 'vendor_contract_status',
    module: 'vendors',
    nameEn: 'Vendor contract status',
    nameAr: 'حالة التعاقد مع المورد',
    roles: ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'operations_manager', 'operations_team_leader'],
    storeLabel: true,
    seed: [
      { key: 'signed', nameEn: 'Signed', nameAr: 'موقع', color: '#059669', order: 1 },
      { key: 'sent', nameEn: 'Contract sent', nameAr: 'تم ارسال العقد', color: '#2563eb', order: 2 },
      { key: 'following', nameEn: 'Following up', nameAr: 'قيد متابعة', color: '#d97706', order: 3 },
      { key: 'on_hold', nameEn: 'On hold', nameAr: 'معلق', color: '#64748b', order: 4 },
      { key: 'declined_payment', nameEn: 'Declined (payment terms)', nameAr: 'معتذر-سداد', color: '#dc2626', order: 5 },
      { key: 'declined_register', nameEn: 'Declined registration', nameAr: 'معتذر عن التسجيل', color: '#dc2626', order: 6 },
      { key: 'not_contacted', nameEn: 'Not contacted yet', nameAr: 'لم يتم التواصل', color: '#94a3b8', order: 7 },
    ],
  },
  {
    type: 'vendor_tax_class',
    module: 'vendors',
    nameEn: 'Vendor tax classification',
    nameAr: 'التصنيف الضريبي للمورد',
    roles: ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'accounting_manager', 'accounting_team_leader'],
    storeLabel: true,
    seed: [
      { key: 'tax_finance', nameEn: 'Taxed — registered with finance', nameAr: 'ضريبي - مالية', order: 1 },
      { key: 'tax_agreement', nameEn: 'Taxed — by agreement', nameAr: 'ضريبي - اتفاق', order: 2 },
      { key: 'cash', nameEn: 'Cash', nameAr: 'كاش', order: 3 },
      { key: 'unclassified', nameEn: 'Unclassified', nameAr: 'غير مصنف', order: 4 },
    ],
  },
  // Why the vendors team turns a sales request down; picked from this list (searchable), extended in place or from section settings.
  {
    type: 'sr_reject_reason',
    module: 'shipment_orders',
    nameEn: 'Shipment request rejection reasons',
    nameAr: 'أسباب رفض طلب الشحنة',
    roles: [...SO_ROLES, 'vendors_manager', 'vendors_team_leader', 'vendors_staff'],
    storeLabel: true,
    seed: [
      { key: 'no_truck', nameEn: 'No truck available', nameAr: 'لا تتوفّر شاحنة', order: 1 },
      { key: 'price_low', nameEn: 'Selling price below the market', nameAr: 'سعرُ البيع أقلُّ من سعر السوق', order: 2 },
      { key: 'route', nameEn: 'Route not served', nameAr: 'المسارُ غيرُ مخدوم', order: 3 },
      { key: 'truck_type', nameEn: 'Truck type not available', nameAr: 'نوعُ الشاحنة غيرُ متوفّر', order: 4 },
      { key: 'timing', nameEn: 'Pickup time too short', nameAr: 'موعدُ التحميل غيرُ كافٍ', order: 5 },
      { key: 'incomplete', nameEn: 'Request details incomplete', nameAr: 'بياناتُ الطلب ناقصة', order: 6 },
      { key: 'duplicate', nameEn: 'Duplicate request', nameAr: 'طلبٌ مكرّر', order: 7 },
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
    type: 'procurement_category',
    module: 'procurement',
    nameEn: 'Procurement Categories',
    nameAr: 'فئات المشتريات',
    roles: ['procurement_manager', 'procurement_team_leader', 'procurement_staff'],
    seed: procurementDefaults.CATEGORIES,
  },
  {
    type: 'vendor_category',
    module: 'procurement',
    nameEn: 'Vendor Categories',
    nameAr: 'فئات الموردين',
    roles: ['procurement_manager', 'procurement_team_leader', 'procurement_staff', 'operations_manager', 'operations_team_leader', 'operations_staff'],
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
    roles: ['crm_manager', 'crm_team_leader', 'crm_specialist', 'sales_manager', 'sales_team_leader'],
    seed: crmDefaults.INDUSTRIES,
  },
  {
    type: 'crm_source',
    module: 'crm',
    nameEn: 'Lead Sources',
    nameAr: 'مصادر العملاء',
    roles: ['crm_manager', 'crm_team_leader', 'crm_specialist', 'sales_manager', 'sales_team_leader'],
    seed: crmDefaults.SOURCES,
  },
  {
    type: 'crm_company_type',
    module: 'crm',
    nameEn: 'Company Types',
    nameAr: 'أنواع الشركات',
    roles: ['crm_manager', 'crm_team_leader', 'crm_specialist', 'sales_manager', 'sales_team_leader'],
    seed: crmDefaults.COMPANY_TYPES,
  },
  {
    type: 'crm_company_size',
    module: 'crm',
    nameEn: 'Company Sizes',
    nameAr: 'أحجام الشركات',
    roles: ['crm_manager', 'crm_team_leader', 'crm_specialist', 'sales_manager', 'sales_team_leader'],
    seed: crmDefaults.COMPANY_SIZES,
  },
  {
    type: 'asset_type',
    module: 'it',
    nameEn: 'Custody & Store Item Types',
    nameAr: 'أنواع أصناف العهد والمستودع',
    roles: ['it_manager', 'it_team_leader', 'it_specialist', 'hr_manager', 'hr_team_leader', 'hr_specialist'],
    seed: assetDefaults.TYPE_SEED,
  },
  {
    type: 'asset_condition',
    module: 'it',
    nameEn: 'Item Conditions',
    nameAr: 'حالات الأصناف',
    roles: ['it_manager', 'it_team_leader', 'it_specialist', 'hr_manager', 'hr_team_leader', 'hr_specialist'],
    seed: assetDefaults.CONDITION_SEED,
  },
  // Mobile line plans are a managed list.
  // A plan name is written as in the provider contract (e.g. 'Business Ctrl Plus 200'); typing it freely on each line produced seventy-nine spellings of a few plans, with no way to count lines per plan. So it is chosen from a list, and the provider's additions are added to it.
  {
    type: 'telecom_package',
    module: 'hr',
    nameEn: 'Mobile line packages',
    nameAr: 'باقات خطوط الجوّال',
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist', 'it_manager', 'it_team_leader', 'it_specialist'],
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
    roles: ['hr_manager', 'hr_team_leader', 'hr_specialist', 'it_manager', 'it_team_leader', 'it_specialist'],
    seed: [
      { key: 'mobily', nameEn: 'Mobily', nameAr: 'موبايلي' },
      { key: 'stc', nameEn: 'STC', nameAr: 'STC' },
      { key: 'zain', nameEn: 'Zain', nameAr: 'زين' },
    ],
  },
  // Paying branch.
  // It was a free field typed by hand, so typos of the Jeddah name sat beside the correct one and split rows of one branch; the report showed nine branches when there are seven. Now a managed list, chosen not typed.
  // The Arabic name is stored, not the key (`storeLabel`), because twenty thousand rows hold it as text since the first import and filters and exports read it as is.
  {
    type: 'workflow_paying_branch',
    module: 'operations',
    nameEn: 'Paying Branches',
    nameAr: 'الفروع المسدِّدة',
    roles: ['operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'],
    storeLabel: true,
    seed: [
      { key: 'jeddah', nameEn: 'Jeddah', nameAr: 'جدة' },
      { key: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
      { key: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام' },
      { key: 'yanbu', nameEn: 'Yanbu', nameAr: 'ينبع' },
      { key: 'sudair', nameEn: 'Sudair', nameAr: 'سدير' },
      { key: 'rabigh', nameEn: 'Rabigh', nameAr: 'رابغ' },
      { key: 'jazan', nameEn: 'Jazan', nameAr: 'جازان' },
      // Heavy transport is treated as a branch like the others; without it its wallet paid but no branch was written to 'paying branch'. See utils/payingBranch.
      { key: 'heavy_trucks', nameEn: 'Heavy Trucks', nameAr: 'النقل الثقيل' },
    ],
  },
  // Final destination of the sheet.
  // The branch where the sheet ends up. It uses the same branches but answers a different question than who paid: payment can happen at one branch while the file settles at another. Two lists with the same values, not one list for two columns, so each can be managed separately if they diverge.
  {
    type: 'workflow_final_destination',
    module: 'operations',
    nameEn: 'Final Report Destinations',
    nameAr: 'وجهات أمر النقل النهائية',
    roles: ['operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'],
    storeLabel: true,
    seed: [
      { key: 'jeddah', nameEn: 'Jeddah', nameAr: 'جدة' },
      { key: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام' },
      { key: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
      { key: 'jazan', nameEn: 'Jazan', nameAr: 'جازان' },
      { key: 'yanbu', nameEn: 'Yanbu', nameAr: 'ينبع' },
      { key: 'rabigh', nameEn: 'Rabigh', nameAr: 'رابغ' },
      { key: 'sudair', nameEn: 'Sudair', nameAr: 'سدير' },
      { key: 'heavy_trucks', nameEn: 'Heavy Trucks', nameAr: 'النقل الثقيل' },
    ],
  },
  // Customs clearance lists.
  // Port, currency, invoice type and country of origin were free fields typed on every transaction. Their values are few and known, so free typing adds no option, only another spelling of the same thing.
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
    // Payment stages.
    // There were eight fields hard-coded in the schema, so a ninth stage needed a release. Now a list managed from the section settings: a stage is added, named and reordered, and shows on every transaction.
    // `transportInvoice` is special: a transaction cannot be closed before it has a date and an attachment (see `completeClearance`). Its key is read in code, so it stays even if renamed; only the name is editable.
    ['customs_payment_stage', 'مراحل السداد', 'Payment Stages', [
      { key: 'doInvoiceEmailed', nameAr: 'مراسلة الوكيل بطلب فاتورة إذن التسليم', nameEn: 'DO invoice emailed' },
      { key: 'doInvoicePaid', nameAr: 'سداد فاتورة إذن التسليم', nameEn: 'DO invoice paid' },
      { key: 'doLinkEmailed', nameAr: 'مراسلة الوكيل بطلب ربط إذن التسليم', nameEn: 'DO link emailed' },
      { key: 'dutyPaid', nameAr: 'سداد الرسوم الجمركية', nameEn: 'Customs duty paid' },
      { key: 'portFeesPaid', nameAr: 'سداد أجور الموانئ', nameEn: 'Port fees paid' },
      { key: 'unloadingFeesPaid', nameAr: 'سداد أجور التفريغ', nameEn: 'Unloading paid' },
      // Container return and return invoice were removed at the section's request and replaced by extension; the transport invoice became three parts. See REMOVED_DEFAULTS.
      { key: 'extension', nameAr: 'التمديد', nameEn: 'Extension' },
      { key: 'transportPortToCustomer', nameAr: 'فاتورة النقل من الميناء إلى العميل', nameEn: 'Transport: port → customer' },
      { key: 'transportPortToYard', nameAr: 'فاتورة النقل من الميناء إلى الساحة', nameEn: 'Transport: port → yard' },
      { key: 'transportYardToCustomer', nameAr: 'فاتورة النقل من الساحة إلى العميل', nameEn: 'Transport: yard → customer' },
      { key: 'appointmentBooking', nameAr: 'حجز الموعد', nameEn: 'Appointment booking' },
      { key: 'inspection', nameAr: 'أجور أمر النقل', nameEn: 'Inspection fees' },
      { key: 'exitPermit', nameAr: 'تصريح الخروج (الأرضيات)', nameEn: 'Exit permit (demurrage)' },
      { key: 'consolidator', nameAr: 'الدامج', nameEn: 'Consolidator' },
      { key: 'commissions', nameAr: 'عمولات', nameEn: 'Commissions' },
      { key: 'labourExpenses', nameAr: 'مصاريف عمال', nameEn: 'Labour expenses' },
      { key: 'examFees', nameAr: 'أجور الكشف', nameEn: 'Examination fees' },
    ]],
    /**
     * Customer invoice items.
     * Payment stages are what we pay; these are what we invoice the customer at closing. The same item can be in both lists at different prices (the transport invoice is paid at 1800 and invoiced at 2200), so an item's price is taken from here and the cost price is not repeated in the invoice. See utils/customsInvoice.
     */
    // What we bill the customer, typed when invoicing is requested; unrelated to the payment stages (what we pay). The transport invoice is three optional legs (owner, 2026-11-10).
    ['customs_sale_item', 'بنود فاتورة العميل', 'Customer Invoice Items', [
      { key: 'transportPortToCustomer', nameAr: 'فاتورة النقل من الميناء إلى العميل', nameEn: 'Transport: port → customer' },
      { key: 'transportPortToYard', nameAr: 'فاتورة النقل من الميناء إلى الساحة', nameEn: 'Transport: port → yard' },
      { key: 'transportYardToCustomer', nameAr: 'فاتورة النقل من الساحة إلى العميل', nameEn: 'Transport: yard → customer' },
      { key: 'transportYardToAgent', nameAr: 'فاتورة النقل من الساحة إلى الوكيل', nameEn: 'Transport: yard → agent' },
      { key: 'dutyPaid', nameAr: 'التخليص الجمركي', nameEn: 'Customs clearance' },
      { key: 'appointmentBooking', nameAr: 'حجز الموعد', nameEn: 'Appointment booking' },
      { key: 'labourExpenses', nameAr: 'مصاريف عمال', nameEn: 'Labour expenses' },
      { key: 'storageUnloading', nameAr: 'تخزين وتفريغ', nameEn: 'Storage & unloading' },
    ]],
    ['customs_city', 'مدن التخليص', 'Customs Cities', [
      { key: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah' },
      { key: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
      { key: 'riyadh', nameAr: 'الرياض', nameEn: 'Riyadh' },
    ]],
  ].map(([type, nameAr, nameEn, seed]) => ({
    type, module: 'customs', nameAr, nameEn,
    roles: ['customs_manager', 'customs_team_leader', 'customs_officer', 'operations_manager', 'operations_team_leader'],
    storeLabel: true, seed,
  })),
  // Collections section lists.
  // Every dropdown in the section is managed from its settings. Values are few and known, and free typing adds no option, only another spelling of the same thing (two spellings of 'late' become two statuses in one report).
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
    // Collection detail.
    // 'How did the money reach us?' is asked for every cash sheet: the branch received it, it was collected in cash on the road, or the collector went to the customer and took it. Three today, possibly four, so it belongs in a managed list, not three lines in code.
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
    roles: ['collections_manager', 'collections_team_leader', 'collections_staff', 'cfo', 'accounting_manager', 'accounting_team_leader'],
    storeLabel: true, seed,
  })),

  // Light transport: every field with fixed choices.
  // The sheet typed them freely so one value had two spellings (sponsorship, motorbike, 'not used' with or without a space). Each spelling becomes a separate item in analysis, splitting counts across phantom items.
  // Seeds are the values actually in the data after unification at import, not an imagined list, so the screen matches the record from day one.
  ...ltList('lt_project', 'مشاريع النقل الخفيف', 'Light-transport Projects',
    ['كيتا', 'امازون', 'هنجرستيشن', 'نينجا', 'صيانة', '(غير محدد)']),
  ...ltList('lt_city', 'فروع النقل الخفيف', 'Light-transport Branches', ['جدة', 'مكة المكرمة']),
  ...ltList('lt_job_title', 'وظائف النقل الخفيف', 'Light-transport Job Titles',
    ['مندوب', 'مشرف', 'إداري', 'ميكانيكي', 'عامل نظافة']),
  ...ltList('lt_contract_type', 'نوع التعاقد', 'Contract Types', ['كفالة', 'فري لانسر']),
  // The commercial register number that sponsors the employee; 'outside the system' for those not on our sponsorship.
  ...ltList('lt_register', 'السجلات التجارية', 'Commercial Registers',
    ['7025667531', '7038387267', '7012953373', 'خارج النظام']),
  ...ltList('lt_vehicle_type', 'أنواع مركبات النقل الخفيف', 'Light-transport Vehicle Types',
    ['دراجة نارية', 'فان', 'كيا', 'كيا بيجاز']),
  ...ltList('lt_work_status', 'حالات العمل', 'Work Statuses', ['يعمل', 'إجازة', 'متوقف', 'إنهاء خدمة']),

  // Individuals section: start-of-shift check.
  // Vehicle condition is chosen from a list, not typed: three spellings of 'sound' would become three analysis columns for one condition.
  {
    type: 'b2c_vehicle_condition',
    module: 'b2c',
    nameEn: 'Rider Vehicle Condition',
    nameAr: 'حالة مركبة المندوب',
    roles: ['b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'],
    storeLabel: true,
    seed: [
      { key: 'good', nameAr: 'سليمة', nameEn: 'Good', color: '#16a34a' },
      { key: 'minor', nameAr: 'خدوش بسيطة', nameEn: 'Minor scratches', color: '#f59e0b' },
      { key: 'damaged', nameAr: 'بها تلف', nameEn: 'Damaged', color: '#dc2626' },
      { key: 'unfit', nameAr: 'غير صالحة للعمل', nameEn: 'Unfit for work', color: '#7f1d1d' },
    ],
  },

  // Heavy transport workshop and store lists.
  // Tire brand, size and item unit were free fields: three spellings of Michelin were three brands in the report. Now lists managed from the section settings and extendable from the field itself. The light transport store reads the same units list.
  ...[
    ['ls2_tire_brand', 'ماركات الكاوتش', 'Tyre brands', []],
    ['ls2_tire_size', 'مقاسات الكاوتش', 'Tyre sizes', []],
    ['ls2_store_unit', 'وحدات أصناف المخزن', 'Store units', [
      { key: 'piece', nameAr: 'قطعة', nameEn: 'Piece' },
      { key: 'litre', nameAr: 'لتر', nameEn: 'Litre' },
    ]],
    // Rim types on the tire side (models/Ls2Rim): brand and size are lists so a new rim is added from the field, not in code.
    ['ls2_rim_brand', 'أنواع الجنوط', 'Rim brands', [
      { key: 'chinese', nameAr: 'صيني', nameEn: 'صيني' },
    ]],
    ['ls2_rim_size', 'مقاسات الجنوط', 'Rim sizes', [
      { key: 'r315', nameAr: '315', nameEn: '315' },
      { key: 'r385', nameAr: '385', nameEn: '385' },
    ]],
  ].map(([type, nameAr, nameEn, seed]) => ({
    type, module: 'ls2', nameAr, nameEn,
    roles: ['location_manager', 'location_team_leader', 'location_staff', 'operations_manager', 'operations_team_leader', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader', 'procurement_staff', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'],
    storeLabel: true, seed,
  })),
];

// Work-plan task titles per section.
// A task is chosen from the section list instead of free text, so the daily log groups it under one name (not several spellings of 'meeting'). The section team adds to it from the same screen. HR seeds are as given by the owner.
const HR_JP_TITLES = [
  'الاجتماع', 'تحديث المنصات', 'شهادة مواءمة', 'ترخيص لوجستي', 'تصريح الدفاع المدني', 'إضافة ٤ سعوديين',
  'مقابلة وظيفية', 'عمل جدول بالسيفيات الجديدة', 'متابعة سكن العاملين', 'متابعة سكن الموظفين', 'متابعة النظافة',
  'وثيقة الدليفري و عقد التشغيل', 'رفع الإجازات', 'موضوع أميرة وهيثم وأحمد قصي', 'جمع بيانات نقل الكفالة',
  'لوحة السيستم كاملة للشؤون الإدارية', 'خطة السوشل ميديا', 'المتدربات', 'لوجستي', 'السكن الجديد', 'المهن',
  'تغيير المهن', 'وضع الـ 67', 'مطابقة داخل النظام وخارج النظام', 'رخص السائقين', 'مطابقة وتحليل', 'تقرير',
  'جدول الحضور', 'جدول التدريب', 'جدول الجرد والمشتريات', 'السيستم', 'متابعة المتطلبات', 'متابعة ومراجعة الأعمال',
];
// Each section has its own work tasks: seeds from each section's workflow as it is in the system, editable and extendable from the section settings (and added from the task field itself).
// Keys `s1...` are separate from the HR seeds `t1...` so they do not collide, and seeding does not restore deleted ones.
const SECTION_JP_TITLES = {
  operations: ['مراجعة تقارير اليوم', 'متابعة سند لم يصل', 'متابعة شحنة في الطريق', 'إدخال تقارير جديدة', 'مطابقة قيمة الشراء', 'رفع الفواتير', 'متابعة مبلغ السداد', 'تحديث حالة الطلبات', 'التنسيق مع السائقين', 'مراجعة الملغاة'],
  collections: ['متابعة فاتورة متأخّرة', 'اتصال بعميل للتحصيل', 'إرسال كشف حساب', 'تسجيل دفعة مستلمة', 'مطابقة فواتير التحصيل', 'متابعة عميل تجاوز حدّ الائتمان', 'تسليم فواتير للعميل', 'تقرير التحصيل الأسبوعي'],
  ops: ['مراجعة طلبات المنصّة', 'متابعة السائقين النشطين', 'حلّ مشكلة على المنصّة', 'تحديث بيانات مستخدم', 'متابعة طلب متعثّر', 'تقرير المنصّة اليومي'],
  'shipment-orders': ['إنشاء طلب شحنة', 'متابعة شحنة', 'إرسال البوليصة', 'التواصل مع العميل', 'تأكيد التسليم', 'متابعة إلغاء', 'تحديث أسعار المسارات', 'إسناد سائق ومركبة'],
  vendors: ['إكمال طلبات المبيعات', 'متابعة مورد متوقف', 'إرسال عقد لمورد', 'استكمال ملف مورد', 'تسجيل مورد جديد في الماستر', 'مراجعة سعر أعلى من المعتمد', 'توحيد اسم مورد', 'تحديث قائمة الأسعار المعتمدة', 'التواصل مع سائق فرد', 'تقرير التشغيل اليومي'],
  fleet: ['متابعة رحلة', 'متابعة السائق كل ٣ ساعات', 'تبديل سائق', 'إصدار بوليصة', 'متابعة صيانة شاحنة', 'تقرير الأسطول اليومي', 'تنسيق التحميل', 'تأكيد التسليم'],
  customs: ['متابعة الوكيل', 'طلب إذن التسليم', 'متابعة الفسح', 'رفع البيان الجمركي', 'دفع الرسوم', 'حجز الناقل', 'متابعة النقل', 'طلب الفوترة', 'تحصيل المستندات من العميل', 'إغلاق المعاملة'],
  vehicles: ['تجديد استمارة', 'تجديد تأمين', 'إصدار تفويض', 'نقل تفويض', 'إلغاء تفويض', 'متابعة حادث', 'متابعة مطالبة تأمين', 'فحص دوري', 'تسليم مركبة', 'استلام مركبة'],
  ls2: ['صيانة دورية', 'تغيير كاوتش', 'متابعة تنبيه حرج', 'جرد المخزن', 'طلب قطع غيار', 'متابعة إصلاح', 'تحديث عدّاد', 'تقرير الورشة'],
  marketing: ['منشور سوشيال ميديا', 'تصميم إعلان', 'إطلاق حملة', 'متابعة نتائج حملة', 'تقرير التسويق', 'تحديث الموقع', 'تجهيز محتوى', 'تنسيق مع Media Go'],
  bd: ['دراسة فرصة', 'إعداد عرض سعر', 'اجتماع مع عميل محتمل', 'متابعة مناقصة', 'زيارة شريك', 'تحليل سوق', 'متابعة عرض مُرسَل'],
  it: ['حلّ تذكرة', 'تجهيز جهاز موظّف', 'إنشاء حساب', 'إيقاف حساب', 'نسخ احتياطي', 'تحديث النظام', 'صيانة شبكة', 'جرد العهد'],
  administration: ['متابعة معاملة حكومية', 'تجديد سجل تجاري', 'تجديد ترخيص', 'حجز اجتماع', 'مراسلة جهة', 'متابعة السكن', 'طلب مستلزمات مكتب', 'أرشفة مستندات'],
  contracts: ['مراجعة عقد مورّد', 'تجديد عقد', 'تحليل استخدام مورّد', 'تفاوض على سعر', 'إضافة مورّد محتمل', 'متابعة توقيع', 'تقرير العقود'],
  b2c: ['تفقّد بداية الدوام', 'متابعة مندوب', 'متابعة أوردرات اليوم', 'تسليم مركبة لمندوب', 'استلام مركبة من مندوب', 'متابعة حادث مندوب', 'متابعة سكن المناديب', 'تجهيز تقرير المشروع', 'متابعة العهدة', 'تنسيق مع Media Go'],
  remote: ['تقرير يومي', 'متابعة مهمّة عن بُعد', 'اجتماع الفريق', 'مراجعة الحضور', 'متابعة طلب إجازة'],
  crm: ['اتصال متابعة', 'زيارة عميل', 'إرسال عرض', 'تحديث بيانات عميل', 'متابعة شكوى عميل', 'تقييم عميل', 'اجتماع مع عميل'],
  sales: ['اتصال بعميل محتمل', 'إرسال عرض سعر', 'متابعة صفقة', 'زيارة عميل', 'إغلاق صفقة', 'تحديث المستهدف', 'تقرير المبيعات'],
  accounting: ['قيد يومية', 'مطابقة بنكية', 'صرف دفعة تخليص', 'إصدار فاتورة', 'مراجعة فاتورة مورّد', 'إقفال يومي للمحفظة', 'تقرير مالي', 'متابعة طلب صرف'],
  procurement: ['طلب عروض أسعار', 'مقارنة عروض', 'إصدار أمر شراء', 'متابعة توريد', 'استلام مشتريات', 'تقييم مورّد', 'جرد'],
};
for (const [slug, def] of Object.entries(require('./jpSections').JP_SECTIONS)) {
  REGISTRY.push({
    type: `jp_task_${slug}`, module: 'jp', nameAr: `مهام خطة العمل — ${def.ar}`, nameEn: `Work-plan tasks — ${def.en}`,
    roles: def.memberRoles, storeLabel: true,
    seed: slug === 'hr'
      ? HR_JP_TITLES.map((n, i) => ({ key: `t${i + 1}`, nameAr: n, nameEn: n }))
      : (SECTION_JP_TITLES[slug] || []).map((n, i) => ({ key: `s${i + 1}`, nameAr: n, nameEn: n })),
  });
}

const byType = (type) => REGISTRY.find((r) => r.type === type) || null;

// Roles allowed to create/update/delete a given type.
const writeRolesFor = (type) => {
  const entry = byType(type);
  if (entry && entry.superOnly) return ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];
  return [...BASE_WRITE_ROLES, ...((entry && entry.roles) || [])];
};

const canManage = (type, role) => writeRolesFor(type).includes(role);

/**
 * The lists of this role: only those it owns.
 * They used to be returned in full tagged `canManage`, so a fleet manager opening the page saw HR, procurement and vehicles lists, and searched for his own among what does not concern him. He could not edit them (the server blocks it), but he could read them. This is organization more than security: a list lives with its section.
 * Top management and IT see all, being owners of the general page; every other role sees only what it can edit. `all` keeps the door open for anyone who needs the full list on purpose.
 */
const GLOBAL_LOOKUP_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];

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
      // Includes deleted entries that have a tombstone: a tombstone means 'removed on purpose', so they are not restored.
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
  await ensureListOrder();
};

/**
 * Lists the owner fixed by name and order: each name exists and is active (an earlier deleted row is revived, not duplicated) and sits in this order.
 */
const FIXED_LISTS = {
  hr_staff_category: ['سائق', 'مندوب توصيل', 'إداري', 'فني', 'مشرف'],
};
const ensureListOrder = async () => {
  const Lookup = require('../models/Lookup');
  const fold = (x) => String(x || '').trim().replace(/[إأآ]/g, 'ا');
  for (const [type, names] of Object.entries(FIXED_LISTS)) {
    const rows = await Lookup.find({ type }).lean();
    for (let i = 0; i < names.length; i++) {
      const hits = rows.filter((r) => fold(r.nameAr) === fold(names[i]));
      const row = hits.find((r) => !r.deleted) || hits[0];
      const seed = (REGISTRY.find((e) => e.type === type)?.seed || []).find((x) => x.nameAr === names[i]);
      if (row) {
        await Lookup.updateOne({ _id: row._id }, { $set: { deleted: false, isActive: true, order: i } });
      } else {
        // A taken key (another name under it) gets a fresh one rather than failing the boot.
        await Lookup.create({ type, key: seed?.key || `${type}_${i}`, nameAr: names[i], nameEn: seed?.nameEn || names[i], order: i, isActive: true, isSystem: true })
          .catch(() => Lookup.create({ type, key: `${type}_${i}_${Date.now().toString(36)}`, nameAr: names[i], nameEn: seed?.nameEn || names[i], order: i, isActive: true, isSystem: true }));
      }
    }
  }
};

/**
 * Removed seeded values.
 * Marked deleted (tombstone) so they disappear from the list and seeding does not bring them back. Old entries that carry them in transactions stay readable as they are, since the name is captured in them. Only the seeded row (`isSystem`) is touched; anything the manager added by hand under another key stays.
 */
const REMOVED_DEFAULTS = [
  // Customs section change: return and its invoice are replaced by extension, and the transport invoice became three parts, each with its own cost item.
  ['customs_payment_stage', 'containersReturned'],
  ['customs_payment_stage', 'returnInvoiceDate'],
  ['customs_payment_stage', 'transportInvoice'],
  // The single customer transport line became three optional legs; requests already sent keep their stored label.
  ['customs_sale_item', 'transportInvoice'],
  // so_cancel_reason was registered twice: 'customer' duplicated 'by_customer' (cancelled by customer). Orders store the label, so retiring the key changes no saved shipment.
  ['so_cancel_reason', 'customer'],
];
const applyRemovedDefaults = async () => {
  const Lookup = require('../models/Lookup');
  for (const [type, key] of REMOVED_DEFAULTS) {
    await Lookup.updateOne({ type, key, isSystem: true, deleted: { $ne: true } }, { $set: { deleted: true, isActive: false } }).catch(() => {});
  }
};

/**
 * Default name corrected.
 * Seeding does not overwrite what is in the database, so renaming above does not reach an already seeded row. The correction is listed here: a row still holding the old name exactly gets the new one (with its snapshots, see services/customsLookupSync), and anything the section manager changed by hand in settings is untouched. It runs once and then finds nothing to change.
 */
const DEFAULT_RENAMES = [
  // Colloquial or incomplete names in customs payment stages, replaced with standard Arabic.
  ['customs_payment_stage', 'doInvoiceEmailed', 'ميل فاتورة إذن التسليم', 'مراسلة الوكيل بطلب فاتورة إذن التسليم'],
  ['customs_payment_stage', 'doLinkEmailed', 'ميل ربط إذن التسليم', 'مراسلة الوكيل بطلب ربط إذن التسليم'],
  ['customs_payment_stage', 'portFeesPaid', 'سداد الموانى', 'سداد أجور الموانئ'],
  ['customs_payment_stage', 'unloadingFeesPaid', 'سداد التفريغ', 'سداد أجور التفريغ'],
  ['customs_payment_stage', 'containersReturned', 'الإرجاع', 'إرجاع الحاويات'],
  // The invoice line is our clearance service, billed on its own — not the duty we pay.
  ['customs_sale_item', 'dutyPaid', 'الرسوم الجمركية', 'التخليص الجمركي', 'Customs clearance'],
];
const applyDefaultRenames = async () => {
  const Lookup = require('../models/Lookup');
  for (const [type, key, from, to, toEn] of DEFAULT_RENAMES) {
    const r = await Lookup.updateOne({ type, key, nameAr: from }, { $set: { nameAr: to, ...(toEn ? { nameEn: toEn } : {}) } });
    if (r.modifiedCount) {
      await require('../services/customsLookupSync').lookupRenamed({ type, key, from, to }).catch(() => {});
    }
  }
};

module.exports = { REGISTRY, byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups, GLOBAL_LOOKUP_ROLES };
