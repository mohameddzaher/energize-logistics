/**
 * auditEmployeeExit — لا يخرج موظّفٌ وبيده شيءٌ للشركة.
 *
 *   node src/scripts/auditEmployeeExit.js
 *
 * ── ما يفحصه ───────────────────────────────────────────────────────────────
 * حُذف سجلُّ موظّفٍ وبيده أجهزة، فاختفى هو وبقيت عهدتُه مسجَّلةً على اسمٍ لا
 * وجودَ له — تظهر في سجلّ تقنية المعلومات بخانةٍ فارغة. هذا الفحصُ يمنع عودتَه.
 *
 * لا يترك أثرًا: ما يُنشئه يُحذف.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
// المصدرُ يتبع الخادمَ الذي نفحصه لا ملفَّ البيئة المحلّيّ: حارسُ CSRF يقبل
// مصادرَ البرودكشن وحدها، فإرسالُ `localhost` إليه يردّ ٤٠٣ على كلّ POST — وهو
// ما يبدو عطبًا في الميزة وهو عطبٌ في الفحص.
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const Asset = require('../models/Asset');
  const VehicleAuthorization = require('../models/VehicleAuthorization');
  const Vehicle = require('../models/Vehicle');

  await User.deleteMany({ email: /^zz-exit/ });
  const hr = await User.create({ email: 'zz-exit-hr@example.invalid', password: PW, firstName: 'ح', lastName: 'ر', role: 'hr_manager' });
  const it = await User.create({ email: 'zz-exit-it@example.invalid', password: PW, firstName: 'ت', lastName: 'م', role: 'it_manager' });

  const login = async (email) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: PW }),
    });
    return { status: r.status, ck: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
  };
  const call = async (m, p, ck, b) => {
    const r = await fetch(`${BASE}${p}`, { method: m, headers: { Cookie: ck, Origin: ORIGIN, ...(b ? { 'Content-Type': 'application/json' } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, j };
  };

  const hrCk = (await login(hr.email)).ck;
  const itCk = (await login(it.email)).ck;
  ok('دخول الموارد البشريّة وتقنية المعلومات', !!hrCk && !!itCk);

  const made = { emps: [], assets: [], auths: [] };
  try {
    head('لا يُحذف موظّفٌ بيده عهدة');
    const e1 = await Employee.create({ firstName: 'zz-exit', lastName: 'حامل-عهدة' });
    made.emps.push(e1._id);
    const a1 = await Asset.create({ employee: e1._id, name: 'zz-جهاز', type: 'laptop', status: 'assigned' });
    made.assets.push(a1._id);

    const del1 = await call('DELETE', `/api/hr/employees/${e1._id}`, hrCk);
    ok('يُمنع الحذف', del1.status === 400, `${del1.status} ${del1.j?.message || ''}`);
    ok('ويُقال السببُ بعدده', (del1.j?.assets || 0) === 1, `عهدة ${del1.j?.assets}`);
    ok('ويبقى الموظّفُ موجودًا', !!(await Employee.findById(e1._id)));

    head('ولا مَن عليه تفويضُ مركبة');
    const e2 = await Employee.create({ firstName: 'zz-exit', lastName: 'مُفوَّض' });
    made.emps.push(e2._id);
    const veh = await Vehicle.findOne({}).select('_id').lean();
    if (veh) {
      const au = await VehicleAuthorization.create({ employee: e2._id, vehicle: veh._id, status: 'active', startDate: '2026-01-01' });
      made.auths.push(au._id);
      const del2 = await call('DELETE', `/api/hr/employees/${e2._id}`, hrCk);
      ok('يُمنع الحذف بالتفويض وحدَه', del2.status === 400, `${del2.status}`);
      ok('ويُسمّى التفويضُ في السبب', (del2.j?.authorizations || 0) === 1, `${del2.j?.authorizations}`);
      // ── والقاعدةُ نفسُها تحرس إنهاءَ الخدمة ─────────────────────────────
      // كان الإنهاءُ يفحص العهدةَ وحدَها، فيُمنع الحذفُ ويُسمح الإنهاء.
      ok('ولا يُقترَح ردٌّ آليٌّ ما دام التفويضُ قائمًا', del2.j?.canAutoReturnAssets === false);
      await VehicleAuthorization.updateOne({ _id: au._id }, { $set: { status: 'revoked' } });
      const del2b = await call('DELETE', `/api/hr/employees/${e2._id}`, hrCk);
      ok('فإذا أُنهي التفويضُ جاز الحذف', del2b.status === 200, `${del2b.status}`);
      made.emps = made.emps.filter((x) => String(x) !== String(e2._id));
    } else ok('(لا مركبات في القاعدة — تُخطّى)', true);

    head('والعهدةُ تعود للمستودع لا تبقى بلا صاحب');
    const del1b = await call('DELETE', `/api/hr/employees/${e1._id}?returnCustody=true`, hrCk);
    ok('يُحذف بإذنٍ صريح', del1b.status === 200, `${del1b.status}`);
    ok('ويُقال كم عاد', del1b.j?.assetsReturnedToStore === 1, `${del1b.j?.assetsReturnedToStore}`);
    const after = await Asset.findById(a1._id).lean();
    ok('والجهازُ في المستودع', after.status === 'in_stock', after.status);
    ok('وبلا صاحب', after.employee === null, String(after.employee));
    ok('ولم يُحذف — هو أصلٌ للشركة', !!after);
    made.emps = made.emps.filter((x) => String(x) !== String(e1._id));

    head('وتُسلَّم العهدةُ لمن ليس موظّفًا');
    const ext = await call('POST', '/api/it/custody', itCk, {
      type: 'laptop', brand: 'zz', holderName: 'zz-شخص خارجيّ', serialNumber: `zz-${Date.now()}`,
    });
    ok('تُقبل باسمٍ بلا موظّف', ext.status === 201, `${ext.status} ${ext.j?.message || ''}`);
    if (ext.j?.item?._id) made.assets.push(ext.j.item._id);
    ok('وتُقيَّد «خارجيّ»', ext.j?.item?.holderKind === 'external', ext.j?.item?.holderKind);
    ok('ولا تُنسَب لموظّف', !ext.j?.item?.employee, String(ext.j?.item?.employee));
    const none = await call('POST', '/api/it/custody', itCk, { type: 'laptop', brand: 'zz' });
    ok('ولا تُقبل بلا موظّفٍ ولا اسم', none.status === 400, `${none.status}`);

    head('والبيع يُسجَّل: لمن وبكم');
    const sellMe = await Asset.create({ name: 'zz-للبيع', type: 'laptop', status: 'in_stock' });
    made.assets.push(sellMe._id);
    const sold = await call('POST', `/api/it/custody/${sellMe._id}/sell`, itCk, { buyerName: 'zz-مشترٍ خارجيّ', price: 1500 });
    ok('يُقبل البيع لخارجيّ', sold.status === 200, `${sold.status} ${sold.j?.message || ''}`);
    const sd = await Asset.findById(sellMe._id).lean();
    ok('وحالتُه «مُباع»', sd.status === 'sold', sd.status);
    ok('واسمُ المشتري وسعرُه محفوظان', sd.soldToName === 'zz-مشترٍ خارجيّ' && sd.soldPrice === 1500, `${sd.soldToName} · ${sd.soldPrice}`);
    ok('ولا يبقى في يد أحد', !sd.employee, String(sd.employee));
    const again = await call('POST', `/api/it/custody/${sellMe._id}/sell`, itCk, { buyerName: 'zz-2' });
    ok('ولا يُباع مرّتين', again.status === 400, `${again.status}`);
  } finally {
    await Asset.deleteMany({ _id: { $in: made.assets } });
    await VehicleAuthorization.deleteMany({ _id: { $in: made.auths } });
    await Employee.deleteMany({ _id: { $in: made.emps } });
    await Employee.deleteMany({ firstName: 'zz-exit' });
    await User.deleteMany({ email: /^zz-exit/ });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
