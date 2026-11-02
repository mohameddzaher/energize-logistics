/**
 * hrFields: every HR master field, defined once; generates dashboard cards, group pages, filters, quick edit and the expiries screen.
 * States: required (missing, team must collect), not_required (does not apply, not a gap), none, filled (a value is written). Mixing required with not_required makes the HR worklist wrong.
 * Stored in `<field>Status` on the employee so it survives edits; filling the field clears it.
 */

/** Numeric field: zero counts as empty. Amount columns default to 0 in the schema, so a zero there was never typed; it reads null and counts as 'none', not 'filled' (matches `filledExpr` in utils/hrCounts). */
function numberField(key, ar, en, extra = {}) {
  return {
    key, ar, en, type: 'number', ...extra,
    readFrom: (e) => { const n = Number(e?.[key]); return Number.isFinite(n) && n !== 0 ? n : null; },
  };
}

const GROUPS = [
  {
    key: 'identity', ar: 'الهوية والبيانات الشخصية', en: 'Identity', icon: 'user',
    fields: [
      // The employee number is filterable because it is looked up directly: a number arrives on a paper or message and the owner is searched for.
      { key: 'employeeNumber', ar: 'الرقم الوظيفي', en: 'Employee no.', type: 'text', groupable: true },
      { key: 'arabicName', ar: 'الاسم', en: 'Name', type: 'text' },
      // The ID number lives in two columns: Saudis in `nationalId`, residents in `iqamaNumber`, while the field here is one 'ID/iqama number'. Reading one column reads half the people (an employee with an ID would show as 'none' and count as missing).
      // Both columns are read, and writes go to the column matching the ID type, the same rule as the file form, so the screens agree.
      { key: 'iqamaNumber', ar: 'رقم الهوية/الإقامة', en: 'ID number', type: 'text',
        readFrom: (e) => (e?.idType === 'national_id'
          ? (e?.nationalId || e?.iqamaNumber) : (e?.iqamaNumber || e?.nationalId)),
        writeTo: (e) => (e?.idType === 'national_id' ? 'nationalId' : 'iqamaNumber'),
        alsoSearch: ['nationalId'], deps: ['idType', 'nationalId'] },
      { key: 'idType', ar: 'نوع الهوية', en: 'ID type', type: 'text', groupable: true },
      { key: 'gender', ar: 'الجنس', en: 'Gender', type: 'text', groupable: true },
      // Nationality, city and project are also closed lists (`strict`), see utils/hrLists.
      { key: 'nationality', ar: 'الجنسية', en: 'Nationality', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_nationality' },
      { key: 'dateOfBirth', ar: 'تاريخ الميلاد', en: 'Date of birth', type: 'date' },
    ],
  },
  {
    key: 'contact', ar: 'بيانات التواصل', en: 'Contact', icon: 'phone',
    fields: [
      { key: 'email', ar: 'البريد الشخصي', en: 'Personal email', type: 'text', groupable: true },
      { key: 'companyEmail', ar: 'بريد الشركة', en: 'Company email', type: 'text' },
      // Personal mobile; copied to the light transport record and the authorization sheet (utils/employeeIdentitySync).
      { key: 'phone', ar: 'رقم الجوال', en: 'Mobile', type: 'text' },
      { key: 'absherNumber', ar: 'جوال أبشر', en: 'Absher phone', type: 'text', groupable: true },
      { key: 'absherStatus', ar: 'حالة أبشر', en: 'Absher status', type: 'text', groupable: true, choice: true },
      { key: 'companyNumber', ar: 'جوال الشركة', en: 'Company phone', type: 'text' },
      { key: 'originCountryNumber', ar: 'جوال بلد الإقامة', en: 'Home-country phone', type: 'text' },
      { key: 'emergencyContactName', ar: 'اسم جهة اتصال الطوارئ', en: 'Emergency contact name', type: 'text' },
      { key: 'emergencyContactPhone', ar: 'جوال جهة اتصال الطوارئ', en: 'Emergency contact phone', type: 'text' },
      // The national address is a spatial code (e.g. 'JDBE3757'), not free text, so filtering by it groups residents of one building; asked for shared housing and transport.
      { key: 'address', ar: 'العنوان الوطني', en: 'National address', type: 'text', groupable: true },
    ],
  },
  {
    key: 'employment', ar: 'بيانات التوظيف', en: 'Employment', icon: 'briefcase',
    fields: [
      { key: 'employerNumber', ar: 'رقم صاحب العمل', en: 'Employer no.', type: 'text' },
      // A B2C employee's project comes from the B2C record and is written there (models/LightTransport, utils/hrLists).
      { key: 'project', ar: 'المشروع', en: 'Project', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_project' },
      // Department comes only from the department list, no 'other' or free typing (utils/hrLists).
      { key: 'department', ar: 'القسم', en: 'Department', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_department' },
      // For B2C and heavy transport employees only: administrative, driver, technician (utils/hrLists.categoryError).
      { key: 'staffCategory', ar: 'الفئة الوظيفية', en: 'Staff category', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_staff_category' },
      // 'Branch' in the import file is the city (Jeddah, Makkah...), so every screen calls it 'city'.
      { key: 'branchName', ar: 'المدينة', en: 'City', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_work_location' },
      // Work location comes from the same city list (hr_work_location), a closed list like city.
      { key: 'workLocation', ar: 'مكان العمل', en: 'Work location', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_work_location' },
      { key: 'directManagerName', ar: 'المدير المباشر', en: 'Line manager', type: 'text', groupable: true },
      { key: 'jobTitle', ar: 'المسمى الوظيفي', en: 'Job title', type: 'text', groupable: true },
      { key: 'sponsorName', ar: 'الكفيل', en: 'Sponsor', type: 'text', groupable: true, choice: true },
      { key: 'classification', ar: 'التصنيف', en: 'Classification', type: 'text', groupable: true, choice: true },
      { key: 'fileStatus', ar: 'حالة الملف', en: 'File status', type: 'text', groupable: true, choice: true },
      // The commercial register number lives in the 'register and social insurance' group below, since it and insurance are two faces of one registration. It must not appear in two groups: `getField` returns the first, and two cards and two filters would be built from the same key.
      { key: 'workStatusText', ar: 'حالة العمل', en: 'Work status', type: 'text', groupable: true },
      { key: 'systemStatus', ar: 'داخل النظام', en: 'In system', type: 'text', groupable: true },
      { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date', type: 'date' },
      // Actual first day at work; kept across contract renewals (models/Employee).
      { key: 'actualWorkStartDate', ar: 'تاريخ مباشرة العمل', en: 'Work start date', type: 'date' },
      // Vehicle is read, not written: a snapshot of the vehicle register (`VehicleMaster.authorizedPerson`) written only by utils/vehicleAuthorization.refreshPlateSnapshot. Shown and counted here; the server rejects writes (`readOnly`). Authorization is changed from the vehicle register.
      { key: 'vehiclePlate', ar: 'المركبة (من سجل المركبات)', en: 'Vehicle (from registry)', type: 'text', readOnly: true },
      { key: 'notes', ar: 'ملاحظات', en: 'Notes', type: 'text' },
      { key: 'isOutsideKingdom', ar: 'خارج المملكة', en: 'Outside kingdom', type: 'bool', groupable: true },
      // Type shown beside the profession on every screen: sponsored or freelance.
      // The type is read from the commercial register, not written: a separate field was rarely filled, so freelancers showed 'none'. Freelance, training, or a register number means sponsored by us.
      { key: 'employmentType', ar: 'النوع', en: 'Engagement type', type: 'text', derived: true, deps: ['registerNumber'],
        readFrom: (e) => {
          const r = String(e?.registerNumber ?? '').trim();
          if (!r) return null;
          const k = require('../utils/hrEngagement').engagementOf(e);
          if (k === 'freelance') return 'فري لانسر';
          if (k === 'trainee') return 'تدريب';
          if (k === 'sponsored') return `على الكفالة — السجل ${r}`;
          return r;
        } },
      { key: 'isFreelancer', ar: 'عمل حر', en: 'Freelancer', type: 'bool', groupable: true },
    ],
  },
  {
    // Register and social insurance.
    // The group was only an insurance number, but the three are one fact: the employee is registered on a specific commercial register, insurance status follows that registration, and the insurance number is its result. The employees with no register are exactly those whose insurance is 'not required', so splitting screens gives half answers.
    // The key is `socialInsurance`, not `gosi`; the old key still works in `getGroup` (see `GROUP_ALIASES`).
    key: 'socialInsurance', ar: 'السجل والتأمينات الاجتماعية', en: 'Register & social insurance', icon: 'shield',
    fields: [
      // Why the commercial register is an employee field: the company hires under several registers and each employee is on one. Authorities ask 'how many on register X?', which needs a filterable field.
      // Chosen from the commercial registers list, not typed (see utils/hrLists).
      { key: 'registerNumber', ar: 'رقم السجل التجاري', en: 'Commercial register', type: 'text', groupable: true, choice: true, strict: true, lookup: 'hr_register' },
      // Insurance status holds three values; the third is an administrative decision stored as a status flag ('not required'), see below.
      // Filterable because 'who is not active in insurance?' is asked monthly.
      { key: 'socialInsuranceStatus', ar: 'حالة التأمينات', en: 'Insurance status', type: 'text', groupable: true, choice: true },
      // The insurance number is unique per employee, so it is not `groupable`: its distribution is hundreds of rows of 1, an unreadable list.
      { key: 'gosiNumber', ar: 'الرقم التأميني', en: 'GOSI number', type: 'text' },
    ],
  },
  {
    key: 'banking', ar: 'البيانات البنكية', en: 'Banking', icon: 'bank',
    fields: [
      { key: 'iban', ar: 'الآيبان', en: 'IBAN', type: 'text' },
      // A list, not free text, with a 'cash salary' option: someone paid in cash has no bank, an administrative decision recorded as a flag (cash_payroll) rather than an invented bank name.
      { key: 'bank', ar: 'البنك', en: 'Bank', type: 'text', groupable: true, choice: true, cashPayroll: true },
    ],
  },
  {
    // Salary and allowances.
    // A snapshot for display and editing; the active contract is the reference. Zero in these columns is the schema default, not a typed amount, so it reads as empty (`numberField`); otherwise every employee would count as 'filled'.
    key: 'compensation', ar: 'الراتب والبدلات', en: 'Salary & allowances', icon: 'wallet',
    fields: [
      numberField('basicSalary', 'الراتب الأساسي', 'Basic salary'),
      numberField('allowances', 'البدلات', 'Allowances'),
      numberField('penaltyClause', 'الشرط الجزائي', 'Penalty clause'),
    ],
  },
  {
    key: 'iqama', ar: 'الإقامات', en: 'Iqama', icon: 'id', document: true,
    expiryField: 'iqamaExpiry',
    fields: [
      { key: 'iqamaIssueDate', ar: 'تاريخ الإصدار', en: 'Issue date', type: 'date' },
      { key: 'iqamaExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
      // No stored Hijri column here. `iqamaExpiryHijri` was a typed/imported text field, then every date generated a derived Hijri twin under the same key, producing two columns with one key.
      // The stored values are wrong: about half precede the correct one by roughly three months and a day, a systematic error from a faulty conversion in the first import. Only the derived column remains; stored values stay in the database unread. The Gregorian expiry date is the source for alerts and renewals.
      { key: 'iqamaProfession', ar: 'المهنة في الإقامة', en: 'Iqama occupation', type: 'text', groupable: true },
      // A note, not a document: not marked 'required' on employee creation (`optional`).
      { key: 'iqamaProfessionRequirements', ar: 'متطلبات المهنة في الإقامة', en: 'Occupation requirements', type: 'text', optional: true },
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
      // Text, not number: filters arrive as text values, so a numeric database field would never match '21' and the screen would be empty. The binding number stays in the contract document (Contract.annualLeaveDays), the reference for leave balance; this is a snapshot of it.
      { key: 'annualLeaveDays', ar: 'الإجازة السنوية', en: 'Annual leave days', type: 'text', groupable: true },
      // Probation is 'not required' in all contracts of this file. Having the field makes that a written decision rather than a silent blank later read as missing data.
      { key: 'probationPeriod', ar: 'فترة التجربة', en: 'Probation', type: 'text', groupable: true },
    ],
  },
  {
    // Work permits.
    // A government document with its own expiry, separate from the iqama, and late renewal is fined. The employee field `workPermitExpiry` existed outside this file, so it showed in no card, expiries screen or filter.
    key: 'workPermit', ar: 'رخص العمل', en: 'Work permits', icon: 'license', document: true,
    expiryField: 'workPermitExpiry',
    fields: [
      { key: 'workPermitExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
      // No work permit number in the employee file; the schema has no column for it.
    ],
  },
  {
    // Visas and Ajeer: documents not every employee has.
    // They have a tracked expiry, so they join the expiries screen and dashboard counters. Most employees have neither, so an empty one is not marked 'required' on creation (`optional`), or the worklist would fill with people who do not need them; mark it required by hand where needed.
    key: 'visa', ar: 'التأشيرات', en: 'Visas', icon: 'passport', document: true, optional: true,
    expiryField: 'visaExpiry',
    fields: [
      { key: 'visaExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'ajeer', ar: 'أجير', en: 'Ajeer', icon: 'license', document: true, optional: true,
    expiryField: 'ajeerExpiry',
    fields: [
      { key: 'ajeerStatus', ar: 'حالة أجير', en: 'Ajeer status', type: 'text', groupable: true, choice: true },
      { key: 'ajeerExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    // Work card is a single text with no expiry date in the schema, so it is not a tracked document.
    key: 'workCard', ar: 'كارت العمل', en: 'Work card', icon: 'card',
    fields: [
      { key: 'workCard', ar: 'كارت العمل', en: 'Work card', type: 'text', groupable: true },
    ],
  },
  {
    key: 'medicalInsurance', ar: 'التأمين الطبي', en: 'Medical insurance', icon: 'heart', document: true,
    expiryField: 'insuranceExpiry',
    fields: [
      { key: 'insuranceCompany', ar: 'شركة التأمين', en: 'Insurer', type: 'text', groupable: true, choice: true },
      { key: 'insuranceClass', ar: 'فئة التأمين', en: 'Class', type: 'text', groupable: true, choice: true },
      // Document number and the register it is registered under (models/Employee).
      { key: 'medicalInsuranceNumber', ar: 'رقم وثيقة التأمين', en: 'Policy no.', type: 'text' },
      { key: 'medicalInsuranceRegister', ar: 'سجل التأمين الطبي', en: 'Insurance register', type: 'text', groupable: true, choice: true },
      { key: 'insuranceExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
      { key: 'insuranceRequirements', ar: 'متطلبات التأمين', en: 'Insurance requirements', type: 'text', optional: true },
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
      // Its type (annual, restricted...) is written in the driver card itself, see utils/driverCardSync.
      { key: 'driverCardType', ar: 'نوع البطاقة', en: 'Card type', type: 'text', groupable: true, choice: true },
      { key: 'driverCardExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    key: 'drivingLicense', ar: 'رخص القيادة', en: 'Driving licences', icon: 'license', document: true,
    expiryField: 'licenseExpiry',
    fields: [
      { key: 'licenseNumber', ar: 'رقم الرخصة', en: 'Licence no.', type: 'text' },
      { key: 'licenseType', ar: 'نوع الرخصة', en: 'Licence type', type: 'text', groupable: true, choice: true },
      { key: 'licenseExpiry', ar: 'تاريخ الانتهاء', en: 'Expiry', type: 'date' },
    ],
  },
  {
    // Last known trip: departure and return.
    key: 'travel', ar: 'السفر', en: 'Travel', icon: 'plane',
    fields: [
      { key: 'lastTravelDate', ar: 'تاريخ السفر', en: 'Travel date', type: 'date' },
      { key: 'lastReturnDate', ar: 'تاريخ العودة', en: 'Return date', type: 'date' },
    ],
  },
];

/**
 * Every date has two faces: Gregorian and Hijri.
 * Storing both with a sync is a sure source of disagreement (a write to one through an import or old screen leaves the other stale), so the stored value is the Gregorian one and Hijri is derived from it with the Umm al-Qura calendar (see utils/hijri). A Hijri entry is converted before saving. They agree by construction, with no row needing an update.
 * The column name states its calendar, so a date is never read without knowing which one it is, the source of renewal errors.
 */
const HIJRI_SUFFIX = 'Hijri';
const hijriKeyOf = (key) => `${key}${HIJRI_SUFFIX}`;
const isHijriKey = (key) => String(key || '').endsWith(HIJRI_SUFFIX);
const baseOfHijri = (key) => String(key || '').slice(0, -HIJRI_SUFFIX.length);

// Applied to the definition itself: each `type: 'date'` field is named Gregorian and followed by its derived Hijri twin (not filterable; filtering uses the Gregorian one).
for (const g of GROUPS) {
  const out = [];
  for (const f of g.fields) {
    if (f.type !== 'date' || f.hijri || isHijriKey(f.key)) { out.push(f); continue; }
    // 'Gregorian birth date' is not used; the label is parenthesized where the root repeats.
    const clash = /ميلاد/.test(f.ar);
    if (!/ميلادي/.test(f.ar) || clash) f.ar = clash ? `${f.ar} (ميلادي)` : `${f.ar} الميلادي`;
    if (!/Gregorian/i.test(f.en)) f.en = `${f.en} (Gregorian)`;
    out.push(f);
    out.push({
      key: hijriKeyOf(f.key),
      ar: f.ar.replace(' الميلادي', ' الهجري').replace(' (ميلادي)', ' (هجري)'),
      en: f.en.replace(' (Gregorian)', ' (Hijri)'),
      type: 'hijri',
      hijri: true,
      of: f.key,
      // Derived: not stored and not counted as missing; its gap is its Gregorian twin's gap.
      derived: true,
    });
  }
  g.fields = out;
}

const GROUP_KEYS = GROUPS.map((g) => g.key);
/**
 * Old names for renamed groups.
 * `/system/hr/master/gosi` is saved in bookmarks and old links. Without this map the server answers 'unknown group' on a link that worked yesterday.
 */
const GROUP_ALIASES = { gosi: 'socialInsurance' };
/**
 * The 'required' group: a virtual group collecting every gap.
 * The 'required data' dashboard card counts missing fields across all groups, but opening it showed only the 'identity' group, which has zero, so the screen looked empty and the number looked false while correct.
 * This group has no schema entry: its fields are every system field that accepts 'required'. Opening it shows all the gaps in one place, with the names of what each employee lacks.
 */
const REQUIRED_GROUP = {
  key: 'required',
  ar: 'البيانات المطلوبة',
  en: 'Required fields',
  icon: 'alert',
  virtual: true,
  // All fields, with no key repeated between two groups.
  get fields() {
    const seen = new Set();
    // Hijri twins are excluded: a Hijri gap is its source's gap, and its card would count it twice, so the cards would not sum to the 'required fields' dashboard number.
    return GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, groupAr: g.ar, groupKey: g.key })))
      .filter((f) => !f.derived)
      .filter((f) => (seen.has(f.key) ? false : seen.add(f.key)));
  },
};

const getGroup = (key) => {
  const k = GROUP_ALIASES[key] || key;
  if (k === 'required') return REQUIRED_GROUP;
  return GROUPS.find((g) => g.key === k) || null;
};
const DOCUMENT_GROUPS = GROUPS.filter((g) => g.document);
/**
 * Ambiguous titles are qualified by their group.
 * 'Expiry date' is clear inside the iqama page, but in the flat master table all groups sit side by side and 'Gregorian expiry date' appears seven times (iqama, passport, work permit, insurance, health certificate, driver card, driving license), so filtering or exporting is ambiguous.
 * Titles that repeat get the group name prefix; unique ones stay. The rule is computed, not written, so a group added later with a duplicate title is qualified automatically.
 */
const qualifyDuplicateLabels = (fields) => {
  const countAr = new Map();
  const countEn = new Map();
  for (const f of fields) {
    countAr.set(f.ar, (countAr.get(f.ar) || 0) + 1);
    countEn.set(f.en, (countEn.get(f.en) || 0) + 1);
  }
  return fields.map((f) => {
    const out = { ...f };
    if (countAr.get(f.ar) > 1 && f.groupAr) out.ar = `${f.groupAr} — ${f.ar}`;
    if (countEn.get(f.en) > 1 && f.groupEn) out.en = `${f.groupEn} — ${f.en}`;
    return out;
  });
};

const ALL_FIELDS = qualifyDuplicateLabels(
  GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.key, groupAr: g.ar, groupEn: g.en })))
);
const getField = (key) => ALL_FIELDS.find((f) => f.key === key) || null;
/** Name of the status field for any field; convention: <field>Status. */
const statusKeyOf = (fieldKey) => `${fieldKey}Status`;

const STATUS_LABELS = {
  required: { ar: 'مطلوب', en: 'Required', color: '#dc2626' },
  not_required: { ar: 'غير مطلوب', en: 'Not required', color: '#64748b' },
  none: { ar: 'لا يوجد', en: 'None', color: '#94a3b8' },
  // A status of the slot, not a value in it; 'inactive' used to be written as an insurance company name.
  inactive: { ar: 'غير نشط', en: 'Inactive', color: '#b45309' },
  cash_payroll: { ar: 'راتب نقدي', en: 'Cash payroll', color: '#8b5cf6' },
  unparseable: { ar: 'تاريخ غير مقروء', en: 'Unreadable date', color: '#f59e0b' },
  // 'Filled' not 'complete': the status says a value is written, not that it is correct or that the employee file is complete. Colloquial wording is not used in the UI or exports.
  filled: { ar: 'مُدخَل', en: 'Filled', color: '#16a34a' },
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

/** Document state today. `not_required` returns not_applicable whatever the date: an employee not required to hold a driving license is not 'missing a license'. */
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

/**
 * A field's value on a specific employee.
 * A field with `readFrom` is read from it, not from `emp[key]`: reading the column directly makes an employee with a written ID number count as missing. Everything that shows the master or counts its gaps goes through here.
 */
const valueOf = (emp, key) => {
  const f = getField(key);
  return f && typeof f.readFrom === 'function' ? f.readFrom(emp) : emp?.[key];
};

/** The column this field is written to for this employee; may differ per employee. */
const writeKeyOf = (emp, key) => {
  const f = getField(key);
  return f && typeof f.writeTo === 'function' ? f.writeTo(emp) : key;
};

/**
 * Columns the `readFrom`/`writeTo` functions need to work.
 * Every query selecting specific columns must pull these too, or the function reads `undefined` and repeats the very error it fixes, silently (a row just says 'none'). The list is derived from the definition, not written per query.
 */
const READ_DEPS = [...new Set(ALL_FIELDS.flatMap((f) => f.deps || []))];

/** All columns that may hold this field; for search and filtering. */
const searchKeysOf = (key) => {
  const f = getField(key);
  return [key, ...((f && f.alsoSearch) || [])];
};

module.exports = {
  hijriKeyOf, isHijriKey, baseOfHijri, HIJRI_SUFFIX,
  GROUPS, GROUP_KEYS, GROUP_ALIASES, getGroup, DOCUMENT_GROUPS, REQUIRED_GROUP, ALL_FIELDS, getField, statusKeyOf,
  STATUS_LABELS, statusLabel, STATE_LABELS, daysLeft, stateOf,
  valueOf, writeKeyOf, searchKeysOf, READ_DEPS,
};
