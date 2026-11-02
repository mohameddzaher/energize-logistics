/**
 * Imports employee leaves from the employee leaves workbook: 130 employees, 14 slots each, four columns per slot (type, departure, return, duration) under year headers. Slots saying no leave taken carry no dates and are skipped; about 250 are real leaves.
 * They are recorded backdated, as HR would from the screen: approved, flagged backdated, under the name of who entered them. This mirrors hrController.createBackdatedLeave so there are not two diverging ways to record a leave, and it makes utils/leaveBalance correct.
 * Dates are read as raw serials: cellDates: true loses a day on this machine (see the XLSX date epoch trap).
 * node src/scripts/importEmployeeLeaves.js [--file=<path>] [--apply]  (preview without --apply)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const Employee = require(`${ROOT}/models/Employee`);
const LeaveType = require(`${ROOT}/models/LeaveType`);
const LeaveRequest = require(`${ROOT}/models/LeaveRequest`);
const User = require(`${ROOT}/models/User`);
const { computeBalance, leaveDays } = require(`${ROOT}/utils/leaveBalance`);
const { nameKey } = require(`${ROOT}/utils/nameKey`);

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
/** Entry tag: identifies what came from this file and lets all of it be withdrawn if needed. */
const IMPORT_TAG = 'مستورَدة من ملفّ إجازات الموظفين';
const FILE = (process.argv.find((a) => a.startsWith('--file=')) || '').slice(7)
  || path.join(__dirname, '../../../final hr data/new edits/ملف اجازات الموظفين.xlsx');

