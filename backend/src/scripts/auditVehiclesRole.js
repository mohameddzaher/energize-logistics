/* eslint-disable no-console */
/**
 * auditVehiclesRole — دور مدير/موظف المركبات: بيدخل فعلاً، وبيشوف قسمه كامل،
 * وما بيوصلش لأقسام غيره.
 *
 *   node src/scripts/auditVehiclesRole.js --base https://api.energize-logistics.com
 *
 * السؤال اللي بيرد عليه: «عملت الدور، طيب هو شغّال؟». الدور اللي موجود في
 * ملف الإعدادات ومش واصل للـAPI بيبقى مالوش لازمة، والدور اللي واصل لكل حاجة
 * بيبقى خطر. الاتنين بيتفحصوا هنا على الحساب الحقيقي مش على حساب تجريبي.
 *
 * الدخول بيتعمل بالحساب الحقيقي (mohamed.abdeulaal@energize.com) عشان نتأكد إن
 * كلمة السر المتخزّنة شغّالة فعلًا — ده أكتر حاجة بتقع لما الحساب يتعمل بسكربت.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

const OWNER = { email: 'mohamed.abdeulaal@energize.com', password: 'Mohamedenergize' };

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

async function req(method, path, ck, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) { console.error('RATE LIMITED — استنى ١٥ دقيقة'); process.exit(2); }
  let j = null; try { j = await r.json(); } catch { /* */ }
  return {
    status: r.status, body: j,
    cookie: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '),
  };
}

// كل صفحة في قسم المركبات والاندبوينت اللي بيغذّيها.
const VEHICLE_PAGES = [
  ['/system/vehicles/registry/overview', '/api/vehicle-registry/overview'],
  ['/system/vehicles/registry', '/api/vehicle-registry/'],
  ['/system/vehicles/registry/expiring', '/api/vehicle-registry/expiring'],
  ['/system/vehicles/registry/claims', '/api/vehicle-registry/claims'],
  ['/system/vehicles/registry/corporate', '/api/vehicle-registry/corporate-policies'],
  ['/system/vehicles/registry/dashboard', '/api/vehicle-registry/dashboard'],
  // الشاشة اندمجت في «الانتهاءات والتجديد»، والاندبوينت باقٍ لتطبيق الجوّال — فيُختبر بلا صفحة.
  ['(تطبيق الجوّال — التنبيهات)', '/api/vehicle-registry/alerts'],
  ['/system/vehicles/registry/settings', '/api/vehicle-registry/settings'],
  ['(التفاويض)', '/api/vehicles/authorizations'],
];

