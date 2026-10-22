/**
 * b2cEntry — مدخلات أوردرات المناديب على النظام (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * ── ما كان ────────────────────────────────────────────────────────────────
 * الأوردراتُ تُكتب في شيتات جوجل لكلّ مشروع، والنظامُ يسحبها كلَّ دقيقة ويعرّف
 * المندوبَ باسمه الإنجليزيّ في الشيت (`B2CRep`) — فصار في النظام ٦٩٦ «مندوبًا»
 * لمئةٍ وسبعين رجلًا، و٦٣ منهم فقط مربوطون بسجلّ النقل الخفيف. ونقلُ المندوب من
 * مشروعٍ إلى آخر في سجلّه لا يحرّك طلباتِه.
 *
 * ── ما صار ────────────────────────────────────────────────────────────────
 * ١. **المندوبُ هو صفُّه في سجلّ النقل الخفيف** (`LightTransportEmployee`). ولكلّ صفٍّ
 *    حسابُ طلباتٍ واحد (`B2CRep.ltEmployee`) يحمل تاريخَه كلَّه — فما كُتب في
 *    الشيتات قبلُ وما يُكتب في النظام بعدُ رقمٌ واحدٌ متّصل.
 * ٢. **مشروعُ طلباته مشروعُ سجلّه**: `projectAr` ← `B2CProject.nameAr`. ونقلُ المشروع
 *    لا يكون إلّا بـ«نقل مشروع» ممّن يملكه (`TRANSFER_ROLES`)، ومن يومه تُكتب طلباتُه
 *    على مشروعه الجديد وتبقى القديمةُ على القديم.
 * ٣. **مديرُ المشروع يرى مشاريعَه وحدَها**: `User.assignedProjects` — تُسنَد من سجلّ
 *    النقل الخفيف، وقد تكون أكثرَ من مشروع. والإدارةُ ترى الكلّ.
 * ٤. **الهدفُ من المشروع**: الشهريُّ ÷ ٣٠ يوميًّا، × أيام الاحتساب (أيامٌ فيها طلبات).
 *    حقّق ≥ ١٠٠٪ · قريب ≥ ٨٠٪ · بعيد أقلّ. وامازون شحناتٌ بلا هدف.
 */
const mongoose = require('mongoose');

const NEAR = 0.8;
const MONTH_DAYS = 30;
const ENDED = 'إنهاء خدمة';

const isFinanceFull = (role) => { try { return require('../config/financeAuthority').isFinanceFull(role); } catch (_) { return false; } };
/** مَن يرى كلَّ المشاريع ويُدخل لكلّ مندوب. */
const isEntryHead = (u) => ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy'].includes(u?.role) || isFinanceFull(u?.role);
/** «نقل مشروع» — نائبُ مدير القطاع ومديرُ القسم والسوبر أدمن والأدمن (وأهلُ المال كمدير النظام). */
const TRANSFER_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy'];
const canTransfer = (u) => TRANSFER_ROLES.includes(u?.role) || isFinanceFull(u?.role);
/** مَن يُدخل الأوردرات — في مشاريعه. */
const ENTRY_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];

const S = (v) => String(v ?? '').trim();
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/\s+/g, '').toLowerCase();

/** مشاريعُ الطلبات بأسمائها العربيّة. */
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

/** فرعُ الطلبات من مدينة السجلّ (جدة · مكة). */
async function branchFor(cityAr) {
  const Branch = require('../models/Branch');
  const f = fold(cityAr);
  const all = await Branch.find({}).select('name nameAr').lean();
  const pick = (re) => all.find((b) => re.test(`${b.name || ''} ${b.nameAr || ''}`));
  if (/مك|makk|mecc/.test(f)) return pick(/makkah|mecca|مك/i)?._id || null;
  return pick(/jeddah|jedda|جد/i)?._id || null;
}

/** مشاريعُ المستخدم بأسمائها العربيّة — null = كلُّها. */
async function scopeOf(user) {
  if (isEntryHead(user)) return null;
  const U = require('../models/User');
  const u = await U.findById(user._id).select('assignedProjects').lean();
  const { byId } = await projects();
  return (u?.assignedProjects || []).map((id) => byId.get(String(id))).filter(Boolean).map((p) => S(p.nameAr || p.name));
}
const inScope = (scope, projectAr) => scope === null || scope.some((n) => fold(n) === fold(projectAr));

/**
 * حسابُ طلبات المندوب — موجودٌ مربوط، أو يُنشأ مربوطًا. ومشروعُه وفرعُه من سجلّه.
 * يُرجع الحساب (وثيقة).
 */
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

/** بعد نقل مشروع أو مدينة: حسابُ طلباته على مشروعه الجديد من الآن. */
async function syncRepOf(lt) {
  const B2CRep = require('../models/B2CRep');
  const P = await projects();
  const proj = P.of(lt.projectAr);
  const branch = await branchFor(lt.cityAr);
  const set = {};
  if (proj) { set.project = proj._id; set.monthlyTarget = proj.monthlyTarget ?? 450; }
  if (branch) set.branch = branch;
  // والاسمُ العربيُّ والجوالُ يتبعان صاحبَهما — كانا يُكتبان مرّةً من الشيت ثمّ
  // لا يتحرّكان، فاختلف اسمُ مئةٍ واثنين وعشرين حسابًا عن سجلّه. واسمُ الحساب
  // الإنجليزيُّ (`englishName`) اسمُه على التطبيق فلا يُمسّ.
  if (S(lt.name)) set.arabicName = S(lt.name);
  if (S(lt.phone)) set.phone = S(lt.phone);
  if (!Object.keys(set).length) return 0;
  const r = await B2CRep.updateMany({ ltEmployee: lt._id }, { $set: set });
  return r.modifiedCount || 0;
}

/** تقييمُ مندوبٍ على فترة. */
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

/**
 * مشروعُ المندوب في كلّ يوم — من سجلّ نقله (`history` بـ kind: project).
 * يُرجع دالّةً: dateKey → اسمُ المشروع في ذلك اليوم.
 * و`project_fix` (تصحيحُ مشروعٍ كُتب خطأً من البداية) لا يُقرأ نقلًا: المندوبُ كان
 * في مشروعه المصحَّح من أوّل يوم.
 */
function projectTimeline(lt) {
  const moves = (lt.history || []).filter((h) => h.kind === 'project' && h.at)
    .map((h) => ({ day: riyadhDay(h.at), from: S(h.fromValue), to: S(h.toValue) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return (dk) => {
    if (!moves.length) return S(lt.projectAr);
    // النقلُ نافذٌ من يومه: يومُ النقل في المشروع الجديد.
    let cur = moves[0].from || S(lt.projectAr);
    for (const mv of moves) { if (mv.day <= dk) cur = mv.to; else break; }
    return cur;
  };
}

/**
 * رقمُ اليوم واحدٌ للرجل — والآخرُ هو المعتمد. قد يكون للمندوب أكثرُ من حساب طلبات
 * (من الشيتات القديمة)، والشيتُ والمدخلاتُ يجمعان حساباتِه في خانة اليوم. فإذا كُتب
 * رقمٌ في حسابٍ مُحي ما في حساباته الأخرى ذلك اليوم، وإلّا جُمع القديمُ مع الجديد.
 * `projectId` يحصر المحوَ في مشروعٍ واحد (الشهورُ القديمة تُعرض بمشروع الأوردر).
 * `byName` يشمل حساباتٍ بلا ربطٍ باسمه (الشهورُ القديمة تنسبها إليه باسمه).
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
