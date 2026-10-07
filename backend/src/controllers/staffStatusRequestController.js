/**
 * طلباتُ الأقسام إلى الموارد البشريّة — إرسالٌ وجوابٌ ملزَم.
 *
 * القسمُ يرى الميدانَ فيقول ما رآه؛ والموارد البشريّة تستلم ثمّ تنفّذ أو ترفض
 * **بسببٍ مكتوب**. وقد يكون الجوابُ جزئيًّا، فلكلّ اسمٍ قرارُه. راجع
 * models/StaffStatusRequest.
 */
const mongoose = require('mongoose');
const StaffStatusRequest = require('../models/StaffStatusRequest');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

const S = (v) => (v == null ? '' : String(v).trim());
const emit = () => { try { emitToAll('staff-requests:changed', {}); } catch (e) { /* الحدثُ زيادة */ } };

const HR_ROLES = ['hr_manager', 'hr_specialist'];
const isHr = (u) => HR_ROLES.includes(u?.role)
  || ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(u?.role)
  || ['view', 'edit'].includes(u?.permissions?.HR);

/** رقمٌ متسلسلٌ يُقال في المحادثة: «الطلب ٣٤». */
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

    // ── والأسماءُ اختياريّة ───────────────────────────────────────────────
    // «المناديب الذين في سكن جدة عادوا» طلبٌ مفهوم، وإجبارُ المرسِل على
    // تسمية كلِّ واحدٍ يجعله لا يرسل. فمن سمّى يُفتَح له الاسمُ في الطرف
    // الآخر، ومن لم يسمِّ يُقرأ نصُّه.
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

    // ويُبلَّغ من يعمل عليه: الموارد البشريّة بالدور، لا بقائمة أسماءٍ تشيخ.
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
    } catch (e) { /* التبليغُ زيادةٌ لا شرط */ }

    await logAudit({
      user: req.user?._id, action: 'create', entity: 'StaffStatusRequest', entityId: doc._id,
      changes: { after: { section: doc.section, kind: doc.kind, subjects: doc.subjects.length } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.status(201).json({ request: doc });
  } catch (e) {
    console.error('staffRequest create', e);
    res.status(500).json({ message: 'تعذّر إرسال الطلب' });
  }
};

/**
 * GET /api/staff-requests?status=&section=&mine=1
 *
 * الموارد البشريّة ترى الكلَّ، والقسمُ يرى طلباتَ قسمِه. ومن ليس من هذين لا
 * يرى إلّا ما أرسله هو — الطلبُ قد يحمل أسماءَ أشخاصٍ وحالاتِهم.
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
    const counts = await StaffStatusRequest.aggregate([
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
 * PATCH /api/staff-requests/:id — جوابُ الموارد البشريّة.
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
    // ── والرفضُ لا يصحّ بلا سبب ───────────────────────────────────────────
    // رفضٌ صامتٌ يُعاد إرسالُه غدًا كما هو، فيدور الطلبُ بين قسمين بلا نهاية.
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
      // وما لم يُقرَّر في اسمٍ بعينه يتبع قرارَ الطلب — فلا يبقى اسمٌ معلَّقًا
      // في طلبٍ أُغلِق، ويُقرأ الطلبُ وحالتُه واحدة.
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
    } catch (e) { /* التبليغُ زيادة */ }

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
 * PATCH /api/staff-requests/:id/subjects/:sid — قرارٌ في اسمٍ واحد.
 * عشرةُ مناديبَ في طلبٍ واحد: سبعةٌ عادوا وثلاثةٌ عندهم مشكلة.
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

    // وحالةُ الطلب تُشتقّ من أسمائه: ما دام فيه اسمٌ معلَّقٌ فالطلبُ مستلَمٌ لا
    // منتهٍ؛ وإن قُرِّر الكلُّ فهو منتهٍ — مرفوضٌ إن رُفض كلُّه.
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
