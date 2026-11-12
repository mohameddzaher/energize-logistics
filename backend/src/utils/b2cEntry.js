/**
 * b2cEntry: rep order entries typed on the system.
 * The rep is his light transport register row (`LightTransportEmployee`); each row has one orders account (`B2CRep.ltEmployee`) carrying his whole history. Orders project is the register project (`B2CProject.nameAr`) and moves only via project transfer (`TRANSFER_ROLES`), effective from that day.
 * Managers see only `User.assignedProjects`. Target is monthly / 30 per day times counted days: achieved >= 100%, near >= 80%, otherwise far; Amazon has no target.
 */
const mongoose = require('mongoose');

const NEAR = 0.8;
const MONTH_DAYS = 30;
const ENDED = 'إنهاء خدمة';

const isFinanceFull = (role) => { try { return require('../config/financeAuthority').isFinanceFull(role); } catch (_) { return false; } };
/** Who sees all projects and enters for any rep. */
const isEntryHead = (u) => ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy'].includes(u?.role) || isFinanceFull(u?.role);
/** Project transfer: sector deputy manager, section manager, super admin and admin (and finance roles as system manager). */
const TRANSFER_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy'];
const canTransfer = (u) => TRANSFER_ROLES.includes(u?.role) || isFinanceFull(u?.role);
/** Who enters orders, within their projects. */
const ENTRY_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];

const S = (v) => String(v ?? '').trim();
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/\s+/g, '').toLowerCase();

/** Order projects by their Arabic names. */
async function projects() {
  const B2CProject = require('../models/B2CProject');
  const rows = await B2CProject.find({ isActive: true }).lean();
  const byAr = new Map(); const byId = new Map();
  for (const p of rows) {
    byId.set(String(p._id), p);
    for (const n of [p.nameAr, p.name]) if (S(n)) byAr.set(fold(n), p);
  }
  return { rows, byAr, byId, of: (projectAr) => byAr.get(fold(projectAr)) || null };
}

/** Orders branch from the register city (Jeddah, Makkah). */
async function branchFor(cityAr) {
  const Branch = require('../models/Branch');
  const f = fold(cityAr);
  const all = await Branch.find({}).select('name nameAr').lean();
  const pick = (re) => all.find((b) => re.test(`${b.name || ''} ${b.nameAr || ''}`));
  if (/مك|makk|mecc/.test(f)) return pick(/makkah|mecca|مك/i)?._id || null;
  return pick(/jeddah|jedda|جد/i)?._id || null;
}

/** A user's projects by Arabic name; null means all. */
async function scopeOf(user) {
  if (isEntryHead(user)) return null;
  const U = require('../models/User');
  const u = await U.findById(user._id).select('assignedProjects').lean();
  const { byId } = await projects();
  return (u?.assignedProjects || []).map((id) => byId.get(String(id))).filter(Boolean).map((p) => S(p.nameAr || p.name));
}
const inScope = (scope, projectAr) => scope === null || scope.some((n) => fold(n) === fold(projectAr));

/** A rep's orders account: an existing linked one, or created already linked. Its project and branch come from his register row. Returns the account document. */
async function ensureRep(lt, user) {
  const B2CRep = require('../models/B2CRep');
  const P = await projects();
  const proj = P.of(lt.projectAr);
  let rep = await B2CRep.findOne({ ltEmployee: lt._id }).sort({ updatedAt: -1 });
  const branch = await branchFor(lt.cityAr);
  if (!rep) {
    rep = await B2CRep.create({
      englishName: S(lt.name) || S(lt.idNumber), arabicName: S(lt.name), phone: S(lt.phone),
      project: proj?._id, branch, ltEmployee: lt._id, isActive: true, createdBy: user?._id,
      supervisor: lt.supervisorUser || undefined,
      monthlyTarget: proj?.monthlyTarget ?? 450, dailyTarget: proj ? Math.round((proj.monthlyTarget || 0) / MONTH_DAYS) : 15,
    });
  } else {
    let dirty = false;
    if (proj && String(rep.project) !== String(proj._id)) { rep.project = proj._id; dirty = true; }
    if (branch && String(rep.branch || '') !== String(branch)) { rep.branch = branch; dirty = true; }
    if (!rep.isActive) { rep.isActive = true; dirty = true; }
    if (dirty) await rep.save();
  }
  return rep;
}

