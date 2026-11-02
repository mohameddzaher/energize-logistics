/**
 * fixCollectionInvoiceComments: restores supervisor comments to ledger invoices.
 * Dry run by default; --apply writes; --file selects the workbook.
 * The October import read the invoices sheet with the September column positions, but the Exit Date column was removed in between. Days TTL landed in the comment field (9364 invoices with a numeric comment), supervisor comments were lost and the first row was skipped.
 * Re-importing wipes the ledger and any collections recorded since, so this writes only those two fields, keyed by type + number + sheet code, touching no amount, date or status.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const fi = process.argv.indexOf('--file');
const BOOK = fi >= 0 ? process.argv[fi + 1] : 'Financial Collections    10-2026.xlsx';
const FILE = path.join(__dirname, '../../..', 'collection files', BOOK);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionsParty = require('../models/CollectionsParty');

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true, sheets: ['Daily Invoice Report'] });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: null, blankrows: false, raw: true });
  const h = rows.findIndex((r) => r && S(r[0]).toLowerCase() === 'code');
  const names = rows[h].map((c) => S(c).toLowerCase().replace(/\s+/g, ' '));
  const cComments = names.indexOf('supervisor comments');
  const cTotal = names.indexOf('total outstanding');
  const cStatus = names.indexOf('status');
  if (h < 0 || cComments < 0) { console.error('لا عمودَ «Supervisor Comments» في الورقة'); process.exit(1); }

  const db = await CollectionInvoice.find({ kind: 'tax' }).select('invoiceNumber sheetCode comments').lean();
  const byKey = new Map(db.map((d) => [`${d.invoiceNumber}|${d.sheetCode || ''}`, d]));

  const ops = []; const before = []; const missing = [];
  let same = 0; let withText = 0;
  for (const r of rows.slice(h + 1)) {
    const num = S(r[2]); if (!num) continue;
    const code = S(r[0]);
    const want = S(r[cComments]);
    if (want) withText += 1;
    const d = byKey.get(`${num}|${code}`);
    if (!d) { missing.push({ num, code, name: S(r[1]), total: N(r[cTotal]), status: S(r[cStatus]), comments: want }); continue; }
    if ((d.comments || '') === want) { same += 1; continue; }
    before.push({ _id: d._id, invoiceNumber: num, comments: d.comments || '' });
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { comments: want } } } });
  }

  console.log(`\n  الملفّ: ${BOOK}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  فواتيرُ في الورقة لها ملاحظة: ${withText}`);
  console.log(`  ملاحظاتٌ تُصحَّح: ${ops.length}  ·  صحيحةٌ أصلًا: ${same}`);
  console.log(`  صفوفٌ في الورقة ليست في الدفتر: ${missing.length}`);
  for (const m of missing) console.log(`     ${m.num} · ${m.code} · ${m.name} · ${m.total} · «${m.comments}»`);

  if (!APPLY) { await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `collection-invoice-comments-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(backup, JSON.stringify(before));
  console.log(`  ✔ نسخةٌ من القديم: ${backup}`);

  let wrote = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    wrote += (await CollectionInvoice.bulkWrite(ops.slice(i, i + 1000), { ordered: false })).modifiedCount || 0;
  }
  console.log(`  ✔ كُتبت: ${wrote}`);

  // The skipped row enters as it would have: with its account code, and without an amount if it has none.
  for (const m of missing) {
    const party = m.code ? await CollectionsParty.findOne({ code: m.code }).select('_id').lean() : null;
    await CollectionInvoice.updateOne(
      { kind: 'tax', invoiceNumber: m.num, sheetCode: m.code },
      { $set: {
        kind: 'tax', invoiceNumber: m.num, sheetCode: m.code, partyCode: m.code, partyName: m.name,
        party: party ? party._id : null, total: m.total, status: m.status, comments: m.comments,
        unused: false, source: 'collections_workbook',
      } },
      { upsert: true },
    );
    console.log(`  ✔ أُضيف الصفُّ ${m.num}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
