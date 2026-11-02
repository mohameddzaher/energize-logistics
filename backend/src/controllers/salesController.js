const mongoose = require('mongoose');
const User = require('../models/User');
const SalesTarget = require('../models/SalesTarget');
const CrmDeal = require('../models/CrmDeal');
const CrmCompany = require('../models/CrmCompany');
const { emitToAll } = require('../websocket/socketManager');
const { grantedBySection } = require('../utils/sectionAccess');
const { createNotification } = require('../services/notificationService');
const { endedStaff, userEnded } = require('../utils/endedStaff');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const SALES_STAFF_ROLES = ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'];
const SALES_ADMIN_ROLES = ['super_admin', 'admin', 'sales_manager'];
const isStaff = (u) => SALES_STAFF_ROLES.includes(u.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const staffReq = (req) => isStaff(req.user) || grantedBySection(req);
const isAdmin = (u) => SALES_ADMIN_ROLES.includes(u.role);
// Who writes the target.
// A manager sets the team's target; a rep writing his own is not a target. The screen showed target buttons to anyone with edit on the section (which includes the rep in the matrix) and this guard then returned 403. The rule is the same on both sides (`canSetSalesTargets` in lib/finance): management roles, plus a role outside the section team granted edit by the system owner (a future senior manager). Team members read targets but do not write them.
const canSetTargets = (req) => isAdmin(req.user)
  || (req.sectionAccess === 'edit' && !isStaff(req.user));
const denyNonStaff = (req, res) => { if (!staffReq(req)) { res.status(403).json({ message: 'Insufficient permissions' }); return true; } return false; };
const denyNonAdmin = (req, res) => { if (!canSetTargets(req)) { res.status(403).json({ message: 'الأهدافُ يحدّدها مديرُ المبيعات', code: 'TARGETS_MANAGER_ONLY' }); return true; } return false; };
const badId = (id, res) => { if (!mongoose.isValidObjectId(id)) { res.status(400).json({ message: 'Invalid id' }); return true; } return false; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Clear the cache, then broadcast.
// The sales dashboard is cached 12 seconds (`dash:sales:`). Broadcasting without clearing sends screens back to the old number with nothing to wake them, so a save looks one step late (see announce-before-invalidate). `sales:updated` is a single event for anything changing in the section: the phone (one event listener) and the web both hear it.
const emitSales = (event, payload = {}) => {
  try { require('../utils/ttlCache').clear('dash:sales:'); } catch (e) {}
  try { emitToAll(event, payload); emitToAll('sales:updated', {}); } catch (e) {}
};
// The month is the Riyadh month.
// The month used server time (UTC), so a deal won in the first three hours of the month counted for the previous one and this month lagged the team's calendar by three hours.
const RIYADH_MS = 3 * 60 * 60 * 1000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisPeriod = () => new Date(Date.now() + RIYADH_MS).toISOString().slice(0, 7);
const cleanPeriod = (p) => (PERIOD_RE.test(String(p || '')) ? String(p) : thisPeriod());
const periodRange = (period) => {
  const [y, m] = cleanPeriod(period).split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - RIYADH_MS), end: new Date(Date.UTC(y, m, 1) - RIYADH_MS - 1) };
};
/**
 * Team target for the month.
 * The whole-team row (no rep) is the team target if set, otherwise the sum of rep targets. The two used to be added together, so a team target of one million split across reps read as two million and attainment was half its true value.
 */
const teamTargetOf = (targets) => {
  const team = targets.find((t) => !t.rep);
  if (team) return team.amountTarget || 0;
  return targets.reduce((s2, t) => s2 + (t.amountTarget || 0), 0);
};
// A rep is anyone who can own deals: sales + the admins/managers.
const repFilter = { role: { $in: [...SALES_STAFF_ROLES, 'crm_manager', 'crm_specialist'] }, isActive: true };
// The current-reps list excludes anyone whose service HR ended: his account stays active after termination, so the filter alone is not enough.
const currentReps = async (select) => {
  const [all, ended] = await Promise.all([User.find(repFilter).select(select).sort({ firstName: 1 }).lean(), endedStaff()]);
  return { reps: all.filter((r) => !userEnded(ended, r)), former: all.filter((r) => userEnded(ended, r)) };
};

// ── Options ──────────────────────────────────────────────────────────────────
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { reps } = await currentReps('firstName lastName email role');
    res.json({ reps });
  } catch (error) {
    console.error('getOptions error:', error);
    res.status(500).json({ message: 'Failed to load options' });
  }
};

