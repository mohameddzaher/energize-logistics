/**
 * ربطُ حسابات تطبيق التوصيل (`B2CRep`) بصفوف سجلّ النقل الخفيف.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * شاشةُ تفقّد بداية الدوام تقرأ لوحةَ المندوب من صفّه في السجلّ عبر الصلة
 * `B2CRep.ltEmployee`. والصلةُ كانت تُكتب عرَضًا حين يُسنَد مشرف — فبقيت
 * ثلاثةٌ وخمسون من ثلاثةٍ وتسعين وخمسِمئة، والسجلُّ فيه مئةٌ وأربعةٌ وخمسون
 * مندوبًا له لوحة. فالمشرفُ يكتب اللوحةَ بيده كلَّ صباحٍ لأنّ الصلةَ ناقصة.
 *
 * ── وكيف يُطابَق اسمٌ باسم ──────────────────────────────────────────────────
 * لا مفتاحَ مشترك: سجلُّ التطبيق لا يحمل هويّةً ولا جوالًا، فلم يبقَ إلّا الاسم.
 * ومطابقةُ الاسمِ صفًّا صفًّا تلتبس: «MD ARSHED ALI» و«MD ARSHED» و«محمد ارشد»
 * ثلاثةُ صفوفٍ لاسمٍ واحد.
 *
 * فالمطابقةُ **ثنائيّةُ التفرّد**: يُقبَل الزوجُ إن كان كلٌّ من طرفيه لا يطابق
 * غيرَه في تلك الدرجة. ثلاثُ درجات بالترتيب — الاسمُ كما هو، ثمّ أوّلُ كلمةٍ
 * وآخرُها، ثمّ هيكلُ الحروف الساكنة — وما التبس في درجةٍ يُترَك لدرجةٍ أدنى، وما
 * التبس في الثلاث يُترَك لليد. فربطُ رجلٍ بغير صفّه أسوأُ من لوحةٍ تُكتب.
 *
 * الاستعمال:  node src/scripts/linkRepsToRegister.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const B2CRep = require(`${ROOT}/models/B2CRep`);
const { LightTransportEmployee } = require(`${ROOT}/models/LightTransport`);
const { fold, nameSkeleton } = require(`${ROOT}/utils/b2cSupervisors`);

const APPLY = process.argv.includes('--apply');

/** مفاتيحُ الاسم بثلاث درجاتٍ من الأقوى إلى الأضعف. */
const keysOf = (...names) => {
  const exact = new Set();
  const ends = new Set();
  const skel = new Set();
  for (const n of names) {
    const f = fold(n);
    if (!f) continue;
    exact.add(f);
    const w = f.split(' ').filter(Boolean);
    if (w.length >= 2) ends.add(`${w[0]} ${w[w.length - 1]}`);
    const sk = nameSkeleton(n);
    if (sk) skel.add(sk);
  }
  return [exact, ends, skel];
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const lts = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .select('name idNumber vehiclePlate vehicleTypeAr staffKind').lean();
  const reps = await B2CRep.find({ isActive: { $ne: false } })
    .select('englishName arabicName repId ltEmployee').lean();

  console.log(`سجلُّ النقل الخفيف=${lts.length} · حساباتُ التطبيق=${reps.length}`);
  const already = reps.filter((r) => r.ltEmployee);
  console.log(`مربوطٌ سلفًا=${already.length}`);

  const claimedLt = new Set(already.map((r) => String(r.ltEmployee)));
  const claimedRep = new Set(already.map((r) => String(r._id)));

  // فهارسُ الدرجات الثلاث لكلّ جهة
  const ltKeys = new Map(lts.map((e) => [String(e._id), keysOf(e.name)]));
  const repKeys = new Map(reps.map((r) => [String(r._id), keysOf(r.englishName, r.arabicName)]));

  const TIERS = ['الاسم كما هو', 'أوّل + آخر', 'هيكل الحروف'];
  const accepted = [];
  const ambiguous = [];

  for (let tier = 0; tier < 3; tier += 1) {
    // من كلّ مفتاحٍ إلى الصفوف التي تحمله، في هذه الدرجة وحدَها
    const ltBy = new Map(); const repBy = new Map();
    const put = (map, key, id) => { if (!map.has(key)) map.set(key, []); map.get(key).push(id); };
    for (const e of lts) {
      if (claimedLt.has(String(e._id))) continue;
      for (const k of ltKeys.get(String(e._id))[tier]) put(ltBy, k, String(e._id));
    }
    for (const r of reps) {
      if (claimedRep.has(String(r._id))) continue;
      for (const k of repKeys.get(String(r._id))[tier]) put(repBy, k, String(r._id));
    }
    for (const [key, ltIds] of ltBy) {
      const repIds = repBy.get(key);
      if (!repIds) continue;
      // تفرّدٌ من الجهتين — وإلّا تُرِك
      if (ltIds.length !== 1 || repIds.length !== 1) {
        ambiguous.push({ key, tier, lt: ltIds.length, rep: repIds.length });
        continue;
      }
      const [ltId] = ltIds; const [repId] = repIds;
      if (claimedLt.has(ltId) || claimedRep.has(repId)) continue;
      claimedLt.add(ltId); claimedRep.add(repId);
      accepted.push({ ltId, repId, tier, key });
    }
  }

  const ltById = new Map(lts.map((e) => [String(e._id), e]));
  const repById = new Map(reps.map((r) => [String(r._id), r]));
  const byTier = [0, 0, 0];
  accepted.forEach((a) => { byTier[a.tier] += 1; });
  console.log(`\nمطابقاتٌ جديدةٌ مقبولة: ${accepted.length}`);
  TIERS.forEach((t, i) => console.log(`  ${t}: ${byTier[i]}`));
  const withPlate = accepted.filter((a) => (ltById.get(a.ltId)?.vehiclePlate || '').trim()).length;
  console.log(`  منها ${withPlate} تحمل لوحةً — أي لوحةٌ تُملأ تلقائيًّا في التفقّد`);

  console.log('\nعيّنة:');
  accepted.slice(0, 12).forEach((a) => {
    const e = ltById.get(a.ltId); const r = repById.get(a.repId);
    console.log(`  [${TIERS[a.tier]}] ${String(r.englishName).slice(0, 28).padEnd(30)} ← ${String(e.name).slice(0, 30).padEnd(32)} لوحة=${e.vehiclePlate || '—'}`);
  });

  const stillLt = lts.filter((e) => e.staffKind === 'rep' && !claimedLt.has(String(e._id)));
  console.log(`\nبقي بلا ربط: ${stillLt.length} مندوبًا في السجلّ · و${ambiguous.length} مفتاحًا ملتبسًا`);
  stillLt.slice(0, 8).forEach((e) => console.log(`  ${e.name} · لوحة=${e.vehiclePlate || '—'}`));

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }
  let n = 0;
  for (const a of accepted) {
    await B2CRep.updateOne({ _id: a.repId }, { $set: { ltEmployee: a.ltId } });
    n += 1;
  }
  const total = await B2CRep.countDocuments({ isActive: { $ne: false }, ltEmployee: { $ne: null } });
  console.log(`\nكُتب ${n} ربطًا · الإجمالي المربوط الآن ${total}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
