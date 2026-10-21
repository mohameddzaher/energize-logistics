/**
 * متابعاتُ كشف التشغيل — سجلٌّ واحدٌ يُقرأ ويُكتب من ثلاث شاشات.
 *
 *   التشغيل   GET|POST /api/workflows/:id/follow-ups            DELETE …/:fuId
 *   التخليص   GET|POST /api/customs-clearance/:id/ops-reports/:reportId/follow-ups   DELETE …/:fuId
 *   التحصيل   GET|POST /api/collections-dept/reports/:reportId/follow-ups            DELETE …/:fuId
 *
 * ── ولماذا ثلاثةُ أبوابٍ لسجلٍّ واحد ────────────────────────────────────────
 * كلُّ قسمٍ يصل إلى الكشف من بابه وبحارس قسمه (`sectionGate`): موظّفُ التخليص
 * لا يُفتح له سيرُ عمل التشغيل، وموظّفُ التحصيل يقرأ الكشفَ من فاتورته. فبابٌ
 * واحدٌ تحت `/api/workflows` كان يردّ ٤٠٣ على قسم التخليص كلِّه. والقاعدةُ
 * واحدة: **مَن يرى الكشفَ من بابه يكتب عليه متابعة** — وبابُ التخليص يرى ما
 * رُبط بمعاملته وحدَه، فلا يُقرأ منه كشفٌ لا شأنَ للمعاملة به.
 *
 * والحذفُ لصاحب السطر، أو لمدير النظام والإدارة: سطرٌ كتبه زميلٌ شاهدٌ على ما
 * جرى، فلا يمحوه غيرُه.
 *
 * والخبرُ `workflow:followUps` يُبثّ بعد كلّ كتابة — لا ذاكرةَ تحمل السجلَّ أو
 * عددَه فتُمسح قبله؛ ومن أضاف عددَه إلى قراءةٍ محفوظةٍ فليمسحها في `announce`
 * قبل البثّ (راجع announce-before-invalidate).
 */
const mongoose = require('mongoose');
const WorkflowFollowUp = require('../models/WorkflowFollowUp');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { canonicalRole } = require('../config/roles');
const logAudit = require('../utils/auditLogger');

const DELETE_ANY_ROLES = ['super_admin', 'admin'];
const MAX_TEXT = 2000;
const MAX_FILE = 10 * 1024 * 1024;

const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '';
const canDeleteAny = (req) => DELETE_ANY_ROLES.includes(canonicalRole(req.user?.role));
const mayDelete = (req, f) => canDeleteAny(req) || String(f.by || '') === String(req.user?._id || '');

const shape = (req, f) => ({
  _id: String(f._id),
  text: f.text,
  attachment: f.attachment && f.attachment.fileUrl ? f.attachment : null,
  byName: f.byName || '',
  byRole: f.byRole || '',
  source: f.source || 'operations',
  at: f.at,
  canDelete: mayDelete(req, f),
});

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

/** عددُ متابعات كلّ كشف — تجميعٌ واحد. يُرجع Map: معرّفُ الكشف → العدد. */
async function countsFor(ids) {
  const list = [...new Set((ids || []).map(String))].filter((x) => mongoose.isValidObjectId(x));
  if (!list.length) return new Map();
  const agg = await WorkflowFollowUp.aggregate([
    { $match: { workflow: { $in: list.map((x) => new mongoose.Types.ObjectId(x)) } } },
    { $group: { _id: '$workflow', n: { $sum: 1 } } },
  ]);
  return new Map(agg.map((x) => [String(x._id), x.n]));
}

/** الخبرُ لكلّ شاشةٍ تعرض الكشف: صفحتُه، وصفحةُ معاملته، وفاتورتُه. */
async function announce(wf) {
  const count = await WorkflowFollowUp.countDocuments({ workflow: wf._id });
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('workflow:followUps', {
      workflowId: String(wf._id),
      reportNumber: wf.reportNumber || '',
      invoiceNumber: wf.invoiceNumber || '',
      clearanceId: wf.customsLink && wf.customsLink.clearance ? String(wf.customsLink.clearance) : '',
      count,
      at: Date.now(),
    });
  } catch (_) { /* البثُّ تحسينٌ لا شرط */ }
  return count;
}

