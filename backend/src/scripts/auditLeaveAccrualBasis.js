/**
 * من أيِّ يومٍ يُعَدّ رصيدُ كلّ موظّف — وكم زاد رصيدُ من خدم قبل عقده.
 *
 * الرصيدُ يُعَدّ من **تاريخ مباشرة العمل** دائمًا، لا من تاريخ العقد (راجع
 * utils/leaveBalance). ومن سبقت مباشرتُه عقدَه المسجَّل بسنواتٍ يستحقّ رصيدَ
 * تلك السنوات كاملًا — **وما أخذه فيها من إجازاتٍ لا سجلَّ له عندنا فلا
 * يُخصَم**. فهذا يسمّي أولئك ويقول كم زاد رصيدُ كلٍّ منهم بالقاعدة الجديدة،
 * ليُراجَع: فإن كان أحدُهم قد استهلك شيئًا من تلك السنوات فموضعُ خصمه
 * «الرصيد المُرحَّل» برقمٍ سالبٍ يكتبه من يعرفه.
 *
 *   node src/scripts/auditLeaveAccrualBasis.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Employee = require(`${ROOT}/models/Employee`);
const Contract = require(`${ROOT}/models/Contract`);
const { computeBalance, accrualStart } = require(`${ROOT}/utils/leaveBalance`);

const DAY = 86400000;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const contracts = await Contract.find({}).lean();
  const byEmp = new Map();
  contracts.forEach((c) => { const k = String(c.employee); (byEmp.get(k) || byEmp.set(k, []).get(k)).push(c); });
  const emps = await Employee.find({}).select('firstName lastName arabicName employeeNumber department actualWorkStartDate hireDate employmentStatus').lean();
  const name = (e) => e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeNumber;

  const tally = { workStart: 0, contract: 0, noContract: 0, noWorkStart: 0 };
  const priorService = [];
  for (const e of emps) {
    const list = byEmp.get(String(e._id)) || [];
    const active = list.find((c) => c.status === 'active') || list[0];
    if (!active) { tally.noContract += 1; continue; }
    if (!e.actualWorkStartDate) { tally.noWorkStart += 1; }
    const opts = { workStartDate: e.actualWorkStartDate || '', contracts: list.length };
    const b = computeBalance(active, 0, new Date(), opts);
    tally[b.accrualBasis] += 1;
    // ومن سبقت مباشرتُه عقدَه بأكثرَ من سنةٍ: يُقال كم زاد رصيدُه بالقاعدة
    // الجديدة — فرقٌ محسوبٌ لا مقترَح، ليُراجَع ما استُهلك منه إن استُهلك.
    if (e.actualWorkStartDate && list.length === 1 && active.startDate) {
      const gap = Math.round((new Date(String(active.startDate).slice(0, 10)) - new Date(e.actualWorkStartDate)) / DAY);
      if (gap > 365) {
        const fromContract = computeBalance(active, 0, new Date(), { workStartDate: '', contracts: 1 });
        priorService.push({
          name: name(e), dept: e.department || '—',
          work: e.actualWorkStartDate, contract: String(active.startDate).slice(0, 10),
          years: Math.round((gap / 365) * 10) / 10,
          now: b.available,
          was: fromContract.available,
          added: Math.round((b.available - fromContract.available) * 10) / 10,
          carried: Number(active.carriedOverDays) || 0,
        });
      }
    }
  }

  console.log(`\nموظفون: ${emps.length}`);
  console.log(`  يُعَدّ رصيدُهم من **مباشرة العمل**: ${tally.workStart}`);
  console.log(`  ومن تاريخ العقد: ${tally.contract}  ·  بلا عقد: ${tally.noContract}  ·  بلا تاريخ مباشرة: ${tally.noWorkStart}`);

  priorService.sort((a, b) => b.added - a.added);
  const totalAdded = Math.round(priorService.reduce((a, r) => a + r.added, 0) * 10) / 10;
  console.log(`\n── خدمةٌ أقدمُ من العقد بأكثرَ من سنة: ${priorService.length} موظّفًا · زاد رصيدُهم ${totalAdded} يومًا`);
  console.log('   (العدُّ من المباشرة كما هو مطلوب — وما أُخذ في تلك السنوات لا سجلَّ له فلا يُخصَم)\n');
  priorService.forEach((r) => console.log(
    `   ${r.name.padEnd(34)} ${String(r.dept).padEnd(16)} مباشرة ${r.work} · عقد ${r.contract} · ${String(r.years).padStart(4)} سنة`
    + ` · الرصيد ${String(r.was).padStart(7)} ← ${String(r.now).padStart(7)} (+${r.added})`,
  ));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
