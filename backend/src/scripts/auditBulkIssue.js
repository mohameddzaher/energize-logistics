/* eslint-disable no-console */
/**
 * auditBulkIssue: bulk issue from the workshop store.
 * node src/scripts/auditBulkIssue.js --base https://api.energize-logistics.com
 * Main check: a rejection must not leave the store half applied. If one line lacks balance the whole operation must reject and no item decrease. A half-passed issue is worse than a fully rejected one: the storekeeper cannot tell which line went out, so he repeats the issue and it goes out twice.
 * It also checks that an item repeated across lines is totalled before validation: three lines of 2 for the same item are measured against 6, not each against 2 with a balance of 4, otherwise the balance goes negative. It works on items it creates and deletes, and never touches a working item.
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
    // Three test items with a known balance.
    const mk = (name, q) => InventoryItem.create({
      name, code: name, quantity: q, unit: 'قطعة', isActive: true,
      approvalStatus: 'approved', category: 'zz-test',
    });
    const A = await mk('zz-bulk-فلتر', 10);
    const B = await mk('zz-bulk-زيت', 5);
    const C = await mk('zz-bulk-طقم', 3);
    ok('اتعملت ٣ أصناف اختبار (١٠ · ٥ · ٣)', !!(A && B && C));

    // 1) Normal issue with several lines.
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

    // 2) Full rejection, the most important case.
    console.log('\n── سطر واحد غلط ⇒ العملية كلها ترفض ──');
    const before = { a: (await qtyOf(A._id)).quantity, b: (await qtyOf(B._id)).quantity, c: (await qtyOf(C._id)).quantity };
    const r2 = await post('/api/workshop/inventory/issue-bulk', {
      vehicleNumber: '5011',
      lines: [
        { item: A._id, quantity: 2, replacedFate: 'none' },      // Valid.
        { item: B._id, quantity: 999, replacedFate: 'none' },    // More than the balance.
        { item: C._id, quantity: 1, replacedFate: 'none' },      // Valid.
      ],
    });
    ok('اترفضت', r2.status === 400, `HTTP ${r2.status}`);
    ok('ورجّعت الخطأ بسطره', Array.isArray(r2.body?.errors) && r2.body.errors.length === 1,
      JSON.stringify(r2.body?.errors || []).slice(0, 80));
    const after = { a: (await qtyOf(A._id)).quantity, b: (await qtyOf(B._id)).quantity, c: (await qtyOf(C._id)).quantity };
    ok(`ومفيش صنف واحد نقص (${after.a}/${after.b}/${after.c})`,
      after.a === before.a && after.b === before.b && after.c === before.c,
      `كان ${before.a}/${before.b}/${before.c}`);

    // 3) Same item on several lines is totalled.
    console.log('\n── صنف متكرّر: المجموع هو اللي بيتقاس ──');
    const b = (await qtyOf(B._id)).quantity;   // 3.
    const r3 = await post('/api/workshop/inventory/issue-bulk', {
      lines: [
        { item: B._id, quantity: 2, replacedFate: 'none' },
        { item: B._id, quantity: 2, replacedFate: 'none' },   // Total 4 against balance 3.
      ],
    });
    ok(`رصيد ${b} وسطرين × ٢ ⇒ مرفوض`, r3.status === 400, `HTTP ${r3.status}`);
    ok('والرصيد ما اتغيّرش', (await qtyOf(B._id)).quantity === b);
    // With an acceptable total it passes.
    const r4 = await post('/api/workshop/inventory/issue-bulk', {
      lines: [
        { item: B._id, quantity: 1, replacedFate: 'none' },
        { item: B._id, quantity: 2, replacedFate: 'none' },   // Total 3 equals the balance.
      ],
    });
    ok('وبمجموع = الرصيد بيعدّي', r4.status === 201, `HTTP ${r4.status} ${r4.body?.message || ''}`);
    ok('والرصيد بقى صفر', (await qtyOf(B._id)).quantity === 0);

    // 4) Input validation.
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

    // 5) Single issue still works unchanged.
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
