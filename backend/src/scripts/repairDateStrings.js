/**
 * repairDateStrings — تواريخُ كُتبت بصيغة `Date.toString()` بدل ISO.
 *
 *   node src/scripts/repairDateStrings.js          تجربة
 *   node src/scripts/repairDateStrings.js --yes    تنفيذ
 *
 * «Fri Jul 24 2026 03:00:00 GMT+0300 (Arabian Standard Time)» نصٌّ يقرؤه
 * جافاسكربت ولا تقرؤه القاعدة — فأيُّ حسابٍ يجري في القاعدة (وهو ما صارت
 * اللوحةُ تفعله لتسرع) يعُدُّ صاحبَه «بلا تاريخ». وهو تاريخٌ مكتوبٌ فعلًا.
 *
 * وصيغةُ `toString` تحمل اسمَ المنطقة بلغة الجهاز الذي كتبها — تتغيّر بتغيّر
 * الخادم. فتُوحَّد إلى «YYYY-MM-DD» كبقيّة الحقل.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const fields = [...new Set([
    ...H.GROUPS.map((g) => g.expiryField).filter(Boolean),
    ...H.GROUPS.flatMap((g) => g.fields.filter((f) => f.type === 'date').map((f) => f.key)),
  ])];

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  let total = 0;
  for (const f of fields) {
    const path = Employee.schema.paths[f];
    if (!path || path.instance !== 'String') continue;
    // ما لا يبدأ برقم: ليس ISO.
    const rows = await Employee.find({ [f]: { $type: 'string', $ne: '', $not: /^\d/ } })
      .select(`employeeNumber ${f}`).lean();
    if (!rows.length) continue;
    const plan = [];
    for (const r of rows) {
      const d = new Date(r[f]);
      if (Number.isNaN(d.getTime())) { console.log(`   ✗ ${f} «${r[f]}» لا يُقرأ`); continue; }
      plan.push({ id: r._id, from: r[f], to: d.toISOString().slice(0, 10) });
    }
    console.log(`${f}: ${plan.length} قيمة`);
    plan.slice(0, 3).forEach((p) => console.log(`   «${p.from.slice(0, 34)}…» → ${p.to}`));
    total += plan.length;
    if (YES) for (const p of plan) await Employee.updateOne({ _id: p.id }, { $set: { [f]: p.to } });
  }
  console.log(`\n${YES ? '✓ وُحِّد' : 'سيُوحَّد'} ${total} تاريخًا`);
  if (!YES) console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n');
  else { try { require('../utils/ttlCache').clear('hrm:'); } catch (_) {} }
  await mongoose.disconnect();
})();
