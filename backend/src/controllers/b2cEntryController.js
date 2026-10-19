/**
 * مدخلات أوردرات المناديب — جدولٌ كالشيت: المندوب، ورقمُ إقامته، ومشروعُه،
 * وخانةُ اليوم. راجع utils/b2cEntry للقواعد (المندوبُ صفُّه في سجلّ النقل الخفيف،
 * ومديرُ المشروع يرى مشاريعَه، والهدفُ من المشروع).
 *
 *   GET  /api/b2c/entry?date=&from=&to=      الجدولُ والكروتُ وملخّصُ التحقيق
 *   PUT  /api/b2c/entry                      { lt, dateKey, orders }
 *   GET  /api/b2c/entry/managers             المشرفون ومديرو المشاريع ومشاريعُهم
 *   PUT  /api/b2c/entry/managers/:userId     { projects: [nameAr] }
 *   POST /api/light-transport/employees/:id/transfer-project   { projectAr, note }
 */
const mongoose = require('mongoose');
const E = require('../utils/b2cEntry');
const ENG = require('../utils/hrEngagement');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const S = (v) => String(v ?? '').trim();
const HR_STATUS_AR = { terminated: 'إنهاء خدمة', suspended: 'متوقف', active: 'يعمل', on_leave: 'إجازة' };
const statusOf = (r) => (r.employee && HR_STATUS_AR[r.employee.employmentStatus]) || r.workStatusAr || '';
/** كفالة · فري لانسر · يوزرات — مَن له ملفٌّ من ملفّه (رقم السجل التجاري). */
const kindOf = (r) => {
  if (/يوزر/.test(S(r.contractTypeAr))) return 'يوزرات';
  if (r.employee) { const e = ENG.engagementOf(r.employee); if (e === 'sponsored') return 'كفالة'; if (e === 'freelance') return 'فري لانسر'; }
  const v = E.fold(r.contractTypeAr);
  if (v.includes('فري') || v.includes('freelanc')) return 'فري لانسر';
  return v ? 'كفالة' : 'غير محدد';
};
const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const emit = (ev, p = {}) => { try { emitToAll(ev, p); } catch (_) { /* */ } };

/** صفوفُ المناديب في نطاق المستخدم — مع حساباتِ طلباتهم. */
async function repRows(scope) {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const P = await E.projects();
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const rows = await LightTransportEmployee.find({ $or: [{ staffKind: 'rep' }, { contractTypeAr: /يوزر/ }] })
    .populate('employee', 'employmentStatus registerNumber systemStatus')
    .select('idNumber name projectAr cityAr supervisorName supervisorUser contractTypeAr workStatusAr isActive employee hireDate phone')
    .lean();
  return rows.filter((r) => P.of(r.projectAr) && E.inScope(scope, r.projectAr) && !(r.employee && sets.archivedIds.has(String(r.employee._id))));
}

