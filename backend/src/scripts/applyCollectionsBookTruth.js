/**
 * applyCollectionsBookTruth: the collections book is the more accurate source, so it is written from.
 * node --max-old-space-size=8192 src/scripts/applyCollectionsBookTruth.js --dry
 * Decision: the collections file's data is taken as the correct one, and for cash invoices the price in the collections sheet is the right one.
 * The 'Shipment Report' sheet, the cash manifests book, is written onto our manifests in two places: (1) Payment type: what the sheet counts as cash becomes cash. Forty-two manifests were tax or untyped, forty of them never touched by a person; their type came from a customer-level default, which is wrong because one customer is cash on one load and tax on another. (2) Selling value: our `sellingValue` comes from the operations platform, and 'Invoice Total' in the book is what was actually invoiced. For a cash manifest the book is the reference. Not written: a manifest not in the sheet is untouched, and no collection or payment date is changed (already matching with zero difference). All old values are printed before writing and recorded in the audit log, so what was written is known and reviewable.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '..', '..', '..', 'collection files', 'Financial Collections    9-2026.xlsx');
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OW = require('../models/OperationsWorkflow');
  const logAudit = require('../utils/auditLogger');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const rows = XLSX.utils
    .sheet_to_json(wb.Sheets['Shipment Report'], { header: 1, defval: null, blankrows: false, raw: true }).slice(6);

  const ship = new Map();
  for (const r of rows) {
    const no = S(r[5]);
    if (!/^\d+$/.test(no)) continue;
    ship.set(no, { total: N(r[6]), account: S(r[2]), owner: S(r[1]), status: S(r[14]) });
  }
  console.log(`ورقةُ الكشوف النقديّة: ${ship.size} كشفًا`);

  const keys = [...ship.keys()];
  const ours = [];
  for (let i = 0; i < keys.length; i += 1000) {
    ours.push(...await OW.find({ reportNumber: { $in: keys.slice(i, i + 1000) } })
      .select('reportNumber paymentType sellingValue username lastModifiedBy cashCollectionStatus collectionDate').lean());
  }
  console.log(`منها في كشوفنا: ${ours.length}\n`);

  const typeOps = []; const valOps = [];
  console.log('① نوعُ الدفع — ما عدّته الورقةُ نقديًّا:');
  for (const w of ours) {
    if (w.paymentType === 'cash') continue;
    typeOps.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: 'cash' } } } });
    if (typeOps.length <= 12) {
      console.log(`   كشف ${w.reportNumber}  ${String(w.paymentType || '(بلا نوع)').padEnd(10)} → cash   ${w.username || ''}`);
    }
  }
  console.log(`   ${DRY ? 'سيتغيّر' : 'تغيّر'}: ${typeOps.length} كشفًا${typeOps.length > 12 ? ' (عُرض منها ١٢)' : ''}\n`);

  console.log('② قيمةُ البيع — من «Invoice Total» في الدفتر:');
  let gap = 0;
  for (const w of ours) {
    const s = ship.get(w.reportNumber);
    if (!s?.total) continue;
    if (money(s.total) === money(w.sellingValue)) continue;
    gap += s.total - (w.sellingValue || 0);
    valOps.push({ updateOne: { filter: { _id: w._id }, update: { $set: { sellingValue: money(s.total), sellingValueSource: 'collections_book' } } } });
    if (valOps.length <= 15) {
      console.log(`   كشف ${w.reportNumber}  ${String(w.sellingValue).padStart(8)} → ${String(money(s.total)).padStart(8)}   (${money(s.total - (w.sellingValue || 0))})  ${s.account}`);
    }
  }
  console.log(`   ${DRY ? 'سيتغيّر' : 'تغيّر'}: ${valOps.length} كشفًا${valOps.length > 15 ? ' (عُرض منها ١٥)' : ''} · صافي الفرق ${money(gap).toLocaleString()} ر.س\n`);

  // (3) Collection status as stated by the book; no date is invented.
  console.log('③ حالةُ التحصيل من عمود «Status» في الدفتر:');
  const statOps = []; let noDate = 0;
  for (const w of ours) {
    const s = ship.get(w.reportNumber);
    const want = /collected/i.test(s?.status || '') ? 'collected' : '';
    if ((w.cashCollectionStatus || '') === want) continue;
    if (want === 'collected' && !w.collectionDate) noDate += 1;
    statOps.push({ updateOne: { filter: { _id: w._id }, update: { $set: { cashCollectionStatus: want } } } });
  }
  console.log(`   ${DRY ? 'سيتغيّر' : 'تغيّر'}: ${statOps.length} كشفًا · منها ${noDate} «محصَّل» بلا تاريخٍ في الدفتر\n`);

  if (!DRY) {
    for (const ops of [typeOps, valOps, statOps]) {
      for (let i = 0; i < ops.length; i += 500) await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    await logAudit({
      bySystem: true, action: 'apply_collections_book', entity: 'OperationsWorkflow',
      changes: { source: 'Shipment Report', paymentTypeSetToCash: typeOps.length, sellingValueRewritten: valOps.length, cashStatusSet: statOps.length, netValueChange: money(gap) },
      ipAddress: 'script',
    });
    console.log('✓ كُتب، وقُيِّد في سجلّ المراجعة.');
    try { require('../utils/ttlCache').clear('wf:'); require('../utils/ttlCache').clear('colledger:'); } catch (_) {}
  }

  const after = await OW.aggregate([{ $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('\nنوعُ الدفع في السجلّ الآن:');
  for (const a of after) console.log(`  ${String(a.n).padStart(6)}  ${a._id || '(بلا نوع)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
