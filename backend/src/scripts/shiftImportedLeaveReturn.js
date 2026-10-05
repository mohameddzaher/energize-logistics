/**
 * تاريخُ العودة في الإجازات المستورَدة يعود كما كُتب في الورقة (+يوم).
 *
 * ── ما جرى ──────────────────────────────────────────────────────────────────
 * ورقةُ الإجازات تكتب «المدّة بالأيام» = العودة − الذهاب: أي أنّها لا تعدّ يومَ
 * العودة. وحسابُنا شاملُ الطرفين، فنُقص يومٌ من تاريخ العودة عند الاستيراد
 * لتتساوى المدّتان — وبذلك اختلف التاريخُ المحفوظُ عن التاريخ المكتوب بيومٍ
 * واحد.
 *
 * وقرارُ صاحب القسم أن يبقى التاريخُ كما أرسله: الورقةُ هي المرجعُ الذي
 * يُقارَن به، وتاريخٌ مختلفٌ بيومٍ يُقرأ خطأً كلَّ مرّةٍ تُراجَع. فيُعاد اليومُ
 * إلى تاريخ العودة، وتتبعه المدّةُ (+١) — لا العكس.
 *
 * ولا يُمسّ إلّا ما استُورد من تلك الورقة (`reason` يحمل وسمَ الاستيراد):
 * إجازةٌ سجّلها موظّفُ الموارد البشريّة بيده تاريخُها ما كتبه، ولا شأنَ لهذا به.
 *
 * الاستعمال:
 *   node src/scripts/shiftImportedLeaveReturn.js            # عرضٌ فقط
 *   node src/scripts/shiftImportedLeaveReturn.js --apply
 *   node src/scripts/shiftImportedLeaveReturn.js --undo --apply   # للرجوع
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LeaveRequest = require(`${ROOT}/models/LeaveRequest`);
const { leaveDays } = require(`${ROOT}/utils/leaveBalance`);

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const STEP = UNDO ? -1 : 1;
const IMPORT_TAG = 'مستورَدة من ملفّ إجازات الموظفين';

/** «YYYY-MM-DD» + أيّام → «YYYY-MM-DD». حسابٌ بالتقويم لا بنصّ. */
const shift = (ymd, days) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const rows = await LeaveRequest.find({ reason: new RegExp(IMPORT_TAG) })
    .select('employee startDate endDate days leaveTypeCode reason').lean();
  console.log(`إجازاتٌ مستورَدة: ${rows.length}${UNDO ? ' (رجوع: −يوم)' : ' (+يوم على العودة)'}`);
  if (!rows.length) { await mongoose.disconnect(); return; }

  const plan = [];
  for (const r of rows) {
    const nextEnd = shift(r.endDate, STEP);
    if (!nextEnd) { console.log(`   ✗ تاريخٌ غيرُ مقروء: ${r._id} «${r.endDate}»`); continue; }
    const nextDays = leaveDays(r.startDate, nextEnd);
    if (nextEnd === r.endDate && nextDays === r.days) continue;
    plan.push({ r, nextEnd, nextDays });
  }
  console.log(`   ستُعدَّل: ${plan.length}`);
  const sample = plan.slice(0, 5);
  sample.forEach(({ r, nextEnd, nextDays }) => console.log(`      ${r.startDate} → ${r.endDate} (${r.days} يومًا)  ⇒  ${r.startDate} → ${nextEnd} (${nextDays} يومًا)`));

  // ── وما يتداخل بعد الإزاحة يُقال قبلها ──────────────────────────────────
  // إضافةُ يومٍ تُرجع التلاصقَ الذي كان: سنويّةٌ تنتهي يومَ بدء إجازة العيد.
  // والنظامُ يمنع إجازتين على يومٍ واحد (لا يُخصَم يومٌ مرّتين)، وهذه صفوفٌ
  // قائمةٌ لا طلباتٌ جديدة — فلا يمنعها شيء، لكنّها تُحسَب يومين في الرصيد.
  const byEmp = new Map();
  for (const { r, nextEnd } of plan) {
    const k = String(r.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push({ id: String(r._id), start: r.startDate, end: nextEnd });
  }
  let clashes = 0;
  for (const [, list] of byEmp) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start <= list[i - 1].end) {
        clashes += 1;
        if (clashes <= 6) console.log(`      ⚠ تلاصقٌ: ${list[i - 1].start}→${list[i - 1].end} ثمّ ${list[i].start}→${list[i].end}`);
      }
    }
  }
  console.log(`   أزواجٌ ستتلاصق أو تتداخل: ${clashes}`);

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }

  let done = 0;
  for (const { r, nextEnd, nextDays } of plan) {
    // eslint-disable-next-line no-await-in-loop
    await LeaveRequest.updateOne({ _id: r._id }, { $set: { endDate: nextEnd, days: nextDays } });
    done += 1;
  }
  const after = await LeaveRequest.aggregate([
    { $match: { reason: new RegExp(IMPORT_TAG) } },
    { $group: { _id: null, n: { $sum: 1 }, days: { $sum: '$days' } } },
  ]);
  console.log(`\nعُدِّلت ${done} إجازة · المجموعُ الآن: ${after[0]?.n || 0} إجازة · ${after[0]?.days || 0} يومًا`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