// ── Dashboard ────────────────────────────────────────────────────────────────
// Previous YYYY-MM relative to a given period.
const prevPeriod = (period) => {
  const [y, m] = cleanPeriod(period).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Same data for every staff viewer (per period) — cache briefly so concurrent
    // loads and socket-driven reloads share one computation. See crm dashboard.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:sales:${cleanPeriod(req.query.period)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);
    const _send = res.json.bind(res);
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 12000); return _send(b); };
    const period = cleanPeriod(req.query.period);
    const { start, end } = periodRange(period);
    const prev = prevPeriod(period);
    const { start: pStart, end: pEnd } = periodRange(prev);

    const [
      wonAgg, openAgg, lostAgg, targets, byRep,
      prevWonAgg, prevLostAgg, stageAgg, perRepWon, perRepOpen,
    ] = await Promise.all([
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: start, $lte: end } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'lost', lostAt: { $gte: start, $lte: end } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      SalesTarget.find({ period }).lean(),
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: start, $lte: end } } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }, { $sort: { value: -1 } }, { $limit: 10 }]),
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: pStart, $lte: pEnd } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'lost', lostAt: { $gte: pStart, $lte: pEnd } } }, { $group: { _id: null, count: { $sum: 1 } } }]),
      // Open pipeline grouped by stage (count + value).
      CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      // Per-rep won (this period) and open pipeline — for performance rows.
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: start, $lte: end } } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
    ]);

    const won = wonAgg[0] || { count: 0, value: 0 };
    const lost = lostAgg[0] || { count: 0, value: 0 };
    const open = openAgg[0] || { count: 0, value: 0 };
    const prevWon = prevWonAgg[0] || { count: 0, value: 0 };
    const prevLost = prevLostAgg[0] || { count: 0 };
    const teamTarget = teamTargetOf(targets);
    const closed = won.count + lost.count;
    const prevClosed = prevWon.count + prevLost.count;

    // Pipeline by stage (only the active/open stages).
    const STAGE_ORDER = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];
    const stageMap = {}; stageAgg.forEach((s) => { stageMap[String(s._id)] = s; });
    const byStage = STAGE_ORDER.map((key) => {
      const s = stageMap[key] || { count: 0, value: 0 };
      return { stage: key, count: s.count, value: round2(s.value) };
    });

    // Per-rep performance rows (won vs target). Build over reps with any activity or a target.
    const tgtMap = {}; targets.forEach((t) => { if (t.rep) tgtMap[String(t.rep)] = t; });
    const perWonMap = {}; perRepWon.forEach((w) => { perWonMap[String(w._id)] = w; });
    const perOpenMap = {}; perRepOpen.forEach((o) => { perOpenMap[String(o._id)] = o; });
    const allRepIds = new Set([
      ...byRep.map((r) => r._id).filter(Boolean).map(String),
      ...perRepWon.map((r) => r._id).filter(Boolean).map(String),
      ...perRepOpen.map((r) => r._id).filter(Boolean).map(String),
      ...Object.keys(tgtMap),
    ]);
    const reps = await User.find({ _id: { $in: [...allRepIds] } }).select('firstName lastName').lean();
    const repMap = {}; reps.forEach((r) => { repMap[String(r._id)] = `${r.firstName} ${r.lastName}`; });

    const repRows = [...allRepIds].map((id) => {
      const w = perWonMap[id] || { count: 0, value: 0 };
      const o = perOpenMap[id] || { count: 0, value: 0 };
      const t = tgtMap[id] || { amountTarget: 0 };
      return {
        repId: id,
        rep: repMap[id] || '—',
        wonValue: round2(w.value), wonCount: w.count,
        openValue: round2(o.value), openCount: o.count,
        target: round2(t.amountTarget),
        attainment: t.amountTarget ? round2((w.value / t.amountTarget) * 100) : 0,
      };
    }).sort((a, b) => b.wonValue - a.wonValue);

    res.json({
      period, prevPeriod: prev,
      wonValue: round2(won.value), wonCount: won.count,
      lostValue: round2(lost.value), lostCount: lost.count,
      openValue: round2(open.value), openCount: open.count,
      teamTarget: round2(teamTarget),
      attainment: teamTarget ? round2((won.value / teamTarget) * 100) : 0,
      winRate: closed ? round2((won.count / closed) * 100) : 0,
      avgDealSize: won.count ? round2(won.value / won.count) : 0,
      prevWonValue: round2(prevWon.value), prevWonCount: prevWon.count,
      prevWinRate: prevClosed ? round2((prevWon.count / prevClosed) * 100) : 0,
      byStage,
      repRows,
      topReps: byRep.map((r) => ({ repId: String(r._id), rep: repMap[String(r._id)] || '—', count: r.count, value: round2(r.value) })),
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Targets ──────────────────────────────────────────────────────────────────
exports.listTargets = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { period } = req.query;
    const filter = {};
    if (period) filter.period = period;
    const targets = await SalesTarget.find(filter).populate('rep', 'firstName lastName email role').sort({ period: -1 }).lean();
    // `canEdit` is stated by the server so the screen and phone do not show a button that would be rejected.
    res.json({ targets, canEdit: canSetTargets(req) });
  } catch (error) {
    console.error('listTargets error:', error);
    res.status(500).json({ message: 'Failed to load targets' });
  }
};

