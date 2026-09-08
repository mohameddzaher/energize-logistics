/** مَن يرى ماذا في صندوق الوارد. يُنشئ طلباتٍ في محطّاتٍ مختلفة ثمّ يحذفها. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const LeaveRequest = require('../models/LeaveRequest');
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const LeaveType = require('../models/LeaveType');
  const hr = require('../controllers/hrController');
  const chain = require('../utils/leaveChain');

  const lt = await LeaveType.findOne().lean();
  const emp = await Employee.findOne({ user: { $ne: null }, employmentStatus: 'active' }).lean();
  const mgrA = await User.findOne({ role: 'operations_manager', isActive: { $ne: false } }).lean();
  const mgrB = await User.findOne({ role: 'fleet_manager', isActive: { $ne: false } }).lean();
  const hrU = await User.findOne({ role: { $in: chain.HR_ROLES } }).lean();
  const finU = await User.findOne({ role: { $in: chain.FINANCE_ROLES } }).lean();
  const exeU = await User.findOne({ role: 'admin' }).lean() || await User.findOne({ role: 'super_admin' }).lean();
  const itU = await User.findOne({ role: { $in: ['it_manager', 'it_specialist'] } }).lean();
  const plain = await User.findOne({ role: 'operations_staff' }).lean();

  const mk = (mgr, status, stage) => LeaveRequest.create({
    employee: emp._id, requester: emp.user, manager: mgr._id, leaveType: lt._id, leaveTypeCode: lt.code,
    startDate: '2027-05-01', endDate: '2027-05-02', days: 2, status, currentStage: stage, reason: 'اختبار الوارد',
  });
  const made = await Promise.all([
    mk(mgrA, 'pending_manager', 'manager'),
    mk(mgrB, 'pending_manager', 'manager'),
    mk(mgrA, 'pending_hr', 'hr'),
    mk(mgrA, 'pending_finance', 'finance'),
    mk(mgrA, 'pending_executive', 'executive'),
    mk(mgrA, 'info_requested', 'employee'),
    mk(mgrA, 'approved', 'done'),
  ]);
  const ids = made.map((m) => String(m._id));

  const inbox = (user) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r(b); } };
    hr.listLeaveInbox({ user }, res).catch((e) => r({ err: e.message }));
  });
  const rows = [
    ['المدير أ (operations_manager)', mgrA, ['pending_manager']],
    ['المدير ب (fleet_manager)', mgrB, ['pending_manager']],
    ['الموارد البشريّة', hrU, ['pending_hr']],
    ['الحسابات', finU, ['pending_finance']],
    ['الإدارة العليا', exeU, ['pending_executive']],
    ['تقنية المعلومات', itU, []],
    ['موظّفٌ عاديّ', plain, []],
  ];
  console.log('');
  for (const [label, u, want] of rows) {
    if (!u) { console.log(`  ${label.padEnd(30)} — لا مستخدمَ بهذا الدور`); continue; }
    const out = await inbox(u);
    const mine = (out.leaves || []).filter((l) => ids.includes(String(l._id)));
    const got = mine.map((l) => l.status).sort();
    const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
    console.log(`  ${label.padEnd(30)} ${ok ? '✓' : '✗'} يرى [${got.join(', ') || '—'}]  المتوقَّع [${want.join(', ') || '—'}]  محطّاته=${(out.stages || []).join('/')}`);
  }
  const sa = await User.findOne({ role: 'super_admin' }).lean();
  const saOut = await inbox(sa);
  const saMine = (saOut.leaves || []).filter((l) => ids.includes(String(l._id)));
  console.log(`  ${'مدير النظام'.padEnd(30)} ${saMine.length === 5 ? '✓' : '✗'} يرى ${saMine.length} من ٥ معلَّقة (لا المنتهيةَ ولا المرتدَّة)`);

  await LeaveRequest.deleteMany({ _id: { $in: ids } });
  console.log('\n(حُذفت طلباتُ الاختبار)');
  await mongoose.disconnect();
})();
