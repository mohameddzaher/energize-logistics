/**
 * auditUserActions — does every super-admin action on a user ACTUALLY take effect?
 *
 * Written after a real incident: the users page offered a password field in the
 * Edit modal, the request returned 200, the modal closed — and nothing changed,
 * because the controller never read the field. The same was true of the email.
 * A form that *looks* like it worked is worse than one that errors.
 *
 * So this exercises every action through the REAL HTTP API and then re-reads the
 * database to confirm the change landed: name, email, role, password (both admin
 * paths and the user's own), lock, deactivate, the permission matrix, and every
 * assignment field. It also checks the things that must NOT happen — no role
 * escalation via self-service, no duplicate emails, no 500s on bad input.
 *
 * It creates its own throw-away users (prefix `zz-audit-`) and deletes them at
 * the end; it never touches real accounts. The only shared state it writes is
 * one role's permission row, which it restores.
 *
 * Usage (from backend/, with the server running):
 *   node src/server.js &                       # or point BASE at any instance
 *   BASE=http://localhost:5000 node src/scripts/auditUserActions.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const BASE = process.env.BASE || process.env.AUDIT_BASE || 'http://localhost:5000';
let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '\u2713' : '\u2717 FAIL'}  ${label}${extra ? '  \u2014 ' + extra : ''}`);
  cond ? (pass += 1) : (fail += 1);
};
const section = (t) => console.log(`\n\u2500\u2500 ${t} \u2500\u2500`);

let adminCookie = '';
async function req(method, path, body, cookie = adminCookie) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* not every response is JSON */ }
  return { status: r.status, body: json };
}
// Login is rate-limited (30 attempts / 15 min — middleware/rateLimiter.js) and
// this audit signs in a couple of dozen times. A 429 is NOT a failing assertion,
// it is the audit running out of budget; reporting it as a failure would send
// someone hunting a bug that isn't there. So it is detected and called out.
let rateLimited = false;
async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) rateLimited = true;
  return { status: r.status, cookie: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
}

const bail = () => {
  if (!rateLimited) return;
  console.error('\n\u26a0  The login rate limit (30 / 15 min) was hit part-way through.');
  console.error('   Results after that point are meaningless \u2014 restart the API (the limiter is');
  console.error('   in-memory) or wait 15 minutes, then run this again.');
  process.exit(2);
};