exports.createTarget = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { rep, amountTarget, dealsTarget, notes } = req.body;
    const period = String(req.body.period || '').trim();
    // The period is written as a month (YYYY-MM): other formats such as 2026/10 or 10-2026 are saved but never read by any month, leaving a target that appears in no dashboard or performance view.
    if (!PERIOD_RE.test(period)) return res.status(400).json({ message: 'الفترةُ مطلوبةٌ بصيغة السنة والشهر (مثال: 2026-10)' });
    if (rep && !mongoose.isValidObjectId(rep)) return res.status(400).json({ message: 'المندوبُ غير صحيح' });
    if (Number(amountTarget) < 0 || Number(dealsTarget) < 0) return res.status(400).json({ message: 'الهدفُ لا يكون سالبًا' });
    const data = { rep: rep || null, period, amountTarget: Number(amountTarget) || 0, dealsTarget: Number(dealsTarget) || 0, notes, createdBy: req.user._id };
    // Upsert so re-setting a rep's target for a period overwrites it.
    const target = await SalesTarget.findOneAndUpdate({ rep: data.rep, period }, data, { new: true, upsert: true, setDefaultsOnInsert: true });
    // Notify the rep this target was set for (skip team-wide targets and self).
    if (target.rep && String(target.rep) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: target.rep,
          type: 'task_assigned',
          title: 'تم تحديد هدف مبيعات',
          message: `تم تعيين هدف مبيعات لك للفترة ${period}.`,
          relatedEntity: 'SalesTarget',
          relatedEntityId: target._id,
        });
      } catch (e) {}
    }
    emitSales('sales:target', { id: String(target._id) });
    res.status(201).json({ target });
  } catch (error) {
    console.error('createTarget error:', error);
    res.status(500).json({ message: 'Failed to set target' });
  }
};

exports.updateTarget = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const target = await SalesTarget.findById(id);
    if (!target) return res.status(404).json({ message: 'Target not found' });
    for (const f of ['amountTarget', 'dealsTarget']) {
      if (req.body[f] === undefined) continue;
      const n = Number(req.body[f]);
      // An empty string from a numeric field used to reach the database and return 500 with no reason.
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: 'الهدفُ رقمٌ غير سالب' });
      target[f] = n;
    }
    if (req.body.notes !== undefined) target.notes = req.body.notes;
    await target.save();
    emitSales('sales:target', { id: String(id) });
    res.json({ target });
  } catch (error) {
    console.error('updateTarget error:', error);
    res.status(500).json({ message: 'Failed to update target' });
  }
};

exports.deleteTarget = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const target = await SalesTarget.findByIdAndDelete(id);
    if (!target) return res.status(404).json({ message: 'Target not found' });
    emitSales('sales:target', { id: String(id), deleted: true });
    res.json({ message: 'Target deleted' });
  } catch (error) {
    console.error('deleteTarget error:', error);
    res.status(500).json({ message: 'Failed to delete target' });
  }
};

// ── Performance (per rep, actual vs target) ──────────────────────────────────
exports.getPerformance = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const period = cleanPeriod(req.query.period);
    const { start, end } = periodRange(period);

    const [{ reps, former }, won, open, targets] = await Promise.all([
      currentReps('firstName lastName email role'),
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: start, $lte: end } } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      SalesTarget.find({ period }).lean(),
    ]);
    const wonMap = {}; won.forEach((w) => { wonMap[String(w._id)] = w; });
    const openMap = {}; open.forEach((o) => { openMap[String(o._id)] = o; });
    const tgtMap = {}; targets.forEach((t) => { if (t.rep) tgtMap[String(t.rep)] = t; });

    // An ended employee is not a current rep, but what he won this month and the open deals still in his name stay in the total, shown as a former row while they have a number.
    const gone = former.filter((r) => wonMap[String(r._id)] || openMap[String(r._id)]);
    const rows = [...reps, ...gone.map((r) => ({ ...r, former: true }))].map((r) => {
      const w = wonMap[String(r._id)] || { count: 0, value: 0 };
      const o = openMap[String(r._id)] || { count: 0, value: 0 };
      const t = tgtMap[String(r._id)] || { amountTarget: 0, dealsTarget: 0 };
      return {
        ...(r.former ? { former: true } : {}),
        rep: { _id: r._id, name: `${r.firstName} ${r.lastName}`, role: r.role },
        wonValue: round2(w.value), wonCount: w.count,
        openValue: round2(o.value), openCount: o.count,
        target: round2(t.amountTarget), dealsTarget: t.dealsTarget,
        attainment: t.amountTarget ? round2((w.value / t.amountTarget) * 100) : 0,
      };
    }).sort((a, b) => b.wonValue - a.wonValue);
    res.json({ period, rows });
  } catch (error) {
    console.error('getPerformance error:', error);
    res.status(500).json({ message: 'Failed to load performance' });
  }
};

// ── Pipeline (read CRM deals, grouped) — links Sales ↔ CRM ───────────────────
exports.getPipeline = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { owner } = req.query;
    const filter = {};
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    const deals = await CrmDeal.find(filter)
      .populate('company', 'name arabicName')
      .populate('owner', 'firstName lastName')
      .sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ deals });
  } catch (error) {
    console.error('getPipeline error:', error);
    res.status(500).json({ message: 'Failed to load pipeline' });
  }
};
