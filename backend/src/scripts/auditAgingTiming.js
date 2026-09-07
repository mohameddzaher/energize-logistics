require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionInvoice = require('../models/CollectionInvoice');

  let t = Date.now();
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('_id name nameKey').lean();
  console.log(`قراءةُ العملاء (${parties.length}): ${Date.now() - t}ms`);

  t = Date.now();
  const cash = await OperationsWorkflow.find({
    paymentType: 'cash', collectionDate: null, cashCollectionStatus: { $ne: 'collected' }, username: { $nin: [null, ''] },
  }).select('username sellingValue reportDate paymentDate').lean();
  console.log(`الكشوفُ النقديّةُ غيرُ المحصَّلة: ${cash.length} صفًّا في ${Date.now() - t}ms  ← «مئاتٌ لا آلاف»؟`);

  t = Date.now();
  const agg = await CollectionInvoice.aggregate([
    { $match: { $or: [{ collectionDate: null }, { collectionDate: { $exists: false } }] } },
    { $group: { _id: '$party', n: { $sum: 1 } } },
  ]);
  console.log(`تجميعُ فواتير الدفتر المفتوحة: ${agg.length} مجموعة في ${Date.now() - t}ms`);

  // وهل الفهارس موجودة؟
  const idx = await OperationsWorkflow.collection.indexes();
  console.log('\nفهارسُ كشوف التشغيل ذاتُ الصلة:');
  idx.filter((i) => /paymentType|collectionDate|username/.test(JSON.stringify(i.key)))
    .forEach((i) => console.log('   ', JSON.stringify(i.key)));
  const idx2 = await CollectionsParty.collection.indexes();
  console.log('فهارسُ الأطراف:');
  idx2.forEach((i) => console.log('   ', JSON.stringify(i.key)));
  await mongoose.disconnect();
})();
