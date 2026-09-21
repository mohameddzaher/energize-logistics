/**
 * صافي النقل يُعاد اشتقاقُه في كلّ معاملةٍ قائمة — مرّةً واحدة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * صار «صافي النقل» فرقًا محسوبًا لا خانةً تُملأ: ما نأخذه من العميل
 * (`revenue.transportSelling`) ناقصَ ما ندفعه للناقل (`costs.transport`) —
 * راجع recomputeTotals في models/CustomsClearance.
 *
 * والقاعدةُ تسري عند الحفظ، فلو تُركت المعاملاتُ القائمةُ لحالها لتغيّر ربحُها
 * واحدةً واحدةً كلّما فتحها أحدٌ وحفظ: لوحةٌ تتحرّك أرقامُها بلا حدثٍ يفسّرها.
 * فتُحسب كلُّها في مرّةٍ واحدةٍ معلومةِ الأثر.
 *
 * وأثرُها معروفٌ قبل تشغيلها: مئةٌ وثمانٍ معاملاتٍ لها سعرُ نقلٍ بلا سعرِ مورد،
 * فصافيها يصير سعرَ البيع كاملًا — وهو الصحيح متى نقلنا بسياراتنا. والقرارُ
 * قرارُ صاحب العمل، اتُّخذ في ٢١ سبتمبر ٢٠٢٦.
 *
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 *   node src/scripts/recomputeCustomsTransportNet.js [--apply]
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x) => Math.round(x * 100) / 100;

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const CustomsClearance = require('../models/CustomsClearance');
  const { recomputeTotals } = require('../models/CustomsClearance');

  const rows = await CustomsClearance.find({}).lean();
  const ops = [];
  let changed = 0;
  let profitDelta = 0;
  const sample = [];

  for (const r of rows) {
    const before = { net: n(r.revenue?.transportNet), profit: n(r.revenue?.profit), total: n(r.revenue?.totalInvoiced) };
    const doc = { costs: { ...(r.costs || {}) }, revenue: { ...(r.revenue || {}) } };
    recomputeTotals(doc);
    const after = { net: n(doc.revenue.transportNet), profit: n(doc.revenue.profit), total: n(doc.revenue.totalInvoiced) };
    if (Math.abs(after.net - before.net) < 0.01 && Math.abs(after.profit - before.profit) < 0.01
      && Math.abs(after.total - before.total) < 0.01) continue;
    changed += 1;
    profitDelta += after.profit - before.profit;
    if (sample.length < 8) {
      sample.push(`${r.refNumber}: مورد ${n(r.costs?.transport)} · سعر ${n(r.revenue?.transportSelling)} · صافٍ ${before.net} ← ${after.net} · ربح ${before.profit} ← ${after.profit}`);
    }
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            'revenue.transportNet': after.net,
            'revenue.profit': after.profit,
            'revenue.totalInvoiced': after.total,
            'costs.total': r2(n(doc.costs.total)),
          },
        },
      },
    });
  }

  console.log({ معاملات: rows.length, ستتغيّر: changed, 'فرق الربح': r2(profitDelta), applied: apply });
  sample.forEach((x) => console.log('  ', x));

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    await CustomsClearance.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
  }
  try { require('../utils/ttlCache').clear('customs:'); require('../utils/ttlCache').clear('finance:'); } catch (_) { /* */ }
  console.log(`\n✓ حُسبت ${ops.length} معاملة.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
