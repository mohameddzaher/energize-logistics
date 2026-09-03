/**
 * importCollectionInvoices — دفترُ الفواتير من ورقة «Daily Invoice Report».
 *
 *   node --max-old-space-size=8192 src/scripts/importCollectionInvoices.js --dry
 *   node --max-old-space-size=8192 src/scripts/importCollectionInvoices.js
 *
 * الأعمدة: Code · Account name · Invoice No · Total Outstanding · Invoice Date
 *          Days · Delivery Date · Days D · Collection Date · Status · Exit Date
 *          Supervisor Comments · Days TTL
 *
 * ── والأيّامُ لا تُستورَد ───────────────────────────────────────────────────
 * أعمدةُ `Days` في الورقة فروقُ تواريخَ محسوبةٌ بمعادلة، وقيمتُها صحيحةٌ يومَ
 * حُفظ الملفّ فقط. تُترك وتُحسب عند القراءة من التواريخ الثلاثة — فلا يبقى في
 * القاعدة رقمٌ يشيخ.
 *
 * ── والربطُ بكشوف التشغيل حيث وُجد ─────────────────────────────────────────
 * من تسعة آلافٍ وثلاثمئة رقمِ فاتورةٍ في الدفتر، خمسُمئةٍ وسبعٌ وخمسون لها
 * كشوفٌ عندنا. تُربط، ويبقى الباقي فواتيرَ قائمةً بنفسها — وهي أكثرُ العمل.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '../../..', 'collection files', 'Financial Collections    9-2026.xlsx');
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const D = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return new Date(XLS_EPOCH + Math.round(v * 86400000));
  return null;
};
// ما يعني «لا فاتورة» ليس رقمَ فاتورة — النصُّ نفسُه الذي تستثنيه الصفحات.
const NO_INVOICE = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|0|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const OW = require('../models/OperationsWorkflow');
  const { fold } = CollectionsParty;

  // «الإجمالي» ليس عميلًا — صفُّ مجموعٍ في الورقة.
  const TOTALS_ROW = /^\s*(?:الإجمالي|الاجمالي|المجموع|total|grand\s*total)\s*$/i;
  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'],
    { header: 1, defval: null, blankrows: false, raw: true }).slice(6);
  console.log(`صفوفُ الورقة: ${rows.length}`);

  const parties = await CollectionsParty.find({ kind: 'customer' })
    .select('code name nameKey aliasKeys paymentType').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [p.code, p]));
  const byName = new Map();
  for (const p of parties) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byName.has(k)) byName.set(k, p);
  }

  // ── حساباتٌ يعرفها دفترُ الفواتير ولا يعرفها سجلُّ الأعمار ────────────────
  // اثنا عشر حسابًا. أحدُها ١١٠٤٠٢٧٣: كودُه في ورقة الأعمار بلا اسمِ حساب،
  // واسمُه هنا مكتوبٌ على ثلاثةٍ وأربعين فاتورة. فيُكمَل من هنا بدل أن يبقى
  // كودًا بلا صاحب. وما لا كودَ له يأخذ التاليَ في سلسلة نوعه.
  //
  // و«الإجمالي» ليس عميلًا — صفُّ مجموعٍ في الورقة. يُستثنى بالاسم لأنّه
  // بالاسم يُعرَف؛ ولو أُنشئ حسابًا لظهر في كلّ قائمةٍ ولحمل مديونيّةَ الجميع.
  {
    const { nextPartyCode } = require('../utils/partyCode');
    const unknown = new Map();
    for (const r of rows) {
      const code = S(r[0]); const name = S(r[1]);
      if (!name || TOTALS_ROW.test(name)) continue;
      if (byCode.get(code) || byName.get(fold(name))) continue;
      const k = code || fold(name);
      if (!unknown.has(k)) unknown.set(k, { code, name });
    }
    if (unknown.size) {
      console.log(`حساباتٌ في دفتر الفواتير وليست في سجلّ الأعمار: ${unknown.size}`);
      for (const u of unknown.values()) {
        const code = u.code || (DRY ? '(يُولَّد)' : await nextPartyCode('tax'));
        console.log(`   ${code}  ${u.name}`);
        if (DRY) continue;
        const doc = await CollectionsParty.findOneAndUpdate(
          { kind: 'customer', code },
          { $set: { kind: 'customer', code, name: u.name, nameKey: fold(u.name), paymentType: 'tax', source: 'invoice_ledger' } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        byCode.set(code, doc); byName.set(fold(u.name), doc);
      }
      console.log('');
    }
  }

  const invoices = new Map();          // `${kind}::${number}` → doc
  let noNumber = 0; let noParty = 0; const unknownCodes = new Set();
  for (const r of rows) {
    const number = S(r[2]);
    if (!number || NO_INVOICE.test(number)) { noNumber += 1; continue; }
    const code = S(r[0]);
    const name = S(r[1]);
    if (TOTALS_ROW.test(name)) continue;               // صفُّ مجموعٍ لا فاتورة
    const party = byCode.get(code) || byName.get(fold(name));
    if (!party) { noParty += 1; if (code) unknownCodes.add(code); }
    const kind = party?.paymentType === 'cash' ? 'cash' : (/^C/i.test(code) ? 'cash' : 'tax');
    // ── والحسابُ جزءٌ من المفتاح، وهو **كودُ الورقة** لا كودُنا ────────────
    //
    // الصفوفُ السالبة تسوياتٌ لا فواتير، وترقيمُها لكلّ حسابٍ على حدة: شركةُ
    // فكر لها ‎-14‎ وشركةُ صليهم لها ‎-14‎ أخرى. وبالرقم وحدَه اندمجتا في سجلٍّ
    // واحدٍ بمجموعهما ونُسبتا إلى حسابٍ واحد.
    //
    // والكودُ المستعمَل هنا هو المكتوبُ في الورقة لا الذي نستنتجه: صفوفٌ بلا
    // كودٍ يُطابَق حسابُها بالاسم، وإن لم يوجد وُلِّد له كودٌ جديد — ورقمُ المولَّد
    // يختلف بين تشغيلٍ وآخر، فيصير المفتاحُ متحرّكًا وتتضاعف الفاتورةُ نفسُها
    // بكودين. حدث ذلك: سبعُ فواتيرَ منها ‎5899‎ مرّتين بكودين مولَّدين.
    const key = `${kind}::${number}::${code}`;

    const doc = {
      invoiceNumber: number, kind, sheetCode: code,
      party: party?._id, partyCode: code || party?.code || '', partyName: name || party?.name || '',
      total: N(r[3]),
      invoiceDate: D(r[4]), deliveryDate: D(r[6]), collectionDate: D(r[8]), exitDate: D(r[10]),
      status: S(r[9]), comments: S(r[11]), source: 'collections_workbook',
    };
    const prev = invoices.get(key);
    if (!prev) { invoices.set(key, doc); continue; }
    // الرقمُ الواحد في أكثرَ من صفّ: تُجمَع مبالغُه ويُؤخذ أحدثُ ما يُعرف.
    prev.total += doc.total;
    for (const f of ['invoiceDate', 'deliveryDate', 'collectionDate', 'exitDate']) if (!prev[f] && doc[f]) prev[f] = doc[f];
    if (!prev.status && doc.status) prev.status = doc.status;
    if (doc.comments && !prev.comments.includes(doc.comments)) prev.comments = [prev.comments, doc.comments].filter(Boolean).join(' · ');
  }
  // ── ورقمُ فاتورةٍ وحدَه ليس فاتورة ──────────────────────────────────────
  // ثلاثُمئةٍ وثمانيةٌ وتسعون صفًّا فيها رقمٌ ولا شيءَ غيرُه: لا حسابَ ولا مبلغَ
  // ولا تاريخَ ولا حالة — أرقامٌ محجوزةٌ أو ملغاة. إدخالُها يضخّم السجلَّ
  // بأربعمئة فاتورةٍ لا مالَ فيها ولا صاحبَ لها، فتُحسب في العدد ولا تُقرأ.
  let hollow = 0;
  for (const [k, d] of invoices) {
    if (!d.party && !d.total && !d.invoiceDate && !d.deliveryDate && !d.collectionDate && !d.comments) {
      invoices.delete(k); hollow += 1;
    }
  }

  console.log(`  صفوفٌ بلا رقم فاتورةٍ صالح (تُترك): ${noNumber}`);
  console.log(`  أرقامٌ بلا حسابٍ ولا مبلغٍ ولا تاريخ (تُترك): ${hollow}`);
  console.log(`  صفوفٌ لم يُعرَف حسابُها: ${noParty}${unknownCodes.size ? ` (أكواد: ${[...unknownCodes].slice(0, 6).join('، ')}${unknownCodes.size > 6 ? ' …' : ''})` : ''}`);
  console.log(`  فواتيرُ مميَّزة: ${invoices.size}`);

  const byKind = {}; let sum = 0; let outstanding = 0;
  for (const d of invoices.values()) {
    byKind[d.kind] = (byKind[d.kind] || 0) + 1;
    sum += d.total;
    if (d.status !== 'Collected') outstanding += d.total;
  }
  console.log(`    ضريبيّة ${byKind.tax || 0} · نقديّة ${byKind.cash || 0}`);
  console.log(`    إجماليُّ المبالغ: ${sum.toFixed(2)} · غيرُ المحصَّل: ${outstanding.toFixed(2)}`);

  // ── كشوفُ التشغيل تحت فواتيرها ──────────────────────────────────────────
  const numbers = [...new Set([...invoices.values()].map((d) => d.invoiceNumber))];
  const linkMap = new Map();
  for (let i = 0; i < numbers.length; i += 1000) {
    const part = await OW.find({ invoiceNumber: { $in: numbers.slice(i, i + 1000) } })
      .select('invoiceNumber reportNumber').lean();
    for (const w of part) {
      const k = String(w.invoiceNumber).trim();
      if (!linkMap.has(k)) linkMap.set(k, []);
      if (w.reportNumber) linkMap.get(k).push(w.reportNumber);
    }
  }
  let linked = 0;
  for (const d of invoices.values()) {
    const rn = linkMap.get(d.invoiceNumber);
    if (rn?.length) { d.reportNumbers = [...new Set(rn)]; linked += 1; }
  }
  console.log(`  فواتيرُ لها كشوفٌ عندنا: ${linked}/${invoices.size}`);

  if (DRY) { console.log('\n— تجربةٌ فقط —\n'); await mongoose.disconnect(); return; }

  const ops = [...invoices.values()].map((d) => ({
    updateOne: { filter: { kind: d.kind, invoiceNumber: d.invoiceNumber, sheetCode: d.sheetCode }, update: { $set: d }, upsert: true },
  }));
  let done = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await CollectionInvoice.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    done += (r.upsertedCount || 0) + (r.modifiedCount || 0);
    process.stdout.write(`\r  كُتب ${Math.min(i + 500, ops.length)}/${ops.length}…`);
  }
  console.log(`\n✓ فواتيرُ في السجلّ: ${await CollectionInvoice.countDocuments()}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
