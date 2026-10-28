/**
 * Staff requests from sections to HR.
 *
 * A section reports what it sees; HR receives it, then completes or rejects it
 * (a rejection needs a written reason). Decisions can be per employee.
 * See models/StaffStatusRequest.
 */
const mongoose = require('mongoose');
const { sendMongooseError, describeMongooseError } = require('../utils/mongooseError');
const StaffStatusRequest = require('../models/StaffStatusRequest');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

const S = (v) => (v == null ? '' : String(v).trim());
const emit = () => { try { emitToAll('staff-requests:changed', {}); } catch (e) { /* best effort */ } };

const HR_ROLES = ['hr_manager', 'hr_specialist'];
const isHr = (u) => HR_ROLES.includes(u?.role)
  || ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(u?.role)
  || ['view', 'edit'].includes(u?.permissions?.HR);

/** Next human-readable request number. */
const nextNumber = async () => {
  const last = await StaffStatusRequest.findOne({}).sort({ number: -1 }).select('number').lean();
  return (last?.number || 1000) + 1;
};

// POST /api/staff-requests
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const title = S(b.title);
    const body = S(b.body);
    if (!title && !body) return res.status(400).json({ message: 'اكتب الطلب' });

    // Named employees are optional: a free-text request is valid on its own.
    const ids = (Array.isArray(b.employees) ? b.employees : [])
      .map((e) => (typeof e === 'string' ? { employee: e } : e))
      .filter((e) => e && mongoose.isValidObjectId(S(e.employee)));
    const emps = ids.length
      ? await Employee.find({ _id: { $in: ids.map((e) => S(e.employee)) } })
        .select('arabicName firstName lastName employeeNumber').lean()
      : [];
    const byId = new Map(emps.map((e) => [String(e._id), e]));
    const subjects = ids.map((e) => {
      const emp = byId.get(S(e.employee));
      return {
        employee: emp?._id || null,
        name: emp ? (emp.arabicName || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim()) : S(e.name),
        employeeNumber: emp?.employeeNumber || '',
        note: S(e.note),
      };
    }).filter((s) => s.employee || s.name);

    const doc = await StaffStatusRequest.create({
      number: await nextNumber(),
      section: S(b.section) || 'B2C',
      kind: S(b.kind) || 'back_to_work',
      title, body, subjects,
      createdBy: req.user?._id,
      createdByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim(),
    });

    // Notify HR by role (not a fixed list of users).
    try {
      const hr = await User.find({ role: { $in: HR_ROLES }, isActive: { $ne: false } }).select('_id').lean();
      await Promise.all(hr.map((u) => createNotification({
        recipient: u._id,
        type: 'hr_request',
        title: `طلب جديد من ${doc.section}`,
        message: `${doc.title || 'طلب'} — ${doc.subjects.length ? `${doc.subjects.length} موظفًا` : 'بلا أسماء'}`,
        relatedEntity: 'StaffStatusRequest',
        relatedEntityId: doc._id,
      }).catch(() => {})));
    } catch (e) { /* notifications are best effort */ }

    await logAudit({
      user: req.user?._id, action: 'create', entity: 'StaffStatusRequest', entityId: doc._id,
      changes: { after: { section: doc.section, kind: doc.kind, subjects: doc.subjects.length } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.status(201).json({ request: doc });
  } catch (e) {
    console.error('staffRequest create', e);
    sendMongooseError(res, e, 'تعذّر إرسال الطلب');
  }
};

/**
 * GET /api/staff-requests?status=&section=&mine=1
 *
 * HR sees everything; others see their section's requests and their own.
 */
exports.list = async (req, res) => {
  try {
    const f = {};
    if (req.query.status) f.status = { $in: S(req.query.status).split(',').filter(Boolean) };
    if (req.query.kind) f.kind = S(req.query.kind);
    if (!isHr(req.user)) {
      if (req.query.section) f.section = S(req.query.section);
      else f.$or = [{ createdBy: req.user?._id }, { section: S(req.query.scope) || 'B2C' }];
    } else if (req.query.section) f.section = S(req.query.section);
    if (req.query.mine === '1') f.createdBy = req.user?._id;

    const requests = await StaffStatusRequest.find(f).sort({ createdAt: -1 }).limit(500).lean();
    // Counts use the same visibility filter, without the status filter,
    // so the tab badges stay stable across tabs.
    const { status: _ownFacet, ...countF } = f;
    const counts = await StaffStatusRequest.aggregate([
      { $match: countF },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    res.json({
      requests,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      isHr: isHr(req.user),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التحميل' });
  }
};

/**
 * PATCH /api/staff-requests/:id — HR decision.
 * { status: 'received'|'done'|'rejected', decisionNote }
 */
exports.decide = async (req, res) => {
  try {
    if (!isHr(req.user)) return res.status(403).json({ message: 'الجوابُ للموارد البشريّة' });
    const doc = await StaffStatusRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    const status = S(req.body?.status);
    if (!['received', 'done', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'حالةٌ غير معروفة' });
    }
    const note = S(req.body?.decisionNote);
    // A rejection must carry a reason.
    if (status === 'rejected' && !note) {
      return res.status(400).json({ message: 'الرفضُ يحتاج سببًا مكتوبًا' });
    }
    const before = doc.status;
    doc.status = status;
    if (note) doc.decisionNote = note;
    const who = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim();
    if (status === 'received' && !doc.receivedAt) {
      doc.receivedBy = req.user?._id; doc.receivedByName = who; doc.receivedAt = new Date();
    }
    if (status === 'done' || status === 'rejected') {
      doc.decidedBy = req.user?._id; doc.decidedByName = who; doc.decidedAt = new Date();
      // Undecided employees inherit the request's decision.
      doc.subjects.forEach((s) => {
        if (s.decision === 'pending') {
          s.decision = status === 'done' ? 'done' : 'rejected';
          s.decisionNote = s.decisionNote || note;
          s.decidedAt = new Date();
        }
      });
    }
    await doc.save();

    try {
      if (doc.createdBy) {
        await createNotification({
          recipient: doc.createdBy,
          type: 'hr_request',
          title: status === 'rejected' ? 'رُفض طلبُك للموارد البشرية' : status === 'done' ? 'نُفّذ طلبُك' : 'استلمت الموارد البشرية طلبَك',
          message: `${doc.title || 'طلب'}${note ? ` — ${note}` : ''}`,
          relatedEntity: 'StaffStatusRequest',
          relatedEntityId: doc._id,
        });
      }
    } catch (e) { /* notifications are best effort */ }

    await logAudit({
      user: req.user?._id, action: 'update', entity: 'StaffStatusRequest', entityId: doc._id,
      changes: { before: { status: before }, after: { status, decisionNote: note } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.json({ request: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

/**
 * PATCH /api/staff-requests/:id/subjects/:sid — decision for one employee.
 */
exports.decideSubject = async (req, res) => {
  try {
    if (!isHr(req.user)) return res.status(403).json({ message: 'الجوابُ للموارد البشريّة' });
    const doc = await StaffStatusRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    const s = doc.subjects.id(req.params.sid);
    if (!s) return res.status(404).json({ message: 'الاسمُ غير موجود في الطلب' });
    const decision = S(req.body?.decision);
    if (!['pending', 'done', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'قرارٌ غير معروف' });
    }
    const note = S(req.body?.decisionNote);
    if (decision === 'rejected' && !note) {
      return res.status(400).json({ message: 'الرفضُ يحتاج سببًا مكتوبًا' });
    }
    s.decision = decision;
    s.decisionNote = note;
    s.decidedAt = decision === 'pending' ? null : new Date();

    // Request status is derived from its employees: any pending → received;
    // all decided → done, or rejected if every one was rejected.
    if (doc.subjects.length) {
      const pending = doc.subjects.filter((x) => x.decision === 'pending').length;
      const rejected = doc.subjects.filter((x) => x.decision === 'rejected').length;
      if (pending) doc.status = doc.status === 'new' ? 'received' : doc.status;
      else {
        doc.status = rejected === doc.subjects.length ? 'rejected' : 'done';
        doc.decidedBy = req.user?._id;
        doc.decidedByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim();
        doc.decidedAt = new Date();
      }
    }
    if (!doc.receivedAt) {
      doc.receivedBy = req.user?._id;
      doc.receivedByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim();
      doc.receivedAt = new Date();
    }
    await doc.save();
    emit();
    res.json({ request: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

exports._isHr = isHr;