/** Excel serial -> YYYY-MM-DD. The epoch is 1899-12-30, and values before 1900-03-01 are not used. */
const serialToISO = (v, shiftDays = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = Math.round((n - 25569 + shiftDays) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

/** What is read in the type cell: a real leave or a statement of no leave? */
const isNonLeave = (t) => /لم\s*يحصل/.test(String(t || ''));

/**
 * Sheet type name -> system code.
 * Folding tolerates hamza, taa marbuta and spaces: one Eid leave type is written in the file with a missing letter but is the same Eid.
 */
const TYPE_MAP = [
  [/سنوي/, 'annual'],
  [/اضطرار|طارئ/, 'emergency'],
  [/مرضي/, 'sick'],
  [/زواج/, 'marriage'],
  [/عيد/, 'eid'],
  [/حج/, 'hajj'],
  [/وفا|عزا/, 'bereavement'],
  [/وضع|ولاد/, 'maternity'],
  [/بدون\s*راتب|غير\s*مدفوع/, 'unpaid'],
];
const codeOf = (t) => {
  const s = String(t || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  for (const [rx, code] of TYPE_MAP) if (rx.test(s)) return code;
  return '';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // The import has a rollback: 239 leaves are written into a register read by balances and payroll, so every entry gets one tag and all can be withdrawn with one command if the file turns out wrong.
  if (UNDO) {
    const n = await LeaveRequest.countDocuments({ reason: new RegExp(IMPORT_TAG) });
    if (!APPLY) {
      console.log(`سيُحذَف ${n} قيدًا مستورَدًا. (أضِف --apply)`);
    } else {
      const r = await LeaveRequest.deleteMany({ reason: new RegExp(IMPORT_TAG) });
      console.log(`حُذِف ${r.deletedCount} قيدًا مستورَدًا.`);
    }
    await mongoose.disconnect();
    return;
  }

  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
  const header = rows[1] || [];
  // Slot positions: every four columns are a slot, starting after the first four columns.
  const slots = [];
  for (let i = 4; i + 3 < header.length; i += 4) slots.push(i);

  // Matching: employee number, then iqama, then folded name
  const employees = await Employee.find({})
    .select('firstName lastName arabicName employeeNumber iqamaNumber nationalId user hireDate')
    .lean();
  const byNumber = new Map();
  const byIqama = new Map();
  const byName = new Map();
  for (const e of employees) {
    const num = String(e.employeeNumber || '').trim();
    if (num) byNumber.set(num, e);
    for (const id of [e.iqamaNumber, e.nationalId]) {
      const k = String(id || '').replace(/\D/g, '');
      if (k) byIqama.set(k, e);
    }
    for (const n of [e.arabicName, `${e.firstName || ''} ${e.lastName || ''}`]) {
      const k = nameKey(n);
      if (k && !byName.has(k)) byName.set(k, e);
    }
  }

  const types = await LeaveType.find({}).lean();
  const typeByCode = new Map(types.map((t) => [t.code, t]));

  // Eid leave is a new type. The file has 40 Eid leaves (Adha and Fitr) and the system has no type for them. Recording them as annual would deduct from a balance they do not touch, and skipping them would drop 40 real leaves.
  // So the type is created and does not deduct from the balance (affectsBalance: false); it can be flipped from the leave types screen.
  if (!typeByCode.has('eid')) {
    const def = {
      code: 'eid', nameEn: 'Eid Leave', nameAr: 'إجازة عيد',
      paid: true, affectsBalance: false, requiresAdvanceNotice: true, minAdvanceDays: 30,
      color: '#14b8a6', active: true,
    };
    if (APPLY) {
      const created = await LeaveType.create(def);
      typeByCode.set('eid', created.toObject());
      console.log('أُنشئ نوعُ «إجازة عيد».');
    } else {
      typeByCode.set('eid', { ...def, _id: 'EID_NEW' });
      console.log('(سيُنشأ نوعُ «إجازة عيد»)');
    }
  }

  // Who the entry is attributed to: the system admin account, never left unnamed.
  const actor = await User.findOne({ role: 'super_admin' }).select('_id firstName lastName').lean();
  const actorName = actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() : 'النظام';

  const stats = {
    rows: 0, slots: 0, nonLeave: 0, noDates: 0, unknownType: 0,
    unmatched: new Map(), created: 0, clash: 0, exists: 0,
  };
  const toCreate = [];

  for (const r of rows.slice(2)) {
    const name = String(r[3] || '').trim();
    if (!name) continue;
    stats.rows += 1;
    const num = String(r[0] ?? '').trim();
    const iqama = String(r[1] ?? '').replace(/\D/g, '');
    const emp = byNumber.get(num) || byIqama.get(iqama) || byName.get(nameKey(name)) || null;

    for (const i of slots) {
      const rawType = r[i];
      if (rawType == null || String(rawType).trim() === '') continue;
      stats.slots += 1;
      if (isNonLeave(rawType)) { stats.nonLeave += 1; continue; }
      // The return date is stored as written in the sheet.
      // All 250 were measured: the sheet's duration equals return minus departure, with no plus one, so the sheet does not count the return day. One day was subtracted the first time so the stored duration matched the sheet.
      // The department owner decided the date stays exactly as sent: the sheet date is the reference it is compared with, and a date one day off on screen is misread every time the sheet is reviewed. So the duration follows the date, not the reverse: it is stored inclusive of both ends (leaveDays), making each leave one day longer than the sheet, as intended.
      const startDate = serialToISO(r[i + 1]);
      const endDate = serialToISO(r[i + 2]);
      if (!startDate || !endDate) { stats.noDates += 1; continue; }
      const code = codeOf(rawType);
      if (!code || !typeByCode.has(code)) {
        stats.unknownType += 1;
        console.log(`  نوعٌ غيرُ معروف: «${String(rawType).trim()}» — ${name}`);
        continue;
      }
      if (!emp) {
        const k = `${name} · ${num || iqama || '—'}`;
        stats.unmatched.set(k, (stats.unmatched.get(k) || 0) + 1);
        continue;
      }
      toCreate.push({
        emp, code, startDate, endDate,
        // Always inclusive of both ends, not the duration written in the sheet: that one excludes the return day while the stored date includes it. Using it would make the count disagree with its own dates, which is worse than one extra day.
        days: leaveDays(startDate, endDate),
        label: String(rawType).trim(),
      });
    }
  }

  // A day is never recorded twice. A second run must have no effect, so each leave is checked for an overlapping leave in the file, the same condition as the screen (clash).
  const existing = await LeaveRequest.find({
    employee: { $in: [...new Set(toCreate.map((x) => x.emp._id))] },
    status: { $in: ['approved', 'pending_manager', 'pending_hr', 'pending_accounting', 'pending_board'] },
  }).select('employee startDate endDate').lean();
  const byEmp = new Map();
  for (const l of existing) {
    const k = String(l.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push(l);
  }

  const planned = [];
  const clashes = [];
  for (const x of toCreate) {
    const mine = byEmp.get(String(x.emp._id)) || [];
    const overlap = mine.find((l) => l.startDate <= x.endDate && l.endDate >= x.startDate);
    if (overlap) {
      if (overlap.startDate === x.startDate && overlap.endDate === x.endDate) stats.exists += 1;
      else { stats.clash += 1; clashes.push(`${x.emp.arabicName || x.emp.firstName} — الورقة ${x.startDate}→${x.endDate} (${x.label}) · المسجَّلة ${overlap.startDate}→${overlap.endDate}`); }
      continue;
    }
    // Overlap is also measured against what is about to be created: the sheet has two overlapping slots for one man.
    const twin = planned.find((p) => String(p.emp._id) === String(x.emp._id) && p.startDate <= x.endDate && p.endDate >= x.startDate);
    if (twin) {
      stats.clash += 1;
      clashes.push(`${x.emp.arabicName || x.emp.firstName} — الورقة ${x.startDate}→${x.endDate} (${x.label}) · تتداخل مع خانةٍ أخرى في الورقة نفسِها ${twin.startDate}→${twin.endDate} (${twin.label})`);
      continue;
    }
    planned.push(x);
  }

  console.log(`\nصفوفُ الموظفين: ${stats.rows} · خاناتٌ مكتوبة: ${stats.slots}`);
  console.log(`   «لم يحصل على إجازة»: ${stats.nonLeave} · بلا تواريخ: ${stats.noDates} · نوعٌ مجهول: ${stats.unknownType}`);
  console.log(`   إجازاتٌ حقيقيّة: ${toCreate.length + [...stats.unmatched.values()].reduce((a, b) => a + b, 0)}`);
  console.log(`   مطابَقةٌ لموظّفٍ عندنا: ${toCreate.length}`);
  if (stats.unmatched.size) {
    console.log(`   لم يُطابَق أصحابُها (${stats.unmatched.size} شخصًا):`);
    [...stats.unmatched.entries()].slice(0, 20).forEach(([k, n]) => console.log(`      ${k} — ${n} إجازة`));
  }
  console.log(`   مسجّلةٌ سابقًا بنفس التواريخ: ${stats.exists} · تتداخل مع مسجّلة: ${stats.clash}`);
  clashes.forEach((c) => console.log(`      ${c}`));
  console.log(`   ستُقيَّد الآن: ${planned.length}`);
  const byCode = {};
  for (const p of planned) byCode[p.code] = (byCode[p.code] || 0) + 1;
  console.log('   بالأنواع:', byCode);

  if (!APPLY) {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const x of planned) {
    const lt = typeByCode.get(x.code);
    const affects = lt.affectsBalance !== false;
    // Balance at the moment of entry, as the screen captures it before deduction.
    let snap = { accrued: 0, requested: x.days, remainingAfter: 0 };
    try {
      const contract = await require(`${ROOT}/models/Contract`)
        .findOne({ employee: x.emp._id, status: 'active' }).lean();
      if (contract) {
        const taken = await LeaveRequest.aggregate([
          { $match: { employee: x.emp._id, status: 'approved' } },
          { $group: { _id: null, d: { $sum: '$days' } } },
        ]);
        const b = computeBalance(contract, taken[0]?.d || 0, now, {
          workStartDate: e.actualWorkStartDate || '', contracts: 1,
        });
        snap = {
          accrued: b.accrued,
          requested: x.days,
          remainingAfter: affects ? Math.round((b.available - x.days) * 100) / 100 : b.available,
        };
      }
    } catch { /* no contract means no balance; the leave is still recorded */ }

    // eslint-disable-next-line no-await-in-loop
    await LeaveRequest.create({
      employee: x.emp._id,
      requester: x.emp.user || actor?._id,
      leaveType: lt._id,
      leaveTypeCode: lt.code,
      startDate: x.startDate,
      endDate: x.endDate,
      days: x.days,
      reason: `${IMPORT_TAG} — «${x.label}»`,
      status: 'approved',
      currentStage: 'done',
      hrDecision: { by: actor?._id, at: now, decision: 'approved', note: 'استيرادُ سجلّ الإجازات', signature: '' },
      backdated: true,
      recordedBy: actor?._id,
      recordedByName: actorName,
      recordedAt: now,
      balanceSnapshot: snap,
      advanceNotice: { required: false, requiredDays: 0, daysAhead: 0, satisfied: true, overridden: false },
    });
    stats.created += 1;
  }

  console.log(`\nقُيِّدت ${stats.created} إجازة.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
