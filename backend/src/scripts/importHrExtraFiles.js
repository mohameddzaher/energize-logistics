/**
 * importHrExtraFiles: the six extra HR files.
 * The detailed sheets outrank the master, so a differing value we hold came from the weaker master. An empty sheet cell never erases ours: absence is not a value.
 * The key is the ID number, stored as iqamaNumber for residents and nationalId for Saudis; search both or Saudis are dropped.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('./lib/xlsxStream');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--yes');
const DIR = path.join(__dirname, '../../../final hr data/extra hr files');

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());

// The not-required label is not a value. The health certificate column uses it for employees who need no certificate; storing it in the number field makes the number unsearchable text. Absence is written as absence.
const NOT_REQUIRED = ['غير مطلوب', 'غير مطلوبة', 'لا يوجد', 'لايوجد', '-', '—'];
const val = (v) => { const s = n(v); return NOT_REQUIRED.includes(s) ? '' : s; };

// Driver card number arrives as a float with floating-point noise because Excel stored a number, not text. Strip the noise and keep the clean sheet value, no other format.
const cardNumber = (v) => {
  const s = n(v);
  if (!s) return '';
  const num = Number(s);
  if (!Number.isFinite(num) || !/^\d+\.\d{6,}$/.test(s)) return s;
  return String(Number(num.toFixed(8)));
};
/** Excel date (serial or text) to 'YYYY-MM-DD'. */
const hijri = [];
const ymd = (v, ctx) => {
  const s = n(v);
  if (!s || NOT_REQUIRED.includes(s)) return '';
  // A Hijri date string is not stored in a Gregorian date field: converting is a guess and storing it raw reads as year 1449 AD. It is skipped and reported.
  if (/^1[34]\d{2}[-/]/.test(s)) { hijri.push(ctx ? `${ctx}: ${s}` : s); return ''; }
  const num = Number(s);
  if (Number.isFinite(num) && num > 1000 && num < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + num * 86400000).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Reads the first sheet and returns rows keyed by column header. */
function readRows(file) {
  const sheets = require('child_process')
    .execSync(`unzip -Z1 ${JSON.stringify(file)} "xl/worksheets/sheet*.xml"`).toString().trim().split('\n');
  const rows = xlsx.readSheet(file, sheets[0]);
  const hdrRow = rows.find((r) => r.cells && Object.values(r.cells).some((v) => n(v) === 'رقم الهوية'));
  if (!hdrRow) return [];
  const cols = {};
  Object.entries(hdrRow.cells).forEach(([k, v]) => { cols[k] = n(v); });
  return rows.filter((r) => r.r > hdrRow.r && r.cells).map((r) => {
    const o = {};
    Object.entries(r.cells).forEach(([k, v]) => { if (cols[k]) o[cols[k]] = v; });
    return o;
  }).filter((o) => n(o['رقم الهوية']));
}

// File name to how its columns map to employee fields.
const FILES = [
  ['تاريخ الميلاد للموظفيين', (r) => ({ dateOfBirth: ymd(r['تاريخ الميلاد']) })],
  ['ملف التأمين الطبي', (r) => ({
    medicalInsuranceNumber: n(r['الرقم التأميني ']) || n(r['الرقم التأميني']),
    insuranceClass: n(r['الفئة']),
    insuranceExpiry: ymd(r['تاريخ انتهاء التأمين']),
    medicalInsuranceRegister: n(r['السجل']),
  })],
  ['ملف الشهادة الصحية للموظفين', (r) => ({
    healthCertNumber: val(r['رقم الشهادة الصحية']),
    healthCertExpiry: ymd(r['تاريخ انتهاء الشهادة الصحية']),
  })],
  ['ملف بطاقات السائقيين للنقل الثقيل', (r) => ({
    driverCardNumber: cardNumber(r['رقم كارت السائق']),
    driverCardType: val(r['نوعه']),
    driverCardExpiry: ymd(r['تاريخ الانتهاء']),
  })],
  ['ملف رخصة القيادة', (r) => ({
    licenseType: n(r['نوع الرخصه قياده']),
    licenseExpiry: ymd(r['انتهاء الرخصه القياده']),
  })],
  ['ملف مباشرة العمل والتعيين', (r) => ({
    hireDate: ymd(r['تاريخ التعيين']),
    actualWorkStartDate: ymd(r['تاريخ مباشرة العمل']),
  })],
];

// Fields stored as real dates, not text.
const DATE_TYPED = new Set(['healthCertExpiry']);

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log(APPLY ? '  استيرادُ ملفّات الموارد البشريّة الإضافيّة — تنفيذ' : '  استيرادُ ملفّات الموارد البشريّة الإضافيّة — فحصٌ فقط');
  console.log('='.repeat(74));
  await mongoose.connect(process.env.MONGODB_URI);

  const emps = await Employee.find({}).select('iqamaNumber nationalId employeeNumber fullNameAr firstName lastName').lean();
  const byId = new Map();
  for (const e of emps) {
    for (const k of [e.iqamaNumber, e.nationalId]) {
      const key = n(k);
      if (key && !byId.has(key)) byId.set(key, e);
    }
  }
  console.log(`  موظّفون في النظام: ${emps.length} · مفاتيحُ هويّة: ${byId.size}\n`);

  const patches = new Map(); // employeeId → { field: value }
  let missing = 0; const missingIds = new Set();

  for (const [name, mapper] of FILES) {
    const file = path.join(DIR, `${name}.xlsx`);
    if (!fs.existsSync(file)) { console.log(`  ✗ غير موجود: ${name}`); continue; }
    const rows = readRows(file);
    let matched = 0; let fields = 0;
    for (const r of rows) {
      const emp = byId.get(n(r['رقم الهوية']));
      if (!emp) { missing += 1; missingIds.add(n(r['رقم الهوية'])); continue; }
      matched += 1;
      const vals = mapper(r);
      const cur = patches.get(String(emp._id)) || {};
      for (const [k, v] of Object.entries(vals)) {
        // An empty cell never erases what we hold: absence is not a value.
        if (v === '' || v === null || v === undefined) continue;
        cur[k] = DATE_TYPED.has(k) ? new Date(`${v}T00:00:00.000Z`) : v;
        fields += 1;
      }
      patches.set(String(emp._id), cur);
    }
    console.log(`  ${name.padEnd(34)} ${String(rows.length).padStart(4)} صفًّا · طوبق ${String(matched).padStart(4)} · ${fields} قيمة`);
  }

  console.log(`\n  موظّفون سيُحدَّثون: ${patches.size}`);
  console.log(`  صفوفٌ بلا موظّفٍ مطابق: ${missing} (${missingIds.size} رقمَ هويّةٍ مختلفًا)`);
  if (hijri.length) console.log(`  تواريخُ هجريّةٌ تُركت (تحتاج تحويلًا يدويًّا): ${hijri.length} — مثال: ${hijri.slice(0, 4).join(' · ')}`);
  if (missingIds.size) console.log(`    مثال: ${[...missingIds].slice(0, 8).join(' ')}`);

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const touched = [...patches.keys()];
  const before = await Employee.find({ _id: { $in: touched } }).lean();
  const backup = path.join(dir, `hrExtraFiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date(), before }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  const ops = [...patches.entries()].map(([id, set]) => ({ updateOne: { filter: { _id: id }, update: { $set: set } } }));
  const r = await Employee.bulkWrite(ops, { ordered: false });
  console.log(`  حُدِّث: ${r.modifiedCount} موظّفًا\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
