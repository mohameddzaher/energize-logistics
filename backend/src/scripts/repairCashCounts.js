/**
 * repairCashCounts — يجعل «النقد المعدود» و«الفرق» يقولان الحقيقة.
 *
 *   node src/scripts/repairCashCounts.js --dry
 *   node src/scripts/repairCashCounts.js --apply
 *
 * ── ما الذي اختلّ ───────────────────────────────────────────────────────────
 * خانتان كانتا تُكتبان مرّةً عند الإقفال ثمّ لا تُمَسّان، بينما يتغيّر الختاميُّ
 * بعدهما — حركةٌ تُضاف أو تُعدَّل، أو تصحيحٌ في يومٍ سابق يتدحرج على ما بعده:
 *
 *   `actualCash`      كان يُملأ بنسخةٍ من الختاميّ حين لا يعدّ أحدٌ النقد —
 *                     في الإقفال التلقائيّ، وفي إقفالٍ يدويٍّ بلا إدخال عدّ.
 *                     فصار «لم يُعَدّ» و«عُدَّ فطابق تمامًا» شيئًا واحدًا.
 *   `cashDifference`  رقمٌ مخزَّنٌ لا مشتَقّ، فيبقى فرقُ أمسِ منسوبًا إلى
 *                     ختاميِّ اليوم.
 *
 * ── وكيف يُعرَف المعدودُ الحقيقيُّ من المنسوخ ───────────────────────────────
 * من سجلّ المراجعة نفسِه: قيدُ `close_wallet_day` يحفظ ما أُرسل. فإن حمل
 * `actualCash` فقد عدّه إنسانٌ وأدخله — وهو واقعةٌ لا تُمَسّ، ويُعاد اشتقاقُ
 * فرقِها من الختاميِّ الجاري. وإن لم يحمله — أو كان الإقفال تلقائيًّا — فلا
 * عدَّ هناك، وتُفرَّغ الخانتان.
 *
 * ولا يُخمَّن: اليومُ الذي لا قيدَ له في السجلّ يُترَك معدودُه كما هو ويُعاد
 * اشتقاق فرقِه فقط. إظهارُ فرقٍ ربّما كان حقيقيًّا أهونُ من محو عدٍّ وقع.
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

    // أعُدَّ نقدُ هذا اليوم فعلًا؟
    let counted;
    if (w.autoClosedNote) counted = false;              // النظام أقفله — لا عدّ
    else if (actual == null) counted = false;           // فارغٌ أصلًا
    else {
      const log = await AuditLog.findOne({ entity: 'DailyWallet', entityId: w._id, action: 'close_wallet_day' })
        .sort({ createdAt: -1 }).lean();
      const sent = log && log.changes && log.changes.after
        ? log.changes.after.actualCash : undefined;
      // لا قيدَ في السجلّ ⇒ لا يُخمَّن: يبقى المعدودُ ويُصحَّح الفرقُ وحده.
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
    try { require('../websocket/socketManager').emitToAll('wallet:updated', {}); } catch (_) { /* خارج الخادم */ }
  } else if (rows.length) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }

  // والتحقّقُ بعد الكتابة: الهُويّةُ تصدق على الدفتر كلِّه.
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
