/**
 * Archive: staff whose service ended and who left the system. See utils/hrEngagement.
 * Order is fixed: terminate service, then exit system, then archive. A freelancer has no exit step, so terminating archives immediately.
 * Archived people appear on no screen or count except the archive page and its HR dashboard card. Nothing is erased; the full file opens from the archive.
 */
const Employee = require('../models/Employee');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const ENG = require('../utils/hrEngagement');

const name = (e) => e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
const changed = () => {
  try { require('./hrController')._bustEmployeeCaches(); } catch (_) { /* */ }
  try { require('../utils/ttlCache').clear('hrm:'); } catch (_) { /* */ }
  try { require('../utils/ttlCache').clear('endedstaff:'); } catch (_) { /* */ }
  try { emitToAll('hr:employee', { at: Date.now() }); emitToAll('hr:master', { at: Date.now() }); } catch (_) { /* */ }
};

// POST /employees/:id/exit-system - requires service termination first.
exports.exitSystem = async (req, res) => {
  try {
    const e = await Employee.findById(req.params.id);
    if (!e) return res.status(404).json({ message: 'الموظف غير موجود' });
    if (e.employmentStatus !== 'terminated') {
      return res.status(400).json({ code: 'NOT_TERMINATED', message: 'لا خروجَ من النظام قبل إنهاء الخدمة — أنهِ خدمته أولًا' });
    }
    if (ENG.engagementOf(e) === 'freelance') {
      return res.status(400).json({ message: 'الفريلانسر لا يخرج من النظام — يُؤرشَف بإنهاء خدمته، وهو في الأرشيف' });
    }
    if (String(e.systemStatus || '').trim() === ENG.SYSTEM_OUT) {
      return res.status(400).json({ message: 'خارج النظام أصلًا — هو في الأرشيف' });
    }
    const before = e.systemStatus || '';
    e.systemStatus = ENG.SYSTEM_OUT;
    await e.save();
    changed();
    await logAudit({
      user: req.user, action: 'hr_exit_system', entity: 'Employee', entityId: e._id,
      changes: { details: `خروج من النظام ونقل إلى الأرشيف — ${name(e)}`, before: { systemStatus: before }, after: { systemStatus: e.systemStatus } },
      ipAddress: req.ip,
    });
    res.json({ ok: true, archived: true });
  } catch (err) {
    console.error('hr exitSystem:', err);
    res.status(500).json({ message: 'تعذّر الخروج من النظام' });
  }
};

// POST /employees/:id/return-system - undo a wrong exit (returns from the archive).
exports.returnSystem = async (req, res) => {
  try {
    const e = await Employee.findById(req.params.id);
    if (!e) return res.status(404).json({ message: 'الموظف غير موجود' });
    if (String(e.systemStatus || '').trim() !== ENG.SYSTEM_OUT) return res.status(400).json({ message: 'ليس خارج النظام' });
    e.systemStatus = ENG.SYSTEM_IN;
    await e.save();
    changed();
    await logAudit({
      user: req.user, action: 'hr_return_system', entity: 'Employee', entityId: e._id,
      changes: { details: `إعادة إلى النظام من الأرشيف — ${name(e)}` }, ipAddress: req.ip,
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: 'تعذّر الإرجاع' }); }
};

// Arabic folding and digit normalisation, so a name typed with another alef or an iqama typed with Arabic digits still matches.
const fold = (v) => String(v == null ? '' : v).toLowerCase()
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * GET /archive — every archived file with when and why the service ended.
 * The end date is the termination date, else the date it was recorded (audit), else the last contract end; `endSource` says which.
 * Filters run here on the archived set (a few hundred rows): q (name, emp. no., iqama/ID, phone), from/to on the end date, engagement, kind, department, jobTitle, nationality.
 */
