/**
 * متابعةُ مناديب أمازون — الحضور.
 *
 *   GET /api/b2c/attendance?date=YYYY-MM-DD    مناديبُ أمازون وحضورُ اليوم وغيابُ الشهر
 *   PUT /api/b2c/attendance                    { lt, dateKey, present }
 *
 * تُفتح لمدير القسم ونائبه والإدارة (isEntryHead)، ولمن أُسند إليه مشروعُ أمازون
 * («مشاريع المشرفين») — ولا تُفتح لمديري المشاريع الأخرى.
 *
 * والحضورُ هو الأصل: يُكتب الغيابُ وحدَه (راجع models/B2CAttendance).
 */
const mongoose = require('mongoose');
const E = require('../utils/b2cEntry');
const B2CAttendance = require('../models/B2CAttendance');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');

const S = (v) => String(v ?? '').trim();
const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

/** مشاريعُ الحضور: ما لا هدفَ أوردراتٍ له (أمازون). */
async function attendanceProjects() {
  const P = await E.projects();
  return P.rows.filter((p) => !p.monthlyTarget).map((p) => S(p.nameAr || p.name));
}
const isAttendanceProject = async (projectAr) => (await attendanceProjects()).some((n) => E.fold(n) === E.fold(projectAr));

/** مشاريعُ الحضور التي يملكها المستخدم — [] = لا شيء. */
async function allowedFor(user) {
  const all = await attendanceProjects();
  const scope = await E.scopeOf(user);
  return scope === null ? all : all.filter((n) => E.inScope(scope, n));
}

/** غيابُ مجموعةِ مناديب في يومٍ واحد: Map(lt → true). */
async function absentOn(ltIds, dateKey) {
  const rows = await B2CAttendance.find({ lt: { $in: ltIds }, dateKey, present: false }).select('lt').lean();
  return new Set(rows.map((r) => String(r.lt)));
}

exports.list = async (req, res) => {
  try {
    const projects = await allowedFor(req.user);
    if (!projects.length) return res.status(403).json({ message: 'متابعةُ أمازون لمدير مشروعها ومدير القسم' });
    const date = E.isoDate(req.query.date) || riyadhToday();
    const { LightTransportEmployee } = require('../models/LightTransport');
    const { endedStaff } = require('../utils/endedStaff');
    const sets = await endedStaff();
    const lts = (await LightTransportEmployee.find({ $or: [{ staffKind: 'rep' }, { contractTypeAr: /يوزر/ }] })
      .populate('employee', 'employmentStatus')
      .select('idNumber name projectAr supervisorName workStatusAr opStatus isActive employee').lean())
      .filter((r) => projects.some((n) => E.fold(n) === E.fold(r.projectAr)))
      .filter((r) => !(r.employee && sets.archivedIds.has(String(r.employee._id))))
      .map((r) => ({ ...r, status: require('../utils/b2cBoard').shownStatus(r) }))
      .filter((r) => r.status !== 'إنهاء خدمة' && r.isActive !== false);
    const ids = lts.map((r) => r._id);
    const absent = await absentOn(ids, date);
    const month = date.slice(0, 7);
    const monthAbs = await B2CAttendance.aggregate([
      { $match: { lt: { $in: ids }, present: false, dateKey: { $gte: `${month}-01`, $lte: `${month}-31` } } },
      { $group: { _id: '$lt', n: { $sum: 1 } } },
    ]);
    const absMonth = new Map(monthAbs.map((r) => [String(r._id), r.n]));
    const rows = lts.map((r) => ({
      lt: r._id, idNumber: /^NOID-/.test(S(r.idNumber)) ? '' : S(r.idNumber), name: S(r.name), projectAr: S(r.projectAr),
      supervisorName: S(r.supervisorName), status: r.status,
      // في إجازةٍ = غائبٌ بعذرٍ معروف؛ ويبقى قابلًا للتعديل.
      present: !absent.has(String(r._id)) && r.status !== 'إجازة',
      onLeave: r.status === 'إجازة',
      monthAbsences: absMonth.get(String(r._id)) || 0,
    })).sort((a, b) => a.supervisorName.localeCompare(b.supervisorName, 'ar') || a.name.localeCompare(b.name, 'ar'));
    res.json({
      date, today: riyadhToday(), projects, rows,
      summary: { total: rows.length, present: rows.filter((r) => r.present).length, absent: rows.filter((r) => !r.present).length },
    });
  } catch (e) {
    console.error('b2cAttendance.list', e);
    res.status(500).json({ message: 'تعذّر تحميل الحضور' });
  }
};

exports.save = async (req, res) => {
  try {
    const dateKey = E.isoDate(req.body.dateKey);
    if (!dateKey) return res.status(400).json({ message: 'التاريخ غير صحيح' });
    if (dateKey > riyadhToday()) return res.status(400).json({ message: 'لا يُسجَّل حضورُ يومٍ لم يأتِ بعد' });
    if (!mongoose.isValidObjectId(req.body.lt)) return res.status(400).json({ message: 'المندوب غير معروف' });
    const { LightTransportEmployee } = require('../models/LightTransport');
    const lt = await LightTransportEmployee.findById(req.body.lt).select('name projectAr').lean();
    if (!lt) return res.status(404).json({ message: 'المندوب غير موجود' });
    const projects = await allowedFor(req.user);
    if (!projects.some((n) => E.fold(n) === E.fold(lt.projectAr))) return res.status(403).json({ message: 'ليس من مشاريعك' });
    const present = req.body.present !== false;
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ');
    if (present) await B2CAttendance.deleteOne({ lt: lt._id, dateKey });
    else {
      await B2CAttendance.updateOne({ lt: lt._id, dateKey },
        { $set: { present: false, projectAr: lt.projectAr, by: req.user._id, byName: who } }, { upsert: true });
    }
    await logAudit({ user: req.user._id, action: 'b2c_attendance', entity: 'LightTransportEmployee', entityId: lt._id,
      changes: { details: `حضور ${lt.name} يوم ${dateKey}: ${present ? 'حضر' : 'لم يحضر'}`, after: { dateKey, present } }, ipAddress: req.ip }).catch(() => {});
    cache.clear('b2c:');
    try { require('../websocket/socketManager').emitToAll('b2c:attendance', { lt: String(lt._id), dateKey, present }); } catch (_) { /* */ }
    res.json({ ok: true, present, dateKey });
  } catch (e) {
    console.error('b2cAttendance.save', e);
    res.status(500).json({ message: 'تعذّر حفظ الحضور' });
  }
};

module.exports.attendanceProjects = attendanceProjects;
module.exports.isAttendanceProject = isAttendanceProject;
module.exports.absentOn = absentOn;
module.exports.allowedFor = allowedFor;
