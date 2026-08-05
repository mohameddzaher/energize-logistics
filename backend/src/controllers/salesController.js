const mongoose = require('mongoose');
const User = require('../models/User');
const SalesTarget = require('../models/SalesTarget');
const CrmDeal = require('../models/CrmDeal');
const CrmCompany = require('../models/CrmCompany');
const { emitToAll } = require('../websocket/socketManager');
const { grantedBySection } = require('../utils/sectionAccess');
const { createNotification } = require('../services/notificationService');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const SALES_STAFF_ROLES = ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'];
const SALES_ADMIN_ROLES = ['super_admin', 'admin', 'sales_manager'];
const isStaff = (u) => SALES_STAFF_ROLES.includes(u.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const staffReq = (req) => isStaff(req.user) || grantedBySection(req);
const isAdmin = (u) => SALES_ADMIN_ROLES.includes(u.role);
const denyNonStaff = (req, res) => { if (!staffReq(req)) { res.status(403).json({ message: 'Insufficient permissions' }); return true; } return false; };
const denyNonAdmin = (req, res) => { if (!isAdmin(req.user)) { res.status(403).json({ message: 'Only sales managers can perform this action' }); return true; } return false; };
const badId = (id, res) => { if (!mongoose.isValidObjectId(id)) { res.status(400).json({ message: 'Invalid id' }); return true; } return false; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const emitSales = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };
const thisPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const periodRange = (period) => {
  const [y, m] = (period || thisPeriod()).split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59) };
};
// A rep is anyone who can own deals: sales + the admins/managers.
const repFilter = { role: { $in: [...SALES_STAFF_ROLES, 'crm_manager', 'crm_specialist'] }, isActive: true };

// ── Options ──────────────────────────────────────────────────────────────────
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const reps = await User.find(repFilter).select('firstName lastName email role').sort({ firstName: 1 }).lean();
    res.json({ reps });
  } catch (error) {
    console.error('getOptions error:', error);
    res.status(500).json({ message: 'Failed to load options' });
  }
};

// ── Dashboard ────────────────────────────────────────────────────────────────
// Previous YYYY-MM relative to a given period.
const prevPeriod = (period) => {
  const [y, m] = (period || thisPeriod()).split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Same data for every staff viewer (per period) — cache briefly so concurrent
    // loads and socket-driven reloads share one computation. See crm dashboard.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:sales:${JSON.stringify(req.query)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);
    const _send = res.json.bind(res);
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 12000); return _send(b); };
    const period = req.query.period || thisPeriod();
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
    const teamTarget = targets.reduce((s, t) => s + (t.amountTarget || 0), 0);
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
    res.json({ targets });
  } catch (error) {
    console.error('listTargets error:', error);
    res.status(500).json({ message: 'Failed to load targets' });
  }
};

exports.createTarget = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { rep, period, amountTarget, dealsTarget, notes } = req.body;
    if (!period) return res.status(400).json({ message: 'Period (YYYY-MM) is required' });
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
    ['amountTarget', 'dealsTarget', 'notes'].forEach((f) => { if (req.body[f] !== undefined) target[f] = req.body[f]; });
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
    const period = req.query.period || thisPeriod();
    const { start, end } = periodRange(period);

    const [reps, won, open, targets] = await Promise.all([
      User.find(repFilter).select('firstName lastName email role').lean(),
      CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: start, $lte: end } } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$owner', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
      SalesTarget.find({ period }).lean(),
    ]);
    const wonMap = {}; won.forEach((w) => { wonMap[String(w._id)] = w; });
    const openMap = {}; open.forEach((o) => { openMap[String(o._id)] = o; });
    const tgtMap = {}; targets.forEach((t) => { if (t.rep) tgtMap[String(t.rep)] = t; });

    const rows = reps.map((r) => {
      const w = wonMap[String(r._id)] || { count: 0, value: 0 };
      const o = openMap[String(r._id)] || { count: 0, value: 0 };
      const t = tgtMap[String(r._id)] || { amountTarget: 0, dealsTarget: 0 };
      return {
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
