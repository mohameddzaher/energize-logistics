const mongoose = require('mongoose');
const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');
const B2CRep = require('../models/B2CRep');
const B2CDailyOrder = require('../models/B2CDailyOrder');
const B2CExcelUpload = require('../models/B2CExcelUpload');
const { parseRepsExcel, buildResolverPayload, buildDailyEntries } = require('../utils/b2cExcelParser');
const { emitToAll } = require('../websocket/socketManager');

// Extract the Google Sheets ID from any of the URL formats Google produces.
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
  // `nocache` plus a unique timestamp defeat any CDN/edge caching so we always
  // see the latest edits the user just made in Google Sheets.
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx&nocache=${Date.now()}`;
}

async function downloadSheet(sheetId) {
  const url = buildExportUrl(sheetId);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
  if (!res.ok) {
    throw new Error(`Google Sheets returned HTTP ${res.status}. Make sure the sheet is set to "Anyone with the link can view".`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('Google returned an HTML page instead of the sheet. The sheet is probably private — open share settings and set to "Anyone with the link can view".');
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Run one sync pass for a specific config.
async function syncOnce({ configId, user, mode } = {}) {
  if (!configId) throw new Error('configId is required');
  const started = Date.now();
  const config = await B2CGoogleSheetSync.findById(configId);
  if (!config) throw new Error('Sync config not found');
  if (!config.sheetId) throw new Error('Sheet ID not set on config');
  const effectiveMode = mode || config.syncMode || 'overwrite';

  const buffer = await downloadSheet(config.sheetId);

  const parsed = parseRepsExcel(buffer);
  if (parsed.records.length === 0) {
    throw new Error('No records found in sheet (no monthly tabs detected, or all empty).');
  }

  const { reps: incoming, buildKey } = buildResolverPayload(parsed.records);

  // Dedup incoming by canonicalKey
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
        project: config.project,
        branch: config.branch,
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

  // Match against existing reps. Load EVERY rep once and match in memory using
  // the same normalized canonical key the parser uses. Pulling the full set
  // avoids case/whitespace mismatches in MongoDB $in queries and lets us fall
  // back to single-name matches for legacy data. B2C rep counts are small
  // (hundreds, not millions) so this is cheap.
  //
  // Match priority per parsed rep:
  //   1. Exact canonical key (en|ar normalized) within (project, branch) scope.
  //   2. Same canonical key with no scope yet → claim it, backfill scope.
  //   3. English-only or Arabic-only canonical match within scope → claim it.
  //   4. Same single-name match with no scope → claim it, backfill.
  //   5. None → create a fresh rep in this scope.
  const allReps = await B2CRep.find({}).lean();
  const sameId = (a, b) => a && b && String(a) === String(b);
  const inScope = (r) => sameId(r.project, config.project) && sameId(r.branch, config.branch);
  const noScope = (r) => !r.project && !r.branch;

  // Build lookup tables keyed by normalized names
  const byCanonical = new Map();   // "en|ar" → reps
  const byEnOnly = new Map();      // "en" → reps where Arabic is empty
  const byArOnly = new Map();      // "ar" → reps where English is missing
  const byEnAny = new Map();       // "en" → all reps with that English (regardless of Arabic)
  const byArAny = new Map();       // "ar" → all reps with that Arabic
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of allReps) {
    const en = normalizeName(r.englishName);
    const ar = normalizeName(r.arabicName);
    if (en || ar) push(byCanonical, `${en}|${ar}`, r);
    if (en) push(byEnAny, en, r);
    if (ar) push(byArAny, ar, r);
    if (en && !ar) push(byEnOnly, en, r);
    if (ar && !en) push(byArOnly, ar, r);
  }

  const pickFrom = (list) => {
    if (!list || list.length === 0) return null;
    return list.find(inScope) || list.find(noScope) || null;
  };

  const pickMatch = (canon) => {
    const en = normalizeName(canon.englishName);
    const ar = normalizeName(canon.arabicName);
    // 1+2: exact canonical
    let m = pickFrom(byCanonical.get(`${en}|${ar}`));
    if (m) return m;
    // 3+4: English-only fallback (parser has only EN, or DB has only EN)
    if (en) {
      m = pickFrom(byEnOnly.get(en)) || (!ar ? pickFrom(byEnAny.get(en)) : null);
      if (m) return m;
    }
    // 3+4: Arabic-only fallback
    if (ar) {
      m = pickFrom(byArOnly.get(ar)) || (!en ? pickFrom(byArAny.get(ar)) : null);
      if (m) return m;
    }
    return null;
  };

  const canonicalToDbId = new Map();
  const toCreate = [];
  for (const [canonicalKey, canon] of canonicalByName) {
    const match = pickMatch(canon);
    if (match) {
      canonicalToDbId.set(canonicalKey, String(match._id));
      const updates = {};
      if (canon.repId && match.repId !== canon.repId) updates.repId = canon.repId;
      if (canon.englishName && match.englishName !== canon.englishName) updates.englishName = canon.englishName;
      if (canon.arabicName && match.arabicName !== canon.arabicName) updates.arabicName = canon.arabicName;
      // Backfill scope on legacy reps so future syncs match exactly.
      if (!match.project) updates.project = config.project;
      if (!match.branch) updates.branch = config.branch;
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
          project: canon.project,
          branch: canon.branch,
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
      for (const t of toCreate) {
        try {
          const c = await B2CRep.create(t.payload);
          canonicalToDbId.set(t.canonicalKey, String(c._id));
          actuallyCreated++;
        } catch (_) { /* skip */ }
      }
    }
  }

  const keyToDbId = new Map();
  for (const [canonicalKey, dbId] of canonicalToDbId) keyToDbId.set(canonicalKey, dbId);
  const entries = buildDailyEntries(parsed.records, keyToDbId, buildKey);

  let inserted = 0, updated = 0, skipped = 0;
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
    if (exists && effectiveMode === 'merge_new_only') { skipped++; continue; }
    const computedWorked = e.orders !== null && e.orders > 0;
    ops.push({
      updateOne: {
        filter: { rep: e.rep, dateKey: e.dateKey },
        update: {
          $set: {
            rep: e.rep,
            project: config.project,
            branch: config.branch,
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

  await B2CExcelUpload.create({
    fileName: `Google Sheet (${config.sheetId.slice(0, 8)}…)`,
    project: config.project,
    branch: config.branch,
    monthsDetected: parsed.monthsDetected,
    repsDetected: canonicalByName.size,
    repsCreated: actuallyCreated,
    daysInserted: inserted,
    daysUpdated: updated,
    daysSkipped: skipped,
    warnings: parsed.warnings.slice(0, 100),
    uploadedBy: user ? user._id : undefined,
    mode: effectiveMode,
  });

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
    { _id: config._id },
    { $set: { lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncMessage: '', lastSyncStats: stats } }
  );

  try { emitToAll('b2c:sheet:synced', { configId: String(config._id), stats }); } catch (_) {}
  console.log(`[B2C google-sheet sync ${config._id}] OK in ${stats.durationMs}ms — inserted=${inserted} updated=${updated} skipped=${skipped} created_reps=${actuallyCreated}`);

  return stats;
}

// ────────────────────────────────────────────────────────────────────────────
// Real-time webhook sync (debounced per config)
// ────────────────────────────────────────────────────────────────────────────
// Apps Script in each user's sheet pings our webhook on every edit. We debounce
// per-config so a flurry of edits in one sheet triggers ONE sync, while edits
// in different sheets sync independently.
const webhookState = new Map(); // configId → { timer, syncing, pendingAfterCurrent }

function enqueueWebhookSync(configId) {
  const id = String(configId);
  let state = webhookState.get(id);
  if (!state) {
    state = { timer: null, syncing: false, pendingAfterCurrent: false };
    webhookState.set(id, state);
  }
  if (state.syncing) {
    state.pendingAfterCurrent = true;
    return;
  }
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    state.timer = null;
    state.syncing = true;
    try {
      await syncOnce({ configId: id });
    } catch (e) {
      console.error(`[B2C webhook sync ${id}] FAILED:`, e.message);
      try {
        await B2CGoogleSheetSync.updateOne(
          { _id: id },
          { $set: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: e.message } }
        );
      } catch (_) {}
    } finally {
      state.syncing = false;
      if (state.pendingAfterCurrent) {
        state.pendingAfterCurrent = false;
        enqueueWebhookSync(id);
      }
    }
  }, 2000);
}

// ────────────────────────────────────────────────────────────────────────────
// Cron-driven scheduler
// ────────────────────────────────────────────────────────────────────────────
let cronTimer = null;

// Older deploys had a singleton index `singleton_1` on the collection. Drop it on
// startup so the new (project, branch) compound unique index can take over.
async function migrateLegacySingletonIndex() {
  try {
    const indexes = await B2CGoogleSheetSync.collection.indexes();
    const legacy = indexes.find((i) => i.name === 'singleton_1');
    if (legacy) {
      await B2CGoogleSheetSync.collection.dropIndex('singleton_1');
      console.log('[B2C google-sheet sync] dropped legacy singleton_1 index');
    }
  } catch (e) {
    // Index may not exist on fresh installs — that's fine.
  }
}

function startSyncScheduler() {
  if (cronTimer) return;
  const tick = async () => {
    try {
      const configs = await B2CGoogleSheetSync.find({ enabled: true, sheetId: { $ne: null } });
      const now = Date.now();
      for (const config of configs) {
        if (!config.sheetId) continue;
        const last = config.lastSyncAt ? config.lastSyncAt.getTime() : 0;
        const due = (now - last) >= (config.intervalMinutes * 60 * 1000);
        if (!due) continue;
        try {
          await syncOnce({ configId: String(config._id) });
        } catch (e) {
          await B2CGoogleSheetSync.updateOne(
            { _id: config._id },
            { $set: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: e.message } }
          );
          console.error(`[B2C google-sheet sync ${config._id}] FAILED:`, e.message);
        }
      }
    } catch (e) {
      console.error('[B2C google-sheet sync] scheduler error:', e.message);
    }
  };
  cronTimer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 10 * 1000);
  console.log('[B2C google-sheet sync] scheduler started');
}

module.exports = { syncOnce, startSyncScheduler, extractSheetId, enqueueWebhookSync, migrateLegacySingletonIndex };
