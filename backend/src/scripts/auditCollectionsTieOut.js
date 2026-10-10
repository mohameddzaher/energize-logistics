/**
 * auditCollectionsTieOut — شاشاتُ التحصيل تقول رقمًا واحدًا.
 *
 *   node src/scripts/auditCollectionsTieOut.js
 *
 * يقرأ فقط. ينادي متحكِّماتِ الشاشات نفسَها (لا نسخةً من حسابها) ويطابق ما
 * تعرضه بعضَه ببعض وبدفتر الفواتير: اللوحةُ، وأعمارُ الديون، والفريقُ،
 * والتقييمُ، ودفترُ الفواتير، وصفحةُ الضريبيّ، وقائمةُ العملاء.
 *
 * وُجد لأنّ كلَّ شاشةٍ كان لها تعريفُها لـ«المفتوح»: ١٩٫٩٦ في اللوحة و٢٢٫٠٥
 * في الأعمار و٢٠٫٠٤ في التقييم و٤٥٫٣ في قائمة العملاء — والدفترُ واحد.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const call = (fn, query = {}) => new Promise((resolve, reject) => {
  const res = { status() { return this; }, json: resolve };
  Promise.resolve(fn({ query, params: {}, body: {}, user: { _id: new mongoose.Types.ObjectId(), role: 'super_admin' } }, res)).catch(reject);
});
const near = (a, b) => Math.abs(a - b) < 0.5;
const f = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CI = require('../models/CollectionInvoice');
  const recv = require('../controllers/collectionsReceivablesController');
  const led = require('../controllers/collectionsLedgerController');
  const dept = require('../controllers/collectionsDeptController');

  const byKind = Object.fromEntries((await CI.aggregate([
    { $match: CI.OPEN }, { $group: { _id: '$kind', n: { $sum: 1 }, t: { $sum: '$total' } } },
  ])).map((x) => [x._id, x]));
  const tax = byKind.tax || { n: 0, t: 0 }; const cash = byKind.cash || { n: 0, t: 0 };
  const all = tax.t + cash.t;
  // فاتورةٌ بلا حسابٍ مربوط لا تظهر في شاشةٍ تُجمَع بالحساب — تُعَدّ وتُقال.
  const orphan = (await CI.aggregate([{ $match: { ...CI.OPEN, party: null } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: '$total' } } }]))[0] || { n: 0, t: 0 };

  const [ov, ag, tm, pf, li, tx, cu] = await Promise.all([
    call(recv.overview), call(led.aging, { limit: '5000' }), call(led.team), call(led.performance),
    call(led.invoices, { limit: '1', open: 'true' }), call(dept.taxInvoices, { limit: '1', collected: 'no' }),
    call(dept.listParties, { kind: 'customer', limit: '1' }),
  ]);

  let failed = 0;
  const check = (label, got, want) => {
    const ok = near(got, want); if (!ok) failed += 1;
    console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(44)} ${f(got).padStart(16)}${ok ? '' : `   المتوقَّع ${f(want)}`}`);
  };
  console.log(`\n  الدفتر: مفتوحٌ ${f(all)}  (ضريبي ${tax.n} · ${f(tax.t)}  |  نقدي ${cash.n} · ${f(cash.t)})`);
  if (orphan.n) console.log(`  (منها بلا حسابٍ مربوط: ${orphan.n} · ${f(orphan.t)})`);
  console.log('');
  check('اللوحة — الإجمالي', ov.tree.all.value, all);
  check('اللوحة — ضريبي', ov.tree.byKind.tax.value, tax.t);
  check('اللوحة — نقدي', ov.tree.byKind.cash.value, cash.t);
  check('اللوحة — مجموعُ الموظّفين', ov.officers.reduce((a, o) => a + o.value, 0), all);
  check('أعمار الديون — إجمالي المديونية', ag.totals.outstanding, all - orphan.t);
  check('أعمار الديون — مجموعُ الشرائح', Object.values(ag.totals.bands).reduce((a, b) => a + b, 0), all - orphan.t);
  check('أعمار الديون — مجموعُ الصفوف', ag.rows.reduce((a, r) => a + r.outstanding, 0), all - orphan.t);
  check('الفريق — مجموعُ المديونية', tm.officers.reduce((a, o) => a + o.outstanding, 0), all - orphan.t);
  check('التقييم — الباقي', pf.totals.openAmount, all - orphan.t);
  check('دفتر الفواتير — غير المحصَّل', li.sum, all);
  check('الفواتير الضريبية — لم تُحصَّل (قيمة)', tx.totals.value, tax.t);
  check('الفواتير الضريبية — لم تُحصَّل (عدد)', tx.totals.pending, tax.n);
  check('قائمة العملاء — المستحق لنا', cu.totals.outstanding, all - orphan.t);
  for (const c of ov.checks) { if (!c.ok) failed += 1; console.log(`  ${c.ok ? '✔' : '✘'} الشجرة: ${c.of}`); }

  console.log(failed ? `\n  ✘ ${failed} لا تتطابق\n` : '\n  ✔ الشاشاتُ كلُّها على رقمٍ واحد\n');
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
