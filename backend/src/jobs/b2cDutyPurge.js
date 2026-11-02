/**
 * Duty-check rows older than 14 days (Riyadh time, by `dateKey`) are deleted with their files and AuditLog entries; photos are the heaviest data on the server disk and are multiplied by daily backups.
 * The uploads/b2c-duty folder is also swept of orphan photos (uploads cut off before save). Runs on the first instance only (server.js runsJobs), after boot and every six hours.
 */
const fs = require('fs');
const path = require('path');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const AuditLog = require('../models/AuditLog');
const { deleteStoredFile, UPLOAD_ROOT } = require('../utils/fileStore');

const KEEP_DAYS = 14;
const DIR = path.join(UPLOAD_ROOT, 'b2c-duty');

const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
/** First day kept: today and the 13 days before it; anything older is purged. */
const cutoffKey = (now = new Date()) => riyadhDay(new Date(now.getTime() - (KEEP_DAYS - 1) * 86400000));

/** Every file link on the row, wherever it is stored: photos and any fields added later. */
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
    // Guard: only files inside the duty-check folder are deleted, even if a row links elsewhere (e.g. HR files).
    for (const d of batch) for (const u of fileUrlsOf(d)) {
      if (!u.startsWith('/api/uploads/b2c-duty/')) continue;
      deleteStoredFile(u); files += 1;
    }
    const ids = batch.map((d) => d._id);
    await AuditLog.deleteMany({ entity: 'B2CDutyCheck', entityId: { $in: ids } }).catch(() => {});
    rows += (await B2CDutyCheck.deleteMany({ _id: { $in: ids } })).deletedCount || 0;
  }
  // Unowned files past the retention window; one extra day absorbs timezone skew.
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
