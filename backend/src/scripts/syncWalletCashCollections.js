/**
 * syncWalletCashCollections — تحصيلاتُ المحفظة السابقة تصل كشوفَها النقديّة.
 *
 *   node src/scripts/syncWalletCashCollections.js            # تجربة، بلا كتابة
 *   node src/scripts/syncWalletCashCollections.js --apply    # تنفيذ
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * القاعدةُ الجديدة (utils/walletCollection) تعمل من الآن: قيدُ تحصيلٍ في المحفظة
 * على كشفٍ نقديٍّ يجعله «محصَّلًا» في فواتير الكاش. وما سُجِّل قبلها بقي كما هو:
 * ستّةٌ وثلاثون قيدًا على كشوفٍ نقديّة ولا واحدٌ منها محصَّل في شاشة التحصيل.
 *
 * والسكربتُ هو المطابقةُ نفسُها التي تجري بعد كلّ تغيّرٍ في النوع — لا قاعدةٌ
 * ثانية: ما يكتبه هنا هو ما كانت المحفظةُ ستكتبه لو كانت القاعدةُ يومَ القيد.
 * فهو يُعاد بلا ضرر: ما طابق لا يُكتب، وما كتبه القسمُ بيده لا يُمسّ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const AR = {
  collect: 'يُحصَّل', update: 'يُحدَّث', undo: 'يُرفع', hand: 'محصَّلٌ بيد القسم — لا يُمسّ', none: 'مطابق',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { resyncAllWalletCollections } = require('../utils/walletCollection');

  // مَن يُنسَب إليه التنفيذُ في سجلّ المراجعة: النظام صراحةً (bySystem).
  const s = await resyncAllWalletCollections({ apply: APPLY, regexFallback: true, reason: 'تعبئة التحصيلات السابقة (سكربت)' });

  console.log(APPLY ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  console.log(`قيودُ تحصيلٍ برقم كشف: ${s.entries} · على ${s.reports} كشفًا`);
  console.log(`  على كشوفٍ نقديّة: ${s.cash} · على غير نقديّة: ${s.nonCash} · أرقامٌ لا كشفَ لها: ${s.notFound.length}`);
  if (s.notFound.length) console.log(`  (${s.notFound.join('، ')})`);
  console.log(`  الخطّة: ${Object.entries(s.byAction).map(([k, v]) => `${AR[k] || k} ${v}`).join(' · ')}\n`);

  for (const { wf, wallet, plan } of s.items) {
    if (plan.action === 'none') continue;
    if (!wallet && plan.action !== 'undo') continue;
    const now = `${ymd(wf.collectionDate)} / ${Number(wf.collectedAmount) || 0}`;
    const next = plan.set ? `${ymd(plan.set.collectionDate)} / ${plan.set.collectedAmount}` : '';
    console.log(`  ${String(wf.reportNumber).padEnd(10)} ${String(wf.paymentType || '—').padEnd(5)} ${AR[plan.action].padEnd(12)} ${now}${next ? ` → ${next}` : ''}${wallet && wallet.count > 1 ? `  (${wallet.count} قيود)` : ''}`);
  }

  if (!APPLY) console.log('\n— تجربةٌ فقط. أضف --apply للتنفيذ.\n');
  else console.log(`\n✓ كُتب ${s.applied.length} كشفًا`);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) { /* */ }
  process.exit(1);
});
