/**
 * b2cWalletController — custody (عهدة) wallets for B2C project managers.
 * Self-contained; touches nothing else in B2C.
 *
 * Visibility:
 *   - A project manager sees/records ONLY their own wallet.
 *   - Managers (super_admin / admin / b2c_head) can grant custody to any PM and
 *     audit every wallet + full history.
 */
const mongoose = require('mongoose');
const B2CWalletEntry = require('../models/B2CWalletEntry');
const User = require('../models/User');
const { emitToUser } = require('../websocket/socketManager');

const MANAGER_ROLES = ['super_admin', 'admin', 'b2c_manager'];
const isManager = (u) => u && MANAGER_ROLES.includes(u.role);

async function balanceOf(pmId) {
  const rows = await B2CWalletEntry.aggregate([
    { $match: { projectManager: new mongoose.Types.ObjectId(String(pmId)) } },
    { $group: { _id: '$direction', total: { $sum: '$amount' } } },
  ]);
  let inSum = 0; let outSum = 0;
  rows.forEach((r) => { if (r._id === 'in') inSum = r.total; else if (r._id === 'out') outSum = r.total; });
  return { totalIn: inSum, totalOut: outSum, balance: inSum - outSum };
}

const popEntry = (q) => q.populate('createdBy', 'firstName lastName role').populate('projectManager', 'firstName lastName');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const endOfDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T23:59:59.999` : d);

// GET /managers — every project manager + their balance (managers only).
exports.managers = async (req, res) => {
  try {
    const pms = await User.find({ role: 'b2c_project_lead', isActive: true }).select('firstName lastName email').sort({ firstName: 1 }).lean();
    const withBal = await Promise.all(pms.map(async (p) => ({ ...p, ...(await balanceOf(p._id)) })));
    res.json({ managers: withBal });
  } catch (e) {
    console.error('b2cWallet managers error:', e.message);
    res.status(500).json({ message: 'Failed to load managers' });
  }
};

// Returns the wallet for `pmId`, optionally filtered by date range / search.
// Always includes the all-time balance; when filtered, also the period totals.
async function entriesFor(req, pmId, res) {
  const { date_from, date_to, search } = req.query;
  const filter = { projectManager: pmId };
  if (date_from || date_to) {
    filter.createdAt = {};
    if (date_from) filter.createdAt.$gte = new Date(date_from);
    if (date_to) filter.createdAt.$lte = new Date(endOfDay(date_to));
  }
  if (search && String(search).trim()) filter.reason = new RegExp(escapeRegex(String(search).trim()), 'i');

  const entries = await popEntry(B2CWalletEntry.find(filter)).sort({ createdAt: -1 }).limit(2000).lean();
  let periodIn = 0; let periodOut = 0;
  entries.forEach((e) => { if (e.direction === 'in') periodIn += e.amount; else periodOut += e.amount; });
  const overall = await balanceOf(pmId);
  const filtered = Boolean(date_from || date_to || (search && String(search).trim()));
  res.json({ entries, ...overall, periodIn, periodOut, periodBalance: periodIn - periodOut, filtered });
}

// GET /me — the current PM's own wallet.
exports.myWallet = async (req, res) => {
  try { await entriesFor(req, req.user._id, res); }
  catch (e) { console.error('b2cWallet me error:', e.message); res.status(500).json({ message: 'Failed to load wallet' }); }
};

// GET /:managerId — a specific PM's wallet (managers, or the PM themselves).
exports.walletOf = async (req, res) => {
  try {
    const target = String(req.params.managerId);
    if (!isManager(req.user) && target !== String(req.user._id)) return res.status(403).json({ message: 'Not allowed' });
    await entriesFor(req, target, res);
  } catch (e) { console.error('b2cWallet walletOf error:', e.message); res.status(500).json({ message: 'Failed to load wallet' }); }
};

// POST / — record an entry. PMs can only post to their own wallet; managers can
// post (grant custody) to any PM.
exports.create = async (req, res) => {
  try {
    const { direction, amount, method = '', reason = '' } = req.body;
    if (!['in', 'out'].includes(direction)) return res.status(400).json({ message: 'direction must be in/out' });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ message: 'amount must be a positive number' });

    let projectManager = String(req.body.projectManager || '');
    if (isManager(req.user)) {
      if (!projectManager) return res.status(400).json({ message: 'projectManager is required' });
      const pm = await User.findOne({ _id: projectManager, role: 'b2c_project_lead' }).select('_id').lean();
      if (!pm) return res.status(400).json({ message: 'Invalid project manager' });
    } else {
      projectManager = String(req.user._id); // PMs always post to their own wallet
    }

    const entry = await B2CWalletEntry.create({
      projectManager, direction, amount: amt,
      method: direction === 'in' ? method : '',
      reason: String(reason).trim(),
      createdBy: req.user._id,
    });
    try { emitToUser(String(projectManager), 'b2c:wallet', { id: String(entry._id) }); } catch (e) {}
    const full = await popEntry(B2CWalletEntry.findById(entry._id)).lean();
    res.status(201).json({ entry: full });
  } catch (e) {
    console.error('b2cWallet create error:', e.message);
    res.status(500).json({ message: 'Failed to record entry' });
  }
};

// An entry may be edited/deleted by a manager OR by whoever recorded it (so a PM
// can fix/remove their own movements, but not a grant the company made to them).
const canModify = (user, entry) => isManager(user) || String(entry.createdBy) === String(user._id);

// PATCH /:id — edit an entry.
exports.update = async (req, res) => {
  try {
    const entry = await B2CWalletEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Not found' });
    if (!canModify(req.user, entry)) return res.status(403).json({ message: 'Not allowed' });

    const { direction, amount, method, reason } = req.body;
    if (direction && ['in', 'out'].includes(direction)) entry.direction = direction;
    if (amount !== undefined) { const a = Number(amount); if (a > 0) entry.amount = a; }
    if (reason !== undefined) entry.reason = String(reason).trim();
    if (method !== undefined) entry.method = entry.direction === 'in' ? method : '';
    await entry.save();
    try { emitToUser(String(entry.projectManager), 'b2c:wallet', { id: String(entry._id) }); } catch (e) {}
    const full = await popEntry(B2CWalletEntry.findById(entry._id)).lean();
    res.json({ entry: full });
  } catch (e) {
    console.error('b2cWallet update error:', e.message);
    res.status(500).json({ message: 'Failed to update' });
  }
};

// DELETE /:id — manager, or the person who recorded the entry.
exports.remove = async (req, res) => {
  try {
    const entry = await B2CWalletEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Not found' });
    if (!canModify(req.user, entry)) return res.status(403).json({ message: 'Not allowed' });
    const pm = String(entry.projectManager);
    await entry.deleteOne();
    try { emitToUser(pm, 'b2c:wallet', { deleted: true }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) {
    console.error('b2cWallet remove error:', e.message);
    res.status(500).json({ message: 'Failed to delete' });
  }
};

exports.MANAGER_ROLES = MANAGER_ROLES;
