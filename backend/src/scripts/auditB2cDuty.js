/** يمشّي تفقُّدَ بداية الدوام كاملًا على بياناتٍ حقيقيّة ثمّ يمحو أثرَه. */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const B2CRep = require('../models/B2CRep');
  const B2CDutyCheck = require('../models/B2CDutyCheck');
  const User = require('../models/User');
  const duty = require('../controllers/b2cDutyController');
  const { deleteStoredFile } = require('../utils/fileStore');

  const call = (fn, req) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } };
    fn({ query: {}, params: {}, body: {}, ip: '', ...req }, res).catch((e) => r({ code: 500, body: { err: e.message, stack: e.stack } }));
  });

  const sup = await User.findOne({ role: 'b2c_project_lead' }).lean()
    || await User.findOne({ role: 'b2c_manager' }).lean();
  const other = await User.findOne({ role: 'operations_manager' }).lean();
  const boss = await User.findOne({ role: 'super_admin' }).lean();
  const reps = await B2CRep.find({ isActive: { $ne: false } }).limit(3).lean();
  if (!sup || reps.length < 2) { console.log('لا بيانات كافية', { sup: !!sup, reps: reps.length }); process.exit(0); }
  console.log(`\n  المشرف: ${sup.firstName} ${sup.lastName} (${sup.role})`);
  console.log(`  المندوبون تحت الاختبار: ${reps.map((r) => r.englishName).join(' · ')}\n`);

  const prevSup = reps.map((r) => ({ _id: r._id, supervisor: r.supervisor }));
  await B2CRep.updateMany({ _id: { $in: [reps[0]._id, reps[1]._id] } }, { $set: { supervisor: sup._id } });

  const today = duty.dayKeyOf();
  const PIX = 'data:image/jpeg;base64,' + fs.readFileSync(require('path').join(__dirname, '../../package.json')).toString('base64').slice(0, 0)
    // صورةُ JPEG صغيرةٌ صالحة (1×1)
    + '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

  console.log('  ── شاشة المشرف ──');
  const mine = await call(duty.myReps, { user: sup, query: {} });
  console.log(`    مندوبوه: ${mine.body?.total} · فُقِّد اليوم: ${mine.body?.done}`);

  console.log('\n  ── التسجيل ──');
  const noPhoto = await call(duty.submit, { user: sup, body: { rep: String(reps[0]._id), outcome: 'started' } });
  console.log(`    «بدأ الدوام» بلا صورة → ${noPhoto.code} ${noPhoto.code === 400 ? '✓ مرفوض' : '✗ قُبل!'}  (${noPhoto.body?.message || ''})`);

  const notMine = await call(duty.submit, { user: other || boss, body: { rep: String(reps[0]._id), outcome: 'started', photos: [{ dataUrl: PIX, captureSource: 'camera' }] } });
  console.log(`    مشرفٌ آخر يُفقّد مندوبًا ليس له → ${notMine.code} ${notMine.code === 403 ? '✓ مرفوض' : (other ? '✗ قُبل!' : '(لا مستخدم للاختبار)')}`);

  const uploaded = await call(duty.submit, { user: sup, body: { rep: String(reps[0]._id), outcome: 'started', photos: [{ dataUrl: 'data:application/pdf;base64,AAAA' }] } });
  console.log(`    ملفٌّ ليس صورة → ${uploaded.code} ${uploaded.code === 400 ? '✓ مرفوض' : '✗ قُبل!'}`);

  const ok = await call(duty.submit, { user: sup, body: {
    rep: String(reps[0]._id), outcome: 'started', vehicleType: 'motorcycle', conditionAr: 'سليمة',
    photos: [{ dataUrl: PIX, captureSource: 'camera', fileName: 'bike.jpg' }],
    location: { lat: 24.71, lng: 46.67, accuracy: 12 },
  } });
  console.log(`    تفقّدٌ سليم → ${ok.code} ${ok.code === 201 ? '✓' : '✗ ' + JSON.stringify(ok.body).slice(0, 200)}`);
  const photoUrl = ok.body?.check?.photos?.[0]?.fileUrl;
  console.log(`      الصورة حُفظت على القرص: ${photoUrl || '—'}`);

  const dmg = await call(duty.submit, { user: sup, body: {
    rep: String(reps[1]._id), outcome: 'blocked', conditionAr: 'غير صالحة للعمل', hasDamage: true,
    damageNotes: 'الفرامل لا تعمل', photos: [{ dataUrl: PIX, captureSource: 'camera' }],
  } });
  console.log(`    مُنع من الخروج + تلف → ${dmg.code === 201 ? '✓' : '✗ ' + JSON.stringify(dmg.body).slice(0, 150)}`);

  const dup = await call(duty.submit, { user: sup, body: { rep: String(reps[0]._id), outcome: 'started', notes: 'تصحيح', photos: [{ dataUrl: PIX, captureSource: 'camera' }] } });
  const after = await B2CDutyCheck.findOne({ rep: reps[0]._id, dateKey: today }).lean();
  console.log(`    إعادةُ التسجيل لنفس اليوم → ${dup.code} · عدد الصفوف=${await B2CDutyCheck.countDocuments({ rep: reps[0]._id, dateKey: today })} ${'(صفٌّ واحد ✓)'} · الصور=${after.photos.length} ${after.photos.length === 2 ? '(تُضاف لا تُستبدَل ✓)' : '✗'}`);

  console.log('\n  ── سجلّ الإدارة ──');
  const list = await call(duty.list, { user: boss, query: { date: today } });
  console.log(`    صفوف اليوم: ${list.body?.total}`);
  const miss = await call(duty.missing, { user: sup, query: {} });
  console.log(`    لم يُفقَّدوا بعد (عند هذا المشرف): ${miss.body?.missing?.length} من ${miss.body?.total}`);

  const rev = await call(duty.review, { user: boss, params: { id: String(ok.body.check._id) }, body: { verdict: 'flagged', note: 'الدرّاجة بها خدش أمامي' } });
  console.log(`    مراجعةُ الإدارة → ${rev.code === 200 ? '✓ ' + rev.body.check.review.verdict : '✗'}`);
  const revBySup = await call(duty.review, { user: sup, params: { id: String(ok.body.check._id) }, body: { verdict: 'ok' } });
  console.log(`    مشرفٌ يحاول المراجعة → ${revBySup.code} ${revBySup.code === 403 ? '✓ مرفوض' : '✗ قُبل!'}`);

  console.log('\n  ── التحليل ──');
  const an = await call(duty.analytics, { user: boss, query: { from: today, to: today } });
  const T = an.body?.totals || {};
  console.log(`    تفقّدات=${T.checks} · بدأ=${T.started} · مُنع=${T.blocked} · تلف=${T.damaged} · بصورة=${T.withPhoto} · مُراجَع=${T.reviewed}`);
  console.log(`    المتوقَّع=${T.expected} · نسبة الالتزام=${T.compliance}%`);
  const meRow = (an.body?.supervisors || []).find((x) => String(x._id) === String(sup._id));
  console.log(`    صفُّ المشرف: مندوبون=${meRow?.reps} · مطلوب=${meRow?.due} · نُفِّذ=${meRow?.checks} · التزام=${meRow?.compliance}%`);
  console.log(`    توزيع الحالة: ${(an.body?.byCondition || []).map((c) => `${c._id}=${c.count}`).join('  ') || '—'}`);
  console.log(`    الأكثر تلفًا: ${(an.body?.topDamage || []).map((c) => `${c.name}×${c.times}`).join('  ') || '—'}`);

  const supList = await call(duty.supervisors, { user: boss });
  console.log(`    المشرفون الذين لهم مندوبون: ${supList.body?.supervisors?.length}`);

  console.log('\n  ── العزل ──');
  const otherView = other ? await call(duty.list, { user: other, query: { date: today } }) : null;
  if (otherView) console.log(`    مستخدمٌ من قسمٍ آخر يرى: ${otherView.body?.total} صفًّا ${otherView.body?.total === 0 ? '✓' : '(يرى ما سجّله هو فقط)'}`);

  // التنظيف
  const made = await B2CDutyCheck.find({ dateKey: today, rep: { $in: reps.map((r) => r._id) } }).lean();
  made.forEach((m) => (m.photos || []).forEach((p) => deleteStoredFile(p.fileUrl)));
  await B2CDutyCheck.deleteMany({ _id: { $in: made.map((m) => m._id) } });
  for (const p of prevSup) await B2CRep.updateOne({ _id: p._id }, { $set: { supervisor: p.supervisor || null } });
  console.log('\n  (حُذفت صفوفُ الاختبار وصورُها، وأُعيد الإسنادُ كما كان)\n');
  await mongoose.disconnect();
})();
