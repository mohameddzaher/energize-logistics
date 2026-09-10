/** مراحلُ السداد: تتكرّر، تحمل مرفقًا، وتحرس الإقفال. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { ensureDefaultLookups } = require('../config/lookupTypes');
  await ensureDefaultLookups();
  const CustomsClearance = require('../models/CustomsClearance');
  const Lookup = require('../models/Lookup');
  const User = require('../models/User');
  const ctrl = require('../controllers/customsClearanceController');
  const { deleteStoredFile } = require('../utils/fileStore');
  const boss = await User.findOne({ role: 'super_admin' }).lean();
  const user = { ...boss, name: 'Test' };
  const call = (fn, req) => new Promise((r) => {
    const res = { statusCode: 200, status(s){this.statusCode=s;return this;}, json(b){ r({code:this.statusCode, body:b}); } };
    fn({ query:{}, params:{}, body:{}, ip:'', user, ...req }, res).catch((e)=>r({code:500,body:{err:e.message, stack:e.stack}}));
  });
  const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');

  const stages = await Lookup.find({ type: 'customs_payment_stage', deleted: { $ne: true } }).sort({ order: 1 }).lean();
  console.log(`\n  المراحلُ في إعدادات القسم (${stages.length}): ${stages.map((s) => s.nameAr).join(' · ')}`);

  const cl = await CustomsClearance.findOne({}).lean();
  if (!cl) { console.log('لا معاملاتَ للاختبار'); process.exit(0); }
  const id = String(cl._id);
  const before = (cl.paymentStages || []).length;
  const beforeAtt = (cl.attachments || []).length;
  console.log(`  المعاملة: ${cl.refNumber} · إدخالاتٌ قائمة=${before} · مرفقات=${beforeAtt}\n`);

  console.log('  ── الإضافة ──');
  const bad = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'لا-توجد' } });
  console.log(`    مرحلةٌ غيرُ معروفة → ${bad.code} ${bad.code === 400 ? '✓ مرفوضة' : '✗'}`);
  const empty = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'dutyPaid' } });
  console.log(`    بلا تاريخٍ ولا ملفّ → ${empty.code} ${empty.code === 400 ? '✓ مرفوضة' : '✗'}  (${empty.body?.message || ''})`);

  const a1 = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'dutyPaid', date: '2026-08-03', amount: 1200, dataUrl: PDF, fileName: 'duty-1.pdf' } });
  console.log(`    «سداد الرسوم» دفعةٌ أولى → ${a1.code === 201 ? '✓' : '✗ ' + JSON.stringify(a1.body).slice(0,200)}`);
  const a2 = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'dutyPaid', date: '2026-08-11', amount: 800, dataUrl: PDF, fileName: 'duty-2.pdf' } });
  const doc2 = a2.body?.clearance;
  const dutyEntries = (doc2?.paymentStages || []).filter((p) => p.key === 'dutyPaid').length;
  console.log(`    «سداد الرسوم» دفعةٌ ثانية → ${a2.code === 201 ? '✓' : '✗'} · عددُ إدخالاتها الآن=${dutyEntries} ${dutyEntries >= 2 ? '✓ تتكرّر' : '✗ لا تتكرّر'}`);
  console.log(`    المرفقُ وصل «مرفقات المعاملة»؟ ${(doc2?.attachments || []).length === beforeAtt + 2 ? 'نعم ✓' : 'لا ✗ (' + (doc2?.attachments||[]).length + ')'}`);

  console.log('\n  ── الإقفال ──');
  const c1 = await call(ctrl.completeClearance, { params: { id }, body: {} });
  console.log(`    بلا فاتورة نقل → ${c1.code} ${c1.code === 400 ? '✓ مُنع' : '✗ نفذ!'}`);
  console.log(`      السبب: ${c1.body?.message || ''}`);

  const tOnlyDate = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'transportInvoice', date: '2026-08-20' } });
  const c2 = await call(ctrl.completeClearance, { params: { id }, body: {} });
  console.log(`    فاتورةُ نقلٍ بتاريخٍ بلا مرفق → الإقفال ${c2.code} ${c2.code === 400 ? '✓ ما زال ممنوعًا' : '✗ نفذ!'}`);

  const tFull = await call(ctrl.addPaymentStage, { params: { id }, body: { key: 'transportInvoice', date: '2026-08-21', dataUrl: PDF, fileName: 'transport.pdf' } });
  const c3 = await call(ctrl.completeClearance, { params: { id }, body: {} });
  console.log(`    فاتورةُ نقلٍ بتاريخٍ ومرفق → الإقفال ${c3.code} ${c3.code === 200 ? '✓ نفذ' : '✗ ' + (c3.body?.message||'')}`);
  console.log(`      مقفولة=${c3.body?.clearance?.isCompleted} · بواسطة=${c3.body?.clearance?.completedByName || '—'}`);
  const c4 = await call(ctrl.completeClearance, { params: { id }, body: { completed: false } });
  console.log(`    إعادةُ الفتح → ${c4.code} · مقفولة=${c4.body?.clearance?.isCompleted} ${c4.body?.clearance?.isCompleted === false ? '✓' : '✗'}`);

  // ── التنظيف ─────────────────────────────────────────────────────────────
  const fresh = await CustomsClearance.findById(id);
  const added = (fresh.paymentStages || []).slice(before);
  added.forEach((p) => { if (p.fileUrl) { try { deleteStoredFile(p.fileUrl); } catch (e) {} } });
  fresh.paymentStages = fresh.paymentStages.slice(0, before);
  fresh.attachments = fresh.attachments.slice(0, beforeAtt);
  fresh.isCompleted = !!cl.isCompleted;
  fresh.completedAt = cl.completedAt || null;
  fresh.completedBy = cl.completedBy || null;
  fresh.completedByName = cl.completedByName || '';
  await fresh.save();
  console.log('\n  (أُعيدت المعاملةُ إلى ما كانت عليه)\n');
  await mongoose.disconnect();
})();
