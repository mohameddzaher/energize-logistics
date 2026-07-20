/**
 * Import / refresh employee master data from the Arabic HR master sheet.
 *
 * Usage (from backend/):
 *   node src/scripts/importEmployeeMaster.js --dry            # preview, writes nothing
 *   node src/scripts/importEmployeeMaster.js                  # apply
 *   node src/scripts/importEmployeeMaster.js path/to/file.json [--dry]
 *
 * Reads the "new" sheet of the master JSON (the authoritative employee array).
 * Every other sheet (مركبات / Data / Sheet1_pivot / التفويضات) is ignored here.
 *
 * Safety contract:
 *   - Matches ONLY on رقم الهوية → Employee.iqamaNumber. Employee numbers repeat
 *     in the sheet, so they are never used as a match key.
 *   - Existing employees are UPDATED IN PLACE, never deleted and recreated, so
 *     the User.linkedEmployee ↔ Employee.user ObjectId links survive.
 *   - Nothing is ever deleted. Employees absent from the sheet are left alone.
 *   - Employee.user is never written.
 *   - Empty / #N/A / 0 cells never blank an existing value.
 *   - Whenever an expiry date changes over a previously non-empty value, an
 *     EmployeeRenewal audit row is written instead of a silent overwrite.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Branch = require('../models/Branch');
const User = require('../models/User');
const EmployeeRenewal = require('../models/EmployeeRenewal');

const DRY = process.argv.includes('--dry');
const fileArg =
  process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ||
  path.join(__dirname, '../data/masters/الماستر_data.json');
const SHEET = 'new';

// ── value cleaners (same semantics as importHrSheet.js) ─────────────────────
const BAD = new Set(['#n/a', 'n/a', '00:00:00', '', '0']);
const str = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return BAD.has(s.toLowerCase()) ? '' : s;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const date = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};
const hasArabic = (s) => /[؀-ۿ]/.test(s || '');

const mapEmploymentStatus = (txt) => {
  const s = str(txt);
  if (s.includes('اجاز')) return 'on_leave';
  if (s.includes('موقوف') || s.includes('إيقاف') || s.includes('ايقاف')) return 'suspended';
  if (s.includes('منتهي') || s.includes('استقال') || s.includes('انهاء')) return 'terminated';
  return 'active';
};

const splitName = (full) => {
  const s = str(full).replace(/\s+/g, ' ').trim();
  if (!s) return { firstName: '', lastName: '' };
  const i = s.indexOf(' ');
  if (i === -1) return { firstName: s, lastName: s };
  return { firstName: s.slice(0, i), lastName: s.slice(i + 1) };
};

// The sheet's Arabic branch names vs the English Branch documents.
const BRANCH_ALIASES = {
  'الرياض': 'Riyadh',
  'جدة': 'Jeddah',
  'جده': 'Jeddah',
  'الدمام': 'Al Dammam',
  'ينبع': 'Yanbu',
  'جيزان': 'Jazan',
  'جازان': 'Jazan',
  'حوطة سدير': 'Sudair',
  'سدير': 'Sudair',
  'رابغ': 'Rabigh',
  'مكة': 'Makkah',
  'مكه': 'Makkah',
  'النقل الثقيل': 'Heavy Trucks',
};

// Expiry fields that get a renewal audit row when they change.
const RENEWABLE = [
  ['iqamaExpiry', 'iqama'],
  ['passportExpiry', 'passport'],
  ['insuranceExpiry', 'insurance'],
  ['visaExpiry', 'visa'],
  ['licenseExpiry', 'license'],
  ['driverCardExpiry', 'driverCard'],
];

/**
 * Read the sheet, keeping رقم كارت السائق in its ORIGINAL textual form.
 * It arrives as a float literal like 11.00482048; JSON.parse → Number → String
 * would drop meaningful trailing zeros, so the literal is quoted in the raw
 * text before parsing.
 */
