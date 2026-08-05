/**
 * auditMeetingCompletion — «اكتمل» غير «انعقد»، والفلاتر والعدّادات بتحترم الفرق.
 *
 *   node src/scripts/auditMeetingCompletion.js
 *   node src/scripts/auditMeetingCompletion.js --base http://127.0.0.1:5001
 *
 * القاعدة: انعقد = الاجتماع حصل. اكتمل = الشؤون الإدارية بتقول إن كل حاجة
 * اترتّبت عليه خلصت — فمينفعش يتقفل وفيه بند تنفيذي أو تكليف فرعي لسه مفتوح،
 * وإلا الكلمة تبقى بلا معنى في الفلتر والتقارير.
 *
 * بيمسح كل ما أنشأه (zz-*) في الآخر ولا بيلمس بيانات حقيقية.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : 'http://localhost:5599').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
async function req(m, p, ck, b) {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function login(e) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'Test@12345' }) });
  if (r.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const { BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
  await User.deleteMany({ email: { $regex: '^zz-cm' } });
  const mk = (f, r) => User.create({ email: `zz-cm-${r}@example.invalid`, password: 'Test@12345', firstName: f, lastName: 'ت', role: r });
  const sec = await mk('أسماء', 'administration_staff');
  const gm = await mk('محمد', 'admin');
  const ops = await mk('الكادي', 'operations_manager');
  const emp = await mk('خالد', 'employee');
  const C = { sec: await login(sec.email), gm: await login(gm.email), ops: await login(ops.email), emp: await login(emp.email) };

  const newMeeting = async (title, cadence = 'weekly') => (await req('POST', '/api/business-review/meetings', C.sec, {
    title, cadence, scheduledAt: new Date().toISOString(),
    attendees: [{ user: String(gm._id), isChair: true }, { user: String(sec._id) }, { user: String(ops._id) }],
  })).body.meeting;

  console.log('── الدورات الجديدة: يومي ولحظي ──');
  const meta = await req('GET', '/api/business-review/meta', C.sec);
  const cadKeys = (meta.body?.cadences || []).map((c) => c.key);
  ok('«يومي» متاح', cadKeys.includes('daily'), cadKeys.join(', '));
  ok('«لحظي» متاح', cadKeys.includes('instant'));
  const daily = await newMeeting('zz-اجتماع الصباح', 'daily');
  ok('اجتماع يومي اتعمل', !!daily?._id && daily.cadence === 'daily');
  const inst = await newMeeting('zz-اجتماع لحظي', 'instant');
  ok('اجتماع لحظي اتعمل', !!inst?._id && inst.cadence === 'instant');
  const stKeys = (meta.body?.meetingStatuses || []).map((s) => s.key);
  ok('«اكتمل» حالة قائمة بذاتها غير «انعقد»', stKeys.includes('completed') && stKeys.includes('held'), stKeys.join(', '));

  console.log('\n── الإقفال مرفوض وفيه بنود مفتوحة ──');
  const m = await newMeeting('zz-اجتماع للإقفال');
  await req('PUT', `/api/business-review/meetings/${m._id}`, C.sec, { status: 'held', heldAt: new Date().toISOString() });
  const act = await req('POST', `/api/business-review/meetings/${m._id}/actions`, C.sec, {
    title: 'zz-بند مفتوح', assignee: String(ops._id), raisedBy: String(gm._id),
    dueDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  ok('اتسجّل بند', act.status === 201, `http ${act.status}`);
  const denied = await req('POST', `/api/business-review/meetings/${m._id}/complete`, C.sec, {});
  ok('الإقفال مرفوض', denied.status === 400 && denied.body?.code === 'OPEN_WORK', denied.body?.message);
  ok('وبيقول البند المفتوح بالاسم', (denied.body?.openActions || []).some((a) => a.title === 'zz-بند مفتوح'));
  ok('الحالة لسه «انعقد»', (await BrMeeting.findById(m._id).lean()).status === 'held');

  console.log('\n── تكليف فرعي مفتوح كمان بيمنع الإقفال ──');
  const del = await req('POST', `/api/business-review/actions/${act.body.action._id}/delegate`, C.ops, {
    assignments: [{ assignee: String(emp._id), title: 'zz-مهمة فرعية', dueDate: new Date(Date.now() + 5 * 864e5).toISOString() }],
  });
  ok('التوزيع تم', del.status === 200 || del.status === 201, `http ${del.status}`);
  await req('PATCH', `/api/business-review/actions/${act.body.action._id}`, C.ops, { status: 'done' });
  const stillOpen = await req('POST', `/api/business-review/meetings/${m._id}/complete`, C.sec, {});
  ok('البند اتقفل لكن التكليف الفرعي لسه — الإقفال مرفوض', stillOpen.status === 400 && stillOpen.body?.openTasks > 0, stillOpen.body?.message);

  console.log('\n── بعد ما كل حاجة تقفل: الإقفال ينفع ──');
  const assign = await BrAssignment.findOne({ action: act.body.action._id });
  await req('PATCH', `/api/business-review/assignments/${assign._id}`, C.emp, { status: 'done', progress: 100 });
  const done = await req('POST', `/api/business-review/meetings/${m._id}/complete`, C.sec, { note: 'كل حاجة خلصت' });
  ok('الإقفال نجح', done.status === 200 && done.body?.meeting?.status === 'completed', `http ${done.status}`);
  const closed = await BrMeeting.findById(m._id).lean();
  ok('اتسجّل مين قفله وامتى', !!closed.completedAt && closed.completedByName.includes('أسماء'), closed.completedByName);
  // المهم إن الاتنين حقلين منفصلين والإقفال ما مسحش «انعقد» — مش إن الوقتين
  // مختلفين، لأن اجتماع بيتقفل نفس اللحظة اللي اتحدد فيها إنه انعقد ده وضع سليم.
  ok('و«انعقد» فضل محفوظ في خانته المنفصلة', !!closed.heldAt && !!closed.completedAt);

  console.log('\n── مينفعش يتقفل من الدروب-ليست العادية ──');
  const m2 = await newMeeting('zz-محاولة التفاف');
  const sneaky = await req('PUT', `/api/business-review/meetings/${m2._id}`, C.sec, { status: 'completed' });
  ok('PUT status=completed مرفوض', sneaky.status === 400 && sneaky.body?.code === 'USE_COMPLETE_ENDPOINT', sneaky.body?.message);
  ok('الحالة ما اتغيّرتش', (await BrMeeting.findById(m2._id).lean()).status === 'scheduled');
  const twice = await req('POST', `/api/business-review/meetings/${m._id}/complete`, C.sec, {});
  ok('الإقفال مرتين مرفوض', twice.status === 400, twice.body?.message);
  const byManager = await req('POST', `/api/business-review/meetings/${m2._id}/complete`, C.ops, {});
  ok('مدير قسم مش بيقفل اجتماع', byManager.status === 403, `http ${byManager.status}`);

  console.log('\n── البطاقات: العدّادات والفلاتر ──');
  const list = await req('GET', '/api/business-review/meetings', C.sec);
  const c = list.body?.counts || {};
  ok('العدّادات راجعة', typeof c.completed === 'number' && typeof c.open === 'number', JSON.stringify(c));
  const onlyDone = await req('GET', '/api/business-review/meetings?bucket=completed', C.sec);
  ok('فلتر «مكتملة» بيرجّع المكتمل بس', (onlyDone.body?.meetings || []).every((x) => x.status === 'completed'), `${onlyDone.body?.meetings?.length} اجتماع`);
  ok('وعدده مطابق للعدّاد', (onlyDone.body?.meetings || []).length === c.completed, `${onlyDone.body?.meetings?.length} vs ${c.completed}`);
  const onlyOpen = await req('GET', '/api/business-review/meetings?bucket=open', C.sec);
  ok('فلتر «مفتوحة» مفيهوش مكتمل ولا ملغي',
    (onlyOpen.body?.meetings || []).every((x) => x.status !== 'completed' && x.status !== 'cancelled'), `${onlyOpen.body?.meetings?.length} اجتماع`);
  ok('العدّادات ما بتتأثرش بالفلتر', (onlyDone.body?.counts?.total || 0) === (c.total || 0), `${onlyDone.body?.counts?.total} vs ${c.total}`);

  console.log('\n── إعادة الفتح ──');
  const re = await req('POST', `/api/business-review/meetings/${m._id}/reopen`, C.sec, {});
  ok('إعادة الفتح نجحت', re.status === 200 && re.body?.meeting?.status === 'held', `http ${re.status}`);
  const after = await BrMeeting.findById(m._id).lean();
  ok('بيانات الإقفال اتمسحت', !after.completedAt && !after.completedByName);
  ok('و«انعقد» ما اتمسحش معاها — دليل إنهم مستقلين', !!after.heldAt);

  const ids = (await BrMeeting.find({ title: { $regex: '^zz-' } }).select('_id').lean()).map((x) => x._id);
  const acts = (await BrAction.find({ meeting: { $in: ids } }).select('_id').lean()).map((x) => x._id);
  await BrAssignment.deleteMany({ action: { $in: acts } });
  await BrAction.deleteMany({ meeting: { $in: ids } });
  await BrMeeting.deleteMany({ _id: { $in: ids } });
  await User.deleteMany({ email: { $regex: '^zz-cm' } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
