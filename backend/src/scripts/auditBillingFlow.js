/**
 * auditBillingFlow — دورةُ الفوترة والتحصيل، مفحوصةً حيّةً من طرفها إلى طرفها.
 *
 *   node src/scripts/auditBillingFlow.js
 *
 * لا يفحص أنّ الكودَ يُحمَّل: يمرّ بالمسار الذي يمرّ به الموظّف — يختار كاشًا
 * فيقفل ما يجب أن يُقفَل، ويكتب صافيَ فاتورةٍ فتُشتقّ ضريبتُها، ويحصّل فاتورةً
 * فيها كشوفٌ فيصلها التاريخُ كلَّها — ثمّ يسأل القاعدةَ هل جرى ما قيل إنّه جرى.
 *
 * لا يترك أثرًا: كشوفُه تُنشأ وتُحذف، وما يمسّه من صفوفٍ حقيقيّةٍ يُعاد كما كان.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const ORIGIN = process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000';

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

  const su = await User.findOne({ role: 'super_admin', isActive: true }).select('email').lean();
  const admin = await login('hatim.mohamed@energize-logistics.com', 'Passenergize1!');
  ok('دخول مدير التحصيل', admin.status === 200);

  // السوبر أدمن يملك كلَّ الحقول — به تُنشأ كشوفُ الفحص.
  await User.deleteMany({ email: /^zz-bill/ });
  // المحفظةُ تُقيَّد على فرع، فحسابُ الفحص يأخذ فرعًا حقيقيًّا وإلّا رُدَّت
  // حركاتُه بـ«لا يوجد فرع» — وهو شرطٌ صحيحٌ لا عيبٌ يُلتَفّ عليه.
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
    // ── ١ · اشتقاقُ الضريبة والإجماليّ ───────────────────────────────────
    head('الضريبة والإجمالي يُشتقّان من الصافي');
    const tax1 = await mk({ paymentType: 'tax', sellingValue: 1000 });
    ok('كشفٌ ضريبيّ يُنشأ', tax1.status === 201, `${tax1.status}`);
    const id1 = tax1.json?._id;

    const w1 = await call('PUT', `/api/workflows/${id1}`, op.ck, { netInvoice: 1000 });
    const db1 = await OperationsWorkflow.findById(id1).select('netInvoice tax totalInvoice').lean();
    ok('صافي ١٠٠٠ ← ضريبة ١٥٠', db1.tax === 150, `الضريبة=${db1.tax}`);
    ok('وإجمالي ١١٥٠', db1.totalInvoice === 1150, `الإجمالي=${db1.totalInvoice}`);

    // ولا يُكتب فوقهما بيد: الرقمُ المشتقُّ يُعاد اشتقاقُه.
    await call('PUT', `/api/workflows/${id1}`, op.ck, { netInvoice: 2000, tax: 999, totalInvoice: 999 });
    const db1b = await OperationsWorkflow.findById(id1).select('tax totalInvoice').lean();
    ok('الكتابةُ اليدويّة فوق المشتقّ لا تثبت', db1b.tax === 300 && db1b.totalInvoice === 2300,
      `الضريبة=${db1b.tax} الإجمالي=${db1b.totalInvoice}`);

    // ── ٢ · الكاش يُقفل أعمدةَ الفاتورة ──────────────────────────────────
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

    const blocked = await call('PUT', `/api/workflows/${cid}`, op.ck, { invoiceNumber: 'ZZ-INV', netInvoice: 900 });
    const dbc2 = await OperationsWorkflow.findById(cid).select('invoiceNumber netInvoice').lean();
    ok('محاولةُ فوترة كشفٍ نقديّ تُرفض باسمها',
      blocked.status === 400 && blocked.json?.code === 'CASH_INVOICE_LOCKED', `${blocked.status}`);
    // المقفولُ يُقرأ صفرًا كما طُلب («يتكتب جواهم رقم صفر») — والمهمّ أنّ ما
    // كتبه المستخدمُ لم يمرّ: لا «ZZ-INV» ولا ٩٠٠.
    ok('ولم يمرّ ما كتبه المستخدم', dbc2.invoiceNumber === '0' && dbc2.netInvoice === 0,
      `فاتورة=${dbc2.invoiceNumber} صافي=${dbc2.netInvoice}`);

    // والتحصيلُ يبقى مفتوحًا على النقديّ — وهو عملُ القسم فيه.
    const openOnCash = await call('PUT', `/api/workflows/${cid}`, op.ck, { accountingReview: 'تم', collectedAmount: 480 });
    const dbc3 = await OperationsWorkflow.findById(cid).select('accountingReview collectedAmount').lean();
    ok('مراجعةُ الحسابات ومبلغُ التحصيل مفتوحان', openOnCash.status === 200 && dbc3.collectedAmount === 480,
      `${openOnCash.status} · مبلغ=${dbc3.collectedAmount}`);

    // ── ٣ · صفحةُ فواتير الكاش ───────────────────────────────────────────
    head('صفحة فواتير الكاش');
    await OperationsWorkflow.updateOne({ _id: cid }, {
      $set: { paymentDate: new Date(), payingBranch: 'جده', paymentAmount: 450, collectedAmount: 0, collectionDate: null },
    });
    const cashPage = await call('GET', `/api/collections-dept/invoices/cash?q=zz-عميل-${stamp}`, admin.ck);
    ok('الكشفُ النقديُّ يصل القسم', cashPage.status === 200 && cashPage.json?.total >= 1, `${cashPage.json?.total} صفًّا`);
    const row = (cashPage.json?.invoices || [])[0];
    ok('ومعه العميلُ والفرعُ وتاريخُ السداد', !!row?.customer && row?.payingBranch === 'جده' && !!row?.paymentDate);
    ok('ولا يُعرَض مبلغُ السداد', row && !('paymentAmount' in row), Object.keys(row || {}).join(', ').slice(0, 60));

    // ── ٤ · الفاتورةُ الضريبيّة تجمع كشوفًا ───────────────────────────────
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
    // ٢٣٠٠ (المعدَّل) + صفرٌ للاثنين اللذين لم يُفوتَرا صافيًا بعد
    ok('وقيمتُها مجموعُ إجماليّات كشوفها', inv?.value === 2300, `${inv?.value}`);

    const detail = await call('GET', `/api/collections-dept/invoices/tax/${encodeURIComponent(invNo)}`, admin.ck);
    ok('وتُفتح بتفاصيل كشوفها', detail.status === 200 && detail.json?.reports?.length === 3,
      `${detail.json?.reports?.length} كشوف`);

    // ── ٥ · التحصيل يصل الكشوفَ كلَّها ───────────────────────────────────
    head('تحصيل الفاتورة يصل كشوفَها كلَّها');
    const collected = await call('POST', '/api/collections-dept/invoices/collect', admin.ck, {
      invoiceNumber: invNo, collectionDate: new Date().toISOString(),
    });
    ok('يُسجَّل التحصيل', collected.status === 200 && collected.json?.updated === 3, `${collected.json?.updated} كشفًا`);
    const stillOpen = await OperationsWorkflow.countDocuments({ invoiceNumber: invNo, collectionDate: null });
    ok('ولا يبقى كشفٌ مفتوحٌ تحتها', stillOpen === 0, `${stillOpen} مفتوح`);
    const after = await call('GET', `/api/collections-dept/invoices/tax?q=${invNo}`, admin.ck);
    ok('وتُقرأ محصَّلةً تمامًا', after.json?.invoices?.[0]?.fullyCollected === true);

    // ── ٦ · شرائحُ العمر لا تتداخل ───────────────────────────────────────
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

    // ── ٧ · المحفظة: فاتورةٌ ضريبيّة خارج الرصيد ─────────────────────────
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

    // ── ٨ · مشترياتٌ تملأ الكشفَ وتُعلَّم عند الاختلاف ────────────────────
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
    ok('وبلا علامةٍ ما دام مطابقًا', buy.json?.transaction?.isFlagged !== true);
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
  } finally {
    if (made.length) await OperationsWorkflow.deleteMany({ _id: { $in: made } });
    await User.deleteMany({ email: /^zz-bill/ });
    console.log(`\n(نُظّف ${made.length} كشفَ فحص)`);
  }

  console.log(`\n${pass} passed, ${fail} failed  ${su ? '' : ''}`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
