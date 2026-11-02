/**
 * repairNotRequiredFields: 'not required' in the sheet is not a missing field. Usage: node src/scripts/repairNotRequiredFields.js [--dry|--yes] HR files write 'not required'
 * where the document does not apply (a driver outside food has no health certificate; an office worker needs no driving license). That is an answer, not a blank. Import
 * turned them all into 'required', flooding the gaps dashboard with items that are not missing and making its headline number misleading. The system already has this
 * state: `not_required` exists in `hrFields`, reads as 'not applicable' and is not counted as a gap. The import simply ignored what the sheet said.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const DIR = path.join(__dirname, '../../..', 'final hr data', 'extra hr files');
const S = (v) => (v == null ? '' : String(v).trim());
const NOT_REQUIRED = /غير\s*مطلوب/;

// Sheet column to the matching employee field.
const MAP = {
  'ملف الشهادة الصحية للموظفين.xlsx': {
    'رقم الشهادة الصحية': 'healthCertNumber',
    'تاريخ انتهاء الشهادة الصحية': 'healthCertExpiry',
  },
  'ملف التأمين الطبي.xlsx': {
    'الرقم التأميني': 'medicalInsuranceNumber',
    'تاريخ انتهاء التأمين': 'insuranceExpiry',
    'السجل': 'medicalInsuranceRegister',
  },
  'ملف رخصة القيادة.xlsx': {
    'نوع الرخصه قياده': 'licenseType',
    'انتهاء الرخصه القياده': 'licenseExpiry',
  },
  'ملف مباشرة العمل والتعيين.xlsx': {
    'تاريخ التعيين': 'hireDate',
    'تاريخ مباشرة العمل': 'actualWorkStartDate',
  },
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');

  // The identity number is the key; names are written in many forms.
  const emps = await Employee.find({}).select('iqamaNumber nationalId fieldStatus arabicName firstName lastName').lean();
  const byId = new Map();
  for (const e of emps) for (const k of [S(e.iqamaNumber), S(e.nationalId)]) if (k && !byId.has(k)) byId.set(k, e);

  const ops = new Map();        // employeeId → { [statusKey]: 'not_required' }
  const perField = {};
  let noEmployee = 0;

  for (const [file, cols] of Object.entries(MAP)) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) { console.log(`⚠ غير موجود: ${file}`); continue; }
    const wb = XLSX.readFile(full, { cellDates: false, raw: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true });
    const hdr = (rows[0] || []).map((v) => S(v));

    for (const row of rows.slice(1)) {
      const id = S(row[0]);
      const emp = byId.get(id);
      if (!emp) { if (id) noEmployee += 1; continue; }
      for (const [colName, field] of Object.entries(cols)) {
        const c = hdr.indexOf(colName);
        if (c < 0) continue;
        if (!NOT_REQUIRED.test(S(row[c]))) continue;
        const key = H.statusKeyOf(field);
        // Already 'not required' is not written again.
        if (emp.fieldStatus?.[key] === 'not_required') continue;
        const id2 = String(emp._id);
        if (!ops.has(id2)) ops.set(id2, {});
        ops.get(id2)[`fieldStatus.${key}`] = 'not_required';
        perField[field] = (perField[field] || 0) + 1;
      }
    }
  }

  console.log('خاناتٌ تُعلَّم «غير مطلوب» كما تقول الورقة:');
  for (const [f, n] of Object.entries(perField).sort((a, b) => b[1] - a[1])) console.log(`   ${f.padEnd(26)} ${n}`);
  console.log(`\nموظّفون يُمَسّون: ${ops.size}`);
  if (noEmployee) console.log(`صفوفٌ بهويّةٍ لا موظّفَ لها (تُترك): ${noEmployee}`);

  if (DRY) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const writes = [...ops.entries()].map(([id, set]) => ({ updateOne: { filter: { _id: id }, update: { $set: set } } }));
  let done = 0;
  for (let i = 0; i < writes.length; i += 500) {
    const r = await Employee.bulkWrite(writes.slice(i, i + 500), { ordered: false });
    done += r.modifiedCount || 0;
  }
  console.log(`\n✓ عُدِّل ${done} موظّفًا`);

  // Effect: how many health-certificate items are still 'required'.
  const key = H.statusKeyOf('healthCertExpiry');
  const still = await Employee.countDocuments({ isHrRecord: { $ne: false }, [`fieldStatus.${key}`]: 'required' });
  const na = await Employee.countDocuments({ isHrRecord: { $ne: false }, [`fieldStatus.${key}`]: 'not_required' });
  console.log(`الشهادة الصحيّة الآن: مطلوب ${still} · غير مطلوب ${na}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