exports.list = async (req, res) => {
  try {
    const date = E.isoDate(req.query.date) || riyadhToday();
    const from = E.isoDate(req.query.from) || `${date.slice(0, 8)}01`;
    const to = E.isoDate(req.query.to) || date;
    const scope = await E.scopeOf(req.user);
    const P = await E.projects();
    const lts = await repRows(scope);
    const B2CRep = require('../models/B2CRep');
    const B2CDailyOrder = require('../models/B2CDailyOrder');
    const reps = await B2CRep.find({ ltEmployee: { $in: lts.map((r) => r._id) } }).select('_id ltEmployee').lean();
    const repsOf = new Map(); const ltOfRep = new Map();
    for (const r of reps) { const k = String(r.ltEmployee); (repsOf.get(k) || repsOf.set(k, []).get(k)).push(r._id); ltOfRep.set(String(r._id), k); }
    const repIds = reps.map((r) => r._id);
    const lo = from < date ? from : date; const hi = to > date ? to : date;
    const orders = await B2CDailyOrder.find({ rep: { $in: repIds }, dateKey: { $gte: lo, $lte: hi } }).select('rep dateKey orders').lean();
    const agg = new Map();
    for (const o of orders) {
      const k = ltOfRep.get(String(o.rep)); if (!k) continue;
      const a = agg.get(k) || agg.set(k, { total: 0, worked: 0, day: null, days: new Set() }).get(k);
      if (o.dateKey === date && o.orders != null) a.day = (a.day || 0) + o.orders;
      if (o.dateKey >= from && o.dateKey <= to && o.orders != null) { a.total += o.orders; if (o.orders > 0) a.days.add(o.dateKey); }
    }
    const elapsed = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1);
    const out = [];
    for (const r of lts) {
      const a = agg.get(String(r._id)) || { total: 0, days: new Set(), day: null };
      const status = statusOf(r);
      const ended = status === E.ENDED || r.isActive === false;
      if (ended && !a.total && a.day == null) continue; // منتهٍ بلا طلباتٍ في الفترة — لا صفَّ له
      const proj = P.of(r.projectAr);
      const workedDays = a.days.size;
      const ev = E.evaluate({ total: a.total, workedDays, project: proj });
      out.push({
        lt: r._id, idNumber: /^NOID-/.test(S(r.idNumber)) ? '' : S(r.idNumber), name: S(r.name),
        projectAr: S(r.projectAr), cityAr: S(r.cityAr), supervisorName: S(r.supervisorName), kind: kindOf(r),
        status, ended, orders: a.day, total: a.total, workedDays, ...ev,
        expected: workedDays ? Math.round((a.total / elapsed) * E.MONTH_DAYS) : 0,
        unit: proj?.monthlyTarget ? 'طلب' : 'شحنة',
      });
    }
    out.sort((x, y) => (x.projectAr.localeCompare(y.projectAr, 'ar')) || (y.total - x.total));

    // ── الكروت — كالشيت ────────────────────────────────────────────────────
    const working = out.filter((r) => !r.ended);
    const count = (rows, f) => rows.filter(f).length;
    const kinds = ['كفالة', 'فري لانسر', 'يوزرات'];
    const projectNames = [...new Set(P.rows.map((p) => S(p.nameAr || p.name)))].filter((n) => out.some((r) => E.fold(r.projectAr) === E.fold(n)) || scope === null);
    const cards = {
      reps: { total: working.length, ...Object.fromEntries(kinds.map((k) => [k, count(working, (r) => r.kind === k)])), other: count(working, (r) => !kinds.includes(r.kind)) },
      byProject: projectNames.map((n) => ({
        project: n, total: count(working, (r) => E.fold(r.projectAr) === E.fold(n)),
        ...Object.fromEntries(kinds.map((k) => [k, count(working, (r) => E.fold(r.projectAr) === E.fold(n) && r.kind === k)])),
      })),
      dayTotal: out.reduce((s, r) => s + (r.orders || 0), 0),
      dayEntered: count(out, (r) => r.orders != null),
      periodTotal: out.reduce((s, r) => s + r.total, 0),
      onLeave: count(out, (r) => r.status === 'إجازة'),
    };
    // ملخّصُ التحقيق حسب المشرف والمشروع.
    const sum = new Map();
    for (const r of working) {
      const k = `${r.supervisorName || '—'}|${r.projectAr}`;
      const s = sum.get(k) || sum.set(k, { supervisor: r.supervisorName || '—', project: r.projectAr, reps: 0, achieved: 0, near: 0, far: 0, noOrders: 0, shipments: 0, total: 0 }).get(k);
      s.reps += 1; s.total += r.total;
      if (r.evaluation === 'حقق') s.achieved += 1; else if (r.evaluation === 'قريب') s.near += 1; else if (r.evaluation === 'بعيد') s.far += 1;
      else if (r.evaluation === 'شحنات') s.shipments += r.total; else s.noOrders += 1;
    }
    const summary = [...sum.values()].map((s) => ({ ...s, rate: (s.achieved + s.near + s.far) ? s.achieved / (s.achieved + s.near + s.far) : null }))
      .sort((a, b) => a.supervisor.localeCompare(b.supervisor, 'ar') || a.project.localeCompare(b.project, 'ar'));
    const tot = summary.reduce((t, s) => ({ reps: t.reps + s.reps, achieved: t.achieved + s.achieved, near: t.near + s.near, far: t.far + s.far, shipments: t.shipments + s.shipments, total: t.total + s.total }), { reps: 0, achieved: 0, near: 0, far: 0, shipments: 0, total: 0 });
    tot.rate = (tot.achieved + tot.near + tot.far) ? tot.achieved / (tot.achieved + tot.near + tot.far) : null;

    res.json({
      date, from, to, today: riyadhToday(), rows: out, cards, summary, summaryTotal: tot,
      projects: P.rows.map((p) => ({ nameAr: S(p.nameAr || p.name), monthlyTarget: p.monthlyTarget || 0, dailyTarget: p.monthlyTarget ? Math.round(p.monthlyTarget / E.MONTH_DAYS) : 0 })),
      scope, canTransfer: E.canTransfer(req.user), canManageProjects: E.canTransfer(req.user),
    });
  } catch (e) {
    console.error('b2cEntry.list', e);
    res.status(500).json({ message: 'تعذّر تحميل مدخلات الأوردرات' });
  }
};

