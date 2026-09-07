require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const sr = XLSX.utils.sheet_to_json(wb.Sheets['Shipment Report'], { header: 1, defval: '', blankrows: false });
  const nums = [];
  for (let i = 5; i < sr.length; i += 1) {
    const no = String(sr[i]?.[5] ?? '').trim();
    if (/^\d+$/.test(no)) nums.push(no);
  }
  const wf = await OperationsWorkflow.find({ reportNumber: { $in: nums } })
    .select('reportNumber paymentType paymentDate accountingReview collectionDate reportDate executionStatus').lean();
  console.log(`شحناتُ الورقة: ${nums.length} · وجدناها ككشوف: ${wf.length}`);
  const byType = {}; wf.forEach((w) => { byType[w.paymentType || '(بلا نوع)'] = (byType[w.paymentType || '(بلا نوع)'] || 0) + 1; });
  console.log('نوعُ الدفع:', Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' · '));

  // شاشةُ فواتير الكاش تشترط: نوعٌ نقديّ + (قبل ١ سبتمبر أو مراجعةُ تشغيل)
  const { AUTO_RULE_FROM } = require('../utils/paymentType');
  const visible = wf.filter((w) => w.paymentType === 'cash'
    && (new Date(w.reportDate) < AUTO_RULE_FROM || (w.accountingReview != null && w.accountingReview !== '')));
  console.log(`تظهر في شاشة فواتير الكاش: ${visible.length}`);
  const hidden = wf.filter((w) => w.paymentType === 'cash' && !visible.includes(w));
  console.log(`نقديّةٌ لا تظهر (بعد ١ سبتمبر وبلا مراجعة تشغيل): ${hidden.length}`);
  hidden.slice(0, 5).forEach((h) => console.log(`   ${h.reportNumber} · ${String(h.reportDate).slice(0, 10)} · مراجعة=«${h.accountingReview || ''}»`));
  const notCash = wf.filter((w) => w.paymentType !== 'cash');
  console.log(`ليست نقديّةً عندنا: ${notCash.length}`);
  notCash.slice(0, 5).forEach((h) => console.log(`   ${h.reportNumber} · نوع=${h.paymentType}`));
  await mongoose.disconnect();
})();
