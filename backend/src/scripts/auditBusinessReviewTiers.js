/**
 * auditBusinessReviewTiers — what does each tier of user ACTUALLY get?
 *
 * The whole point of the section is that five kinds of people see five different
 * things out of one meeting. That is easy to claim and easy to break, so this
 * builds a real meeting through the live API and then prints, per tier, exactly
 * what that tier can reach — including the refusals.
 *
 * The line that matters most: an employee sees only the task delegated to them,
 * with no minutes text and not even the meeting's reference number.
 *
 * Creates `zz-t-*` users and deletes them. Usage (server running):
 *   node src/scripts/auditBusinessReviewTiers.js --base http://localhost:5599
 *
 * NOTE: do NOT point these at :5000 on macOS — AirPlay Receiver owns that port
 * and answers 403 with an empty body, which reads exactly like a broken access
 * check. That cost an hour once.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const argv = process.argv.slice(2);
const iBase = argv.indexOf('--base');
const BASE = (iBase >= 0 && argv[iBase + 1] ? argv[iBase + 1]
  : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`     ${c ? '✓' : '✗ FAIL'} ${l}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };

async function req(m, p, ck, b) {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function login(e) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'Test@12345' }) });
  // The login limiter is 30 per 15 minutes and is in-memory. Running the audits
  // back to back trips it, and the failures that follow look like broken access
  // control rather than a throttled test. Say so instead of guessing.
  if (r.status === 429) {
    console.error('\nRATE LIMITED (429) on login — the auth limiter, not a bug in the app.');
    console.error('Wait 15 minutes or restart the API (the counter is in-memory), then re-run.');
    process.exit(2);
  }
  if (r.status !== 200) {
    const why = await r.text().catch(() => '');
    console.error(`\nLOGIN FAILED for ${e} — http ${r.status}: ${why.slice(0, 200)}`);
    console.error('headers:', JSON.stringify(Object.fromEntries(r.headers.entries())).slice(0, 400));
    console.error('Cannot audit access control without a session.');
    process.exit(2);
  }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}
// Mirrors the frontend nav rule (lib/businessReview.ts).
const isRunner = (r) => ['super_admin','admin','it_manager','it_specialist','moderator','administration_staff'].includes(r);
const isParticipant = (r) => isRunner(r) || ['b2c_manager','operations_staff','moderator'].includes(r) || /_manager$/.test(r);
const navFor = (role) => [
  isParticipant(role) && 'اجتماعات المراجعة',
  isParticipant(role) && 'البنود المسندة إليّ',
  isRunner(role) && 'سجل المتابعة',
  'مهامي من الاجتماعات',
].filter(Boolean);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const { BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
  const N = require('../models/Notification');
  await User.deleteMany({ email: { $regex: '^zz-t-' } });
  const mk = (k, role) => User.create({ email: `zz-t-${k}@example.invalid`, password: 'Test@12345', firstName: k, lastName: 'T', role });

  const gm  = await mk('gm', 'admin');            // مدير الشركة
  const sec = await mk('sec', 'administration_staff');   // السكرتارية
  const ops = await mk('ops', 'operations_manager'); // مدير قسم (حاضر)
  const hr  = await mk('hr', 'hr_manager');       // مدير قسم (غائب عن الاجتماع)
  const emp = await mk('emp', 'employee');        // موظف

  const C = {}; for (const [k, u] of Object.entries({ gm, sec, ops, hr, emp })) C[k] = await login(u.email);

  // Build one meeting: GM + secretary + ops manager. HR is NOT invited.
  const m = await req('POST', '/api/business-review/meetings', C.sec, {
    title: 'اجتماع المديرين الأسبوعي', cadence: 'weekly', scheduledAt: new Date().toISOString(),
    location: 'قاعة الاجتماعات', departments: ['Operations'],
    attendees: [{ user: String(gm._id), isChair: true }, { user: String(sec._id) }, { user: String(ops._id) }],
  });
  if (!m.body?.meeting) { console.error('FATAL: could not create the meeting —', m.status, JSON.stringify(m.body)); process.exit(1); }
  const M = m.body.meeting._id;
  await req('PUT', `/api/business-review/meetings/${M}/minutes`, C.sec, {
    summary: 'ملخص سري', minutes: [{ heading: 'الأسطول', body: 'كلام الإدارة الداخلي' }],
  });
  const a = await req('POST', `/api/business-review/meetings/${M}/actions`, C.sec, {
    title: 'رفع نسبة الالتزام', assignee: String(ops._id), raisedBy: String(gm._id),
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
  });
  const A = a.body.action._id;
  await req('POST', `/api/business-review/actions/${A}/delegate`, C.ops,
    { assignments: [{ assignee: String(emp._id), title: 'متابعة يومية للسائقين' }] });

  const tiers = [
    ['مدير الشركة (admin)', 'gm', gm],
    ['السكرتارية (administrator)', 'sec', sec],
    ['مدير قسم — حضر (operations_manager)', 'ops', ops],
    ['مدير قسم — غير مدعو (hr_manager)', 'hr', hr],
    ['موظف (employee)', 'emp', emp],
  ];

  for (const [label, key, u] of tiers) {
    const ck = C[key];
    console.log(`\n═══ ${label} ═══`);
    const meetings = await req('GET', '/api/business-review/meetings', ck);
    const one = await req('GET', `/api/business-review/meetings/${M}`, ck);
    const myActions = await req('GET', '/api/business-review/my-actions', ck);
    const register = await req('GET', '/api/business-review/actions', ck);
    const myTasks = await req('GET', '/api/business-review/my-tasks', ck);
    const meta = await req('GET', '/api/business-review/meta', ck);

    console.log(`     sidebar: ${navFor(u.role).join('  |  ')}`);
    console.log(`     meetings list: ${(meetings.body.meetings || []).length}  ·  this meeting: http ${one.status}  ·  register: http ${register.status}`);
    console.log(`     my actions: ${(myActions.body.actions || []).length}  ·  my tasks: ${(myTasks.body.assignments || []).length}`);

    if (key === 'gm' || key === 'sec') {
      ok('sees the meeting + its minutes', one.status === 200 && (one.body.meeting.minutes || []).length === 1);
      ok('can open the whole register', register.status === 200 && (register.body.actions || []).length >= 1);
      ok('can write minutes / raise actions', one.body.can.writeMinutes && one.body.can.raiseActions);
      ok('dashboard has the company overview', !!(await req('GET', '/api/business-review/dashboard', ck)).body.overview);
    }
    if (key === 'ops') {
      ok('sees the meeting he attended, with the minutes', one.status === 200 && (one.body.meeting.minutes || []).length === 1);
      ok('owns the action from it', (myActions.body.actions || []).length === 1);
      ok('sees his own delegation under it', (myActions.body.actions[0].delegations || []).length === 1);
      ok('CANNOT open the company register', register.status === 403);
      ok('cannot write minutes', one.body.can.writeMinutes === false);
      ok('dashboard has NO company overview', !(await req('GET', '/api/business-review/dashboard', ck)).body.overview);
    }
    if (key === 'hr') {
      ok('meeting list is empty (was not invited)', (meetings.body.meetings || []).length === 0);
      ok('REFUSED the meeting he did not attend', one.status === 403, one.body?.message);
      ok('cannot open the register', register.status === 403);
      ok('still a participant (his own board works)', myActions.status === 200);
    }
    if (key === 'emp') {
      ok('meetings list empty + flagged not-a-participant',
        (meetings.body.meetings || []).length === 0 && meetings.body.participant === false);
      ok('REFUSED the meeting record', one.status === 403);
      ok('REFUSED the register', register.status === 403);
      ok('sees exactly his own 1 task', (myTasks.body.assignments || []).length === 1, myTasks.body.assignments?.[0]?.title);
      ok('no minutes text anywhere in his payload', !JSON.stringify(myTasks.body).includes('كلام الإدارة الداخلي'));
      ok('no meeting reference either', !/BRM-/.test(JSON.stringify(myTasks.body)));
      ok('meta says he is not a participant', meta.body.me.isParticipant === false && meta.body.me.canRunMeetings === false);
      ok('sidebar shows him ONE link only', navFor(u.role).length === 1, navFor(u.role).join(''));
    }
  }

  // A brand-new manager role must work with no code change.
  console.log('\n═══ a role that does not exist yet ═══');
  ok('a future *_manager is a participant', isParticipant('logistics_manager'));
  ok('a future non-manager is not', !isParticipant('logistics_clerk'));
  ok('…but the non-manager still gets his own tasks link', navFor('logistics_clerk').length === 1);

  const ids = [gm, sec, ops, hr, emp].map((u) => u._id);
  await BrAssignment.deleteMany({ action: A }); await BrAction.deleteMany({ meeting: M });
  await BrMeeting.deleteMany({ _id: M }); await N.deleteMany({ recipient: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
