/**
 * repairClaimStatus: claim status is one fact, not two.
 * Usage: node src/scripts/repairClaimStatus.js [--yes] (dry run by default).
 * The status has two fields: `statusCode` chosen from the dropdown and `statusAr` free text from the import. The screen shows the text when present, so closing a claim changes the code while the column still shows the old text.
 * The code is the fact; the text is derived from it and shown in the screen language. This unifies what was written and fills a code for rows without one, based on their text.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

// Import text to code. Unknown text becomes 'under follow-up', never 'closed'.
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
    // Keep the code if present; otherwise derive it from the text.
    const code = cur || CODE_OF[txt] || 'pending';
    // Clear the text: it is derived at display time in the screen language, so it is not stored.
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
