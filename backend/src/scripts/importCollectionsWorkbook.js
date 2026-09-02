/**
 * importCollectionsWorkbook — دفترُ التحصيل يدخل النظام.
 *
 *   node --max-old-space-size=8192 src/scripts/importCollectionsWorkbook.js --dry
 *   node --max-old-space-size=8192 src/scripts/importCollectionsWorkbook.js
 *
 * المصدر: «collection files/Financial Collections    9-2026.xlsx»
 *   Aging                 ٢٥٣ حسابًا ضريبيًّا  — أعمارُ الديون وحدودُ الائتمان
 *   Aging Shipment        ١٢٧ حسابًا نقديًّا
 *   Daily Invoice Report  ١٣٢٩٢ صفَّ فاتورة
 *   JP                    خطّةُ الأسبوع وما تمّ منها
 *   Shipment Report       تحليلٌ لا يُستورَد (بأمر صاحبه)
 *
 * ── والاسمُ لا يُطابَق به إلّا ما قطع الشكّ ────────────────────────────────
 * أسماؤنا من كشوف التشغيل، وأسماءُ الدفتر من المحاسبة. من ٢٥٣ حسابًا طابق
 * الاسمُ ٣٧. فما بلغ تشابهُه حدًّا لا يحتمل الشكَّ يُربط ويُقيَّد أنّه رُبط
 * تلقائيًّا، وما دونه يُعرَض على مدير التحصيل ليقرّر — لأنّ الربطَ ينقل
 * مديونيّةً، وخطؤُه لا يُكتشف إلّا حين يُطالَب عميلٌ بمالِ غيرِه.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '../../..', 'collection files', 'Financial Collections    9-2026.xlsx');

// حدُّ الربط التلقائيّ. اختير عاليًا: ما دونه يُراجَع بيد.
const AUTO_LINK = 0.85;
const REVIEW_FLOOR = 0.30;

const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const D = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return new Date(XLS_EPOCH + Math.round(v * 86400000));
  const s = S(v);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m.map(Number); if (y < 100) y += 2000; const dt = new Date(Date.UTC(y, mo - 1, d)); return Number.isNaN(dt) ? null : dt; }
  return null;
};
const splitList = (v) => S(v).split(/[\/,؛;+&]|\s+و\s+/).map((x) => x.trim()).filter(Boolean);

// كلماتٌ لا تميّز حسابًا عن حساب، فلا تُحسب في التشابه.
const STOP = new Set(['شركه', 'شركة', 'مؤسسه', 'مؤسسة', 'موسسه', 'مصنع', 'مكتب', 'المحدوده', 'المحدودة',
  'شخص', 'واحد', 'التجاريه', 'التجارية', 'للخدمات', 'الخدمات', 'اللوجستيه', 'اللوجستية',
  'للنقليات', 'النقليات', 'للتجاره', 'للتجارة', 'co', 'ltd', 'company', 'est', 'for', 'and', 'the']);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;
  const PartyLinkSuggestion = require('../models/PartyLinkSuggestion');

  const toks = (s) => new Set(fold(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i += 1; const u = a.size + b.size - i; return u ? i / u : 0; };

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const sheet = (n, h) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true }).slice(h + 1);

  // ═══ ١ · الحسابات ═══════════════════════════════════════════════════════
  //  Aging          0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 limit 8 Status 9 CreditDays 10 Outstanding
  //  Aging Shipment 0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 Status 8 CreditDays 9 Outstanding
  const accounts = new Map();                       // code → account
  const nameless = [];                              // كودٌ بلا اسمٍ في الورقة
  const addAccount = (a) => {
    if (!a.code) return;
    // ── والكودُ بلا اسمٍ لا يُهمَل، ولا يُخترَع له اسم ─────────────────────
    // صفٌّ في الورقة يحمل كودًا وحدًّا ائتمانيًّا (٥٠ ألفًا) وموظّفًا مسؤولًا
    // ومهلةَ سدادٍ — ولا اسمَ حساب. وإسقاطُ الصفّ كلِّه لأجل خانةٍ فارغةٍ يضيّع
    // ما فيه: سقط الحدُّ فبقي الحسابُ بلا سقفٍ ولا تنبيه.
    //
    // فيُقبَل بلا اسم، ويُطابَق **بالكود وحدَه**. واسمُه يأتي من دفتر الفواتير
    // حيث هو مكتوبٌ على ثلاثٍ وأربعين فاتورة. ولا يُنشأ سجلٌّ لكودٍ لا اسمَ له
    // في الموضعين — لا يُخترَع اسمٌ من عندنا.
    if (!a.name) { nameless.push(a.code); a.codeOnly = true; }
    const prev = accounts.get(a.code);
    if (prev) { prev.outstanding += a.outstanding; return; }   // الحسابُ في الورقتين
    accounts.set(a.code, a);
  };
  for (const r of sheet('Aging', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({ code, name: S(r[1]), kind: 'tax', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: N(r[7]), status: S(r[8]), creditDays: N(r[9]), outstanding: N(r[10]) });
  }
  for (const r of sheet('Aging Shipment', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({ code, name: S(r[1]), kind: 'cash', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: 0, status: S(r[7]), creditDays: N(r[8]), outstanding: N(r[9]) });
  }
  // JP يزيد المنطقة، ويؤكّد النوع.
  for (const r of sheet('JP', 6)) {
    const code = S(r[0]); const a = accounts.get(code); if (!a) continue;
    if (!a.region) a.region = S(r[9]);
  }
  console.log(`حساباتٌ في الدفتر: ${accounts.size}`);
  if (nameless.length) console.log(`  ⚠ أكوادٌ بلا اسمِ حسابٍ في الورقة (تُطابَق بالكود وحدَه): ${nameless.join('، ')}`);

  // ═══ ٢ · المطابقةُ بما عندنا ════════════════════════════════════════════
  const ours = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey code').lean();
  const byKey = new Map(); for (const p of ours) byKey.set(p.nameKey || fold(p.name), p);
  const byCode = new Map(ours.filter((p) => p.code).map((p) => [p.code, p]));
  const oursTok = ours.map((p) => ({ _id: p._id, name: p.name, t: toks(p.name) }));

  // ── وسجلٌّ واحدٌ لا يحمل حسابين ──────────────────────────────────────────
  // «شركة الأخشاب العالمية» و«الأخشاب العالمية للتجارة» حسابان بكودين في
  // الدفتر، وقد يشيران إلى سجلٍّ واحدٍ عندنا. فلو رُبط كلاهما به لكتب الثاني
  // كودَه فوق كود الأوّل — فيختفي حسابٌ بأكمله بلا خبر، وتُنسَب مديونيّتُه إلى
  // غيره. حدث ذلك في أوّل تشغيل: ثمانيةُ أكواد ضاعت هكذا.
  //
  // فالسجلُّ يُحجَز لأوّل حسابٍ يطابقه، ومن جاء بعده يُعامَل كحسابٍ لا مرشَّحَ
  // له: يُنشأ بكوده ويُعرَض للمراجعة إن كان له شبيه.
  const claimed = new Set();
  const plan = { byCode: [], exact: [], auto: [], review: [], fresh: [] };
  // الترتيبُ بالكود ليكون التشغيلُ مكرَّرًا بنفس النتيجة لا رهنَ ترتيبِ قراءة.
  for (const a of [...accounts.values()].sort((x, y) => String(x.code).localeCompare(String(y.code)))) {
    const claim = (p) => { claimed.add(String(p._id)); return p; };
    const free = (p) => p && !claimed.has(String(p._id));

    if (byCode.has(a.code)) { plan.byCode.push({ a, p: claim(byCode.get(a.code)) }); continue; }
    // بلا اسمٍ لا يُطابَق بالاسم ولا يُنشأ سجلّ — يُنتظر أن يُعرَف اسمُه.
    if (a.codeOnly) continue;
    const ex = byKey.get(fold(a.name));
    if (free(ex)) { plan.exact.push({ a, p: claim(ex) }); continue; }
    const t = toks(a.name);
    let best = null; let bs = 0;
    for (const p of oursTok) { if (!free(p)) continue; const s = jac(t, p.t); if (s > bs) { bs = s; best = p; } }
    if (bs >= AUTO_LINK && best) plan.auto.push({ a, p: claim(best), score: bs });
    else if (bs >= REVIEW_FLOOR && best) plan.review.push({ a, p: best, score: bs });
    else plan.fresh.push({ a, score: bs });
  }
  console.log(`  مطابقٌ بالكود:            ${plan.byCode.length}`);
  console.log(`  مطابقٌ بالاسم تمامًا:      ${plan.exact.length}`);
  console.log(`  يُربط تلقائيًّا (≥${AUTO_LINK}):   ${plan.auto.length}`);
  console.log(`  يُعرَض للمراجعة:           ${plan.review.length}`);
  console.log(`  حساباتٌ جديدة:             ${plan.fresh.length}`);
  console.log('\n  أمثلةٌ من الربط التلقائيّ:');
  for (const x of plan.auto.slice(0, 8)) console.log(`    ${x.score.toFixed(2)}  ${x.a.name}\n            ← ${x.p.name}`);

  if (DRY) {
    console.log('\n  أمثلةٌ ممّا سيُعرَض للمراجعة:');
    for (const x of plan.review.slice(0, 8)) console.log(`    ${x.score.toFixed(2)}  ${x.a.name}\n            ? ${x.p.name}`);
    console.log('\n— تجربةٌ فقط —\n');
    await mongoose.disconnect(); return;
  }

  // ═══ ٣ · الكتابة ════════════════════════════════════════════════════════
  const setOf = (a) => ({
    code: a.code, kind: 'customer', paymentType: a.kind,
    collectionOfficer: a.officer, hoLocation: a.ho, grade: a.grade,
    salesManagers: a.sales, department: a.dept, region: a.region || '',
    creditLimit: a.limit || 0, creditDays: a.creditDays || 0,
    ...(a.status ? { status: a.status } : {}),
  });

  let linked = 0; let created = 0; const refused = [];
  // eslint-disable-next-line prefer-const
  // ولا يُكتب كودٌ فوق كودِ حسابٍ آخر: الشرطُ في الاستعلام نفسِه، فلو حدث
  // تصادمٌ لم يُتوقَّع لم يُكتب شيءٌ ويُقال.
  const claimParty = async (p, a) => {
    const r = await CollectionsParty.updateOne(
      { _id: p._id, $or: [{ code: '' }, { code: null }, { code: { $exists: false } }, { code: a.code }] },
      { $set: setOf(a), $addToSet: { aliases: a.name, aliasKeys: fold(a.name) } },
    );
    if (!r.matchedCount) {
      // ── والمرفوضُ يُنشأ حسابًا مستقلًّا، لا يُترك بلا سجلّ ────────────────
      // السجلُّ محجوزٌ لحسابٍ آخر — والشركةُ الواحدة قد تحمل حسابين (ضريبيًّا
      // ونقديًّا) لكلٍّ رصيدُه ومدّةُ سداده. فيأخذ الحسابُ سجلَّه بكوده، ولا
      // يُدهَس الأوّلُ ولا يضيع الثاني.
      await CollectionsParty.updateOne({ code: a.code },
        { $set: { ...setOf(a), name: a.name, nameKey: fold(a.name), source: 'collections_workbook' } },
        { upsert: true, setDefaultsOnInsert: true });
      refused.push(`${a.code} ${a.name} — «${p.name}» محجوزٌ لحسابٍ آخر، فأُنشئ سجلٌّ مستقلّ`);
      created += 1;
      return false;
    }
    return true;
  };
  for (const { a, p } of [...plan.byCode, ...plan.exact]) if (await claimParty(p, a)) linked += 1;
  for (const { a, p, score } of plan.auto) {
    if (!await claimParty(p, a)) continue;
    await PartyLinkSuggestion.updateOne({ code: a.code }, { $set: {
      code: a.code, accountName: a.name, kind: a.kind, candidate: p._id, candidateName: p.name,
      score, decision: 'linked', decidedHow: 'auto', decidedAt: new Date(), party: p._id,
    } }, { upsert: true });
    linked += 1;
  }
  // ما يُراجَع: يُنشأ حسابُه بالكود (فالأرقامُ لا تنتظر قرارًا)، ويُسجَّل
  // الاقتراحُ ليقرّر إنسانٌ أيُدمَج مع القديم أم يبقى مستقلًّا.
  for (const { a, p, score } of plan.review) {
    const doc = await CollectionsParty.findOneAndUpdate({ code: a.code },
      { $set: { ...setOf(a), name: a.name, nameKey: fold(a.name), source: 'collections_workbook' } },
      { upsert: true, new: true, setDefaultsOnInsert: true });
    await PartyLinkSuggestion.updateOne({ code: a.code }, { $set: {
      code: a.code, accountName: a.name, kind: a.kind, candidate: p._id, candidateName: p.name,
      score, decision: 'pending', party: doc._id,
    } }, { upsert: true });
    created += 1;
  }
  for (const { a } of plan.fresh) {
    await CollectionsParty.updateOne({ code: a.code },
      { $set: { ...setOf(a), name: a.name, nameKey: fold(a.name), source: 'collections_workbook' } },
      { upsert: true, setDefaultsOnInsert: true });
    created += 1;
  }
  console.log(`\n✓ حساباتٌ رُبطت بما عندنا: ${linked} · أُنشئت: ${created}`);
  if (refused.length) { console.log(`  ⚠ رُفض ربطُها لئلّا تدهس كودًا قائمًا (${refused.length}):`); for (const x of refused) console.log(`    ${x}`); }
  console.log(`  تنتظر مراجعةَ المدير: ${plan.review.length}`);

  const tot = await CollectionsParty.countDocuments({ kind: 'customer' });
  const withCode = await CollectionsParty.countDocuments({ kind: 'customer', code: { $gt: '' } });
  console.log(`  عملاءُ السجلّ الآن: ${tot} · منهم بكود: ${withCode}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
