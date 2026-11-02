/**
 * auditBillingFlow: the billing and collections cycle, tested live end to end.
 * node src/scripts/auditBillingFlow.js
 * It does not check that the code loads: it follows the path an employee takes, choosing cash so what must lock locks, writing an invoice net so its tax is derived, collecting an invoice with manifests so the date reaches all of them, then asks the database whether what was said to happen happened.
 * Leaves no trace: its manifests are created and deleted, and real rows it touches are restored.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
// The origin follows the server being tested, not the local env file: the CSRF guard accepts only production origins, so sending `localhost` gets 403 on every POST, which looks like a feature fault but is a fault in the check.
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}`);

const login = async (email, password) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  return { status: r.status, ck: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
};
const call = async (method, path, ck, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: ck, Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  // The check does not depend on a person's account. It used to sign in with an account a real employee works with, and his password; when he changed it (his right) the whole check failed for a reason unrelated to what it tests and read as if the section broke. Worse, login attempts repeated on an account a person uses.
  const su = await User.findOne({ role: 'super_admin', isActive: true }).select('email').lean();
  await User.deleteMany({ email: /^zz-bill/ });
  const mgrUser = await User.create({
    email: 'zz-bill-mgr@example.invalid', password: 'Passenergize1!',
    firstName: 'م', lastName: 'ت', role: 'collections_manager',
  });
  const admin = await login(mgrUser.email, 'Passenergize1!');
  ok('دخول مدير التحصيل', admin.status === 200, `${admin.status}`);

  // The super admin owns all fields, so the check manifests are created with it.
  // The wallet is restricted to a branch, so the check account takes a real branch, otherwise its entries are rejected with no-branch, which is a correct rule, not a flaw to work around.
  const Branch = require('../models/Branch');
  const branch = await Branch.findOne({}).select('_id name').lean();
  const opUser = await User.create({
    email: 'zz-bill-op@example.invalid', password: 'Passenergize1!',
    firstName: 'ت', lastName: 'ت', role: 'super_admin', branch: branch?._id,
  });
  const op = await login(opUser.email, 'Passenergize1!');
  ok('دخول منشئ الكشوف', op.status === 200);
  if (op.status !== 200 || admin.status !== 200) { console.error('لا يمكن المتابعة'); process.exit(1); }

  const stamp = Date.now();
  const made = [];
  const mk = async (fields) => {
    const r = await call('POST', '/api/workflows', op.ck, { username: `zz-عميل-${stamp}`, applicationStatus: 'bond_received', ...fields });
    if (r.json?._id) made.push(r.json._id);
    return r;
  };

  try {
    // 1. Tax and total derivation.
    head('الضريبة والإجمالي يُشتقّان من الصافي');
    const tax1 = await mk({ paymentType: 'tax', sellingValue: 1000 });
    ok('كشفٌ ضريبيّ يُنشأ', tax1.status === 201, `${tax1.status}`);
    const id1 = tax1.json?._id;

    const w1 = await call('PUT', `/api/workflows/${id1}`, op.ck, { netInvoice: 1000 });
    const db1 = await OperationsWorkflow.findById(id1).select('netInvoice tax totalInvoice').lean();
    ok('صافي ١٠٠٠ ← ضريبة ١٥٠', db1.tax === 150, `الضريبة=${db1.tax}`);
    ok('وإجمالي ١١٥٠', db1.totalInvoice === 1150, `الإجمالي=${db1.totalInvoice}`);

    // They are not overwritten by hand: a derived number is derived again.
    await call('PUT', `/api/workflows/${id1}`, op.ck, { netInvoice: 2000, tax: 999, totalInvoice: 999 });
    const db1b = await OperationsWorkflow.findById(id1).select('tax totalInvoice').lean();
    ok('الكتابةُ اليدويّة فوق المشتقّ لا تثبت', db1b.tax === 300 && db1b.totalInvoice === 2300,
      `الضريبة=${db1b.tax} الإجمالي=${db1b.totalInvoice}`);

    // 2. Cash locks the invoice columns.
    head('الكاش يُقفل ما لا يُفوتَر');
    const cash1 = await mk({ paymentType: 'cash', sellingValue: 500, netInvoice: 400, documentNumber: 'ZZ-1' });
    const cid = cash1.json?._id;
    const dbc = await OperationsWorkflow.findById(cid)
      .select('netInvoice tax totalInvoice documentNumber invoiceNumber finalReportDestination sendingDate deliveryDate invoiceDate').lean();
    ok('أعمدةُ المال صفرٌ على الكاش', dbc.netInvoice === 0 && dbc.tax === 0 && dbc.totalInvoice === 0,
      `صافي=${dbc.netInvoice} ضريبة=${dbc.tax} إجمالي=${dbc.totalInvoice}`);
    ok('والسندُ والوجهةُ صفر', dbc.documentNumber === '0' && dbc.finalReportDestination === '0',
      `سند=${dbc.documentNumber}`);
    ok('وتواريخُ الإرسال والتسليم والفاتورة فارغة', !dbc.sendingDate && !dbc.deliveryDate && !dbc.invoiceDate);

    // A cash type chosen together with an invoice number in the same edit is a contradiction and is rejected. (The number alone makes the manifest deferred-with-invoice; checked on another manifest below.)
    const blocked = await call('PUT', `/api/workflows/${cid}`, op.ck, { paymentType: 'cash_3pl', invoiceNumber: 'ZZ-INV', netInvoice: 900 });
    const dbc2 = await OperationsWorkflow.findById(cid).select('invoiceNumber netInvoice').lean();
    ok('نوعٌ نقديٌّ مع رقم فاتورة يُرفض باسمه',
      blocked.status === 400 && blocked.json?.code === 'CASH_INVOICE_NUMBER', `${blocked.status}`);
    // The locked columns read zero as requested; what matters is that what the user wrote did not go through: neither 'ZZ-INV' nor 900.
    ok('ولم يمرّ ما كتبه المستخدم', dbc2.invoiceNumber === '0' && dbc2.netInvoice === 0,
      `فاتورة=${dbc2.invoiceNumber} صافي=${dbc2.netInvoice}`);

    // An invoice number alone on a cash manifest makes it deferred-with-invoice and is accepted.
    const cash2 = await mk({ paymentType: 'cash_3pl', sellingValue: 500 });
    const turned = await call('PUT', `/api/workflows/${cash2.json?._id}`, op.ck, { invoiceNumber: 'ZZ-INV-2' });
    const dbt = await OperationsWorkflow.findById(cash2.json?._id).select('paymentType paymentSubtype invoiceNumber').lean();
    ok('رقمُ الفاتورة يجعل النقديَّ «آجل - فاتورة»',
      turned.status === 200 && dbt.paymentType === 'tax' && dbt.paymentSubtype === 'deferred_invoice' && dbt.invoiceNumber === 'ZZ-INV-2',
      `${turned.status} · ${dbt.paymentType}/${dbt.paymentSubtype} · ${dbt.invoiceNumber}`);

    // Collection stays open on cash, which is the section's work on it.
    const openOnCash = await call('PUT', `/api/workflows/${cid}`, op.ck, { accountingReview: 'تم', collectedAmount: 480 });
    const dbc3 = await OperationsWorkflow.findById(cid).select('accountingReview collectedAmount').lean();
    ok('مراجعةُ الحسابات ومبلغُ التحصيل مفتوحان', openOnCash.status === 200 && dbc3.collectedAmount === 480,
      `${openOnCash.status} · مبلغ=${dbc3.collectedAmount}`);

    // 3. Cash invoices page.
    head('صفحة فواتير الكاش');
    await OperationsWorkflow.updateOne({ _id: cid }, {
      $set: { paymentDate: new Date(), payingBranch: 'جده', paymentAmount: 450, collectedAmount: 0, collectionDate: null },
    });
    const cashPage = await call('GET', `/api/collections-dept/invoices/cash?q=zz-عميل-${stamp}`, admin.ck);
    ok('الكشفُ النقديُّ يصل القسم', cashPage.status === 200 && cashPage.json?.total >= 1, `${cashPage.json?.total} صفًّا`);
    const row = (cashPage.json?.invoices || [])[0];
    ok('ومعه العميلُ والفرعُ وتاريخُ السداد', !!row?.customer && row?.payingBranch === 'جده' && !!row?.paymentDate);
    ok('ولا يُعرَض مبلغُ السداد', row && !('paymentAmount' in row), Object.keys(row || {}).join(', ').slice(0, 60));

    // 4. A tax invoice groups manifests.
    head('الفاتورة الواحدة تضمّ كشوفًا');
    const invNo = `ZZ-INV-${stamp}`;
    const t2 = await mk({ paymentType: 'tax', sellingValue: 700 });
    const t3 = await mk({ paymentType: 'tax', sellingValue: 300 });
    const bulk = await call('POST', '/api/workflows/bulk-update', op.ck, {
      ids: [id1, t2.json._id, t3.json._id],
      fields: { invoiceNumber: invNo, invoiceDate: new Date().toISOString(), deliveryDate: new Date().toISOString() },
    });
    ok('رقمُ فاتورةٍ واحدٌ لثلاثة كشوف بتحديدٍ واحد', bulk.status === 200 && bulk.json?.updated === 3,
      `${bulk.json?.updated} من ٣`);

    const taxPage = await call('GET', `/api/collections-dept/invoices/tax?q=${invNo}`, admin.ck);
    const inv = (taxPage.json?.invoices || []).find((x) => x.invoiceNumber === invNo);
    ok('تظهر صفًّا واحدًا لا ثلاثة', !!inv && taxPage.json.total === 1, `${taxPage.json?.total} صفًّا`);
    ok('وعددُ كشوفها ثلاثة', inv?.reports === 3, `${inv?.reports}`);
    // 2300 (the edited one) plus zero for the two not yet invoiced with a net.
    ok('وقيمتُها مجموعُ إجماليّات كشوفها', inv?.value === 2300, `${inv?.value}`);

    const detail = await call('GET', `/api/collections-dept/invoices/tax/${encodeURIComponent(invNo)}`, admin.ck);
    ok('وتُفتح بتفاصيل كشوفها', detail.status === 200 && detail.json?.reports?.length === 3,
      `${detail.json?.reports?.length} كشوف`);

    // 5. Collection reaches all the manifests.
    head('تحصيل الفاتورة يصل كشوفَها كلَّها');
    const collected = await call('POST', '/api/collections-dept/invoices/collect', admin.ck, {
      invoiceNumber: invNo, collectionDate: new Date().toISOString(),
    });
    ok('يُسجَّل التحصيل', collected.status === 200 && collected.json?.updated === 3, `${collected.json?.updated} كشفًا`);
    const stillOpen = await OperationsWorkflow.countDocuments({ invoiceNumber: invNo, collectionDate: null });
    ok('ولا يبقى كشفٌ مفتوحٌ تحتها', stillOpen === 0, `${stillOpen} مفتوح`);
    const after = await call('GET', `/api/collections-dept/invoices/tax?q=${invNo}`, admin.ck);
    ok('وتُقرأ محصَّلةً تمامًا', after.json?.invoices?.[0]?.fullyCollected === true);

    // 6. Aging buckets do not overlap.
    head('شرائح العمر لا تتداخل');
    const bands = ['0_15', '15_30', '30_45', '45_60', '60_plus'];
    const counts = {};
    for (const b of bands) {
      const r = await call('GET', `/api/collections-dept/invoices/tax?age=${b}&collected=no`, admin.ck);
      counts[b] = r.json?.total ?? -1;
    }
    const all = await call('GET', '/api/collections-dept/invoices/tax?collected=no', admin.ck);
    const sum = bands.reduce((a, b) => a + counts[b], 0);
    ok('مجموعُ الشرائح = الكلّ', sum === all.json?.total,
      `${bands.map((b) => `${b}=${counts[b]}`).join(' · ')} → ${sum} مقابل ${all.json?.total}`);

    // 7. Wallet: a tax invoice is outside the balance.
    head('المحفظة');
    const before = await call('GET', '/api/wallet/daily', op.ck);
    const closingBefore = before.json?.wallet?.closingBalance ?? 0;
    const ti = await call('POST', '/api/wallet/transactions', op.ck, {
      type: 'tax_invoice', amount: 0, receivedDocType: 'invoice', receivedDocNumber: invNo, notes: 'zz-فحص',
    });
    ok('قيدُ «فاتورة ضريبيّة» يُقبل بلا مبلغ', ti.status === 201, `${ti.status} ${ti.json?.message || ''}`);
    const afterW = await call('GET', '/api/wallet/daily', op.ck);
    ok('ولا يمسّ رصيدَ المحفظة',
      (afterW.json?.wallet?.closingBalance ?? 0) === closingBefore,
      `قبل=${closingBefore} بعد=${afterW.json?.wallet?.closingBalance}`);
    ok('ورقمُ المستند محفوظ', ti.json?.transaction?.receivedDocNumber === invNo, ti.json?.transaction?.receivedDocNumber);
    if (ti.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${ti.json.transaction._id}`, op.ck);

    // 8. Purchases fill the manifest and are flagged on a difference.
    head('المشتريات تملأ الكشف');
    const target = await mk({ paymentType: 'tax', purchaseValue: 1000, sellingValue: 1500 });
    const tid = target.json?._id;
    const rep = target.json?.reportNumber;
    const buy = await call('POST', '/api/wallet/transactions', op.ck, {
      type: 'purchase', amount: 1000, purchaseDeliveryStatementNumber: rep, itemName: 'zz', notes: 'zz-فحص',
    });
    ok('تُقيَّد المشتريات', buy.status === 201, `${buy.status}`);
    const dbT = await OperationsWorkflow.findById(tid).select('paymentAmount paymentDate').lean();
    ok('ومبلغُها يصل «مبلغ السداد»', dbT.paymentAmount === 1000, `${dbT.paymentAmount}`);
    ok('وتاريخُها يصل «تاريخ السداد»', !!dbT.paymentDate);
    // The target is the price-difference flag alone. The condition used to be no flag at all, but custody flags other legitimate things (a large amount, an entry outside working hours), so the check passed by day and failed at night, measuring the clock instead of the code. So it asks what it means: was a price difference flagged while the price matches?
    ok('وبلا علامةِ فرقِ سعرٍ ما دام مطابقًا',
      !/سعرُ الشراء مختلف/.test(buy.json?.transaction?.flagReason || ''),
      buy.json?.transaction?.flagReason || '(بلا علامات)');
    if (buy.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${buy.json.transaction._id}`, op.ck);

    const target2 = await mk({ paymentType: 'tax', purchaseValue: 1000 });
    const bad = await call('POST', '/api/wallet/transactions', op.ck, {
      type: 'purchase', amount: 1400, purchaseDeliveryStatementNumber: target2.json?.reportNumber, itemName: 'zz', notes: 'zz-فحص',
    });
    ok('والمخالفُ يُعلَّم لا يُمنع',
      bad.status === 201 && bad.json?.transaction?.isFlagged === true,
      `${bad.status} · ${(bad.json?.transaction?.flagReason || '').slice(0, 80)}`);
    ok('والعلامةُ تسمّي الكشفَ والفرق',
      String(bad.json?.transaction?.flagReason || '').includes(target2.json?.reportNumber)
      && String(bad.json?.transaction?.flagReason || '').includes('400'));
    if (bad.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${bad.json.transaction._id}`, op.ck);

    // ══════════════════════════════════════════════════════════════════════
    head('الرجوعُ عن «كاش» يفكّ ما أقفله');
    const back = await mk({});
    await call('PUT', `/api/workflows/${back.json._id}`, op.ck, { paymentType: 'cash' });
    const locked = await OperationsWorkflow.findById(back.json._id).select('netInvoice documentNumber').lean();
    ok('يُقفَل ويُصفَّر أوّلًا', locked.netInvoice === 0 && locked.documentNumber === '0',
      `صافي ${locked.netInvoice} · سند ${locked.documentNumber}`);

    await call('PUT', `/api/workflows/${back.json._id}`, op.ck, { paymentType: '' });
    const freed = await OperationsWorkflow.findById(back.json._id)
      .select('netInvoice documentNumber deliveryDate sendingDate finalReportDestination totalInvoice').lean();
    ok('ثمّ تعود الأعمدةُ فارغةً لا أصفارًا', !freed.netInvoice && !freed.documentNumber && !freed.totalInvoice,
      `صافي ${JSON.stringify(freed.netInvoice)} · سند ${JSON.stringify(freed.documentNumber)}`);
    ok('والتواريخُ كذلك', !freed.deliveryDate && !freed.sendingDate);
    ok('ووجهةُ الكشف', !freed.finalReportDestination, JSON.stringify(freed.finalReportDestination));

    // Unlocking clears only what the lock put there. What is written after unlocking, when the manifest is not cash, is not touched. (What was written before choosing cash is zeroed by choosing it, which is intended: cash has no invoice.)
    await call('PUT', `/api/workflows/${back.json._id}`, op.ck, { documentNumber: 'ZZ-حقيقي' });
    await call('PUT', `/api/workflows/${back.json._id}`, op.ck, { paymentType: 'tax' });
    const kept = await OperationsWorkflow.findById(back.json._id).select('documentNumber').lean();
    ok('وما كُتب والكشفُ غيرُ نقديٍّ يبقى كما كُتب', kept.documentNumber === 'ZZ-حقيقي', `${kept.documentNumber}`);

    head('ومبلغُ التحصيل للنقديّ وحدَه');
    const camt = await mk({ paymentType: 'tax' });
    const rej = await call('PUT', `/api/workflows/${camt.json._id}`, op.ck, { collectedAmount: 500 });
    const c1 = await OperationsWorkflow.findById(camt.json._id).select('collectedAmount').lean();
    ok('يُرفَض على الضريبيّ', !c1.collectedAmount, `${c1.collectedAmount}`);
    // Say it explicitly; do not swallow it and report saved.
    ok('ويُقال إنّه رُفض لا يُبتلَع',
      rej.status === 400 && /collectedAmount/.test(JSON.stringify(rej.json?.fields || [])),
      `${rej.status} ${JSON.stringify(rej.json?.fields)}`);
    await call('PUT', `/api/workflows/${camt.json._id}`, op.ck, { paymentType: 'cash' });
    await call('PUT', `/api/workflows/${camt.json._id}`, op.ck, { collectedAmount: 500 });
    const c2 = await OperationsWorkflow.findById(camt.json._id).select('collectedAmount').lean();
    ok('ويُقبَل على النقديّ', c2.collectedAmount === 500, `${c2.collectedAmount}`);
  } finally {
    if (made.length) await OperationsWorkflow.deleteMany({ _id: { $in: made } });
    await User.deleteMany({ email: /^zz-bill/ });
    console.log(`\n(نُظّف ${made.length} كشفَ فحص)`);
  }

  console.log(`\n${pass} passed, ${fail} failed  ${su ? '' : ''}`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
