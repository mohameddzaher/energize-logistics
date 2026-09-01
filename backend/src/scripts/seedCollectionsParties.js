/**
 * seedCollectionsParties — يبني سجلَّي العملاء والموردين لقسم التحصيل من
 * البيانات الموجودة في النظام فعلًا، لا من ملفٍّ يُستورَد.
 *
 *   node src/scripts/seedCollectionsParties.js            تنفيذ
 *   node src/scripts/seedCollectionsParties.js --dry      يقول ماذا سيفعل ولا يكتب
 *
 * ── من أين ─────────────────────────────────────────────────────────────────
 * الأصلُ كشوفُ سير عمل التشغيل: منها يُعرَف مَن نتعامل معه فعلًا وكم له وكم
 * عليه. ثمّ تُثرى السجلّاتُ من بقيّة سجلّات الشركة — أرقامُ التواصل والسجلُّ
 * التجاريّ والآيبان لا وجودَ لها في الكشف، وهي ما يحتاجه من يلاحق فاتورة.
 *
 * ── والتكرار يُطوى قبل الكتابة ─────────────────────────────────────────────
 * الاسمُ الواحدُ يُكتب في كلّ سجلٍّ بصيغة: همزةٌ هنا وتاءٌ مربوطةٌ هناك، و«چ»
 * مكانَ «ج». ولو كُتب كلٌّ منها صفًّا لصار أكبرُ موردٍ عندنا أربعةَ موردين، وهو
 * العطلُ نفسُه الذي كان يقسم «شركة تنشيط للخدمات اللوجستية» صفّين في التحليلات.
 *
 * ── ولا يُدهَس ما صُحِّح على الشاشة ────────────────────────────────────────
 * السكربتُ يملأ الفارغَ ولا يكتب فوق قيمةٍ قائمة. فمَن صحّح رقمَ جوّالٍ بيده
 * يجده كما تركه بعد إعادة التشغيل — وإعادتُه مرّةً أخرى لا تغيّر شيئًا.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CollectionsParty = require('../models/CollectionsParty');
const { fold } = require('../models/CollectionsParty');

const DRY = process.argv.includes('--dry');

const s = (v) => String(v == null ? '' : v).trim();

// بريدٌ مولَّدٌ آليًّا ليس بريدًا: `driver_…@temp.local` و`user_350@migrated.upl.com`
// عناوينُ اخترعتها المنصّةُ لتمرّ من التحقّق، ولا أحدَ يقرؤها. تخزينُها في سجلّ
// تحصيلٍ يعني أن يُرسَل إليها طلبُ سدادٍ يومًا. غيابُ القيمة ليس قيمة.
const PLACEHOLDER_EMAIL = /@(temp\.local|migrated\.upl\.com|example\.com|test\.com)$/i;
const cleanEmail = (v) => {
  const e = s(v).toLowerCase();
  return !e || PLACEHOLDER_EMAIL.test(e) ? '' : e;
};

// الاسمُ الذي لا يُميّز طرفًا لا يصير سجلًّا: «-» و«غير معروف» و«null» وصفوفُ
// الاختبار. وتحتها ثلاثةُ أحرفٍ لا يُبنى عليها ملفُّ عميل.
const JUNK = new Set(['-', '—', 'na', 'n/a', 'null', 'undefined', 'غير معروف', 'بدون', 'test', 'لا يوجد']);
const usableName = (v) => {
  const n = s(v);
  if (!n || n.length < 3) return false;
  if (JUNK.has(n.toLowerCase())) return false;
  if (/^__.*__/.test(n)) return false; // صفوفُ فحوصِ CRUD
  return true;
};

/** سجلٌّ واحدٌ في الخريطة، يُملأ فارغُه ولا يُكتب فوق مملوئه. */
function upsertLocal(map, name, patch, source) {
  if (!usableName(name)) return;
  const key = fold(name);
  if (!key) return;
  let e = map.get(key);
  if (!e) {
    e = { nameKey: key, names: new Map(), sources: new Set(), data: {} };
    map.set(key, e);
  }
  e.names.set(s(name), (e.names.get(s(name)) || 0) + (patch.__weight || 1));
  e.sources.add(source);
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__weight') continue;
    const val = typeof v === 'number' ? v : s(v);
    if (val === '' || val === 0 || val == null) continue;
    if (e.data[k] === undefined || e.data[k] === '' ) e.data[k] = val;
  }
}