function loadRows(abs) {
  let text = fs.readFileSync(abs, 'utf8');
  text = text.replace(/("رقم كارت السائق"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, '$1"$2"');
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed[SHEET];
  if (!Array.isArray(rows)) throw new Error(`Sheet "${SHEET}" not found in ${abs}`);
  return rows;
}

function buildFields(row, branchByName) {
  const iqama = str(row['رقم الهوية']);
  const fullName = str(row['الاسم']);
  const { firstName, lastName } = splitName(fullName);
  const workStatus = str(row['حاله العمل']);
  const absher = str(row['رقم ابشر']);
  const penaltyRaw = str(row['الشرط الجزائي']);

  const fields = {
    // Identity
    firstName,
    lastName,
    arabicName: hasArabic(fullName) ? fullName : '',
    employeeNumber: str(row['الرقم الوظيفي']),
    idType: 'iqama',
    iqamaNumber: iqama,
    dateOfBirth: date(row['تاريخ الميلاد']),
    hireDate: date(row['تاريخ التعيين']),
    nationality: str(row['الجنسيه']),
    department: str(row['القسم']),
    workLocation: str(row['الفرع']),
    jobTitle: str(row['المسمي الوظيفي']),
    email: str(row['الايميل']).toLowerCase(),

    // Banking
    iban: str(row['الايبان']),
    bank: str(row['البنك']),

    // Bookkeeping
    absherNumber: absher,
    absherStatus: absher ? 'مسجل' : '',
    companyNumber: str(row['رقم الشركه']),
    originCountryNumber: str(row['رقم دوله الأصل']),
    project: str(row['المشروع']),
    registerNumber: str(row['رقم السجل']),
    fileStatus: str(row['حاله الملف']),
    systemStatus: str(row['حاله النظام']),
    workStatusText: workStatus,
    employmentStatus: workStatus ? mapEmploymentStatus(workStatus) : '',

    // Iqama / passport
    iqamaExpiry: date(row['تاريخ انتهاء الاقامه']),
    passportNumber: str(row['رقم جواز السفر']),
    passportExpiry: date(row['تاريخ الانتهاء']), // renamed column: now passport expiry
    iqamaProfession: str(row['المهنه في الاقامه']),
    iqamaProfessionRequirements: str(row['متطلبات المهنه في الاقامه']),

    // Contract columns (text mirror of the sheet)
    contractStatusText: str(row['حاله العقد']),
    contractStartDate: date(row['تاريخ الانشاء']),
    contractEndDate: date(row['تاريخ الانتهاء_2']),
    penaltyClause: penaltyRaw ? num(penaltyRaw) : '',

    // Insurance
    insuranceCompany: str(row['شركه التامين']),
    insuranceExpiry: date(row['تاريخ انتهاء التامين']),
    socialInsuranceStatus: str(row['حاله التامينات الاجتماعيه']),
    insuranceRequirements: str(row['متطلبات التامين']),

    // Driving / vehicle
    vehiclePlate: str(row['المركبه']),
    driverCardNumber: str(row['رقم كارت السائق']),
    driverCardType: str(row['نوعه']),
    driverCardExpiry: date(row['تاريخ الانتهاء_4']), // renamed column: driver card expiry
    driverCardStatus: str(row['حاله كارت السائق']),
    licenseType: str(row['نوع الرخصه قياده']),
    licenseExpiry: date(row['انتهاء الرخصه القياده']),

    // Visa & travel
    visaExpiry: date(row['انتهاء التأشيرة']),
    lastTravelDate: date(row['تاريخ السفر 2025']) || date(row['تاريخ السفر 2024']),
    lastReturnDate: date(row['تاريخ الرجوع 2025']) || date(row['تاريخ الرجوع 2024']),
  };

  const branchId = branchByName(row['الفرع']);
  if (branchId) fields.branch = branchId;

  // Blank guard: an empty / #N/A / 0 cell must never null out good data.
  Object.keys(fields).forEach((k) => {
    if (fields[k] === '' || fields[k] === undefined) delete fields[k];
  });
  return fields;
}

async function run() {
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(abs)) {
    console.error(`Data file not found: ${abs}`);
    process.exit(1);
  }
  const rows = loadRows(abs);

  await mongoose.connect(process.env.MONGODB_URI);

  const branches = await Branch.find({}).lean();
  const branchByName = (raw) => {
    const s = str(raw);
    if (!s) return null;
    const target = BRANCH_ALIASES[s] || s;
    const b =
      branches.find((x) => x.name === target) ||
      branches.find((x) => x.name && (x.name.includes(target) || target.includes(x.name)));
    return b ? b._id : null;
  };

  // Duplicate / missing id detection inside the sheet itself.
  const seen = new Map();
  const dupIds = [];
  const missingId = [];
  rows.forEach((row, i) => {
    const iq = str(row['رقم الهوية']);
    if (!iq) { missingId.push(i + 2); return; }
    if (seen.has(iq)) dupIds.push({ iqama: iq, rows: [seen.get(iq), i + 2] });
    else seen.set(iq, i + 2);
  });

  const report = {
    read: rows.length,
    matched: 0,
    toCreate: 0,
    toUpdate: 0,
    unchanged: 0,
    skipped: [],
    fieldChanges: {},
    renewals: 0,
    renewalsByType: {},
    linkedAmongMatched: 0,
  };

  const seenThisRun = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;
    const iqama = str(row['رقم الهوية']);

    if (!iqama) {
      report.skipped.push(`row ${rowNo}: missing رقم الهوية`);
      continue;
    }
    if (seenThisRun.has(iqama)) {
      report.skipped.push(`row ${rowNo}: duplicate رقم الهوية ${iqama} within the sheet`);
      continue;
    }
    seenThisRun.add(iqama);

    const fields = buildFields(row, branchByName);
    if (!fields.firstName) {
      report.skipped.push(`row ${rowNo} (${iqama}): missing الاسم — firstName/lastName are required`);
      continue;
    }
    if (!fields.lastName) fields.lastName = fields.firstName;

    const emp = await Employee.findOne({ iqamaNumber: iqama });

    if (!emp) {
      report.toCreate++;
      if (!DRY) await Employee.create(fields);
      continue;
    }

    report.matched++;
    if (emp.user) report.linkedAmongMatched++;

    // Diff against the current document.
    const changed = [];
    const renewals = [];
    for (const [k, v] of Object.entries(fields)) {
      const oldV = emp[k];
      const same =
        k === 'branch'
          ? String(oldV || '') === String(v || '')
          : String(oldV === undefined || oldV === null ? '' : oldV) === String(v);
      if (same) continue;
      changed.push(k);
      report.fieldChanges[k] = (report.fieldChanges[k] || 0) + 1;
    }

    for (const [field, docType] of RENEWABLE) {
      const newV = fields[field];
      const oldV = str(emp[field]);
      if (newV && oldV && oldV !== newV) {
        renewals.push({
          employee: emp._id,
          docType,
          previousExpiry: oldV,
          newExpiry: newV,
          notes: 'تحديث من الماستر',
          renewedAt: new Date(),
        });
        report.renewalsByType[docType] = (report.renewalsByType[docType] || 0) + 1;
      }
    }
    report.renewals += renewals.length;

    if (!changed.length) {
      report.unchanged++;
      continue;
    }
    report.toUpdate++;

    if (!DRY) {
      // Never touch the identity link.
      delete fields.user;
      Object.assign(emp, fields);
      await emp.save();
      if (renewals.length) await EmployeeRenewal.insertMany(renewals);
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const L = (k, v) => console.log(`  ${String(k).padEnd(34)} ${v}`);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`EMPLOYEE MASTER IMPORT — ${DRY ? 'DRY RUN (nothing written)' : 'LIVE RUN'}`);
  console.log(`file: ${abs}  sheet: "${SHEET}"`);
  console.log('='.repeat(64));
  L('rows read', report.read);
  L('matched existing employees', report.matched);
  L(DRY ? 'would create' : 'created', report.toCreate);
  L(DRY ? 'would update' : 'updated', report.toUpdate);
  L('matched but unchanged', report.unchanged);
  L('deleted', '0 (never deletes)');
  L('rows skipped', report.skipped.length);
  L('linked users among matched', report.linkedAmongMatched);
  L(DRY ? 'renewals that would be written' : 'renewals written', report.renewals);

  console.log('\n  renewals by docType:');
  Object.entries(report.renewalsByType).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(30)} ${v}`));

  console.log('\n  field change counts (on matched employees):');
  Object.entries(report.fieldChanges).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(30)} ${v}`));

  if (missingId.length) console.log(`\n  rows with MISSING رقم الهوية: ${missingId.join(', ')}`);
  else console.log('\n  rows with MISSING رقم الهوية: none');
  if (dupIds.length) {
    console.log('  DUPLICATE رقم الهوية in sheet:');
    dupIds.forEach((d) => console.log(`    ${d.iqama} → rows ${d.rows.join(', ')}`));
  } else console.log('  DUPLICATE رقم الهوية in sheet: none');

  if (report.skipped.length) {
    console.log('\n  skipped rows and why:');
    report.skipped.forEach((s) => console.log(`    - ${s}`));
  } else console.log('\n  skipped rows and why: none');

  // Employees in the DB that the sheet does not mention — untouched by design.
  const sheetIds = new Set([...seenThisRun]);
  const all = await Employee.find({}).select('firstName lastName iqamaNumber user').lean();
  const absent = all.filter((e) => !(e.iqamaNumber && sheetIds.has(String(e.iqamaNumber).trim())));
  console.log(`\n  employees absent from the sheet (LEFT UNTOUCHED): ${absent.length}`);
  absent.forEach((e) =>
    console.log(`    - ${e.firstName} ${e.lastName || ''} | iqama=${e.iqamaNumber || '—'} | linked=${!!e.user}`)
  );

  // ── post-state verification ───────────────────────────────────────────────
  const dupGroups = await Employee.aggregate([
    { $match: { iqamaNumber: { $nin: [null, ''] } } },
    { $group: { _id: '$iqamaNumber', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  console.log(`\n${'-'.repeat(64)}\nDATABASE STATE ${DRY ? '(unchanged — dry run)' : 'AFTER IMPORT'}`);
  L('total employees', await Employee.countDocuments());
  L('users with linkedEmployee', await User.countDocuments({ linkedEmployee: { $ne: null } }));
  L('employees with .user set', await Employee.countDocuments({ user: { $ne: null } }));
  L('duplicate iqamaNumber groups', dupGroups.length);
  L('EmployeeRenewal documents', await EmployeeRenewal.countDocuments());
  console.log('-'.repeat(64) + '\n');

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => {
  console.error('Import failed:', e);
  process.exit(1);
});
