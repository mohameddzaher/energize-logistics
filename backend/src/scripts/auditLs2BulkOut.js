/* eslint-disable no-console */
/**
 * auditLs2BulkOut — صادر لأكتر من صنف مرة واحدة من مخزن النقل الثقيل.
 *
 *   node src/scripts/auditLs2BulkOut.js --base https://api.energize-logistics.com
 *
 * الطلب: «أعمل سيليكت لأكتر من صنف، وأقول الصادر ده على أنهي عربية، ويتسجّل على
 * كل اللي عملتله سيليكت» — وقطعة واحدة من كل صنف.
 *
 * أهم حاجة بيتأكد منها: **الرفض ما يسيبش المخزن نصّه متصرّف**. لو صنف واحد
 * رصيده صفر، مفيش صنف واحد ينقص. وإن الحركات بتدخل نفس السجل بنفس الشكل بتاع
 * الصادر المفرد — عشان المراجع ما يفرّقش بينهم ويقدر يتراجع عن أي واحدة.
 *
 * بيشتغل على أصناف بيعملها ويمسحها.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');

  const cleanup = async () => {
    const ids = (await Ls2StoreItem.find({ name: { $regex: '^zz-ls2b' } }).select('_id').lean()).map((x) => x._id);
    await Ls2StoreMovement.deleteMany({ $or: [{ item: { $in: ids } }, { itemName: { $regex: '^zz-ls2b' } }] });
    await Ls2StoreItem.deleteMany({ name: { $regex: '^zz-ls2b' } });
  };
  await cleanup();
  await User.deleteMany({ email: { $regex: '^zz-ls2bulk' } });

  const u = await User.create({
    email: 'zz-ls2bulk@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'خ', role: 'super_admin', isActive: true,
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const post = async (p, body) => {
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify(body),
    });
    let j = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j };
  };
  const qty = async (id) => (await Ls2StoreItem.findById(id).lean()).quantity;

  try {
    const A = await Ls2StoreItem.create({ name: 'zz-ls2b-فلتر', quantity: 10, unit: 'قطعة' });
    const B = await Ls2StoreItem.create({ name: 'zz-ls2b-سير', quantity: 4, unit: 'قطعة' });
    const C = await Ls2StoreItem.create({ name: 'zz-ls2b-طرمبة', quantity: 1, unit: 'قطعة' });
    const Z = await Ls2StoreItem.create({ name: 'zz-ls2b-خالص', quantity: 0, unit: 'قطعة' });
    ok('٤ أصناف اختبار (١٠ · ٤ · ١ · ٠)', true);

    // ═══ ① صادر لتلات أصناف — قطعة من كل واحد ═════════════════════════════
    console.log('\n── صادر لتلات أصناف مرة واحدة ──');
    const r1 = await post('/api/ls2/store/bulk-out', {
      items: [A._id, B._id, C._id], vehiclePlate: '5010', reason: 'تيست',
    });
    ok('العملية نجحت', r1.status === 201, `HTTP ${r1.status} ${r1.body?.message || ''}`);
    ok(`الملخّص: ${r1.body?.summary?.items} صنف · ${r1.body?.summary?.totalQty} قطعة`,
      r1.body?.summary?.items === 3 && r1.body?.summary?.totalQty === 3);
    ok(`قطعة واحدة نزلت من كل صنف (${await qty(A._id)}/${await qty(B._id)}/${await qty(C._id)})`,
      (await qty(A._id)) === 9 && (await qty(B._id)) === 3 && (await qty(C._id)) === 0);

    // الحركات في نفس السجل وبنفس الشكل
    const mvs = await Ls2StoreMovement.find({ itemName: { $regex: '^zz-ls2b' } }).lean();
    ok('٣ حركات اتكتبت في نفس السجل', mvs.length === 3);
    ok('كلها صادر على نفس العربية وبنفس السبب',
      mvs.every((m) => m.type === 'out' && m.vehiclePlate === '5010' && m.reason === 'تيست'));
    ok('وكل واحدة معاها الرصيد بعدها واسم اللي عملها',
      mvs.every((m) => typeof m.balanceAfter === 'number' && m.performedByName));

    // ولسه ينفع يتراجع عن أي واحدة زي الصادر المفرد
    const rev = await post(`/api/ls2/store/movements/${mvs[0]._id}/reverse`, { reason: 'تيست تراجع' });
    ok('التراجع عن حركة منهم شغّال', rev.status === 200 || rev.status === 201, `HTTP ${rev.status}`);

    // ═══ ② الرفض الكامل ═══════════════════════════════════════════════════
    console.log('\n── صنف واحد رصيده مش كافي ⇒ الكل يترفض ──');
    const before = { a: await qty(A._id), b: await qty(B._id), z: await qty(Z._id) };
    const r2 = await post('/api/ls2/store/bulk-out', {
      items: [A._id, B._id, Z._id], vehiclePlate: '5011',
    });
    ok('اترفضت', r2.status === 400, `HTTP ${r2.status}`);
    ok('ورجّعت اسم الصنف الناقص', Array.isArray(r2.body?.errors)
      && r2.body.errors.some((e) => String(e.name || e.message).includes('خالص')),
      JSON.stringify(r2.body?.errors || []).slice(0, 90));
    ok(`ومفيش صنف نقص (${await qty(A._id)}/${await qty(B._id)}/${await qty(Z._id)})`,
      (await qty(A._id)) === before.a && (await qty(B._id)) === before.b && (await qty(Z._id)) === before.z);

    // ═══ ③ الكمية من كل صنف ═══════════════════════════════════════════════
    console.log('\n── كمية أكبر من واحد ──');
    const a0 = await qty(A._id);
    const r3 = await post('/api/ls2/store/bulk-out', { items: [A._id], quantityEach: 3, vehiclePlate: '5012' });
    ok('٣ من كل صنف', r3.status === 201, `HTTP ${r3.status}`);
    ok(`الرصيد نقص ٣ (${a0} → ${await qty(A._id)})`, (await qty(A._id)) === a0 - 3);
    const r4 = await post('/api/ls2/store/bulk-out', { items: [A._id, B._id], quantityEach: 99 });
    ok('كمية أكبر من رصيد أي صنف ⇒ مرفوض', r4.status === 400, `HTTP ${r4.status}`);

    // ═══ ④ التحقق ═════════════════════════════════════════════════════════
    console.log('\n── التحقق ──');
    ok('من غير أصناف ⇒ مرفوض', (await post('/api/ls2/store/bulk-out', { items: [] })).status === 400);
    ok('صنف مش موجود ⇒ مرفوض',
      (await post('/api/ls2/store/bulk-out', { items: [new mongoose.Types.ObjectId()] })).status === 400);
    // نفس الصنف متكرّر في الاختيار = مرة واحدة (Set)
    const b0 = await qty(B._id);
    const r5 = await post('/api/ls2/store/bulk-out', { items: [B._id, B._id, B._id] });
    ok('الصنف المتكرّر في الاختيار بيتحسب مرة واحدة', r5.status === 201 && (await qty(B._id)) === b0 - 1,
      `${b0} → ${await qty(B._id)}`);

    // ═══ ⑤ الصادر المفرد ما اتكسرش ════════════════════════════════════════
    console.log('\n── الصادر المفرد ──');
    const a1 = await qty(A._id);
    const single = await post(`/api/ls2/store/${A._id}/movement`, { type: 'out', quantity: 2, vehiclePlate: '5013' });
    ok('صادر مفرد', single.status === 201, `HTTP ${single.status}`);
    ok(`الرصيد نقص ٢ (${a1} → ${await qty(A._id)})`, (await qty(A._id)) === a1 - 2);
  } finally {
    await cleanup();
    await Employee.deleteMany({ email: { $regex: '^zz-ls2bulk' } });
    await User.deleteMany({ email: { $regex: '^zz-ls2bulk' } });
  }
  ok('التدقيق ما سابش أثر',
    (await Ls2StoreItem.countDocuments({ name: { $regex: '^zz-ls2b' } })) === 0
    && (await Ls2StoreMovement.countDocuments({ itemName: { $regex: '^zz-ls2b' } })) === 0);

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
