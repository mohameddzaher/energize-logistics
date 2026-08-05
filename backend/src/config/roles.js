/**
 * roles — الهيكل الوظيفي للشركة: كل قسم له **مدير** و**موظف**، ومكتوب مرة واحدة.
 *
 * القاعدة اللي الملف ده بيفرضها:
 *
 *   ١. كل قسم في config/sections.js له دور مدير ودور موظف على الأقل.
 *   ٢. دور المدير **لازم** ينتهي بـ `_manager`. القاعدة دي مش تسمية جميلة وبس —
 *      `businessReview.isManagerRole` بيعتمد عليها حرفيًا عشان يعرف مين يقعد مع
 *      الإدارة. أي دور موظف بينتهي بـ `_manager` بيبقى مدير بالغلط.
 *   ٣. دور الموظف **ممنوع** ينتهي بـ `_manager`.
 *   ٤. كل دور له اسم عربي وإنجليزي واضح. مفيش مفاتيح مبهمة زي `operations`
 *      لوحدها — مين ده؟ القسم ولا الشخص؟
 *
 * الفحوصات دي بتتنفّذ تحت وقت التحميل، فأي دور جديد يكسر القاعدة بيوقّف السيرفر
 * فورًا بدل ما يعدّي ويظهر كمشكلة صلاحيات غامضة بعد شهر.
 *
 * الأسماء الوظيفية الحقيقية اتسابت زي ما هي — «محاسب» و«مخلّص جمركي» و«مندوب
 * مبيعات» أوضح بكتير من `accounting_staff`. اللي اتغيّر هو المبهم والمصنَّف غلط بس.
 */

// ── أدوار مش تبع قسم معيّن ──────────────────────────────────────────────────
const GLOBAL_ROLES = [
  { key: 'super_admin', ar: 'مدير النظام', en: 'System Administrator' },
  { key: 'admin', ar: 'الإدارة العليا', en: 'Executive Management' },
  { key: 'moderator', ar: 'مشرف عام', en: 'General Supervisor' },
  { key: 'employee', ar: 'موظف', en: 'Employee' },
  // شريك خارجي (عميل أو مورد) — له البوابة، مش أقسام الشركة.
  { key: 'client', ar: 'شريك خارجي', en: 'External Partner' },
];

/**
 * القسم → مديره وموظفوه.
 * `section` لازم يطابق مفتاح في config/sections.js حرفيًا.
 */
