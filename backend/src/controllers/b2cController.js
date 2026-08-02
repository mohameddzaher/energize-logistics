const mongoose = require('mongoose');
const B2CProject = require('../models/B2CProject');
const B2CRep = require('../models/B2CRep');
const B2CDailyOrder = require('../models/B2CDailyOrder');
const B2CExcelUpload = require('../models/B2CExcelUpload');
const Branch = require('../models/Branch');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');

// Short-lived caches so re-selecting/switching months is instant instead of
// recomputing the whole dashboard each time. Data changes via sheet-sync/manual
// entry bust the cache (cache.clear('b2c:')), so staleness is bounded.
const B2C_DASH_TTL = 5 * 60 * 1000; // 5 دقائق — البيانات تُزامَن ببطء، فالكاش يخفي زمن الحساب البارد
const B2C_LIST_TTL = 60 * 1000;
const { emitToAll } = require('../websocket/socketManager');

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');
const buildDateKey = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

const isB2CHead = (user) => user?.role === 'b2c_head' || user?.role === 'super_admin' || user?.role === 'admin';
// Project managers currently have the same visibility/permissions as heads.
const isB2CMember = (user) => isB2CHead(user) || user?.role === 'b2c_project_manager';

// Build a scope filter. Project managers are treated as full-access for now —
// the assignedProjects/assignedBranches plumbing is kept on the User model so we
// can re-enable scoping later without another migration.
const buildScope = async (user) => {
  if (isB2CMember(user)) return { projectIds: null, branchIds: null }; // null = all
  return { projectIds: [], branchIds: [] };
};

const applyScope = (filter, scope) => {
  if (scope.projectIds && scope.projectIds.length > 0) {
    filter.project = { $in: scope.projectIds };
  } else if (scope.projectIds && scope.projectIds.length === 0) {
    filter._noResults = true; // sentinel
  }
  return filter;
};

// ────────────────────────────────────────────────────────────────────────────
// PROJECTS
// ────────────────────────────────────────────────────────────────────────────

exports.getProjects = async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.isActive = true;

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0) {
      filter._id = { $in: scope.projectIds };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ projects: [] });
    }

    const projects = await B2CProject.find(filter).sort({ name: 1 });
    res.json({ projects });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load projects' });
  }
};

