require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/collectionsDeptController');
  const run = (fn, query = {}, params = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    fn({ query, params, user: { _id: null, role: 'super_admin' } }, res).catch((e) => resolve({ code: 500, body: { err: e.message } }));
  });

  console.log('── قيمُ عمودٍ في الضريبيّ: partyName ──');
  let r = await run(c.invoiceColumnOptions, { field: 'partyName' }, { kind: 'tax' });
  console.log(r.code, 'قيم:', r.body.values?.length, 'مقطوعة:', r.body.truncated);
  console.log(r.body.values?.slice(0, 4));

  console.log('\n── بحثٌ داخل القائمة: «ابازا» ──');
  r = await run(c.invoiceColumnOptions, { field: 'partyName', q: 'ابازا' }, { kind: 'tax' });
  console.log(r.code, r.body.values);

  console.log('\n── تاريخُ الفاتورة (تواريخ) ──');
  r = await run(c.invoiceColumnOptions, { field: 'invoiceDate' }, { kind: 'tax' });
  console.log(r.code, 'قيم:', r.body.values?.length, r.body.values?.slice(0, 3));

  console.log('\n── قيمُ عمودٍ في الكاش: username ──');
  r = await run(c.invoiceColumnOptions, { field: 'username' }, { kind: 'cash' });
  console.log(r.code, 'قيم:', r.body.values?.length, r.body.values?.slice(0, 4));

  console.log('\n── عمودٌ غيرُ مسموح يُرفض ──');
  r = await run(c.invoiceColumnOptions, { field: 'total' }, { kind: 'tax' });
  console.log(r.code, r.body.message);

  console.log('\n── الجدولُ الضريبيُّ بلا فلتر ──');
  r = await run(c.taxInvoices, { limit: '3' });
  console.log(r.code, 'الكل:', r.body.total, '| أوّل صفّ:', r.body.invoices?.[0]?.invoiceNumber, r.body.invoices?.[0]?.customer, 'ملفّ:', r.body.invoices?.[0]?.partyId || '(بلا)');

  const someName = r.body.invoices?.[0]?.customer;
  console.log('\n── ثمّ بفلتر عمودٍ على ذلك العميل ──');
  const r2 = await run(c.taxInvoices, { limit: '3', cf_partyName: someName });
  console.log(r2.code, 'الكل:', r2.body.total, '| كلُّهم هو؟', r2.body.invoices?.every((x) => x.customer === someName));

  console.log('\n── والكاشُ كذلك ──');
  const r3 = await run(c.cashInvoices, { limit: '3' });
  console.log(r3.code, 'الكل:', r3.body.total, '| أوّل صفّ:', r3.body.invoices?.[0]?.reportNumber, r3.body.invoices?.[0]?.customer, 'ملفّ:', r3.body.invoices?.[0]?.partyId || '(بلا)');
  const cn = r3.body.invoices?.[0]?.customer;
  const r4 = await run(c.cashInvoices, { limit: '5', cf_username: cn });
  console.log('بفلتر العميل:', r4.code, 'الكل:', r4.body.total, '| كلُّهم هو؟', r4.body.invoices?.every((x) => x.customer === cn));

  await mongoose.disconnect();
})();
