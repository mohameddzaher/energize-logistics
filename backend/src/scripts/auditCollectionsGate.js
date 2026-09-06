/**
 * auditCollectionsGate — ما الذي يُوصل الكشفَ قسمَ التحصيل، بعد تغيير الشرط.
 *
 *   node src/scripts/auditCollectionsGate.js --base http://localhost:5199
 *
 * ── القاعدةُ المفحوصة ──────────────────────────────────────────────────────
 *   • رقمُ فاتورةٍ يُكتب → الفواتيرُ الضريبيّة، فورًا، وبلا شرطٍ آخر.
 *   • مراجعةُ التشغيل + نوعٌ نقديٌّ + تاريخُ سداد → فواتيرُ الكاش، فورًا.
 *   • نوعٌ ضريبيٌّ بلا رقمٍ لا يصل شيئًا ولو روجع.
 *   • والكشوفُ السابقة لأوّل سبتمبر تبقى على شرطها القديم — عمودُ المراجعة
 *     فارغٌ فيها كلِّها، فاشتراطُه عليها يُفرغ الشاشة.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';
const TAG = 'ZZGATE';

let pass = 0; let fail = 0;
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const W = require('../models/OperationsWorkflow');
  const P = require('../models/CollectionsParty');
  const CI = require('../models/CollectionInvoice');

  const cleanup = async () => {
    await User.deleteMany({ email: /^zz-gate2/ });
    await W.deleteMany({ reportNumber: new RegExp(`^${TAG}`) });
    await P.deleteMany({ name: new RegExp(`^${TAG}`) });
    await CI.deleteMany({ invoiceNumber: new RegExp(`^${TAG}`) });
  };
  await cleanup();

  const u = await User.create({ email: 'zz-gate2@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await cleanup(); process.exit(1); }

  const api = async (path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: ck, Origin: ORIGIN, ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };
  const inCash = async (rn) => {
    const r = await api(`/api/collections-dept/invoices/cash?q=${rn}&limit=20`);
    return (r.body?.invoices || []).some((x) => x.reportNumber === rn);
  };
  const inTax = async (no) => {
    const r = await api(`/api/collections-dept/invoices/tax?q=${no}&limit=20`);
    return (r.body?.invoices || []).some((x) => String(x.invoiceNumber) === String(no));
  };

  const NEW = new Date('2026-09-10T00:00:00.000Z');
  const OLD = new Date('2026-05-10T00:00:00.000Z');

  try {
    const cashCo = await P.create({ kind: 'customer', name: `${TAG} عميل كاش`, paymentType: 'cash' });
    const taxCo = await P.create({ kind: 'customer', name: `${TAG} عميل ضريبي`, paymentType: 'tax' });

    const mk = (n, username, date, extra = {}) => api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        reportNumber: `${TAG}${n}`, username, reportDate: date.toISOString(),
        applicationStatus: 'bond_received', ...extra,
      }),
    });

    head('كاشٌ جديد: ينتظر مراجعة التشغيل');
    await mk(1, cashCo.name, NEW, { paymentDate: NEW.toISOString(), payingBranch: 'الرياض' });
    const w1 = await W.findOne({ reportNumber: `${TAG}1` }).lean();
    ok('نوعُه كاش', w1?.paymentType === 'cash', String(w1?.paymentType));
    ok('ولا يصل الكاش قبل المراجعة', !(await inCash(`${TAG}1`)));
    await api(`/api/workflows/${w1._id}`, { method: 'PUT', body: JSON.stringify({ accountingReview: 'تم' }) });
    ok('ويصلها فورَ المراجعة', await inCash(`${TAG}1`));

    head('ضريبيٌّ جديد: المراجعةُ لا تكفي');
    await mk(2, taxCo.name, NEW, { paymentDate: NEW.toISOString(), payingBranch: 'الرياض', accountingReview: 'تم' });
    const w2 = await W.findOne({ reportNumber: `${TAG}2` }).lean();
    ok('نوعُه ضريبي', w2?.paymentType === 'tax', String(w2?.paymentType));
    ok('ولا يصل الكاش', !(await inCash(`${TAG}2`)));
    ok('ولا يصل الضريبيَّ بلا رقم', !(await inTax(`${TAG}901`)));

    head('ورقمُ الفاتورة وحدَه يفتح الباب الضريبيّ');
    const r3 = await api(`/api/workflows/${w2._id}`, {
      method: 'PUT',
      body: JSON.stringify({ invoiceNumber: `${TAG}901`, netInvoice: 1000, tax: 150, totalInvoice: 1150 }),
    });
    ok('يُقبَل رقمُ الفاتورة', r3.status === 200, String(r3.status));
    ok('ويصل الفواتيرَ الضريبيّة فورًا', await inTax(`${TAG}901`));
    const led = await CI.findOne({ invoiceNumber: `${TAG}901` }).lean();
    ok('وقُيِّد في دفتر الفواتير', !!led, led ? `${led.partyName} · ${led.total}` : 'لا قيد');

    head('عميلٌ ضريبيٌّ وطريقةُ دفعٍ نقديّة');
    await mk(4, taxCo.name, NEW, { paymentMethod: 'cash', paymentDate: NEW.toISOString(), payingBranch: 'جدة' });
    const w4 = await W.findOne({ reportNumber: `${TAG}4` }).lean();
    ok('الجديدُ يصير كاشًا', w4?.paymentType === 'cash', String(w4?.paymentType));
    await mk(5, taxCo.name, OLD, { paymentMethod: 'cash', paymentDate: OLD.toISOString(), payingBranch: 'جدة' });
    const w5 = await W.findOne({ reportNumber: `${TAG}5` }).lean();
    ok('والقديمُ يبقى ضريبيًّا', w5?.paymentType === 'tax', String(w5?.paymentType));

    head('والقديمُ يمرّ بلا مراجعة');
    await mk(6, cashCo.name, OLD, { paymentDate: OLD.toISOString(), payingBranch: 'الدمام' });
    ok('كشفٌ قديمٌ نقديٌّ يصل الكاش بلا مراجعة', await inCash(`${TAG}6`));
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    await cleanup();
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
