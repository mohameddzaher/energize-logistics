/* eslint-disable no-console */
/**
 * Imports the final HR data files (August 2026) from seeds/data/hr-2026-08/, keyed by the ID number normalized to contiguous Latin digits (otherwise one employee becomes two). --dry plans, --yes applies; idempotent.
 * Each cell is a real value (stored, old status flag cleared), required (<field>Status=required) or not required (<field>Status=not_required); empty or zero counts as required. Uses the existing mechanism in config/hrFields.js and controllers/hrMasterController.js; not required never erases a stored value. The commercial register follows insurance (see registerFollowsInsurance).
 * Human work is not overwritten: later renewals win, and records with updatedAt newer than lastImportAt only get fields the sheet adds. Fields the files never carry (salary, IBAN, etc.) are never written.
 * Employees absent from the files and employmentStatus changes are printed for a person to decide, never applied.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const H = require('../config/hrFields');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry') || !ARGV.includes('--yes');
const DIR = path.join(__dirname, '..', 'seeds', 'data', 'hr-2026-08');

// Reading cells
const S = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const AR_DIGITS = (t) => String(t)
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** A real number or null. Text that does not read as a number is not zero, it is no number. */
const N = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = AR_DIGITS(String(v)).replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// Excel date serials: 46311 = 16 Oct 2026. The epoch is 30 Dec 1899, not 1 Jan 1900, because of a fictitious 1900 leap year inherited from Lotus 1-2-3. Subtracting from the wrong epoch shifts every date in the file by a day.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
// Sanity bounds: 20000 is about 1954 and 75000 about 2105. An ID number that fell into a date cell is outside this range, and accepting it would produce a date in the 25th century.
const serialToDate = (n) => {
  if (!Number.isFinite(n) || n < 20000 || n > 75000) return null;
  const d = new Date(EXCEL_EPOCH + Math.round(n) * DAY);
  return Number.isNaN(d.getTime()) ? null : d;
};
const D = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const n = N(v);
  if (n !== null) return serialToDate(n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
/** A day as YYYY-MM-DD in UTC, the same as the string date fields store. */
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const show = (v) => (v === '' || v === null || v === undefined ? '—' : (v instanceof Date ? iso(v) : String(v)));

/** Match key: contiguous Latin digits. Without it one employee becomes two; see the file header. */
const idKey = (v) => AR_DIGITS(S(v)).replace(/[\s\-_ـ]/g, '');

const filled = (v) => !(v === '' || v === null || v === undefined
  || (v instanceof Date && Number.isNaN(v.getTime())));

/**
 * The reason a value is absent, or '' if the cell holds a real value.
 * Zero is deliberately treated as empty: Excel writes it in place of an empty cell in many numeric columns here (national address, direct manager, register number), and keeping it made 0 a national address for 132 employees and an option in the address filter.
 */
const sentinel = (raw) => {
  const t = S(raw).replace(/ـ/g, '');
  if (t === '' || t === '0' || t === '-' || t === '—' || t === '_') return 'required';
  if (/^غير\s*مطلوب$/.test(t)) return 'not_required';
  if (/^مطلوب$/.test(t)) return 'required';
  if (/^لا\s*يوجد$/.test(t)) return 'none';
  return '';
};

// Column map: every column of every file and where it goes.
// status:false means a column with no room for required/not required: the type column holds zero or the freelancer label, and zero there is an explicit answer (not freelance), not an empty cell. Treated as empty it would make 313 employees missing a type.
const SHEETS = [
  {
    file: 'ارقام ابشر موظفين.xlsx',
    cols: [{ header: 'رقم ابشر', field: 'absherNumber', kind: 'phone' }],
  },
  {
    file: 'الارقام الوظيفية للموظفين.xlsx',
    cols: [{ header: 'الرقم الوظيفي', field: 'employeeNumber', kind: 'digits' }],
  },
  {
    file: 'الاقامة والمهنة للموظفين.xlsx',
    cols: [
      { header: 'تاريخ انتهاء الاقامه', field: 'iqamaExpiry', kind: 'date' },
      { header: 'المهنه في الاقامه', field: 'iqamaProfession', kind: 'text' },
    ],
  },
  {
    file: 'الجنسيات للموظفين.xlsx',
    cols: [{ header: 'الجنسيه', field: 'nationality', kind: 'text' }],
  },
  {
    file: 'السجل للموظفين.xlsx',
    cols: [{ header: 'رقم السجل', field: 'registerNumber', kind: 'digits' }],
  },
  {
    file: 'العنوان الوطني للموظفين.xlsx',
    cols: [{ header: 'العنوان الوطني', field: 'address', kind: 'text' }],
  },
  {
    file: 'القسم والمسمى الوظيفي للموظفين.xlsx',
    cols: [
      { header: 'القسم', field: 'department', kind: 'text' },
      { header: 'الفرع', field: 'branchName', kind: 'text' },
      { header: 'المدير المباشر', field: 'directManagerName', kind: 'text' },
      { header: 'المسمى الوظيفي', field: 'jobTitle', kind: 'text' },
      // The type column is boolean-like, not text; see the comment above.
      { header: 'النوع', field: 'isFreelancer', kind: 'freelancer', status: false },
    ],
  },
  {
    file: 'ايميلات الموظفين.xlsx',
    cols: [{ header: 'الايميل', field: 'email', kind: 'email' }],
  },
  {
    file: 'جنس الموظفين.xlsx',
    cols: [{ header: 'الجنس', field: 'gender', kind: 'gender' }],
  },
  {
    file: 'جواز السفر للموظفين.xlsx',
    cols: [
      { header: 'رقم جواز السفر', field: 'passportNumber', kind: 'text' },
      { header: 'تاريخ الانتهاء', field: 'passportExpiry', kind: 'date' },
    ],
  },
  {
    file: 'حالة العمل للموظفين.xlsx',
    cols: [{ header: 'حاله العمل', field: 'workStatusText', kind: 'text' }],
  },
  {
    file: 'رخص عمل الموظفين.xlsx',
    cols: [{ header: 'تاريخ انتهاء رخصة العمل', field: 'workPermitExpiry', kind: 'date' }],
  },
  {
    // Commercial register and social insurance.
    // It is deliberately placed after the employees register file: both carry the same column and the last in this list wins its value in p.fields. This one was delivered later so it is the reference; if it came first the old register number would be written over the new one.
    file: 'ملف السجل و التأمينات الاجتماعية للموظفين .xlsx',
    registerFollowsInsurance: true,
    cols: [
      // Zero here is Excel's drawing of an empty cell, not a register number, and sentinel reads it as empty so it is never stored. Stored, it would become a commercial register for 55 employees and a phantom option in the register filter.
      { header: 'رقم السجل', field: 'registerNumber', kind: 'digits' },
      { header: 'التأمينات الاجتماعية', field: 'socialInsuranceStatus', kind: 'gosiStatus' },
    ],
  },
  {
    // Contracts: one row per contract. Its columns are read here as a snapshot on the employee, and again in section 3 to become a standalone contract document.
    file: 'ملف عقود الموظفين.xlsx',
    contracts: true,
    cols: [
      { header: 'المهنة في العقد', field: 'contractOccupation', kind: 'text' },
      { header: 'تاريخ بداية العقد', field: 'contractStartDate', kind: 'date' },
      { header: 'تاريخ نهاية العقد', field: 'contractEndDate', kind: 'date' },
      { header: 'الاجازه السنوية', field: 'annualLeaveDays', kind: 'digits' },
      { header: 'فترة التجربة', field: 'probationPeriod', kind: 'text' },
      // The register column here is read for comparison and gap-filling, not as the reference; see the file-reading section.
      { header: 'السجل', field: 'registerNumber', kind: 'digits', fallbackOnly: true },
    ],
  },
];

/** Employment status from the work status text; read for newly created employees only. */
const employmentFromText = (t) => {
  const s = S(t);
  if (!s) return 'active';
  if (/^اجازة$/.test(s)) return 'on_leave';
  if (/خروج نهائي|استقالة|لا يعمل|نقل الكفالة|انهاء العقد|تغيب/.test(s)) return 'terminated';
  return 'active';
};

/** Cell value by column type. */
function readCell(kind, raw) {
  switch (kind) {
    case 'date': {
      const d = D(raw);
      return d ? iso(d) : null;
    }
    case 'digits': {
      const t = AR_DIGITS(S(raw)).replace(/[\s,]/g, '');
      return /^\d+$/.test(t) ? t : (t || null);
    }
    case 'phone': {
      // Excel reads a leading-zero mobile number as a number and drops the zero; carrying it over would change every mobile in the system to nine digits nobody can call.
      const t = AR_DIGITS(S(raw)).replace(/[\s+\-()]/g, '');
      if (/^5\d{8}$/.test(t)) return `0${t}`;
      return t || null;
    }
    case 'email': {
      const t = S(raw).toLowerCase();
      return /@/.test(t) ? t : null;
    }
    case 'gender': {
      // The DB stores male/female (an enum in the model) and the sheet writes Arabic. Translate here, not there: changing the enum breaks everything written before.
      const t = S(raw);
      if (/^(ذكر|male|m)$/i.test(t)) return 'male';
      if (/^(انثى|أنثى|female|f)$/i.test(t)) return 'female';
      return null;
    }
    case 'gosiStatus': {
      // The field is free text in the model, and the DB holds Arabic values from earlier imports. Known spellings are unified here: two spellings of inactive are one state, and leaving both makes two filter options for one thing and splits the counter.
      // Unknown values pass through as they are, neither invented nor dropped.
      const t = S(raw);
      if (/^نشط$/.test(t)) return 'نشط';
      if (/^غير\s*نشط$/.test(t)) return 'غير نشط';
      return t || null;
    }
    case 'freelancer':
      return /فري\s*لانسر|freelanc/i.test(S(raw));
    default:
      return S(raw) || null;
  }
}

// Reading a file
/**
 * A file's rows with its header row.
 * The header is not always the first row: the contracts file's first row holds counters the file wrote for itself (46, repeated) and its headers are in the second. So search for the row containing the ID header rather than assuming a position, otherwise the counters are read as headers and no column matches.
 */
function readSheet(file) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return { missing: true, head: [], body: [], headerRow: 0 };
  const wb = XLSX.readFile(full);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let hi = 0;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if ((rows[i] || []).some((c) => /الهوية/.test(S(c)))) { hi = i; break; }
  }
  const head = (rows[hi] || []).map(S);
  const body = [];
  rows.slice(hi + 1).forEach((r, i) => {
    // Completely empty rows are not rows: the contracts file's used range is 929 rows but only 269 are contracts, the rest is blank sheet. Counting them as incomplete rows would fill the report with 660 phantom rows without an ID.
    if (!r || !r.some((c) => c !== null && c !== '')) return;
    body.push({ row: r, sheetRow: hi + i + 2 });
  });
  return { missing: false, head, body, headerRow: hi + 1 };
}

