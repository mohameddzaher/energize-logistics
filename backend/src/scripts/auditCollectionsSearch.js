require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/collectionsDeptController');
  const led = require('../controllers/collectionsLedgerController');
  const user = { _id: null, role: 'super_admin' };
  const call = (fn, query) => new Promise((resolve) => {
    const t0 = Date.now();
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ ms: Date.now() - t0, code: this.statusCode, body: b }); } };
    fn({ query, params: {}, user }, res).catch((e) => resolve({ ms: Date.now() - t0, code: 500, body: { err: e.message } }));
  });

  const probes = [
    ['فواتير ضريبية / رقم', c.taxInvoices, { q: '11839', limit: '20' }],
    ['فواتير ضريبية / اسم', c.taxInvoices, { q: 'ابازا', limit: '20' }],
    ['فواتير ضريبية / اسم شائع', c.taxInvoices, { q: 'شركة', limit: '20' }],
    ['فواتير كاش / رقم', c.cashInvoices, { q: '56100', limit: '20' }],
    ['فواتير كاش / اسم', c.cashInvoices, { q: 'اشرف', limit: '20' }],
    ['العملاء / اسم', c.listParties, { kind: 'customer', q: 'روابي', limit: '20' }],
    ['أعمار الديون / اسم', led.aging, { search: 'روابي', limit: '20' }],
    ['أعمار الديون / كود', led.aging, { search: '11040178', limit: '20' }],
    ['الدفتر / رقم فاتورة', led.invoices, { search: '11839', limit: '20' }],
    ['الدفتر / اسم', led.invoices, { search: 'روابي', limit: '20' }],
  ];
  for (const [label, fn, q] of probes) {
    if (typeof fn !== 'function') { console.log(`${label.padEnd(26)} — الدالّة غير موجودة`); continue; }
    const r = await call(fn, q);
    const body = r.body || {};
    const n = (body.invoices || body.parties || body.rows || body.items || []).length;
    const total = body.total ?? '—';
    console.log(`${label.padEnd(26)} ${String(r.ms).padStart(6)}ms  حالة=${r.code}  نتائج=${String(n).padStart(3)}  الكل=${total}${r.code !== 200 ? '  ✗ ' + (body.err || body.message) : ''}`);
  }
  await mongoose.disconnect();
})();
