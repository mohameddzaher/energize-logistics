const crypto = require('crypto');
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

// Repoint a set of duplicate reps' daily orders into a canonical rep, then
// delete the duplicates. Used by both the auto-merge below and the manual
// /reconcile endpoint, so the dedup logic only lives in one place.
async function mergeRepGroup(canonicalId, dupIds) {
  if (!dupIds || dupIds.length === 0) return { ordersRepointed: 0, ordersDropped: 0 };
  const canonicalDates = new Set(
    (await B2CDailyOrder.find({ rep: canonicalId }).select('dateKey').lean())
      .map((d) => d.dateKey)
  );
  const dupOrders = await B2CDailyOrder.find({ rep: { $in: dupIds } })
    .select('_id dateKey updatedAt')
    .sort({ updatedAt: -1 }) // prefer freshest dup if multiple share a day
    .lean();
  const toRepoint = [];
  const toDelete = [];
  for (const o of dupOrders) {
    if (canonicalDates.has(o.dateKey)) {
      toDelete.push(o._id);
    } else {
      toRepoint.push(o._id);
      canonicalDates.add(o.dateKey);
    }
  }
  if (toRepoint.length > 0) {
    await B2CDailyOrder.updateMany({ _id: { $in: toRepoint } }, { $set: { rep: canonicalId } });
  }
  if (toDelete.length > 0) {
    await B2CDailyOrder.deleteMany({ _id: { $in: toDelete } });
  }
  await B2CRep.deleteMany({ _id: { $in: dupIds } });
  return { ordersRepointed: toRepoint.length, ordersDropped: toDelete.length };
}

