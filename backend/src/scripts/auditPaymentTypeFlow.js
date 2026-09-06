/**
 * auditPaymentTypeFlow — أنّ نوعَ الدفع يُكتب وحدَه، وأنّ الكشف يصل التحصيل.
 *
 *   node src/scripts/auditPaymentTypeFlow.js --base http://localhost:5199
 *
 * ── ما يُثبَت ───────────────────────────────────────────────────────────────
 *   • كشفٌ يُنشأ لعميلٍ كاشٍ يُولَد نوعُه «كاش» بلا أن يلمسه أحد.
 *   • وكشفُ عميلٍ ضريبيّ يُولَد «ضريبيًّا» — إلّا أن تقول المنصّةُ عن هذه
 *     الحمولة إنّها نقديّة، فهي الاستثناءُ الوحيد.
 *   • وكتابةُ تاريخ سدادٍ على كشفٍ قديمٍ بلا نوعٍ تملؤه في اللحظة نفسِها.
 *   • ثمّ يظهر الكشفُ النقديُّ في شاشة فواتير الكاش فعلًا.
 *   • ولا يُبدَّل نوعٌ اختاره موظّفٌ بيده.
 *
 * ولا يُترَك أثر: كشوفُ الفحص تُنشأ وتُحذَف، ولا يُمسّ كشفٌ حقيقيّ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';
const TAG = 'ZZFLOW';

let pass = 0; let fail = 0;
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const W = require('../models/OperationsWorkflow');
  const P = require('../models/CollectionsParty');

  const cleanup = async () => {
    await User.deleteMany({ email: /^zz-flow/ });
    await W.deleteMany({ reportNumber: new RegExp(`^${TAG}`) });
    await P.deleteMany({ name: new RegExp(`^${TAG}`) });
  };
  await cleanup();

  const u = await User.create({ email: 'zz-flow@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });
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

  try {
    head('عميلان: كاشٌ وضريبيّ');
    const cashCo = await P.create({ kind: 'customer', name: `${TAG} عميل كاش`, paymentType: 'cash' });
    const taxCo = await P.create({ kind: 'customer', name: `${TAG} عميل ضريبي`, paymentType: 'tax' });
    ok('أُنشئا', !!cashCo._id && !!taxCo._id);

    const mk = async (n, username, extra = {}) => api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        reportNumber: `${TAG}${n}`, username,
        reportDate: new Date().toISOString(), applicationStatus: 'bond_received', ...extra,
      }),
    });

    head('الكشفُ يُولَد بنوعه');
    const a = await mk(1, cashCo.name);
    ok('كشفُ عميل الكاش يُنشأ', a.status === 201 || a.status === 200, String(a.status));
    const aDoc = await W.findOne({ reportNumber: `${TAG}1` }).lean();
    ok('ونوعُه «كاش» تلقائيًّا', aDoc?.paymentType === 'cash', `${aDoc?.paymentType || 'فارغ'} · ${aDoc?.paymentTypeSource || '—'}`);

    const b = await mk(2, taxCo.name);
    ok('كشفُ العميل الضريبيّ يُنشأ', b.status === 201 || b.status === 200, String(b.status));
    const bDoc = await W.findOne({ reportNumber: `${TAG}2` }).lean();
    ok('ونوعُه «ضريبي» تلقائيًّا', bDoc?.paymentType === 'tax', `${bDoc?.paymentType || 'فارغ'} · ${bDoc?.paymentTypeSource || '—'}`);

    head('الاستثناءُ الوحيد');
    const c = await mk(3, taxCo.name, { paymentMethod: 'cash' });
    ok('كشفُ عميلٍ ضريبيٍّ بطريقة دفعٍ نقديّة', c.status === 201 || c.status === 200, String(c.status));
    const cDoc = await W.findOne({ reportNumber: `${TAG}3` }).lean();
    ok('يصير «كاش» وحدَه', cDoc?.paymentType === 'cash', `${cDoc?.paymentType || 'فارغ'}`);

    head('كشفٌ قديمٌ بلا نوع، يُكتب له تاريخ سداد');
    const old = await W.create({
      reportNumber: `${TAG}4`, username: cashCo.name, reportDate: new Date(),
      applicationStatus: 'bond_received', paymentType: '',
    });
    ok('أُنشئ بلا نوع', !old.paymentType);
    const upd = await api(`/api/workflows/${old._id}`, {
      method: 'PUT',
      body: JSON.stringify({ paymentDate: new Date().toISOString().slice(0, 10), payingBranch: 'الرياض' }),
    });
    ok('يُقبَل تاريخُ السداد', upd.status === 200, String(upd.status));
    const oldDoc = await W.findById(old._id).lean();
    ok('ويُملأ نوعُه في اللحظة نفسِها', oldDoc?.paymentType === 'cash', `${oldDoc?.paymentType || 'فارغ'} · ${oldDoc?.paymentTypeSource || '—'}`);

    head('ثمّ يصل التحصيل');
    // شاشةُ فواتير الكاش تقرأ الكشوفَ النقديّة ذاتَ تاريخ السداد.
    const inv = await api(`/api/collections-dept/invoices/cash?q=${TAG}4&limit=20`);
    const found = (inv.body?.invoices || []).some((r) => r.reportNumber === `${TAG}4`);
    ok('يظهر في فواتير الكاش', found, `${inv.body?.total ?? 0} صفًّا في النتيجة`);

    head('واختيارُ اليد لا يُمسّ');
    const manual = await api(`/api/workflows/${old._id}`, {
      method: 'PUT', body: JSON.stringify({ paymentType: 'tax' }),
    });
    ok('يُقبَل الاختيار اليدويّ', manual.status === 200, String(manual.status));
    const mDoc = await W.findById(old._id).lean();
    ok('ويُختَم بأنّه اختيارُ يد', mDoc?.paymentTypeSource === 'manual', `${mDoc?.paymentType} · ${mDoc?.paymentTypeSource}`);
    const again = await api(`/api/workflows/${old._id}`, {
      method: 'PUT', body: JSON.stringify({ payingBranch: 'جدة' }),
    });
    const m2 = await W.findById(old._id).lean();
    ok('ولا يُبدَّل بحفظةٍ تالية', again.status === 200 && m2?.paymentType === 'tax', `${m2?.paymentType}`);
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    await cleanup();
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
