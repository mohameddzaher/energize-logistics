/** يبني الفهارسَ الجديدة على الإنتاج ويقيسُ الأثر. لا يمسّ بيانات. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const q = { paymentType: 'cash', collectionDate: null, cashCollectionStatus: { $ne: 'collected' }, username: { $nin: [null, ''] } };
  let t = Date.now();
  await OperationsWorkflow.find(q).select('username sellingValue reportDate paymentDate').lean();
  console.log(`قبل الفهرسة: ${Date.now() - t}ms`);
  t = Date.now();
  await OperationsWorkflow.syncIndexes();
  console.log(`بناءُ الفهارس: ${Date.now() - t}ms`);
  t = Date.now();
  const rows = await OperationsWorkflow.find(q).select('username sellingValue reportDate paymentDate').lean();
  console.log(`بعد الفهرسة: ${Date.now() - t}ms (${rows.length} صفًّا)`);
  await mongoose.disconnect();
})();
