/**
 * استيرادُ إجازات الموظفين من «ملف اجازات الموظفين.xlsx».
 *
 * ── ما في الملفّ ────────────────────────────────────────────────────────────
 * مئةٌ وثلاثون موظّفًا في صفوف، ولكلٍّ أربعَ عشرةَ خانةَ إجازةٍ في أعمدةٍ
 * متجاورة — أربعةُ أعمدةٍ لكلّ خانة (النوعُ، الذهابُ، العودةُ، المدّة) تحت
 * رؤوسٍ مدمجةٍ بالسنوات: ٢٠٢٤ و٢٠٢٥ و٢٠٢٦.
 *
 * وأكثرُ الخانات نصُّها «لم يحصل على اجازة في ٢٠٢٦» بلا تواريخ: ليست إجازةً
 * بل تصريحٌ بعدمها، فتُهمَل. والإجازاتُ الحقيقيّةُ مئتان وخمسون.
 *
 * ── ولماذا تُقيَّد «بأثرٍ رجعيّ» ─────────────────────────────────────────────
 * هذه إجازاتٌ وقعت وانقضت قبل أن يوجد النظام. ودورةُ الموافقة تسأل «أنوافق على
 * هذا الغياب؟» — ولا معنى للسؤال بعد عامين. فتُقيَّد كما يقيّدها موظّفُ الموارد
 * البشريّة من الشاشة: معتمَدةً، موسومةً `backdated`، باسم من قيّدها. راجع
 * `hrController.createBackdatedLeave` — هذا نظيرُه حرفًا، فلا يصير في النظام
 * بابان لتسجيل إجازةٍ يفترقان.
 *
 * وبها يصير الرصيدُ صحيحًا: `utils/leaveBalance` يحسب المستحقَّ من العقد
 * ويخصم المأخوذ — ومن لم تُسجَّل إجازاتُه يبقى في الورق مستحقًّا ثلاثين يومًا
 * وقد أخذ اثنين وثلاثين.
 *
 * ── والتواريخُ تُقرأ أرقامًا ────────────────────────────────────────────────
 * `cellDates: true` يُنقص يومًا على هذا الجهاز. فتُقرأ التسلسلاتُ خامًا وتُحوَّل
 * بالحساب — راجع ذاكرةَ المشروع «XLSX date epoch trap».
 *
 * الاستعمال:
 *   node src/scripts/importEmployeeLeaves.js            # عرضٌ فقط
 *   node src/scripts/importEmployeeLeaves.js --apply
 *   node src/scripts/importEmployeeLeaves.js --file=<path> --apply
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
/** وسمُ القيد: به يُعرَف ما جاء من هذا الملفّ، وبه يُسحَب كلُّه إن لزم. */
const IMPORT_TAG = 'مستورَدة من ملفّ إجازات الموظفين';
const FILE = (process.argv.find((a) => a.startsWith('--file=')) || '').slice(7)
  || path.join(__dirname, '../../../final hr data/new edits/ملف اجازات الموظفين.xlsx');

