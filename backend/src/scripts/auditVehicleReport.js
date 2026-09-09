/**
 * تقريرُ المركبة: يُبنى ويُطبَع فعلًا — لا يُفحَص بناؤه وحدَه.
 *
 * العطبُ الذي كشفه هذا الفحصُ أوّلَ مرّة كان في الطباعة لا في البناء: أربعُ
 * كتلٍ كُتب رأسُها `columns` والعارضُ يقرأ `head`، فيُبنى المستندُ سليمًا ثمّ
 * يسقط عند الرسم — وتُردّ كلُّ محاولةِ طباعةٍ لأيّ مركبةٍ بـ«تعذّر إصدار
 * التقرير». فلا يكفي أن يُقال «بُني»: لا بدّ أن يُرسَم.
 */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { VehicleMaster } = require('../models/VehicleMaster');
  const { getSubject } = require('../services/reportSources');
  const { renderReportPdf } = require('../services/reportBuilder');
  const subject = getSubject('vehicle');
  const user = { _id: new mongoose.Types.ObjectId(), role: 'super_admin', firstName: 'ف', lastName: 'ح' };

  const all = await VehicleMaster.find({}).select('plateNumber').lean();
  console.log(`\n  ── البناء: كلُّ المركبات (${all.length}) ──`);
  const built = new Map();
  const problems = new Map();
  for (const v of all) {
    let doc;
    try { doc = await subject.build(v.plateNumber, {}, 'ar', user); }
    catch (e) { problems.set(`بناء: ${e.message}`, (problems.get(`بناء: ${e.message}`) || 0) + 1); continue; }
    if (!doc) { problems.set('لا بيانات (null)', (problems.get('لا بيانات (null)') || 0) + 1); continue; }
    built.set(v.plateNumber, doc);
    // كلُّ كتلةٍ يجب أن تحمل ما يقرؤه العارضُ منها
    for (const b of doc.blocks || []) {
      if (b.kind === 'table' && b.rows?.length && !Array.isArray(b.head)) {
        problems.set('جدولٌ بلا head', (problems.get('جدولٌ بلا head') || 0) + 1);
      }
      if (b.kind === 'kv' && !Array.isArray(b.items)) problems.set('kv بلا items', (problems.get('kv بلا items') || 0) + 1);
      if ((b.kind === 'stats' || b.kind === 'bars') && b.items && !Array.isArray(b.items)) {
        problems.set(`${b.kind} بلا items`, (problems.get(`${b.kind} بلا items`) || 0) + 1);
      }
    }
  }
  console.log(`     بُنيت: ${built.size} · بلا بيانات أو فشل: ${all.length - built.size}`);
  if (problems.size) for (const [k, n] of problems) console.log(`     ✗ ${String(n).padStart(4)}×  ${k}`);
  else console.log('     ✓ لا كتلةَ معطوبة');

  // الطباعةُ ثقيلةٌ (متصفّحٌ حقيقيّ)، فتُختبَر على عيّنةٍ تشمل الأغنى والأفقر.
  const keys = [...built.keys()];
  const rich = keys.sort((a, b) => (built.get(b).blocks?.length || 0) - (built.get(a).blocks?.length || 0));
  const sample = [...new Set([...rich.slice(0, 3), ...rich.slice(-2)])];
  console.log(`\n  ── الطباعة: عيّنة (${sample.length}) ──`);
  let ok = 0;
  for (const p of sample) {
    const doc = built.get(p);
    try {
      const pdf = await renderReportPdf({ ...doc, lang: 'ar', footerNote: 'فحص' });
      const isPdf = pdf && pdf.length > 1000 && pdf.slice(0, 4).toString() === '%PDF';
      console.log(`     ${isPdf ? '✓' : '✗'} ${p.padEnd(18)} كتل=${String(doc.blocks?.length || 0).padStart(2)}  حجم=${(pdf.length / 1024).toFixed(0)}KB`);
      if (isPdf) ok += 1;
    } catch (e) {
      console.log(`     ✗ ${p.padEnd(18)} ${e.message}`);
    }
  }
  console.log(`\n  النتيجة: ${ok}/${sample.length} طُبعت · ${problems.size ? 'كتلٌ معطوبة موجودة ✗' : 'كلُّ الكتل سليمة ✓'}\n`);
  await mongoose.disconnect();
  process.exit(0);
})();