(async () => {
  const missingFiles = SHEETS.filter((s) => !fs.existsSync(path.join(DIR, s.file)));
  if (missingFiles.length) {
    console.error(`ملفات غير موجودة في ${DIR}:\n  ${missingFiles.map((s) => s.file).join('\n  ')}`);
    process.exit(1);
  }

  // File snapshot time. These files have no days-remaining column to derive the writing day from (as the vehicles file does), so the latest modification time of the files themselves is used. It is the basis for asking whether an employee renewed a document after the snapshot.
  const SNAPSHOT = new Date(Math.max(...SHEETS.map((s) => +fs.statSync(path.join(DIR, s.file)).mtime)));

  const skipped = [];   // Rows not read, and why
  const notes = [];     // Notes on the data itself
  const kept = [];      // What was left because a person wrote it after the file
  const sheetStats = [];

  // Step 1: read the 13 files into one plan keyed by ID number
  /** key → { key, names:Set, fields:{}, statuses:{}, fallback:{}, sources:Set } */
  const plan = new Map();
  const of = (key) => {
    if (!plan.has(key)) plan.set(key, { key, names: new Set(), fields: {}, statuses: {}, fallback: {}, sources: new Set() });
    return plan.get(key);
  };
  const contractRows = [];

  for (const spec of SHEETS) {
    const { head, body, headerRow } = readSheet(spec.file);
    const idIdx = head.findIndex((h) => /الهوية/.test(h));
    const nameIdx = head.findIndex((h) => /^الاسم/.test(h));
    if (idIdx < 0) { skipped.push(`${spec.file}: لا عمود «رقم الهوية» — لا مفتاح لصفوفه`); continue; }

    const idx = {};
    for (const c of spec.cols) {
      const i = head.indexOf(c.header);
      if (i < 0) { skipped.push(`${spec.file}: العمود «${c.header}» غير موجود`); continue; }
      idx[c.header] = i;
    }

    const seen = new Map();
    let rowsRead = 0; let dup = 0;
    for (const { row, sheetRow } of body) {
      const key = idKey(row[idIdx]);
      if (!key) {
        const junk = row.map(S).filter(Boolean).join(' | ').slice(0, 60);
        skipped.push(`${spec.file} صف ${sheetRow}: بلا رقم هوية${junk ? ` (${junk})` : ''}`);
        continue;
      }
      const p = of(key);
      p.sources.add(spec.file);
      const nm = nameIdx >= 0 ? S(row[nameIdx]) : '';
      if (nm) p.names.add(nm);
      rowsRead++;

      if (spec.contracts) {
        // The contracts file may have more than one row per person: it is a contract history, not one row per employee. Duplicates are not rejected here; a repeat of the same contract is rejected in step 3.
        contractRows.push({ key, sheetRow, row, idx, head });
      } else if (seen.has(key)) {
        dup++;
        skipped.push(`${spec.file} صف ${sheetRow}: الهوية «${key}» مكرّرة (الصف ${seen.get(key)}) — الأولى هي المعتمدة`);
        continue;
      }
      if (!spec.contracts) seen.set(key, sheetRow);

      // The contract snapshot on the employee comes from the contract with the latest start date. Row order in the sheet is not chronological, so last row wins would put an expired old contract on the employee and hide the active one.
      // All documents are recorded anyway in section 3.
      if (spec.contracts) {
        const si = idx['تاريخ بداية العقد'];
        const st = si === undefined ? null : D(row[si]);
        const stamp = st ? +st : -1;
        if (p.contractStamp !== undefined && stamp <= p.contractStamp) continue;
        p.contractStamp = stamp;
      }

      for (const c of spec.cols) {
        if (idx[c.header] === undefined) continue;
        const raw = row[idx[c.header]];
        const code = c.status === false ? '' : sentinel(raw);
        const value = code ? null : readCell(c.kind, raw);
        // A cell that is neither a reason for absence nor a readable value (unreadable date, email without @, unknown gender word) is reported and no value is invented.
        if (!code && value === null) {
          skipped.push(`${spec.file} صف ${sheetRow} · ${c.header}: «${S(raw)}» لا تُقرأ ${c.kind} — تُرِكت`);
          continue;
        }
        const bucket = c.fallbackOnly ? p.fallback : p.fields;
        if (code) { if (!c.fallbackOnly) p.statuses[c.field] = code; continue; }
        // Contract rows were filtered above to the latest start only, so what arrives here is the current contract, not the last row in the sheet.
        bucket[c.field] = value;
      }

      // A blank register where insurance says not required is a decision, not a gap.
      // Leaving it required would put 55 names on the HR worklist to collect a register number that the file itself, in the adjacent column, says is not required. This is the same mix-up that makes the list wrong (see file header).
      if (spec.registerFollowsInsurance
        && p.statuses.socialInsuranceStatus === 'not_required'
        && !filled(p.fields.registerNumber)) {
        p.statuses.registerNumber = 'not_required';
      }
    }
    sheetStats.push({ file: spec.file, headerRow, rows: rowsRead, dup, ids: spec.contracts ? new Set(contractRows.map((r) => r.key)).size : seen.size });
  }

  // Commercial register: its own file is the reference, and contracts fill its gaps.
  // The two files are in the same package and say the same thing, but the register file leaves 55 cells empty while the contracts file carries a number for some of them. Leaving them required when the package has the answer puts names on a worklist with nothing to do. The register file stays the reference when it speaks, and conflicts are printed, not swallowed.
  // A real number in the contracts file beats the not-required flag copied from insurance: someone with a register number is on a register, and the flag was an inference from emptiness, not a statement.
  let regFilled = 0; let regOverNotRequired = 0; const regConflict = [];
  for (const p of plan.values()) {
    const fb = p.fallback.registerNumber;
    if (!fb) continue;
    if (!filled(p.fields.registerNumber)) {
      if (p.statuses.registerNumber === 'not_required') regOverNotRequired++;
      p.fields.registerNumber = fb;
      delete p.statuses.registerNumber;
      regFilled++;
    } else if (p.fields.registerNumber !== fb) {
      regConflict.push(`${p.key}: «السجل» ${p.fields.registerNumber} · «ملف عقود» ${fb} — اعتُمد الأول`);
    }
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const EmployeeRenewal = require('../models/EmployeeRenewal');

  console.log(`المصدر: ${path.basename(DIR)} — ${SHEETS.length} ملفًّا`);
  console.log(`لقطة الملفّات: ${iso(SNAPSHOT)}`);
  console.log(DRY ? '\n═══ تجربة — لن يُكتب شيء ═══\n' : '\n═══ تنفيذ ═══\n');

  console.log('الملفّات المقروءة:');
  for (const s of sheetStats) {
    console.log(`   ${s.file.padEnd(38, '·')} عناوينه في الصف ${s.headerRow} · ${s.rows} صفًّا · ${s.ids} هوية${s.dup ? ` · ${s.dup} مكرّرة` : ''}`);
  }
  console.log(`   الإجمالي: ${plan.size} هوية مميّزة\n`);

  // Step 2: matching against the database
  const all = await Employee.find({}).lean();
  const byIqama = new Map();
  for (const e of all) {
    // Identity is two fields, not one: a resident's number is in iqamaNumber and a Saudi's in nationalId, while the sheet calls the column ID number for both. Matching on one field makes the Saudi look absent, and a second record is created on every import (this happened with one employee, #1230).
    for (const raw of [e.iqamaNumber, e.nationalId]) {
      const k = idKey(raw);
      // First wins: a record with a duplicate ID exists in the DB, and writing to the second makes the screen show the first without the update, so the import looks like it did nothing.
      if (k && !byIqama.has(k)) byIqama.set(k, e);
    }
  }

  // Each field's type is read from the schema, not a hand-written list: some date fields in this model are strings (iqamaExpiry) and some real dates (healthCertExpiry). Writing a Date into a string path stores a long date string that no filter can read.
  const instanceOf = (k) => (Employee.schema.path(k) || {}).instance || 'String';
  const coerce = (k, v) => {
    if (v === null || v === undefined) return v;
    switch (instanceOf(k)) {
      case 'Date': return v instanceof Date ? v : (D(v) || null);
      case 'Number': { const n = N(v); return n === null ? undefined : n; }
      case 'Boolean': return v === true || v === 'true' || v === 1 || v === '1';
      default: return v instanceof Date ? iso(v) : String(v);
    }
  };

  /**
   * Last-import stamp: written after the save, with a write that does not move updatedAt.
   * If written with the save, updatedAt would be fractionally newer (mongoose sets it in the same save), so on the next run every record would read as touched by a person and nothing would ever be written to it: the import would disable itself from the first run.
   */
  const stampImport = (id) => Employee.updateOne(
    { _id: id }, { $set: { lastImportAt: new Date() } }, { timestamps: false });

  // Renewals recorded by an employee after the file snapshot: newer than the paper, so they take precedence.
  const DOC_OF_FIELD = {
    iqamaExpiry: 'iqama', passportExpiry: 'passport',
    workPermitExpiry: 'workPermit', contractEndDate: 'contract',
  };
  const freshRenewals = new Map();  // `${empId}:${docType}` → renewal
  for (const r of await EmployeeRenewal.find({ renewedAt: { $gt: SNAPSHOT } }).sort({ renewedAt: 1 }).lean()) {
    freshRenewals.set(`${r.employee}:${r.docType}`, r);
  }

  const sum = {
    employeesCreated: 0, employeesUpdated: 0, employeesUnchanged: 0,
    valuesWritten: 0, statusRequired: 0, statusNotRequired: 0, statusCleared: 0,
    keptUserRenewals: 0, keptUserFields: 0, keptOverSentinel: 0,
    namesDiffer: 0,
    contractsCreated: 0, contractsUpdated: 0, contractsUnchanged: 0, contractsSkipped: 0,
    contractsRetired: 0,
  };
  const created = [];
  const workStatusDrift = [];
  // The register number is announced separately: changing it for an employee is not filling a gap, it moves him from one commercial register to another, and authority reports and insurance subscriptions are built on it. It would pass through this script like any other field unseen, so it is printed with both numbers for a person to confirm.
  const regChanged = [];
  const empByKey = new Map();   // key -> employee document after save (needed by section 3)

  for (const p of [...plan.values()]) {
    const name = [...p.names][0] || '';
    let emp = byIqama.get(p.key);
    const isNew = !emp;

    if (isNew) {
      // The name is split: the first word is the first name and the rest the last name, since the model requires both. A single-word name takes the same word on both sides so the row does not fail on a field nobody reads.
      const parts = name.split(' ').filter(Boolean);
      if (!name) { skipped.push(`الهوية ${p.key}: جديدة وبلا اسمٍ في أيّ ملف — لم تُنشَأ`); continue; }
      const doc = {
        iqamaNumber: p.key,
        arabicName: name,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || parts[0],
        // A Saudi ID starts with 1 and an iqama with 2, a government rule that holds for all 360 here without exception. Without it a Saudi shows as missing an iqama.
        idType: /^1/.test(p.key) ? 'national_id' : 'iqama',
        isHrRecord: true,
        inCurrentMaster: true,
        // Employment status is read at creation only. See the file header.
        employmentStatus: employmentFromText(p.fields.workStatusText),
      };
      created.push({ key: p.key, name, status: doc.employmentStatus, work: p.fields.workStatusText || '—' });
      if (DRY) {
        sum.employeesCreated++;
        // A dummy id in dry run, otherwise every contract of a new employee would look like a row without an employee and the contracts plan would hide what it will really do on apply.
        empByKey.set(p.key, { _id: new mongoose.Types.ObjectId(), __dry: true });
      } else {
        emp = new Employee(doc);
        for (const [k, v] of Object.entries(p.fields)) {
          if (!Employee.schema.path(k)) continue;
          const cv = coerce(k, v);
          if (cv !== undefined) { emp.set(k, cv); sum.valuesWritten++; }
        }
        for (const [k, code] of Object.entries(p.statuses)) {
          if (!H.getField(k)) continue;
          emp.fieldStatus.set(H.statusKeyOf(k), code);
          if (code === 'required') sum.statusRequired++; else if (code === 'not_required') sum.statusNotRequired++;
        }
        await emp.save();
        await stampImport(emp._id);
        sum.employeesCreated++;
        empByKey.set(p.key, emp);
      }
      continue;
    }

    // Existing employee
    const doc = DRY ? null : await Employee.findById(emp._id);
    const current = emp;                              // Snapshot before writing
    const touched = current.lastImportAt
      ? new Date(current.updatedAt) > new Date(current.lastImportAt)
      : false;
    let changed = false;

    // Membership in the current HR file: the name appearing in these files is the definition of being in the current master, and each screen in the section scopes by it by default. Someone outside it who returns stays hidden from every counter and list until the filter is lifted, although he is working.
    if (!current.inCurrentMaster) {
      if (!DRY) doc.set('inCurrentMaster', true);
      changed = true;
      notes.push(`${p.key} · ${name}: كان خارج الماستر الحاليّ وهو في الملفّات — أُعيد إليه`);
    }

    // The name is compared, not written. The name column in these files identifies the row, it is not its subject (that is each file's last column). Arabic names have several spellings, so overwriting would flip hundreds of names back and forth on every delivery. Differences are printed to be corrected where they belong.
    if (name && S(current.arabicName) && S(current.arabicName) !== name) {
      sum.namesDiffer++;
      notes.push(`اسمٌ مختلف — ${p.key}: الملفّ «${name}» · وعندنا «${S(current.arabicName)}» (لم يُغيَّر)`);
    }

    // The work status is written as text and does not move the employment enum; the difference is printed for a decision.
    const wantEmployment = employmentFromText(p.fields.workStatusText);
    if (p.fields.workStatusText && wantEmployment !== current.employmentStatus) {
      workStatusDrift.push(`${p.key} · ${name}: الشيت «${p.fields.workStatusText}» (${wantEmployment}) · وعندنا ${current.employmentStatus}`);
    }

    for (const [k, v] of Object.entries(p.fields)) {
      if (!Employee.schema.path(k)) { notes.push(`الحقل «${k}» ليس في موديل الموظّف — لم يُكتب`); continue; }
      const before = current[k];
      const cv = coerce(k, v);
      if (cv === undefined) continue;

      // (a) A renewal recorded by an employee after the file snapshot takes precedence over the paper.
      const docType = DOC_OF_FIELD[k];
      const ren = docType ? freshRenewals.get(`${current._id}:${docType}`) : null;
      if (ren) {
        kept.push(`${p.key} · ${name} · ${k}: الملفّ ${show(cv)} · جُدِّد إلى ${show(ren.newExpiry)} بعد اللقطة`);
        sum.keptUserRenewals++;
        continue;
      }
      if (String(before ?? '') === String(cv ?? '')) continue;
      if (k === 'registerNumber' && filled(before)) {
        regChanged.push(`${p.key} · ${name}: عندنا ${show(before)} · والملفّ ${show(cv)}`);
      }

      // (b) A record touched by a person after the last import: the sheet fills empty fields and never overwrites written ones. A paper snapshot taken before the employee opened the screen is not newer than what he wrote while looking at the person. What is left out is printed with both values for a decision.
      if (touched && filled(before)) {
        kept.push(`${p.key} · ${name} · ${k}: الملفّ «${show(cv)}» · وكتب موظّفٌ «${show(before)}» بعد آخر استيراد — بقيت`);
        sum.keptUserFields++;
        continue;
      }
      if (!DRY) doc.set(k, cv);
      changed = true; sum.valuesWritten++;
    }

    // (c) A status never erases a value; it is written beside it.
    for (const [k, code] of Object.entries(p.statuses)) {
      if (!H.getField(k)) continue;
      if (filled(current[k])) {
        // A cell with no value in the sheet where we have one: our value stays. statusOf prefers the value over the required flag and keeps not required as an administrative decision above it.
        kept.push(`${p.key} · ${name} · ${k}: الشيت «${H.statusLabel(code)}» · وعندنا «${show(current[k])}» — بقيت`);
        sum.keptOverSentinel++;
        // required is not written over a filled field: the model's pre-save hook clears it at once (rightly, the field is not missing), so every run would write and clear it and the import would never settle or be a no-op on re-run. Not required is an administrative decision that stays above the value, so it is written.
        if (code === 'required') continue;
      }
      if (String(current.fieldStatus?.[H.statusKeyOf(k)] ?? '') === code) continue;
      if (!DRY) doc.fieldStatus.set(H.statusKeyOf(k), code);
      changed = true;
      if (code === 'required') sum.statusRequired++; else if (code === 'not_required') sum.statusNotRequired++;
    }
    // (d) A real value from the sheet clears any old status flag on its field.
    for (const k of Object.keys(p.fields)) {
      if (!H.getField(k)) continue;
      if (!(H.statusKeyOf(k) in (current.fieldStatus || {}))) continue;
      if (!DRY) doc.fieldStatus.delete(H.statusKeyOf(k));
      changed = true; sum.statusCleared++;
    }

    if (changed) {
      sum.employeesUpdated++;
      if (!DRY) { await doc.save(); await stampImport(doc._id); }
    } else sum.employeesUnchanged++;
    empByKey.set(p.key, DRY ? null : (doc || emp));
  }

  // Step 3: contracts, one document per row, matched so re-runs do not duplicate.
  // The stable key is (employee + start date), not the row number: a second contract for the same person joins his history, and a key from row order would change for every row when one is inserted. The file's used range is 929 rows with 269 real contracts.
  // Salary and allowances are never touched: the file does not carry them, and an existing salary is truer than an invented zero.
  const today = iso(new Date());
  const byEmployeeContracts = new Map();
  for (const cr of contractRows) {
    const emp = empByKey.get(cr.key) || byIqama.get(cr.key);
    if (!emp) {
      skipped.push(`عقود صف ${cr.sheetRow}: الهوية «${cr.key}» بلا موظّف — لم يُسجَّل العقد`);
      sum.contractsSkipped++;
      continue;
    }
    const cell = (h) => (cr.idx[h] === undefined ? null : cr.row[cr.idx[h]]);
    const startD = sentinel(cell('تاريخ بداية العقد')) ? null : D(cell('تاريخ بداية العقد'));
    const endD = sentinel(cell('تاريخ نهاية العقد')) ? null : D(cell('تاريخ نهاية العقد'));
    if (!startD) {
      // Without a start date there is no stable contract key and the model rejects it. The contract snapshot on the employee (section 1) is kept and no document is invented with a fabricated date.
      skipped.push(`عقود صف ${cr.sheetRow} (${cr.key}): «${show(S(cell('تاريخ بداية العقد')))}» ليست تاريخ بداية — لا مفتاح للعقد`);
      sum.contractsSkipped++;
      continue;
    }
    const leave = N(cell('الاجازه السنوية'));
    const startDate = iso(startD);
    const endDate = endD ? iso(endD) : '';
    const doc = {
      employee: emp._id,
      type: endDate ? 'fixed' : 'unlimited',
      startDate,
      endDate,
      // Duration is computed from the file's own two dates, not assumed to be twelve months.
      durationMonths: endD ? Math.max(1, Math.round((endD - startD) / DAY / 30.4375)) : 0,
      // The default 21 is the model's own default, and the field is required there.
      annualLeaveDays: leave === null ? 21 : leave,
      jobTitle: sentinel(cell('المهنة في العقد')) ? '' : S(cell('المهنة في العقد')),
    };
    if (!byEmployeeContracts.has(String(emp._id))) byEmployeeContracts.set(String(emp._id), []);
    byEmployeeContracts.get(String(emp._id)).push({ doc, sheetRow: cr.sheetRow, key: cr.key, endDate });

    const found = await Contract.findOne({ employee: emp._id, startDate });
    if (!found) {
      // Active or expired is a fact read from the date, not a decision we make.
      const body = { ...doc, status: endDate && endDate < today ? 'expired' : 'active' };
      if (!DRY) await Contract.create(body);
      sum.contractsCreated++;
      continue;
    }
    const before = JSON.stringify(found.toObject());
    found.set(doc);
    // Terminated is a human decision with its own procedure (settlement, custody return); an expiry date written in a sheet does not bring it back, and reviving it would return someone who really left to the lists.
    if (found.status !== 'terminated') found.status = endDate && endDate < today ? 'expired' : 'active';
    // The before/after comparison is what makes a re-run a no-op: without it every contract is saved on every run and updatedAt moves for 269 unchanged contracts.
    if (before === JSON.stringify(found.toObject())) { sum.contractsUnchanged++; continue; }
    if (!DRY) await found.save();
    sum.contractsUpdated++;
  }

  // The latest contract is the employee's snapshot, and an older expired one does not stay active.
  for (const [empId, list] of byEmployeeContracts) {
    const newest = list.slice().sort((a, b) => (a.doc.startDate < b.doc.startDate ? 1 : -1))[0];
    if (!newest) continue;
    // Another contract in the DB whose end date has passed but is still marked active is not an opinion to change but an error the date corrects; the model states one active contract per employee.
    const others = await Contract.find({ employee: empId, status: 'active', startDate: { $ne: newest.doc.startDate } }).lean();
    for (const o of others) {
      if (!o.endDate || o.endDate >= today) continue;
      if (!DRY) await Contract.updateOne({ _id: o._id }, { $set: { status: 'expired' } });
      notes.push(`عقدٌ سابق (${o.startDate} → ${o.endDate}) كان «ساريًا» وقد انتهى — صار «منتهيًا»`);
      sum.contractsRetired++;
    }
  }

  // Step 4: in the DB but not in the files; printed, never touched
  const sheetKeys = new Set(plan.keys());
  const dbOnly = all
    .filter((e) => e.isHrRecord !== false
      && !sheetKeys.has(idKey(e.iqamaNumber))
      && !sheetKeys.has(idKey(e.nationalId)))
    .map((e) => ({
      id: e.iqamaNumber || '—',
      name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—',
      status: e.employmentStatus, master: !!e.inCurrentMaster,
    }));

  // Report
  console.log('النتيجة:', JSON.stringify(sum, null, 1));

  if (created.length) {
    console.log(`\nموظّفون جدد — ليسوا في القاعدة (${created.length}):`);
    created.forEach((c) => console.log(`   ${c.key} · ${c.name} · حالة العمل «${c.work}» → ${c.status}`));
  }
  if (regFilled || regConflict.length) {
    console.log(`\nالسجلّ التجاريّ: ${regFilled} خانةً فارغةً في «ملف السجل» سدّها «ملف عقود الموظفين»`
      + `${regConflict.length ? ` · ${regConflict.length} خلافًا` : ''}`);
    regConflict.slice(0, 15).forEach((c) => console.log('   ' + c));
  }
  const regNotRequired = [...plan.values()].filter((p) => p.statuses.registerNumber === 'not_required').length;
  if (regNotRequired || regOverNotRequired) {
    console.log(`\nرقم السجل: ${regNotRequired} خانةً فارغةً قُرئت «غير مطلوب» لأنّ تأمينات صاحبها «غير مطلوبة» — لا «مطلوب»`
      + `${regOverNotRequired ? ` · و${regOverNotRequired} منها ردّها ملفُّ العقود برقمٍ حقيقيّ` : ''}`);
  }
  if (regChanged.length) {
    console.log(`\nرقم سجلٍّ تجاريٍّ مكتوبٍ عندنا يخالف الملفّ (${regChanged.length}) — الملفّ هو المرجع، فتأكّدوا منها:`);
    regChanged.forEach((r) => console.log('   ' + r));
  }
  if (workStatusDrift.length) {
    console.log(`\n«حاله العمل» تخالف حالة التوظيف عندنا (${workStatusDrift.length}) — لم تُغيَّر، تُقرَّر على الشاشة:`);
    workStatusDrift.slice(0, 30).forEach((w) => console.log('   ' + w));
    if (workStatusDrift.length > 30) console.log(`   … و${workStatusDrift.length - 30} غيرها`);
  }
  if (kept.length) {
    console.log(`\nتُرك كما هو — أحدثُ من الملفّ أو أصدقُ منه (${kept.length}):`);
    kept.slice(0, 30).forEach((k) => console.log('   ' + k));
    if (kept.length > 30) console.log(`   … و${kept.length - 30} غيرها`);
  }
  if (skipped.length) {
    console.log(`\nصفوف/خانات لم تُقرأ (${skipped.length}) — ولماذا:`);
    skipped.slice(0, 40).forEach((s) => console.log('   ' + s));
    if (skipped.length > 40) console.log(`   … و${skipped.length - 40} غيرها`);
  }
  if (dbOnly.length) {
    console.log(`\nفي القاعدة وليسوا في الملفّات — ${dbOnly.length} موظّفًا · لن يُمَسّوا (لا حذف ولا تعطيل):`);
    dbOnly.forEach((e) => console.log(`   ${e.id} · ${e.name} · ${e.status}${e.master ? ' · في الماستر' : ''}`));
  }
  if (notes.length) {
    console.log(`\nملاحظات (${notes.length}):`);
    [...new Set(notes)].slice(0, 30).forEach((n) => console.log('   ' + n));
  }

  if (DRY) {
    console.log('\nلم يُكتب شيء. للتنفيذ:');
    console.log('   node src/scripts/importFinalHrData2026.js --yes');
  } else {
    console.log(`\nفي النظام الآن: ${await Employee.countDocuments({ isHrRecord: { $ne: false } })} موظّفًا`
      + ` · ${await Contract.countDocuments({})} عقدًا`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