const SECTION_ROLES = [
  { section: 'Customers & Finance',
    manager: { key: 'customers_finance_manager', ar: 'مدير العملاء والمالية', en: 'Customers & Finance Manager' },
    staff: [{ key: 'customers_finance_staff', ar: 'موظف العملاء والمالية', en: 'Customers & Finance Officer' }] },

  { section: 'Operations',
    manager: { key: 'operations_manager', ar: 'مدير العمليات', en: 'Operations Manager' },
    staff: [{ key: 'operations_staff', ar: 'موظف العمليات', en: 'Operations Team' }] },

  { section: 'Operations Platform',
    manager: { key: 'ops_platform_manager', ar: 'مدير منصة الأوبريشن', en: 'Operations Platform Manager' },
    staff: [{ key: 'ops_platform_staff', ar: 'موظف منصة الأوبريشن', en: 'Operations Platform Team' }] },

  { section: 'Shipment Orders',
    manager: { key: 'shipment_orders_manager', ar: 'مدير طلبات الشحنات', en: 'Shipment Orders Manager' },
    staff: [{ key: 'shipment_orders_staff', ar: 'موظف طلبات الشحنات', en: 'Shipment Orders Team' }] },

  { section: 'Fleet Management',
    manager: { key: 'fleet_manager', ar: 'مدير الأسطول', en: 'Fleet Manager' },
    staff: [{ key: 'fleet_supervisor', ar: 'مشرف الأسطول', en: 'Fleet Supervisor' }] },

  { section: 'Customs',
    manager: { key: 'customs_manager', ar: 'مدير التخليص الجمركي', en: 'Customs Manager' },
    staff: [{ key: 'customs_officer', ar: 'مخلّص جمركي', en: 'Customs Officer' }] },

  { section: 'Vehicles',
    manager: { key: 'vehicles_manager', ar: 'مدير المركبات والتفاويض', en: 'Vehicles & Authorizations Manager' },
    staff: [{ key: 'vehicles_staff', ar: 'موظف المركبات والتفاويض', en: 'Vehicles & Authorizations Officer' }] },

  { section: 'Location Solutions',
    manager: { key: 'location_manager', ar: 'مدير لوكيشن سوليوشن', en: 'Location Solutions Manager' },
    staff: [{ key: 'location_staff', ar: 'موظف لوكيشن سوليوشن', en: 'Location Solutions Team' }] },

  { section: 'Marketing',
    manager: { key: 'marketing_manager', ar: 'مدير التسويق', en: 'Marketing Manager' },
    staff: [{ key: 'marketing_specialist', ar: 'أخصائي تسويق', en: 'Marketing Specialist' }] },

  { section: 'Business Development',
    manager: { key: 'bd_manager', ar: 'مدير تطوير الأعمال', en: 'Business Development Manager' },
    staff: [{ key: 'bd_specialist', ar: 'أخصائي تطوير الأعمال', en: 'Business Development Specialist' }] },

  { section: 'Software & IT',
    manager: { key: 'it_manager', ar: 'مدير تقنية المعلومات', en: 'IT Manager' },
    staff: [{ key: 'it_specialist', ar: 'أخصائي تقنية المعلومات', en: 'IT Specialist' }] },

  { section: 'Administration',
    manager: { key: 'administration_manager', ar: 'مدير الشؤون الإدارية', en: 'Administration Manager' },
    staff: [{ key: 'administration_staff', ar: 'موظف الشؤون الإدارية', en: 'Administration Officer' }] },

  { section: 'Contracts',
    manager: { key: 'contracts_manager', ar: 'مدير العقود', en: 'Contracts Manager' },
    staff: [{ key: 'contracts_staff', ar: 'موظف العقود', en: 'Contracts Officer' }] },

  { section: 'B2C',
    manager: { key: 'b2c_manager', ar: 'مدير قطاع الأفراد', en: 'B2C Manager' },
    // «مدير مشروع» لقب حقيقي، بس لو المفتاح انتهى بـ `_manager` كان هيبقى عضو في
    // اجتماعات الإدارة بالغلط — فالمفتاح `_lead` واللقب المعروض زي ما هو.
    staff: [{ key: 'b2c_project_lead', ar: 'مدير مشروع - أفراد', en: 'B2C Project Lead' }] },

  { section: 'Workshop',
    manager: { key: 'workshop_manager', ar: 'مدير الورشة', en: 'Workshop Manager' },
    staff: [{ key: 'workshop_employee', ar: 'فني ورشة', en: 'Workshop Technician' }] },

  { section: 'Remote',
    manager: { key: 'remote_manager', ar: 'مدير العمل عن بُعد', en: 'Remote Work Manager' },
    staff: [{ key: 'remote_employee', ar: 'موظف عن بُعد', en: 'Remote Employee' }] },

  { section: 'HR',
    manager: { key: 'hr_manager', ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    staff: [{ key: 'hr_specialist', ar: 'أخصائي موارد بشرية', en: 'HR Specialist' }] },

  { section: 'CRM',
    manager: { key: 'crm_manager', ar: 'مدير إدارة العلاقات', en: 'CRM Manager' },
    staff: [
      { key: 'crm_team_lead', ar: 'قائد فريق العلاقات', en: 'CRM Team Lead' },
      { key: 'crm_specialist', ar: 'أخصائي علاقات', en: 'CRM Specialist' },
      { key: 'crm_agent', ar: 'مندوب علاقات', en: 'CRM Agent' },
    ] },

  { section: 'Sales',
    manager: { key: 'sales_manager', ar: 'مدير المبيعات', en: 'Sales Manager' },
    staff: [{ key: 'sales_rep', ar: 'مندوب مبيعات', en: 'Sales Representative' }] },

  { section: 'Accounting',
    manager: { key: 'finance_manager', ar: 'المدير المالي', en: 'Finance Manager' },
    staff: [{ key: 'accountant', ar: 'محاسب', en: 'Accountant' }] },

  { section: 'Procurement',
    manager: { key: 'procurement_manager', ar: 'مدير المشتريات', en: 'Procurement Manager' },
    staff: [{ key: 'procurement_staff', ar: 'موظف المشتريات', en: 'Procurement Officer' }] },

  // «مراجعة الأعمال» مالهاش مدير ولا موظف عن قصد: هي منتدى بيقعد فيه مديرو كل
  // الأقسام مع الإدارة، فمفيش قسم يملكها. الوصول لها بيتحدد بالدور في القسم
  // بتاعك، مش بدور خاص بيها.
];

// ── مفاتيح جاهزة ────────────────────────────────────────────────────────────
const MANAGER_ROLES = SECTION_ROLES.map((s) => s.manager.key);
const STAFF_ROLES = SECTION_ROLES.flatMap((s) => s.staff.map((x) => x.key));
const ALL_ROLE_DEFS = [
  ...GLOBAL_ROLES,
  ...SECTION_ROLES.flatMap((s) => [s.manager, ...s.staff]),
];
const ALL_ROLES = ALL_ROLE_DEFS.map((r) => r.key);

const LABELS_AR = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const LABELS_EN = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** القسم اللي الدور ده تبعه، أو null للأدوار العامة. */
const sectionOfRole = (role) => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.staff.some((y) => y.key === role));
  return s ? s.section : null;
};

