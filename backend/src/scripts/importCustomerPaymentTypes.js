/**
 * Payment type is a customer attribute, read from the customer file (columns: customer, payment type).
 * It lives on the customer, not the report: a cash customer always pays on the spot and a tax customer is always invoiced, so choosing it per report is repetitive and error-prone, and one mistake sends a tax customer's report to cash invoices.
 * Matching uses the folded name, which absorbs differences in hamza, taa marbuta and extra spaces between the sheet and the reports.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '..', '..', '..', 'operation files', 'نوع الدفع للعملاء .xlsx');

// The cash and tax labels as written in the sheet, plus likely variants.
const readType = (v) => {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return '';
  if (/cash|نقد|كاش/.test(t)) return 'cash';
  if (/tax|ضريب/.test(t)) return 'tax';
  return '';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;

  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  console.log(`صفوف الشيت: ${rows.length}`);

  // The same name can repeat in the sheet; fold it before writing so it is not written twice.
  const byKey = new Map();
  const unreadable = [];
  for (const r of rows) {
    const name = String(r['العميل'] ?? r['العميل '] ?? '').trim();
    const type = readType(r['نوع الدفع '] ?? r['نوع الدفع']);
    if (!name) continue;
    if (!type) { unreadable.push(name); continue; }
    const key = fold(name);
    if (key) byKey.set(key, { name, type });
  }
  console.log(`أسماءٌ بعد طيّ التكرار: ${byKey.size}`);
  if (unreadable.length) console.log(`نوعٌ غير مقروء (يُترك): ${unreadable.length}`);

  const parties = await CollectionsParty.find({ kind: 'customer' })
    .select('_id name nameKey paymentType').lean();
  const partyByKey = new Map(parties.map((p) => [p.nameKey || fold(p.name), p]));

  const ops = [];
  const created = [];
  let matched = 0; let unchanged = 0;
  const notFound = [];

  for (const [key, v] of byKey) {
    const p = partyByKey.get(key);
    if (!p) { notFound.push(v.name); continue; }
    if (p.paymentType === v.type) { unchanged += 1; continue; }
    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { paymentType: v.type } } } });
    matched += 1;
  }

  // A name in the sheet but not in the registry is added: the sheet says it is our customer.
  for (const name of notFound) {
    const v = byKey.get(fold(name));
    created.push({ kind: 'customer', name, nameKey: fold(name), paymentType: v.type, source: 'payment_types_sheet' });
  }

  if (!DRY) {
    for (let i = 0; i < ops.length; i += 500) await CollectionsParty.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    if (created.length) await CollectionsParty.insertMany(created, { ordered: false });
  }

  console.log(`\nكُتب النوع على: ${matched} عميلًا`);
  console.log(`عليه النوعُ نفسُه فلم يُمَسّ: ${unchanged}`);
  console.log(`لم يُوجَد في السجلّ فأُضيف: ${created.length}`);
  if (created.length) for (const c of created.slice(0, 15)) console.log(`    ${c.name}  (${c.type})`);

  const counts = await CollectionsParty.aggregate([
    { $match: { kind: 'customer' } },
    { $group: { _id: '$paymentType', n: { $sum: 1 } } },
  ]);
  console.log('\nالسجلُّ الآن:');
  for (const c of counts) console.log(`  ${String(c.n).padStart(5)}  ${c._id || '(بلا نوع)'}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
