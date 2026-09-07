require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const q = { paymentType: 'cash', collectionDate: null, cashCollectionStatus: { $ne: 'collected' }, username: { $nin: [null, ''] } };
  const ex = await OperationsWorkflow.find(q).select('username sellingValue reportDate paymentDate').lean().explain('executionStats');
  const st = ex.executionStats;
  console.log(`الخطّة: ${JSON.stringify(ex.queryPlanner.winningPlan.inputStage?.stage || ex.queryPlanner.winningPlan.stage)}`);
  console.log(`فهرسٌ مستعمل: ${JSON.stringify(ex.queryPlanner.winningPlan.inputStage?.keyPattern || ex.queryPlanner.winningPlan.inputStage?.inputStage?.keyPattern || 'لا')}`);
  console.log(`فُحص: ${st.totalDocsExamined} مستندًا · أُعيد: ${st.nReturned} · زمنُ التنفيذ في الخادم: ${st.executionTimeMillis}ms`);

  // البديل: التجميعُ في القاعدة — تُعاد مئاتُ المجموعات لا آلافُ المستندات
  const t = Date.now();
  const agg = await OperationsWorkflow.aggregate([
    { $match: q },
    { $group: {
      _id: '$username',
      outstanding: { $sum: { $ifNull: ['$sellingValue', 0] } },
      count: { $sum: 1 },
      days: { $push: { $dateDiff: { startDate: { $ifNull: ['$reportDate', '$paymentDate'] }, endDate: '$$NOW', unit: 'day' } } },
    } },
  ]);
  console.log(`\nالتجميعُ في القاعدة: ${agg.length} مجموعة في ${Date.now() - t}ms`);
  await mongoose.disconnect();
})();
