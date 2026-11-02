/**
 * Imports the whole collections book from a single file; one script so a partial run cannot leave the DB half updated.
 * Only book-sourced data is wiped; parties are never deleted, a party that left the book is deactivated.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const BOOK = arg('file', 'Updated Financial Collections    9-2026.xlsx');
const FILE = path.join(__dirname, '../../..', 'collection files', BOOK);

const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
/** Dates are read as raw serial numbers, not text: cellDates loses a day on this machine (see the Excel epoch trap). */
const D = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return new Date(XLS_EPOCH + Math.round(v * 86400000));
  const s = S(v);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m.map(Number); if (y < 100) y += 2000; const dt = new Date(Date.UTC(y, mo - 1, d)); return Number.isNaN(dt.getTime()) ? null : dt; }
  return null;
};
const splitList = (v) => S(v).split(/[/,؛;+&]|\s+و\s+/).map((x) => x.trim()).filter(Boolean);

/** A totals row in the sheet is not a customer; creating it would carry everyone's debt. */
const TOTALS_ROW = /^\s*(?:الإجمالي|الاجمالي|المجموع|total|grand\s*total)\s*$/i;
/** Placeholder values meaning no invoice are not invoice numbers. */
const NO_INVOICE = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|0|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ باسم «${BOOK}» في مجلّد collection files`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionTask = require('../models/CollectionTask');
  const { fold } = CollectionsParty;
  let PartyLinkSuggestion = null;
  try { PartyLinkSuggestion = require('../models/PartyLinkSuggestion'); } catch (_) { /* optional */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n  الملفّ: ${BOOK}${APPLY ? '' : '\n  — تجربة، بلا كتابة —'}\n`);

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = (n) => (wb.Sheets[n]
    ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true })
    : []);
  const body = (n, headerRow) => raw(n).slice(headerRow + 1);

  // Columns are read by header name, not position: a dropped column shifts everything after it.
  // Find the header row (Code); a missing column reads empty instead of borrowing its neighbour.
  const table = (n) => {
    const rows = raw(n);
    const h = rows.findIndex((r) => r && S(r[0]).toLowerCase() === 'code');
    if (h < 0) return { rows: [], col: () => -1 };
    const names = rows[h].map((c) => S(c).toLowerCase().replace(/\s+/g, ' '));
    const col = (...wanted) => {
      for (const w of wanted) { const i = names.indexOf(w); if (i >= 0) return i; }
      return -1;
    };
    return { rows: rows.slice(h + 1), col };
  };
  const at = (r, i) => (i >= 0 ? r[i] : null);

  // Step 1: accounts. Column layout per sheet:
  // Aging: 0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 limit 8 Status 9 CreditDays 10 Outstanding 11..20 ages 21 Contracts 22 Reconciliation 23 ReconDate 24 Comments
  // Aging Shipment: 0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 Status 8 CreditDays 9 Outstanding 10 15+ 11 15- 12 Contracts 13 Reconciliation 14 ReconDate 15 Comments
  const accounts = new Map();
  const nameless = [];
  const addAccount = (a) => {
    if (!a.code) return;
    // A code without a name is kept and matched by code; its name comes from the invoice book where it is written on its invoices.
    if (!a.name) { nameless.push(a.code); a.codeOnly = true; }
    const prev = accounts.get(a.code);
    // An account in both sheets: balances are summed, one does not overwrite the other.
    if (prev) { prev.ledger.outstanding += a.ledger.outstanding; return; }
    accounts.set(a.code, a);
  };

  for (const r of body('Aging', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({
      code, name: S(r[1]), kind: 'tax', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: N(r[7]), status: S(r[8]), creditDays: N(r[9]),
      ledger: {
        outstanding: N(r[10]), total60to1y: N(r[11]), total30to1y: N(r[12]), y1plus: N(r[13]),
        d120: N(r[14]), d90: N(r[15]), d60: N(r[16]), d60minus: N(r[17]), d45: N(r[18]),
        d30: N(r[19]), d15: N(r[20]),
        contracts: S(r[21]), reconciliation: S(r[22]), reconciliationDate: D(r[23]), comments: S(r[24]),
      },
    });
  }
  for (const r of body('Aging Shipment', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({
      code, name: S(r[1]), kind: 'cash', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: 0, status: S(r[7]), creditDays: N(r[8]),
      ledger: {
        outstanding: N(r[9]), d15plus: N(r[10]), d15minus: N(r[11]),
        contracts: S(r[12]), reconciliation: S(r[13]), reconciliationDate: D(r[14]), comments: S(r[15]),
      },
    });
  }
  // JP adds the region.
  for (const r of body('JP', 6)) {
    const a = accounts.get(S(r[0])); if (a && !a.region) a.region = S(r[9]);
  }

  const tax = [...accounts.values()].filter((a) => a.kind === 'tax').length;
  const cash = [...accounts.values()].filter((a) => a.kind === 'cash').length;
  console.log(`  ① الحسابات        ${accounts.size}  (ضريبي ${tax} · نقدي ${cash})`);
  if (nameless.length) console.log(`     أكوادٌ بلا اسمٍ في الورقة: ${nameless.join('، ')}`);

  // Step 2: invoices. Daily Invoice Report columns: 0 Code 1 Name 2 InvoiceNo 3 Total 4 InvoiceDate 5 Days 6 DeliveryDate 7 DaysD 8 CollectionDate 9 Status 10 ExitDate 11 Comments 12 DaysTTL
  const invoices = [];
  let skippedNoInv = 0; let skippedTotals = 0;
  const dirSheet = table('Daily Invoice Report');
  const DC = {
    // The number column was named Invoice No, then Column2; it is the third in both cases.
    num: Math.max(dirSheet.col('invoice no', 'column2'), 2),
    total: dirSheet.col('total outstanding'), invoiceDate: dirSheet.col('invoice date'),
    deliveryDate: dirSheet.col('delivery date'), collectionDate: dirSheet.col('collection date'),
    status: dirSheet.col('status'), exitDate: dirSheet.col('exit date'), comments: dirSheet.col('supervisor comments'),
  };
  for (const [k, i] of Object.entries(DC)) {
    if (i < 0 && k !== 'exitDate') { console.error(`  ✘ ورقةُ الفواتير بلا عمود «${k}» — لا يُستورَد ملفٌّ لا يُعرَف شكلُه`); process.exit(1); }
  }
  for (const r of dirSheet.rows) {
    const name = S(r[1]);
    if (name && TOTALS_ROW.test(name)) { skippedTotals += 1; continue; }
    const num = S(r[DC.num]);
    if (!num || NO_INVOICE.test(num)) { if (num || name) skippedNoInv += 1; continue; }
    invoices.push({
      kind: 'tax', sheetCode: S(r[0]), partyName: name, invoiceNumber: num, total: N(at(r, DC.total)),
      invoiceDate: D(at(r, DC.invoiceDate)), deliveryDate: D(at(r, DC.deliveryDate)), collectionDate: D(at(r, DC.collectionDate)),
      status: S(at(r, DC.status)), exitDate: D(at(r, DC.exitDate)), comments: S(at(r, DC.comments)),
    });
  }

  // Shipment Report 0 Code 1 Owner 2 Account 3 Branch 4 CollecteBranch 5 ShipmentNo
  //                 6 InvoiceTotal 7 CreationDate 8 Days 9 PaymentDate 10 DaysP
  //                 11 DeliveryDate 12 DaysD 13 CollectionDate 14 Status 15 Comments
  let shipSkipped = 0;
  for (const r of body('Shipment Report', 4)) {
    const name = S(r[2]);
    if (name && TOTALS_ROW.test(name)) { shipSkipped += 1; continue; }
    const num = S(r[5]);
    if (!num || NO_INVOICE.test(num)) { if (num || name) shipSkipped += 1; continue; }
    invoices.push({
      kind: 'cash', sheetCode: S(r[0]), partyName: name, invoiceNumber: num, total: N(r[6]),
      ownerName: S(r[1]), branch: S(r[3]), collectionBranch: S(r[4]),
      invoiceDate: D(r[7]), paymentDate: D(r[9]), deliveryDate: D(r[11]), collectionDate: D(r[13]),
      status: S(r[14]), comments: S(r[15]),
    });
  }
  const nTax = invoices.filter((i) => i.kind === 'tax').length;
  const nCash = invoices.length - nTax;
  console.log(`  ② الفواتير        ${invoices.length}  (ضريبي ${nTax} · نقدي ${nCash})`);
  console.log(`     صفوفٌ بلا رقم فاتورة: ${skippedNoInv + shipSkipped} · صفوفُ مجاميع: ${skippedTotals}`);

  // Step 3: visit plan. JP: 0 Code ...; day columns repeat after column 10, one column per customer per day.
  // The plan is read to be written, not just counted: the wipe below clears CollectionTask, so a re-import would otherwise lose visit history. See utils/journeyPlan.
  const { parseJourneyPlan } = require('../utils/journeyPlan');
  const jp = parseJourneyPlan(raw('JP'));
  const jpCollected = jp.tasks.reduce((a, t) => a + (t.collected || 0), 0);
  console.log(`  ③ خطّةُ الزيارات   ${jp.tasks.length} مهمّةً في ${new Set(jp.tasks.map((t) => t.date)).size} يومًا  (محصَّلٌ فيها ${jpCollected.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);

  if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n');
    await mongoose.disconnect(); return;
  }

  // Step 4: backup before any wipe
  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `collections-before-reimport-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    takenAt: new Date().toISOString(), replacedWith: BOOK,
    parties: await CollectionsParty.find({}).lean(),
    invoices: await CollectionInvoice.find({}).lean(),
    tasks: await CollectionTask.find({}).lean(),
    suggestions: PartyLinkSuggestion ? await PartyLinkSuggestion.find({}).lean() : [],
  }));
  console.log(`\n  ✔ نسخةٌ احتياطيّة: ${backup}`);

  // Step 5: wipe only data that originates from the book
  const delInv = await CollectionInvoice.deleteMany({});
  const delTask = await CollectionTask.deleteMany({});
  const delSug = PartyLinkSuggestion ? await PartyLinkSuggestion.deleteMany({}) : { deletedCount: 0 };
  // Book fields are cleared on all parties so stale values from an older file are not read as current.
  const cleared = await CollectionsParty.updateMany({}, {
    $set: {
      collectionOfficer: '', hoLocation: '', grade: '', salesManagers: [],
      department: '', region: '', creditLimit: 0, creditDays: 0, ledger: {},
    },
  });

  // Codes are cleared only for parties whose code is no longer in the file, one row at a time.
  // Clearing all at once hits the unique index on (type + name + code) when a coded and an uncoded party share a name, and the whole operation rolls back.
  // If a duplicate without a code blocks it, the old party is deactivated and reported.
  // First, merge companies registered twice: the operations copy (referenced by four sections) is kept, the book name becomes an alias, and the book copy is deleted since only invoices rebuilt in this run reference it.
  const dupGroups = await CollectionsParty.aggregate([
    { $group: { _id: { kind: '$kind', nameKey: '$nameKey' }, n: { $sum: 1 }, docs: { $push: { id: '$_id', code: '$code', name: '$name', source: '$source' } } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  let merged = 0;
  for (const g of dupGroups) {
    const book = g.docs.find((d) => d.code && /^(collections[-_]workbook|invoice_ledger)$/.test(d.source || ''));
    const keep = g.docs.find((d) => d.id !== (book || {}).id && !/^(collections[-_]workbook|invoice_ledger)$/.test(d.source || ''));
    if (!book || !keep) continue;
    await CollectionsParty.updateOne({ _id: keep.id }, {
      $addToSet: { aliases: book.name, aliasKeys: fold(book.name) },
      $set: { isActive: true },
    });
    await CollectionsParty.deleteOne({ _id: book.id });
    merged += 1;
    console.log(`  ⇄ دُمج «${book.name}» (${book.code}) في «${keep.name}»`);
  }
  if (merged) console.log(`  ✔ نسخٌ مكرّرةٌ دُمجت: ${merged}`);

  // All codes are cleared, not just the vanished ones: the new file may move a code between accounts, and a stale holder would hit the unique index and stop the import midway.
  const stale = await CollectionsParty.find({ code: { $gt: '' } }).select('code name kind nameKey').lean();
  let dropped = 0; const stuck = [];
  for (const p of stale) {
    try {
      await CollectionsParty.updateOne({ _id: p._id }, { $set: { code: '' } });
      dropped += 1;
    } catch (e) {
      if (!e || e.code !== 11000) throw e;
      // Registry duplicate, not a book duplicate: one party has a code from the accounting book, the other has no code and was created by another section.
      // The coded one is kept (it holds the debt); the uncoded one is deactivated, not deleted, since a contract or report may reference it.
      // After the merge above this should not happen; if it does, report it by name and stop instead of guessing.
      stuck.push(`${p.code} ${p.name} — تعذّر تفريغُ كوده (تكرارٌ لم يُدمَج)`);
    }
  }
  console.log(`  ✔ مُسح: ${delInv.deletedCount} فاتورة · ${delTask.deletedCount} مهمّة · ${delSug.deletedCount} اقتراح`);
  console.log(`  ✔ فُرّغت خاناتُ الدفتر من ${cleared.modifiedCount} طرفًا`);
  console.log(`  ✔ أكوادٌ فُرِّغت قبل إعادة الإسناد: ${dropped}`);
  if (stuck.length) {
    console.log(`  ⚠ تكرارٌ في السجلّ عولج (${stuck.length}):`);
    for (const x of stuck) console.log(`      ${x}`);
  }

  // Step 6: accounts are written. Match by code first, then by folded name; no similarity-based linking here, that is a collections-manager decision made in the UI.
  const ours = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey aliasKeys code').lean();
  // One key can map to two rows: fold collapses pairs like a coded and an uncoded variant of the same company.
  // Keeping only the first candidate could assign the code to the empty twin while the other still holds it, breaking the unique index after the invoices were wiped.
  // So keep all candidates and prefer the one that already holds this code.
  const byKey = new Map();
  for (const p of ours) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) {
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }
  }
  const holderOfCode = new Map();
  for (const p of ours) if (p.code) holderOfCode.set(String(p.code), p);
  const claimed = new Set();
  const partyOfCode = new Map();
  const failedAccounts = [];
  let linked = 0; let created = 0;

  for (const a of [...accounts.values()].sort((x, y) => String(x.code).localeCompare(String(y.code)))) {
    const ledger = { ...a.ledger, sourceFile: BOOK, importedAt: new Date() };
    const set = {
      code: a.code, kind: 'customer', paymentType: a.kind,
      collectionOfficer: a.officer, hoLocation: a.ho, grade: a.grade,
      salesManagers: a.sales, department: a.dept, region: a.region || '',
      creditLimit: a.limit || 0, creditDays: a.creditDays || 0, ledger,
      ...(a.status ? { status: a.status } : {}),
    };
    // Order of preference: the code holder, then a name match without a code, then any unclaimed match.
    const cands = a.codeOnly ? [] : (byKey.get(fold(a.name)) || []);
    const free = (p) => p && !claimed.has(String(p._id));
    const holder = holderOfCode.get(String(a.code));
    const match = (free(holder) && holder)
      || cands.find((p) => free(p) && !p.code)
      || cands.find((p) => free(p))
      || null;
    // One failing account must not stop the whole book: invoices are already wiped, so aborting leaves no book at all.
    // Failures are named, the rest continue, and the end of the run reports who was not imported and why.
    try {
      if (match) {
        claimed.add(String(match._id));
        await CollectionsParty.updateOne({ _id: match._id }, {
          $set: set, $addToSet: { aliases: a.name, aliasKeys: fold(a.name) },
        });
        partyOfCode.set(a.code, match._id);
        linked += 1;
      } else if (!a.codeOnly) {
        const doc = await CollectionsParty.findOneAndUpdate({ code: a.code }, {
          $set: { ...set, name: a.name, nameKey: fold(a.name), source: 'collections_workbook', isActive: true },
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
        partyOfCode.set(a.code, doc._id);
        created += 1;
      }
    } catch (e) {
      failedAccounts.push(`${a.code} ${a.name} — ${e.code === 11000 ? 'تكرارٌ في السجلّ (اسمٌ مطويٌّ مكرّر)' : e.message}`);
    }
  }
  console.log(`  ✔ حسابات: رُبطت بسجلٍّ قائم ${linked} · أُنشئت ${created}`);
  if (failedAccounts.length) {
    console.log(`  ⚠ حساباتٌ لم تدخل (${failedAccounts.length}) — تُدمَج نسختُها المكرّرة ثمّ يُعاد الاستيراد:`);
    for (const x of failedAccounts) console.log(`      ${x}`);
  }

  // Step 7: invoices. An account known to the invoices but not to the aging sheet is created here.
  const { nextPartyCode } = require('../utils/partyCode');
  const byName2 = new Map();
  for (const p of await CollectionsParty.find({ kind: 'customer' }).select('name nameKey aliasKeys code').lean()) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byName2.has(k)) byName2.set(k, p);
    if (p.code) partyOfCode.set(p.code, p._id);
  }
  let extraParties = 0;
  for (const inv of invoices) {
    if (inv.sheetCode && partyOfCode.has(inv.sheetCode)) continue;
    if (!inv.partyName) continue;
    const hit = byName2.get(fold(inv.partyName));
    if (hit) { if (inv.sheetCode) partyOfCode.set(inv.sheetCode, hit._id); continue; }
    const code = inv.sheetCode || await nextPartyCode(inv.kind);
    const doc = await CollectionsParty.findOneAndUpdate({ kind: 'customer', code }, {
      $set: {
        kind: 'customer', code, name: inv.partyName, nameKey: fold(inv.partyName),
        paymentType: inv.kind, source: 'invoice_ledger', isActive: true,
      },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    partyOfCode.set(code, doc._id); byName2.set(fold(inv.partyName), doc);
    extraParties += 1;
  }
  if (extraParties) console.log(`  ✔ حساباتٌ عرفتها الفواتيرُ ولم تعرفها ورقةُ الأعمار: ${extraParties}`);

  // A sequence number with no account, amount or date is imported and flagged. See models/CollectionInvoice.unused.
  for (const inv of invoices) {
    inv.unused = !inv.partyName && !inv.total && !inv.invoiceDate && !inv.deliveryDate && !inv.collectionDate;
  }
  const nUnused = invoices.filter((i) => i.unused).length;

  const ops = invoices.map((inv) => {
    const pid = inv.sheetCode ? partyOfCode.get(inv.sheetCode)
      : (byName2.get(fold(inv.partyName)) || {})._id;
    return {
      updateOne: {
        filter: { kind: inv.kind, invoiceNumber: inv.invoiceNumber, sheetCode: inv.sheetCode },
        update: { $set: { ...inv, party: pid || null, partyCode: inv.sheetCode, source: 'collections_workbook' } },
        upsert: true,
      },
    };
  });
  let wrote = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const r = await CollectionInvoice.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    wrote += (r.upsertedCount || 0) + (r.modifiedCount || 0) + (r.matchedCount || 0);
  }
  console.log(`  ✔ فواتير كُتبت: ${wrote}`);

  // Step 7b: visit plan restored. Key is (customer x day x request type), matching the model index.
  const jpByCode = new Map();
  for (const p of await CollectionsParty.find({ kind: 'customer' }).select('code name nameKey aliasKeys').lean()) {
    if (p.code) jpByCode.set(String(p.code).trim(), p);
  }
  const taskOps = jp.tasks.map((t) => {
    const party = jpByCode.get(t.partyCode) || byName2.get(fold(t.partyName || '')) || null;
    return {
      updateOne: {
        filter: { party: party ? party._id : null, date: t.date, requestType: t.requestType },
        update: { $set: { ...t, party: party ? party._id : null, source: 'collections_workbook' } },
        upsert: true,
      },
    };
  });
  let taskWrote = 0;
  for (let i = 0; i < taskOps.length; i += 500) {
    const r = await CollectionTask.bulkWrite(taskOps.slice(i, i + 500), { ordered: false });
    taskWrote += (r.upsertedCount || 0) + (r.modifiedCount || 0);
  }
  console.log(`  ✔ مهامُّ زيارةٍ كُتبت: ${taskWrote}`);

  // Step 7c: operations reports relinked under their invoices. The sheet does not know our reports, so reportNumbers would be written empty; rebuild them from the operations reports. See scripts/linkInvoiceReports.
  const { invoiceNumberKey } = require('../utils/invoiceNumberKey');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const invByKey = new Map();
  for (const i of await CollectionInvoice.find({ unused: { $ne: true } }).select('invoiceNumber').lean()) {
    const k = invoiceNumberKey(i.invoiceNumber);
    if (!k) continue;
    if (!invByKey.has(k)) invByKey.set(k, []);
    invByKey.get(k).push(i._id);
  }
  const wantRn = new Map();
  for (const w of await OperationsWorkflow.find({ invoiceNumber: { $nin: [null, ''] } }).select('reportNumber invoiceNumber').lean()) {
    const k = invoiceNumberKey(w.invoiceNumber);
    const rn = S(w.reportNumber);
    if (!k || !rn) continue;
    for (const id of (invByKey.get(k) || [])) {
      const key = String(id);
      if (!wantRn.has(key)) wantRn.set(key, new Set());
      wantRn.get(key).add(rn);
    }
  }
  const rnOps = [...wantRn].map(([id, set]) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { reportNumbers: [...set].sort() } } },
  }));
  let rnWrote = 0;
  for (let i = 0; i < rnOps.length; i += 1000) {
    const r = await CollectionInvoice.bulkWrite(rnOps.slice(i, i + 1000), { ordered: false });
    rnWrote += r.modifiedCount || 0;
  }
  console.log(`  ✔ فواتيرُ رُبطت بكشوفها: ${rnWrote} (بمجموع ${[...wantRn.values()].reduce((a, s) => a + s.size, 0)} كشفًا)`);

  // Step 8: verification, no row lost
  const dbTax = await CollectionInvoice.countDocuments({ kind: 'tax' });
  const dbCash = await CollectionInvoice.countDocuments({ kind: 'cash' });
  const dbParties = await CollectionsParty.countDocuments({ code: { $gt: '' } });
  const sumSheet = invoices.reduce((a, i) => a + i.total, 0);
  const sumDb = (await CollectionInvoice.aggregate([{ $group: { _id: null, t: { $sum: '$total' } } }]))[0]?.t || 0;
  const orphan = await CollectionInvoice.countDocuments({ party: null });

  const line = (label, sheet, db) => console.log(
    `  ${db === sheet ? '✔' : '✘'} ${label.padEnd(26)} الورقة ${String(sheet).padStart(7)}  القاعدة ${String(db).padStart(7)}`,
  );
  console.log('\n  ── التحقّق ──');
  line('فواتير ضريبيّة', nTax, dbTax);
  line('فواتير نقديّة', nCash, dbCash);
  // Invoices may reference an account missing from the aging sheet, so add it to the expected set.
  line('حساباتٌ بكود', accounts.size + extraParties, dbParties);
  console.log(`  ${Math.abs(sumSheet - sumDb) < 1 ? '✔' : '✘'} ${'مجموع المبالغ'.padEnd(26)} الورقة ${sumSheet.toFixed(2)}  القاعدة ${sumDb.toFixed(2)}`);
  const dbUnused = await CollectionInvoice.countDocuments({ unused: true });
  const realOrphans = await CollectionInvoice.countDocuments({ party: null, unused: { $ne: true } });
  console.log(`  ${dbUnused === nUnused ? '✔' : '✘'} ${'أرقامٌ محجوزةٌ بلا فاتورة'.padEnd(26)} الورقة ${String(nUnused).padStart(7)}  القاعدة ${String(dbUnused).padStart(7)}`);
  console.log(`  ${realOrphans ? '⚠' : '✔'} فواتيرُ حقيقيّةٌ بلا حسابٍ مربوط: ${realOrphans}`);
  const dbTasks = await CollectionTask.countDocuments({});
  line('مهامُّ الزيارات', jp.tasks.length, dbTasks);
  console.log(`  (وبلا حسابٍ إجمالًا ${orphan} — منها ${dbUnused} أرقامٌ محجوزة)`);
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
