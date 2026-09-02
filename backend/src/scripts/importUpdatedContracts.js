/**
 * importUpdatedContracts — «ملفّ عقود الموظفين المحدَّث» يحلّ محلّ سابقِه.
 *
 *   node src/scripts/importUpdatedContracts.js --dry
 *   node src/scripts/importUpdatedContracts.js --yes
 *
 * المصدر: «final hr data/ملفّ عقود الموظفين المحدث.xlsx» — ٢٦٩ عقدًا، وفيه
 * عمودان لم يكونا في الملفّ السابق: **حالةُ العقد** و**رقمُ العقد**.
 *
 * ── ولماذا يُكتب فوق القديم هنا ────────────────────────────────────────────
 * الاستيرادُ في هذا النظام يملأ الفارغَ ولا يدهس المكتوب، لأنّ المكتوبَ عادةً
 * أحدثُ من الورقة. وهذا الملفُّ عكسُه: اسمُه «المحدَّث»، وهو التصحيحُ الذي جاء
 * **بعد** الاستيراد الأوّل — تواريخُ نهايةٍ تغيّرت وعقودٌ انتهت. فالورقةُ هنا
 * هي الأحدث، وتُطبَّق.
 *
 * ولا يُدهَس مع ذلك شيءٌ لا تحمله الورقةُ أصلًا: الراتبُ والبدلاتُ والملاحظاتُ
 * والرصيدُ المرحَّل ليست فيها فلا تُمَسّ.
 *
 * ── والهويّةُ هي المفتاح ───────────────────────────────────────────────────
 * الأسماءُ العربيّة تُكتب بصورٍ شتّى فتُطابَق خطأً وتُلصَق عقودُ الناس ببعضها.
 * ورقمُ الهويّة لا يشبه غيرَه.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const FILE = path.join(__dirname, '../../..', 'final hr data', 'ملف عقود الموظفين المحدث.xlsx');
const SHEET = 'ورقة1';
const HEADER_ROW = 1;                       // الصفُّ الأوّل عدّاد، والثاني العناوين

const EMPTY = new Set(['', '-', '#n/a', 'n/a', 'na', 'null', 'undefined']);
const str = (v) => {
  if (v == null) return '';
  const s = String(v).trim();
  return EMPTY.has(s.toLowerCase()) ? '' : s;
};
// مبدأُ تأريخ إكسل — يُحسب بغرينتش فلا يتدخّل توقيتُ الجهاز فيضيع يوم.
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const iso = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) {
    return new Date(XLS_EPOCH + Math.round(v * 86400000)).toISOString().slice(0, 10);
  }
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : '';
};
/** «٢١» رقمٌ و«غير مطلوب» نصّ — ولا يُحشر أحدُهما مكانَ الآخر. */
const numOrText = (v) => {
  const s = str(v);
  if (!s) return { n: null, text: '' };
  const n = Number(s);
  return Number.isFinite(n) ? { n, text: '' } : { n: null, text: s };
};
// «ساري» عقدٌ قائم، و«تم انهاء العقد» منتهٍ. وحالةُ «مجدَّد» لا تأتي من ورقة.
const readStatus = (v) => {
  const s = str(v);
  if (!s) return '';
  if (/انهاء|منته|منتهي/.test(s)) return 'terminated';
  if (/ساري|نشط/.test(s)) return 'active';
  return '';
};

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log(DRY ? '  عقود الموظفين المحدَّثة — تجربةٌ فقط' : '  عقود الموظفين المحدَّثة — تنفيذ');
  console.log('='.repeat(70));

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const all = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: null, blankrows: false, raw: true });
  const rows = all.slice(HEADER_ROW + 1).filter((r) => str(r[0]));
  console.log(`  صفوفٌ لها هويّة: ${rows.length}`);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');

  const emps = await Employee.find({}).select('iqamaNumber nationalId firstName lastName hireDate contractStartDate').lean();
  const byId = new Map();
  for (const e of emps) for (const k of [e.iqamaNumber, e.nationalId]) {
    const v = str(k); if (v && !byId.has(v)) byId.set(v, e);
  }

  // أحدثُ عقدٍ لكلّ موظّف هو الجاري — والورقةُ تصف الجاري.
  const contracts = await Contract.find({}).lean();
  const byEmp = new Map();
  for (const c of contracts.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))) {
    const k = String(c.employee);
    if (!byEmp.has(k)) byEmp.set(k, c);
  }

  const plan = []; const noEmployee = []; const noStart = []; const suspect = [];
  const TODAY = new Date().toISOString().slice(0, 10);
  const changed = {}; const unchanged = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  for (const r of rows) {
    const iq = str(r[0]);
    const emp = byId.get(iq);
    if (!emp) { noEmployee.push(iq); continue; }

    const leave = numOrText(r[7]);
    const prob = numOrText(r[8]);
    const src = {
      iqamaNumber: iq,
      employeeNameAr: str(r[1]),
      contractProfession: str(r[3]),
      contractNumber: str(r[4]),
      startDate: iso(r[5]),
      endDate: iso(r[6]),
      annualLeaveDays: leave.n,
      annualLeaveText: leave.text,
      probationText: prob.text,
      sponsorRegistration: str(r[9]),
    };
    const status = readStatus(r[2]);
    if (status) src.status = status;

    const cur = byEmp.get(String(emp._id));
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || iq;

    if (!cur) {
      const start = src.startDate || str(emp.contractStartDate) || iso(emp.hireDate);
      if (!start) { noStart.push(name); continue; }
      plan.push({ create: true, employee: emp._id, name,
        set: { ...src, startDate: start, annualLeaveDays: src.annualLeaveDays ?? 21, type: 'fixed', status: src.status || 'active' } });
      continue;
    }

    // الورقةُ هي الأحدث: كلُّ قيمةٍ فيها تُطبَّق، وما ليس فيها لا يُمَسّ.
    // و«مجدَّد» لا تُنزَع من عقدٍ جُدِّد عندنا بعد صدور الورقة.
    // ── و«ساري» بتاريخِ نهايةٍ مضى لا يُصدَّق ──────────────────────────────
    // أكثرُ ما تقلبه الورقةُ إلى «ساري» عقودٌ انتهت في أغسطس ومُدّت سنةً —
    // نهايتُها في الورقة ٢٠٢٧، وهذا تجديدٌ حقيقيّ. لكنّ صفّين يقولان «ساري»
    // وتاريخُ نهايتهما هو نفسُه الماضي: الحالةُ والتاريخُ يتناقضان في الصفّ
    // الواحد، فأحدُهما خطأٌ في الورقة لا خبرٌ عن الواقع.
    //
    // ولا يُخمَّن أيُّهما: يُترك العقدُ على حاله ويُقال اسمُه ليُراجَع. فتحُ
    // عقدٍ منتهٍ يجعله يظهر ساريًا في التفتيش وفي كلّ تقرير.
    const endsAt = src.endDate || cur.endDate || '';
    const contradicts = src.status === 'active' && endsAt && endsAt < TODAY;
    if (contradicts) suspect.push(`${name} — «ساري» ونهايتُه ${endsAt}`);

    const set = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === '') continue;
      if (k === 'status' && cur.status === 'renewed') { bump(unchanged, k); continue; }
      if (k === 'status' && contradicts) { bump(unchanged, k); continue; }
      if (String(cur[k] ?? '') === String(v)) { bump(unchanged, k); continue; }
      set[k] = v; bump(changed, k);
    }
    if (Object.keys(set).length) plan.push({ _id: cur._id, name, set, before: cur });
  }

  console.log(`  طُوبقت بالهويّة: ${rows.length - noEmployee.length}/${rows.length}`);
  if (noEmployee.length) console.log(`  بلا موظّفٍ في النظام: ${noEmployee.length} — ${noEmployee.slice(0, 6).join('، ')}`);
  if (noStart.length) console.log(`  بلا تاريخ بدايةٍ ولا مباشرة — لم يُنشأ عقدُها: ${noStart.length} — ${noStart.join('، ')}`);
  console.log(`\n  عقودٌ تُنشأ: ${plan.filter((p) => p.create).length} · تُحدَّث: ${plan.filter((p) => !p.create).length}`);

  console.log('\n  ما سيتغيّر بالحقل:');
  Object.entries(changed).sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`    ${k.padEnd(22)} ${String(n).padStart(4)}   ${DRY ? `(مطابقٌ سلفًا: ${unchanged[k] || 0})` : ''}`));

  if (suspect.length) {
    console.log(`\n  ⚠ «ساري» وتاريخُ النهاية ماضٍ — تُركت حالتُها كما هي لتُراجَع (${suspect.length}):`);
    for (const x of suspect) console.log(`    ${x}`);
  }

  const term = plan.filter((p) => p.set?.status === 'terminated');
  if (term.length) {
    console.log(`\n  عقودٌ تُقفَل «منتهية» (${term.length}):`);
    for (const p of term.slice(0, 20)) console.log(`    ${p.name}`);
    if (term.length > 20) console.log(`    … و${term.length - 20} غيرها`);
  }

  if (DRY) { console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let created = 0; let updated = 0; let failed = 0;
  for (const p of plan) {
    try {
      if (p.create) { await Contract.create({ employee: p.employee, type: 'fixed', ...p.set }); created += 1; }
      else { await Contract.updateOne({ _id: p._id }, { $set: p.set }); updated += 1; }
    } catch (e) { failed += 1; console.error(`  ! ${p.name}: ${e.message}`); }
  }
  console.log(`\n  ✓ أُنشئ ${created} · حُدِّث ${updated}${failed ? ` · فشل ${failed}` : ''}`);

  const total = await Contract.countDocuments();
  console.log('\n  الحالة الآن:');
  for (const k of ['contractNumber', 'contractProfession', 'iqamaNumber', 'sponsorRegistration', 'startDate', 'endDate']) {
    // eslint-disable-next-line no-await-in-loop
    console.log(`    ${k.padEnd(22)} ${await Contract.countDocuments({ [k]: { $nin: ['', null] } })} / ${total}`);
  }
  const byStatus = await Contract.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('  بالحالة:', byStatus.map((x) => `${x._id}=${x.n}`).join(' · '));
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