// Fu ll duplicate-rep reconciliation. Identity = NAME within scope. Account
// ID is intentionally NOT used for grouping: in the Keeta sheet a single
// Account ID is shared across multiple physical drivers, so merging by ID
// would collapse genuinely-different people into one.
async function reconcileAllReps() {
  const reps = await B2CRep.find({}).lean();
  if (reps.length === 0) return { mergedGroups: 0, repsRemoved: 0, ordersRepointed: 0 };

  const normalize = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const orderCounts = await B2CDailyOrder.aggregate([
    { $group: { _id: '$rep', count: { $sum: 1 } } },
  ]);
  const ordersByRep = new Map(orderCounts.map((o) => [String(o._id), o.count]));

  const enScopeGroups = new Map();   // "en|projectId|branchId" → reps
  const enLegacyGroups = new Map();  // "en" → reps with no scope set
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of reps) {
    const en = normalize(r.englishName);
    if (!en) continue;
    if (r.project && r.branch) {
      push(enScopeGroups, `${en}|${String(r.project)}|${String(r.branch)}`, r);
    } else {
      push(enLegacyGroups, en, r);
    }
  }

  // Group candidates: any rep with the same name in the same scope + any
  // legacy unscoped rep with the same name (to be merged into the scoped
  // one when we walk the scoped rep).
  const buildGroup = (rep) => {
    const en = normalize(rep.englishName);
    if (!en) return [rep];
    const seen = new Map();
    const add = (r) => seen.set(String(r._id), r);
    if (rep.project && rep.branch) {
      (enScopeGroups.get(`${en}|${String(rep.project)}|${String(rep.branch)}`) || []).forEach(add);
    }
    (enLegacyGroups.get(en) || []).forEach(add);
    return [...seen.values()];
  };

  let mergedGroups = 0;
  let repsRemoved = 0;
  let ordersRepointed = 0;
  const visited = new Set();

  for (const rep of reps) {
    if (visited.has(String(rep._id))) continue;
    const list = buildGroup(rep);
    list.forEach((r) => visited.add(String(r._id)));
    if (list.length < 2) continue;

    // Reps that belong to genuinely different (project, branch) pairs are
    // different people — don't merge across them.
    const scopedReps = list.filter((r) => r.project && r.branch);
    const distinctScopedPairs = new Set(scopedReps.map((r) => `${String(r.project)}|${String(r.branch)}`));
    if (distinctScopedPairs.size > 1) continue;
    if (scopedReps.length === 0) continue;

    // Canonical = the rep with the most daily orders (preserves the most
    // data); tiebreaker = oldest createdAt. Must be one of the scoped reps.
    const sortedScoped = [...scopedReps].sort((a, b) => {
      const ca = ordersByRep.get(String(a._id)) || 0;
      const cb = ordersByRep.get(String(b._id)) || 0;
      if (cb !== ca) return cb - ca;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    const canonical = sortedScoped[0];
    const dupIds = list.filter((r) => String(r._id) !== String(canonical._id)).map((r) => r._id);
    if (dupIds.length === 0) continue;

    const { ordersRepointed: rep1 } = await mergeRepGroup(canonical._id, dupIds);
    ordersRepointed += rep1;
    repsRemoved += dupIds.length;
    mergedGroups++;
  }

  return { mergedGroups, repsRemoved, ordersRepointed };
}

// Run one sync pass for a specific config.
async function syncOnce({ configId, user, mode, force = false } = {}) {
  if (!configId) throw new Error('configId is required');
  const started = Date.now();
  const config = await B2CGoogleSheetSync.findById(configId);
  if (!config) throw new Error('Sync config not found');
  if (!config.sheetId) throw new Error('Sheet ID not set on config');
  const effectiveMode = mode || config.syncMode || 'overwrite';

  // Self-healing: collapse any duplicate reps left over from prior syncs
  // BEFORE the hash gate. The cron tick runs every minute; if the sheet
  // bytes haven't changed we'd otherwise short-circuit and the existing
  // dupes would linger forever between sheet edits.
  try {
    const merged = await reconcileAllReps();
    if (merged.mergedGroups > 0) {
      console.log(`[B2C sync ${config._id}] auto-reconciled ${merged.mergedGroups} dup group(s) — removed ${merged.repsRemoved}, repointed ${merged.ordersRepointed}`);
      try { emitToAll('b2c:cleanup', merged); } catch (_) {}
    }
  } catch (e) {
    console.error(`[B2C sync ${config._id}] auto-reconcile failed:`, e.message);
  }

  const buffer = await downloadSheet(config.sheetId);

  // Skip the rest of the work if the sheet bytes haven't changed since the
  // last successful sync. The cron fires every minute by default, so this
  // saves a parse + (often a no-op) bulkWrite when nobody's editing.
  // `force` flag lets the manual "Sync Now" button bypass the cache.
  //
  // Auto-heal: if no daily orders exist for this config's project+branch the
  // DB is in a "needs re-ingest" state (e.g. right after a Cleanup). Bypass
  // the hash gate so the cron picks the data back up without the user having
  // to remember to click "Sync Now".
  const sheetHash = crypto.createHash('sha1').update(buffer).digest('hex');
  if (!force && config.lastSheetHash && config.lastSheetHash === sheetHash) {
    const dbHasData = await B2CDailyOrder.exists({
      project: config.project,
      branch: config.branch,
    });
    if (dbHasData) {
      await B2CGoogleSheetSync.updateOne(
        { _id: config._id },
        { $set: { lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncMessage: 'No changes detected' } }
      );
      return { unchanged: true, durationMs: Date.now() - started };
    }
    console.log(`[B2C sync ${config._id}] hash unchanged but DB has no orders for this scope — re-ingesting`);
  }

  const parsed = parseRepsExcel(buffer);
  if (parsed.records.length === 0) {
    throw new Error('No records found in sheet (no monthly tabs detected, or all empty).');
  }

  const { reps: incoming, buildKey } = buildResolverPayload(parsed.records);

  // Within-batch dedup. Identity = the rep's NAME, not Account ID. The Keeta
  // sheet legitimately reuses one Account ID across multiple physical drivers
  // (shared platform account, different shifts) — keying on Account ID would
  // collapse them into one rep and lose orders. Two rows with the same name
  // ARE the same person (duplicate entry in the source); two rows with the
  // same ID but different names are NOT.
  const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonicalByName = new Map();
  for (const r of incoming) {
    const en = normalizeName(r.englishName);
    const id = String(r.repId == null ? '' : r.repId).trim();
    let canonicalKey;
    if (en) canonicalKey = `name:${en}`;
    else if (id) canonicalKey = `id:${id}`; // only when no name at all (rare)
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

  // Match against existing reps. Load EVERY rep once and match in memory.
  // B2C rep counts are small (hundreds, not millions) so a full scan is cheap.
  //
  // Identity = the rep's NAME within (project, branch) scope. The Keeta
  // sheet reuses Account IDs across multiple physical drivers (shared
  // platform account), so Account ID is reference-only — never an identity
  // key. Matching by Account ID would collapse different people into one.
  //
  // Within scope, prefer the in-scope rep, then any legacy unscoped rep
  // with the same name (claim it and backfill scope).
  const allReps = await B2CRep.find({}).lean();
  const sameId = (a, b) => a && b && String(a) === String(b);
  const inScope = (r) => sameId(r.project, config.project) && sameId(r.branch, config.branch);
  const noScope = (r) => !r.project && !r.branch;

  const byEnAny = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of allReps) {
    const en = normalizeName(r.englishName);
    if (en) push(byEnAny, en, r);
  }

  const pickFrom = (list) => {
    if (!list || list.length === 0) return null;
    return list.find(inScope) || list.find(noScope) || null;
  };

  const pickMatch = (canon) => {
    const en = normalizeName(canon.englishName);
    if (!en) return null;
    return pickFrom(byEnAny.get(en));
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

  // Prune stale orphans. The sync above is upsert-only, so any (rep, day) that
  // was ingested by a PREVIOUS sync but is no longer backed by a current sheet
  // row lingers forever. That happens when a sheet row is deleted, or when a
  // rep's NAME changes (identity = name → a new rep is created and the old
  // rep's days are orphaned). Both inflate the dashboard's day totals because
  // those totals sum EVERY B2CDailyOrder for the branch+date, current or not.
  //
  // In overwrite mode the sheet is authoritative: within the months it covers,
  // delete every excel-sourced (rep, dateKey) that isn't in this sync's entry
  // set. We scope to source:'excel' so manual entries are never touched, and to
  // only the months actually present in the sheet so we never wipe a month the
  // sheet doesn't include.
  let pruned = 0;
  if (effectiveMode === 'overwrite' && entries.length > 0) {
    const validPairs = new Set(entries.map((e) => `${e.rep}:${e.dateKey}`));
    const monthPairs = [...new Set(entries.map((e) => `${e.year}:${e.month}`))]
      .map((s) => { const [year, month] = s.split(':').map(Number); return { year, month }; });
    const existing = await B2CDailyOrder.find({
      project: config.project,
      branch: config.branch,
      source: 'excel',
      $or: monthPairs,
    }).select('_id rep dateKey').lean();
    const orphanIds = existing
      .filter((d) => !validPairs.has(`${d.rep}:${d.dateKey}`))
      .map((d) => d._id);
    if (orphanIds.length > 0) {
      for (let i = 0; i < orphanIds.length; i += CHUNK) {
        try { await B2CDailyOrder.deleteMany({ _id: { $in: orphanIds.slice(i, i + CHUNK) } }); } catch (_) { /* continue */ }
      }
      pruned = orphanIds.length;
      console.log(`[B2C sync ${config._id}] pruned ${pruned} stale orphan order(s) no longer in the sheet`);
    }
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
    ignoredSheets: parsed.ignoredSheets || [],
    warnings: (parsed.warnings || []).slice(0, 20),
    recordsParsed: parsed.records.length,
    repsCreated: actuallyCreated,
    daysInserted: inserted,
    daysUpdated: updated,
    daysSkipped: skipped,
    daysPruned: pruned,
    durationMs: Date.now() - started,
  };
  await B2CGoogleSheetSync.updateOne(
    { _id: config._id },
    { $set: { lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncMessage: '', lastSyncStats: stats, lastSheetHash: sheetHash } }
  );

  try { emitToAll('b2c:sheet:synced', { configId: String(config._id), stats }); } catch (_) {}
  console.log(`[B2C google-sheet sync ${config._id}] OK in ${stats.durationMs}ms — inserted=${inserted} updated=${updated} skipped=${skipped} pruned=${pruned} created_reps=${actuallyCreated}`);

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

module.exports = {
  syncOnce,
  startSyncScheduler,
  extractSheetId,
  enqueueWebhookSync,
  migrateLegacySingletonIndex,
  reconcileAllReps,
  downloadSheet,
};
