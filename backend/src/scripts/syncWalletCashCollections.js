/**
 * Past wallet collections reach their cash statements.
 * Usage: node src/scripts/syncWalletCashCollections.js [--apply] (preview by default)
 * The rule in utils/walletCollection marks a statement collected in the cash invoices when a wallet collection entry exists on a cash statement, but entries made before the rule stayed uncollected. This script is the same reconciliation run after any type change, not a second rule, and is safe to rerun: matching rows are not written and manually written values are untouched.
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

  // Who the action is attributed to in the audit trail: the system explicitly (bySystem).
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
