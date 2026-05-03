const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');
const B2CRep = require('../models/B2CRep');
const B2CDailyOrder = require('../models/B2CDailyOrder');
const B2CExcelUpload = require('../models/B2CExcelUpload');
const { parseRepsExcel, buildResolverPayload, buildDailyEntries } = require('../utils/b2cExcelParser');
const { emitToAll } = require('../websocket/socketManager');

// Extract the Google Sheets ID from any of the URL formats Google produces.
// Examples it handles:
//   https://docs.google.com/spreadsheets/d/{ID}/edit
//   https://docs.google.com/spreadsheets/d/{ID}/edit?usp=sharing
//   https://drive.google.com/file/d/{ID}/view
function extractSheetId(url) {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/file\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function buildExportUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
}

// Download the sheet as XLSX. Requires the sheet to be set to "Anyone with the link
// can view". Returns a Buffer ready to feed into parseRepsExcel.
async function downloadSheet(sheetId) {
  const url = buildExportUrl(sheetId);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Google Sheets returned HTTP ${res.status}. Make sure the sheet is set to "Anyone with the link can view".`);
  }
  const ct = res.headers.get('content-type') || '';
  // Google sometimes returns an HTML login page when the sheet isn't public — detect that
  if (ct.includes('text/html')) {
    throw new Error('Google returned an HTML page instead of the sheet. The sheet is probably private — open share settings and set to "Anyone with the link can view".');
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Run one sync pass: download → parse → resolve reps → bulk upsert daily orders.
// Returns sync stats for storage in the config doc.
async function syncOnce({ user, mode = 'merge_new_only' } = {}) {
  const started = Date.now();
  const config = await B2CGoogleSheetSync.findOne({ singleton: 'config' });
  if (!config) throw new Error('No Google Sheet sync config found');
  if (!config.sheetId) throw new Error('Sheet ID not set on config');

  // Step 1: download
  const buffer = await downloadSheet(config.sheetId);

  // Step 2: parse
  const parsed = parseRepsExcel(buffer);
  if (parsed.records.length === 0) {
    throw new Error('No records found in sheet (no monthly tabs detected, or all empty).');
  }

  // Step 3: resolve reps (mirror bulkResolveReps logic — match by name)
  const { reps: incoming, buildKey } = buildResolverPayload(parsed.records);

  // Dedup incoming by canonicalKey (multiple records for same person collapse)
  const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonicalByName = new Map();
  for (const r of incoming) {
    const en = normalizeName(r.englishName);
    const ar = normalizeName(r.arabicName);
    let canonicalKey;
    if (en || ar) canonicalKey = `name:${en}|ar:${ar}`;
    else if (r.repId) canonicalKey = `id:${r.repId}`;
    else continue;
    let canon = canonicalByName.get(canonicalKey);
    if (!canon) {
      canon = {
        englishName: r.englishName || null,
        arabicName: r.arabicName || null,
        repId: r.repId || null,
        joiningDate: r.joiningDate || null,
        project: config.project || undefined,
        branch: config.branch || undefined,
        monthlyTarget: r.monthlyTarget || 400,
        dailyTarget: r.dailyTarget || 15,
      };
      canonicalByName.set(canonicalKey, canon);
    }
    if (r.englishName) canon.englishName = r.englishName;
    if (r.arabicName) canon.arabicName = r.arabicName;
    if (r.repId) canon.repId = r.repId;
    if (!canon.joiningDate && r.joiningDate) canon.joiningDate = r.joiningDate;
  }

  // Step 4: match against existing reps by exact (en, ar)
  const candidateNames = [...canonicalByName.values()].map((c) => c.englishName).filter(Boolean);
  const existingReps = candidateNames.length > 0
    ? await B2CRep.find({ englishName: { $in: candidateNames } }).lean()
    : [];
  const existingByNameAr = new Map();
  existingReps.forEach((r) => {
    const en = normalizeName(r.englishName);
    const ar = normalizeName(r.arabicName);
    existingByNameAr.set(`${en}|${ar}`, r);
  });

  const canonicalToDbId = new Map();
  const toCreate = [];
  for (const [canonicalKey, canon] of canonicalByName) {
    const en = normalizeName(canon.englishName);
    const ar = normalizeName(canon.arabicName);
    const match = existingByNameAr.get(`${en}|${ar}`);
    if (match) {
      canonicalToDbId.set(canonicalKey, String(match._id));
      const updates = {};
      if (canon.repId && match.repId !== canon.repId) updates.repId = canon.repId;
      if (canon.englishName && match.englishName !== canon.englishName) updates.englishName = canon.englishName;
      if (canon.arabicName && match.arabicName !== canon.arabicName) updates.arabicName = canon.arabicName;
      if (Object.keys(updates).length > 0) {
        await B2CRep.updateOne({ _id: match._id }, { $set: updates });
      }
    } else {
      toCreate.push({
        canonicalKey,
        payload: {
          englishName: canon.englishName || canon.repId || 'Unknown',
          arabicName: canon.arabicName || undefined,
          repId: canon.repId || undefined,
          joiningDate: canon.joiningDate || undefined,
          project: canon.project || undefined,
          branch: canon.branch || undefined,
          monthlyTarget: canon.monthlyTarget,
          dailyTarget: canon.dailyTarget,
          createdBy: user ? user._id : undefined,
        },
      });
    }
  }

  let actuallyCreated = 0;
  if (toCreate.length > 0) {
    try {
      const created = await B2CRep.insertMany(toCreate.map((t) => t.payload), { ordered: false });
      created.forEach((c, i) => {
        canonicalToDbId.set(toCreate[i].canonicalKey, String(c._id));
        actuallyCreated++;
      });
    } catch (e) {
      // Fallback to one-by-one
      for (const t of toCreate) {
        try {
          const c = await B2CRep.create(t.payload);
          canonicalToDbId.set(t.canonicalKey, String(c._id));
          actuallyCreated++;
        } catch (_) { /* skip */ }
      }
    }
  }

  // Step 5: build daily entries using the resolved IDs
  const keyToDbId = new Map();
  for (const [canonicalKey, dbId] of canonicalToDbId) keyToDbId.set(canonicalKey, dbId);
  const entries = buildDailyEntries(parsed.records, keyToDbId, buildKey);

  // Step 6: bulk-upsert daily orders
  let inserted = 0, updated = 0, skipped = 0;

  // Find existing pairs
  const repIds = [...new Set(entries.map((e) => String(e.rep)))];
  const dateKeys = [...new Set(entries.map((e) => e.dateKey))];
  const existingDocs = repIds.length > 0
    ? await B2CDailyOrder.find({
        rep: { $in: repIds },
        dateKey: { $in: dateKeys },
      }).select('rep dateKey').lean()
    : [];
  const existingSet = new Set(existingDocs.map((d) => `${d.rep}:${d.dateKey}`));

  const ops = [];
  for (const e of entries) {
    const pairKey = `${e.rep}:${e.dateKey}`;
    const exists = existingSet.has(pairKey);
    if (exists && mode === 'merge_new_only') { skipped++; continue; }
    const computedWorked = e.orders !== null && e.orders > 0;
    ops.push({
      updateOne: {
        filter: { rep: e.rep, dateKey: e.dateKey },
        update: {
          $set: {
            rep: e.rep,
            date: new Date(`${e.dateKey}T00:00:00.000Z`),
            dateKey: e.dateKey,
            year: e.year, month: e.month, day: e.day,
            orders: e.orders,
            worked: computedWorked,
            source: 'excel',
            enteredBy: user ? user._id : undefined,
            sourceSheet: e.sourceSheet || null,
            sourceRow: e.sourceRow || null,
          },
        },
        upsert: true,
      },
    });
    if (exists) updated++; else inserted++;
  }

  const CHUNK = 1000;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    try { await B2CDailyOrder.bulkWrite(chunk, { ordered: false }); } catch (_) { /* continue */ }
  }

  // Persist upload-history doc
  await B2CExcelUpload.create({
    fileName: `Google Sheet (${config.sheetId.slice(0, 8)}…)`,
    project: config.project || undefined,
    branch: config.branch || undefined,
    monthsDetected: parsed.monthsDetected,
    repsDetected: canonicalByName.size,
    repsCreated: actuallyCreated,
    daysInserted: inserted,
    daysUpdated: updated,
    daysSkipped: skipped,
    warnings: parsed.warnings.slice(0, 100),
    uploadedBy: user ? user._id : undefined,
    mode,
  });

  // Update sync config with stats
  const stats = {
    monthsDetected: parsed.monthsDetected,
    recordsParsed: parsed.records.length,
    repsCreated: actuallyCreated,
    daysInserted: inserted,
    daysUpdated: updated,
    daysSkipped: skipped,
    durationMs: Date.now() - started,
  };
  await B2CGoogleSheetSync.updateOne(
    { singleton: 'config' },
    { $set: { lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncMessage: '', lastSyncStats: stats } }
  );

  try { emitToAll('b2c:sheet:synced', stats); } catch (_) {}
  console.log(`[B2C google-sheet sync] OK in ${stats.durationMs}ms — inserted=${inserted} updated=${updated} skipped=${skipped} created_reps=${actuallyCreated}`);

  return stats;
}

// Cron-driven scheduler. Reads the singleton config and re-fires syncOnce when
// (now - lastSyncAt) >= intervalMinutes. Cheap: runs every minute, only does work when due.
let cronTimer = null;

function startSyncScheduler() {
  if (cronTimer) return;
  const tick = async () => {
    try {
      const config = await B2CGoogleSheetSync.findOne({ singleton: 'config' });
      if (!config || !config.enabled || !config.sheetId) return;
      const now = Date.now();
      const last = config.lastSyncAt ? config.lastSyncAt.getTime() : 0;
      const due = (now - last) >= (config.intervalMinutes * 60 * 1000);
      if (!due) return;
      try {
        await syncOnce({ mode: 'merge_new_only' });
      } catch (e) {
        await B2CGoogleSheetSync.updateOne(
          { singleton: 'config' },
          { $set: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: e.message } }
        );
        console.error('[B2C google-sheet sync] FAILED:', e.message);
      }
    } catch (e) {
      console.error('[B2C google-sheet sync] scheduler error:', e.message);
    }
  };
  cronTimer = setInterval(tick, 60 * 1000); // every minute
  // Run once shortly after startup
  setTimeout(tick, 10 * 1000);
  console.log('[B2C google-sheet sync] scheduler started');
}

module.exports = { syncOnce, startSyncScheduler, extractSheetId };
