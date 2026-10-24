/**
 * سجلُّ التفقّد يُمسح بعد أربعة عشر يومًا (صاحبُ الشركة، ٢٠٢٦/١٠/٢٣).
 *
 * «التفقّد اللي يعدّي عليه ١٤ يوم يتمسح خالص — مش عاوزين نشوفه تاني ولا يتخزّن».
 * صورُ التفقّد أثقلُ ما على قرص الخادم (قرابة ١ جيجا وتزيد كلَّ يوم)، ثمّ تُضاعَف
 * في النسخ الاحتياطيّة اليوميّة الأربع عشرة. والتفقّدُ شاهدٌ على يومه: إن لم
 * يُرجَع إليه في أسبوعين فلن يُرجَع إليه.
 *
 * فيُحذف كلُّ تفقّدٍ يومُه (`dateKey`) أقدمُ من أربعة عشر يومًا بتوقيت الرياض:
 * صفُّه، وكلُّ ملفٍّ يشير إليه، وسجلُّ تدقيقه (AuditLog) — لا يبقى منه شيء.
 * ثمّ يُكنَس مجلّدُ `uploads/b2c-duty` من أيّ صورةٍ أقدمَ من ذلك لا يملكها صفّ
 * (رفعٌ انقطع قبل الحفظ). والنسخُ الاحتياطيّة تنظف وحدَها في أسبوعين، لأنّها
 * تُدار بالدوران نفسِه.
 *
 * يعمل في النسخة الأولى وحدها (server.js — runsJobs)، بعد الإقلاع ثمّ كلَّ ست ساعات.
 */
const fs = require('fs');
const path = require('path');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const AuditLog = require('../models/AuditLog');
const { deleteStoredFile, UPLOAD_ROOT } = require('../utils/fileStore');

const KEEP_DAYS = 14;
const DIR = path.join(UPLOAD_ROOT, 'b2c-duty');

const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
/** أوّلُ يومٍ يبقى: اليومُ وثلاثةَ عشرَ قبله — ما قبله يُمسح. */
const cutoffKey = (now = new Date()) => riyadhDay(new Date(now.getTime() - (KEEP_DAYS - 1) * 86400000));

/** كلُّ رابطِ ملفٍّ في الصفّ أينما كان — الصور، وما قد يُضاف بعدها. */
function fileUrlsOf(v, out = []) {
  if (!v || typeof v !== 'object') return out;
  if (Array.isArray(v)) { v.forEach((x) => fileUrlsOf(x, out)); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && x.startsWith('/api/uploads/') && /url/i.test(k)) out.push(x);
    else if (x && typeof x === 'object' && !(x instanceof Date) && !(x && x._bsontype)) fileUrlsOf(x, out);
  }
  return out;
}

async function purge(now = new Date()) {
  const cutoff = cutoffKey(now);
  let rows = 0; let files = 0;
  for (;;) {
    const batch = await B2CDutyCheck.find({ dateKey: { $lt: cutoff } }).limit(300).lean();
    if (!batch.length) break;
    for (const d of batch) for (const u of fileUrlsOf(d)) { deleteStoredFile(u); files += 1; }
    const ids = batch.map((d) => d._id);
    await AuditLog.deleteMany({ entity: 'B2CDutyCheck', entityId: { $in: ids } }).catch(() => {});
    rows += (await B2CDutyCheck.deleteMany({ _id: { $in: ids } })).deletedCount || 0;
  }
  // وما بقي في المجلّد بلا صفٍّ وقد تجاوز المدّة — يومٌ زيادةً احتياطًا لفرق التوقيت.
  let orphans = 0;
  try {
    const limit = now.getTime() - (KEEP_DAYS + 1) * 86400000;
    for (const name of fs.readdirSync(DIR)) {
      const abs = path.join(DIR, name);
      const st = fs.statSync(abs);
      if (st.isFile() && st.mtimeMs < limit) { fs.unlinkSync(abs); orphans += 1; }
    }
  } catch (e) { if (e.code !== 'ENOENT') console.error('[duty-purge] dir:', e.message); }
  if (rows || orphans) console.log(`[duty-purge] before ${cutoff}: ${rows} checks, ${files} files, ${orphans} stray files removed`);
  return { cutoff, rows, files, orphans };
}

function startB2cDutyPurge() {
  const run = () => purge().catch((e) => console.error('[duty-purge]', e.message));
  setTimeout(run, 3 * 60 * 1000);
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { startB2cDutyPurge, purge, cutoffKey, KEEP_DAYS };
