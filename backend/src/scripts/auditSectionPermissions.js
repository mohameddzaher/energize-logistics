/**
 * auditSectionPermissions — does a section grant actually DO anything?
 *
 * Takes a role with no business reason to be in any legacy list, grants it a
 * section through the real super-admin endpoint, and checks what it can reach:
 * «عرض» must read and not write, «تعديل» must be able to run every action the
 * UI offers. Run it after touching sectionGate, rbac, or any page's gate.
 *
 *   node src/scripts/auditSectionPermissions.js      (server on :5599)
 *
 * It restores the role's permissions and deletes its own zz-* users; a real
 * account is never touched.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const BASE = 'http://localhost:5599';
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
async function req(m, p, ck, b) {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function login(e) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'Test@12345' }) });
  if (r.status === 429) { console.error('\nRATE LIMITED — the login limiter, not a bug. Restart the server.'); process.exit(2); }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const RolePermission = require('../models/RolePermission');
  const { Ls2StoreItem } = (() => { try { return require('../models/Ls2Store'); } catch { return {}; } })();

  // A role with NO business reason to be in any legacy list.
  const ROLE = 'marketing_specialist';
  await User.deleteMany({ email: { $regex: '^zz-perm-' } });
  const u = await User.create({ email: 'zz-perm-a@example.invalid', password: 'Test@12345', firstName: 'تجربة', lastName: 'صلاحيات', role: ROLE });

  // Grant through the REAL endpoint the super admin uses — writing to Mongo
  // directly leaves the server's permission cache stale, which is a property of
  // the test, not of the app. A temporary super admin does the granting.
  const boss = await User.create({ email: 'zz-perm-boss@example.invalid', password: 'Test@12345', firstName: 'سوبر', lastName: 'أدمن', role: 'super_admin' });
  const bossCk = await login(boss.email);
  const original = await RolePermission.findOne({ role: ROLE }).lean();
  const held = original && original.sections ? Object.fromEntries(Object.entries(original.sections)) : {};
  const live = { ...held };
  const grant = async (section, access) => {
    live[section] = access;
    const r = await req('PUT', `/api/admin/permissions/${ROLE}`, bossCk, { sections: live });
    if (r.status !== 200) throw new Error(`grant failed: http ${r.status}`);
  };
  const restore = async () => {
    await req('PUT', `/api/admin/permissions/${ROLE}`, bossCk, { sections: held });
    if (!original) await RolePermission.deleteOne({ role: ROLE });
  };

  console.log('── with NO grant, the section is closed ──');
  let ck = await login(u.email);
  const before = await req('GET', '/api/ls2/store', ck);
  ok('store list refused', before.status === 403, `http ${before.status}`);

  console.log('\n── granted «عرض» → reads yes, writes no ──');
  await grant('Location Solutions', 'view');
  ck = await login(u.email);
  const rView = await req('GET', '/api/ls2/store', ck);
  ok('store list allowed', rView.status === 200, `http ${rView.status}`);
  const wView = await req('POST', '/api/ls2/store', ck, { name: 'zz-صنف', unit: 'قطعة', quantity: 1 });
  ok('creating an item refused', wView.status === 403, `http ${wView.status}`);

  console.log('\n── granted «تعديل» → the actions the UI now shows really work ──');
  await grant('Location Solutions', 'edit');
  ck = await login(u.email);
  const created = await req('POST', '/api/ls2/store', ck, { name: 'zz-صنف اختبار', unit: 'قطعة', quantity: 5, unitPrice: 10 });
  ok('صنف جديد works', created.status === 201 || created.status === 200, `http ${created.status}`);
  const id = created.body?.item?._id;
  if (id) {
    const inMv = await req('POST', `/api/ls2/store/${id}/movement`, ck, { type: 'in', quantity: 3, reason: 'اختبار' });
    ok('وارد works', inMv.status === 200 || inMv.status === 201, `http ${inMv.status}`);
    const outMv = await req('POST', `/api/ls2/store/${id}/movement`, ck, { type: 'out', quantity: 2, vehiclePlate: 'zz', reason: 'اختبار' });
    ok('صادر works', outMv.status === 200 || outMv.status === 201, `http ${outMv.status}`);
    const upd = await req('PUT', `/api/ls2/store/${id}`, ck, { unitPrice: 12 });
    ok('تعديل works', upd.status === 200, `http ${upd.status}`);
    const mv = await req('GET', '/api/ls2/store/movements?limit=10', ck);
    ok('سجل الحركات readable (the export source)', mv.status === 200 && Array.isArray(mv.body?.movements), `http ${mv.status}`);
    const del = await req('DELETE', `/api/ls2/store/${id}`, ck);
    ok('حذف works', del.status === 200, `http ${del.status}`);
  }

  console.log('\n── the same rule in the other sections the UI was hiding ──');
  await grant('Vehicles', 'edit');
  ck = await login(u.email);
  const veh = await req('POST', '/api/vehicle-registry', ck, { plateNumber: 'zz-0001', ownership: 'owned' });
  ok('Vehicles: a granted role may create', veh.status === 201, `http ${veh.status}`);
  const vid = veh.body?.vehicle?._id;
  if (vid) {
    const vu = await req('PUT', `/api/vehicle-registry/${vid}`, ck, { notes: 'zz' });
    ok('Vehicles: …and update', vu.status === 200, `http ${vu.status}`);
    const vd = await req('DELETE', `/api/vehicle-registry/${vid}`, ck);
    ok('Vehicles: …and delete', vd.status === 200, `http ${vd.status}`);
  }
  // A bad field must come back as a 400 saying which one, never a bare 500.
  const bad = await req('POST', '/api/vehicle-registry', ck, { ownership: 'owned' });
  ok('a missing required field returns 400, not 500', bad.status === 400 && !!bad.body?.message, `http ${bad.status} · ${bad.body?.message || ''}`);

  await grant('Accounting', 'edit');
  ck = await login(u.email);
  const acc = await req('POST', '/api/accounting/accounts', ck, { code: 'zz9999', nameAr: 'zz-حساب', nameEn: 'zz', type: 'asset' });
  ok('Accounting: a granted role may create', acc.status !== 403, `http ${acc.status}`);
  const aid = acc.body?.account?._id;
  if (aid) await req('DELETE', `/api/accounting/accounts/${aid}`, ck);

  // The permission change itself must leave a trail.
  const AuditLog = require('../models/AuditLog');
  const trail = await AuditLog.findOne({ action: 'update_role_permissions', entityKey: ROLE }).sort({ createdAt: -1 }).lean();
  ok('the permission change was audited', !!trail, trail ? `entityKey=${trail.entityKey}` : 'no entry');

  await restore();
  if (Ls2StoreItem) await Ls2StoreItem.deleteMany({ name: { $regex: '^zz-' } });
  await User.deleteMany({ email: { $regex: '^zz-perm-' } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
