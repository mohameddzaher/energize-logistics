/**
 * dedupeContracts — عقدان لفترةٍ واحدة: يبقى الذي يحمل رقمَه.
 *
 *   node src/scripts/dedupeContracts.js --dry
 *   node src/scripts/dedupeContracts.js --yes
 *
 * ── ما وقع ─────────────────────────────────────────────────────────────────
 * خمسةُ موظّفين يحملون عقدين بتاريخَي بدايةٍ ونهايةٍ متطابقين. والتوأمُ في كلّ
 * حالةٍ واحد: بلا رقمِ عقد، أُنشئ في دفعةِ استيرادٍ يومَي ٢٧ و٢٩ أغسطس.
 *
 * ── ولماذا يُحذَف ──────────────────────────────────────────────────────────
 * عقدان «ساريان» لموظّفٍ واحدٍ ليسا زيادةً بلا أثر:
 *   · رصيدُ الإجازات يُحسب على العقد الجاري — فأيُّهما؟
 *   · تقريرُ الانتهاءات يعدّ الموظّفَ مرّتين
 *   · وأسماء جميل يقول شيتُها «تم إنهاء العقد» ويقول توأمُها «ساري»، فتظهر
 *     على رأس العمل وقد انتهى عقدُها
 *
 * ── وشرطُ الحذف ضيّقٌ عن قصد ───────────────────────────────────────────────
 * لا يُحذف عقدٌ إلّا إذا اجتمع فيه كلُّ هذا: بلا رقمِ عقد، وله توأمٌ لنفس
 * الموظّف بنفس تاريخَي البداية والنهاية، والتوأمُ **يحمل** رقمَ عقد، ولا
 * `renewedFrom` عليه (فليس ثمرةَ تجديد)، ولا `createdBy` (فلم ينشئه إنسانٌ من
 * الشاشة). ما نقص عنه شرطٌ واحدٌ يُترك ويُقال.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Contract = require('../models/Contract');
  const Employee = require('../models/Employee');

  console.log(DRY ? '── تجربة، بلا حذف ──\n' : '── تنفيذ ──\n');
  const all = await Contract.find({}).lean();
  const byEmp = new Map();
  for (const c of all) {
    const k = String(c.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push(c);
  }

  const doomed = []; const spared = [];
  for (const [emp, cs] of byEmp) {
    if (cs.length < 2) continue;
    const bySpan = new Map();
    for (const c of cs) {
      const sp = `${c.startDate || ''}|${c.endDate || ''}`;
      if (!bySpan.has(sp)) bySpan.set(sp, []);
      bySpan.get(sp).push(c);
    }
    for (const [sp, group] of bySpan) {
      if (group.length < 2) continue;
      const numbered = group.filter((c) => String(c.contractNumber || '').trim());
      const blank = group.filter((c) => !String(c.contractNumber || '').trim());
      // لا يُحذف شيءٌ إلّا وله أصلٌ واضحٌ يحمل الرقم.
      if (numbered.length !== 1 || !blank.length) {
        spared.push({ emp, sp, why: `${numbered.length} برقمٍ و${blank.length} بلا رقم — لا أصلَ واحدًا واضحًا` });
        continue;
      }
      for (const c of blank) {
        if (c.renewedFrom) { spared.push({ emp, sp, why: 'ثمرةُ تجديد' }); continue; }
        if (c.createdBy) { spared.push({ emp, sp, why: 'أنشأه إنسانٌ من الشاشة' }); continue; }
        doomed.push({ c, keep: numbered[0] });
      }
    }
  }

  console.log(`عقودٌ مكرَّرةٌ تُحذف: ${doomed.length}`);
  for (const d of doomed) {
    const e = await Employee.findById(d.c.employee).select('firstName lastName').lean();
    console.log(`  ${`${e?.firstName || ''} ${e?.lastName || ''}`.trim()}`);
    console.log(`     يُحذف: ${d.c.startDate} → ${d.c.endDate || '—'}  ${d.c.status}  بلا رقم  (أُنشئ ${String(d.c.createdAt).slice(0, 10)})`);
    console.log(`     يبقى : ${d.keep.startDate} → ${d.keep.endDate || '—'}  ${d.keep.status}  رقم ${d.keep.contractNumber}`);
  }
  if (spared.length) {
    console.log(`\nتُركت ولم تُحذف (${spared.length}):`);
    for (const s of spared) console.log(`  ${s.sp} — ${s.why}`);
  }

  if (DRY) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const ids = doomed.map((d) => d.c._id);
  const r = await Contract.deleteMany({ _id: { $in: ids } });
  console.log(`\n✓ حُذف ${r.deletedCount} عقدًا مكرَّرًا`);

  const left = await Contract.aggregate([
    { $group: { _id: { e: '$employee', s: '$startDate', n: '$endDate' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  console.log(`عقودٌ ما زالت مكرَّرةً بنفس الفترة: ${left.length}`);
  console.log(`إجماليُّ العقود الآن: ${await Contract.countDocuments()}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
