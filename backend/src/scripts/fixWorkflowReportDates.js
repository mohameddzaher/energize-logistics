/**
 * fixWorkflowReportDates — تاريخُ الكشف هو `pick_time` لا لحظةُ الإدخال.
 *
 *   node src/scripts/fixWorkflowReportDates.js         # فحصٌ فقط
 *   node src/scripts/fixWorkflowReportDates.js --yes   # تنفيذ
 *
 * كانت مزامنةُ سير عمل التشغيل تكتب `reportDate` من `created_at` — لحظةِ كتابة
 * الصفّ في منصّة الأوبريشن. وهي ليست تاريخَ الكشف: كشفٌ عُمل في نوفمبر ٢٠٢٥ ثمّ
 * أُدخل في فبراير ٢٠٢٦ كان يُقرأ كشفَ فبراير — فيدخل تقاريرَ شهرٍ لم يحدث فيه،
 * ويسقط من شهره. وشيتُ المتابعة يحمل `pick_time`، فكان الرقمان يفترقان بلا سبب
 * ظاهر.
 *
 * والتصحيحُ لا يحتاج المنصّة: الشحناتُ نفسُها مثبَّتةٌ عندنا في `ShipmentOrder`
 * بحقلَيها معًا (`pickupTime` من `pick_time`)، فيُقرأ منها بالمطابقة على رقم
 * كشف التخريج.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrder = require('../models/ShipmentOrder');

const APPLY = process.argv.includes('--yes');
const key = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  تصحيحُ تاريخ الكشف — تنفيذ' : '  تصحيحُ تاريخ الكشف — فحصٌ فقط');
  console.log('='.repeat(72));
  await mongoose.connect(process.env.MONGODB_URI);

  const pick = new Map();
  for (const s of await ShipmentOrder.find({ source: 'platform', pickupTime: { $ne: null } })
    .select('graduationNumber pickupTime').lean()) {
    if (s.graduationNumber != null) pick.set(String(s.graduationNumber), s.pickupTime);
  }
  console.log(`  شحناتٌ من المنصّة لها تاريخُ كشف: ${pick.size}`);

  const docs = await OperationsWorkflow.find({}).select('reportNumber reportDate').lean();
  console.log(`  كشوفٌ عندنا: ${docs.length}`);

  const fix = []; let same = 0; let unknown = 0;
  for (const d of docs) {
    const p = pick.get(String(d.reportNumber).trim());
    if (!p) { unknown += 1; continue; }
    if (key(d.reportDate) === key(p)) { same += 1; continue; }
    fix.push({ _id: d._id, reportNumber: String(d.reportNumber), was: key(d.reportDate), to: key(p), toDate: p });
  }

  console.log(`\n  مطابقٌ للمنصّة : ${same}`);
  console.log(`  يُصحَّح         : ${fix.length}`);
  console.log(`  لا نظيرَ له عندنا: ${unknown}`);
  if (fix.length) {
    console.log('    مثال:', fix.slice(0, 5).map((f) => `${f.reportNumber} ${f.was}→${f.to}`).join(' · '));
    const moved = fix.filter((f) => (f.was || '').slice(0, 7) !== (f.to || '').slice(0, 7));
    console.log(`    منها ينتقل إلى شهرٍ آخر: ${moved.length}`);
    const crossYear = fix.filter((f) => (f.was || '').slice(0, 4) !== (f.to || '').slice(0, 4));
    console.log(`    ومنها إلى سنةٍ أخرى   : ${crossYear.length}`);
  }

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  if (!fix.length) { console.log('\n  لا شيءَ يُغيَّر.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `workflowReportDates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date(), fix: fix.map(({ toDate, ...r }) => r) }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  let done = 0;
  for (let i = 0; i < fix.length; i += 1000) {
    const chunk = fix.slice(i, i + 1000);
    // eslint-disable-next-line no-await-in-loop
    const r = await OperationsWorkflow.bulkWrite(chunk.map((f) => ({
      updateOne: { filter: { _id: f._id }, update: { $set: { reportDate: f.toDate } } },
    })), { ordered: false });
    done += r.modifiedCount || 0;
    process.stdout.write(`\r  عُدِّل ${done}/${fix.length}   `);
  }
  console.log(`\n  تمّ: ${done} صفًّا\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
