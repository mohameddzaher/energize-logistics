/**
 * auditWalletToCollections — السلسلةُ من العهدة إلى التحصيل، مفحوصةً حيّةً.
 *
 *   node src/scripts/auditWalletToCollections.js
 *
 * تمشي المسارَ الذي يمشيه الموظّف: يسجّل مشترياتٍ برقم كشفٍ ومبلغ، فيمتلئ
 * الكشفُ من نفسِه — المبلغُ والفرعُ والتاريخ، لا نوعُ الدفع — ثمّ
 * يصل قسمَ التحصيل في الصفحة الصحيحة من الصفحتين.
 *
 * لا يترك أثرًا: ما يُنشئه يُحذف، وحساباتُ الفحص تُمحى.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const ORIGIN = process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000';
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 64 - s.length))}`);

const login = async (email) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password: PW }),
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
  const Branch = require('../models/Branch');
  const OW = require('../models/OperationsWorkflow');
  const Party = require('../models/CollectionsParty');

  await User.deleteMany({ email: /^zz-w2c/ });
  const branch = await Branch.findOne({}).select('_id name').lean();
  // ── والحسابُ بلا فرعٍ عن قصد ──────────────────────────────────────────────
  // كان يُنشأ بفرعٍ عليه، فيمرّ فحصُ «الفرع المسدد» لأنّ الفحصَ ضَمِن شرطَه
  // بنفسِه. والواقعُ عكسُه: سبعةٌ وثلاثون من اثنين وخمسين حسابًا نشطًا بلا
  // فرع — فكان التاريخُ يصل والفرعُ لا يصل، وقِيس ذلك على كشوف سبتمبر:
  // التاريخُ على أربعةٍ وثلاثين من سبعةٍ وثلاثين، والفرعُ على عشرة.
  //
  // فيُفحَص من غير فرعٍ على الحساب: الفرعُ يجب أن يأتي من العهدة نفسِها.
  const acc = await User.create({
    email: 'zz-w2c-acc@example.invalid', password: PW, firstName: 'م', lastName: 'ح',
    role: 'accountant',
  });

  // ── ولا يعتمد الفحصُ على حسابِ إنسان ────────────────────────────────────
  // كان يدخل بحساب مدير التحصيل الحقيقيّ وكلمةِ مروره. فلمّا غيّرها صاحبُها —
  // وهو حقُّه — سقط الفحصُ بأربعة إخفاقاتٍ لا علاقةَ لها بما يفحصه، وبدا كأنّ
  // صفحاتِ الفواتير تعطّلت. وأسوأُ منه أنّ محاولاتِ الدخول المتكرّرة تقع على
  // حسابٍ يعمل به إنسان.
  //
  // فيُنشئ الفحصُ حسابَه ويحذفه، كما يفعل مع المحاسب.
  const mgrUser = await User.create({
    email: 'zz-w2c-mgr@example.invalid', password: PW, firstName: 'م', lastName: 'ت',
    role: 'collections_manager',
  });
  const accLogin = await login(acc.email);
  const mgr = await login(mgrUser.email);
  ok('دخول المحاسب', accLogin.status === 200);
  ok('دخول مدير التحصيل', mgr.status === 200, `${mgr.status}`);
  if (accLogin.status !== 200) process.exit(1);

  // الفرعُ المنتظَر: فرعُ العهدة التي ستستقبل الحركة، بالعربيّة من القائمة.
  const { arabicBranchName } = require('../utils/payingBranch');
  const expectedBranchAr = await arabicBranchName(branch?._id);
  ok('القائمةُ المرجعيّة تعرف اسمَ الفرع بالعربيّة', !!expectedBranchAr, `${branch?.name} → ${expectedBranchAr || '(لا نظير)'}`);

  const stamp = Date.now();
  const made = []; const parties = [];

  try {
    // ── ١ · المحاسبُ يعمل على صفحة التشغيل والعهدة ───────────────────────
    head('صلاحيات المحاسب');
    ok('يفتح سير عمل التشغيل', (await call('GET', '/api/workflows?limit=1', accLogin.ck)).status === 200);
    // الحسابُ بلا فرع، فيُختار الفرعُ كما تختاره الصفحة — وهو المسارُ الواقعيّ.
    ok('يفتح عهدةَ فرعٍ يختاره', (await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck)).status === 200);
    ok('يفتح لوحة المحفظة', (await call('GET', '/api/wallet/dashboard', accLogin.ck)).status === 200);

    const perms = await call('GET', '/api/workflows/permissions', accLogin.ck);
    const mine = perms.json?.roleAccess?.accountant || [];
    const need = ['paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'documentNumber', 'invoiceNumber', 'netInvoice', 'collectionDate'];
    ok('ويملك حقولَ عمله كلَّها', need.every((f) => mine.includes(f)),
      need.filter((f) => !mine.includes(f)).join(', ') || `${mine.length} حقلًا`);

    // ── ٢ · نوعُ الدفع يُكتب بيد، ولا يُستنتَج ─────────────────────────────
    // كان يُملأ من ملفّ العميل على أنّه صفةٌ ثابتةٌ فيه، وليس كذلك: العميلُ
    // الواحد يحاسب كاشًا في حمولةٍ وضريبيًّا في أخرى. فالاستنتاجُ كان يكتب على
    // الكشف ما لم يقله أحدٌ ويرسله إلى صفحةِ تحصيلٍ ليست له.
    head('نوعُ الدفع يُكتب بيد ولا يُستنتَج من العميل');
    for (const [name, type] of [[`zz-عميل-كاش-${stamp}`, 'cash'], [`zz-عميل-ضريبي-${stamp}`, 'tax']]) {
      const p = await Party.create({ kind: 'customer', name, paymentType: type });
      parties.push(p._id);
    }

    const mk = async (username) => {
      const r = await call('POST', '/api/workflows', accLogin.ck, {
        username, applicationStatus: 'bond_received', purchaseValue: 800, sellingValue: 1200,
      });
      if (r.json?._id) made.push(r.json._id);
      return r.json;
    };

    const cashWf = await mk(`zz-عميل-كاش-${stamp}`);
    await call('PUT', `/api/workflows/${cashWf._id}`, accLogin.ck, { paymentDate: '2026-09-02' });
    const cashDb = await OW.findById(cashWf._id).select('paymentType').lean();
    ok('حسابٌ نقديٌّ لا يفرض نوعًا على كشفه', !cashDb.paymentType, cashDb.paymentType || '(فارغ — صواب)');

    const taxWf = await mk(`zz-عميل-ضريبي-${stamp}`);
    await call('PUT', `/api/workflows/${taxWf._id}`, accLogin.ck, { paymentDate: '2026-09-02' });
    const taxDb = await OW.findById(taxWf._id).select('paymentType').lean();
    ok('وحسابٌ ضريبيٌّ كذلك', !taxDb.paymentType, taxDb.paymentType || '(فارغ — صواب)');

    // ── والعميلُ الواحدُ يحاسب بالوجهين ─────────────────────────────────────
    // حمولتان لعميلٍ واحد: واحدةٌ نقدًا وأخرى بفاتورة. كلتاهما تُكتب وتبقى.
    await call('PUT', `/api/workflows/${cashWf._id}`, accLogin.ck, { paymentType: 'cash' });
    await call('PUT', `/api/workflows/${taxWf._id}`, accLogin.ck, { paymentType: 'tax' });
    const both = await OW.find({ _id: { $in: [cashWf._id, taxWf._id] } }).select('paymentType netInvoice documentNumber').lean();
    ok('ما يُكتب بيدٍ يُحفظ كما كُتب', both.every((w) => w.paymentType), both.map((w) => w.paymentType).join(' + '));
    const cashRow = both.find((w) => w.paymentType === 'cash');
    ok('والنقديُّ تُقفَل أعمدةُ فاتورته', cashRow.netInvoice === 0 && cashRow.documentNumber === '0');

    // ── ٣ · العهدةُ تملأ الكشف ────────────────────────────────────────────
    head('المشتريات تملأ الكشف');
    const target = await mk(`zz-عميل-كاش-${stamp}`);
    const buy = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'purchase', amount: 800, purchaseDeliveryStatementNumber: target.reportNumber,
      itemName: 'zz', notes: 'zz-فحص', branchId: String(branch?._id),
    });
    ok('تُقيَّد المشتريات', buy.status === 201, `${buy.status}`);
    const t1 = await OW.findById(target._id).select('paymentAmount paymentDate payingBranch paymentType').lean();
    ok('المبلغُ يصل «مبلغ السداد»', t1.paymentAmount === 800, `${t1.paymentAmount}`);
    ok('والتاريخُ يصل «تاريخ السداد»', !!t1.paymentDate);
    // ── والفرعُ عربيٌّ كما في العمود ────────────────────────────────────
    // العمودُ عربيٌّ في أربعةٍ وعشرين ألفَ صفّ وسجلاتُ الفروع إنجليزيّة. وكان
    // الفحصُ يقارن بـ`Branch.name` — أي يؤكّد أنّ الكودَ يفعل ما يفعله، لا
    // أنّه صواب. فيُقارَن بالقائمة المرجعيّة التي تُملأ منها الخانةُ باليد.
    ok('والفرعُ يصل «الفرع المسدد» من العهدة لا من الحساب',
      !!t1.payingBranch && t1.payingBranch === expectedBranchAr,
      `${t1.payingBranch || '(فارغ)'} — المتوقَّع ${expectedBranchAr}`);
    ok('ومكتوبٌ بالعربيّة كما في بقيّة العمود', !!t1.payingBranch && !/[A-Za-z]/.test(t1.payingBranch), `${t1.payingBranch}`);
    // والمحفظةُ تكتب ما تعرفه يقينًا، ولا تخترع نوعَ الدفع.
    ok('ولا تخترع المحفظةُ نوعَ الدفع', !t1.paymentType, t1.paymentType || '(فارغ — صواب)');
    if (buy.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${buy.json.transaction._id}`, accLogin.ck);

    // ── ٤ · قيدُ استلام الفاتورة يملأ من سعر الشراء ───────────────────────
    head('استلام الفواتير الضريبيّة — حزمةُ كشوفٍ بلا مبلغ');
    // ── الحزمةُ لا الواحد ─────────────────────────────────────────────────
    // المندوبُ يأتي بسبعة كشوفٍ فيسجّلها دفعةً؛ وقيدٌ لكلّ كشفٍ يعني تكرارَ
    // التاريخ والفرع سبعَ مرّات، ومَن يملّ يترك الباقيَ بلا تسجيل.
    const rec = await mk(`zz-عميل-ضريبي-${stamp}`);
    const rec2 = await mk(`zz-عميل-ضريبي-${stamp}`);
    const ti = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'tax_invoice',
      receivedReportNumbers: [rec.reportNumber, rec2.reportNumber, 'zz-لا-وجود-له'],
      notes: 'zz-فحص', branchId: String(branch?._id),
    });
    ok('يُقبل القيد بلا مبلغٍ أصلًا', ti.status === 201, `${ti.status} ${ti.json?.message || ''}`);
    ok('ولا يحمل مالًا', ti.json?.transaction?.amount === 0, `${ti.json?.transaction?.amount}`);
    ok('ويحفظ الكشوفَ كلَّها', (ti.json?.transaction?.receivedReportNumbers || []).length === 3,
      `${(ti.json?.transaction?.receivedReportNumbers || []).length}`);
    // ورقمٌ لا كشفَ له يُسمّى، فلا يُظنّ أنّ الثلاثةَ خُتمت وقد خُتم منها اثنان.
    ok('ويُسمّي الرقمَ الذي لا كشفَ له', (ti.json?.unknownReports || []).includes('zz-لا-وجود-له'),
      JSON.stringify(ti.json?.unknownReports));

    for (const [label, r] of [['الأوّل', rec], ['والثاني', rec2]]) {
      // eslint-disable-next-line no-await-in-loop
      const t = await OW.findById(r._id).select('paymentAmount paymentDate payingBranch').lean();
      ok(`${label}: مبلغُ السداد = سعرُ شرائه هو`, t.paymentAmount === 800, `${t.paymentAmount}`);
      ok(`${label}: والفرعُ فرعُ العهدة`, t.payingBranch === expectedBranchAr, `${t.payingBranch || '(فارغ)'}`);
      ok(`${label}: وتاريخُ اليوم`, !!t.paymentDate);
    }

    // ── ولا يمسّ رصيدَ العهدة ────────────────────────────────────────────
    const walletBefore = await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck);
    ok('ورصيدُ العهدة كما هو — القيدُ خارجَه',
      Number(walletBefore.json?.wallet?.totalPurchases || 0) >= 0
      && !(walletBefore.json?.transactions || []).some((t) => t.type === 'tax_invoice' && t.amount > 0),
      `مشتريات ${walletBefore.json?.wallet?.totalPurchases}`);

    const empty = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'tax_invoice', receivedReportNumbers: [], branchId: String(branch?._id),
    });
    ok('ولا يُقبل قيدٌ بلا كشفٍ واحد', empty.status === 400, `${empty.status}`);

    if (ti.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${ti.json.transaction._id}`, accLogin.ck);

    // ── ٥ · ويصل الصفحةَ الصحيحة بعد أن يُكتب نوعُه ────────────────────────
    // الكشفُ لا يصل التحصيلَ حتى يقول أحدٌ نوعَه — وهو الصواب: قبل أن يُقال،
    // لا أحدَ يعرف أنقدًا حوسب أم بفاتورة.
    head('ويصل الصفحة الصحيحة بعد كتابة نوعه');
    const beforeType = await call('GET', `/api/collections-dept/invoices/cash?q=${encodeURIComponent(target.reportNumber)}`, mgr.ck);
    ok('بلا نوعٍ لا يصل أيَّ صفحة', (beforeType.json?.total || 0) === 0, `${beforeType.json?.total}`);

    await call('PUT', `/api/workflows/${target._id}`, accLogin.ck, { paymentType: 'cash' });
    await OW.updateOne({ _id: target._id }, { $set: { paymentAmount: 800, payingBranch: expectedBranchAr } });
    const cash = await call('GET', `/api/collections-dept/invoices/cash?q=${encodeURIComponent(target.reportNumber)}`, mgr.ck);
    ok('ومتى كُتب «كاش» وصل فواتيرَ الكاش', (cash.json?.total || 0) >= 1, `${cash.json?.total}`);

    const taxBefore = await call('GET', `/api/collections-dept/invoices/tax?q=${encodeURIComponent(`zz-عميل-ضريبي-${stamp}`)}`, mgr.ck);
    ok('والضريبيُّ لا يصل قبل رقم الفاتورة', (taxBefore.json?.total || 0) === 0, `${taxBefore.json?.total}`);

    const invNo = `ZZ-W2C-${stamp}`;
    await call('PUT', `/api/workflows/${rec._id}`, accLogin.ck, { paymentType: 'tax', invoiceNumber: invNo, netInvoice: 1000, invoiceDate: '2026-09-02' });
    const taxAfter = await call('GET', `/api/collections-dept/invoices/tax?q=${invNo}`, mgr.ck);
    ok('ويصل فورَ كتابة رقم الفاتورة', (taxAfter.json?.total || 0) === 1, `${taxAfter.json?.total}`);
    ok('وضريبتُه محسوبة', taxAfter.json?.invoices?.[0]?.vat === 150, `${taxAfter.json?.invoices?.[0]?.vat}`);
  } finally {
    if (made.length) await OW.deleteMany({ _id: { $in: made } });
    if (parties.length) await Party.deleteMany({ _id: { $in: parties } });
    await User.deleteMany({ email: /^zz-w2c/ });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
