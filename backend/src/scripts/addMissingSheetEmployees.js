/**
 * addMissingSheetEmployees: the sheets are the reference, so anyone in them but not in the system is added.
 * node src/scripts/addMissingSheetEmployees.js         # dry run
 * node src/scripts/addMissingSheetEmployees.js --yes   # apply
 * The detailed sheets are the newest and most accurate data we have, so extras in them are real: an employee who started work and was not yet registered. The record is created with only what the sheets hold: no department, salary or branch is invented. Someone found only in the master file is not added: the master is weaker than the sheets and has proven to contain dropped names and wrong ID numbers. Adding comes from the detailed sheets alone.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('./lib/xlsxStream');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--yes');
const DETAIL_DIRS = [
  path.join(__dirname, '../../../final hr data/extra hr files'),
  path.join(__dirname, '../../../final hr data'),
];
// The master is not a source for adding; see the file header.
const EXCLUDE = /master of hr/i;

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const ymd = (v) => {
  const s = n(v); if (!s) return '';
  const num = Number(s);
  if (Number.isFinite(num) && num > 1000 && num < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + num * 86400000).toISOString().slice(0, 10);
  }
  if (/^1[34]\d{2}[-/]/.test(s)) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
const ID_HDR = /^(رقم الهوية|رقم الاقامة|الهوية|رقم الهويه)$/;
const NAME_HDR = /^(الاسم|اسم الموظف|الاسم بالكامل)$/;

// Sheet column to employee field. Anything not listed here is not guessed.
const COL_MAP = {
  'تاريخ الميلاد': ['dateOfBirth', ymd],
  'الرقم التأميني': ['medicalInsuranceNumber', n],
  'الرقم التأميني ': ['medicalInsuranceNumber', n],
  'الفئة': ['insuranceClass', n],
  'تاريخ انتهاء التأمين': ['insuranceExpiry', ymd],
  'السجل': ['medicalInsuranceRegister', n],
  'رقم الشهادة الصحية': ['healthCertNumber', n],
  'رقم كارت السائق': ['driverCardNumber', n],
  'نوعه': ['driverCardType', n],
  'نوع الرخصه قياده': ['licenseType', n],
  'انتهاء الرخصه القياده': ['licenseExpiry', ymd],
  'تاريخ التعيين': ['hireDate', ymd],
  'تاريخ مباشرة العمل': ['actualWorkStartDate', ymd],
  'القسم': ['department', n],
};
const NOT_REQUIRED = ['غير مطلوب', 'غير مطلوبة', 'لا يوجد', '-', '—'];

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  إضافةُ موظّفي الشيتات الناقصين — تنفيذ' : '  إضافةُ موظّفي الشيتات الناقصين — فحصٌ فقط');
  console.log('='.repeat(72));
  await mongoose.connect(process.env.MONGODB_URI);

  const have = new Set();
  for (const e of await Employee.find({}).select('iqamaNumber nationalId').lean()) {
    for (const k of [e.iqamaNumber, e.nationalId]) if (n(k)) have.add(n(k));
  }

  const found = new Map();
  for (const dir of DETAIL_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xlsx') && !x.startsWith('~') && !EXCLUDE.test(x))) {
      const p = path.join(dir, f);
      let sheets;
      try {
        sheets = require('child_process').execSync(`unzip -Z1 ${JSON.stringify(p)} "xl/worksheets/sheet*.xml"`).toString().trim().split('\n');
      } catch (e) { continue; }
      for (const sh of sheets) {
        let rows; try { rows = xlsx.readSheet(p, sh); } catch (e) { continue; }
        const hdr = rows.find((r) => r.cells && Object.values(r.cells).some((v) => ID_HDR.test(n(v))));
        if (!hdr) continue;
        const cols = {}; Object.entries(hdr.cells).forEach(([k, v]) => { cols[k] = n(v); });
        const idc = Object.keys(cols).find((k) => ID_HDR.test(cols[k]));
        const nmc = Object.keys(cols).find((k) => NAME_HDR.test(cols[k]));
        for (const r of rows) {
          if (r.r <= hdr.r || !r.cells) continue;
          const id = n(r.cells[idc]);
          if (!id || have.has(id) || !/^\d{8,}$/.test(id)) continue;
          if (!found.has(id)) found.set(id, { iqamaNumber: id, sources: new Set() });
          const rec = found.get(id);
          rec.sources.add(f.replace('.xlsx', ''));
          if (nmc && n(r.cells[nmc]) && !rec.fullNameAr) rec.fullNameAr = n(r.cells[nmc]);
          for (const [col, key] of Object.entries(cols)) {
            const map = COL_MAP[key]; if (!map) continue;
            const raw = r.cells[col];
            if (NOT_REQUIRED.includes(n(raw))) continue;
            const val = map[1](raw);
            if (val && !rec[map[0]]) rec[map[0]] = val;
          }
        }
      }
    }
  }

  console.log(`\n  موظّفون في الشيتات التفصيليّة وليسوا عندنا: ${found.size}\n`);
  for (const r of found.values()) {
    const known = Object.entries(r).filter(([k]) => !['sources', 'iqamaNumber'].includes(k)).length;
    console.log(`   ${r.iqamaNumber} · ${r.fullNameAr || '(بلا اسم)'} · ${known} حقلًا · من ${r.sources.size} ملفًّا`);
  }

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  if (!found.size) { console.log('\n  لا شيءَ يُضاف.\n'); await mongoose.disconnect(); return; }

  const created = [];
  for (const r of found.values()) {
    const { sources, ...doc } = r;
    // The full name is split into first and last as the rest of the system does, and the full name is kept as written in the sheet.
    const parts = (doc.fullNameAr || '').split(/\s+/).filter(Boolean);
    if (parts.length) { doc.firstName = parts[0]; doc.lastName = parts.slice(1).join(' ') || parts[0]; }
    doc.arabicName = doc.fullNameAr || '';
    doc.employmentStatus = 'active';
    doc.idType = 'iqama';
    doc.isHrRecord = true;
    const e = await Employee.create(doc);
    created.push(`${e.iqamaNumber} · ${doc.fullNameAr}`);
  }
  console.log(`\n  أُضيف: ${created.length}`);
  created.forEach((c) => console.log('   ', c));
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
