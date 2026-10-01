/**
 * جردُ مخزن النقل الخفيف → سجلُّ المخزن.
 *
 * ── والشيتُ مصدرٌ مرّةً لا مرجعٌ دائم ───────────────────────────────────────
 * يُقرأ لتُبنى منه الأصنافُ وأرصدتُها اليوم، ثمّ يُدار المخزنُ من النظام:
 * وارد وصادر وحركاتٌ لها أصحابُها وتواريخُها. ولا شيءَ بعدها يُربَط بالملفّ —
 * ولو رُبط لصار لكلّ صنفٍ رصيدان: رصيدُ الورقة ورصيدُ العمل.
 *
 * ── وصيغةُ الصنف «كود-اسم» ─────────────────────────────────────────────────
 * «2283-رأس موتور»: الرقمُ قبل الشرطة كودُ الصنف في دفترهم، وما بعدها اسمُه.
 * ففُصلا — فيُبحَث بالكود كما يُبحَث بالاسم، ويُطابَق به عند إعادة الاستيراد
 * فلا يتكرّر الصنف.
 *
 * الاستعمال:
 *   node src/scripts/importLightStore.js "<ملفّ الجرد>.xlsx" [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const { Ls2StoreItem } = require(`${ROOT}/models/Ls2Store`);

const APPLY = process.argv.includes('--apply');
const FILE = process.argv.find((a) => a.endsWith('.xlsx'));

/** «2283-رأس موتور» → { code: '2283', name: 'رأس موتور' } — وما لا كودَ له يبقى اسمًا. */
const splitCode = (raw) => {
  const s = String(raw || '').trim();
  const m = /^(\d{2,6})\s*[-–—]\s*(.+)$/.exec(s);
  return m ? { code: m[1], name: m[2].trim() } : { code: '', name: s };
};

/**
 * تصنيفٌ مبدئيٌّ من اسم الصنف.
 *
 * التصنيفُ يخدم الفرزَ والتنبيه، وتركُه فارغًا يجعل مئةً وتسعين صنفًا كتلةً
 * واحدة. وهو مبدئيٌّ يُصحَّح من الشاشة: الكلمةُ في الاسم دليلٌ لا حكم.
 */
const CATEGORY_RULES = [
  [/زيت|شحم|سائل|فلوي?د|بنزين|وقود/, 'fluids_oils'],
  [/فلتر|فلاتر/, 'filters'],
  [/بطاري|كهرب|سلك|لمب|اسلاك|فيش|كويل|بوجي|دينامو|مارش/, 'electrical'],
  [/فرام|تيل|هوب|دسك|بريك/, 'brakes'],
  [/كاوتش|اطار|جنط|انبوب/, 'tires'],
  [/موتور|مكبس|صباب|سلندر|كرنك|كامة|شنبر/, 'engine'],
  [/سوست|مساعد|تعليق|بلية|رمان/, 'suspension'],
  [/جوان|اويل سيل|سيل/, 'gaskets'],
  [/مسمار|صامول|شداد|مشبك|كليب/, 'fasteners'],
  [/تيشيرت|بنطلون|خوذ|قفاز|جاكيت|زي|يونيفورم|حذاء/, 'uniform'],
  [/بلاستيك|جنب|غطاء|هيكل|مراي|كشاف|شاسيه|كابين/, 'body_cabin'],
  [/كاتينة|جنزير|ترس/, 'transmission'],
];
const categorise = (name) => {
  for (const [re, key] of CATEGORY_RULES) if (re.test(name)) return key;
  return 'uncategorised';
};

(async () => {
  if (!FILE) { console.error('مرّر ملفَّ الجرد: node src/scripts/importLightStore.js "<ملفّ>.xlsx" [--apply]'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);

  const wb = XLSX.readFile(FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

  // الصفُّ الأوّلُ عنوانُ الورقة والثاني رؤوسُ الأعمدة — فتُقرأ البقيّة.
  const headerAt = rows.findIndex((r) => String(r[0] || '').trim() === 'الصنف');
  const body = rows.slice(headerAt + 1);

  const parsed = [];
  const skipped = [];
  for (const r of body) {
    const raw = String(r[0] || '').trim();
    if (!raw) continue;
    const { code, name } = splitCode(raw);
    if (!name) { skipped.push(raw); continue; }
    const qty = Number(r[1]);
    parsed.push({
      code, name,
      quantity: Number.isFinite(qty) ? qty : 0,
      notes: String(r[2] || '').trim(),
      category: categorise(name),
    });
  }

  // كودٌ مكرّرٌ في الورقة: تُجمَع كمّيّاتُه ويُقال — صنفٌ واحدٌ في صفّين.
  const byKey = new Map();
  let merged = 0;
  for (const it of parsed) {
    const key = it.code || `name:${it.name}`;
    if (byKey.has(key)) { byKey.get(key).quantity += it.quantity; merged += 1; } else byKey.set(key, { ...it });
  }

  const existing = await Ls2StoreItem.find({ warehouse: 'light' }).select('code name quantity').lean();
  const exByCode = new Map(existing.filter((e) => e.code).map((e) => [e.code, e]));
  const exByName = new Map(existing.map((e) => [e.name.trim(), e]));

  const ops = [];
  let created = 0; let updated = 0;
  for (const it of byKey.values()) {
    const hit = (it.code && exByCode.get(it.code)) || exByName.get(it.name);
    const doc = { ...it, warehouse: 'light', unit: 'قطعة', isActive: true };
    if (hit) { updated += 1; ops.push({ updateOne: { filter: { _id: hit._id }, update: { $set: doc } } }); } else {
      created += 1;
      ops.push({ insertOne: { document: doc } });
    }
  }

  const byCat = {};
  for (const it of byKey.values()) byCat[it.category] = (byCat[it.category] || 0) + 1;
  const zero = [...byKey.values()].filter((i) => i.quantity <= 0).length;

  console.log(`الورقة: ${parsed.length} صفًّا → ${byKey.size} صنفًا${merged ? ` (دُمج ${merged} صفًّا مكرّرَ الكود)` : ''}`);
  console.log(`   جديدٌ ${created} · يُحدَّث ${updated} · نافدُ الرصيد ${zero}`);
  console.log('   التصنيف:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' · '));
  if (skipped.length) console.log(`   تُركت ${skipped.length} صفًّا بلا اسم`);

  if (APPLY && ops.length) {
    for (let i = 0; i < ops.length; i += 500) await Ls2StoreItem.bulkWrite(ops.slice(i, i + 500));
    const n = await Ls2StoreItem.countDocuments({ warehouse: 'light', isActive: { $ne: false } });
    console.log(`\nكُتب. أصنافُ مخزن النقل الخفيف الآن: ${n}`);
  } else {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
