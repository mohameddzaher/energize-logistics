/**
 * دمجُ سجلَّي الموظّف الواحد، وكنسُ سجلّات الاختبار.
 *
 *   node src/scripts/mergeDuplicateEmployees.js            # تقريرٌ بلا كتابة
 *   node src/scripts/mergeDuplicateEmployees.js --write    # ينفّذ
 *
 * ── لماذا دمجٌ لا حذف ───────────────────────────────────────────────────────
 * الموظّفُ لا يُحذَف (راجع `deleteEmployee`: البابُ مسدود). لكنّ **سجلَّين
 * لإنسانٍ واحد** ليسا إنسانين: هما قيدٌ تكرّر. وإبقاؤهما أسوأُ من الحذف —
 * مستنداتُه موزّعةٌ على نسختين، فمن يفتح إحداهما يرى نصفَ ملفّه ويظنّه كلَّه،
 * وإنهاءُ الخدمة يقع على واحدةٍ فيبقى الآخرُ «على رأس العمل».
 *
 * فالدمجُ: تُنقَل كلُّ إشارةٍ من النسخة الزائدة إلى المُبقاة (مستندات، عقود،
 * إجازات، طلبات، عهد، بطاقةُ سائق، سجلُّ النقل الخفيف، حسابُ الدخول، تفاويضُ
 * المركبات، ومَن يتبعه إداريًّا)، ثمّ تُملأ من الزائدة كلُّ خانةٍ فارغةٍ في
 * المُبقاة — فلا تضيع معلومة — ثمّ تُزال الزائدةُ وحدَها.
 *
 * ── وما لا يُدمَج تلقائيًّا ─────────────────────────────────────────────────
 * اسمان متطابقان برقمَي هويّةٍ **مختلفين** ليسا تكرارًا يُحسَم بسكربت: قد يكون
 * شخصين، أو شخصًا عاد بإقامةٍ جديدة. يُذكَر في التقرير ويُترك لصاحب القرار.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const WRITE = process.argv.includes('--write');
const S = (v) => String(v == null ? '' : v).trim();

/** كلُّ ما يشير إلى موظّف: المجموعةُ والحقل. */
const REFS = [
  ['employeedocuments', 'employee'], ['employeerenewals', 'employee'],
  ['contracts', 'employee'], ['leaverequests', 'employee'], ['hrrequests', 'employee'],
  ['assets', 'employee'], ['drivercards', 'employee'],
  ['lighttransportemployees', 'employee'], ['lighttransportemployees', 'supervisor'],
  ['users', 'linkedEmployee'], ['vehicleauthorizations', 'employee'],
  ['employees', 'directManager'], ['b2creps', 'employee'],
  ['performanceevaluations', 'employee'], ['b2cdutychecks', 'employee'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const db = mongoose.connection;
  const have = new Set((await db.db.listCollections().toArray()).map((c) => c.name));

  const all = await Employee.find({}).lean();

  // ── ① سجلّات الاختبار ────────────────────────────────────────────────────
  // تُنشَأ تلقائيًّا مع كلّ مستخدمٍ يُصنَع للفحص، ويبقى هيكلُها بعد حذف المستخدم.
  // لا هويّةَ لها ولا مستندَ ولا عقد — وبريدُها `example.invalid` وهو نطاقٌ
  // محجوزٌ لا يُسجَّل، فلا يُشبهه بريدُ موظّفٍ حقيقيّ.
  const litter = all.filter((e) => /@example\.invalid$/i.test(S(e.email)));
  const litterWithData = [];
  for (const e of litter) {
    let n = 0;
    for (const [coll, field] of REFS) {
      if (!have.has(coll)) continue;
      n += await db.collection(coll).countDocuments({ [field]: e._id });
    }
    if (n) litterWithData.push({ e, n });
  }
  console.log('── سجلّات اختبارٍ متروكة ────────────────────────────────────');
  console.log('  عددُها:', litter.length, '· ما لها إشاراتٌ (لن تُمَسّ):', litterWithData.length);
  litter.slice(0, 12).forEach((e) => console.log('   ', S(e.email)));

  // ── ② التكرارُ الحقيقيّ: رقمُ هويّةٍ واحدٌ وسجلّان ───────────────────────
  const byId = new Map();
  for (const e of all) {
    if (/@example\.invalid$/i.test(S(e.email))) continue;
    // الرقمُ قد يُكتب في الخانتين للسجلّ الواحد (راجع identity-number-two-columns)،
    // فيُجمَع بالمعرّف كي لا يُعَدّ السجلُّ الواحدُ تكرارًا لنفسه.
    for (const id of new Set([S(e.nationalId), S(e.iqamaNumber)].filter(Boolean))) {
      if (!byId.has(id)) byId.set(id, new Map());
      byId.get(id).set(String(e._id), e);
    }
  }
  const dups = [...byId.entries()].filter(([, m]) => m.size > 1);

  const refsOf = async (id) => {
    const out = {};
    for (const [coll, field] of REFS) {
      if (!have.has(coll)) continue;
      const n = await db.collection(coll).countDocuments({ [field]: id });
      if (n) out[`${coll}.${field}`] = n;
    }
    return out;
  };
  const filled = (e) => Object.entries(e).filter(([k, v]) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(k)
    && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).length;

  console.log('\n── تكرارٌ حقيقيٌّ (هويّةٌ واحدةٌ · سجلّان) ──────────────────');
  const plans = [];
  for (const [id, map] of dups) {
    const rows = [...map.values()];
    const enriched = [];
    for (const r of rows) enriched.push({ r, refs: await refsOf(r._id), n: filled(r) });
    /**
     * أيُّهما يُبقى؟ **مَن هو على رأس العمل** أوّلًا — هو الحاضرُ الذي تُبنى عليه
     * الإجازاتُ والرواتبُ والعهد، وإبقاءُ المنتهيةِ خدمتُه يجعل الرجلَ يُقرأ
     * مفصولًا وهو يعمل. ثمّ الأغنى بياناتٍ عند التساوي.
     */
    enriched.sort((a, b) => {
      const act = (x) => (x.r.employmentStatus === 'active' ? 1 : 0);
      if (act(a) !== act(b)) return act(b) - act(a);
      if (a.n !== b.n) return b.n - a.n;
      return new Date(a.r.createdAt) - new Date(b.r.createdAt);
    });
    const [keep, ...drop] = enriched;
    plans.push({ id, keep, drop });
    console.log(`\n هوية ${id} — «${keep.r.arabicName || keep.r.firstName}»`);
    console.log(`   يُبقى : ${String(keep.r._id).slice(-6)} [${keep.r.employmentStatus}] خانات ${keep.n} · ${JSON.stringify(keep.refs)}`);
    for (const d of drop) console.log(`   يُدمَج: ${String(d.r._id).slice(-6)} [${d.r.employmentStatus}] خانات ${d.n} · ${JSON.stringify(d.refs)}`);
  }

  // ── ③ اسمٌ واحدٌ برقمَي هويّةٍ مختلفين — لا يُحسَم بسكربت ────────────────
  const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/\s+/g, ' ');
  const byName = {};
  for (const e of all) {
    if (/@example\.invalid$/i.test(S(e.email))) continue;
    const n = fold(e.arabicName) || fold(`${e.firstName || ''} ${e.lastName || ''}`);
    if (n.length > 4) (byName[n] = byName[n] || []).push(e);
  }
  const nameOnly = Object.entries(byName).filter(([, v]) => v.length > 1
    && new Set(v.map((e) => S(e.nationalId) || S(e.iqamaNumber))).size > 1);
  if (nameOnly.length) {
    console.log('\n── اسمٌ واحدٌ برقمَي هويّةٍ مختلفين (يُترك لصاحب القرار) ────');
    nameOnly.forEach(([n, v]) => {
      console.log(`  «${n}»`);
      v.forEach((e) => console.log(`     ${S(e.nationalId) || S(e.iqamaNumber)} · ${e.employmentStatus} · ${S(e.department) || '—'} · ${S(e.jobTitle) || '—'}`));
    });
  }

  if (!WRITE) { console.log('\n(تقريرٌ فقط — أضِف --write للتنفيذ)'); process.exit(0); }

  // ── التنفيذ ──────────────────────────────────────────────────────────────
  let moved = 0; let merged = 0; let swept = 0;
  for (const { keep, drop } of plans) {
    for (const d of drop) {
      for (const [coll, field] of REFS) {
        if (!have.has(coll)) continue;
        const r = await db.collection(coll).updateMany({ [field]: d.r._id }, { $set: { [field]: keep.r._id } });
        moved += r.modifiedCount;
      }
      // ما في الزائدة ولا نظيرَ له في المُبقاة يُنقَل — فلا تضيع معلومة.
      const $set = {};
      for (const [k, v] of Object.entries(d.r)) {
        if (['_id', '__v', 'createdAt', 'updatedAt', 'employmentStatus'].includes(k)) continue;
        const cur = keep.r[k];
        const empty = cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && !cur.length);
        const has = v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
        if (empty && has) $set[k] = v;
      }
      if (Object.keys($set).length) await Employee.updateOne({ _id: keep.r._id }, { $set });
      await Employee.deleteOne({ _id: d.r._id });
      merged += 1;
      console.log(`دُمج ${String(d.r._id).slice(-6)} → ${String(keep.r._id).slice(-6)} · خاناتٌ نُقلت: ${Object.keys($set).length}`);
    }
  }
  for (const e of litter) {
    if (litterWithData.some((x) => String(x.e._id) === String(e._id))) continue;
    await Employee.deleteOne({ _id: e._id });
    swept += 1;
  }
  console.log(`\nنُقلت ${moved} إشارة · دُمج ${merged} سجلًّا · كُنس ${swept} سجلَّ اختبار`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
