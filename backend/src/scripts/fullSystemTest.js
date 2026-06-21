/**
 * Full end-to-end integration test against an isolated in-memory MongoDB.
 * Exercises the REAL routes + middleware + controllers (auth, RBAC, CRM,
 * Accounting incl. auto-posting, Sales, KPIs, org-chart manager resolution).
 *
 * Run from backend/:  node src/scripts/fullSystemTest.js
 * Requires dev tooling: npm i mongodb-memory-server supertest --no-save
 *
 * It NEVER touches the production database — it spins up a throwaway mongod.
 */
process.env.NODE_ENV = 'development'; // → non-secure cookies so supertest keeps the session
require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let pass = 0, fail = 0; const failed = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; failed.push(name); console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
};
const section = (t) => console.log(`\n\x1b[36m── ${t} ──\x1b[0m`);

(async () => {
  const mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
  require('../websocket/socketManager').initializeSocket(http.createServer()); // emits become no-ops

  const User = require('../models/User');
  const Customer = require('../models/Customer');
  const Invoice = require('../models/Invoice');

  // ── Seed ───────────────────────────────────────────────────────────────────
  const admin = await User.create({ email: 'admin@test.com', password: 'Admin@123456', firstName: 'Super', lastName: 'Admin', role: 'super_admin', isActive: true });
  await require('../config/hrDefaults').ensureDefaultLeaveTypes();
  await require('../config/accountingDefaults').ensureDefaultAccounts();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/users', require('../routes/users'));
  app.use('/api/crm', require('../routes/crm'));
  app.use('/api/accounting', require('../routes/accounting'));
  app.use('/api/sales', require('../routes/sales'));
  app.use('/api/kpi', require('../routes/kpi'));
  app.use('/api/procurement', require('../routes/procurement'));
  app.use('/api/hr', require('../routes/hr'));

  const A = request.agent(app); // super_admin session

  // ── Auth ─────────────────────────────────────────────────────────────────
  section('Auth & session');
  const login = await A.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Admin@123456' });
  ok('super_admin login (200)', login.status === 200, `got ${login.status}`);
  const me = await A.get('/api/auth/me');
  ok('GET /auth/me returns the user', me.status === 200 && me.body.user?.role === 'super_admin', `got ${me.status}`);
  const badLogin = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrong' });
  ok('wrong password rejected (401)', badLogin.status === 401, `got ${badLogin.status}`);

  // ── Org chart / manager auto-resolution ─────────────────────────────────────
  section('Org chart & roles');
  const sug0 = await A.get('/api/users/suggest-manager?role=accountant');
  ok('suggest-manager(accountant) falls back up chain to super_admin', sug0.status === 200 && sug0.body.manager?.role === 'super_admin', `got ${sug0.status} ${JSON.stringify(sug0.body.manager)}`);

  const fmRes = await A.post('/api/users').send({ email: 'fm@test.com', password: 'Passw0rd!!', firstName: 'Fin', lastName: 'Manager', role: 'finance_manager' });
  ok('create finance_manager (201)', fmRes.status === 201, `got ${fmRes.status} ${fmRes.body.message || ''}`);
  ok('finance_manager auto-got a manager (super_admin)', String(fmRes.body.user?.manager || '') === String(admin._id), `mgr=${fmRes.body.user?.manager}`);

  const accRes = await A.post('/api/users').send({ email: 'acc@test.com', password: 'Passw0rd!!', firstName: 'Aya', lastName: 'Accountant', role: 'accountant' });
  ok('create accountant (201)', accRes.status === 201, `got ${accRes.status}`);
  ok('accountant auto-got finance_manager as manager', String(accRes.body.user?.manager || '') === String(fmRes.body.user?._id), `mgr=${accRes.body.user?.manager}`);

  const saRes = await A.post('/api/users').send({ email: 'srep@test.com', password: 'Passw0rd!!', firstName: 'Sam', lastName: 'Rep', role: 'sales_rep' });
  ok('create sales_rep (201)', saRes.status === 201, `got ${saRes.status}`);
  const adminUser = await A.post('/api/users').send({ email: 'admin2@test.com', password: 'Passw0rd!!', firstName: 'Ad', lastName: 'Min', role: 'admin' });
  ok('admin auto-reports to super_admin (CEO)', adminUser.status === 201 && String(adminUser.body.user?.manager || '') === String(admin._id), `mgr=${adminUser.body.user?.manager}`);
  const saWithMgr = await A.post('/api/users').send({ email: 'sa@test.com', password: 'Passw0rd!!', firstName: 'Top', lastName: 'Boss', role: 'super_admin' });
  ok('super_admin has NO manager (top of tree)', saWithMgr.status === 201 && !saWithMgr.body.user?.manager, `mgr=${saWithMgr.body.user?.manager}`);

  // ── CRM ─────────────────────────────────────────────────────────────────────
  section('CRM');
  ok('GET /crm/options', (await A.get('/api/crm/options')).status === 200);
  const coRes = await A.post('/api/crm/companies').send({ name: 'Acme Trading', status: 'lead', phone: '0551234567', whatsapp: '966551234567', email: 'info@acme.test', rating: 4 });
  ok('create company (201)', coRes.status === 201, `got ${coRes.status} ${coRes.body.message || ''}`);
  const companyId = coRes.body.company?._id;
  const listCo = await A.get('/api/crm/companies');
  ok('list companies includes new one', listCo.status === 200 && listCo.body.companies.some((c) => c._id === companyId));
  ok('rate company', (await A.patch(`/api/crm/companies/${companyId}/rate`).send({ rating: 5 })).status === 200);
  const ctRes = await A.post('/api/crm/contacts').send({ firstName: 'Khalid', lastName: 'Omar', company: companyId, phone: '0559998888', isPrimary: true });
  ok('create contact (201)', ctRes.status === 201, `got ${ctRes.status}`);
  const dealRes = await A.post('/api/crm/deals').send({ title: 'Q3 Freight Contract', company: companyId, value: 50000, stage: 'qualified' });
  ok('create deal (201)', dealRes.status === 201, `got ${dealRes.status}`);
  const dealId = dealRes.body.deal?._id;
  const moveRes = await A.patch(`/api/crm/deals/${dealId}/move`).send({ stage: 'won' });
  ok('move deal → won sets status+wonAt', moveRes.status === 200 && moveRes.body.deal?.status === 'won' && !!moveRes.body.deal?.wonAt);
  ok('create task (201)', (await A.post('/api/crm/tasks').send({ title: 'Call Acme', company: companyId, priority: 'high' })).status === 201);
  ok('create activity (201)', (await A.post('/api/crm/activities').send({ type: 'call', subject: 'Intro call', company: companyId })).status === 201);
  const crmDash = await A.get('/api/crm/dashboard');
  ok('CRM dashboard reflects company+deal', crmDash.status === 200 && crmDash.body.companiesTotal >= 1);
  ok('CRM calendar (200)', (await A.get('/api/crm/calendar')).status === 200);
  const company = await A.get(`/api/crm/companies/${companyId}`);
  ok('company detail bundles contacts/deals/tasks/activities', company.status === 200 && company.body.contacts.length >= 1 && company.body.deals.length >= 1);

  // ── Accounting ───────────────────────────────────────────────────────────────
  section('Accounting (double-entry + auto-posting)');
  const opt = await A.get('/api/accounting/options');
  ok('chart of accounts seeded (>0)', opt.status === 200 && opt.body.accounts.length > 0, `n=${opt.body.accounts?.length}`);
  const accounts = opt.body.accounts;
  const byCode = (c) => accounts.find((a) => a.code === c)?._id;

  // Seed an invoice so the auto-poster has something to post.
  const cust = await Customer.create({ companyName: 'Acme Logistics LLC', creditLimit: 100000 });
  await Invoice.create({ invoiceNumber: 'INV-T1', customer: cust._id, amount: 10000, balance: 10000, invoiceDate: new Date(), dueDate: new Date(Date.now() + 30 * 864e5), creditTerm: 30, status: 'pending', createdBy: admin._id });
  const sync = await A.post('/api/accounting/sync');
  ok('auto-post sync (200) creates ≥1 entry', sync.status === 200 && sync.body.created >= 1, `created=${sync.body.created} msg=${sync.body.message}`);
  const sync2 = await A.post('/api/accounting/sync');
  ok('auto-post is idempotent (re-run creates 0)', sync2.status === 200 && sync2.body.created === 0, `created=${sync2.body.created}`);

  // Manual balanced + unbalanced journal.
  const balanced = await A.post('/api/accounting/journal').send({ memo: 'Owner capital', lines: [{ account: byCode('1010'), debit: 20000, credit: 0 }, { account: byCode('3000'), debit: 0, credit: 20000 }] });
  ok('balanced manual journal (201)', balanced.status === 201, `got ${balanced.status} ${balanced.body.message || ''}`);
  const unbalanced = await A.post('/api/accounting/journal').send({ memo: 'bad', lines: [{ account: byCode('1010'), debit: 100, credit: 0 }, { account: byCode('3000'), debit: 0, credit: 50 }] });
  ok('unbalanced journal rejected (400)', unbalanced.status === 400, `got ${unbalanced.status}`);

  const tb = await A.get('/api/accounting/trial-balance');
  ok('trial balance is balanced (debit=credit)', tb.status === 200 && tb.body.balanced === true, `D=${tb.body.totalDebit} C=${tb.body.totalCredit}`);
  ok('P&L (200)', (await A.get('/api/accounting/profit-loss')).status === 200);
  const recv = await A.get('/api/accounting/receivables');
  ok('receivables reflects open invoice', recv.status === 200 && recv.body.total >= 10000, `total=${recv.body.total}`);
  ok('ledger for AR account (200)', (await A.get(`/api/accounting/ledger/${byCode('1100')}`)).status === 200);
  ok('accounting dashboard (200)', (await A.get('/api/accounting/dashboard')).status === 200);

  // ── Sales ────────────────────────────────────────────────────────────────────
  section('Sales (on CRM deals)');
  const period = new Date().toISOString().slice(0, 7);
  ok('sales options (200)', (await A.get('/api/sales/options')).status === 200);
  const tgt = await A.post('/api/sales/targets').send({ period, amountTarget: 100000, dealsTarget: 5 });
  ok('set team target (201)', tgt.status === 201, `got ${tgt.status}`);
  const sd = await A.get(`/api/sales/dashboard?period=${period}`);
  ok('sales dashboard reflects won deal', sd.status === 200 && sd.body.wonValue >= 50000, `won=${sd.body.wonValue}`);
  ok('sales performance (200)', (await A.get(`/api/sales/performance?period=${period}`)).status === 200);
  const pl = await A.get('/api/sales/pipeline');
  ok('sales pipeline reads CRM deals', pl.status === 200 && Array.isArray(pl.body.deals));

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  section('KPIs (cross-module)');
  const kpi = await A.get('/api/kpi/overview');
  ok('KPI overview aggregates modules', kpi.status === 200 && kpi.body.crm?.companies >= 1 && typeof kpi.body.finance?.accountsReceivable === 'number', `got ${kpi.status}`);

  // ── Procurement (PR → PO → Bill → A/P) ───────────────────────────────────────
  section('Procurement (PR → PO → Bill → A/P)');
  const Vendor = require('../models/Vendor');
  const vend = await Vendor.create({ name: 'Gulf Spare Parts Co', createdBy: admin._id });
  ok('procurement options (200)', (await A.get('/api/procurement/options')).status === 200);
  const prRes = await A.post('/api/procurement/requests').send({ title: 'Truck tyres', category: 'tyres', priority: 'high', items: [{ description: 'Tyre 315/80', quantity: 10, unitPrice: 1200 }], status: 'pending_approval' });
  ok('create PR submitted (201)', prRes.status === 201 && prRes.body.request?.totalEstimate === 12000, `got ${prRes.status} est=${prRes.body.request?.totalEstimate}`);
  const prId = prRes.body.request._id;
  const dec = await A.patch(`/api/procurement/requests/${prId}/decision`).send({ decision: 'approved' });
  ok('approve PR (200)', dec.status === 200 && dec.body.request?.status === 'approved', `got ${dec.status}`);
  const conv = await A.post(`/api/procurement/requests/${prId}/convert`).send({ vendor: String(vend._id), vatRate: 15 });
  ok('convert PR → PO with 15% VAT', conv.status === 201 && conv.body.order?.total === 13800, `got ${conv.status} total=${conv.body.order?.total}`);
  const poId = conv.body.order._id;
  ok('receive PO (200)', (await A.post(`/api/procurement/orders/${poId}/receive`)).status === 200);
  const billRes = await A.post('/api/procurement/bills').send({ vendor: String(vend._id), purchaseOrder: poId, subtotal: 12000, vatAmount: 1800 });
  ok('create vendor bill (201) total=13800', billRes.status === 201 && billRes.body.bill?.total === 13800, `got ${billRes.status}`);
  const billId = billRes.body.bill._id;
  const payables = await A.get('/api/accounting/payables');
  ok('bill auto-posted → A/P payables ≥ 13800', payables.status === 200 && payables.body.total >= 13800, `total=${payables.body.total}`);
  const tbAfterBill = await A.get('/api/accounting/trial-balance');
  ok('trial balance still balanced after A/P posting', tbAfterBill.body.balanced === true, `D=${tbAfterBill.body.totalDebit} C=${tbAfterBill.body.totalCredit}`);
  const payBill = await A.post(`/api/procurement/bills/${billId}/pay`).send({});
  ok('pay bill in full → status paid', payBill.status === 200 && payBill.body.bill?.status === 'paid', `got ${payBill.status} st=${payBill.body.bill?.status}`);
  const payablesAfter = await A.get('/api/accounting/payables');
  ok('A/P cleared after payment', payablesAfter.body.total < 13800, `total=${payablesAfter.body.total}`);
  const tbFinal = await A.get('/api/accounting/trial-balance');
  ok('trial balance balanced after payment', tbFinal.body.balanced === true, `D=${tbFinal.body.totalDebit} C=${tbFinal.body.totalCredit}`);

  // ── RBAC negative tests ──────────────────────────────────────────────────────
  section('RBAC enforcement');
  const R = request.agent(app);
  await R.post('/api/auth/login').send({ email: 'srep@test.com', password: 'Passw0rd!!' });
  ok('sales_rep CAN see sales dashboard (200)', (await R.get('/api/sales/dashboard')).status === 200);
  ok('sales_rep BLOCKED from accounting (403)', (await R.get('/api/accounting/dashboard')).status === 403);
  ok('sales_rep BLOCKED from KPIs (403)', (await R.get('/api/kpi/overview')).status === 403);
  ok('sales_rep BLOCKED from creating users (403)', (await R.post('/api/users').send({ email: 'x@x.com', password: 'Passw0rd!!', firstName: 'x', lastName: 'y', role: 'employee' })).status === 403);

  const F = request.agent(app);
  await F.post('/api/auth/login').send({ email: 'acc@test.com', password: 'Passw0rd!!' });
  ok('accountant CAN see accounting (200)', (await F.get('/api/accounting/dashboard')).status === 200);
  ok('accountant BLOCKED from deleting a system account (403/400)', [400, 403].includes((await F.delete(`/api/accounting/accounts/${byCode('1000')}`)).status));

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m=== RESULT: ${pass} passed, ${fail} failed ===\x1b[0m`);
  if (fail) console.log('Failed:\n - ' + failed.join('\n - '));
  await mongoose.disconnect();
  await mem.stop();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\x1b[31mTEST HARNESS CRASHED:\x1b[0m', e); process.exit(1); });
