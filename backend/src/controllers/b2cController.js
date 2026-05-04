const mongoose = require('mongoose');
const B2CProject = require('../models/B2CProject');
const B2CRep = require('../models/B2CRep');
const B2CDailyOrder = require('../models/B2CDailyOrder');
const B2CExcelUpload = require('../models/B2CExcelUpload');
const Branch = require('../models/Branch');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
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
      .sort({ englishName: 1 });
    res.json({ reps });
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

// Merges duplicate reps (same name within the same project/branch, or a
// legacy null-scope rep that pairs with a properly-scoped rep). Daily orders
// from duplicates are repointed to the canonical rep before the duplicate is
// deleted. Safe to run multiple times.
exports.reconcileReps = async (req, res) => {
  try {
    const reps = await B2CRep.find({}).lean();
    const normalize = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // Pre-fetch order counts per rep so we can pick the rep with the most
    // data as canonical (preserves the bigger dataset on collisions).
    const orderCounts = await B2CDailyOrder.aggregate([
      { $group: { _id: '$rep', count: { $sum: 1 } } },
    ]);
    const ordersByRep = new Map(orderCounts.map((o) => [String(o._id), o.count]));

    // Group reps by Account ID, canonical name, and single-name buckets so a
    // rep with the legal Arabic name and another with a username (Account
    // user from the new sheet) still merge if they share the same Account ID
    // or English name.
    const repIdGroups = new Map();
    const canonicalGroups = new Map();
    const enGroups = new Map();
    const arGroups = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const r of reps) {
      const en = normalize(r.englishName);
      const ar = normalize(r.arabicName);
      const id = String(r.repId == null ? '' : r.repId).trim();
      if (id) push(repIdGroups, id, r);
      if (!en && !ar && !id) continue;
      push(canonicalGroups, `${en}|${ar}`, r);
      if (en) push(enGroups, en, r);
      if (ar) push(arGroups, ar, r);
    }

    let mergedGroups = 0;
    let repsRemoved = 0;
    let ordersRepointed = 0;
    const visited = new Set();

    // Build merge candidates: union of canonical group + reps that share just
    // the English or just the Arabic name (for legacy rows where one side is
    // missing) + reps that share the Account ID.
    const buildGroup = (rep) => {
      const en = normalize(rep.englishName);
      const ar = normalize(rep.arabicName);
      const id = String(rep.repId == null ? '' : rep.repId).trim();
      const seen = new Map();
      const add = (r) => seen.set(String(r._id), r);
      // Account ID — strongest signal, joins reps regardless of name drift
      if (id) (repIdGroups.get(id) || []).forEach(add);
      // Canonical en|ar
      (canonicalGroups.get(`${en}|${ar}`) || []).forEach(add);
      // Same English, missing Arabic
      if (en) (enGroups.get(en) || []).forEach((r) => {
        if (!normalize(r.arabicName)) add(r);
      });
      // Same Arabic, missing English
      if (ar) (arGroups.get(ar) || []).forEach((r) => {
        if (!normalize(r.englishName)) add(r);
      });
      return [...seen.values()];
    };

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

      // Repoint daily orders without tripping the (rep, dateKey) unique index.
      // Strategy: load the canonical rep's existing dateKeys + the dup reps'
      // orders, partition into "safe to repoint" vs "already covered (delete)".
      // Two bulk writes total per group instead of one round trip per order.
      const canonicalDates = new Set(
        (await B2CDailyOrder.find({ rep: canonical._id }).select('dateKey').lean())
          .map((d) => d.dateKey)
      );
      const dupOrders = await B2CDailyOrder.find({ rep: { $in: dupIds } })
        .select('_id dateKey updatedAt')
        .sort({ updatedAt: -1 }) // prefer the freshest dup if multiple share a date
        .lean();
      const toRepoint = [];
      const toDelete = [];
      for (const o of dupOrders) {
        if (canonicalDates.has(o.dateKey)) {
          toDelete.push(o._id);
        } else {
          toRepoint.push(o._id);
          canonicalDates.add(o.dateKey); // claim it so a second dup on the same date deletes
        }
      }
      if (toRepoint.length > 0) {
        await B2CDailyOrder.updateMany(
          { _id: { $in: toRepoint } },
          { $set: { rep: canonical._id } }
        );
        ordersRepointed += toRepoint.length;
      }
      if (toDelete.length > 0) {
        await B2CDailyOrder.deleteMany({ _id: { $in: toDelete } });
      }

      await B2CRep.deleteMany({ _id: { $in: dupIds } });
      repsRemoved += dupIds.length;
      mergedGroups++;
      void scopes; void hasLegacy;
    }

    res.json({ ok: true, mergedGroups, repsRemoved, ordersRepointed });
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
      .sort({ dateKey: -1 });
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

    // Lean query — fetch only the fields we'll actually use. Skip populate (expensive) and
    // do a batch lookup for rep/project/branch metadata afterwards.
    const ordersRaw = await B2CDailyOrder.find(filter, {
      rep: 1, project: 1, branch: 1, dateKey: 1, year: 1, month: 1, day: 1,
      orders: 1, worked: 1, sourceSheet: 1, sourceRow: 1,
    }).lean();

    // Collect unique IDs we need to enrich
    const repIdSet = new Set();
    const projIdSet = new Set();
    const branchIdSet = new Set();
    for (const o of ordersRaw) {
      if (o.rep) repIdSet.add(String(o.rep));
      if (o.project) projIdSet.add(String(o.project));
      if (o.branch) branchIdSet.add(String(o.branch));
    }

    // Batch-fetch lookups in parallel
    const [repsList, projsList, branchesList] = await Promise.all([
      repIdSet.size > 0
        ? B2CRep.find(
            { _id: { $in: [...repIdSet] } },
            'englishName arabicName repId monthlyTarget dailyTarget expectedWorkingDays'
          ).lean()
        : [],
      projIdSet.size > 0
        ? B2CProject.find(
            { _id: { $in: [...projIdSet] } },
            'name code color monthlyTarget dailyTarget'
          ).lean()
        : [],
      branchIdSet.size > 0
        ? Branch.find(
            { _id: { $in: [...branchIdSet] } },
            'name code city'
          ).lean()
        : [],
    ]);

    const repMap2 = new Map(repsList.map((r) => [String(r._id), r]));
    const projMap2 = new Map(projsList.map((p) => [String(p._id), p]));
    const branchMap2 = new Map(branchesList.map((b) => [String(b._id), b]));

    // Reshape orders so the rest of the function reads them like populated docs
    const orders = ordersRaw.map((o) => ({
      ...o,
      rep: o.rep ? repMap2.get(String(o.rep)) || null : null,
      project: o.project ? projMap2.get(String(o.project)) || null : null,
      branch: o.branch ? branchMap2.get(String(o.branch)) || null : null,
    }));

    const totalOrders = orders.reduce((sum, o) => sum + (o.orders || 0), 0);
    const workingDayEntries = orders.filter((o) => o.worked && o.orders !== null);
    const totalWorkingDays = workingDayEntries.length;
    const avgDailyRate = totalWorkingDays > 0 ? totalOrders / totalWorkingDays : 0;

    // By rep
    const repMap = new Map();
    orders.forEach((o) => {
      const id = String(o.rep?._id || 'unknown');
      if (!repMap.has(id)) {
        repMap.set(id, {
          repId: o.rep?._id,
          englishName: o.rep?.englishName,
          arabicName: o.rep?.arabicName,
          monthlyTarget: o.rep?.monthlyTarget || 400,
          totalOrders: 0,
          workingDays: 0,
          project: o.project?.name,
        });
      }
      const r = repMap.get(id);
      if (o.orders !== null) r.totalOrders += (o.orders || 0);
      if (o.worked && o.orders !== null) r.workingDays += 1;
    });
    const byRep = [...repMap.values()].map((r) => ({
      ...r,
      dailyRate: r.workingDays > 0 ? r.totalOrders / r.workingDays : 0,
      performancePercent: r.monthlyTarget > 0 ? (r.totalOrders / r.monthlyTarget) * 100 : 0,
    })).sort((a, b) => b.totalOrders - a.totalOrders);

    // By month
    const monthMap = new Map();
    orders.forEach((o) => {
      const key = `${o.year}-${pad2(o.month)}`;
      if (!monthMap.has(key)) monthMap.set(key, { key, year: o.year, month: o.month, totalOrders: 0, workingDays: 0, repsActive: new Set() });
      const m = monthMap.get(key);
      if (o.orders !== null) m.totalOrders += (o.orders || 0);
      if (o.worked && o.orders !== null) m.workingDays += 1;
      m.repsActive.add(String(o.rep?._id));
    });
    const byMonth = [...monthMap.values()].map((m) => ({
      key: m.key, year: m.year, month: m.month,
      totalOrders: m.totalOrders, workingDays: m.workingDays,
      repsActive: m.repsActive.size,
      avgDailyRate: m.workingDays > 0 ? m.totalOrders / m.workingDays : 0,
    })).sort((a, b) => a.key.localeCompare(b.key));

    // By project
    const projectMap = new Map();
    orders.forEach((o) => {
      const id = String(o.project?._id || 'none');
      if (!projectMap.has(id)) projectMap.set(id, { projectId: o.project?._id, name: o.project?.name || '—', color: o.project?.color, totalOrders: 0, repsActive: new Set() });
      const p = projectMap.get(id);
      if (o.orders !== null) p.totalOrders += (o.orders || 0);
      p.repsActive.add(String(o.rep?._id));
    });
    const byProject = [...projectMap.values()].map((p) => ({ ...p, repsActive: p.repsActive.size })).sort((a, b) => b.totalOrders - a.totalOrders);

    // By branch
    const branchMap = new Map();
    orders.forEach((o) => {
      const id = String(o.branch?._id || 'none');
      if (!branchMap.has(id)) branchMap.set(id, { branchId: o.branch?._id, name: o.branch?.name || '—', city: o.branch?.city, totalOrders: 0, repsActive: new Set() });
      const b = branchMap.get(id);
      if (o.orders !== null) b.totalOrders += (o.orders || 0);
      b.repsActive.add(String(o.rep?._id));
    });
    const byBranch = [...branchMap.values()].map((b) => ({ ...b, repsActive: b.repsActive.size })).sort((a, b) => b.totalOrders - a.totalOrders);

    // By day (for the trend line + the daily-cards section).
    // Tracks total orders, active reps, not-worked count, and reps-above-target for color coding.
    // Semantic: orders > 0 = worked. orders === 0 = took the day off. null = no data yet.
    const dayMap = new Map();
    orders.forEach((o) => {
      if (!dayMap.has(o.dateKey)) {
        dayMap.set(o.dateKey, {
          dateKey: o.dateKey,
          totalOrders: 0,
          repsActive: new Set(),
          repsNotWorked: new Set(),
          worked: 0,
          targetSum: 0,
          repsAboveTarget: 0,
        });
      }
      const d = dayMap.get(o.dateKey);
      const dailyTarget = o.rep?.dailyTarget || 15;
      if (o.orders !== null) d.totalOrders += (o.orders || 0);
      const repId = String(o.rep?._id);
      if ((o.orders ?? 0) > 0) {
        d.repsActive.add(repId);
        d.worked += 1;
        d.targetSum += dailyTarget;
        if ((o.orders || 0) >= dailyTarget) d.repsAboveTarget += 1;
      } else if (o.orders === 0) {
        d.repsNotWorked.add(repId);
      }
    });
    const byDay = [...dayMap.values()].map((d) => ({
      dateKey: d.dateKey,
      totalOrders: d.totalOrders,
      repsActive: d.repsActive.size,
      repsNotWorked: d.repsNotWorked.size,
      worked: d.worked,
      targetSum: d.targetSum,
      achievementPercent: d.targetSum > 0 ? (d.totalOrders / d.targetSum) * 100 : 0,
      repsAboveTarget: d.repsAboveTarget,
    })).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // Team-wide off-day stats
    const totalDaysOff = orders.filter((o) => o.orders === 0).length;
    const totalNoDataDays = orders.filter((o) => o.orders === null || o.orders === undefined).length;

    // KPIs
    const repsActive = byRep.length;
    const aboveTargetReps = byRep.filter((r) => r.performancePercent >= 100).length;
    const onTrackReps = byRep.filter((r) => r.performancePercent >= 80 && r.performancePercent < 100).length;
    const belowTargetReps = byRep.filter((r) => r.performancePercent < 80).length;
    const atRiskReps = byRep.filter((r) => r.performancePercent < 60).length;
    const avgPerformance = byRep.length > 0 ? byRep.reduce((s, r) => s + r.performancePercent, 0) / byRep.length : 0;

    // Day-of-week breakdown (0=Sun..6=Sat)
    const dowMap = new Map(); // 0..6 -> { totalOrders, count }
    orders.forEach((o) => {
      if (o.orders === null || !o.worked) return;
      const dow = new Date(`${o.dateKey}T00:00:00.000Z`).getUTCDay();
      if (!dowMap.has(dow)) dowMap.set(dow, { dow, totalOrders: 0, workingCells: 0 });
      const e = dowMap.get(dow);
      e.totalOrders += o.orders || 0;
      e.workingCells += 1;
    });
    const byDayOfWeek = Array.from({ length: 7 }, (_, i) => {
      const e = dowMap.get(i) || { dow: i, totalOrders: 0, workingCells: 0 };
      return { dow: i, totalOrders: e.totalOrders, workingCells: e.workingCells, avgPerWorker: e.workingCells > 0 ? e.totalOrders / e.workingCells : 0 };
    });

    // Improvers / Decliners — compare each rep's last-month vs first-month avg-per-day
    const repMonthMap = new Map(); // repId -> { monthKey -> { orders, workingDays } }
    orders.forEach((o) => {
      const repId = String(o.rep?._id || '');
      if (!repMonthMap.has(repId)) repMonthMap.set(repId, new Map());
      const mk = `${o.year}-${pad2(o.month)}`;
      const inner = repMonthMap.get(repId);
      if (!inner.has(mk)) inner.set(mk, { orders: 0, workingDays: 0 });
      const cell = inner.get(mk);
      if (o.orders !== null) {
        cell.orders += o.orders || 0;
        if (o.worked && o.orders !== null) cell.workingDays += 1;
      }
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

    // Best single days across all reps
    const bestSingleDays = orders
      .filter((o) => o.orders !== null && o.worked)
      .sort((a, b) => (b.orders || 0) - (a.orders || 0))
      .slice(0, 5)
      .map((o) => ({
        repId: o.rep?._id,
        englishName: o.rep?.englishName,
        arabicName: o.rep?.arabicName,
        dateKey: o.dateKey,
        orders: o.orders,
        project: o.project?.name,
      }));

    // Most-productive days for the team as a whole (already covered by byDay sorted)
    const topTeamDays = [...byDay].sort((a, b) => b.totalOrders - a.totalOrders).slice(0, 5);

    // Capacity — accurate across the time window: for each month-with-data,
    // count active reps × monthly target and sum.
    const monthlyTargetSum = byMonth.reduce((s, m) => s + (m.repsActive * 400), 0);
    const expectedTotal = monthlyTargetSum > 0 ? monthlyTargetSum : byRep.reduce((s, r) => s + r.monthlyTarget, 0);

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

    res.json({
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
    });
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
