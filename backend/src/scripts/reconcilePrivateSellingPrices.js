/**
 * reconcilePrivateSellingPrices — «السعرُ الحقيقيّ» القديم إلى قيمة البيع في الكشف.
 *
 *   node src/scripts/reconcilePrivateSellingPrices.js                 تجربة (لا كتابة)
 *   node src/scripts/reconcilePrivateSellingPrices.js --apply         ينسخ إلى الكشوف
 *   … --apply --override-book    ويكتب فوق قيمةٍ من دفتر التحصيل أيضًا
 *   … --apply --push             ويدفع كلَّ قيمةٍ إلى منصّة التشغيل (معطَّلٌ افتراضًا)
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كانت صفحةُ «التشغيل — خاصّ» تحفظ سعرَها في `PrivateSellingPrice`، وسيرُ العمل
 * يقرأ `OperationsWorkflow.sellingValue`. فصار الثاني المرجعَ الوحيد (صاحبُ
 * الشركة، ٢٠٢٦/١٠/٢١) ولم يعد الأوّلُ يُقرأ. وهذا السكربتُ يقول أين يفترقان،
 * و`--apply` يكتب السعرَ القديم في الكشف.
 *
 * ── ما يُكتب وما لا يُكتب ───────────────────────────────────────────────────
 *  • سعرٌ قديمٌ موجبٌ يخالف الكشف ← يُكتب في الكشف، ومصدرُه `manual` فلا تكتب
 *    المزامنةُ فوقه.
 *  • سعرٌ قديمٌ صفر ← لا يُكتب: «لم يُسعَّر» لا يمحو قيمةً قائمة.
 *  • الكشفُ قيمتُه من دفتر التحصيل (`collections_book`) ← يُترك ويُعدّ تعارضًا
 *    إلّا بـ`--override-book`: الدفترُ مرجعُ الكشف النقديّ.
 *  • الكشفُ كُتبت قيمتُه بيدٍ في سير العمل (`manual`) **بعد** آخر تعديلٍ للسعر
 *    القديم ← يُترك: اليدُ الأحدثُ تغلب.
 *
 * ── والمنصّة ───────────────────────────────────────────────────────────────
 * لا يُدفع شيءٌ إليها افتراضًا: آلافُ النداءات دفعةً على منصّةٍ ليست لنا قرارٌ
 * يُتّخذ بعينه. فبعد `--apply` وحدَه يقول الكشفُ القيمةَ الجديدة وتبقى المنصّةُ
 * على القديم — و`manual` يحمي قيمتَنا من المزامنة. و`--push` يدفعها واحدةً
 * واحدةً (pushSellingValue)، وما رفضته المنصّةُ يُقال ولا يوقف الباقي.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const PUSH = process.argv.includes('--push');
const OVERRIDE_BOOK = process.argv.includes('--override-book');

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const CACHE_PREFIXES = ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:', 'ops:'];

/** يقسم الأسعارَ القديمة على أقسامها. لا يكتب شيئًا. */
async function analyse() {
  const PrivateSellingPrice = require('../models/PrivateSellingPrice');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const prices = await PrivateSellingPrice.find({})
    .select('workflow reportNumber sellingValue source updatedAt updatedByName').lean();
  const wfs = await OperationsWorkflow.find({ _id: { $in: prices.map((p) => p.workflow) } })
    .select('reportNumber username sellingValue sellingValueSource purchaseValue externalSource externalId updatedAt').lean();
  const byId = new Map(wfs.map((w) => [String(w._id), w]));

  const out = {
    total: prices.length,
    same: [], toCopy: [], privateZero: [], orphan: [], bookConflict: [], newerManual: [],
    bySource: {},
  };
  for (const p of prices) {
    const w = byId.get(String(p.workflow));
    if (!w) { out.orphan.push({ p }); continue; }
    const priv = r2(p.sellingValue);
    const cur = r2(w.sellingValue);
    if (priv === cur) { out.same.push({ p, w }); continue; }
    if (!(priv > 0)) { out.privateZero.push({ p, w }); continue; }
    const src = String(w.sellingValueSource || '');
    if (src === 'collections_book' && !OVERRIDE_BOOK) { out.bookConflict.push({ p, w }); continue; }
    if (src === 'manual' && w.updatedAt && p.updatedAt && new Date(w.updatedAt) > new Date(p.updatedAt)) {
      out.newerManual.push({ p, w }); continue;
    }
    out.toCopy.push({ p, w });
    const k = p.source || '(فارغ)';
    out.bySource[k] = (out.bySource[k] || 0) + 1;
  }
  return out;
}

