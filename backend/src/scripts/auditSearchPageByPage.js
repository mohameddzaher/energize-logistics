/** يمرّ على بحثِ كلّ صفحةٍ في التحصيل بصيغِ الاسم المختلفة. لا يكتب شيئًا. */
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
  const count = (b) => (b.invoices || b.parties || b.rows || []).length;
  const total = (b) => b.total ?? '—';

  // صيغتان لاسمٍ واحد: كما هو، وبأشباه الحروف (ة→ه، ي→ى)
  const variants = (s) => [s, s.replace(/ة/g, 'ه').replace(/ي/g, 'ى')];

  const pages = [
    ['الفواتير الضريبية', (q) => call(c.taxInvoices, { q, limit: '5' })],
    ['فواتير الكاش', (q) => call(c.cashInvoices, { q, limit: '5' })],
    ['العملاء', (q) => call(c.listParties, { kind: 'customer', q, limit: '5' })],
    ['أعمار الديون', (q) => call(led.aging, { search: q, limit: '5' })],
    ['دفتر الفواتير', (q) => call(led.invoices, { search: q, limit: '5' })],
  ];

  for (const term of ['روابي التسويق', 'مصنع الخياط']) {
    console.log(`\n══ «${term}» ══`);
    for (const [label, run] of pages) {
      const out = [];
      for (const v of variants(term)) {
        const r = await run(v);
        out.push(`${v === term ? 'كما هو' : 'بأشباه'}=${r.code === 200 ? count(r.body) + '/' + total(r.body) : 'خطأ'} (${r.ms}ms)`);
      }
      const n = out.map((x) => x.match(/=(\d+)\//)?.[1]);
      const same = n[0] === n[1];
      console.log(`  ${label.padEnd(18)} ${out[0].padEnd(24)} ${out[1].padEnd(24)} ${same ? '✓' : '✗ الصيغتان تختلفان'}`);
    }
  }
  await mongoose.disconnect();
})();