exports.list = async (req, res) => {
  try {
    const rows = await Employee.find({ isHrRecord: { $ne: false }, ...ENG.ARCHIVED })
      .select('arabicName firstName lastName employeeNumber iqamaNumber nationalId idType nationality department project jobTitle registerNumber systemStatus terminatedAt terminationReason terminationKind hireDate phone updatedAt')
      .lean();
    const ids = rows.map((e) => e._id);
    const AuditLog = require('../models/AuditLog');
    const Contract = require('../models/Contract');
    const [audits, contracts] = await Promise.all([
      AuditLog.find({ entity: 'Employee', entityId: { $in: ids }, action: { $in: ['terminate_employee', 'hr_exit_system'] } })
        .select('entityId action createdAt userName changes').sort({ createdAt: 1 }).lean(),
      Contract.find({ employee: { $in: ids } }).select('employee endDate terminatedAt terminationReason').lean().catch(() => []),
    ]);
    const term = new Map(); const exit = new Map(); const lastContract = new Map(); const contractEnd = new Map();
    for (const a of audits) (a.action === 'terminate_employee' ? term : exit).set(String(a.entityId), a);
    for (const c of contracts) {
      const k = String(c.employee); const d = c.endDate ? new Date(c.endDate) : null;
      if (d && (!lastContract.has(k) || d > lastContract.get(k))) lastContract.set(k, d);
      // A contract ended by the termination carries its date and reason too.
      if (c.terminatedAt && (!contractEnd.has(k) || new Date(c.terminatedAt) > contractEnd.get(k).at)) contractEnd.set(k, { at: new Date(c.terminatedAt), reason: c.terminationReason || '' });
    }
    let items = rows.map((e) => {
      const k = String(e._id); const ta = term.get(k); const xa = exit.get(k);
      const auditDate = ta?.changes?.after?.date || ta?.createdAt || null;
      const ce = contractEnd.get(k);
      const endDate = e.terminatedAt || auditDate || ce?.at || lastContract.get(k) || null;
      return {
        ...e, name: name(e), engagement: ENG.engagementOf(e),
        endDate, endSource: e.terminatedAt ? 'termination' : auditDate ? 'audit' : lastContract.get(k) ? 'contract' : '',
        terminationReason: e.terminationReason || ta?.changes?.after?.reason || '',
        terminatedByName: ta?.userName || '',
        kindLabel: (ENG.TERMINATION_KINDS[e.terminationKind] || {}).ar || '',
        exitedAt: xa?.createdAt || null, exitedByName: xa?.userName || '',
      };
    });
    const q = fold(String(req.query.q || '').slice(0, 60));
    if (q) {
      const digits = q.replace(/\D/g, '');
      items = items.filter((e) => fold(`${e.name} ${e.firstName || ''} ${e.lastName || ''} ${e.jobTitle || ''} ${e.department || ''}`).includes(q)
        || (digits && [e.employeeNumber, e.iqamaNumber, e.nationalId, e.phone].some((x) => String(x || '').replace(/\D/g, '').includes(digits))));
    }
    const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
    const { from, to, engagement, kind, department, jobTitle, nationality } = req.query;
    if (from) items = items.filter((e) => day(e.endDate) && day(e.endDate) >= String(from));
    if (to) items = items.filter((e) => day(e.endDate) && day(e.endDate) <= String(to));
    if (engagement) items = items.filter((e) => e.engagement === engagement);
    if (kind) items = items.filter((e) => (kind === 'none' ? !e.terminationKind : e.terminationKind === kind));
    if (department) items = items.filter((e) => (e.department || '') === department);
    if (jobTitle) items = items.filter((e) => (e.jobTitle || '') === jobTitle);
    if (nationality) items = items.filter((e) => (e.nationality || '') === nationality);
    items.sort((a, b) => new Date(b.endDate || 0) - new Date(a.endDate || 0));
    const uniq = (f) => [...new Set(rows.map((e) => String(e[f] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({
      items,
      counts: {
        total: items.length,
        sponsored: items.filter((e) => e.engagement === 'sponsored').length,
        freelance: items.filter((e) => e.engagement === 'freelance').length,
      },
      options: { departments: uniq('department'), jobTitles: uniq('jobTitle'), nationalities: uniq('nationality'), kinds: Object.entries(ENG.TERMINATION_KINDS).map(([k, v]) => ({ key: k, ar: v.ar, en: v.en })) },
    });
  } catch (err) {
    console.error('hr archive list:', err);
    res.status(500).json({ message: 'تعذّر تحميل الأرشيف' });
  }
};