async function run({ apply = APPLY, push = PUSH, log = console.log } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const a = await analyse();
  const line = ({ p, w }) => `  ${String((w && w.reportNumber) || p.reportNumber).padEnd(10)} `
    + `${String((w && w.username) || '').slice(0, 24).padEnd(24)} `
    + `خاصّ=${r2(p.sellingValue)} (${p.source || '-'})  كشف=${w ? r2(w.sellingValue) : '-'} (${(w && w.sellingValueSource) || 'منصّة'})`
    + `  شراء=${w ? r2(w.purchaseValue) : '-'}`;

  log(apply ? '── تنفيذ ──' : '── تجربة، بلا كتابة ──');
  log(`أسعارٌ قديمة في PrivateSellingPrice: ${a.total}`);
  log(`  مطابقةٌ للكشف:                     ${a.same.length}`);
  log(`  تخالفه وتُنسخ إليه:                ${a.toCopy.length}   ${JSON.stringify(a.bySource)}`);
  log(`  تخالفه وقيمةُ الكشف من الدفتر:      ${a.bookConflict.length}${OVERRIDE_BOOK ? '' : '   (تُترك — --override-book)'}`);
  log(`  تخالفه وقيمةُ الكشف يدويّةٌ أحدث:   ${a.newerManual.length}   (تُترك)`);
  log(`  السعرُ القديمُ صفر والكشفُ غيرُه:    ${a.privateZero.length}   (تُترك)`);
  log(`  بلا كشف (حُذف):                    ${a.orphan.length}`);
  const fromPlatform = a.toCopy.filter(({ w }) => w.externalSource === 'ops_upl' && w.externalId).length;
  log(`  منها كشوفُ المنصّة (تحتاج دفعًا إن أُريد): ${fromPlatform}`);
  const delta = a.toCopy.reduce((s, { p, w }) => s + (r2(p.sellingValue) - r2(w.sellingValue)), 0);
  log(`  فرقُ مجموع البيع لو نُسخت: ${r2(delta).toLocaleString('en-US')}`);
  if (a.toCopy.length) { log('\nعيّنة ممّا يُنسخ:'); a.toCopy.slice(0, 15).forEach((x) => log(line(x))); }
  if (a.bookConflict.length) { log('\nعيّنة تعارضٍ مع الدفتر:'); a.bookConflict.slice(0, 5).forEach((x) => log(line(x))); }
  if (a.newerManual.length) { log('\nعيّنة يدويّةٍ أحدث في الكشف:'); a.newerManual.slice(0, 5).forEach((x) => log(line(x))); }

  if (!apply) { log('\n— تجربةٌ فقط. أضف --apply للنسخ (و--push لدفعها إلى المنصّة).'); return { ...a, written: 0, pushed: 0 }; }

  // ── الكتابة: قيمةٌ لكلّ كشف، مقطَّعةً ─────────────────────────────────────
  // شرطُ القيمة القديمة في الفلتر نفسِه: كشفٌ عُدِّل بين القراءة والكتابة لا يُكتب فوقه.
  let written = 0;
  const CHUNK = 1000;
  for (let i = 0; i < a.toCopy.length; i += CHUNK) {
    const ops = a.toCopy.slice(i, i + CHUNK).map(({ p, w }) => ({
      updateOne: {
        filter: { _id: w._id, sellingValue: w.sellingValue },
        update: { $set: { sellingValue: r2(p.sellingValue), sellingValueSource: 'manual' } },
      },
    }));
    const r = await OperationsWorkflow.bulkWrite(ops, { ordered: false });
    written += r.modifiedCount || 0;
  }
  log(`\n✓ كُتبت قيمةُ البيع على ${written} كشفًا (المصدر: manual).`);

  let pushed = 0; const failed = [];
  if (push) {
    const { _pushSellingValue } = require('../controllers/workflowController');
    for (const { p, w } of a.toCopy) {
      try {
        const out = await _pushSellingValue(w, r2(p.sellingValue));
        if (out && out.platform) pushed += 1;
      } catch (e) { failed.push(`${w.reportNumber}: ${e.message}`); }
    }
    log(`✓ دُفع إلى المنصّة: ${pushed}${failed.length ? ` — ورُفض ${failed.length}` : ''}`);
    failed.slice(0, 20).forEach((f) => log(`  ✗ ${f}`));
  } else {
    log('  (لم يُدفع شيءٌ إلى المنصّة — --push لذلك.)');
  }

  const cache = require('../utils/ttlCache');
  for (const pfx of CACHE_PREFIXES) {
    try { await cache.clearShared(pfx); } catch (e) { log(`  تعذّر ختمُ ${pfx}: ${e.message} — المهلةُ أو pm2 reload`); }
  }
  return { ...a, written, pushed, failed };
}

module.exports = { run, analyse };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
    try { await run(); } finally { await mongoose.disconnect(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