exports.save = async (req, res) => {
  try {
    const dateKey = E.isoDate(req.body.dateKey);
    if (!dateKey) return res.status(400).json({ message: 'التاريخ غير صحيح' });
    if (dateKey > riyadhToday()) return res.status(400).json({ message: 'لا يُدخَل يومٌ لم يأتِ بعد' });
    const raw = req.body.orders;
    const orders = raw === '' || raw === null || raw === undefined ? null : Number(raw);
    if (orders !== null && (!Number.isFinite(orders) || orders < 0 || orders > 2000 || !Number.isInteger(orders))) return res.status(400).json({ message: 'اكتب رقمًا صحيحًا (٠ أو أكثر)' });
    if (!mongoose.isValidObjectId(req.body.lt)) return res.status(400).json({ message: 'المندوب غير معروف' });
    const { LightTransportEmployee } = require('../models/LightTransport');
    const lt = await LightTransportEmployee.findById(req.body.lt).populate('employee', 'employmentStatus');
    if (!lt) return res.status(404).json({ message: 'المندوب غير موجود' });
    const scope = await E.scopeOf(req.user);
    if (!E.inScope(scope, lt.projectAr)) return res.status(403).json({ message: `مشروع «${lt.projectAr}» ليس من مشاريعك` });
    if (!(await E.projects()).of(lt.projectAr)) return res.status(400).json({ message: 'مشروع المندوب ليس من مشاريع الأوردرات' });
    const rep = await E.ensureRep(lt, req.user);
    const B2CDailyOrder = require('../models/B2CDailyOrder');
    const [y, m, d] = dateKey.split('-').map(Number);
    const before = await B2CDailyOrder.findOne({ rep: rep._id, dateKey }).lean();
    const entry = await B2CDailyOrder.findOneAndUpdate(
      { rep: rep._id, dateKey },
      {
        $set: { orders, worked: orders !== null && orders > 0, source: 'manual', enteredBy: req.user._id, project: rep.project, branch: rep.branch },
        $setOnInsert: { date: new Date(`${dateKey}T00:00:00.000Z`), year: y, month: m, day: d },
      },
      { upsert: true, new: true },
    );
    await logAudit({ user: req.user._id, action: 'b2c_order_entry', entity: 'LightTransportEmployee', entityId: lt._id,
      changes: { details: `أوردرات ${lt.name} يوم ${dateKey}: ${before?.orders ?? '—'} ← ${orders ?? '—'}`, before: { orders: before?.orders ?? null }, after: { orders, dateKey } }, ipAddress: req.ip }).catch(() => {});
    cache.clear('b2c:');
    emit('b2c:order:upserted', { order: entry, lt: String(lt._id) });
    res.json({ ok: true, orders: entry.orders, dateKey });
  } catch (e) {
    console.error('b2cEntry.save', e);
    res.status(500).json({ message: 'تعذّر حفظ الأوردرات' });
  }
};