async function build(db) {
  const customers = new Map();
  const suppliers = new Map();
  const W = db.collection('operationsworkflows');

  // ── ١ · الكشوف: مَن نتعامل معه فعلًا ────────────────────────────────────
  // الوزنُ عددُ الكشوف، وهو ما يجعل الاسمَ المعروضَ أكثرَ الكتابتين ورودًا لا
  // أوّلَها صدفةً.
  const custRows = await W.aggregate([
    { $match: { username: { $nin: [null, ''] } } },
    { $group: { _id: '$username', n: { $sum: 1 }, phone: { $last: '$userPhone' } } },
  ]).toArray();
  for (const r of custRows) upsertLocal(customers, r._id, { phone: r.phone, __weight: r.n }, 'operations_workflow');

  const suppRows = await W.aggregate([
    { $match: { carOwner: { $nin: [null, ''] } } },
    { $group: { _id: '$carOwner', n: { $sum: 1 }, phone: { $last: '$ownerPhone' } } },
  ]).toArray();
  for (const r of suppRows) upsertLocal(suppliers, r._id, { phone: r.phone, __weight: r.n }, 'operations_workflow');

  // ── ٢ · عملاءُ طلبات الشحنات والأسطول وإدارة العلاقات ────────────────────
  for (const r of await db.collection('shipmentordercustomers').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone, email: cleanEmail(r.email), partyType: r.customerType === 'individual' ? '' : '' }, 'shipment_orders');
  }
  for (const r of await db.collection('fleetcustomers').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone, email: cleanEmail(r.email), paymentTerms: '' }, 'fleet');
  }
  for (const r of await db.collection('crmcompanies').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone || r.whatsapp, email: cleanEmail(r.email) }, 'crm');
  }

  // ── ٣ · الموردون: المنصّةُ تحمل الهويّةَ التجاريّة والحسابَ البنكيّ ───────
  // وهي ما يحتاجه مَن يسدّد: التحويلُ يحتاج آيبان، والفاتورةُ تحتاج رقمًا
  // ضريبيًّا، ومناقشةُ سندٍ تحتاج محاسبَ المورّد لا مالكَه.
  for (const r of await db.collection('shipmentordersuppliers').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.phone || r.ownerPhone,
      email: cleanEmail(r.email),
      contactPerson: r.managerName || r.ownerName,
      contactPhone: r.managerPhone || r.ownerPhone,
      accountantName: r.accountantName,
      accountantPhone: r.accountantPhone,
      commercialRegister: r.commercialRegister,
      taxNumber: r.taxCard,
      iban: r.iban,
      bankName: r.bankName,
      address: r.nationalAddress,
      paymentTerms: r.paymentTerms,
    }, 'shipment_orders');
  }
  for (const r of await db.collection('contractvendors').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.phone,
      contactPerson: r.contactPerson,
      commercialRegister: r.crNumber,
      city: r.headquarters,
      paymentTerms: r.paymentTermDays ? `net_${r.paymentTermDays}` : '',
    }, 'contracts');
  }
  for (const r of await db.collection('crmvendors').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.mobile,
      contactPerson: r.representative,
      city: r.headOffice,
      partyType: r.vendorType,
    }, 'crm');
  }

  return { customers, suppliers };
}

/** الاسمُ المعروض: أكثرُ الكتابتين ورودًا. */
const bestName = (names) => [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];

/**
 * الكتابةُ رحلةٌ واحدة، لا رحلةً لكلّ صفّ.
 *
 * أربعةُ آلافِ `findById` ثمّ `save` هي ثمانيةُ آلافِ ذهابٍ وإيابٍ إلى عنقودٍ
 * زمنُ ردّه تسعون جزءًا من الألف — أي عشرَ دقائقَ من الانتظار لعملٍ حجمُه
 * ميغابايت. تُقرأ الصفوفُ القائمةُ مرّةً، ويُحسب الفرقُ في العقدة، ولا يُكتب
 * إلّا ما تغيّر — دفعةً واحدة.
 */
async function writeKind(kind, map) {
  const existing = await CollectionsParty.find({ kind }).lean();
  const byKey = new Map(existing.map((e) => [e.nameKey, e]));

  let created = 0; let enriched = 0; let untouched = 0;
  const toInsert = [];
  const ops = [];

  for (const e of map.values()) {
    const name = bestName(e.names);
    const source = [...e.sources].join('+');
    const cur = byKey.get(e.nameKey);

    if (!cur) {
      toInsert.push({ kind, name, nameKey: e.nameKey, source, ...e.data });
      created += 1;
      continue;
    }
    // ما يُملأ: الفارغُ وحدَه — فمَن صحّح قيمةً بيده يجدها كما تركها.
    const $set = {};
    for (const [k, v] of Object.entries(e.data)) {
      if (cur[k] === undefined || cur[k] === '' || cur[k] === null) $set[k] = v;
    }
    if (!cur.source) $set.source = source;
    if (Object.keys($set).length) {
      ops.push({ updateOne: { filter: { _id: cur._id }, update: { $set } } });
      enriched += 1;
    } else untouched += 1;
  }

  if (!DRY) {
    if (toInsert.length) {
      // `insertMany` يتخطّى pre('save')، فالمفتاحُ المطويُّ محسوبٌ فوق يدًا.
      for (let i = 0; i < toInsert.length; i += 500) {
        await CollectionsParty.insertMany(toInsert.slice(i, i + 500), { ordered: false });
      }
    }
    for (let i = 0; i < ops.length; i += 500) {
      await CollectionsParty.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }
  return { created, enriched, untouched, total: map.size };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');

  const { customers, suppliers } = await build(db);

  const c = await writeKind('customer', customers);
  const v = await writeKind('supplier', suppliers);

  const line = (label, r) =>
    `${label}: ${r.total} طرفًا بعد طيّ التكرار — أُنشئ ${r.created}، أُثري ${r.enriched}، بلا تغيير ${r.untouched}`;
  console.log(line('العملاء', c));
  console.log(line('الموردون', v));

  // كم منهم له كشوفٌ فعلًا — الرقمُ الذي يقول هل السجلُّ حيٌّ أم دفترُ عناوين.
  const W = db.collection('operationsworkflows');
  const withReports = async (field) => {
    const rows = await W.aggregate([{ $match: { [field]: { $nin: [null, ''] } } }, { $group: { _id: `$${field}` } }]).toArray();
    return new Set(rows.map((r) => fold(r._id)).filter(Boolean)).size;
  };
  console.log(`\nمنهم في الكشوف: ${await withReports('username')} عميلًا · ${await withReports('carOwner')} موردًا`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
