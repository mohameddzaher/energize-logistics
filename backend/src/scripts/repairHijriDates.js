/**
 * repairHijriDates — تواريخُ هجريّةٌ خُزّنت كأنّها ميلاديّة.
 *
 *   node src/scripts/repairHijriDates.js          تجربة
 *   node src/scripts/repairHijriDates.js --yes    تنفيذ
 *
 * «1449-01-09» كُتب في خانة تاريخٍ فصار سنةَ ١٤٤٩ **ميلاديّة** — قبل ستّمئة
 * عام — فتقول الشاشةُ «متأخّر ٢١٠٩٨٧ يومًا» عن شهادةٍ لم يحن أجلُها. ويُعرَف
 * المعطوبُ بيقين: تاريخُ عملٍ قبل ١٩٠٠ ليس تاريخًا، وسنةُ ١٤٤٩ هجريّةً تقع
 * في ٢٠٢٧ — بجانب السليمة في الحقل نفسِه (٢٠٢٧-٠٦-٢٨).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { parseHijri, toHijri } = require('../utils/hijri');

const YES = process.argv.includes('--yes');
const LOW = new Date('1900-01-01');
// حقولُ التاريخ التي قد تحمل هجريًّا مكتوبًا خطأً.
const FIELDS = ['healthCertExpiry', 'iqamaExpiry', 'passportExpiry', 'licenseExpiry', 'contractEnd', 'iqamaIssueDate'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');

  let total = 0;
  for (const f of FIELDS) {
    if (!Employee.schema.paths[f] || Employee.schema.paths[f].instance !== 'Date') continue;
    const rows = await Employee.find({ [f]: { $ne: null, $lt: LOW } })
      .select(`employeeNumber nameAr ${f}`).lean();
    if (!rows.length) { console.log(`${f.padEnd(20)} سليم`); continue; }
    console.log(`\n${f} — ${rows.length} صفًّا معطوبًا:`);
    const plan = [];
    for (const r of rows) {
      const iso = new Date(r[f]).toISOString().slice(0, 10);
      const g = parseHijri(iso);                    // يُقرأ ما كُتب على أنّه هجريّ
      if (!g) { console.log(`   ✗ ${r.employeeNumber} ${iso} — تعذّر التحويل`); continue; }
      plan.push({ id: r._id, from: iso, to: g });
    }
    const byPair = {};
    plan.forEach((p) => { const k = `${p.from} → ${p.to.toISOString().slice(0, 10)}`; byPair[k] = (byPair[k] || 0) + 1; });
    Object.entries(byPair).forEach(([k, n]) => console.log(`   ${k}   (${n} موظّف)`));
    total += plan.length;
    if (YES) {
      for (const p of plan) await Employee.updateOne({ _id: p.id }, { $set: { [f]: p.to } });
    }
  }

  console.log(`\n${YES ? '✓ صُحِّح' : 'سيُصحَّح'} ${total} تاريخًا`);
  if (YES) { try { require('../utils/ttlCache').clear('hr:'); } catch (_) {} }
  else console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n');
  await mongoose.disconnect();
})();
