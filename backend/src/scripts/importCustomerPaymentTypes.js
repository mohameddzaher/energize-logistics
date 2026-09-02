/**
 * importCustomerPaymentTypes — نوعُ الدفع صفةُ العميل، تُقرأ من ملفّه.
 *
 *   node src/scripts/importCustomerPaymentTypes.js --dry
 *   node src/scripts/importCustomerPaymentTypes.js
 *
 * المصدر: «operation files/نوع الدفع للعملاء .xlsx» — عمودان: العميل، نوع الدفع.
 *
 * ── ولماذا على العميل لا على الكشف ─────────────────────────────────────────
 * عميلُ الكاش يدفع في يده دائمًا، والضريبيُّ يُفوتَر دائمًا. فاختيارُ النوع في
 * كلّ كشفٍ على حدة عملٌ مكرَّرٌ يُنسى ويُخطأ — وخطأٌ واحدٌ يُرسل كشفَ عميلٍ
 * ضريبيّ إلى فواتير الكاش. يُكتب على الملفّ مرّةً، ويُقرأ منه عند كلّ سداد.
 *
 * ── والمطابقةُ بالاسم المطويّ ──────────────────────────────────────────────
 * الاسمُ في الشيت يُكتب بصيغةٍ وفي الكشوف بأخرى — همزةٌ، تاءٌ مربوطة، مسافةٌ
 * زائدة. فيُطابَق بالمفتاح المطويّ نفسِه الذي يجمع صفوفَ الطرف الواحد.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '..', '..', '..', 'operation files', 'نوع الدفع للعملاء .xlsx');

// «cash» و«ضريبي» كما كُتبا في الشيت، ومعهما ما يُحتمل من صياغات.
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

  // الاسمُ الواحد قد يتكرّر في الشيت — يُطوى قبل الكتابة فلا يُكتب مرّتين.
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

  // مَن في الشيت وليس في السجلّ يُضاف: الشيتُ يقول إنّه عميلٌ لنا.
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