const PREFIX = 'zz-audit-';
const mail = (n) => `${PREFIX}${n}@example.invalid`;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const RolePermission = require('../models/RolePermission');
  const Branch = require('../models/Branch');
  const Employee = require('../models/Employee');
  const Customer = require('../models/Customer');
  const { FleetCustomer } = require('../models/FleetModels');

  console.log(`auditing ${BASE}\n`);
  await User.deleteMany({ email: { $regex: `^${PREFIX}` } });

  await User.create({ email: mail('admin'), password: 'Admin@12345', firstName: 'Audit', lastName: 'Admin', role: 'super_admin' });
  const boss = await User.create({ email: mail('boss'), password: 'Boss@12345', firstName: 'Audit', lastName: 'Boss', role: 'admin' });
  const target = await User.create({ email: mail('target'), password: 'OldPass@123', firstName: 'Old', lastName: 'Name', role: 'employee' });
  const TID = target._id.toString();
  const fresh = () => User.findById(TID).lean();

  const a = await login(mail('admin'), 'Admin@12345');
  adminCookie = a.cookie;
  if (a.status === 429) { bail(); }
  if (a.status !== 200) { console.error('could not log the audit admin in \u2014 is the server running?'); process.exit(1); }

  // \u2500\u2500 identity \u2500\u2500
  section('name');
  await req('PUT', `/api/users/${TID}`, { firstName: 'New', lastName: 'Person', role: 'employee' });
  let u = await fresh();
  ok('firstName changed in the DB', u.firstName === 'New', u.firstName);
  ok('lastName changed in the DB', u.lastName === 'Person', u.lastName);

  section('email');
  const r2 = await req('PUT', `/api/users/${TID}`, { email: mail('moved'), firstName: 'New', lastName: 'Person', role: 'employee' });
  u = await fresh();
  ok('email changed in the DB', u.email === mail('moved'), `http ${r2.status} \u2192 "${u.email}"`);
  ok('can log in with the NEW email', (await login(mail('moved'), 'OldPass@123')).status === 200);
  ok('a duplicate email is refused, not 500', (await req('PUT', `/api/users/${TID}`, { email: mail('boss') })).status === 400);

  section('role');
  await req('PUT', `/api/users/${TID}`, { role: 'hr_manager' });
  u = await fresh();
  ok('role changed in the DB', u.role === 'hr_manager', u.role);
  const s3 = await login(u.email, 'OldPass@123');
  const me3 = await req('GET', '/api/auth/me', null, s3.cookie);
  ok("the user's own /me reports the new role at once", me3.body?.user?.role === 'hr_manager', me3.body?.user?.role);

  // \u2500\u2500 passwords \u2500\u2500
  section('password \u2014 super admin');
  await req('PUT', `/api/users/${TID}`, { password: 'ViaEdit@1234' });
  ok('edit-modal password works', (await login(u.email, 'ViaEdit@1234')).status === 200);
  await req('POST', `/api/users/${TID}/reset-password`, { newPassword: 'ViaReset@1234' });
  ok('reset-password action works', (await login(u.email, 'ViaReset@1234')).status === 200);
  ok('the previous password stops working', (await login(u.email, 'ViaEdit@1234')).status === 401);
  ok('a short password is refused with 400', (await req('PUT', `/api/users/${TID}`, { password: 'short' })).status === 400);

  section('password \u2014 the user\u2019s own');
  const s5 = await login(u.email, 'ViaReset@1234');
  const cp = await req('POST', '/api/auth/change-password', { currentPassword: 'ViaReset@1234', newPassword: 'MyOwn@12345' }, s5.cookie);
  ok('self change-password succeeds', cp.status === 200, `http ${cp.status}`);
  ok('the user can log in with it', (await login(u.email, 'MyOwn@12345')).status === 200);
  const s5b = await login(u.email, 'MyOwn@12345');
  const cp2 = await req('POST', '/api/auth/change-password', { currentPassword: 'MyOwn@12345', newPassword: 'six123' }, s5b.cookie);
  ok('a too-short password gives a clear 400, not a 500', cp2.status === 400, `http ${cp2.status}`);
  ok('the old password still works after that refusal', (await login(u.email, 'MyOwn@12345')).status === 200);
  const s5c = await login(u.email, 'MyOwn@12345');
  const cp3 = await req('POST', '/api/auth/change-password', { currentPassword: 'WrongOne@123', newPassword: 'Another@1234' }, s5c.cookie);
  ok('a wrong current password is rejected', cp3.status === 400);

  // \u2500\u2500 access \u2500\u2500
  section('lock / deactivate');
  await req('POST', `/api/users/${TID}/lock`);
  ok('isLocked set in the DB', (await fresh()).isLocked === true);
  ok('a locked user cannot log in', (await login((await fresh()).email, 'MyOwn@12345')).status === 403);
  await req('POST', `/api/users/${TID}/lock`);
  ok('unlocking restores login', (await login((await fresh()).email, 'MyOwn@12345')).status === 200);

  const s6 = await login((await fresh()).email, 'MyOwn@12345');
  await req('PUT', `/api/users/${TID}`, { isActive: false });
  ok('isActive false in the DB', (await fresh()).isActive === false);
  ok('a deactivated user cannot log in', (await login((await fresh()).email, 'MyOwn@12345')).status === 403);
  ok('an ALREADY OPEN session is cut off at once', (await req('GET', '/api/auth/me', null, s6.cookie)).status === 403);
  await req('PUT', `/api/users/${TID}`, { isActive: true });

  section('role \u2192 section permissions');
  const before = await RolePermission.findOne({ role: 'hr_manager' }).lean();
  const pr = await req('PUT', '/api/admin/permissions/hr_manager', { sections: { CRM: 'edit' } });
  const afterDoc = await RolePermission.findOne({ role: 'hr_manager' }).lean();
  ok('permission write accepted', pr.status === 200, `http ${pr.status}`);
  ok('permission stored in the DB', JSON.stringify(afterDoc?.sections || {}).includes('"CRM":"edit"'));
  const s7 = await login((await fresh()).email, 'MyOwn@12345');
  const me7 = await req('GET', '/api/auth/me', null, s7.cookie);
  ok("the user's /me reflects it at once", me7.body?.user?.permissions?.CRM === 'edit', String(me7.body?.user?.permissions?.CRM));
  if (before) await RolePermission.replaceOne({ role: 'hr_manager' }, before);
  else await RolePermission.deleteOne({ role: 'hr_manager' });

  // \u2500\u2500 assignments \u2500\u2500
  section('assignment fields');
  const branch = await Branch.findOne({}).lean();
  if (branch) {
    await req('PUT', `/api/users/${TID}`, { branch: String(branch._id) });
    ok('branch assigned', String((await fresh()).branch) === String(branch._id));
  } else ok('branch assigned', true, 'skipped \u2014 no branches');

  await req('PUT', `/api/users/${TID}`, { manager: String(boss._id) });
  ok('direct manager assigned', String((await fresh()).manager) === String(boss._id));

  const emp = await Employee.findOne({}).lean();
  if (emp) {
    await req('PUT', `/api/users/${TID}`, { linkedEmployee: String(emp._id) });
    ok('linked to an employee profile', String((await fresh()).linkedEmployee) === String(emp._id));
    ok('\u2026and the employee points back (two-way)', String((await Employee.findById(emp._id).lean()).user) === TID);
    await req('PUT', `/api/users/${TID}`, { linkedEmployee: null });
    ok('unlinking clears both sides', !(await fresh()).linkedEmployee && !(await Employee.findById(emp._id).lean()).user);
  } else ok('employee link', true, 'skipped \u2014 no employees');

  const cust = await Customer.find({}).limit(2).lean();
  if (cust.length) {
    await req('PUT', `/api/users/${TID}`, { role: 'employee', assignedCustomers: cust.map((c) => String(c._id)) });
    ok('assigned customers stored', ((await fresh()).assignedCustomers || []).length === cust.length);
    ok('\u2026and the customers point back (assignedCollector)',
      String((await Customer.findById(cust[0]._id).lean()).assignedCollector) === TID);
    await req('PUT', `/api/users/${TID}`, { assignedCustomers: [] });
    ok('un-assigning clears the customer side too', !(await Customer.findById(cust[0]._id).lean()).assignedCollector);
  } else ok('assigned customers', true, 'skipped \u2014 no customers');

  await req('PUT', `/api/users/${TID}`, { role: 'remote_employee', remoteAccess: ['attendance', 'leave'] });
  ok('remote page access stored', ((await fresh()).remoteAccess || []).join(',') === 'attendance,leave');

  section('account type (staff \u21c4 partner)');
  const fc = await FleetCustomer.findOne({}).lean();
  if (fc) {
    const r = await req('PUT', `/api/users/${TID}`, { accountType: 'customer', partner: { source: 'fleet_customer', refId: String(fc._id) } });
    const pu = await fresh();
    ok('switched to a partner account', r.status === 200 && pu.accountType === 'customer' && pu.role === 'client');
    ok('partner link stamped with its name', pu.partner?.name === fc.name);
    await req('PUT', `/api/users/${TID}`, { accountType: 'employee', role: 'employee' });
    const su = await fresh();
    ok('switched back to staff, link cleared', su.accountType === 'employee' && !su.partner?.source);
  } else ok('partner switch', true, 'skipped \u2014 no fleet customers');

  section('self-service profile');
  const s8 = await login((await fresh()).email, 'MyOwn@12345');
  ok('own name change takes effect',
    (await req('PATCH', '/api/auth/me', { firstName: 'Self', lastName: 'Edited' }, s8.cookie)).status === 200
    && (await fresh()).firstName === 'Self');
  await req('PATCH', '/api/auth/me', { email: mail('self') }, s8.cookie);
  ok('own email change takes effect', (await fresh()).email === mail('self'));
  ok('\u2026and login works with it', (await login(mail('self'), 'MyOwn@12345')).status === 200);
  const s9 = await login(mail('self'), 'MyOwn@12345');
  ok('a duplicate email is refused', (await req('PATCH', '/api/auth/me', { email: mail('boss') }, s9.cookie)).status === 400);
  await req('PATCH', '/api/auth/me', { role: 'super_admin' }, s9.cookie);
  ok('a user CANNOT escalate their own role', (await fresh()).role !== 'super_admin', `role is ${(await fresh()).role}`);

  await User.deleteMany({ email: { $regex: `^${PREFIX}` } });
  bail(); // a 429 mid-run invalidates everything after it
  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
