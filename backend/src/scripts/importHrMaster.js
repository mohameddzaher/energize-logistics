/**
 * Import of the HR master, the single reference for employee data.
 * Usage: --dry previews, --yes applies, --overwrite lets the master correct existing values instead of only filling empty ones.
 * Source: seeds/data/hr-2026-08/master-of-hr.xlsx (378 employees, 51 columns, header on row 3), complemented by thirteen detailed sheets.
 * The required label means the field is missing and must be collected, not that its value is that word, so it is read as blank. The not-required and none labels are valid states: kept in status text fields and ignored in date and number fields. Default fills empty only; --overwrite is right only when the master is newer than the screen.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const mongoose = require('mongoose');
const { readSheet, excelDate } = require('./lib/xlsxStream');
const Employee = require('../models/Employee');

const DRY = !process.argv.includes('--yes');
const OVERWRITE = process.argv.includes('--overwrite');
const FILE = path.join(__dirname, '../seeds/data/hr-2026-08/master-of-hr.xlsx');
const HEADER_ROW = 3;

// Required means missing; not-required and none are states, kept only where the field accepts them.
const MISSING = new Set(['', '-', '#n/a', 'n/a', 'na', 'null', 'undefined', 'مطلوب', '0']);
const STATE_WORDS = new Set(['غير مطلوب', 'لا يوجد']);

const str = (v) => {
  const s = String(v ?? '').trim();
  return MISSING.has(s.toLowerCase()) ? '' : s;
};
/** Text describing a state: accepts the not-required and none labels. */
const text = (v) => str(v);
/** Text that must be a real value: rejects the state words. */
const value = (v) => { const s = str(v); return STATE_WORDS.has(s) ? '' : s; };
const num = (v) => { const s = value(v); if (!s) return null; const n = Number(s.replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/** Dates come in three forms: a serial number (46304), a Gregorian string ('2008-11-17') and a Hijri string ('1448-02-11'). Hijri is rejected: stored in a Gregorian field it would make the iqama expire in year 1448 AD. */
const date = (v) => {
  const s = value(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) { const d = excelDate(s); return d ? d.toISOString().slice(0, 10) : null; }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) < 1900 ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  return null;
};
const bool = (v) => { const s = value(v); if (!s) return null; return /^(نعم|yes|true|1)$/i.test(s) ? true : (/^(لا|no|false)$/i.test(s) ? false : null); };
const gender = (v) => { const s = value(v); if (!s) return ''; return /ذكر|male/i.test(s) ? 'male' : (/انثى|أنثى|female/i.test(s) ? 'female' : ''); };

// Master column to [model field, converter]
const MAP = {
  A: ['employeeNumber', value],
  B: ['iqamaNumber', value],
  C: ['arabicName', value],
  D: ['gender', gender],
  E: ['nationality', value],
  G: ['passportNumber', value],
  H: ['passportExpiry', date],
  I: ['iqamaIssueDate', date],
  J: ['iqamaExpiry', date],
  L: ['dateOfBirth', date],
  M: ['isOutsideKingdom', bool],
  O: ['employerNumber', value],
  P: ['gosiNumber', value],
  Q: ['department', value],
  R: ['workStatusText', text],
  S: ['workLocation', value],
  T: ['notes', value],
  U: ['iban', text],           // The cash label is a real value here: paid in cash
  V: ['bank', text],
  W: ['email', value],
  X: ['companyEmail', value],
  Y: ['absherNumber', value],
  Z: ['companyNumber', value],
  AA: ['originCountryNumber', value],
  AB: ['address', value],
  AC: ['contractStatusText', text],
  AE: ['qiwaContractNumber', value],
  AF: ['contractStartDate', date],
  AG: ['contractEndDate', date],
  AI: ['hireDate', date],
  AK: ['branchName', value],
  AL: ['directManagerName', value],
  AM: ['systemStatus', text],
  AN: ['workStatusText', text],
  AO: ['iqamaProfession', value],
  AP: ['insuranceCompany', text],
  AQ: ['classification', value],
  AR: ['insuranceExpiry', date],
  AS: ['healthCertNumber', value],
  AT: ['healthCertExpiry', date],
  AU: ['driverCardStatus', text],
  AV: ['driverCardNumber', value],
  AW: ['driverCardExpiry', date],
  AX: ['licenseType', text],
  AY: ['licenseExpiry', date],
};
// Contract profession lives on the contract, not the employee (F and AD are the same column repeated).
const CONTRACT_PROFESSION_COLS = ['F', 'AD'];

// Rows excluded by the company owner: row 50 is not a person but the same record as #116 written in Arabic with a one-digit error in the iqama number. It is never created, however often the import runs. Remove this entry once the row is deleted from the master.
const EXCLUDED_IQAMAS = new Set(['2677457951']);

// Master identity numbers with a digit error: one employee's ID is 2621086423 in the master but 2621086426 is correct (per the owner, all thirteen detailed sheets, and record #128). Without the fix the row would not match its record and a second one would be created on every import. Remove the entry once the file is corrected.
const IQAMA_FIXES = { 2621086423: '2621086426' };
const fixIqama = (v) => IQAMA_FIXES[v] || v;

// Precedence: the thirteen detailed sheets outrank the master (owner decision). Each sheet is a single column exported from its source (Absher, insurance, passports) while the master is hand-assembled and goes stale; measured differences included six Absher fields, nationality and national address.
// So the master only fills those fields when empty and never overwrites them, even with --overwrite. Fields with no sheet (IBAN, bank, classification, license type) come only from the master, which can correct them.
const SHEET_OWNED = new Set([
  'employeeNumber', 'absherNumber', 'nationality', 'email', 'gender', 'address',
  'employerNumber', 'gosiNumber', 'department', 'passportNumber', 'passportExpiry',
  'workStatusText', 'iqamaExpiry', 'iqamaProfession', 'arabicName', 'iqamaNumber',
  // The department and job title column carries five fields: department, branch, direct manager, title and contract type.
  'branchName', 'directManagerName', 'jobTitle', 'classification',
  'contractStartDate', 'contractEndDate', 'contractStatusText', 'hireDate',
]);

const DATE_FIELDS = new Set(['passportExpiry', 'iqamaIssueDate', 'iqamaExpiry', 'dateOfBirth',
  'contractStartDate', 'contractEndDate', 'hireDate', 'insuranceExpiry', 'healthCertExpiry', 'driverCardExpiry', 'licenseExpiry']);

const isBlank = (v) => v === undefined || v === null || v === '' || (v instanceof Date && Number.isNaN(v.getTime()));
const asComparable = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v;
  return String(v ?? '').trim();
};

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(DRY ? '  ماستر الموارد البشريّة — تجربةٌ فقط' : `  ماستر الموارد البشريّة — تنفيذ${OVERWRITE ? ' (يصحّح المخالف — عدا ما تملكه الشيتات)' : ' (يملأ الفارغ)'}`);
  console.log('  الأسبقيّة: الشيتات الثلاثةَ عشرَ فوق الماستر — يملأ ما ليس فيها ولا يكتب فوقه.');
  console.log('='.repeat(72));

  const allRows = readSheet(FILE, 'xl/worksheets/sheet1.xml').filter((r) => r.r > HEADER_ROW && str(r.cells.B));
  const rows = allRows.filter((r) => !EXCLUDED_IQAMAS.has(str(r.cells.B)));
  const fixed = rows.filter((r) => IQAMA_FIXES[str(r.cells.B)]).length;
  if (fixed) console.log(`  هويّاتٌ صُحِّحت عن الملفّ: ${fixed}`);
  console.log(`  صفوفٌ لها رقم هويّة: ${allRows.length}${allRows.length !== rows.length ? ` (استُثني ${allRows.length - rows.length})` : ''}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const emps = await Employee.find({}).lean();
  const byIq = new Map();
  for (const e of emps) {
    for (const k of [e.iqamaNumber, e.nationalId]) { const v = str(k); if (v && !byIq.has(v)) byIq.set(v, e); }
  }
  const byNum = new Map();
  for (const e of emps) { const v = str(e.employeeNumber); if (v && !byNum.has(v)) byNum.set(v, e); }

  const plan = [];
  const creates = [];
  const fieldHits = {};
  const professions = new Map();   // iqama maps to the contract profession

  for (const { cells } of rows) {
    const iq = fixIqama(str(cells.B));
    const emp = byIq.get(iq) || byNum.get(str(cells.A)) || null;

    const src = {};
    for (const [col, [field, conv]] of Object.entries(MAP)) {
      const v = conv(cells[col]);
      if (v === null || v === '' || v === undefined) continue;
      // Duplicated column pairs (Q/AJ, R/AN): the first is not overwritten by an empty second.
      if (src[field] === undefined) src[field] = v;
    }
    for (const c of CONTRACT_PROFESSION_COLS) {
      const p = value(cells[c]);
      if (p && !professions.has(iq)) professions.set(iq, p);
    }

    if (!emp) { creates.push({ iq, src }); continue; }

    const set = {};
    for (const [k, v] of Object.entries(src)) {
      const now = emp[k];
      const blank = isBlank(now);
      // The sheet owns the field: fill when empty, never overwrite a populated value, whatever the flags.
      const mayOverwrite = OVERWRITE && !SHEET_OWNED.has(k);
      if (blank || (mayOverwrite && asComparable(now) !== asComparable(v))) {
        set[k] = v;
        fieldHits[k] = (fieldHits[k] || 0) + 1;
      }
    }
    if (Object.keys(set).length) plan.push({ _id: emp._id, name: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(), set });
  }

  console.log(`  طُوبق: ${rows.length - creates.length}/${rows.length} · بلا سجلٍّ في النظام: ${creates.length}`);
  if (creates.length) creates.slice(0, 10).forEach((c) => console.log(`     + ${c.src.arabicName || c.iq} (#${c.src.employeeNumber || '—'})`));
  console.log(`\n  سجلّاتٌ ستُحدَّث: ${plan.length}`);
  console.log('\n  ما سيُكتب بالحقل:');
  Object.entries(fieldHits).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    ${k.padEnd(24)} ${n}`));

  if (DRY) { console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let updated = 0; let created = 0; let failed = 0;
  for (const p of plan) {
    try {
      // Dates are written as text or Date depending on the schema; mongoose casts.
      await Employee.updateOne({ _id: p._id }, { $set: p.set });
      updated += 1;
    } catch (e) { failed += 1; console.error(`  ! ${p.name}: ${e.message}`); }
  }
  for (const c of creates) {
    try {
      // The schema requires first and last name but the master has the full name in one cell. Split it: first word is the first name and the rest the last, while arabicName keeps the full name as written since it is what is displayed everywhere.
      const full = String(c.src.arabicName || '').trim().replace(/\s+/g, ' ');
      const parts = full ? full.split(' ') : [];
      const firstName = parts[0] || c.iq;
      const lastName = parts.slice(1).join(' ') || parts[0] || c.iq;
      await Employee.create({ ...c.src, iqamaNumber: c.iq, firstName, lastName });
      created += 1;
    } catch (e) { failed += 1; console.error(`  ! ${c.iq}: ${e.message}`); }
  }
  console.log(`\n  ✓ حُدِّث ${updated} · أُنشئ ${created}${failed ? ` · فشل ${failed}` : ''}`);

  // Profession is written to the current contract, not the employee.
  const Contract = require('../models/Contract');
  let profs = 0;
  for (const [iq, prof] of professions) {
    // eslint-disable-next-line no-await-in-loop
    const e = await Employee.findOne({ $or: [{ iqamaNumber: iq }, { nationalId: iq }] }).select('_id').lean();
    if (!e) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await Contract.updateMany(
      { employee: e._id, $or: [{ contractProfession: '' }, { contractProfession: { $exists: false } }] },
      { $set: { contractProfession: prof, iqamaNumber: iq } },
    );
    profs += r.modifiedCount;
  }
  console.log(`  ✓ المهنة في العقد: ${profs} عقدًا`);

  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
