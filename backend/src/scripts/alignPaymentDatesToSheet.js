/**
 * alignPaymentDatesToSheet — تاريخُ السداد مصدرُه الشيت وحدَه.
 *
 *   node src/scripts/alignPaymentDatesToSheet.js            # فحصٌ فقط
 *   node src/scripts/alignPaymentDatesToSheet.js --yes      # تنفيذ
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * كشوفُ التشغيل تأتي من منصّة الأوبريشن، وتواريخُ السداد من شيت المتابعة.
 * والمنصّةُ لا ترسل تاريخَ سدادٍ أصلًا (`opsWorkflowSyncService` لا يكتب الحقل)،
 * فأيُّ تاريخِ سدادٍ عندنا لا يقابله مثلُه في الشيت هو إمّا إدخالٌ يدويٌّ على
 * النظام أو بقيّةُ استيرادٍ قديم — وكلاهما يُزال، لأنّ رقمًا واحدًا لا يجوز أن
 * يكون له مصدران.
 *
 * ويُحفظ ما يُمسّ قبل مسّه: الملفُّ في `backups/` يحمل القيمةَ السابقة لكلّ صفّ
 * فيُرَدُّ بأمرٍ واحدٍ إن تبيّن أنّ الشيت هو المتأخّر لا نحن.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const xlsx = require('./lib/xlsxStream');

const APPLY = process.argv.includes('--yes');
const SHEET = process.argv.find((a) => a.endsWith('.xlsx'))
  || path.join(__dirname, '../../../اخر تحديث شيت المتابعه 2026.xlsx');

const serial = (v) => { const n = Number(v); return Number.isFinite(n) && n > 1000 ? n : null; };
const ymd = (n) => (n ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : null);

/** رقمُ الكشف → تاريخُ السداد (أو null) من كلّ أوراق الملفّ. */
function readSheetPayments(file) {
  const map = new Map();
  const xml = require('child_process').execSync(`unzip -Z1 ${JSON.stringify(file)} "xl/worksheets/sheet*.xml"`)
    .toString().trim().split('\n').filter(Boolean);
  for (const sh of xml) {
    let rows;
    try { rows = xlsx.readSheet(file, sh); } catch { continue; }
    const hdr = rows.find((r) => r.cells && Object.values(r.cells).includes('رقم الكشف'));
    if (!hdr) continue;
    // العمودُ يُقرأ بعنوانه لا بحرفه: ترتيبُ الأعمدة يتغيّر بين نسخةٍ وأخرى،
    // و«R» في ورقةٍ قد يكون غيرَه في ورقة.
    const colOf = (title) => Object.keys(hdr.cells).find((k) => String(hdr.cells[k]).trim() === title);
    const cNum = colOf('رقم الكشف'); const cPay = colOf('تاريخ السداد');
    if (!cNum || !cPay) continue;
    for (const r of rows) {
      if (r.r <= hdr.r || !r.cells || !r.cells[cNum]) continue;
      const num = String(r.cells[cNum]).trim();
      const pay = ymd(serial(r.cells[cPay]));
      if (pay) map.set(num, pay);
      else if (!map.has(num)) map.set(num, null);
    }
  }
  return map;
}

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  مطابقةُ تواريخ السداد بالشيت — تنفيذ' : '  مطابقةُ تواريخ السداد بالشيت — فحصٌ فقط');
  console.log('='.repeat(72));
  console.log('  الشيت:', path.basename(SHEET));
  if (!fs.existsSync(SHEET)) { console.error('  ✗ الملفُّ غيرُ موجود'); process.exit(1); }

  const sheet = readSheetPayments(SHEET);
  console.log(`  أرقامٌ في الشيت: ${sheet.size} · منها بتاريخ سداد: ${[...sheet.values()].filter(Boolean).length}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const docs = await OperationsWorkflow.find({ paymentDate: { $ne: null } })
    .select('reportNumber paymentDate').lean();
  console.log(`  عندنا بتاريخ سداد: ${docs.length}`);

  const clear = []; const fix = []; let same = 0;
  for (const d of docs) {
    const num = String(d.reportNumber).trim();
    const ours = d.paymentDate.toISOString().slice(0, 10);
    const theirs = sheet.has(num) ? sheet.get(num) : undefined;
    if (theirs === undefined) clear.push({ _id: d._id, reportNumber: num, was: ours, why: 'الكشف ليس في الشيت' });
    else if (theirs === null) clear.push({ _id: d._id, reportNumber: num, was: ours, why: 'الشيت بلا تاريخ سداد' });
    else if (theirs !== ours) fix.push({ _id: d._id, reportNumber: num, was: ours, to: theirs });
    else same += 1;
  }

  console.log(`\n  مطابقٌ للشيت : ${same}`);
  console.log(`  يُمسح        : ${clear.length}`);
  console.log(`  يُصحَّح       : ${fix.length}`);
  if (clear.length) console.log('    مثال:', clear.slice(0, 5).map((c) => `${c.reportNumber}(${c.was})`).join(' '));
  if (fix.length) console.log('    مثال:', fix.slice(0, 5).map((c) => `${c.reportNumber} ${c.was}→${c.to}`).join(' · '));

  if (!APPLY) {
    console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n');
    await mongoose.disconnect();
    return;
  }
  if (!clear.length && !fix.length) {
    console.log('\n  لا شيءَ يُغيَّر.\n');
    await mongoose.disconnect();
    return;
  }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `paymentDates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ sheet: path.basename(SHEET), at: new Date(), clear, fix }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  const ops = [
    ...clear.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { paymentDate: null } } } })),
    ...fix.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { paymentDate: new Date(`${c.to}T00:00:00.000Z`) } } } })),
  ];
  const r = await OperationsWorkflow.bulkWrite(ops, { ordered: false });
  console.log(`  عُدِّل: ${r.modifiedCount} صفًّا\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
