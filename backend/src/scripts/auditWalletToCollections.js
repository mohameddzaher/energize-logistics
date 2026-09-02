/**
 * auditWalletToCollections — السلسلةُ من العهدة إلى التحصيل، مفحوصةً حيّةً.
 *
 *   node src/scripts/auditWalletToCollections.js
 *
 * تمشي المسارَ الذي يمشيه الموظّف: يسجّل مشترياتٍ برقم كشفٍ ومبلغ، فيمتلئ
 * الكشفُ من نفسِه — المبلغُ والفرعُ والتاريخُ ونوعُ الدفع من ملفّ العميل — ثمّ
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
  const acc = await User.create({
    email: 'zz-w2c-acc@example.invalid', password: PW, firstName: 'م', lastName: 'ح',
    role: 'accountant', branch: branch?._id,
  });

  const accLogin = await login(acc.email);
  const mgr = await login('hatim.mohamed@energize-logistics.com');
  ok('دخول المحاسب', accLogin.status === 200);
  ok('دخول مدير التحصيل', mgr.status === 200);
  if (accLogin.status !== 200) process.exit(1);

  const stamp = Date.now();
  const made = []; const parties = [];

  try {
    // ── ١ · المحاسبُ يعمل على صفحة التشغيل والعهدة ───────────────────────
    head('صلاحيات المحاسب');
    ok('يفتح سير عمل التشغيل', (await call('GET', '/api/workflows?limit=1', accLogin.ck)).status === 200);
    ok('يفتح العهدة اليوميّة', (await call('GET', '/api/wallet/daily', accLogin.ck)).status === 200);
    ok('يفتح لوحة المحفظة', (await call('GET', '/api/wallet/dashboard', accLogin.ck)).status === 200);

    const perms = await call('GET', '/api/workflows/permissions', accLogin.ck);
    const mine = perms.json?.roleAccess?.accountant || [];
    const need = ['paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'documentNumber', 'invoiceNumber', 'netInvoice', 'collectionDate'];
    ok('ويملك حقولَ عمله كلَّها', need.every((f) => mine.includes(f)),
      need.filter((f) => !mine.includes(f)).join(', ') || `${mine.length} حقلًا`);

    // ── ٢ · نوعُ الدفع يُملأ من ملفّ العميل ───────────────────────────────
    head('نوع الدفع يُملأ من ملفّ العميل');
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
    const cashDb = await OW.findById(cashWf._id).select('paymentType netInvoice documentNumber').lean();
    ok('عميلٌ نقديّ ← الكشفُ نقديّ من نفسِه', cashDb.paymentType === 'cash', cashDb.paymentType || '(فارغ)');
    ok('وأعمدةُ الفاتورة أُقفلت معه', cashDb.netInvoice === 0 && cashDb.documentNumber === '0');

    const taxWf = await mk(`zz-عميل-ضريبي-${stamp}`);
    await call('PUT', `/api/workflows/${taxWf._id}`, accLogin.ck, { paymentDate: '2026-09-02' });
    const taxDb = await OW.findById(taxWf._id).select('paymentType').lean();
    ok('عميلٌ ضريبيّ ← الكشفُ ضريبيّ من نفسِه', taxDb.paymentType === 'tax', taxDb.paymentType || '(فارغ)');

    // ── ٣ · العهدةُ تملأ الكشف ────────────────────────────────────────────
    head('المشتريات تملأ الكشف');
    const target = await mk(`zz-عميل-كاش-${stamp}`);
    const buy = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'purchase', amount: 800, purchaseDeliveryStatementNumber: target.reportNumber,
      itemName: 'zz', notes: 'zz-فحص',
    });
    ok('تُقيَّد المشتريات', buy.status === 201, `${buy.status}`);
    const t1 = await OW.findById(target._id).select('paymentAmount paymentDate payingBranch paymentType').lean();
    ok('المبلغُ يصل «مبلغ السداد»', t1.paymentAmount === 800, `${t1.paymentAmount}`);
    ok('والتاريخُ يصل «تاريخ السداد»', !!t1.paymentDate);
    ok('وفرعُ الموظّف يصل «الفرع المسدد»', t1.payingBranch === branch?.name, `${t1.payingBranch} — المتوقَّع ${branch?.name}`);
    ok('ونوعُ الدفع من ملفّ العميل', t1.paymentType === 'cash', t1.paymentType || '(فارغ)');
    if (buy.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${buy.json.transaction._id}`, accLogin.ck);

    // ── ٤ · قيدُ استلام الفاتورة يملأ من سعر الشراء ───────────────────────
    head('استلام فاتورة ضريبيّة يملأ الكشف');
    const rec = await mk(`zz-عميل-ضريبي-${stamp}`);
    const ti = await call('POST', '/api/wallet/transactions', accLogin.ck, {
      type: 'tax_invoice', amount: 0, receivedDocType: 'report',
      receivedDocNumber: rec.reportNumber, notes: 'zz-فحص',
    });
    ok('يُقبل القيد', ti.status === 201, `${ti.status} ${ti.json?.message || ''}`);
    const t2 = await OW.findById(rec._id).select('paymentAmount paymentDate payingBranch').lean();
    ok('مبلغُ السداد = سعرُ الشراء', t2.paymentAmount === 800, `${t2.paymentAmount}`);
    ok('والفرعُ فرعُ الموظّف', t2.payingBranch === branch?.name, `${t2.payingBranch}`);
    ok('وتاريخُ اليوم', !!t2.paymentDate);
    if (ti.json?.transaction?._id) await call('DELETE', `/api/wallet/transactions/${ti.json.transaction._id}`, accLogin.ck);

    // ── ٥ · ويصل الصفحةَ الصحيحة ─────────────────────────────────────────
    head('يصل الصفحة الصحيحة من الصفحتين');
    await OW.updateOne({ _id: target._id }, { $set: { paymentAmount: 800, payingBranch: branch?.name } });
    const cash = await call('GET', `/api/collections-dept/invoices/cash?q=${encodeURIComponent(target.reportNumber)}`, mgr.ck);
    ok('النقديُّ في فواتير الكاش فورًا', (cash.json?.total || 0) >= 1, `${cash.json?.total}`);

    const taxBefore = await call('GET', `/api/collections-dept/invoices/tax?q=${encodeURIComponent(`zz-عميل-ضريبي-${stamp}`)}`, mgr.ck);
    ok('والضريبيُّ لا يصل قبل رقم الفاتورة', (taxBefore.json?.total || 0) === 0, `${taxBefore.json?.total}`);

    const invNo = `ZZ-W2C-${stamp}`;
    await call('PUT', `/api/workflows/${rec._id}`, accLogin.ck, { invoiceNumber: invNo, netInvoice: 1000, invoiceDate: '2026-09-02' });
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
