/** يمشّي طلبَ إجازةٍ على السلسلة كاملةً ثمّ يحذفه. لا يمسّ طلبًا قائمًا. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const LeaveRequest = require('../models/LeaveRequest');
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const hr = require('../controllers/hrController');
  const chain = require('../utils/leaveChain');

  const lt = await require('../models/LeaveType').findOne().lean();
  const emp = await Employee.findOne({ user: { $ne: null }, employmentStatus: 'active' }).populate('user').lean();
  const mgr = await User.findOne({ role: 'operations_manager', isActive: { $ne: false } }).lean();
  const hrU = await User.findOne({ role: { $in: chain.HR_ROLES }, isActive: { $ne: false } }).lean();
  const finU = await User.findOne({ role: { $in: chain.FINANCE_ROLES }, isActive: { $ne: false } }).lean();
  const exeU = await User.findOne({ role: 'super_admin' }).lean();
  console.log(`موظّف=${emp?.employeeNumber} مدير=${mgr?.email || '—'} موارد=${hrU?.email || '—'} حسابات=${finU?.email || '—'} إدارة=${exeU?.email || '—'}\n`);

  const leave = await LeaveRequest.create({
    employee: emp._id, requester: emp.user._id, manager: mgr?._id || null,
    startDate: '2027-01-10', endDate: '2027-01-12', days: 3,
    status: mgr ? 'pending_manager' : 'pending_hr', currentStage: mgr ? 'manager' : 'hr',
    reason: 'اختبار السلسلة — يُحذف', leaveType: lt._id, leaveTypeCode: lt.code,
  });
  const id = String(leave._id);
  const show = async (label) => {
    const l = await LeaveRequest.findById(id).lean();
    console.log(`  ${label.padEnd(30)} status=${String(l.status).padEnd(18)} stage=${l.currentStage}`);
    return l;
  };
  const decide = (user, decision, note) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } };
    hr.decideLeave({ params: { id }, body: { decision, note }, user, ip: '' }, res).catch((e) => r({ code: 500, body: { err: e.message } }));
  });
  const reply = (user, text) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } };
    hr.replyToLeave({ params: { id }, body: { text }, user, ip: '' }, res).catch((e) => r({ code: 500, body: { err: e.message } }));
  });

  await show('بعد الإنشاء');
  console.log(`المدير يوافق → ${(await decide(mgr, 'approved')).code}`);       await show('');
  console.log(`الموارد توافق → ${(await decide(hrU, 'approved')).code}`);      await show('');
  console.log(`الحسابات تسأل → ${(await decide(finU, 'info', 'عليه سلفة 500 ريال — يُسدَّد أوّلًا')).code}`); await show('');
  console.log(`الموظّف يردّ → ${(await reply(emp.user, 'سُدِّدت، وهذا الإيصال')).code}`);  const back = await show('');
  console.log(`   → عادت السلسلةُ للمدير؟ ${back.currentStage === (mgr ? 'manager' : 'hr') ? 'نعم ✓' : 'لا ✗'}`);
  console.log(`   → مُحيت الموافقاتُ السابقة؟ ${!back.managerDecision && !back.hrDecision ? 'نعم ✓' : 'لا ✗'}`);
  console.log(`   → السجلُّ فيه سؤالٌ وردّ؟ ${back.thread?.length === 2 ? 'نعم ✓' : 'لا ✗ (' + (back.thread?.length || 0) + ')'}`);
  console.log(`المدير يوافق → ${(await decide(mgr, 'approved')).code}`);       await show('');
  console.log(`الموارد توافق → ${(await decide(hrU, 'approved')).code}`);      await show('');
  console.log(`الحسابات توافق → ${(await decide(finU, 'approved')).code}`);    await show('');
  console.log(`الإدارة توافق → ${(await decide(exeU, 'approved')).code}`);     const fin = await show('النهاية');
  console.log(`\n   النتيجة: ${fin.status === 'approved' ? '✓ اعتُمدت بعد المحطّات الأربع' : '✗ ' + fin.status}`);

  // ومَن ليس صاحبَ المحطّة لا يبتّ
  const l2 = await LeaveRequest.create({ employee: emp._id, requester: emp.user._id, manager: mgr?._id || null, startDate: '2027-02-01', endDate: '2027-02-02', days: 2, status: 'pending_manager', currentStage: 'manager', reason: 'اختبار الحراسة', leaveType: lt._id, leaveTypeCode: lt.code });
  const res2 = await new Promise((r) => { const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } }; hr.decideLeave({ params: { id: String(l2._id) }, body: { decision: 'approved' }, user: finU, ip: '' }, res).catch((e) => r({ code: 500, body: { err: e.message } })); });
  console.log(`   الحسابات تحاول البتَّ في محطّة المدير → ${res2.code} ${res2.code === 403 ? '✓ مُنعت' : '✗ نفذت!'}`);

  // والإخطاراتُ: مَن أُخبِر بماذا وفي أيّ محطّة.
  const Notification = require('../models/Notification');
  const notes = await Notification.find({ relatedEntity: 'LeaveRequest', relatedEntityId: { $in: [leave._id] } })
    .sort({ createdAt: 1 }).select('recipient title').lean();
  const nameOf = new Map([[String(emp.user._id), 'الموظّف'], [String(mgr?._id), 'المدير'], [String(hrU?._id), 'الموارد'], [String(finU?._id), 'الحسابات'], [String(exeU?._id), 'الإدارة']]);
  console.log(`\n  الإخطارات (${notes.length}):`);
  const seen = new Map();
  for (const n of notes) { const k = `${n.title}`; seen.set(k, (seen.get(k) || 0) + 1); }
  for (const [t, c] of seen) console.log(`    ${String(c).padStart(2)}× ${t}`);
  const toEmp = notes.filter((n) => String(n.recipient) === String(emp.user._id)).map((n) => n.title);
  console.log(`\n  ما وصل الموظّفَ بالترتيب:`);
  toEmp.forEach((t) => console.log(`    · ${t}`));
  // الرسائلُ الموجَّهةُ إليه بصفته صاحبَ الطلب — لا ما وصله لأنّ حسابَه في
  // الموارد أو التقنية أيضًا (وهو حالُ حساب الاختبار).
  const own = toEmp.filter((t) => ['تقدّم طلب الإجازة', 'اعتُمدت إجازتك', 'رُفض طلب الإجازة', 'مطلوب إيضاح على طلب الإجازة'].includes(t));
  console.log(`\n  ما وصله بصفته صاحبَ الطلب: ${own.length} رسالة`);
  console.log(`   → «تقدّم» خمس مرّات (خمسُ نقلات)؟ ${own.filter((t) => t === 'تقدّم طلب الإجازة').length === 5 ? 'نعم ✓' : 'لا ✗ (' + own.filter((t) => t === 'تقدّم طلب الإجازة').length + ')'}`);
  console.log(`   → «اعتُمدت» مرّةً واحدةً وفي الآخِر؟ ${own.filter((t) => t === 'اعتُمدت إجازتك').length === 1 && own[own.length - 1] === 'اعتُمدت إجازتك' ? 'نعم ✓' : 'لا ✗'}`);
  console.log(`   → قيل له «اعتُمدت» قبل المحطّة الأخيرة؟ ${own.slice(0, -1).includes('اعتُمدت إجازتك') ? 'نعم ✗' : 'لا ✓'}`);
  await Notification.deleteMany({ relatedEntity: 'LeaveRequest', relatedEntityId: { $in: [leave._id, l2._id] } });

  await LeaveRequest.deleteMany({ _id: { $in: [id, l2._id] } });
  console.log('\n(حُذف طلبا الاختبار)');
  await mongoose.disconnect();
})();
