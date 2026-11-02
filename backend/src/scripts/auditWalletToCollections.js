/**
 * auditWalletToCollections: the chain from custody wallet to collections, checked live.
 * Walks the employee's path: record purchases with a manifest number and amount, the manifest fills itself (amount, branch, date, not the payment type), then it reaches the right collections page of the two.
 * Leaves no trace: what it creates is deleted and test accounts are removed.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
// Origin follows the server under test, not the local env file: the CSRF guard accepts only production origins, so sending localhost gets 403 on every POST, which looks like a feature bug but is a test bug.
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
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
  const WalletTransaction = require('../models/WalletTransaction');
  const Party = require('../models/CollectionsParty');

  await User.deleteMany({ email: /^zz-w2c/ });
  const branch = await Branch.findOne({}).select('_id name').lean();
  // The account has no branch, on purpose
  // It used to be created with a branch, so the paid-branch check passed because the test guaranteed its own precondition. In reality 37 of 52 active accounts have no branch, so the date arrived but the branch did not (September manifests: date on 34 of 37, branch on 10).
  // So the test runs without a branch on the account: the branch must come from the custody wallet itself.
  const acc = await User.create({
    email: 'zz-w2c-acc@example.invalid', password: PW, firstName: 'م', lastName: 'ح',
    role: 'accountant',
  });

  // The test does not depend on a human's account
  // It used to log in as the real collections manager. When the owner changed that password, the test failed with four unrelated failures that looked like the invoice pages broke, and repeated logins hit an account a person uses.
  // So the test creates and deletes its own account, like it does for the accountant.
  const mgrUser = await User.create({
    email: 'zz-w2c-mgr@example.invalid', password: PW, firstName: 'م', lastName: 'ت',
    role: 'collections_manager',
  });
  const accLogin = await login(acc.email);
  const mgr = await login(mgrUser.email);
  ok('دخول المحاسب', accLogin.status === 200);
  ok('دخول مدير التحصيل', mgr.status === 200, `${mgr.status}`);
  if (accLogin.status !== 200) process.exit(1);

  // Expected branch: the branch of the wallet receiving the movement, in Arabic from the list.
  const { arabicBranchName } = require('../utils/payingBranch');
  const expectedBranchAr = await arabicBranchName(branch?._id);

  // The wallet day is opened for the test and restored afterwards
  // The wallet belongs to a real branch and its day is closed whenever its employee or the system closes it at day end. A suite failing because a day was closed is not a test: it goes red at some hours and green at others.
  // So it reopens the day if closed, remembers that it was, and restores it at the end, leaving no open branch ledger that was closed.
  // Reopening is a manager permission (operations_manager), not an accountant's, so the test creates an account for it and deletes it like the others.
  const opsMgrUser = await User.create({
    email: 'zz-w2c-ops@example.invalid', password: PW, firstName: 'م', lastName: 'ع',
    role: 'operations_manager',
  });
  const opsMgr = await login(opsMgrUser.email);
  let reclose = false;
  {
    const w = await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck);
    const id = w.json?.wallet?._id;
    if (w.json?.wallet?.isClosed && id) {
      const r = await call('POST', `/api/wallet/reopen/${id}`, opsMgr.ck, {});
      reclose = r.status === 200;
      console.log(`  (يومُ عهدة ${branch?.name} كان مقفلًا — فُتح للفحص وسيُعاد إقفاله${reclose ? '' : ` — تعذّر الفتح (${r.status})`})`);
    }
  }
  const restoreWalletDay = async () => {
    if (!reclose) return;
    const w = await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, opsMgr.ck);
    const cash = Number(w.json?.wallet?.closingBalance || 0);
    const r = await call('POST', '/api/wallet/close-day', opsMgr.ck,
      { branchId: String(branch?._id), actualCash: cash });
    console.log(`  (أُعيد إقفال يوم عهدة ${branch?.name} كما كان${r.status === 200 ? '' : ` — تعذّر (${r.status})`})`);
  };
  ok('القائمةُ المرجعيّة تعرف اسمَ الفرع بالعربيّة', !!expectedBranchAr, `${branch?.name} → ${expectedBranchAr || '(لا نظير)'}`);

  const stamp = Date.now();
  const made = []; const parties = [];
  // Every posted movement is recorded so it can be deleted
  // The suite used to delete its account and manifests but leave the custody movements it posted in a real branch wallet: 44 movements totalling 18,400 SAR of money that exists in no ledger an accountant reads and closes. Deleting the two lines that deleted by name is not enough, since every successful call leaves an entry.
  // So posted entries are recorded here and removed in finally, however the run is interrupted.
  const txns = [];
  const trackTx = (r) => { const id = r?.json?.transaction?._id; if (id) txns.push(id); return r; };

  try {
    // 1. The accountant works on the operations and custody page
    head('صلاحيات المحاسب');
    ok('يفتح سير عمل التشغيل', (await call('GET', '/api/workflows?limit=1', accLogin.ck)).status === 200);
    // The account has no branch, so the branch is chosen as the page does it, which is the realistic path.
    ok('يفتح عهدةَ فرعٍ يختاره', (await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck)).status === 200);
    ok('يفتح لوحة المحفظة', (await call('GET', '/api/wallet/dashboard', accLogin.ck)).status === 200);
    // The accountant can view any branch
    // His account has no branch, and neither do the five real ones, which is correct: accounting is not in a branch. So the custody page must not stop at "no branch on your account".
    ok('وينظر في عهدة أيّ فرع', (await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck)).status === 200);
    ok('ويقرأ لوحةَ فرعٍ بعينه', (await call('GET', `/api/wallet/branch/${branch?._id}`, accLogin.ck)).status === 200);
    ok('وتنبيهاتِ المخاطر', (await call('GET', '/api/wallet/risk-alerts', accLogin.ck)).status === 200);

    const perms = await call('GET', '/api/workflows/permissions', accLogin.ck);
    const mine = perms.json?.roleAccess?.accountant || [];
    const need = ['paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'documentNumber', 'invoiceNumber', 'netInvoice', 'collectionDate'];
    ok('ويملك حقولَ عمله كلَّها', need.every((f) => mine.includes(f)),
      need.filter((f) => !mine.includes(f)).join(', ') || `${mine.length} حقلًا`);

    // 2. Payment type is typed by hand, not inferred
    // It used to be filled from the customer file as if fixed, but one customer pays cash on one load and by invoice on another. Inference wrote onto the manifest something nobody said and sent it to a collections page it did not belong to.
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

    // One customer pays both ways
    // Two loads for one customer, one cash and one invoiced; both are written and kept.
    await call('PUT', `/api/workflows/${cashWf._id}`, accLogin.ck, { paymentType: 'cash' });
    await call('PUT', `/api/workflows/${taxWf._id}`, accLogin.ck, { paymentType: 'tax' });
    const both = await OW.find({ _id: { $in: [cashWf._id, taxWf._id] } }).select('paymentType netInvoice documentNumber').lean();
    ok('ما يُكتب بيدٍ يُحفظ كما كُتب', both.every((w) => w.paymentType), both.map((w) => w.paymentType).join(' + '));
    const cashRow = both.find((w) => w.paymentType === 'cash');
    ok('والنقديُّ تُقفَل أعمدةُ فاتورته', cashRow.netInvoice === 0 && cashRow.documentNumber === '0');

    // 3. Custody fills the manifest
    head('المشتريات تملأ الكشف');
    const target = await mk(`zz-عميل-كاش-${stamp}`);
    const buy = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'purchase', amount: 800, purchaseDeliveryStatementNumber: target.reportNumber,
      itemName: 'zz', notes: 'zz-فحص', branchId: String(branch?._id),
      purchaseReceiptNumber: 'ZZ-SAND-1',
    });
    ok('تُقيَّد المشتريات', buy.status === 201, `${buy.status}`);
    const t1 = await OW.findById(target._id).select('paymentAmount paymentDate payingBranch paymentType documentNumber').lean();
    ok('المبلغُ يصل «مبلغ السداد»', t1.paymentAmount === 800, `${t1.paymentAmount}`);
    ok('والتاريخُ يصل «تاريخ السداد»', !!t1.paymentDate);
    // The branch is Arabic as in the column
    // The column is Arabic in 24,000 rows while branch records are English. The test used to compare with Branch.name, which only confirms the code does what it does, not that it is right. So it compares with the reference list the field is filled from by hand.
    ok('والفرعُ يصل «الفرع المسدد» من العهدة لا من الحساب',
      !!t1.payingBranch && t1.payingBranch === expectedBranchAr,
      `${t1.payingBranch || '(فارغ)'} — المتوقَّع ${expectedBranchAr}`);
    ok('ومكتوبٌ بالعربيّة كما في بقيّة العمود', !!t1.payingBranch && !/[A-Za-z]/.test(t1.payingBranch), `${t1.payingBranch}`);
    // The wallet writes what it knows for certain and does not invent a payment type.
    ok('ولا تخترع المحفظةُ نوعَ الدفع', !t1.paymentType, t1.paymentType || '(فارغ — صواب)');
    // The voucher number reaches its column: written once in custody, not searched for in the manifest.
    ok('ورقمُ السند يصل «رقم السند» في الكشف', t1.documentNumber === 'ZZ-SAND-1', t1.documentNumber || '(فارغ)');
    trackTx(buy);

    // 4. The invoice receipt entry fills from the purchase price
    head('استلام الفواتير الضريبيّة — حزمةُ كشوفٍ بلا مبلغ');
    // A batch, not one
    // The rep brings seven manifests and records them together; one entry per manifest would repeat date and branch seven times, and a bored user leaves the rest unrecorded.
    const rec = await mk(`zz-عميل-ضريبي-${stamp}`);
    const rec2 = await mk(`zz-عميل-ضريبي-${stamp}`);
    const ti = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'tax_invoice',
      receivedReports: [
        { reportNumber: rec.reportNumber, documentNumber: 'ZZ-SAND-A' },
        { reportNumber: rec2.reportNumber, documentNumber: 'ZZ-SAND-B' },
        { reportNumber: 'zz-لا-وجود-له', documentNumber: '' },
      ],
      notes: 'zz-فحص', branchId: String(branch?._id),
    });
    ok('يُقبل القيد بلا مبلغٍ أصلًا', ti.status === 201, `${ti.status} ${ti.json?.message || ''}`);
    ok('ولا يحمل مالًا', ti.json?.transaction?.amount === 0, `${ti.json?.transaction?.amount}`);
    ok('ويحفظ الكشوفَ كلَّها', (ti.json?.transaction?.receivedReportNumbers || []).length === 3,
      `${(ti.json?.transaction?.receivedReportNumbers || []).length}`);
    // A number with no manifest is named, so it is not assumed all three were stamped when only two were.
    ok('ويُسمّي الرقمَ الذي لا كشفَ له', (ti.json?.unknownReports || []).includes('zz-لا-وجود-له'),
      JSON.stringify(ti.json?.unknownReports));

    for (const [label, r, sand] of [['الأوّل', rec, 'ZZ-SAND-A'], ['والثاني', rec2, 'ZZ-SAND-B']]) {
      // eslint-disable-next-line no-await-in-loop
      const t = await OW.findById(r._id).select('paymentAmount paymentDate payingBranch documentNumber').lean();
      // Each has its own voucher, not one voucher copied across the batch.
      ok(`${label}: ورقمُ سنده هو لا سندُ غيره`, t.documentNumber === sand, `${t.documentNumber} — المنتظَر ${sand}`);
      ok(`${label}: مبلغُ السداد = سعرُ شرائه هو`, t.paymentAmount === 800, `${t.paymentAmount}`);
      ok(`${label}: والفرعُ فرعُ العهدة`, t.payingBranch === expectedBranchAr, `${t.payingBranch || '(فارغ)'}`);
      ok(`${label}: وتاريخُ اليوم`, !!t.paymentDate);
    }

    // And it does not touch the custody balance
    const walletBefore = await call('GET', `/api/wallet/daily?branchId=${branch?._id}`, accLogin.ck);
    ok('ورصيدُ العهدة كما هو — القيدُ خارجَه',
      Number(walletBefore.json?.wallet?.totalPurchases || 0) >= 0
      && !(walletBefore.json?.transactions || []).some((t) => t.type === 'tax_invoice' && t.amount > 0),
      `مشتريات ${walletBefore.json?.wallet?.totalPurchases}`);

    const empty = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'tax_invoice', receivedReportNumbers: [], branchId: String(branch?._id),
    });
    ok('ولا يُقبل قيدٌ بلا كشفٍ واحد', empty.status === 400, `${empty.status}`);

    trackTx(ti);

    // A manifest is bought once, and must exist
    // Two rules enforced on the server, not only on the screen: a car plate number was typed into the manifest number field and passed, and ten manifests got two purchases each, so one shipment's price was paid twice from branch custody.
    head('المشترياتُ لكشفٍ موجود، ومرّةً واحدة');
    const ghostBuy = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'purchase', amount: 100, branchId: String(branch?._id),
      purchaseDeliveryStatementNumber: 'zz-لا-وجود-له',
    });
    ok('رقمُ كشفٍ لا وجودَ له يُرفض', ghostBuy.status === 404, `HTTP ${ghostBuy.status}`);
    ok('والرسالةُ تسمّي الرقم', /zz-لا-وجود-له/.test(ghostBuy.json?.message || ''), ghostBuy.json?.message || '');

    const noNum = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'purchase', amount: 100, branchId: String(branch?._id),
    });
    ok('وشراءٌ بلا رقم كشفٍ يُرفض', noNum.status === 400, `HTTP ${noNum.status}`);

    const bought = await WalletTransaction.findOne({
      type: 'purchase', purchaseDeliveryStatementNumber: { $nin: [null, ''] },
    }).select('purchaseDeliveryStatementNumber amount date').lean();
    if (bought) {
      const again = await call('POST', '/api/wallet/transactions', accLogin.ck, {
        type: 'purchase', amount: 100, branchId: String(branch?._id),
        purchaseDeliveryStatementNumber: bought.purchaseDeliveryStatementNumber,
      });
      ok('وكشفٌ مشترًى سلفًا يُرفض', again.status === 409, `HTTP ${again.status}`);
      ok('والرسالةُ تسمّي الشراءَ السابق بمبلغه وتاريخه',
        String(again.json?.message || '').includes(String(bought.amount))
        && String(again.json?.message || '').includes(String(bought.date)),
        again.json?.message || '');
      // Search says so before the form is filled, not after pressing Save.
      const look = await call('GET', `/api/wallet/lookup-report?reportNumber=${encodeURIComponent(bought.purchaseDeliveryStatementNumber)}`, accLogin.ck);
      ok('والبحثُ يُعلِمُ بالشراء السابق قبل الإدخال', !!look.json?.alreadyPurchased,
        JSON.stringify(look.json?.alreadyPurchased || null));
    }

    // 5. It reaches the right page once its type is set
    // A manifest does not reach collections until someone states its type, which is correct: before that, nobody knows whether it was cash or invoiced.
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

    // No movement is left in a real branch's custody
    // Deleted via the API, not the database: the API recomputes the day's totals, while deleting from the database leaves the balance computed on money with no line.
    const mine = await WalletTransaction.find({
      $or: [
        { _id: { $in: txns } },
        { itemName: 'zz' },
        { purchaseDeliveryStatementNumber: /^RPT-\d+$/ },
        { receivedReportNumbers: { $elemMatch: { $regex: /^RPT-\d+$|zz/i } } },
      ],
    }).select('_id').lean();
    for (const t of mine) await call('DELETE', `/api/wallet/transactions/${t._id}`, opsMgr.ck);
    if (mine.length) console.log(`  (حُذفت ${mine.length} حركةَ فحصٍ من العهدة)`);

    // Restore the wallet day before deleting the test account; closing needs its session.
    await restoreWalletDay();
    await User.deleteMany({ email: /^zz-w2c/ });   // Includes the manager account above
  }


  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
