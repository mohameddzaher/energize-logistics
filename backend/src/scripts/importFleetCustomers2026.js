/* eslint-disable no-console */
/**
 * importFleetCustomers2026: the follow-up sheet Sheet1 into fleet customers.
 * The type column (tax or cash) becomes a fleet_payment_type key so the load-creation screen can auto-fill the customer agreement. Each customer is linked to its CRM company by normalized name, the only join between the two registers. Safe to re-run: matches by normalized key and overwrites existing values only with --force.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { readSheet } = require('./lib/xlsxStream');
const { nameKey } = require('../utils/nameKey');

const FILE = path.join(__dirname, '../seeds/data/ops-2026-08/followup-2026-final.xlsx');
const SHEET = 'xl/worksheets/sheet3.xml';   // Sheet1, columns C and D
const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');
const FORCE = process.argv.includes('--force');

/** Tax label maps to tax, cash labels (English or Arabic) map to cash; these are fleet_payment_type keys. */
function payKey(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return '';
  if (/^cash$/.test(v) || v === 'كاش' || v === 'نقدي') return 'cash';
  if (v === 'ضريبي' || v === 'ضريبى' || /^tax$/.test(v)) return 'tax';
  return '';
}

(async () => {
  if (!fs.existsSync(FILE)) { console.error('✗ الملفّ غير موجود:', FILE); process.exit(1); }

  const rows = readSheet(FILE, SHEET);
  const list = [];
  const seen = new Set();
  let unknownType = 0;
  for (const { cells, r } of rows) {
    if (r < 4) continue;                                   // Header is on row 3
    const name = String(cells.C ?? '').trim();
    if (!name || name === '0') continue;
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const paymentType = payKey(cells.D);
    if (!paymentType) unknownType++;
    list.push({ name, key, paymentType });
  }
  console.log(`\n  قُرئ ${list.length} عميلًا · ضريبي ${list.filter((x) => x.paymentType === 'tax').length} · كاش ${list.filter((x) => x.paymentType === 'cash').length}` + (unknownType ? ` · بلا نوع ${unknownType}` : ''));

  await mongoose.connect(process.env.MONGODB_URI);
  const { FleetCustomer } = require('../models/FleetModels');
  const CrmCompany = require('../models/CrmCompany');

  // CRM index built once in memory to avoid a query per customer.
  const companies = await CrmCompany.find().select('name arabicName').lean();
  const crmByKey = new Map();
  for (const c of companies) for (const n of [c.name, c.arabicName]) if (n) crmByKey.set(nameKey(n), c._id);

  const existing = await FleetCustomer.find().lean();
  const byKey = new Map(existing.map((c) => [c.nameKey || nameKey(c.name), c]));

  const toCreate = []; const toUpdate = [];
  for (const x of list) {
    const cur = byKey.get(x.key);
    const crmCompany = crmByKey.get(x.key) || null;
    if (!cur) { toCreate.push({ name: x.name, nameKey: x.key, paymentType: x.paymentType, crmCompany, customerType: 'heavy' }); continue; }
    const set = {};
    if (!cur.nameKey) set.nameKey = x.key;
    if (x.paymentType && (FORCE || !cur.paymentType)) set.paymentType = x.paymentType;
    if (crmCompany && (FORCE || !cur.crmCompany)) set.crmCompany = crmCompany;
    if (!cur.customerType) set.customerType = 'heavy';
    if (Object.keys(set).length) toUpdate.push({ _id: cur._id, name: cur.name, set });
  }

  const linked = toCreate.filter((c) => c.crmCompany).length + toUpdate.filter((u) => u.set.crmCompany).length;
  console.log(`  عندنا الآن ${existing.length} عميلًا · سيُنشأ ${toCreate.length} · سيُحدَّث ${toUpdate.length} · مرتبطٌ بالـCRM ${linked}`);
  const noCrm = list.filter((x) => !crmByKey.has(x.key));
  if (noCrm.length) console.log(`  · ${noCrm.length} بلا شركةٍ مطابقة في الـCRM: ${noCrm.slice(0, 6).map((x) => x.name).join(' · ')}${noCrm.length > 6 ? ' …' : ''}`);

  if (DRY || !YES) { console.log('\n  ' + (DRY ? '— تجربةٌ فقط، لم يُكتب شيء.' : '— لم يُمرَّر --yes، فلم يُكتب شيء.') + '\n'); process.exit(0); }

  if (toCreate.length) await FleetCustomer.insertMany(toCreate, { ordered: false });
  for (const u of toUpdate) await FleetCustomer.updateOne({ _id: u._id }, { $set: u.set });
  console.log(`\n  ✓ أُنشئ ${toCreate.length} · حُدِّث ${toUpdate.length}.\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
