/**
 * repairNotRequiredFields — «غير مطلوب» في الورقة ليست خانةً ناقصة.
 *
 *   node src/scripts/repairNotRequiredFields.js --dry
 *   node src/scripts/repairNotRequiredFields.js --yes
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * ملفّاتُ الموارد البشريّة تكتب «غير مطلوب» حيث لا يلزم المستندُ أصلًا: سائقٌ
 * لا يعمل في الأغذية لا شهادةَ صحيّةَ له، وموظّفُ مكتبٍ لا رخصةَ قيادةٍ تُطلب
 * منه. وهذا جوابٌ لا فراغ.
 *
 * ودخلت كلُّها «مطلوب»: ٢٩٣ من ٣٦٢ في الشهادة الصحيّة وحدَها. فامتلأت لوحةُ
 * النواقص بمئاتِ البنودِ التي لا ينقص منها شيء، وصار الرقمُ الذي يُفترض أن
 * يقول «هذا شغلُنا الباقي» لا يقول شيئًا — وهو أسوأُ من غيابه، لأنّ من يقرؤه
 * يظنّه صادقًا فيطارد ما لا وجودَ له.
 *
 * ── والنظامُ يعرف هذه الحالة أصلًا ─────────────────────────────────────────
 * `not_required` موجودةٌ في `hrFields` وتُقرأ «لا ينطبق» ولا تُعَدّ نقصًا. لم
 * تكن الحالةُ ناقصةً — كان الاستيرادُ يتجاهل ما تقوله الورقة.
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

// عمودُ الورقة ← حقلُ الموظّف الذي يقابله.
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

  // رقمُ الهويّة هو المفتاح — الأسماءُ تُكتب بصورٍ شتّى.
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
        // ما هو «غير مطلوب» أصلًا لا يُكتب ثانيةً.
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

  // والأثر: كم بند «مطلوب» بقي في الشهادة الصحيّة.
  const key = H.statusKeyOf('healthCertExpiry');
  const still = await Employee.countDocuments({ isHrRecord: { $ne: false }, [`fieldStatus.${key}`]: 'required' });
  const na = await Employee.countDocuments({ isHrRecord: { $ne: false }, [`fieldStatus.${key}`]: 'not_required' });
  console.log(`الشهادة الصحيّة الآن: مطلوب ${still} · غير مطلوب ${na}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