/** الأدوار (مدير + موظفين) اللي بتملك القسم ده. */
const rolesOfSection = (section) => {
  const s = SECTION_ROLES.find((x) => x.section === section);
  return s ? [s.manager.key, ...s.staff.map((y) => y.key)] : [];
};

const isManager = (role) => MANAGER_ROLES.includes(role);
const isStaff = (role) => STAFF_ROLES.includes(role);

// ── أسماء المفاتيح القديمة ──────────────────────────────────────────────────
// اتسابت هنا عشان أي بيانات أو إعدادات قديمة تتقرا صح لو فضلت مخزّنة في مكان
// فاتنا. scripts/migrateRoleKeys.js بيحوّل المستخدمين والصلاحيات.
const RENAMED = {
  operations: 'operations_staff',
  purchasing: 'procurement_staff',
  administrator: 'administration_staff',
  b2c_head: 'b2c_manager',
  b2c_project_manager: 'b2c_project_lead',
};
/** يرجّع المفتاح الحالي لأي دور، حتى لو اتبعت بالاسم القديم. */
const canonicalRole = (role) => RENAMED[role] || role;

// ── الفحوصات ────────────────────────────────────────────────────────────────
// بتتنفّذ وقت التحميل: خطأ هنا يوقّف السيرفر، وده مقصود. دور صلاحياته غلط أخطر
// بكتير من سيرفر مش قايم — السيرفر الواقع بتلاحظه في ثانية.
// ملاحظة: الملف ده **مبيعملش require لـ sections.js**. لو عمل، تبقى دايرة:
// roles → sections → constants → roles، وnode بيرجّع نص وحدة منهم فاضية.
// التأكد إن كل قسم متغطّى بيحصل في sections.js نفسه (assertRolesCoverSections)،
// وهو المكان اللي الاتنين معروفين فيه أصلاً.
(function selfCheck() {
  const problems = [];

  for (const s of SECTION_ROLES) {
    if (!/_manager$/.test(s.manager.key)) problems.push(`دور المدير «${s.manager.key}» لازم ينتهي بـ _manager`);
    if (!s.staff.length) problems.push(`قسم «${s.section}» مفيهوش دور موظف`);
    for (const st of s.staff) {
      if (/_manager$/.test(st.key)) problems.push(`دور الموظف «${st.key}» بينتهي بـ _manager — هيتحسب مدير بالغلط`);
    }
  }
  const dupes = ALL_ROLES.filter((r, i) => ALL_ROLES.indexOf(r) !== i);
  if (dupes.length) problems.push(`مفاتيح مكرّرة: ${[...new Set(dupes)].join(', ')}`);
  for (const r of ALL_ROLE_DEFS) {
    if (!r.ar || !r.en) problems.push(`الدور «${r.key}» ناقصه اسم عربي أو إنجليزي`);
  }
  if (problems.length) {
    throw new Error('config/roles.js — الهيكل الوظيفي غير سليم:\n  · ' + problems.join('\n  · '));
  }
})();

/**
 * كل قسم متغطّى بمدير وموظف؟ بيتنده من sections.js بعد ما الاتنين يتحمّلوا.
 * `exempt` للأقسام اللي مالهاش أدوار عن قصد (مراجعة الأعمال منتدى مشترك).
 */
const assertRolesCoverSections = (sectionKeys, exempt = []) => {
  const covered = new Set(SECTION_ROLES.map((s) => s.section));
  const unknown = SECTION_ROLES.map((s) => s.section).filter((k) => !sectionKeys.includes(k));
  const missing = sectionKeys.filter((k) => !covered.has(k) && !exempt.includes(k));
  const problems = [];
  if (unknown.length) problems.push(`أقسام غير معروفة في roles.js: ${unknown.join(', ')}`);
  if (missing.length) problems.push(`أقسام من غير مدير/موظف: ${missing.join(', ')}`);
  if (problems.length) throw new Error('config/roles.js — ' + problems.join(' · '));
};

module.exports = {
  GLOBAL_ROLES, SECTION_ROLES, assertRolesCoverSections,
  ALL_ROLES, ALL_ROLE_DEFS, MANAGER_ROLES, STAFF_ROLES,
  LABELS_AR, LABELS_EN,
  sectionOfRole, rolesOfSection, isManager, isStaff,
  RENAMED, canonicalRole,
};
