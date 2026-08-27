/**
 * hrFields — كل حقل في ماستر الموارد البشرية، معرَّف مرة واحدة.
 *
 * منه بيتولّد: كروت الداشبورد، صفحة كل مجموعة، الفلاتر، التعديل السريع،
 * وشاشة الانتهاءات. إضافة حقل هنا بتظهر في الأربعة لوحدها.
 *
 * ── «مطلوب» و«غير مطلوب» ────────────────────────────────────────────────────
 * دي مش زينة، دي أهم حاجة في الملف:
 *   required      ناقص و**لازم التيم يجمّعه** — ده شغل مطلوب منهم
 *   not_required  لا ينطبق على الموظف ده — مش نقص أصلاً
 *   none          لا يوجد
 *   filled        مملي فعلاً
 * الخلط بين «مطلوب» و«غير مطلوب» بيخلّي قايمة الشغل بتاعة الموارد البشرية
 * كذب: سعودي مالوش إقامة مش «ناقص إقامة».
 *
 * الحالة دي مخزّنة في `<field>Status` على الموظف عشان تفضل بعد التعديل — أول ما
 * حد يملا الحقل بنشيلها، فالعدّاد بينقص لوحده.
 */

const GROUPS = [
  {
    key: 'identity', ar: 'الهوية والبيانات الشخصية', en: 'Identity', icon: 'user',
    fields: [
      // الرقم الوظيفيّ قابلٌ للفلترة لأنّه يُسأل به مباشرةً: يصل الرقم في ورقةٍ
      // أو رسالة، فيُبحث عن صاحبه. وبغير ذلك يبقى عمودًا يُقرأ ولا يُسأل عنه.
      { key: 'employeeNumber', ar: 'الرقم الوظيفي', en: 'Employee no.', type: 'text', groupable: true },
      { key: 'arabicName', ar: 'الاسم', en: 'Name', type: 'text' },
      { key: 'iqamaNumber', ar: 'رقم الهوية/الإقامة', en: 'ID number', type: 'text' },
      { key: 'idType', ar: 'نوع الهوية', en: 'ID type', type: 'text', groupable: true },
      { key: 'gender', ar: 'الجنس', en: 'Gender', type: 'text', groupable: true },
      { key: 'nationality', ar: 'الجنسية', en: 'Nationality', type: 'text', groupable: true },
      { key: 'dateOfBirth', ar: 'تاريخ الميلاد', en: 'Date of birth', type: 'date' },
    ],
  },
  {
    key: 'contact', ar: 'بيانات التواصل', en: 'Contact', icon: 'phone',
    fields: [
      { key: 'email', ar: 'البريد الشخصي', en: 'Personal email', type: 'text', groupable: true },
      { key: 'companyEmail', ar: 'بريد الشركة', en: 'Company email', type: 'text' },
      { key: 'absherNumber', ar: 'جوال أبشر', en: 'Absher phone', type: 'text', groupable: true },
      { key: 'companyNumber', ar: 'جوال الشركة', en: 'Company phone', type: 'text' },
      { key: 'originCountryNumber', ar: 'جوال بلد الإقامة', en: 'Home-country phone', type: 'text' },
      // العنوان الوطنيّ رمزٌ مكانيّ لا نصٌّ حرّ («JDBE3757»)، فالفلترة به تجمع
      // ساكني المبنى الواحد — وهو سؤالٌ يُسأل عند السكن المشترك والنقل.
      { key: 'address', ar: 'العنوان الوطني', en: 'National address', type: 'text', groupable: true },
    ],
  },
  {
    key: 'employment', ar: 'بيانات التوظيف', en: 'Employment', icon: 'briefcase',
    fields: [
      { key: 'employerNumber', ar: 'رقم صاحب العمل', en: 'Employer no.', type: 'text' },
      { key: 'project', ar: 'وحدة العمل', en: 'Business unit', type: 'text', groupable: true },
      { key: 'department', ar: 'القسم', en: 'Department', type: 'text', groupable: true },
      { key: 'branchName', ar: 'الفرع', en: 'Branch', type: 'text', groupable: true },
      { key: 'directManagerName', ar: 'المدير المباشر', en: 'Line manager', type: 'text', groupable: true },
      { key: 'jobTitle', ar: 'المسمى الوظيفي', en: 'Job title', type: 'text', groupable: true },
      // رقم السجلّ التجاريّ كان هنا، وانتقل إلى مجموعة «السجل والتأمينات
      // الاجتماعية» تحت — لأنّه والتأمينات وجهان لتسجيلٍ واحد، لا حقلان.
      // ولا يجوز أن يُذكر في مجموعتين: `getField` تُرجع أولاهما، وتُبنى منه
      // بطاقتان وفلتران بالمفتاح نفسه فتظهر اللوحة مرّتين لشيءٍ واحد.
      { key: 'workStatusText', ar: 'حالة العمل', en: 'Work status', type: 'text', groupable: true },
      { key: 'systemStatus', ar: 'داخل النظام', en: 'In system', type: 'text', groupable: true },
      { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date', type: 'date' },
      { key: 'isOutsideKingdom', ar: 'خارج المملكة', en: 'Outside kingdom', type: 'bool', groupable: true },
      { key: 'isFreelancer', ar: 'عمل حر', en: 'Freelancer', type: 'bool', groupable: true },
    ],
  },
  {
    // ── السجل والتأمينات الاجتماعية ──────────────────────────────────────────
    // كانت المجموعة رقمًا تأمينيًّا وحده. وملفُّ «السجل و التأمينات الاجتماعية»
    // أظهر أنّ الثلاثة خبرٌ واحد: الموظّف مسجَّلٌ على سجلٍّ تجاريٍّ بعينه، وحالتُه
    // في التأمينات مترتّبةٌ على ذلك التسجيل، ورقمُه التأمينيّ أثرُه. وفي الملفّ
    // نفسه: الخمسة والخمسون الذين لا سجلَّ لهم هم بأعيانهم الخمسة والخمسون
    // الذين تأميناتُهم «غير مطلوبة» — فصلُهما في شاشتين يجعل الجواب نصفين.
    //
    // والمفتاح `socialInsurance` لا `gosi`: الاسم القديم يصف واحدًا من ثلاثة.
    // والقديم يبقى صالحًا في `getGroup` — انظر `GROUP_ALIASES`.
    key: 'socialInsurance', ar: 'السجل والتأمينات الاجتماعية', en: 'Register & social insurance', icon: 'shield',
    fields: [
      // ── ولماذا السجلّ التجاريّ حقلُ موظّف ────────────────────────────────────
      // الشركة تُوظِّف على أكثر من سجلٍّ تجاريّ، والموظّف مسجَّلٌ على واحدٍ بعينه.
      // وهو الذي تُبنى عليه أسئلةُ الجهات: «كم على السجلّ الفلانيّ؟» فبغير حقلٍ
      // قابلٍ للفلترة كان الجواب يُعَدّ باليد من ملفٍّ خارج النظام.
      { key: 'registerNumber', ar: 'رقم السجل التجاري', en: 'Commercial register', type: 'text', groupable: true },
      // حالة التأمينات تسعُ ثلاثَ قيمٍ لا رابعَ لها («نشط»، «غير نشط»)، والثالثة
      // ليست قيمةً بل قرارٌ إداريّ يُكتب عَلَمَ حالةٍ («غير مطلوب») — انظر تحت.
      // وقابليّتُها للفلترة هي بيت القصيد: «مَن ليس نشطًا في التأمينات؟» سؤالٌ
      // يُسأل شهريًّا وكان جوابه يُعَدّ باليد من ملفٍّ خارج النظام.
      { key: 'socialInsuranceStatus', ar: 'حالة التأمينات', en: 'Insurance status', type: 'text', groupable: true },
      // الرقم التأمينيّ فريدٌ لكلّ موظّف، فلا يُعلَّم `groupable`: توزيعُه
      // ثلاثمئةٌ وستّون سطرًا كلٌّ منها «١» — قائمةٌ لا تُقرأ ولا يُفلتَر بها.
      { key: 'gosiNumber', ar: 'الرقم التأميني', en: 'GOSI number', type: 'text' },
    ],
  },
  {
    key: 'banking', ar: 'البيانات البنكية', en: 'Banking', icon: 'bank',
    fields: [
      { key: 'iban', ar: 'الآيبان', en: 'IBAN', type: 'text' },
      { key: 'bank', ar: 'البنك', en: 'Bank', type: 'text', groupable: true },
    ],
  },
  {
    key: 'iqama', ar: 'الإقامات', en: 'Iqama', icon: 'id', document: true,
    expiryField: 'iqamaExpiry',
    fields: [
      { key: 'iqamaIssueDate', ar: 'تاريخ الإصدار', en: 'Issue date', type: 'date' },
      { key: 'iqamaExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
      { key: 'iqamaExpiryHijri', ar: 'الانتهاء (هجري)', en: 'Expiry (Hijri)', type: 'text' },
      { key: 'iqamaProfession', ar: 'المهنة في الإقامة', en: 'Iqama occupation', type: 'text', groupable: true },
    ],
  },
  {
    key: 'passport', ar: 'الجوازات', en: 'Passport', icon: 'passport', document: true,
    expiryField: 'passportExpiry',
    fields: [
      { key: 'passportNumber', ar: 'رقم الجواز', en: 'Passport no.', type: 'text' },
      { key: 'passportExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'contract', ar: 'العقود', en: 'Contracts', icon: 'file', document: true,
    expiryField: 'contractEndDate',
    fields: [
      { key: 'contractStatusText', ar: 'حالة العقد', en: 'Contract status', type: 'text', groupable: true },
      { key: 'qiwaContractNumber', ar: 'رقم عقد قوى', en: 'Qiwa contract no.', type: 'text' },
      { key: 'contractOccupation', ar: 'المهنة في العقد', en: 'Contract occupation', type: 'text', groupable: true },
      { key: 'contractStartDate', ar: 'بداية العقد', en: 'Start', type: 'date' },
      { key: 'contractEndDate', ar: 'نهاية العقد', en: 'End', type: 'date' },
      // ── ولماذا نصٌّ لا رقم ───────────────────────────────────────────────────
      // الفلترة تصل من اللوحة قيمًا نصّية، فحقلٌ رقميٌّ في القاعدة لا يطابق
      // «٢١» أبدًا وتعود الشاشة فارغة. والرقم المُلزِم يبقى في وثيقة العقد
      // (Contract.annualLeaveDays) وهي مرجع حساب رصيد الإجازات؛ وهذا لقطةٌ منه.
      { key: 'annualLeaveDays', ar: 'الإجازة السنوية', en: 'Annual leave days', type: 'text', groupable: true },
      // فترة التجربة «غير مطلوبة» في كل عقود هذا الملف. ووجودُ الحقل هو ما
      // يجعل ذلك قرارًا مكتوبًا لا فراغًا صامتًا يُقرأ لاحقًا نقصًا في البيانات.
      { key: 'probationPeriod', ar: 'فترة التجربة', en: 'Probation', type: 'text', groupable: true },
    ],
  },
  {
    // ── رخص العمل ──────────────────────────────────────────────────────────────
    // مستندٌ حكوميّ له تاريخُ انتهاءٍ مستقلّ عن الإقامة، ويُغرَّم على تأخّره.
    // كان حقلُه في الموظّف موجودًا (`workPermitExpiry`) وخارجَ هذا الملف، فلم
    // يظهر في بطاقةٍ ولا في شاشة الانتهاءات ولا في فلتر — أي أنّ تاريخًا نملكه
    // لم يكن أحدٌ يراه إلا بفتح سجلّ الموظّف واحدًا واحدًا.
    key: 'workPermit', ar: 'رخص العمل', en: 'Work permits', icon: 'license', document: true,
    expiryField: 'workPermitExpiry',
    fields: [
      { key: 'workPermitExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'medicalInsurance', ar: 'التأمين الطبي', en: 'Medical insurance', icon: 'heart', document: true,
    expiryField: 'insuranceExpiry',
    fields: [
      { key: 'insuranceCompany', ar: 'شركة التأمين', en: 'Insurer', type: 'text', groupable: true },
      { key: 'insuranceClass', ar: 'فئة التأمين', en: 'Class', type: 'text', groupable: true },
      { key: 'insuranceExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'healthCertificate', ar: 'الشهادات الصحية', en: 'Health certificate', icon: 'health', document: true,
    expiryField: 'healthCertExpiry',
    fields: [
      { key: 'healthCertNumber', ar: 'رقم الشهادة', en: 'Certificate no.', type: 'text' },
      { key: 'healthCertExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'driverCard', ar: 'بطاقات السائقين', en: 'Driver cards', icon: 'card', document: true,
    expiryField: 'driverCardExpiry',
    fields: [
      { key: 'driverCardStatus', ar: 'توفّر البطاقة', en: 'Availability', type: 'text', groupable: true },
      { key: 'driverCardNumber', ar: 'رقم البطاقة', en: 'Card no.', type: 'text' },
      { key: 'driverCardExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'drivingLicense', ar: 'رخص القيادة', en: 'Driving licences', icon: 'license', document: true,
    expiryField: 'licenseExpiry',
    fields: [
      { key: 'licenseType', ar: 'نوع الرخصة', en: 'Licence type', type: 'text', groupable: true },
      { key: 'licenseExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
];

const GROUP_KEYS = GROUPS.map((g) => g.key);
/**
 * أسماءٌ قديمة لمجموعاتٍ أُعيدت تسميتها.
 *
 * `/system/hr/master/gosi` عنوانٌ محفوظٌ في مفضّلات الناس ومكتوبٌ في روابطَ
 * قديمة. وبغير هذه الخريطة يردّ الخادم «المجموعة غير معروفة» على رابطٍ كان
 * يعمل أمس، ولا شيء في الشاشة يقول لفاتحه إلى أين ذهبت صفحته.
 */
const GROUP_ALIASES = { gosi: 'socialInsurance' };
const getGroup = (key) => GROUPS.find((g) => g.key === (GROUP_ALIASES[key] || key)) || null;
const DOCUMENT_GROUPS = GROUPS.filter((g) => g.document);
const ALL_FIELDS = GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.key, groupAr: g.ar })));
const getField = (key) => ALL_FIELDS.find((f) => f.key === key) || null;
/** اسم حقل الحالة المقابل لأي حقل — الاتفاق: <field>Status. */
const statusKeyOf = (fieldKey) => `${fieldKey}Status`;

const STATUS_LABELS = {
  required: { ar: 'مطلوب', en: 'Required', color: '#dc2626' },
  not_required: { ar: 'غير مطلوب', en: 'Not required', color: '#64748b' },
  none: { ar: 'لا يوجد', en: 'None', color: '#94a3b8' },
  cash_payroll: { ar: 'راتب نقدي', en: 'Cash payroll', color: '#8b5cf6' },
  unparseable: { ar: 'تاريخ غير مقروء', en: 'Unreadable date', color: '#f59e0b' },
  filled: { ar: 'مملي', en: 'Filled', color: '#16a34a' },
};
const statusLabel = (code, lang = 'ar') => (STATUS_LABELS[code || 'filled'] || { ar: code, en: code })[lang === 'en' ? 'en' : 'ar'];

const STATE_LABELS = {
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a' },
  warning: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b' },
  critical: { ar: 'ينتهي قريبًا جدًا', en: 'Critical', color: '#ea580c' },
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626' },
  missing: { ar: 'بدون تاريخ', en: 'No date', color: '#94a3b8' },
  not_applicable: { ar: 'لا ينطبق', en: 'Not applicable', color: '#64748b' },
};

const DAY = 86400000;
const daysLeft = (date, now = new Date()) => {
  if (!date) return null;
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / DAY);
};

/**
 * حالة المستند النهاردة. `not_required` بترجع not_applicable مهما كان التاريخ —
 * موظف مش مطلوب منه رخصة قيادة مش «ناقص رخصة».
 */
const stateOf = (expiry, statusCode, alert = {}, now = new Date()) => {
  if (statusCode === 'not_required' || statusCode === 'none') return { state: 'not_applicable', days: null };
  const days = daysLeft(expiry, now);
  if (days === null) return { state: 'missing', days: null };
  if (days < 0) return { state: 'expired', days };
  const crit = Number(alert.criticalDays ?? 30);
  const warn = Number(alert.warnDays ?? 60);
  if (days <= crit) return { state: 'critical', days };
  if (days <= warn) return { state: 'warning', days };
  return { state: 'valid', days };
};

module.exports = {
  GROUPS, GROUP_KEYS, GROUP_ALIASES, getGroup, DOCUMENT_GROUPS, ALL_FIELDS, getField, statusKeyOf,
  STATUS_LABELS, statusLabel, STATE_LABELS, daysLeft, stateOf,
};