/** المشرفون ومديرو المشاريع — ومشاريعُ كلٍّ منهم. */
exports.managers = async (req, res) => {
  try {
    const { listSupervisors } = require('../utils/b2cSupervisors');
    const list = await listSupervisors();
    const User = require('../models/User');
    const P = await E.projects();
    const users = await User.find({ _id: { $in: list.map((s) => s._id || s.id) } }).select('assignedProjects role').lean();
    const of = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      managers: list.map((s) => {
        const u = of.get(String(s._id || s.id)) || {};
        return { _id: s._id || s.id, name: s.name || s.label, role: u.role || s.role, projects: (u.assignedProjects || []).map((id) => P.byId.get(String(id))).filter(Boolean).map((p) => S(p.nameAr || p.name)) };
      }),
      projects: P.rows.map((p) => S(p.nameAr || p.name)),
      canEdit: E.canTransfer(req.user),
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل المشرفين' }); }
};

exports.setManagerProjects = async (req, res) => {
  try {
    if (!E.canTransfer(req.user)) return res.status(403).json({ message: 'إسنادُ المشاريع لنائب مدير القطاع ومدير القسم والإدارة' });
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ message: 'الحساب غير معروف' });
    const P = await E.projects();
    const names = Array.isArray(req.body.projects) ? req.body.projects : [];
    const ids = [];
    for (const n of names) { const p = P.of(n); if (!p) return res.status(400).json({ message: `«${n}» ليس من مشاريع الأوردرات` }); ids.push(p._id); }
    const User = require('../models/User');
    const u = await User.findById(req.params.userId);
    if (!u) return res.status(404).json({ message: 'الحساب غير موجود' });
    const before = (u.assignedProjects || []).map(String);
    u.assignedProjects = ids;
    await u.save();
    await logAudit({ user: req.user._id, action: 'b2c_manager_projects', entity: 'User', entityId: u._id,
      changes: { details: `مشاريع المشرف: ${names.join('، ') || '—'}`, before: { assignedProjects: before }, after: { assignedProjects: ids.map(String) } }, ipAddress: req.ip }).catch(() => {});
    cache.clear('b2c:');
    emit('b2c:entry:scope', { user: String(u._id) });
    emit('lt:updated', {});
    res.json({ ok: true, projects: names });
  } catch (e) { res.status(500).json({ message: 'تعذّر حفظ مشاريع المشرف' }); }
};

/**
 * نقلُ مشروع — من سجلّ المندوب، وممّن يملكه وحدَه. ومن يومه تُكتب طلباتُه على
 * مشروعه الجديد (حسابُ طلباته يتبعه — utils/b2cEntry.syncRepOf عبر hook السجلّ).
 */
exports.transferProject = async (req, res) => {
  try {
    if (!E.canTransfer(req.user)) return res.status(403).json({ message: 'نقلُ المشروع لنائب مدير قطاع الأفراد ومدير القسم والسوبر أدمن والأدمن' });
    const { LightTransportEmployee } = require('../models/LightTransport');
    const lt = await LightTransportEmployee.findById(req.params.id);
    if (!lt) return res.status(404).json({ message: 'المندوب غير موجود' });
    const to = S(req.body.projectAr);
    const names = await require('../utils/hrLists').namesOf('lt_project');
    if (!names.includes(to)) return res.status(400).json({ message: `اختر المشروع من القائمة: ${names.join('، ')}` });
    const from = S(lt.projectAr);
    if (from === to) return res.status(400).json({ message: 'المندوب على هذا المشروع بالفعل' });
    lt.projectAr = to;
    const who = await require('../models/User').findById(req.user._id).select('name firstName lastName').lean();
    lt.history.push({ at: new Date(), by: req.user._id, byName: S(who?.name) || `${S(who?.firstName)} ${S(who?.lastName)}`.trim(), kind: 'project', fromValue: from, toValue: to, note: S(req.body.note) || 'نقل مشروع' });
    lt.lastModifiedBy = req.user._id;
    await lt.save();
    await E.syncRepOf(lt);
    await logAudit({ user: req.user._id, action: 'b2c_transfer_project', entity: 'LightTransportEmployee', entityId: lt._id,
      changes: { details: `نقل مشروع ${lt.name}: «${from || '—'}» ← «${to}»${S(req.body.note) ? ` — ${S(req.body.note)}` : ''}`, before: { projectAr: from }, after: { projectAr: to } }, ipAddress: req.ip }).catch(() => {});
    cache.clear('b2c:'); cache.clear('lt:');
    emit('lt:updated', { id: String(lt._id) });
    emit('b2c:rep:updated', { lt: String(lt._id) });
    res.json({ ok: true, projectAr: to });
  } catch (e) {
    console.error('transferProject', e);
    res.status(500).json({ message: 'تعذّر نقل المشروع' });
  }
};
