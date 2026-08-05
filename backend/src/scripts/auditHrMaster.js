/**
 * auditHrMaster — ماستر الموارد البشرية: الكروت، «مطلوب» مقابل «غير مطلوب»،
 * وملء البيانات من الشاشة.
 *
 *   node src/scripts/auditHrMaster.js
 *   node src/scripts/auditHrMaster.js --base http://127.0.0.1:5001
 *
 * أهم حاجة بيتأكد منها: أول ما حقل «مطلوب» يتملي، العدّاد بينقص لوحده. من غير
 * كده، الموارد البشرية بتشتغل والرقم يفضل مكانه فيفضلوا بيدوّروا على شغل خلص.
 * وكمان إن «غير مطلوب» عمرها ما بتتحسب ناقصة.
 *
 * بيرجّع أي حقل غيّره لأصله وبيمسح مستخدميه.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
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
  const Employee = require('../models/Employee');
  await User.deleteMany({ email: { $regex: '^zz-hr' } });
  const u = await User.create({ email: 'zz-hr@example.invalid', password: 'Test@12345', firstName: 'م', lastName: 'ب', role: 'hr_manager' });
  const ck = await login(u.email);

  console.log('── النظرة الشاملة ──');
  const o = await req('GET', '/api/hr/master/overview', ck);
  ok('الرد 200', o.status === 200, `http ${o.status}`);
  ok('عدد الموظفين', o.body?.totals?.employees > 300, `${o.body?.totals?.employees}`);
  ok('مجموعة لكل قسم من الماستر', (o.body?.groups || []).length === 12, (o.body?.groups || []).map((g) => g.key).join(', '));
  const iq = (o.body?.groups || []).find((g) => g.key === 'iqama');
  ok('الإقامات فيها حالات التاريخ', iq && typeof iq.states?.expired === 'number', JSON.stringify(iq?.states));
  const iqExp = iq?.fields?.find((f) => f.key === 'iqamaExpiry');
  ok('وكل حقل فيه مطلوب/غير مطلوب/مملي', iqExp && typeof iqExp.counts.required === 'number',
    `مطلوب ${iqExp?.counts.required} · غير مطلوب ${iqExp?.counts.not_required} · مملي ${iqExp?.counts.filled}`);
  ok('«غير مطلوب» متعدّة لوحدها مش مع الناقص', (iqExp?.counts.not_required || 0) > 0, `${iqExp?.counts.not_required}`);
  ok('إجمالي المطلوب محسوب', o.body?.totals?.required > 1000, `${o.body?.totals?.required} حقل مطلوب`);
  ok('«ابدأ من هنا» مرتّبة بالأكتر نقصًا', (o.body?.topRequired || []).length > 0
    && o.body.topRequired[0].required >= o.body.topRequired[o.body.topRequired.length - 1].required,
    o.body?.topRequired?.slice(0, 3).map((f) => `${f.ar}:${f.required}`).join(' · '));

  console.log('\n── صفحة كل مجموعة ──');
  for (const g of ['iqama', 'passport', 'contract', 'medicalInsurance', 'healthCertificate', 'driverCard', 'drivingLicense', 'banking', 'gosi']) {
    const r = await req('GET', `/api/hr/master/records/${g}`, ck);
    ok(`صفحة ${g}`, r.status === 200 && Array.isArray(r.body?.rows), `${r.body?.rows?.length} صف`);
  }
  const bad = await req('GET', '/api/hr/master/records/nope', ck);
  ok('مجموعة غير معروفة مرفوضة', bad.status === 404);

  console.log('\n── الفلترة على «مطلوب» ──');
  const reqOnly = await req('GET', '/api/hr/master/records/iqama?field=iqamaExpiry&status=required', ck);
  ok('فلتر «مطلوب» بيرجّع الناقصين بس', (reqOnly.body?.rows || []).every((r) => r.statuses.iqamaExpiry === 'required'), `${reqOnly.body?.rows?.length} موظف`);
  ok('وكل صف بيقول ناقصه إيه بالاسم', (reqOnly.body?.rows || []).every((r) => r.missing.some((m) => m.key === 'iqamaExpiry')));
  const nreq = await req('GET', '/api/hr/master/records/iqama?field=iqamaExpiry&status=not_required', ck);
  ok('فلتر «غير مطلوب» منفصل', (nreq.body?.rows || []).every((r) => r.statuses.iqamaExpiry === 'not_required'), `${nreq.body?.rows?.length} موظف`);

  console.log('\n── الانتهاءات بفلتر مرن ──');
  for (const days of [30, 60, 90]) {
    const r = await req('GET', `/api/hr/master/expiring?withinDays=${days}&includeExpired=0`, ck);
    const outside = (r.body?.rows || []).filter((x) => x.daysRemaining > days || x.daysRemaining < 0);
    ok(`خلال ${days} يوم: كل الصفوف داخل المدة`, outside.length === 0, `${r.body?.summary?.total} صف`);
  }
  const allExp = await req('GET', '/api/hr/master/expiring', ck);
  ok('كل المستندات ممثَّلة', (allExp.body?.byDoc || []).length === 7, (allExp.body?.byDoc || []).map((d) => `${d.ar}:${d.count}`).join(' · '));

  console.log('\n── ملء بيانات ناقصة: العدّاد لازم ينقص ──');
  const target = (reqOnly.body?.rows || [])[0];
  ok('لقينا موظف ناقصه تاريخ الإقامة', !!target, target?.name);
  const before = o.body.groups.find((g) => g.key === 'iqama').fields.find((f) => f.key === 'iqamaExpiry').counts.required;
  const fill = await req('PATCH', `/api/hr/master/employees/${target._id}/fields`, ck, { fields: { iqamaExpiry: '2027-06-30' } });
  ok('الحفظ نجح', fill.status === 200, `http ${fill.status} ${fill.body?.message || ''}`);
  ok('حالة الحقل بقت «مملي»', fill.body?.statuses?.iqamaExpiry === 'filled', fill.body?.statuses?.iqamaExpiry);
  const o2 = await req('GET', '/api/hr/master/overview', ck);
  const after = o2.body.groups.find((g) => g.key === 'iqama').fields.find((f) => f.key === 'iqamaExpiry').counts.required;
  ok('عدّاد «مطلوب» نقص واحد لوحده', after === before - 1, `${before} → ${after}`);
  const badField = await req('PATCH', `/api/hr/master/employees/${target._id}/fields`, ck, { fields: { hackerField: 'x' } });
  ok('حقل مش في التعريف مرفوض', badField.status === 400, badField.body?.message);
  const badDate = await req('PATCH', `/api/hr/master/employees/${target._id}/fields`, ck, { fields: { iqamaExpiry: 'مش تاريخ' } });
  ok('تاريخ غير صالح مرفوض', badDate.status === 400, badDate.body?.message);

  // رجّع الموظف لحالته
  await Employee.updateOne({ _id: target._id }, { $set: { iqamaExpiry: null }, $set: { [`fieldStatus.iqamaExpiryStatus`]: 'required' } });
  await User.deleteMany({ email: { $regex: '^zz-hr' } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