exports.createProject = async (req, res) => {
  try {
    const { name, code, description, color, monthlyTarget, dailyTarget, expectedWorkingDays } = req.body;
    const project = await B2CProject.create({
      name, code, description, color, monthlyTarget, dailyTarget, expectedWorkingDays,
      createdBy: req.user._id,
    });
    await logAudit({ user: req.user._id, action: 'create_b2c_project', entity: 'B2CProject', entityId: project._id, changes: { after: { name, code } }, ipAddress: req.ip });
    cache.clear('b2c:');
    try { emitToAll('b2c:project:created', { project }); } catch (e) {}
    res.status(201).json({ project });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Project name or code already exists' });
    res.status(500).json({ message: error.message || 'Failed to create project' });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const { name, code, description, color, monthlyTarget, dailyTarget, expectedWorkingDays, isActive } = req.body;
    const project = await B2CProject.findByIdAndUpdate(
      req.params.id,
      { name, code, description, color, monthlyTarget, dailyTarget, expectedWorkingDays, isActive },
      { new: true, runValidators: true }
    );
    if (!project) return res.status(404).json({ message: 'Project not found' });
    await logAudit({ user: req.user._id, action: 'update_b2c_project', entity: 'B2CProject', entityId: project._id, changes: { after: { name, code, isActive } }, ipAddress: req.ip });
    cache.clear('b2c:');
    try { emitToAll('b2c:project:updated', { project }); } catch (e) {}
    res.json({ project });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Project name or code already exists' });
    res.status(500).json({ message: error.message || 'Failed to update project' });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await B2CProject.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    await B2CRep.updateMany({ project: project._id }, { $unset: { project: 1 } });
    await logAudit({ user: req.user._id, action: 'delete_b2c_project', entity: 'B2CProject', entityId: project._id, changes: { before: { name: project.name } }, ipAddress: req.ip });
    try { emitToAll('b2c:project:deleted', { projectId: project._id }); } catch (e) {}
    res.json({ message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete project' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// REPS
// ────────────────────────────────────────────────────────────────────────────

exports.getReps = async (req, res) => {
  try {
    const repsCacheKey = `b2c:reps:${req.user._id}:${JSON.stringify(req.query || {})}`;
    const cachedReps = cache.get(repsCacheKey);
    if (cachedReps) return res.json(cachedReps);

    const filter = {};
    if (req.query.active === 'true') filter.isActive = true;
    if (req.query.project) filter.project = req.query.project;
    if (req.query.branch) filter.branch = req.query.branch;
    if (req.query.search) {
      filter.$or = [
        { englishName: { $regex: req.query.search, $options: 'i' } },
        { arabicName: { $regex: req.query.search, $options: 'i' } },
        { repId: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0) {
      const projectFilter = { $in: scope.projectIds };
      filter.project = filter.project ? { $in: scope.projectIds.filter((id) => id.toString() === filter.project) } : projectFilter;
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ reps: [] });
    }

    const reps = await B2CRep.find(filter)
      .populate('project', 'name code color monthlyTarget dailyTarget expectedWorkingDays')
      .populate('branch', 'name code city')
      .sort({ englishName: 1 })
      .lean();
    const payload = { reps };
    cache.set(repsCacheKey, payload, B2C_LIST_TTL);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load reps' });
  }
};

exports.createRep = async (req, res) => {
  try {
    const { repId, arabicName, englishName, phone, joiningDate, project, branch, monthlyTarget, dailyTarget, expectedWorkingDays, notes } = req.body;

    if (!englishName) return res.status(400).json({ message: 'English name is required' });

    const rep = await B2CRep.create({
      repId: repId || undefined,
      arabicName, englishName, phone,
      joiningDate: joiningDate || undefined,
      project: project || undefined,
      branch: branch || undefined,
      monthlyTarget: monthlyTarget || 400,
      dailyTarget: dailyTarget || 15,
      expectedWorkingDays: expectedWorkingDays || 26,
      notes,
      createdBy: req.user._id,
    });

    await logAudit({ user: req.user._id, action: 'create_b2c_rep', entity: 'B2CRep', entityId: rep._id, changes: { after: { englishName, repId } }, ipAddress: req.ip });
    try { emitToAll('b2c:rep:created', { rep }); } catch (e) {}

    const populated = await B2CRep.findById(rep._id).populate('project', 'name code').populate('branch', 'name code city');
    cache.clear('b2c:');
    res.status(201).json({ rep: populated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create rep' });
  }
};

exports.updateRep = async (req, res) => {
  try {
    const updates = req.body;
    const rep = await B2CRep.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('project', 'name code')
      .populate('branch', 'name code city');
    if (!rep) return res.status(404).json({ message: 'Rep not found' });

    await logAudit({ user: req.user._id, action: 'update_b2c_rep', entity: 'B2CRep', entityId: rep._id, ipAddress: req.ip });
    cache.clear('b2c:');
    try { emitToAll('b2c:rep:updated', { rep }); } catch (e) {}
    res.json({ rep });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update rep' });
  }
};

// Bulk create or match reps by repId/englishName. Returns map of resolved rep IDs.
// Body: { reps: [{ key, repId, englishName, arabicName, joiningDate, project, branch, monthlyTarget, dailyTarget }] }
//
// Matching is robust to the case where the SAME person appears in different sheets
// with/without an Iqama: we merge incoming entries by normalized name first, prefer
// the entry that has an Iqama, and emit one canonical rep per identity.
exports.bulkResolveReps = async (req, res) => {
  try {
    const { reps: incoming, project: defaultProject, branch: defaultBranch } = req.body;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ message: 'No reps provided' });
    }

    const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // Identity rules — PERSON-BASED (the human, not the account):
    //   - The same app account ID can be used by DIFFERENT people on different shifts.
    //     Each row in the sheet represents ONE person's work, even when account IDs collide.
    //   - Track each rep by their NAME (englishName + arabicName). Account ID is metadata.
    //   - If only an account ID is present (no name at all), fall back to id-based bucket.
    const canonicalByName = new Map(); // canonicalKey -> rep payload
    for (const r of incoming) {
      const en = normalizeName(r.englishName);
      const ar = normalizeName(r.arabicName);
      const incomingKey = r.key || `name:${en}|ar:${ar}|id:${r.repId || ''}`;

      let canonicalKey;
      if (en || ar) {
        canonicalKey = `name:${en}|ar:${ar}`;
      } else if (r.repId) {
        canonicalKey = `id:${r.repId}`;
      } else {
        continue; // no identity at all
      }

      let canon = canonicalByName.get(canonicalKey);
      if (!canon) {
        canon = {
          name: r.englishName || r.arabicName || r.repId || 'Unknown',
          arabicName: r.arabicName || null,
          repId: r.repId || null,
          joiningDate: r.joiningDate || null,
          project: r.project || defaultProject || null,
          branch: r.branch || defaultBranch || null,
          monthlyTarget: r.monthlyTarget || 400,
          dailyTarget: r.dailyTarget || 15,
          incomingKeys: [],
        };
        canonicalByName.set(canonicalKey, canon);
      }
      if (r.englishName) canon.name = r.englishName;
      if (r.arabicName) canon.arabicName = r.arabicName;
      // Latest known account ID for this person (they may use different accounts over time)
      if (r.repId) canon.repId = r.repId;
      if (!canon.joiningDate && r.joiningDate) canon.joiningDate = r.joiningDate;
      canon.incomingKeys.push(incomingKey);
    }

    // Step 2: pre-fetch ALL existing reps by candidate names + repIds
    const allCandidateNames = [...canonicalByName.values()].map((c) => c.name).filter(Boolean);
    const allCandidateIds = [...canonicalByName.values()].map((c) => c.repId).filter(Boolean);
    const existing = (allCandidateNames.length > 0 || allCandidateIds.length > 0)
      ? await B2CRep.find({
          $or: [
            ...(allCandidateIds.length > 0 ? [{ repId: { $in: allCandidateIds } }] : []),
            ...(allCandidateNames.length > 0 ? [{ englishName: { $in: allCandidateNames } }] : []),
          ],
        }).lean()
      : [];

    const existingByRepId = new Map();
    const existingByNameAr = new Map(); // "en|ar" -> rep doc
    existing.forEach((r) => {
      if (r.repId) existingByRepId.set(r.repId, r);
      const en = normalizeName(r.englishName);
      const ar = normalizeName(r.arabicName);
      if (en || ar) existingByNameAr.set(`${en}|${ar}`, r);
    });

    // Step 3: for each canonical rep, find existing match or queue creation
    const canonicalToDbId = new Map(); // canonicalKey -> db _id
    const toCreate = [];

    for (const [canonicalKey, canon] of canonicalByName) {
      let match = null;
      // PERSON-BASED match strategy:
      //   - First, look up by exact (englishName, arabicName) — the canonical person identity
      //   - If no name at all, fall back to account-ID match
      const en = normalizeName(canon.name);
      const ar = normalizeName(canon.arabicName);
      if (en || ar) {
        match = existingByNameAr.get(`${en}|${ar}`) || null;
      }
      if (!match && canon.repId) {
        match = existingByRepId.get(canon.repId);
      }

      if (match) {
        canonicalToDbId.set(canonicalKey, String(match._id));
        // Update the existing rep's metadata with latest data
        const updates = {};
        if (canon.name && match.englishName !== canon.name) updates.englishName = canon.name;
        if (canon.arabicName && match.arabicName !== canon.arabicName) updates.arabicName = canon.arabicName;
        if (canon.repId && match.repId !== canon.repId) updates.repId = canon.repId;
        if (Object.keys(updates).length > 0) {
          await B2CRep.updateOne({ _id: match._id }, { $set: updates });
        }
      } else {
        toCreate.push({
          canonicalKey,
          payload: {
            englishName: canon.name,
            arabicName: canon.arabicName || undefined,
            repId: canon.repId || undefined,
            joiningDate: canon.joiningDate || undefined,
            project: canon.project || undefined,
            branch: canon.branch || undefined,
            monthlyTarget: canon.monthlyTarget,
            dailyTarget: canon.dailyTarget,
            createdBy: req.user._id,
          },
        });
      }
    }

    // Build the result array. Map each incoming key back to its canonical rep's db id.
    const buildResult = () => {
      const out = [];
      for (const [canonicalKey, canon] of canonicalByName) {
        const dbId = canonicalToDbId.get(canonicalKey);
        if (!dbId) continue;
        for (const incomingKey of canon.incomingKeys) {
          out.push({ key: incomingKey, repId: dbId, created: false });
        }
      }
      return out;
    };
    const result = buildResult();

    let actuallyCreated = 0;
    if (toCreate.length > 0) {
      const docs = toCreate.map((t) => t.payload);
      try {
        const created = await B2CRep.insertMany(docs, { ordered: false });
        created.forEach((c, i) => {
          canonicalToDbId.set(toCreate[i].canonicalKey, String(c._id));
          actuallyCreated++;
        });
      } catch (insertErr) {
        // Some inserts may have failed — fall back to one-by-one create
        for (const t of toCreate) {
          try {
            const c = await B2CRep.create(t.payload);
            canonicalToDbId.set(t.canonicalKey, String(c._id));
            actuallyCreated++;
          } catch (e) { /* skip duplicates / bad rows */ }
        }
      }
      // Re-emit result entries for newly-created reps
      for (const t of toCreate) {
        const dbId = canonicalToDbId.get(t.canonicalKey);
        if (!dbId) continue;
        const canon = canonicalByName.get(t.canonicalKey);
        if (!canon) continue;
        for (const incomingKey of canon.incomingKeys) {
          result.push({ key: incomingKey, repId: dbId, created: true });
        }
      }
    }

    const matched = result.filter((r) => !r.created).length;
    console.log(`[B2C bulk-resolve] incoming=${incoming.length} canonical=${canonicalByName.size} matched=${matched} created=${actuallyCreated}`);
    try { emitToAll('b2c:rep:bulk', { count: actuallyCreated }); } catch (e) {}

    res.json({ resolved: result, createdCount: actuallyCreated });
  } catch (error) {
    console.error('Bulk resolve reps error:', error);
    res.status(500).json({ message: error.message || 'Failed to resolve reps' });
  }
};

exports.deleteRep = async (req, res) => {
  try {
    const rep = await B2CRep.findByIdAndDelete(req.params.id);
    if (!rep) return res.status(404).json({ message: 'Rep not found' });
    // Keep daily orders by default (historical records). Cascade only if explicitly requested.
    if (req.query.cascade === 'true') {
      await B2CDailyOrder.deleteMany({ rep: rep._id });
    }
    await logAudit({ user: req.user._id, action: 'delete_b2c_rep', entity: 'B2CRep', entityId: rep._id, changes: { before: { englishName: rep.englishName } }, ipAddress: req.ip });
    try { emitToAll('b2c:rep:deleted', { repId: rep._id }); } catch (e) {}
    res.json({ message: 'Rep deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete rep' });
  }
};

// Live-parses the configured Google Sheet RIGHT NOW and returns the full
// per-tab parse diagnostic — used to figure out why a specific month tab
// isn't showing up on the dashboard. Doesn't write anything to MongoDB.
exports.diagnoseSheetParse = async (req, res) => {
  try {
    const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');
    const { downloadSheet } = require('../services/b2cGoogleSheetSyncService');
    const { parseRepsExcel } = require('../utils/b2cExcelParser');
    const XLSX = require('xlsx');

    const config = req.params.id
      ? await B2CGoogleSheetSync.findById(req.params.id).lean()
      : await B2CGoogleSheetSync.findOne({}).lean();
    if (!config) return res.status(404).json({ message: 'No sync config found' });
    if (!config.sheetId) return res.status(400).json({ message: 'Config has no sheetId' });

    const buffer = await downloadSheet(config.sheetId);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetNames = wb.SheetNames;

    const parsed = parseRepsExcel(buffer);

    // For every sheet that matched a month tab, dump the first 15 rows × first
    // 15 columns. That's enough to spot misnamed identity columns, shifted
    // header rows, or merged cells. We do this raw (not via the parser) so we
    // see exactly what xlsx sees.
    const dumpFirstRows = (sheet) => {
      if (!sheet || !sheet['!ref']) return null;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const out = [];
      const maxR = Math.min(15, range.e.r + 1);
      const maxC = Math.min(15, range.e.c + 1);
      for (let r = 0; r <= maxR; r++) {
        const row = [];
        for (let c = 0; c <= maxC; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[ref];
          row.push(cell == null ? null : (cell.v == null ? null : String(cell.v).slice(0, 40)));
        }
        out.push(row);
      }
      return out;
    };

    const tabs = sheetNames.map((name) => {
      const isMonthTab = !parsed.ignoredSheets.includes(name);
      return {
        sheetName: name,
        matchedAsMonth: isMonthTab,
        firstRows: isMonthTab ? dumpFirstRows(wb.Sheets[name]) : null,
      };
    });

    res.json({
      sheetId: config.sheetId,
      sheetNamesInWorkbook: sheetNames,
      monthsDetected: parsed.monthsDetected,
      ignoredSheets: parsed.ignoredSheets,
      warnings: parsed.warnings,
      tabs,
    });
  } catch (error) {
    console.error('[B2C diagnose-sheet] error:', error);
    res.status(500).json({ message: error.message || 'Sheet diagnostic failed' });
  }
};

// Returns a one-shot snapshot of B2C state — sync configs, DB counts, latest
// dateKeys, and a per-month breakdown. Use this when "no data is showing"
// to figure out whether the bug is in ingestion, in storage, or in display.
exports.getSystemDiagnostic = async (req, res) => {
  try {
    const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');

    const [configs, totalOrders, totalReps, totalProjects] = await Promise.all([
      B2CGoogleSheetSync.find({})
        .populate('project', 'name')
        .populate('branch', 'name')
        .lean(),
      B2CDailyOrder.countDocuments({}),
      B2CRep.countDocuments({}),
      B2CProject.countDocuments({}),
    ]);

    let monthBreakdown = [];
    let earliestDateKey = null;
    let latestDateKey = null;
    if (totalOrders > 0) {
      const agg = await B2CDailyOrder.aggregate([
        { $group: { _id: { year: '$year', month: '$month' }, count: { $sum: 1 }, totalOrders: { $sum: { $ifNull: ['$orders', 0] } }, days: { $addToSet: '$day' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);
      monthBreakdown = agg.map((m) => ({
        year: m._id.year,
        month: m._id.month,
        rowCount: m.count,
        totalOrders: m.totalOrders,
        uniqueDays: m.days.length,
        days: m.days.sort((a, b) => a - b),
      }));
      const oldestDoc = await B2CDailyOrder.findOne({}, { dateKey: 1 }).sort({ dateKey: 1 }).lean();
      const newestDoc = await B2CDailyOrder.findOne({}, { dateKey: 1 }).sort({ dateKey: -1 }).lean();
      earliestDateKey = oldestDoc?.dateKey || null;
      latestDateKey = newestDoc?.dateKey || null;
    }

    res.json({
      now: new Date().toISOString(),
      counts: {
        totalOrders,
        totalReps,
        totalProjects,
        totalConfigs: configs.length,
      },
      configs: configs.map((c) => ({
        _id: String(c._id),
        sheetId: c.sheetId || null,
        project: c.project?.name || null,
        branch: c.branch?.name || null,
        intervalMinutes: c.intervalMinutes,
        syncMode: c.syncMode,
        lastSyncAt: c.lastSyncAt,
        lastSyncStatus: c.lastSyncStatus,
        lastSyncMessage: c.lastSyncMessage,
        lastSyncStats: c.lastSyncStats,
        lastSheetHash: c.lastSheetHash ? `${c.lastSheetHash.slice(0, 8)}…` : null,
      })),
      data: {
        earliestDateKey,
        latestDateKey,
        monthBreakdown,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Diagnostic failed' });
  }
};

// Diagnostic endpoint: shows the current rep set, daily-order counts, and
// any duplicate clusters that would be merged on the next sync. Useful when
// the dashboard's totals look wrong and we need to see what's actually in
// MongoDB without exporting the whole collection.
exports.diagnoseReps = async (req, res) => {
  try {
    const reps = await B2CRep.find({})
      .populate('project', 'name')
      .populate('branch', 'name')
      .lean();
    const orderCountAgg = await B2CDailyOrder.aggregate([
      { $group: { _id: '$rep', count: { $sum: 1 }, totalOrders: { $sum: '$orders' } } },
    ]);
    const ordersByRep = new Map(orderCountAgg.map((o) => [String(o._id), o]));
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

    const summarised = reps.map((r) => ({
      _id: String(r._id),
      englishName: r.englishName || null,
      arabicName: r.arabicName || null,
      repId: r.repId || null,
      project: r.project?.name || null,
      branch: r.branch?.name || null,
      orderDocs: ordersByRep.get(String(r._id))?.count || 0,
      totalOrders: ordersByRep.get(String(r._id))?.totalOrders || 0,
    }));

    // Cluster reps that should be the same person.
    const clusters = new Map();
    for (const r of summarised) {
      const id = (r.repId || '').trim();
      const en = norm(r.englishName);
      const scope = `${r.project || '?'}|${r.branch || '?'}`;
      const key = id ? `id:${id}|${scope}` : (en ? `name:${en}|${scope}` : `_id:${r._id}`);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(r);
    }
    const dupClusters = [...clusters.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, members: list }));

    res.json({
      totalReps: reps.length,
      duplicateClusters: dupClusters.length,
      duplicates: dupClusters,
      reps: summarised,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Diagnostics failed' });
  }
};

// Manual rep dedup. Thin wrapper around the same reconcileAllReps used
// auto-magically by every sync — keeps both code paths in lockstep.
exports.reconcileReps = async (req, res) => {
  try {
    const { reconcileAllReps } = require('../services/b2cGoogleSheetSyncService');
    const result = await reconcileAllReps();
    if (result.mergedGroups > 0) {
      try { emitToAll('b2c:cleanup', result); } catch (_) {}
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Reconcile reps error:', error);
    res.status(500).json({ message: error.message || 'Failed to reconcile reps' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DAILY ORDERS
// ────────────────────────────────────────────────────────────────────────────

exports.getDailyOrders = async (req, res) => {
  try {
    const filter = {};
    if (req.query.rep) filter.rep = req.query.rep;
    if (req.query.project) filter.project = req.query.project;
    if (req.query.branch) filter.branch = req.query.branch;
    if (req.query.year) filter.year = Number(req.query.year);
    if (req.query.month) filter.month = Number(req.query.month);
    if (req.query.dateFrom || req.query.dateTo) {
      filter.dateKey = {};
      if (req.query.dateFrom) filter.dateKey.$gte = req.query.dateFrom;
      if (req.query.dateTo) filter.dateKey.$lte = req.query.dateTo;
    }

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0) {
      filter.project = filter.project ? filter.project : { $in: scope.projectIds };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ orders: [] });
    }

    const orders = await B2CDailyOrder.find(filter)
      .populate('rep', 'englishName arabicName repId')
      .populate('project', 'name code color')
      .populate('branch', 'name code city')
      .sort({ dateKey: -1 })
      .lean();
    res.json({ orders });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load daily orders' });
  }
};

// Upsert one entry. Body: { rep, dateKey (YYYY-MM-DD) OR (year, month, day), orders, worked, source, notes }
exports.upsertDailyOrder = async (req, res) => {
  try {
    const { rep: repId, dateKey, year, month, day, orders, worked, source, notes } = req.body;
    if (!repId) return res.status(400).json({ message: 'Rep is required' });

    let key = dateKey;
    let y = year, m = month, d = day;
    if (!key) {
      if (!y || !m || !d) return res.status(400).json({ message: 'Date is required' });
      key = buildDateKey(y, m, d);
    } else {
      const [ys, ms, ds] = key.split('-').map(Number);
      y = ys; m = ms; d = ds;
    }

    const rep = await B2CRep.findById(repId);
    if (!rep) return res.status(404).json({ message: 'Rep not found' });

    const dateObj = new Date(`${key}T00:00:00.000Z`);

    const ordersValue = orders === '' || orders === undefined || orders === null ? null : Number(orders);
    // 0 orders = rep did NOT work that day. Only positive orders count as worked.
    const computedWorked = worked !== undefined ? !!worked : (ordersValue !== null && ordersValue > 0);

    const existing = await B2CDailyOrder.findOne({ rep: rep._id, dateKey: key });
    let entry;
    if (existing) {
      existing.orders = ordersValue;
      existing.worked = computedWorked;
      existing.source = source || 'manual';
      existing.enteredBy = req.user._id;
      if (notes !== undefined) existing.notes = notes;
      existing.project = rep.project;
      existing.branch = rep.branch;
      await existing.save();
      entry = existing;
    } else {
      entry = await B2CDailyOrder.create({
        rep: rep._id,
        project: rep.project,
        branch: rep.branch,
        date: dateObj,
        dateKey: key,
        year: y, month: m, day: d,
        orders: ordersValue,
        worked: computedWorked,
        source: source || 'manual',
        enteredBy: req.user._id,
        notes,
      });
    }

    try { emitToAll('b2c:order:upserted', { order: entry }); } catch (e) {}
    cache.clear('b2c:'); // data changed → drop cached dashboards/lists
    res.json({ order: entry });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Entry already exists for this rep on this date' });
    res.status(500).json({ message: error.message || 'Failed to save daily order' });
  }
};

// Bulk upsert. Body: { mode: 'merge_new_only' | 'overwrite', entries: [{ rep, dateKey, orders, worked?, source? }, ...] }
// Uses MongoDB bulkWrite for efficient batch operations. Handles thousands of records in seconds.
exports.bulkUpsertDailyOrders = async (req, res) => {
  try {
    const { entries, mode = 'merge_new_only', source = 'manual', uploadMeta } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'No entries provided' });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];

    // Pre-fetch all reps in one query
    const repIds = [...new Set(entries.map((e) => String(e.rep)).filter(Boolean))];
    const reps = await B2CRep.find({ _id: { $in: repIds } }).lean();
    const repMap = new Map(reps.map((r) => [String(r._id), r]));

    // Pre-fetch existing entries to determine insert vs update
    const candidatePairs = [];
    const normalizedEntries = [];
    for (const entry of entries) {
      if (!entry.rep) { skipped++; continue; }
      const rep = repMap.get(String(entry.rep));
      if (!rep) { skipped++; continue; }

      let key = entry.dateKey;
      let y, m, d;
      if (!key && entry.year && entry.month && entry.day) {
        key = buildDateKey(entry.year, entry.month, entry.day);
        y = entry.year; m = entry.month; d = entry.day;
      } else if (key) {
        const [ys, ms, ds] = key.split('-').map(Number);
        y = ys; m = ms; d = ds;
      } else {
        skipped++; continue;
      }

      candidatePairs.push({ rep: rep._id, dateKey: key });
      normalizedEntries.push({ entry, rep, key, y, m, d });
    }

    // Find which (rep, dateKey) pairs already exist.
    // Use $in with deduplicated rep IDs + dateKeys (much faster than $or with thousands of clauses)
    let existingSet = new Set();
    if (candidatePairs.length > 0) {
      const uniqueRepIds = [...new Set(candidatePairs.map((p) => String(p.rep)))];
      const uniqueDateKeys = [...new Set(candidatePairs.map((p) => p.dateKey))];
      const existingDocs = await B2CDailyOrder.find({
        rep: { $in: uniqueRepIds },
        dateKey: { $in: uniqueDateKeys },
      }).select('rep dateKey').lean();
      existingSet = new Set(existingDocs.map((d) => `${d.rep}:${d.dateKey}`));
    }

    // Build bulkWrite operations
    const ops = [];
    for (const item of normalizedEntries) {
      const { entry, rep, key, y, m, d } = item;
      const pairKey = `${rep._id}:${key}`;
      const exists = existingSet.has(pairKey);

      if (exists && mode === 'merge_new_only') { skipped++; continue; }

      const ordersValue = entry.orders === '' || entry.orders === undefined || entry.orders === null
        ? null
        : Number(entry.orders);

      // 0 orders = rep did NOT work that day. Only positive orders count as worked.
      const computedWorked = ordersValue !== null && ordersValue > 0;

      const setFields = {
        rep: rep._id,
        project: rep.project || null,
        branch: rep.branch || null,
        date: new Date(`${key}T00:00:00.000Z`),
        dateKey: key,
        year: y, month: m, day: d,
        orders: ordersValue,
        worked: computedWorked,
        source,
        enteredBy: req.user._id,
        sourceSheet: entry.sourceSheet || null,
        sourceRow: entry.sourceRow || null,
      };

      ops.push({
        updateOne: {
          filter: { rep: rep._id, dateKey: key },
          update: { $set: setFields },
          upsert: true,
        },
      });

      if (exists) updated++; else inserted++;
    }

    // Sanity total — what the upload SHOULD result in if every op succeeds.
    // Frontend can compare this against the parser's per-month totals to catch any drift.
    const totalOrdersInPayload = ops.reduce((s, op) => {
      const v = op.updateOne?.update?.$set?.orders;
      return s + (typeof v === 'number' ? v : 0);
    }, 0);

    console.log(`[B2C bulk-upsert] entries=${entries.length} ops=${ops.length} mode=${mode} predicted_inserted=${inserted} predicted_updated=${updated} skipped=${skipped} total_orders=${totalOrdersInPayload}`);

    // Execute in chunks of 1000 to keep each operation manageable
    const CHUNK = 1000;
    let totalUpserted = 0, totalModified = 0;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK);
      try {
        const r = await B2CDailyOrder.bulkWrite(chunk, { ordered: false });
        totalUpserted += r.upsertedCount || 0;
        totalModified += r.modifiedCount || 0;
        console.log(`[B2C bulk-upsert] chunk ${Math.floor(i / CHUNK) + 1}: upserted=${r.upsertedCount} modified=${r.modifiedCount} matched=${r.matchedCount}`);
      } catch (e) {
        console.error(`[B2C bulk-upsert] chunk ${Math.floor(i / CHUNK) + 1} failed:`, e.message);
        errors.push(`Chunk ${Math.floor(i / CHUNK) + 1}: ${e.message}`);
      }
    }
    console.log(`[B2C bulk-upsert] DONE — totalUpserted=${totalUpserted} totalModified=${totalModified} totalOrdersWritten=${totalOrdersInPayload}`);

    // Persist upload history if metadata provided
    let uploadDoc = null;
    if (uploadMeta) {
      uploadDoc = await B2CExcelUpload.create({
        fileName: uploadMeta.fileName,
        project: uploadMeta.project || undefined,
        branch: uploadMeta.branch || undefined,
        monthsDetected: uploadMeta.monthsDetected || [],
        repsDetected: uploadMeta.repsDetected || 0,
        repsCreated: uploadMeta.repsCreated || 0,
        daysInserted: inserted,
        daysUpdated: updated,
        daysSkipped: skipped,
        warnings: [...(uploadMeta.warnings || []), ...errors].slice(0, 200),
        uploadedBy: req.user._id,
        mode,
      });
    }

    cache.clear('b2c:'); // data changed → drop cached dashboards/lists
    try { emitToAll('b2c:bulk:upserted', { inserted, updated, skipped }); } catch (e) {}
    res.json({
      inserted, updated, skipped,
      totalOrdersInPayload,
      errors: errors.slice(0, 50),
      upload: uploadDoc,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Bulk upsert failed' });
  }
};

exports.deleteDailyOrder = async (req, res) => {
  try {
    const order = await B2CDailyOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: 'Entry not found' });
    try { emitToAll('b2c:order:deleted', { id: order._id }); } catch (e) {}
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete entry' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD / ANALYTICS
// ────────────────────────────────────────────────────────────────────────────

exports.getDashboardSummary = async (req, res) => {
  try {
    // Serve an identical (user + filters) dashboard from cache — makes month
    // switching feel instant. Keyed by user (scope differs per user) + query.
    const cacheKey = `b2c:dash:${req.user._id}:${JSON.stringify(req.query || {})}`;
    const cachedDash = cache.get(cacheKey);
    if (cachedDash) return res.json(cachedDash);

    const filter = {};
    if (req.query.project) filter.project = new mongoose.Types.ObjectId(String(req.query.project));
    if (req.query.branch) filter.branch = new mongoose.Types.ObjectId(String(req.query.branch));
    if (req.query.rep) filter.rep = new mongoose.Types.ObjectId(String(req.query.rep));
    if (req.query.year) filter.year = Number(req.query.year);
    if (req.query.month) filter.month = Number(req.query.month);
    if (req.query.dateFrom || req.query.dateTo) {
      filter.dateKey = {};
      if (req.query.dateFrom) filter.dateKey.$gte = req.query.dateFrom;
      if (req.query.dateTo) filter.dateKey.$lte = req.query.dateTo;
    }

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0 && !filter.project) {
      filter.project = { $in: scope.projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({
        kpis: emptyKpis(),
        byMonth: [], byProject: [], byBranch: [], byRep: [],
        byDay: [], byDayOfWeek: [],
        monthsAvailable: [],
        topReps: [], bottomReps: [],
        topImprovers: [], topDecliners: [], mostConsistent: [],
        bestSingleDays: [], topTeamDays: [],
      });
    }

    // ── الأداء: نحسب التجميعات داخل قاعدة البيانات (aggregation) بدل تحميل عشرات
    // الآلاف من الصفوف إلى Node — التحميل الكامل كان ياخد ~68 ثانية ويجمّد حلقة
    // الأحداث (single-thread) فيبطّئ النظام كله. الآن الـ DB يجمّع والنتائج صغيرة.
    const repDefaults = { monthlyTarget: 400, dailyTarget: 15 };
    const [repsList, projsList, branchesList] = await Promise.all([
      B2CRep.find({}, 'englishName arabicName repId monthlyTarget dailyTarget expectedWorkingDays').lean(),
      B2CProject.find({}, 'name code color monthlyTarget dailyTarget').lean(),
      Branch.find({}, 'name code city').lean(),
    ]);
    const repMap2 = new Map(repsList.map((r) => [String(r._id), r]));
    const projMap2 = new Map(projsList.map((p) => [String(p._id), p]));
    const branchMap2 = new Map(branchesList.map((b) => [String(b._id), b]));

    const workedExpr = { $and: [{ $eq: ['$worked', true] }, { $ne: ['$orders', null] }] };
    const ordersNum = { $ifNull: ['$orders', 0] };
    const setCount = (arr) => (arr || []).filter((x) => x != null).length;
    const A = (extra) => B2CDailyOrder.aggregate([{ $match: filter }, ...extra]);

    // تجميعات متوازية داخل قاعدة البيانات (أسرع من $facet على هذا العنقود، وكلها
    // I/O لا تحجب حلقة الأحداث) بدل تحميل عشرات الآلاف من الصفوف إلى Node.
    const [repAgg, monthAgg, projAgg, branchAgg, dayAgg, dowAgg, repMonthAgg, bestDaysAgg, totalsAgg] = await Promise.all([
      A([{ $group: { _id: '$rep', totalOrders: { $sum: ordersNum }, workingDays: { $sum: { $cond: [workedExpr, 1, 0] } }, project: { $first: '$project' } } }]),
      A([{ $group: { _id: { year: '$year', month: '$month' }, totalOrders: { $sum: ordersNum }, workingDays: { $sum: { $cond: [workedExpr, 1, 0] } }, repsActive: { $addToSet: { $cond: [workedExpr, '$rep', null] } } } }]),
      A([{ $group: { _id: '$project', totalOrders: { $sum: ordersNum }, repsActive: { $addToSet: { $cond: [workedExpr, '$rep', null] } } } }]),
      A([{ $group: { _id: '$branch', totalOrders: { $sum: ordersNum }, repsActive: { $addToSet: { $cond: [workedExpr, '$rep', null] } } } }]),
      A([{ $group: { _id: '$dateKey', totalOrders: { $sum: ordersNum },
        worked: { $sum: { $cond: [{ $gt: [ordersNum, 0] }, 1, 0] } },
        repsActive: { $addToSet: { $cond: [{ $gt: [ordersNum, 0] }, '$rep', null] } },
        repsNotWorked: { $addToSet: { $cond: [{ $eq: ['$orders', 0] }, '$rep', null] } },
        repsAboveTarget: { $sum: { $cond: [{ $gte: [ordersNum, repDefaults.dailyTarget] }, 1, 0] } } } }]),
      A([{ $group: { _id: { $let: { vars: { d: { $dateFromString: { dateString: { $concat: ['$dateKey', 'T00:00:00.000Z'] }, onError: null, onNull: null } } }, in: { $cond: [{ $eq: ['$$d', null] }, -1, { $subtract: [{ $dayOfWeek: '$$d' }, 1] }] } } }, totalOrders: { $sum: ordersNum }, workingCells: { $sum: { $cond: [workedExpr, 1, 0] } } } }]),
      A([{ $group: { _id: { rep: '$rep', year: '$year', month: '$month' }, orders: { $sum: ordersNum }, workingDays: { $sum: { $cond: [workedExpr, 1, 0] } } } }]),
      B2CDailyOrder.aggregate([{ $match: { ...filter, worked: true, orders: { $gt: 0 } } }, { $sort: { orders: -1 } }, { $limit: 5 }, { $project: { rep: 1, project: 1, dateKey: 1, orders: 1 } }]),
      A([{ $group: { _id: null, totalOrders: { $sum: ordersNum }, totalWorkingDays: { $sum: { $cond: [workedExpr, 1, 0] } }, totalDaysOff: { $sum: { $cond: [{ $eq: ['$orders', 0] }, 1, 0] } }, totalNoDataDays: { $sum: { $cond: [{ $eq: ['$orders', null] }, 1, 0] } } } }]),
    ]);

    const tt = totalsAgg[0] || {};
    const totalOrders = tt.totalOrders || 0;
    const totalWorkingDays = tt.totalWorkingDays || 0;
    const avgDailyRate = totalWorkingDays > 0 ? totalOrders / totalWorkingDays : 0;
    const totalDaysOff = tt.totalDaysOff || 0;
    const totalNoDataDays = tt.totalNoDataDays || 0;

    const byRep = repAgg.map((r) => {
      const meta = repMap2.get(String(r._id)) || {};
      const dailyTarget = meta.dailyTarget || repDefaults.dailyTarget;
      return {
        repId: r._id, englishName: meta.englishName, arabicName: meta.arabicName,
        monthlyTarget: meta.monthlyTarget || repDefaults.monthlyTarget, dailyTarget,
        totalOrders: r.totalOrders, workingDays: r.workingDays,
        project: projMap2.get(String(r.project))?.name,
        dailyRate: r.workingDays > 0 ? r.totalOrders / r.workingDays : 0,
        performancePercent: r.workingDays > 0 ? (r.totalOrders / (r.workingDays * dailyTarget)) * 100 : 0,
      };
    }).sort((a, b) => b.totalOrders - a.totalOrders);

    const byMonth = monthAgg.map((m) => ({
      key: `${m._id.year}-${pad2(m._id.month)}`, year: m._id.year, month: m._id.month,
      totalOrders: m.totalOrders, workingDays: m.workingDays, repsActive: setCount(m.repsActive),
      avgDailyRate: m.workingDays > 0 ? m.totalOrders / m.workingDays : 0,
    })).sort((a, b) => a.key.localeCompare(b.key));

    const byProject = projAgg.map((p) => ({
      projectId: p._id, name: projMap2.get(String(p._id))?.name || '—', color: projMap2.get(String(p._id))?.color,
      totalOrders: p.totalOrders, repsActive: setCount(p.repsActive),
    })).sort((a, b) => b.totalOrders - a.totalOrders);

    const byBranch = branchAgg.map((b) => ({
      branchId: b._id, name: branchMap2.get(String(b._id))?.name || '—', city: branchMap2.get(String(b._id))?.city,
      totalOrders: b.totalOrders, repsActive: setCount(b.repsActive),
    })).sort((a, b) => b.totalOrders - a.totalOrders);

    const byDay = dayAgg.map((d) => {
      const targetSum = d.worked * repDefaults.dailyTarget;
      return {
        dateKey: d._id, totalOrders: d.totalOrders, repsActive: setCount(d.repsActive),
        repsNotWorked: setCount(d.repsNotWorked), worked: d.worked, targetSum,
        achievementPercent: targetSum > 0 ? (d.totalOrders / targetSum) * 100 : 0,
        repsAboveTarget: d.repsAboveTarget,
      };
    }).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // KPIs. Only reps who actually worked at least one day have a measurable
    // performance — reps added to the sheet but not yet working (all days
    // null/0) would otherwise read as 0% and inflate the below/at-risk buckets
    // and drag the average down.
    const workedReps = byRep.filter((r) => r.workingDays > 0);
    const repsActive = workedReps.length;
    const aboveTargetReps = workedReps.filter((r) => r.performancePercent >= 100).length;
    const onTrackReps = workedReps.filter((r) => r.performancePercent >= 80 && r.performancePercent < 100).length;
    const belowTargetReps = workedReps.filter((r) => r.performancePercent < 80).length;
    const atRiskReps = workedReps.filter((r) => r.performancePercent < 60).length;
    const avgPerformance = workedReps.length > 0 ? workedReps.reduce((s, r) => s + r.performancePercent, 0) / workedReps.length : 0;

    // Day-of-week breakdown (0=Sun..6=Sat) — من الـ aggregation.
    const dowMap = new Map(dowAgg.map((d) => [d._id, d]));
    const byDayOfWeek = Array.from({ length: 7 }, (_, i) => {
      const e = dowMap.get(i) || { totalOrders: 0, workingCells: 0 };
      return { dow: i, totalOrders: e.totalOrders, workingCells: e.workingCells, avgPerWorker: e.workingCells > 0 ? e.totalOrders / e.workingCells : 0 };
    });

    // Improvers / Decliners — من تجميع (rep, month) بدل المرور على كل الصفوف.
    const repMonthMap = new Map(); // repId -> { monthKey -> { orders, workingDays } }
    repMonthAgg.forEach((rm) => {
      const repId = String(rm._id.rep || '');
      if (!repMonthMap.has(repId)) repMonthMap.set(repId, new Map());
      repMonthMap.get(repId).set(`${rm._id.year}-${pad2(rm._id.month)}`, { orders: rm.orders, workingDays: rm.workingDays });
    });

    const repTrends = byRep.map((r) => {
      const months = [...(repMonthMap.get(String(r.repId)) || new Map()).entries()]
        .sort((a, b) => a[0].localeCompare(b[0]));
      if (months.length < 2) {
        return { ...r, deltaPercent: 0, firstMonthAvg: 0, lastMonthAvg: 0, monthsActive: months.length };
      }
      const [, first] = months[0];
      const [, last] = months[months.length - 1];
      const firstAvg = first.workingDays > 0 ? first.orders / first.workingDays : 0;
      const lastAvg = last.workingDays > 0 ? last.orders / last.workingDays : 0;
      const delta = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0;
      return { ...r, deltaPercent: delta, firstMonthAvg: firstAvg, lastMonthAvg: lastAvg, monthsActive: months.length };
    });

    const topImprovers = [...repTrends].filter((r) => r.monthsActive >= 2 && r.deltaPercent > 0)
      .sort((a, b) => b.deltaPercent - a.deltaPercent).slice(0, 5);
    const topDecliners = [...repTrends].filter((r) => r.monthsActive >= 2 && r.deltaPercent < 0)
      .sort((a, b) => a.deltaPercent - b.deltaPercent).slice(0, 5);

    // Most consistent — std-dev of monthly orders / mean (low coefficient of variation)
    const mostConsistent = byRep.map((r) => {
      const months = [...(repMonthMap.get(String(r.repId)) || new Map()).values()];
      if (months.length < 2) return { ...r, consistency: 0, monthsActive: months.length };
      const totals = months.map((m) => m.orders);
      const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
      if (mean <= 0) return { ...r, consistency: 0, monthsActive: months.length };
      const variance = totals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / totals.length;
      const stdDev = Math.sqrt(variance);
      const consistency = Math.max(0, 100 - (stdDev / mean) * 100);
      return { ...r, consistency, monthsActive: months.length };
    }).filter((r) => r.monthsActive >= 2)
      .sort((a, b) => b.consistency - a.consistency).slice(0, 5);

    // Best single days across all reps — من الـ aggregation (أعلى 5 صفوف).
    const bestSingleDays = bestDaysAgg.map((o) => ({
      repId: o.rep,
      englishName: repMap2.get(String(o.rep))?.englishName,
      arabicName: repMap2.get(String(o.rep))?.arabicName,
      dateKey: o.dateKey,
      orders: o.orders,
      project: projMap2.get(String(o.project))?.name,
    }));

    // Most-productive days for the team as a whole (already covered by byDay sorted)
    const topTeamDays = [...byDay].sort((a, b) => b.totalOrders - a.totalOrders).slice(0, 5);

    // Capacity = expected orders for the days reps ACTUALLY worked
    // (Σ workingDays × dailyTarget), not a full-month target × headcount. This
    // keeps capacity-used meaningful mid-month (it's not diluted by days that
    // haven't happened yet) and ignores reps who haven't started, so the % is a
    // real "orders vs daily target on worked days" figure.
    const expectedTotal = byRep.reduce((s, r) => s + r.workingDays * r.dailyTarget, 0);

    const kpis = {
      totalOrders,
      totalWorkingDays,
      avgDailyRate,
      repsActive,
      aboveTargetReps,
      onTrackReps,
      belowTargetReps,
      atRiskReps,
      avgPerformance,
      bestRep: byRep[0] || null,
      worstRep: byRep.length > 0 ? byRep[byRep.length - 1] : null,
      bestDay: byDay.length > 0 ? [...byDay].sort((a, b) => b.totalOrders - a.totalOrders)[0] : null,
      // Capacity = expected orders given (active reps × monthly target × months in scope)
      teamCapacity: expectedTotal,
      capacityUsedPercent: 0,
      monthsCount: byMonth.length,
      totalDaysOff,
      totalNoDataDays,
    };
    if (kpis.teamCapacity > 0) kpis.capacityUsedPercent = (totalOrders / kpis.teamCapacity) * 100;

    // List all (year, month) combinations that exist in DB regardless of current filter.
    // Powers the month-picker tabs at the top of the dashboard.
    const monthScopeFilter = {};
    if (scope.projectIds && scope.projectIds.length > 0) {
      monthScopeFilter.project = { $in: scope.projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
    }
    if (req.query.project) monthScopeFilter.project = new mongoose.Types.ObjectId(String(req.query.project));
    if (req.query.branch) monthScopeFilter.branch = new mongoose.Types.ObjectId(String(req.query.branch));
    const monthsAggregate = await B2CDailyOrder.aggregate([
      { $match: monthScopeFilter },
      { $group: { _id: { year: '$year', month: '$month' }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
    const monthsAvailable = monthsAggregate.map((a) => ({ year: a._id.year, month: a._id.month, entries: a.count }));

    const payload = {
      kpis,
      byMonth, byProject, byBranch, byRep,
      byDay,
      byDayOfWeek,
      monthsAvailable,
      topReps: byRep.slice(0, 10),
      bottomReps: byRep.length > 10 ? byRep.slice(-10).reverse() : [...byRep].reverse(),
      topImprovers,
      topDecliners,
      mostConsistent,
      bestSingleDays,
      topTeamDays,
    };
    cache.set(cacheKey, payload, B2C_DASH_TTL);
    res.json(payload);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: error.message || 'Failed to load dashboard' });
  }
};

const emptyKpis = () => ({
  totalOrders: 0, totalWorkingDays: 0, avgDailyRate: 0,
  repsActive: 0, aboveTargetReps: 0, onTrackReps: 0, belowTargetReps: 0, atRiskReps: 0,
  avgPerformance: 0, bestRep: null, worstRep: null, bestDay: null,
  teamCapacity: 0, capacityUsedPercent: 0, monthsCount: 0,
});

// Rep profile - lifetime metrics + month breakdown + daily heatmap
exports.getRepProfile = async (req, res) => {
  try {
    const rep = await B2CRep.findById(req.params.id)
      .populate('project', 'name code color monthlyTarget dailyTarget expectedWorkingDays')
      .populate('branch', 'name code city');
    if (!rep) return res.status(404).json({ message: 'Rep not found' });

    const orders = await B2CDailyOrder.find({ rep: rep._id }).sort({ dateKey: 1 }).lean();

    const monthlyTarget = rep.monthlyTarget || rep.project?.monthlyTarget || 400;

    // Monthly aggregation
    const monthMap = new Map();
    orders.forEach((o) => {
      const key = `${o.year}-${pad2(o.month)}`;
      if (!monthMap.has(key)) {
        monthMap.set(key, { key, year: o.year, month: o.month, totalOrders: 0, workingDays: 0, daysOff: 0, dailyOrders: {} });
      }
      const m = monthMap.get(key);
      if (o.orders !== null) m.totalOrders += (o.orders || 0);
      if ((o.orders ?? 0) > 0) m.workingDays += 1;
      else if (o.orders === 0) m.daysOff += 1;
      m.dailyOrders[o.day] = o.orders;
    });
    const months = [...monthMap.values()].map((m) => ({
      ...m,
      dailyRate: m.workingDays > 0 ? m.totalOrders / m.workingDays : 0,
      performancePercent: monthlyTarget > 0 ? (m.totalOrders / monthlyTarget) * 100 : 0,
      shortOfTarget: m.totalOrders - monthlyTarget,
    })).sort((a, b) => a.key.localeCompare(b.key));

    const totalOrders = orders.reduce((s, o) => s + (o.orders || 0), 0);
    // worked = orders > 0. 0 = day off, null = no data.
    const workedDays = orders.filter((o) => (o.orders ?? 0) > 0);
    const notWorkedDays = orders.filter((o) => o.orders === 0);
    const noDataDays = orders.filter((o) => o.orders === null || o.orders === undefined);
    const lifetimeDailyRate = workedDays.length > 0 ? totalOrders / workedDays.length : 0;
    const avgPerformance = months.length > 0 ? months.reduce((s, m) => s + m.performancePercent, 0) / months.length : 0;
    const bestMonth = months.length > 0 ? [...months].sort((a, b) => b.totalOrders - a.totalOrders)[0] : null;
    const worstMonth = months.length > 0 ? [...months].sort((a, b) => a.totalOrders - b.totalOrders)[0] : null;
    const bestDay = orders.length > 0 ? [...orders].sort((a, b) => (b.orders || 0) - (a.orders || 0))[0] : null;

    // Trend: compare first half vs second half of months
    let trend = 'stable';
    if (months.length >= 2) {
      const half = Math.floor(months.length / 2);
      const earlier = months.slice(0, half).reduce((s, m) => s + m.totalOrders, 0) / Math.max(half, 1);
      const later = months.slice(-half).reduce((s, m) => s + m.totalOrders, 0) / Math.max(half, 1);
      if (later > earlier * 1.05) trend = 'rising';
      else if (later < earlier * 0.95) trend = 'falling';
    }

    // Consistency: standard deviation of monthly orders / mean
    let consistency = 0;
    if (months.length > 1) {
      const mean = months.reduce((s, m) => s + m.totalOrders, 0) / months.length;
      const variance = months.reduce((s, m) => s + Math.pow(m.totalOrders - mean, 2), 0) / months.length;
      const stdDev = Math.sqrt(variance);
      consistency = mean > 0 ? Math.max(0, 100 - (stdDev / mean) * 100) : 0;
    } else if (months.length === 1) {
      consistency = 100;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Strengths & Weaknesses — auto-generated from the rep's data.
    // Returns typed entries (code + meta) so the frontend can localize.
    // ──────────────────────────────────────────────────────────────────────
    const strengths = [];
    const weaknesses = [];

    const monthsAboveTarget = months.filter((m) => m.performancePercent >= 100).length;
    const monthsOnTrack = months.filter((m) => m.performancePercent >= 80 && m.performancePercent < 100).length;
    const monthsBelowTarget = months.filter((m) => m.performancePercent < 80).length;
    const monthsAtRisk = months.filter((m) => m.performancePercent < 60).length;

    const dailyTarget = rep.dailyTarget || rep.project?.dailyTarget || 15;
    const expectedDaysPerMonth = rep.expectedWorkingDays || rep.project?.expectedWorkingDays || 26;
    const expectedTotalDays = months.length * expectedDaysPerMonth;
    const attendanceRate = expectedTotalDays > 0 ? (workedDays.length / expectedTotalDays) * 100 : 0;

    const daysAboveDailyTarget = orders.filter((o) => o.worked && o.orders !== null && (o.orders || 0) >= dailyTarget).length;
    const dailyHitRate = workedDays.length > 0 ? (daysAboveDailyTarget / workedDays.length) * 100 : 0;

    // ──── Strengths ────
    if (avgPerformance >= 120) {
      strengths.push({ code: 'EXCEPTIONAL_PERFORMANCE', meta: { value: avgPerformance.toFixed(1) } });
    } else if (avgPerformance >= 100) {
      strengths.push({ code: 'AVG_PERFORMANCE_HIGH', meta: { value: avgPerformance.toFixed(1) } });
    }
    if (consistency >= 80 && months.length >= 2) {
      strengths.push({ code: 'CONSISTENCY_VERY_HIGH', meta: { value: consistency.toFixed(0) } });
    } else if (consistency >= 65 && months.length >= 2) {
      strengths.push({ code: 'CONSISTENCY_HIGH', meta: { value: consistency.toFixed(0) } });
    }
    if (trend === 'rising' && months.length >= 2) {
      strengths.push({ code: 'TREND_RISING' });
    }
    if (months.length >= 2 && monthsAboveTarget === months.length) {
      strengths.push({ code: 'ALWAYS_ABOVE_TARGET', meta: { count: months.length } });
    } else if (months.length >= 3 && monthsAboveTarget / months.length >= 0.7) {
      strengths.push({ code: 'MOSTLY_ABOVE_TARGET', meta: { hits: monthsAboveTarget, total: months.length } });
    }
    if (attendanceRate >= 90 && expectedTotalDays > 0) {
      strengths.push({ code: 'ATTENDANCE_EXCELLENT', meta: { value: attendanceRate.toFixed(0) } });
    }
    if (dailyHitRate >= 70 && workedDays.length >= 5) {
      strengths.push({ code: 'DAILY_TARGET_HIT_RATE_HIGH', meta: { value: dailyHitRate.toFixed(0) } });
    }
    if (bestDay && (bestDay.orders || 0) >= dailyTarget * 2) {
      strengths.push({ code: 'PEAK_DAY_OUTSTANDING', meta: { value: bestDay.orders, multiple: ((bestDay.orders || 0) / dailyTarget).toFixed(1) } });
    }
    if (months.length >= 4) {
      strengths.push({ code: 'LONG_TENURE', meta: { months: months.length } });
    }

    // ──── Weaknesses ────
    if (avgPerformance < 60) {
      weaknesses.push({ code: 'AVG_PERFORMANCE_AT_RISK', meta: { value: avgPerformance.toFixed(1) } });
    } else if (avgPerformance < 80) {
      weaknesses.push({ code: 'AVG_PERFORMANCE_LOW', meta: { value: avgPerformance.toFixed(1) } });
    }
    if (trend === 'falling' && months.length >= 2) {
      weaknesses.push({ code: 'TREND_FALLING' });
    }
    if (consistency < 50 && months.length >= 2) {
      weaknesses.push({ code: 'CONSISTENCY_LOW', meta: { value: consistency.toFixed(0) } });
    }
    if (monthsBelowTarget >= 2) {
      weaknesses.push({ code: 'MULTIPLE_MONTHS_BELOW', meta: { count: monthsBelowTarget } });
    }
    if (monthsAtRisk >= 1) {
      weaknesses.push({ code: 'MONTHS_AT_RISK', meta: { count: monthsAtRisk } });
    }
    if (attendanceRate < 70 && expectedTotalDays > 0) {
      weaknesses.push({ code: 'ATTENDANCE_LOW', meta: { value: attendanceRate.toFixed(0) } });
    }
    if (dailyHitRate < 30 && workedDays.length >= 5) {
      weaknesses.push({ code: 'DAILY_TARGET_RARELY_HIT', meta: { value: dailyHitRate.toFixed(0) } });
    }
    const lastMonth = months[months.length - 1];
    if (lastMonth && lastMonth.performancePercent < 50 && months.length >= 2) {
      weaknesses.push({ code: 'RECENT_MONTH_POOR', meta: { value: lastMonth.performancePercent.toFixed(1) } });
    }
    if (worstMonth && worstMonth.totalOrders === 0 && months.length >= 2) {
      weaknesses.push({ code: 'ZERO_OUTPUT_MONTH', meta: { month: worstMonth.month, year: worstMonth.year } });
    }
    // High number of days off (relative to total months)
    if (notWorkedDays.length >= Math.max(5, months.length * 3)) {
      weaknesses.push({ code: 'MANY_DAYS_OFF', meta: { count: notWorkedDays.length } });
    } else if (notWorkedDays.length >= Math.max(3, months.length * 2)) {
      weaknesses.push({ code: 'SOME_DAYS_OFF', meta: { count: notWorkedDays.length } });
    }

    res.json({
      rep,
      lifetime: {
        totalOrders,
        avgPerformancePercent: avgPerformance,
        lifetimeDailyRate,
        consistency,
        trend,
        monthsTracked: months.length,
        bestMonth, worstMonth, bestDay,
        attendanceRate,
        dailyHitRate,
        dailyTarget,
        expectedTotalDays,
        actualWorkingDays: workedDays.length,
        daysNotWorked: notWorkedDays.length,
        daysNoData: noDataDays.length,
        monthsAboveTarget, monthsOnTrack, monthsBelowTarget, monthsAtRisk,
      },
      strengths,
      weaknesses,
      months,
      orders, // raw daily data for heatmap
    });
  } catch (error) {
    console.error('Rep profile error:', error);
    res.status(500).json({ message: error.message || 'Failed to load profile' });
  }
};

// Returns counts of unique rep grades (for the 'Reps Evaluation' tab)
exports.getRepEvaluations = async (req, res) => {
  try {
    const filter = {};
    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0) {
      filter.project = { $in: scope.projectIds };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ evaluations: [] });
    }
    if (req.query.project) filter.project = req.query.project;
    if (req.query.branch) filter.branch = req.query.branch;

    const reps = await B2CRep.find(filter).populate('project', 'name code color monthlyTarget').populate('branch', 'name city');
    const repIds = reps.map((r) => r._id);
    const orders = await B2CDailyOrder.find({ rep: { $in: repIds } }).lean();

    const ordersByRep = new Map();
    orders.forEach((o) => {
      const id = String(o.rep);
      if (!ordersByRep.has(id)) ordersByRep.set(id, []);
      ordersByRep.get(id).push(o);
    });

    const evaluations = reps.map((rep) => {
      const repOrders = ordersByRep.get(String(rep._id)) || [];
      const monthlyTarget = rep.monthlyTarget || 400;

      const monthMap = new Map();
      repOrders.forEach((o) => {
        const key = `${o.year}-${pad2(o.month)}`;
        if (!monthMap.has(key)) monthMap.set(key, 0);
        if (o.orders !== null) monthMap.set(key, monthMap.get(key) + (o.orders || 0));
      });
      const monthsArr = [...monthMap.values()];
      const totalOrders = monthsArr.reduce((s, v) => s + v, 0);
      const avgPerformance = monthsArr.length > 0
        ? (monthsArr.reduce((s, v) => s + (v / monthlyTarget) * 100, 0) / monthsArr.length)
        : 0;

      let consistency = 0;
      if (monthsArr.length > 1) {
        const mean = totalOrders / monthsArr.length;
        const stdDev = Math.sqrt(monthsArr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / monthsArr.length);
        consistency = mean > 0 ? Math.max(0, 100 - (stdDev / mean) * 100) : 0;
      } else if (monthsArr.length === 1) {
        consistency = 100;
      }

      let trend = 'stable';
      if (monthsArr.length >= 2) {
        const half = Math.floor(monthsArr.length / 2);
        const earlier = monthsArr.slice(0, half).reduce((s, v) => s + v, 0) / Math.max(half, 1);
        const later = monthsArr.slice(-half).reduce((s, v) => s + v, 0) / Math.max(half, 1);
        if (later > earlier * 1.05) trend = 'rising';
        else if (later < earlier * 0.95) trend = 'falling';
      }

      let grade = 'F';
      if (avgPerformance >= 120) grade = 'A+';
      else if (avgPerformance >= 100) grade = 'A';
      else if (avgPerformance >= 85) grade = 'B';
      else if (avgPerformance >= 70) grade = 'C';
      else if (avgPerformance >= 50) grade = 'D';

      return {
        repId: rep._id,
        englishName: rep.englishName,
        arabicName: rep.arabicName,
        repIdNumber: rep.repId,
        project: rep.project?.name,
        branch: rep.branch?.name,
        totalOrders,
        monthsActive: monthsArr.length,
        avgPerformance,
        consistency,
        trend,
        grade,
      };
    }).sort((a, b) => b.avgPerformance - a.avgPerformance);

    res.json({ evaluations });
  } catch (error) {
    console.error('Rep evaluations error:', error);
    res.status(500).json({ message: error.message || 'Failed to load evaluations' });
  }
};

// Removes any rep whose name looks like a sheet footer label rather than a
// person ("Total orders of day", "Average", etc.). Older parser runs wrote
// these in when a sheet's totals row got mis-classified as a data row, and
// they double-count every day on the dashboard. Safe to run repeatedly —
// no-op when there are no fake reps.
exports.cleanupFakeReps = async (req, res) => {
  try {
    const FAKE_NAME_PATTERNS = [
      /total orders of day/i,
      /total order of day/i,
      /^total$/i,
      /^totals?$/i,
      /^average\b/i,
      /^avg\b/i,
      /^sum\b/i,
      /^grand total/i,
    ];
    const matches = (s) => FAKE_NAME_PATTERNS.some((re) => re.test(String(s || '').trim()));

    const allReps = await B2CRep.find({}, 'englishName arabicName').lean();
    const fakeReps = allReps.filter((r) => matches(r.englishName) || matches(r.arabicName));
    const fakeIds = fakeReps.map((r) => r._id);

    let ordersDeleted = 0;
    if (fakeIds.length > 0) {
      const ord = await B2CDailyOrder.deleteMany({ rep: { $in: fakeIds } });
      ordersDeleted = ord.deletedCount;
      await B2CRep.deleteMany({ _id: { $in: fakeIds } });
    }

    res.json({
      removedReps: fakeReps.map((r) => ({ _id: String(r._id), englishName: r.englishName, arabicName: r.arabicName })),
      removedRepCount: fakeReps.length,
      ordersDeleted,
    });
  } catch (error) {
    console.error('[B2C cleanup-fake-reps] error:', error);
    res.status(500).json({ message: error.message || 'Cleanup failed' });
  }
};

// Wipe B2C data — used to reset before fresh re-upload.
// Body: { scope: 'orders' | 'all' }
//   - 'orders': delete all daily orders + upload history (keeps reps + projects)
//   - 'all':    delete daily orders + upload history + reps (keeps projects only)
// NEVER deletes projects automatically (user creates those manually).
exports.cleanupB2CData = async (req, res) => {
  try {
    const { scope = 'orders' } = req.body;
    if (!['orders', 'all'].includes(scope)) {
      return res.status(400).json({ message: "scope must be 'orders' or 'all'" });
    }

    const ordersDeleted = await B2CDailyOrder.deleteMany({});
    const uploadsDeleted = await B2CExcelUpload.deleteMany({});
    let repsDeleted = { deletedCount: 0 };
    if (scope === 'all') {
      repsDeleted = await B2CRep.deleteMany({});
    }

    // Reset every Google Sheet sync config's hash cache. Without this the
    // cron's hash gate sees the unchanged sheet bytes and short-circuits with
    // "No changes detected" forever — leaving the DB empty until somebody
    // manually clicks "Sync Now". After a cleanup we WANT the next sync to
    // re-ingest from scratch.
    const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');
    await B2CGoogleSheetSync.updateMany({}, { $unset: { lastSheetHash: 1 } });

    await logAudit({
      user: req.user._id,
      action: `b2c_cleanup_${scope}`,
      entity: 'B2C',
      changes: {
        before: {
          ordersDeleted: ordersDeleted.deletedCount,
          uploadsDeleted: uploadsDeleted.deletedCount,
          repsDeleted: repsDeleted.deletedCount,
        },
      },
      ipAddress: req.ip,
    });

    try { emitToAll('b2c:cleanup', { scope }); } catch (e) {}

    console.log(`[B2C cleanup] scope=${scope} orders=${ordersDeleted.deletedCount} uploads=${uploadsDeleted.deletedCount} reps=${repsDeleted.deletedCount}`);
    res.json({
      ordersDeleted: ordersDeleted.deletedCount,
      uploadsDeleted: uploadsDeleted.deletedCount,
      repsDeleted: repsDeleted.deletedCount,
      scope,
    });
  } catch (error) {
    console.error('B2C cleanup error:', error);
    res.status(500).json({ message: error.message || 'Cleanup failed' });
  }
};

// Lightweight endpoint for the dashboard's month-picker tabs. Cheap aggregate;
// frontend caches the result so picker stays stable while user navigates.
exports.getMonthsAvailable = async (req, res) => {
  try {
    const filter = {};
    if (req.query.project) filter.project = new mongoose.Types.ObjectId(String(req.query.project));
    if (req.query.branch) filter.branch = new mongoose.Types.ObjectId(String(req.query.branch));

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0 && !filter.project) {
      filter.project = { $in: scope.projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ months: [] });
    }

    const months = await B2CDailyOrder.aggregate([
      { $match: filter },
      { $group: { _id: { year: '$year', month: '$month' }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $project: { _id: 0, year: '$_id.year', month: '$_id.month', entries: '$count' } },
    ]);
    res.json({ months });
  } catch (error) {
    console.error('Months available error:', error);
    res.status(500).json({ message: error.message || 'Failed to load months' });
  }
};

// Returns full breakdown of a single day: KPIs + per-rep table.
// Used by the "Daily cards" → details modal in the dashboard.
exports.getDayDetails = async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ message: 'date query param required (YYYY-MM-DD)' });

    const filter = { dateKey: date };
    if (req.query.project) filter.project = new mongoose.Types.ObjectId(String(req.query.project));
    if (req.query.branch) filter.branch = new mongoose.Types.ObjectId(String(req.query.branch));

    const scope = await buildScope(req.user);
    if (scope.projectIds && scope.projectIds.length > 0) {
      filter.project = filter.project || { $in: scope.projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
    } else if (scope.projectIds && scope.projectIds.length === 0) {
      return res.json({ date, dow: 0, totalOrders: 0, repsActive: 0, avgPerRep: 0, bestRep: null, repsAboveTarget: 0, repsBelowTarget: 0, achievementPercent: 0, reps: [] });
    }

    const orders = await B2CDailyOrder.find(filter)
      .populate('rep', 'englishName arabicName repId dailyTarget monthlyTarget')
      .populate('project', 'name color')
      .populate('branch', 'name city')
      .lean();

    const totalOrders = orders.reduce((s, o) => s + (o.orders || 0), 0);
    // worked = orders > 0. 0 = took the day off, null = no data.
    const workedReps = orders.filter((o) => (o.orders ?? 0) > 0);
    const notWorkedReps = orders.filter((o) => o.orders === 0);
    const noDataReps = orders.filter((o) => o.orders === null || o.orders === undefined);
    const repsActive = workedReps.length;
    const repsNotWorked = notWorkedReps.length;
    const avgPerRep = repsActive > 0 ? totalOrders / repsActive : 0;

    const reps = orders.map((o) => {
      const dailyTarget = o.rep?.dailyTarget || 15;
      const orderCount = o.orders ?? null;
      let status = 'no_data';
      if (orderCount === 0) {
        status = 'not_worked';
      } else if (orderCount !== null && orderCount > 0) {
        if (orderCount >= dailyTarget) status = 'above';
        else if (orderCount >= dailyTarget * 0.6) status = 'on_track';
        else status = 'below';
      }
      return {
        repId: o.rep?._id,
        accountId: o.rep?.repId,
        englishName: o.rep?.englishName,
        arabicName: o.rep?.arabicName,
        project: o.project?.name,
        projectColor: o.project?.color,
        branch: o.branch?.name,
        orders: orderCount,
        worked: orderCount !== null && orderCount > 0,
        dailyTarget,
        diff: orderCount === null ? null : (orderCount - dailyTarget),
        status,
        sourceSheet: o.sourceSheet || null,
        sourceRow: o.sourceRow || null,
      };
    }).sort((a, b) => (b.orders || 0) - (a.orders || 0));

    const bestRep = reps.find((r) => r.worked && r.orders !== null) || null;
    const repsAboveTarget = reps.filter((r) => r.status === 'above').length;
    const repsBelowTarget = reps.filter((r) => r.status === 'below').length;
    const repsOnTrack = reps.filter((r) => r.status === 'on_track').length;
    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();

    const targetSum = workedReps.reduce((s, o) => s + (o.rep?.dailyTarget || 15), 0);
    const achievementPercent = targetSum > 0 ? (totalOrders / targetSum) * 100 : 0;
    const hitTargetPercent = repsActive > 0 ? (repsAboveTarget / repsActive) * 100 : 0;

    res.json({
      date, dow,
      totalOrders, repsActive, repsNotWorked, avgPerRep,
      bestRep,
      bestRepOrders: bestRep?.orders ?? 0,
      repsAboveTarget, repsOnTrack, repsBelowTarget,
      noDataCount: noDataReps.length,
      achievementPercent,
      hitTargetPercent,
      targetSum,
      reps,
    });
  } catch (error) {
    console.error('Day details error:', error);
    res.status(500).json({ message: error.message || 'Failed to load day details' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEET SYNC
// ────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const B2CGoogleSheetSync = require('../models/B2CGoogleSheetSync');
const { syncOnce, extractSheetId, enqueueWebhookSync } = require('../services/b2cGoogleSheetSyncService');

function newWebhookSecret() {
  return crypto.randomBytes(24).toString('hex');
}

exports.getSheetConfigs = async (req, res) => {
  try {
    const configs = await B2CGoogleSheetSync.find({})
      .populate('project', 'name code color')
      .populate('branch', 'name city')
      .sort({ 'project.name': 1, 'branch.name': 1, createdAt: 1 });
    res.json({ configs });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load sheet configs' });
  }
};

// Open webhook — no auth middleware. Looks up the config by the shared secret.
// Each (project, branch) sheet has its own secret, so the secret tells us which
// sheet pinged.
exports.googleSheetWebhook = async (req, res) => {
  try {
    const incoming = (req.body && req.body.secret)
      || req.headers['x-sync-secret']
      || req.query.secret;
    if (!incoming) return res.status(400).json({ ok: false, message: 'Missing secret' });

    const config = await B2CGoogleSheetSync.findOne({ webhookSecret: String(incoming) });
    if (!config) {
      return res.status(403).json({ ok: false, message: 'Invalid secret' });
    }
    if (!config.sheetId) {
      return res.status(400).json({ ok: false, message: 'No sheet configured' });
    }

    enqueueWebhookSync(String(config._id));
    res.json({ ok: true, queued: true, configId: String(config._id) });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ ok: false, message: error.message || 'Webhook failed' });
  }
};

// Returns the Apps Script code the user pastes into their sheet's script editor.
exports.getSheetSetupScript = async (req, res) => {
  try {
    const config = await B2CGoogleSheetSync.findById(req.params.id)
      .populate('project', 'name')
      .populate('branch', 'name');
    if (!config) return res.status(404).json({ message: 'Sheet config not found' });

    // Configs migrated from the old singleton flow may lack a secret. Backfill once.
    if (!config.webhookSecret || config.webhookSecret.length < 24) {
      config.webhookSecret = newWebhookSecret();
      await config.save();
    }

    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = `${proto}://${host}/api/b2c/google-sheet/webhook`;

    const label = `${config.project?.name || 'Project'} — ${config.branch?.name || 'Branch'}`;

    const script = `// ─────────────────────────────────────────────────────────────────────
// B2C real-time sync trigger — ${label}
// Paste into:  Extensions → Apps Script  (in your Google Sheet)
//
// Then in the Apps Script editor:
//   1. Save (💾)
//   2. Click "Triggers" (clock icon on the left sidebar)
//   3. "Add Trigger"
//   4. Choose function: notifyB2CWebhook
//   5. Event source: From spreadsheet
//   6. Event type: On edit
//   7. Save → grant permissions when prompted
// ─────────────────────────────────────────────────────────────────────

const B2C_WEBHOOK_URL = ${JSON.stringify(webhookUrl)};
const B2C_SECRET      = ${JSON.stringify(config.webhookSecret)};

function notifyB2CWebhook(e) {
  try {
    UrlFetchApp.fetch(B2C_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ secret: B2C_SECRET, source: 'apps-script' }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    // Swallow — we don't want sheet edits to fail because of webhook errors
    console.log('B2C webhook ping failed:', err);
  }
}

// Optional: manual test
function testB2CWebhook() {
  notifyB2CWebhook();
  Logger.log('Webhook ping sent — check the dashboard.');
}
`;

    res.json({ script, webhookUrl, secret: config.webhookSecret });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to build setup script' });
  }
};

exports.createSheetConfig = async (req, res) => {
  try {
    const { name, project, branch, sheetUrl, enabled, intervalMinutes, syncMode } = req.body;
    if (!project) return res.status(400).json({ message: 'Project is required' });
    if (!branch) return res.status(400).json({ message: 'Branch is required' });

    const payload = {
      name: name || undefined,
      project,
      branch,
      enabled: enabled === undefined ? false : !!enabled,
      intervalMinutes: intervalMinutes !== undefined
        ? Math.max(1, Math.min(1440, Number(intervalMinutes)))
        : 15,
      syncMode: syncMode && ['merge_new_only', 'overwrite'].includes(syncMode) ? syncMode : 'overwrite',
      webhookSecret: newWebhookSecret(),
      updatedBy: req.user._id,
    };
    if (sheetUrl) {
      payload.sheetUrl = sheetUrl;
      const id = extractSheetId(sheetUrl);
      if (!id) return res.status(400).json({ message: 'Could not extract a Google Sheet ID from this URL' });
      payload.sheetId = id;
    }

    const config = await B2CGoogleSheetSync.create(payload);
    const populated = await B2CGoogleSheetSync.findById(config._id)
      .populate('project', 'name code color')
      .populate('branch', 'name city');
    res.status(201).json({ config: populated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A sheet config already exists for this project + branch combination' });
    }
    res.status(500).json({ message: error.message || 'Failed to create sheet config' });
  }
};

exports.updateSheetConfig = async (req, res) => {
  try {
    const { name, sheetUrl, enabled, intervalMinutes, syncMode, project, branch } = req.body;
    const updates = { updatedBy: req.user._id };
    if (name !== undefined) updates.name = name;
    if (project !== undefined) updates.project = project;
    if (branch !== undefined) updates.branch = branch;
    if (sheetUrl !== undefined) {
      updates.sheetUrl = sheetUrl;
      if (sheetUrl) {
        const id = extractSheetId(sheetUrl);
        if (!id) return res.status(400).json({ message: 'Could not extract a Google Sheet ID from this URL' });
        updates.sheetId = id;
      } else {
        updates.sheetId = null;
      }
    }
    if (enabled !== undefined) updates.enabled = !!enabled;
    if (intervalMinutes !== undefined) updates.intervalMinutes = Math.max(1, Math.min(1440, Number(intervalMinutes)));
    if (syncMode !== undefined) {
      if (!['merge_new_only', 'overwrite'].includes(syncMode)) {
        return res.status(400).json({ message: "syncMode must be 'merge_new_only' or 'overwrite'" });
      }
      updates.syncMode = syncMode;
    }

    const config = await B2CGoogleSheetSync.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('project', 'name code color')
      .populate('branch', 'name city');
    if (!config) return res.status(404).json({ message: 'Sheet config not found' });
    res.json({ config });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A sheet config already exists for this project + branch combination' });
    }
    res.status(500).json({ message: error.message || 'Failed to update sheet config' });
  }
};

exports.deleteSheetConfig = async (req, res) => {
  try {
    const config = await B2CGoogleSheetSync.findByIdAndDelete(req.params.id);
    if (!config) return res.status(404).json({ message: 'Sheet config not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete sheet config' });
  }
};

exports.syncSheetNow = async (req, res) => {
  try {
    const config = await B2CGoogleSheetSync.findById(req.params.id);
    if (!config) return res.status(404).json({ message: 'Sheet config not found' });
    if (!config.sheetId) {
      return res.status(400).json({ message: 'No Google Sheet URL set on this config.' });
    }
    const stats = await syncOnce({
      configId: String(config._id),
      user: req.user,
      mode: req.body && req.body.mode,
      // Manual button always re-parses, even if the sheet bytes are unchanged.
      force: true,
    });
    res.json({ ok: true, stats });
  } catch (error) {
    try {
      await B2CGoogleSheetSync.updateOne(
        { _id: req.params.id },
        { $set: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: error.message || 'Sync failed' } }
      );
    } catch (_) {}
    res.status(500).json({ message: error.message || 'Sync failed' });
  }
};

exports.getUploadHistory = async (req, res) => {
  try {
    const uploads = await B2CExcelUpload.find({})
      .populate('uploadedBy', 'firstName lastName email')
      .populate('project', 'name')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ uploads });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load upload history' });
  }
};
