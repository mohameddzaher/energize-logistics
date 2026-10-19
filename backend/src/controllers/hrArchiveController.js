/**
 * الأرشيف — مَن انتهت خدمتُه وخرج من النظام. راجع utils/hrEngagement.
 *
 * ── الترتيبُ لا يُقفَز (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────────────────────
 *   إنهاءُ الخدمة أوّلًا (من ملفّ الموظّف) ← ثمّ «خروج من النظام» ← الأرشيف.
 * والفريلانسرُ لا خروجَ له: ليس على نظامنا أصلًا، فإنهاءُ خدمته يؤرشفه فورًا.
 *
 * المؤرشَفُ لا يظهر في شاشةٍ ولا رقمٍ — إلّا صفحةَ الأرشيف وكارتَها في لوحة
 * الموارد البشريّة. والأرشفةُ لا تمحو شيئًا: ملفُّه كاملٌ يُفتَح من الأرشيف.
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

// POST /employees/:id/exit-system — يُشترط إنهاءُ الخدمة قبله.
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

// POST /employees/:id/return-system — تراجعٌ عن خروجٍ خاطئ (يعود من الأرشيف).
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

// GET /archive?q= — صفحةُ الأرشيف.
exports.list = async (req, res) => {
  try {
    const f = { isHrRecord: { $ne: false }, ...ENG.ARCHIVED };
    const s = String(req.query.q || '').trim().slice(0, 60);
    if (s) {
      const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$and = [{ $or: [{ arabicName: rx }, { firstName: rx }, { lastName: rx }, { employeeNumber: rx }, { iqamaNumber: rx }, { nationalId: rx }] }];
    }
    const rows = await Employee.find(f)
      .select('arabicName firstName lastName employeeNumber iqamaNumber nationalId idType nationality department project jobTitle registerNumber systemStatus terminatedAt terminationReason hireDate updatedAt')
      .sort({ terminatedAt: -1, updatedAt: -1 }).lean();
    const items = rows.map((e) => ({ ...e, name: name(e), engagement: ENG.engagementOf(e) }));
    res.json({
      items,
      counts: {
        total: items.length,
        sponsored: items.filter((e) => e.engagement === 'sponsored').length,
        freelance: items.filter((e) => e.engagement === 'freelance').length,
      },
    });
  } catch (err) {
    console.error('hr archive list:', err);
    res.status(500).json({ message: 'تعذّر تحميل الأرشيف' });
  }
};
