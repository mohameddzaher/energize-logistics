require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const startOfToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
  const today = startOfToday();

  // هل لتواريخ الكشوف وقتٌ في اليوم؟ وهل لفواتير الدفتر؟
  const w = await OperationsWorkflow.find({ paymentType: 'cash', reportDate: { $ne: null } })
    .select('reportNumber reportDate').limit(5).lean();
  console.log('تواريخُ كشوفٍ نقديّة:');
  w.forEach((x) => console.log(`   ${x.reportNumber}: ${x.reportDate.toISOString()}`));
  const inv = await CollectionInvoice.find({ invoiceDate: { $ne: null } }).select('invoiceNumber invoiceDate').limit(5).lean();
  console.log('تواريخُ فواتيرِ الدفتر:');
  inv.forEach((x) => console.log(`   ${x.invoiceNumber}: ${x.invoiceDate.toISOString()}`));

  // الطريقتان على صفٍّ له وقت
  const withTime = await OperationsWorkflow.findOne({
    paymentType: 'cash', reportDate: { $ne: null },
    $expr: { $ne: [{ $dateToString: { date: '$reportDate', format: '%H:%M:%S' } }, '00:00:00'] },
  }).select('reportNumber reportDate').lean();
  if (withTime) {
    const msFloor = Math.floor((today - new Date(withTime.reportDate)) / 86400000);
    const [{ d }] = await OperationsWorkflow.aggregate([
      { $match: { _id: withTime._id } },
      { $project: { d: { $dateDiff: { startDate: '$reportDate', endDate: today, unit: 'day' } } } },
    ]);
    console.log(`\nكشفٌ له وقت: ${withTime.reportNumber} @ ${withTime.reportDate.toISOString()}`);
    console.log(`   الطريقةُ القديمة (قسمةُ المللي): ${msFloor} يومًا`);
    console.log(`   الطريقةُ الجديدة ($dateDiff):   ${d} يومًا`);
  } else {
    console.log('\nلا كشفَ بوقتٍ غيرِ منتصفِ الليل — فالفارقُ من مصدرٍ آخر.');
  }
  await mongoose.disconnect();
})();
