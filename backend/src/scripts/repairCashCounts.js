/**
 * repairCashCounts: make 'counted cash' and 'difference' tell the truth. Usage: node src/scripts/repairCashCounts.js [--dry|--apply]. The two fields were written once at close and never updated, while the closing balance changes afterwards (added or edited movements, or a
 * correction on an earlier day cascading forward). - `actualCash` was filled with a copy of the closing balance when nobody counted (auto close, or manual close without a count), making 'not counted' and 'counted and matched' identical. - `cashDifference` is stored rather
 * than derived, so yesterday's difference stays attributed to today's closing. Real vs copied counts are told apart from the audit log: a `close_wallet_day` entry stores what was sent. If it carries `actualCash`, a human counted it: it is kept and its difference is re-derived
 * from the current closing. If not, or the close was automatic, both fields are cleared. No guessing: a day with no audit entry keeps its count and only the difference is re-derived. Showing a possibly real difference is better than erasing a count that happened.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  require('../models/User');
  const DailyWallet = require('../models/DailyWallet');
  const AuditLog = require('../models/AuditLog');
  require('../models/Branch');

  const days = await DailyWallet.find({}).populate('branch', 'name').sort({ date: 1 });
  const rows = [];

  for (const w of days) {
    const stored = w.cashDifference == null ? null : r2(w.cashDifference);
    const actual = w.actualCash == null ? null : r2(w.actualCash);
    const closing = r2(w.closingBalance);

    // Was this day's cash actually counted?
    let counted;
    if (w.autoClosedNote) counted = false;              // The system closed it: no count
    else if (actual == null) counted = false;           // Already empty
    else {
      const log = await AuditLog.findOne({ entity: 'DailyWallet', entityId: w._id, action: 'close_wallet_day' })
        .sort({ createdAt: -1 }).lean();
      const sent = log && log.changes && log.changes.after
        ? log.changes.after.actualCash : undefined;
      // No audit entry, so no guessing: keep the count and fix only the difference.
      counted = log ? (sent !== undefined && sent !== null) : true;
    }

    const newActual = counted ? actual : null;
    const newDiff = newActual == null ? null : r2(closing - newActual);
    if (newActual === actual && newDiff === stored) continue;

    rows.push({
      w,
      branch: w.branch?.name || '—',
      date: w.date,
      closing,
      oldActual: actual,
      newActual,
      oldDiff: stored,
      newDiff,
      counted,
    });
  }

  console.log(`\n  ${APPLY ? '' : '— تجربة، بلا كتابة —\n'}  ${rows.length} يومًا يحتاج تصحيحًا من ${days.length}\n`);
  if (rows.length) {
    console.log('  الفرع'.padEnd(14) + 'اليوم'.padStart(12) + 'ختامي'.padStart(12)
      + 'معدود قبل'.padStart(12) + 'معدود بعد'.padStart(12)
      + 'فرق قبل'.padStart(11) + 'فرق بعد'.padStart(11) + '   الحكم');
    console.log('  ' + '─'.repeat(104));
    for (const r of rows) {
      console.log('  ' + String(r.branch).padEnd(12) + String(r.date).padStart(12) + String(r.closing).padStart(12)
        + String(r.oldActual == null ? '—' : r.oldActual).padStart(12)
        + String(r.newActual == null ? '—' : r.newActual).padStart(12)
        + String(r.oldDiff == null ? '—' : r.oldDiff).padStart(11)
        + String(r.newDiff == null ? '—' : r.newDiff).padStart(11)
        + `   ${r.counted ? 'عُدَّ — الفرقُ يُعاد اشتقاقُه' : 'لم يُعَدّ — تُفرَّغ الخانتان'}`);
    }
  }

  if (APPLY) {
    for (const r of rows) {
      r.w.actualCash = r.newActual;
      r.w.cashDifference = r.newDiff;
      await r.w.save();
    }
    console.log(`\n  ✔ صُحّح ${rows.length} يومًا.`);
    try { require('../websocket/socketManager').emitToAll('wallet:updated', {}); } catch (_) { /* outside the server */ }
  } else if (rows.length) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }

  // Post-write check: the identity holds across the whole ledger.
  const after = await DailyWallet.find({}).lean();
  const broken = after.filter((d) => {
    if (d.actualCash == null) return d.cashDifference != null;
    return r2(d.cashDifference) !== r2((d.closingBalance || 0) - d.actualCash);
  });
  console.log(`\n  ${broken.length === 0 ? '✔' : '✘'} الفرق = الختامي − المعدود في ${after.length - broken.length} من ${after.length} يومًا`
    + (broken.length ? ` — مخالِف ${broken.length}` : ''));
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
