/* eslint-disable no-console */
/**
 * auditBulkIssue — الصرف المجمّع من مخزن الورشة.
 *
 *   node src/scripts/auditBulkIssue.js --base https://api.energize-logistics.com
 *
 * أهم حاجة بيتأكد منها: **الرفض ما يسيبش المخزن نصّه متصرّف**. لو سطر واحد
 * رصيده مش كافي، لازم العملية كلها ترفض ومفيش صنف واحد ينقص. الصرف اللي نصّه
 * عدّى أسوأ من اللي اترفض كله — أمين المخزن مش هيبقى عارف أنهي سطر نزل، فيعيد
 * الصرف ويطلع بدل مرتين.
 *
 * وبيتأكد إن الصنف المتكرّر في أكتر من سطر بيتجمّع قبل التحقق: تلات أسطر × ٢
 * من نفس الصنف لازم تتقاس على ٦، مش كل سطر لوحده على ٢ والرصيد ٤ — وإلا
 * الرصيد بيبقى سالب.
 *
 * بيشتغل على **أصناف بيعملها ويمسحها**، عمره ما يلمس صنف شغّال.
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
  const InventoryItem = require('../models/InventoryItem');
  const InventoryIssue = require('../models/InventoryIssue');
  const Employee = require('../models/Employee');

  const cleanup = async () => {
    const ids = (await InventoryItem.find({ name: { $regex: '^zz-bulk' } }).select('_id').lean()).map((x) => x._id);
    await InventoryIssue.deleteMany({ $or: [{ item: { $in: ids } }, { itemName: { $regex: '^zz-bulk' } }] });
    await InventoryItem.deleteMany({ name: { $regex: '^zz-bulk' } });
  };
  await cleanup();
  await User.deleteMany({ email: { $regex: '^zz-bulkissue' } });

  const u = await User.create({
    email: 'zz-bulkissue@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'م', role: 'workshop_manager', isActive: true,
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const post = async (path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify(body),
    });
    let j = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j };
  };
  const qtyOf = async (id) => (await InventoryItem.findById(id).select('quantity underRenewalQty').lean());

  try {
    // ثلاثة أصناف اختبار برصيد معروف
    const mk = (name, q) => InventoryItem.create({
      name, code: name, quantity: q, unit: 'قطعة', isActive: true,
      approvalStatus: 'approved', category: 'zz-test',
    });
    const A = await mk('zz-bulk-فلتر', 10);
    const B = await mk('zz-bulk-زيت', 5);
    const C = await mk('zz-bulk-طقم', 3);
    ok('اتعملت ٣ أصناف اختبار (١٠ · ٥ · ٣)', !!(A && B && C));

    // ═══ ١) صرف عادي بأكتر من سطر ═════════════════════════════════════════
    console.log('\n── صرف ٣ أسطر مرة واحدة ──');
    const r1 = await post('/api/workshop/inventory/issue-bulk', {
      vehicleNumber: '5010', date: new Date().toISOString().slice(0, 10),
      lines: [
        { item: A._id, quantity: 3, replacedFate: 'none' },
        { item: B._id, quantity: 2, replacedFate: 'damaged' },
        { item: C._id, quantity: 1, replacedFate: 'under_renewal' },
      ],
    });
    ok('العملية نجحت', r1.status === 201, `HTTP ${r1.status} ${r1.body?.message || ''}`);
    ok(`الملخّص: ${r1.body?.summary?.lines} سطر · ${r1.body?.summary?.totalQty} قطعة`,
      r1.body?.summary?.lines === 3 && r1.body?.summary?.totalQty === 6);
    const [a1, b1, c1] = [await qtyOf(A._id), await qtyOf(B._id), await qtyOf(C._id)];
    ok(`الأرصدة اتخصمت صح: ${a1.quantity}/${b1.quantity}/${c1.quantity}`,
      a1.quantity === 7 && b1.quantity === 3 && c1.quantity === 2);
    ok('«تحت التجديد» اتسجّلت على الصنف', (c1.underRenewalQty || 0) === 1, `${c1.underRenewalQty}`);
    ok('٣ سجلات صرف اتكتبت', (await InventoryIssue.countDocuments({ itemName: { $regex: '^zz-bulk' } })) === 3);

    // ═══ ٢) الرفض الكامل — الحاجة الأهم ═══════════════════════════════════
    console.log('\n── سطر واحد غلط ⇒ العملية كلها ترفض ──');
    const before = { a: (await qtyOf(A._id)).quantity, b: (await qtyOf(B._id)).quantity, c: (await qtyOf(C._id)).quantity };
    const r2 = await post('/api/workshop/inventory/issue-bulk', {
      vehicleNumber: '5011',
      lines: [
        { item: A._id, quantity: 2, replacedFate: 'none' },      // سليم
        { item: B._id, quantity: 999, replacedFate: 'none' },    // أكبر من الرصيد
        { item: C._id, quantity: 1, replacedFate: 'none' },      // سليم
      ],
    });
    ok('اترفضت', r2.status === 400, `HTTP ${r2.status}`);
    ok('ورجّعت الخطأ بسطره', Array.isArray(r2.body?.errors) && r2.body.errors.length === 1,
      JSON.stringify(r2.body?.errors || []).slice(0, 80));
    const after = { a: (await qtyOf(A._id)).quantity, b: (await qtyOf(B._id)).quantity, c: (await qtyOf(C._id)).quantity };
    ok(`ومفيش صنف واحد نقص (${after.a}/${after.b}/${after.c})`,
      after.a === before.a && after.b === before.b && after.c === before.c,
      `كان ${before.a}/${before.b}/${before.c}`);

    // ═══ ٣) نفس الصنف في أكتر من سطر بيتجمّع ══════════════════════════════
    console.log('\n── صنف متكرّر: المجموع هو اللي بيتقاس ──');
    const b = (await qtyOf(B._id)).quantity;   // ٣
    const r3 = await post('/api/workshop/inventory/issue-bulk', {
      lines: [
        { item: B._id, quantity: 2, replacedFate: 'none' },
        { item: B._id, quantity: 2, replacedFate: 'none' },   // المجموع ٤ والرصيد ٣
      ],
    });
    ok(`رصيد ${b} وسطرين × ٢ ⇒ مرفوض`, r3.status === 400, `HTTP ${r3.status}`);
    ok('والرصيد ما اتغيّرش', (await qtyOf(B._id)).quantity === b);
    // وبمجموع مقبول بيعدّي
    const r4 = await post('/api/workshop/inventory/issue-bulk', {
      lines: [
        { item: B._id, quantity: 1, replacedFate: 'none' },
        { item: B._id, quantity: 2, replacedFate: 'none' },   // المجموع ٣ = الرصيد
      ],
    });
    ok('وبمجموع = الرصيد بيعدّي', r4.status === 201, `HTTP ${r4.status} ${r4.body?.message || ''}`);
    ok('والرصيد بقى صفر', (await qtyOf(B._id)).quantity === 0);

    // ═══ ٤) التحقق من المدخلات ════════════════════════════════════════════
    console.log('\n── التحقق ──');
    const noFate = await post('/api/workshop/inventory/issue-bulk', {
      lines: [{ item: A._id, quantity: 1 }],
    });
    ok('من غير مصير القطعة المستبدلة ⇒ مرفوض', noFate.status === 400);
    const empty = await post('/api/workshop/inventory/issue-bulk', { lines: [] });
    ok('من غير أسطر ⇒ مرفوض', empty.status === 400);
    const ghost = await post('/api/workshop/inventory/issue-bulk', {
      lines: [{ item: new mongoose.Types.ObjectId(), quantity: 1, replacedFate: 'none' }],
    });
    ok('صنف مش موجود ⇒ مرفوض', ghost.status === 400);
    const zero = await post('/api/workshop/inventory/issue-bulk', {
      lines: [{ item: A._id, quantity: 0, replacedFate: 'none' }],
    });
    ok('كمية صفر ⇒ مرفوض', zero.status === 400);

    // ═══ ٥) الصرف المفرد لسه شغّال زي ما هو ═══════════════════════════════
    console.log('\n── الصرف المفرد ما اتكسرش ──');
    const a = (await qtyOf(A._id)).quantity;
    const single = await post(`/api/workshop/inventory/${A._id}/issue`, {
      quantity: 1, vehicleNumber: '5012', replacedFate: 'none',
    });
    ok('صرف صنف واحد', single.status === 201, `HTTP ${single.status}`);
    ok(`الرصيد نقص ١ (${a} → ${(await qtyOf(A._id)).quantity})`, (await qtyOf(A._id)).quantity === a - 1);
  } finally {
    await cleanup();
    await Employee.deleteMany({ email: { $regex: '^zz-bulkissue' } });
    await User.deleteMany({ email: { $regex: '^zz-bulkissue' } });
  }
  ok('التدقيق ما سابش أثر',
    (await InventoryItem.countDocuments({ name: { $regex: '^zz-bulk' } })) === 0
    && (await InventoryIssue.countDocuments({ itemName: { $regex: '^zz-bulk' } })) === 0);

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