/** After a project or city move: the orders account goes onto the new project from now on. */
async function syncRepOf(lt) {
  const B2CRep = require('../models/B2CRep');
  const P = await projects();
  const proj = P.of(lt.projectAr);
  const branch = await branchFor(lt.cityAr);
  const set = {};
  if (proj) { set.project = proj._id; set.monthlyTarget = proj.monthlyTarget ?? 450; }
  if (branch) set.branch = branch;
  // The Arabic name and phone follow their owner. They used to be written once from the sheet and never moved, so the name of 122 accounts differed from the register. The account's English name (`englishName`) is its name on the app and is left alone.
  if (S(lt.name)) set.arabicName = S(lt.name);
  if (S(lt.phone)) set.phone = S(lt.phone);
  if (!Object.keys(set).length) return 0;
  const r = await B2CRep.updateMany({ ltEmployee: lt._id }, { $set: set });
  return r.modifiedCount || 0;
}

/** Rating of a rep over a period. */
function evaluate({ total, workedDays, project }) {
  const monthly = Number(project?.monthlyTarget || 0);
  if (!monthly) return { target: null, pct: null, evaluation: 'شحنات' };
  const target = Math.round((monthly / MONTH_DAYS) * workedDays);
  if (!workedDays) return { target: 0, pct: null, evaluation: 'لا طلبات' };
  const pct = target ? total / target : null;
  return { target, pct, evaluation: pct >= 1 ? 'حقق' : pct >= NEAR ? 'قريب' : 'بعيد' };
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(S(v)) ? S(v) : null);
const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(d));

/** A rep's project on each day, from his move history (`history` entries of kind project). Returns a function dateKey to project name on that day. `project_fix` (correcting a project written wrongly from the start) is not read as a move: the rep was in the corrected project from day one. */
function projectTimeline(lt) {
  const moves = (lt.history || []).filter((h) => h.kind === 'project' && h.at)
    .map((h) => ({ day: riyadhDay(h.at), from: S(h.fromValue), to: S(h.toValue) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return (dk) => {
    if (!moves.length) return S(lt.projectAr);
    // A move takes effect on its day: the transfer day counts in the new project.
    let cur = moves[0].from || S(lt.projectAr);
    for (const mv of moves) { if (mv.day <= dk) cur = mv.to; else break; }
    return cur;
  };
}

/**
 * One day figure per man, and the latest is authoritative. A rep may have more than one orders account (from old sheets), and the sheet and the entries both sum his accounts into the day cell. When a number is written to one account, what is in his other accounts that day is cleared; otherwise old and new would be summed.
 * `projectId` limits the clearing to one project (old months show by the order's project).
 * `byName` includes accounts not linked to him, attributing them by name (old months).
 */
async function clearOtherAccounts(lt, keepRepId, dateKey, { projectId = null, byName = false } = {}) {
  const B2CRep = require('../models/B2CRep');
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const or = [{ ltEmployee: lt._id }];
  if (byName && S(lt.name)) or.push({ ltEmployee: null });
  let reps = await B2CRep.find({ $or: or, _id: { $ne: keepRepId } }).select('_id ltEmployee arabicName englishName').lean();
  reps = reps.filter((r) => r.ltEmployee || fold(r.arabicName || r.englishName) === fold(lt.name));
  if (!reps.length) return 0;
  const q = { rep: { $in: reps.map((r) => r._id) }, dateKey, orders: { $ne: null } };
  if (projectId) q.project = projectId;
  const r = await B2CDailyOrder.updateMany(q, { $set: { orders: null, worked: false } });
  return r.modifiedCount || 0;
}

module.exports = {
  NEAR, MONTH_DAYS, ENDED, TRANSFER_ROLES, ENTRY_ROLES,
  isEntryHead, canTransfer, projects, branchFor, scopeOf, inScope, ensureRep, syncRepOf, evaluate, fold, dayKey, isoDate,
  projectTimeline, clearOtherAccounts, riyadhDay,
  oid: (v) => new mongoose.Types.ObjectId(String(v)),
};