// أقسام تانية — مالوش دعوة بيها.
const OTHER_SECTIONS = [
  ['الموارد البشرية', '/api/hr/employees'],
  ['المحاسبة', '/api/accounting/accounts'],
  ['المشتريات', '/api/procurement/requests'],
  ['إدارة العلاقات', '/api/crm/companies'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const R = require('../config/roles');

  // ═══ ١) الدور نفسه معرَّف صح ═══════════════════════════════════════════════
  console.log('── تعريف الدور ──');
  const roles = R.rolesOfSection('Vehicles');
  ok('قسم المركبات له مدير وموظف', roles.length >= 2 && roles.includes('vehicles_manager') && roles.includes('vehicles_staff'),
    roles.join(' · '));
  ok('المدير متعلّم كمدير', R.isManager('vehicles_manager'));
  ok('الموظف متعلّم كموظف', R.isStaff('vehicles_staff'));
  ok('الاتنين ليهم أسماء عربي وإنجليزي',
    !!(R.LABELS_AR.vehicles_manager && R.LABELS_EN.vehicles_manager && R.LABELS_AR.vehicles_staff && R.LABELS_EN.vehicles_staff),
    `${R.LABELS_AR.vehicles_manager} / ${R.LABELS_AR.vehicles_staff}`);
  ok('الدور مقبول في enum الموديل', User.schema.path('role').enumValues.includes('vehicles_manager'));

  // ═══ ٢) الحساب الحقيقي ═════════════════════════════════════════════════════
  console.log('\n── الحساب ──');
  const u = await User.findOne({ email: OWNER.email }).lean();
  ok('الحساب موجود', !!u, u ? '' : 'مش موجود');
  if (!u) { console.log('\nشغّل createVehiclesManager.js الأول'); process.exit(1); }
  ok(`الاسم: ${u.firstName} ${u.lastName}`, !!(u.firstName && u.lastName));
  ok(`الدور: ${u.role}`, u.role === 'vehicles_manager');
  ok('نشط ومش مقفول', u.isActive === true && u.isLocked !== true);

  const lr = await login(OWNER.email, OWNER.password);
  ok('بيدخل بكلمة السر المتخزّنة', lr.status === 200 && !!lr.cookie, `HTTP ${lr.status}`);
  if (!lr.cookie) { console.log('\nالدخول فشل — الباقي مالوش معنى'); process.exit(1); }
  const ck = lr.cookie;
  ok('الجلسة بترجّع نفس الدور', (lr.body?.user?.role || lr.body?.role) === 'vehicles_manager',
    lr.body?.user?.role || lr.body?.role || '?');

  // ═══ ٣) قسمه كامل واصل له ══════════════════════════════════════════════════
  console.log('\n── كل صفحة في قسم المركبات ──');
  for (const [page, ep] of VEHICLE_PAGES) {
    const r = await req('GET', ep, ck);
    ok(`${page.padEnd(42)} ${ep}`, r.status === 200, `HTTP ${r.status}`);
  }

  // ═══ ٤) ومعاه الكتابة، مش القراءة بس ═══════════════════════════════════════
  // «القسم كامل بكل الأكشنز لكل المفتوح له القسم» — فالمدير لازم يقدر يكتب.
  console.log('\n── الكتابة (القسم مفتوح بالكامل، مش قراءة بس) ──');
  const VM = require('../models/VehicleMaster');
  const VehicleMaster = VM.VehicleMaster || VM;
  const one = await VehicleMaster.findOne({}).select('_id plate notes').lean();
  if (one) {
    const before = one.notes || '';
    const w = await req('PUT', `/api/vehicle-registry/${one._id}`, ck, { notes: `${before} ` });
    ok(`تعديل مركبة (${one.plate})`, [200, 204].includes(w.status), `HTTP ${w.status} ${JSON.stringify(w.body || {}).slice(0, 70)}`);
    await VehicleMaster.updateOne({ _id: one._id }, { $set: { notes: before } });
  } else ok('مفيش مركبة للتجربة', false);

  // ═══ ٥) وما بيوصلش لأقسام غيره ═════════════════════════════════════════════
  console.log('\n── أقسام تانية: مقفولة ──');
  for (const [label, ep] of OTHER_SECTIONS) {
    const r = await req('GET', ep, ck);
    ok(`${label.padEnd(18)} ${ep.padEnd(30)} مرفوض`, r.status === 403 || r.status === 401, `HTTP ${r.status}`);
  }

  // ═══ ٦) والمتكرّرة في كل قسم شغّالة له ══════════════════════════════════════
  console.log('\n── المهام والشكاوى ──');
  for (const [label, ep] of [['مهامي', '/api/section-work/tasks?section=vehicles'],
    ['الشكاوى', '/api/section-work/complaints?section=vehicles']]) {
    const r = await req('GET', ep, ck);
    ok(`${label.padEnd(10)} ${ep}`, r.status === 200, `HTTP ${r.status}`);
  }

  // ═══ ٧) دور الموظف — نفس القسم، وبيوصله كامل برضه ═══════════════════════
  // «القسم كامل بكل الأكشنز لكل المفتوح له القسم» — الفرق بين المدير والموظف
  // في نطاق الرؤية، مش في الأزرار. فالموظف لازم يفتح نفس الصفحات.
  console.log('\n── دور موظف القسم (vehicles_staff) ──');
  await User.deleteMany({ email: { $regex: '^zz-vehstaff' } });
  const st = await User.create({
    email: 'zz-vehstaff@example.invalid', password: 'Test@12345',
    firstName: 'تيست', lastName: 'مركبات', role: 'vehicles_staff', isActive: true,
  });
  try {
    const sl = await login(st.email, 'Test@12345');
    ok('موظف القسم بيدخل', sl.status === 200 && !!sl.cookie, `HTTP ${sl.status}`);
    if (sl.cookie) {
      let seen = 0; const blocked = [];
      for (const [, ep] of VEHICLE_PAGES) {
        const r = await req('GET', ep, sl.cookie);
        if (r.status === 200) seen++; else blocked.push(`${ep} → ${r.status}`);
      }
      ok(`بيشوف ${seen}/${VEHICLE_PAGES.length} صفحة في القسم`, blocked.length === 0, blocked.slice(0, 3).join(' | '));
      const other = await req('GET', '/api/hr/employees', sl.cookie);
      ok('وما بيوصلش للموارد البشرية', other.status === 403 || other.status === 401, `HTTP ${other.status}`);
      const sw = await req('GET', '/api/section-work/tasks?section=vehicles', sl.cookie);
      ok('ومهامه شغّالة', sw.status === 200, `HTTP ${sw.status}`);
    }
  } finally {
    const Employee = require('../models/Employee');
    await Employee.deleteMany({ email: { $regex: '^zz-vehstaff' } });
    await User.deleteMany({ email: { $regex: '^zz-vehstaff' } });
  }
  ok('التدقيق ما سابش أثر', (await User.countDocuments({ email: { $regex: '^zz-vehstaff' } })) === 0);

  console.log(`\n${'─'.repeat(66)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