// ── مَن يصل إلى الكشف من أيّ باب ───────────────────────────────────────────
const WF_FIELDS = '_id reportNumber invoiceNumber customsLink';
const SCOPES = {
  operations: async (req) => {
    const wf = await OperationsWorkflow.findById(req.params.id).select(WF_FIELDS).lean();
    if (!wf) throw fail(404, 'الكشف غير موجود');
    return wf;
  },
  // بابُ التخليص يرى ما رُبط بمعاملته وحدَه.
  customs: async (req) => {
    const { reportId, id } = req.params;
    if (!mongoose.isValidObjectId(reportId)) throw fail(400, 'معرّفُ الكشف غير صالح');
    const wf = await OperationsWorkflow.findOne({ _id: reportId, 'customsLink.clearance': id }).select(WF_FIELDS).lean();
    if (!wf) throw fail(404, 'الكشفُ غيرُ مرتبطٍ بهذه المعاملة');
    return wf;
  },
  collections: async (req) => {
    const { reportId } = req.params;
    if (!mongoose.isValidObjectId(reportId)) throw fail(400, 'معرّفُ الكشف غير صالح');
    const wf = await OperationsWorkflow.findById(reportId).select(WF_FIELDS).lean();
    if (!wf) throw fail(404, 'الكشف غير موجود');
    return wf;
  },
};

const send = (res, e, fallback) => {
  if (e && e.status) return res.status(e.status).json({ message: e.message, ...(e.code ? { code: e.code } : {}) });
  console.error(fallback, e);
  return res.status(500).json({ message: fallback });
};

/** الأفعالُ الثلاثة لبابٍ بعينه. */
function handlers(source) {
  const scope = SCOPES[source];

  const list = async (req, res) => {
    try {
      const wf = await scope(req);
      const rows = await WorkflowFollowUp.find({ workflow: wf._id }).sort({ at: -1 }).limit(300).lean();
      res.json({ workflowId: String(wf._id), reportNumber: wf.reportNumber || '', followUps: rows.map((f) => shape(req, f)) });
    } catch (e) { send(res, e, 'تعذّر تحميل المتابعات'); }
  };

  const create = async (req, res) => {
    let saved = null;
    try {
      const wf = await scope(req);
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ message: 'اكتب نصَّ المتابعة', code: 'TEXT_REQUIRED' });
      if (text.length > MAX_TEXT) return res.status(400).json({ message: `المتابعةُ أطولُ من ${MAX_TEXT} حرف`, code: 'TEXT_TOO_LONG' });
      const file = req.body?.file;
      if (file && typeof file.dataUrl === 'string' && file.dataUrl) {
        try {
          saved = saveUploadFile(file.dataUrl, 'workflow-followups', String(file.name || ''), { maxBytes: MAX_FILE });
        } catch (err) {
          return res.status(400).json({ message: err.message || 'تعذّر حفظ المرفق', code: 'BAD_FILE' });
        }
      }
      const doc = await WorkflowFollowUp.create({
        workflow: wf._id, reportNumber: wf.reportNumber || '', text,
        ...(saved ? { attachment: saved } : {}),
        by: req.user._id, byName: nameOf(req.user), byRole: req.user.role || '', source, at: new Date(),
      });
      await logAudit({
        user: req.user._id, action: 'add_workflow_followup', entity: 'OperationsWorkflow', entityId: wf._id,
        changes: { after: { reportNumber: wf.reportNumber, text, source, file: saved ? saved.fileName : undefined } }, ipAddress: req.ip,
      });
      const count = await announce(wf);
      res.status(201).json({ followUp: shape(req, doc.toObject()), count });
    } catch (e) {
      if (saved) deleteStoredFile(saved.fileUrl);
      send(res, e, 'تعذّر حفظ المتابعة');
    }
  };

  const remove = async (req, res) => {
    try {
      const wf = await scope(req);
      // التحصيلُ يسمّيه `rfuId`: `fuId` هناك متابعةُ طرفٍ لا متابعةُ كشف.
      const fuId = req.params.fuId || req.params.rfuId;
      if (!mongoose.isValidObjectId(fuId)) return res.status(400).json({ message: 'طلبٌ غير صالح' });
      const f = await WorkflowFollowUp.findOne({ _id: fuId, workflow: wf._id }).lean();
      if (!f) return res.status(404).json({ message: 'المتابعة غير موجودة' });
      if (!mayDelete(req, f)) {
        return res.status(403).json({ message: 'الحذفُ لمن كتب المتابعة أو لمدير النظام', code: 'NOT_OWNER' });
      }
      await WorkflowFollowUp.deleteOne({ _id: f._id });
      if (f.attachment && f.attachment.fileUrl) deleteStoredFile(f.attachment.fileUrl);
      await logAudit({
        user: req.user._id, action: 'delete_workflow_followup', entity: 'OperationsWorkflow', entityId: wf._id,
        changes: { before: { reportNumber: wf.reportNumber, text: f.text, byName: f.byName } }, ipAddress: req.ip,
      });
      const count = await announce(wf);
      res.json({ ok: true, count });
    } catch (e) { send(res, e, 'تعذّر حذف المتابعة'); }
  };

  return { list, create, remove };
}

module.exports = {
  operations: handlers('operations'),
  customs: handlers('customs'),
  collections: handlers('collections'),
  countsFor,
};
