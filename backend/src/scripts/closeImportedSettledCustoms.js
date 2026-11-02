/**
 * closeImportedSettledCustoms: closes imported master-sheet transactions that are already finished.
 * Dry run by default; --apply writes.
 * Imported rows were never closed because the finish button did not exist then; those whose invoice status is settled are closed, dated to the last day of their master month, under a legacy-record name. Unsettled ones stay open. Safe to rerun.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const SETTLED = 'خالص';
const BY = 'سجلّ سابق';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CustomsClearance = require('../models/CustomsClearance');
  const filter = {
    legacySerial: { $ne: null },
    upcoming: { $ne: true },
    cancelled: { $ne: true },
    isCompleted: { $ne: true },
    'billing.invoiceStatus': SETTLED,
  };
  const rows = await CustomsClearance.find(filter)
    .select('refNumber stage periodYear periodMonth createdAt').lean();

  const byStage = {};
  for (const r of rows) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
  const open = await CustomsClearance.countDocuments({ upcoming: { $ne: true }, cancelled: { $ne: true }, isCompleted: { $ne: true } });
  console.log(`\n  مفتوحةٌ الآن: ${open} · منها مستورَدةٌ «${SETTLED}» تُغلَق: ${rows.length}`);
  console.log(`  بمرحلتها: ${Object.entries(byStage).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
  console.log(`  وتبقى مفتوحةً: ${open - rows.length}`);
  if (!APPLY) { console.log('  — تجربة، بلا كتابة. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // Last day of the transaction's master month at noon Riyadh time; rows without a month use their entry date.
  const closedAt = (r) => (r.periodYear && r.periodMonth
    ? new Date(Date.UTC(r.periodYear, r.periodMonth, 0, 9, 0, 0))
    : new Date(r.createdAt));
  let done = 0;
  for (const r of rows) {
    const res = await CustomsClearance.updateOne(
      { _id: r._id, isCompleted: { $ne: true } },
      { $set: { isCompleted: true, completedAt: closedAt(r), completedBy: null, completedByName: BY } },
      { timestamps: false },
    );
    done += res.modifiedCount || 0;
  }
  try { require('../utils/ttlCache').clear('customs:'); } catch (_) { /* */ }
  const left = await CustomsClearance.countDocuments({ upcoming: { $ne: true }, cancelled: { $ne: true }, isCompleted: { $ne: true } });
  const closed = await CustomsClearance.countDocuments({ isCompleted: true });
  console.log(`  أُغلقت: ${done} · المغلقةُ الآن ${closed} · المفتوحةُ ${left}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
