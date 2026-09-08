/**
 * repairClaimStatus — حالةُ المطالبة خبرٌ واحد، لا اثنان.
 *
 *   node src/scripts/repairClaimStatus.js          تجربة
 *   node src/scripts/repairClaimStatus.js --yes    تنفيذ
 *
 * ── العلّة ────────────────────────────────────────────────────────────────
 * للحالة حقلان: `statusCode` تختاره القائمةُ المنسدلة، و`statusAr` نصٌّ حرّ
 * جاء مع الاستيراد. والشاشةُ تعرض النصَّ إن وُجد — فيُقفل المستخدمُ المطالبةَ
 * فيتغيّر الكودُ ويبقى العمودُ يقول «wait».
 *
 * وثلاثُ مطالباتٍ كذلك حرفيًّا، واثنتان وثلاثون يختلف فيها الحقلان. والنصوصُ
 * مخلوطةُ اللغة: «تم قفلها» و«closed» و«open» و«wait» و«unknown».
 *
 * فالكودُ هو الخبر، والنصُّ يُشتقُّ منه ويُعرَض بلغة الشاشة. ويُوحَّد هنا ما
 * كُتب، ويُملأ كودٌ لمن لا كودَ له استنادًا إلى نصّه.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

// نصُّ الاستيراد ← الكود. ما لا يُعرَف يصير «قيد المتابعة» لا «مقفولة».
const CODE_OF = {
  closed: 'closed', 'تم قفلها': 'closed', 'مقفولة': 'closed', 'مغلقة': 'closed',
  open: 'pending', wait: 'pending', pending: 'pending', 'قيد المتابعة': 'pending', unknown: 'pending',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const VehicleClaim = require('../models/VehicleClaim');
  const rows = await VehicleClaim.find({}).select('accidentNumber statusCode statusAr').lean();

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  const plan = [];
  for (const r of rows) {
    const cur = String(r.statusCode || '').trim();
    const txt = String(r.statusAr || '').trim().toLowerCase();
    // الكودُ يبقى إن كان مكتوبًا؛ وإلّا يُشتقُّ من النصّ.
    const code = cur || CODE_OF[txt] || 'pending';
    // والنصُّ يُفرَّغ: صار يُشتقُّ عند العرض بلغة الشاشة، فلا يُخزَّن.
    if (cur !== code || r.statusAr) plan.push({ id: r._id, no: r.accidentNumber, from: `${cur || '—'}/${r.statusAr || '—'}`, code });
  }
  const byPair = {};
  plan.forEach((p) => { const k = `${p.from} → ${p.code}`; byPair[k] = (byPair[k] || 0) + 1; });
  Object.entries(byPair).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`   ${k}   (${n})`));
  console.log(`\nالمتأثّرة: ${plan.length} من ${rows.length}`);

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  for (const p of plan) {
    await VehicleClaim.updateOne({ _id: p.id }, { $set: { statusCode: p.code, statusAr: '' } });
  }
  console.log(`\n✓ وُحِّدت ${plan.length} مطالبة`);
  await mongoose.disconnect();
})();
