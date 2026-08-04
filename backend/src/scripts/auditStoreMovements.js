/**
 * auditStoreMovements — حركات مخزن النقل الثقيل: التراجع، والقاعدة اللي بيقوم
 * عليها.
 *
 *   node src/scripts/auditStoreMovements.js        (server on :5599)
 *
 * القاعدة (قرار الإدارة المالية): الحركة اللي اتسجّلت لا تُعدَّل ولا تُمسح. مفيش
 * PUT/PATCH/DELETE على الحركات — السكربت ده بيتأكد إنهم كلهم مرفوضين، وإن
 * التراجع بيمشي بحركة معاكسة بسبب إجباري، وإن الرصيد مبيبقاش سالب أبدًا.
 *
 * بيمسح كل ما أنشأه (zz-*) في الآخر ولا بيلمس بيانات حقيقية.
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
  if (r.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
  await User.deleteMany({ email: { $regex: '^zz-mv' } });
  const u = await User.create({ email: 'zz-mv@example.invalid', password: 'Test@12345', firstName: 'مخزن', lastName: 'تست', role: 'super_admin' });
  const ck = await login(u.email);

  const mk = async () => (await req('POST', '/api/ls2/store', ck, { name: 'zz-صنف حركات', unit: 'قطعة', quantity: 0, unitPrice: 10 })).body.item;
  const qty = async (id) => (await Ls2StoreItem.findById(id).lean()).quantity;
  const log = async (id) => (await req('GET', `/api/ls2/store/movements?item=${id}&limit=50`, ck)).body.movements;

  console.log('── التراجع عن «صادر» يرجّع الكمية ──');
  let it = await mk();
  await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'in', quantity: 10 });
  const out = await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'out', quantity: 4, vehiclePlate: 'zz-1' });
  ok('الرصيد بعد وارد 10 وصادر 4', await qty(it._id) === 6, `= ${await qty(it._id)}`);
  const r1 = await req('POST', `/api/ls2/store/movements/${out.body.movement._id}/reverse`, ck, { reason: 'اتصرفت بالغلط' });
  ok('التراجع نجح', r1.status === 200, `http ${r1.status}`);
  ok('الرصيد رجع 10', await qty(it._id) === 10, `= ${await qty(it._id)}`);
  let rows = await log(it._id);
  ok('السطر الأصلي اتعلّم reversed', rows.find((m) => String(m._id) === String(out.body.movement._id))?.reversed === true);
  ok('اتكتب سطر تراجع مربوط بالأصلي', rows.some((m) => String(m.reversalOf) === String(out.body.movement._id)));
  ok('سطر التراجع مش ينفع يترجع فيه', rows.find((m) => m.isReversal)?.canReverse === false);
  ok('الأصلي بقى مش قابل للتراجع', rows.find((m) => String(m._id) === String(out.body.movement._id))?.canReverse === false);

  console.log('\n── مينفعش تتراجع مرتين ──');
  const again = await req('POST', `/api/ls2/store/movements/${out.body.movement._id}/reverse`, ck, {});
  ok('الرفض بـ 400 برسالة واضحة', again.status === 400 && /من قبل/.test(again.body?.message || ''), again.body?.message);

  console.log('\n── التراجع عن «وارد» متصرَّف مينفعش يخلّي الرصيد سالب ──');
  it = await mk();
  const inMv = await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'in', quantity: 5 });
  await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'out', quantity: 5 });
  ok('الرصيد 0 بعد ما اتصرف', await qty(it._id) === 0);
  const bad = await req('POST', `/api/ls2/store/movements/${inMv.body.movement._id}/reverse`, ck, {});
  ok('الرفض بـ 400 وبيقول الرصيد كام', bad.status === 400 && /الرصيد الحالي 0/.test(bad.body?.message || ''), bad.body?.message);
  ok('الرصيد ما اتلمسش', await qty(it._id) === 0, `= ${await qty(it._id)}`);

  console.log('\n── السبب إجباري: تراجع بدون سبب مرفوض ──');
  it = await mk();
  await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'in', quantity: 8 });
  const o2 = await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'out', quantity: 2 });
  const noReason = await req('POST', `/api/ls2/store/movements/${o2.body.movement._id}/reverse`, ck, {});
  ok('التراجع بدون سبب مرفوض', noReason.status === 400 && /سبب/.test(noReason.body?.message || ''), noReason.body?.message);
  ok('الرصيد ما اتلمسش', await qty(it._id) === 6, `= ${await qty(it._id)}`);
  const withReason = await req('POST', `/api/ls2/store/movements/${o2.body.movement._id}/reverse`, ck, { reason: 'العربية الغلط' });
  ok('بسبب مكتوب: نجح', withReason.status === 200, `http ${withReason.status}`);
  rows = await log(it._id);
  ok('السبب اتسجّل على الأصلية', rows.find((m) => String(m._id) === String(o2.body.movement._id))?.reversalReason === 'العربية الغلط');
  ok('وظهر في سطر التراجع', /العربية الغلط/.test(rows.find((m) => m.isReversal)?.reason || ''));

  console.log('\n── الحركة المسجّلة لا تُعدَّل: مفيش مسار تعديل خالص ──');
  it = await mk();
  const target = await req('POST', `/api/ls2/store/${it._id}/movement`, ck, { type: 'in', quantity: 9, reason: 'أصلي' });
  const mid = target.body.movement._id;
  for (const [m, path] of [
    ['PATCH', `/api/ls2/store/movements/${mid}`],
    ['PUT', `/api/ls2/store/movements/${mid}`],
    ['DELETE', `/api/ls2/store/movements/${mid}`],
  ]) {
    const r = await req(m, path, ck, { quantity: 1, type: 'out', reason: 'محاولة تعديل' });
    ok(`${m} على حركة مرفوض`, r.status === 404 || r.status === 405, `http ${r.status}`);
  }
  const still = (await log(it._id))[0];
  ok('الحركة ما اتغيّرتش', still.quantity === 9 && still.type === 'in' && still.reason === 'أصلي');
  ok('والرصيد زي ما هو', await qty(it._id) === 9, `= ${await qty(it._id)}`);

  await Ls2StoreMovement.deleteMany({ itemName: { $regex: '^zz-' } });
  await Ls2StoreItem.deleteMany({ name: { $regex: '^zz-' } });
  await User.deleteMany({ email: { $regex: '^zz-mv' } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