/** تسلسلُ إكسل → «YYYY-MM-DD». الأصلُ ١٨٩٩-١٢-٣٠، وما قبل ١٩٠٠-٠٣-٠١ لا يُستعمل. */
const serialToISO = (v, shiftDays = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = Math.round((n - 25569 + shiftDays) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

/** ما يُقرأ في خانة النوع: إجازةٌ حقيقيّةٌ أم تصريحٌ بعدمها؟ */
const isNonLeave = (t) => /لم\s*يحصل/.test(String(t || ''));

/**
 * اسمُ النوع في الورقة ← رمزُه في النظام.
 * والطيُّ يتسامح مع الهمزة والتاء المربوطة والمسافات — «اجزة عيد الاضحى»
 * مكتوبةٌ في الملفّ ناقصةَ ألف، وهي العيدُ نفسُه.
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

  // ── وللاستيرادِ بابُ رجوع ─────────────────────────────────────────────────
  // مئتان وتسعٌ وثلاثون إجازةً تُكتب في سجلٍّ يقرأه الرصيدُ والرواتب. فيُوسَم
  // كلُّ قيدٍ بنصٍّ واحدٍ، ويُسحَب به كلُّه بأمرٍ واحدٍ إن ظهر في الملفّ خطأ.
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
  // مواضعُ الخانات: كلُّ أربعةِ أعمدةٍ خانةٌ، تبدأ بعد الأعمدة الأربعة الأولى.
  const slots = [];
  for (let i = 4; i + 3 < header.length; i += 4) slots.push(i);

  // ── المطابقة: الرقمُ الوظيفيُّ ثمّ الإقامةُ ثمّ الاسمُ مطويًّا ─────────────
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

  // ── و«إجازةُ العيد» نوعٌ جديد ───────────────────────────────────────────
  // في الملفّ أربعون إجازةَ عيدٍ (أضحى وفطر) ولا نوعَ لها في النظام. وتقييدُها
  // «سنويّةً» يخصم من رصيدٍ لا تُخصَم منه، وإهمالُها يحذف أربعين إجازةً وقعت.
  // فيُنشأ نوعُها ولا تُخصَم من الرصيد (`affectsBalance: false`) — ومن أراد
  // خصمَها يقلب الصفةَ من شاشة «أنواع الإجازات» بضغطة.
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

  // مَن يُنسَب إليه القيدُ: حسابُ مديرِ النظام — لا يُترَك بلا اسم.
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
      // ── و«تاريخ العودة» يومُ رجوعه إلى العمل، لا آخرُ أيّام غيابه ────────
      // قيست المئتان والخمسون كلُّها: «المدّة بالأيام» = العودة − الذهاب، لا
      // زائدَ واحد. فيومُ العودة ليس إجازةً. وحسابُنا شاملُ الطرفين
      // (`leaveDays`)، فلو خُزِّن كما هو صار كلُّ إجازةٍ يومًا أطولَ ممّا كانت،
      // ولتداخلت اثنتان وعشرون إجازةَ عيدٍ مع سنويّةٍ تنتهي يومَ بدئها —
      // وتداخلُ يومٍ واحدٍ يُسقِط إحداهما بشرط «لا يومَ مرّتين».
      const startDate = serialToISO(r[i + 1]);
      const endDate = serialToISO(r[i + 2], -1);
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
        days: Number(r[i + 3]) || leaveDays(startDate, endDate),
        label: String(rawType).trim(),
      });
    }
  }

  // ── ولا يُقيَّد يومٌ مرّتين ───────────────────────────────────────────────
  // التشغيلُ الثاني يجب أن يكون بلا أثر. فيُسأل عن كلّ إجازةٍ: هل في الملفّ
  // إجازةٌ تتداخل مع أيّامها؟ — وهو نفسُ شرطِ الشاشة (`clash`).
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
    // التداخلُ يُقاس على ما سيُنشأ أيضًا: في الورقة خانتان متداخلتان لرجلٍ واحد.
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
    // الرصيدُ لحظةَ القيد — كما تلتقطه الشاشةُ قبل الخصم.
    let snap = { accrued: 0, requested: x.days, remainingAfter: 0 };
    try {
      const contract = await require(`${ROOT}/models/Contract`)
        .findOne({ employee: x.emp._id, status: 'active' }).lean();
      if (contract) {
        const taken = await LeaveRequest.aggregate([
          { $match: { employee: x.emp._id, status: 'approved' } },
          { $group: { _id: null, d: { $sum: '$days' } } },
        ]);
        const b = computeBalance(contract, taken[0]?.d || 0, now);
        snap = {
          accrued: b.accrued,
          requested: x.days,
          remainingAfter: affects ? Math.round((b.available - x.days) * 100) / 100 : b.available,
        };
      }
    } catch { /* بلا عقدٍ لا رصيد — والإجازةُ تُقيَّد على كلّ حال */ }

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
