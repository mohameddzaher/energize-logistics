/**
 * sectionWorkController — generic per-section Tasks + Complaints with STRICT
 * visibility: a record assigned to someone is visible only to (a) the assignee,
 * (b) the creator, and (c) super_admin. Everyone else — including managers of the
 * same section — cannot see or touch it.
 */
const SectionTask = require('../models/SectionTask');
const SectionComplaint = require('../models/SectionComplaint');
const User = require('../models/User');
const { emitToUser, emitToAll } = require('../websocket/socketManager');
const { createNotification } = require('../services/notificationService');

// إشعار للمكلَّف عند تعيين مهمة/شكوى له (غير المنشئ نفسه) — يظهر لحظيًا وبصوت على الموبايل.
const notifyAssignee = async (doc, req, isComplaint, label) => {
  if (!doc.assignedTo || sameId(doc.assignedTo, req.user._id)) return;
  try {
    await createNotification({
      recipient: doc.assignedTo,
      type: isComplaint ? 'complaint_assigned' : 'task_assigned',
      title: isComplaint ? 'شكوى جديدة مُسندة إليك' : 'مهمة جديدة مُسندة إليك',
      message: `${label || ''} — قسم ${doc.section}`.trim(),
      relatedEntity: isComplaint ? 'SectionComplaint' : 'SectionTask',
      relatedEntityId: doc._id,
    });
  } catch (e) { /* الإشعار إضافة — لا يفشل الحفظ */ }
};

// Refresh trigger for every open tasks/complaints board — each client refetches
// through the strict visibility filter, so broadcasting leaks nothing; emitting
// to the assignee only left the creator's and super-admin's boards stale.
const broadcastWork = (section, modelName) => {
  try { emitToAll('section:work', { section, model: modelName }); } catch (e) { /* socket down ≠ failed save */ }
};

// Sections that may own tasks/complaints (mirror of the frontend SECTIONS list).
const SECTIONS = ['crm', 'sales', 'accounting', 'procurement', 'hr', 'ops', 'workshop', 'customs', 'marketing', 'bd', 'it', 'fleet', 'contracts', 'vehicles'];

const isSuper = (u) => u && u.role === 'super_admin';
const sameId = (a, b) => a && b && String(a) === String(b);

// The visibility clause applied to every read/scope. super_admin: everything in
// the section. Others: only what they're assigned or what they created.
function visibilityClause(user) {
  if (isSuper(user)) return {};
  return { $or: [{ assignedTo: user._id }, { createdBy: user._id }] };
}

const POPULATE = (q) => q
  .populate('assignedTo', 'firstName lastName role')
  .populate('createdBy', 'firstName lastName role');

function makeHandlers(Model, requiredField, allowedFields) {
  const pick = (body) => {
    const out = {};
    allowedFields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
    return out;
  };

  return {
    list: async (req, res) => {
      try {
        const section = String(req.query.section || '');
        if (!SECTIONS.includes(section)) return res.status(400).json({ message: 'Invalid section' });
        const filter = { section, ...visibilityClause(req.user) };
        if (req.query.status) filter.status = req.query.status;
        const items = await POPULATE(Model.find(filter)).sort({ createdAt: -1 }).limit(500).lean();
        res.json({ items });
      } catch (e) {
        console.error('sectionWork list error:', e.message);
        res.status(500).json({ message: 'Failed to load' });
      }
    },

    create: async (req, res) => {
      try {
        const section = String(req.body.section || '');
        if (!SECTIONS.includes(section)) return res.status(400).json({ message: 'Invalid section' });
        if (!req.body[requiredField] || !String(req.body[requiredField]).trim()) {
          return res.status(400).json({ message: `${requiredField} is required` });
        }
        const data = { ...pick(req.body), section, createdBy: req.user._id };
        if (!data.assignedTo) data.assignedTo = req.user._id; // default-assign to creator
        const doc = await Model.create(data);
        if (doc.assignedTo && !sameId(doc.assignedTo, req.user._id)) {
          try { emitToUser(String(doc.assignedTo), 'section:work', { section, model: Model.modelName }); } catch (e) {}
          await notifyAssignee(doc, req, Model.modelName === 'SectionComplaint', String(req.body[requiredField] || ''));
        }
        broadcastWork(section, Model.modelName);
        const item = await POPULATE(Model.findById(doc._id)).lean();
        res.status(201).json({ item });
      } catch (e) {
        console.error('sectionWork create error:', e.message);
        res.status(500).json({ message: 'Failed to create' });
      }
    },

    update: async (req, res) => {
      try {
        const doc = await Model.findById(req.params.id);
        if (!doc) return res.status(404).json({ message: 'Not found' });
        const allowed = isSuper(req.user) || sameId(doc.assignedTo, req.user._id) || sameId(doc.createdBy, req.user._id);
        if (!allowed) return res.status(403).json({ message: 'Not allowed' });
        const updates = pick(req.body);
        Object.assign(doc, updates);
        await doc.save();
        if (doc.assignedTo && !sameId(doc.assignedTo, req.user._id) && updates.assignedTo) {
          try { emitToUser(String(doc.assignedTo), 'section:work', { section: doc.section, model: Model.modelName }); } catch (e) {}
          await notifyAssignee(doc, req, Model.modelName === 'SectionComplaint', String(doc[requiredField] || ''));
        }
        broadcastWork(doc.section, Model.modelName);
        const item = await POPULATE(Model.findById(doc._id)).lean();
        res.json({ item });
      } catch (e) {
        console.error('sectionWork update error:', e.message);
        res.status(500).json({ message: 'Failed to update' });
      }
    },

    remove: async (req, res) => {
      try {
        const doc = await Model.findById(req.params.id);
        if (!doc) return res.status(404).json({ message: 'Not found' });
        const allowed = isSuper(req.user) || sameId(doc.assignedTo, req.user._id) || sameId(doc.createdBy, req.user._id);
        if (!allowed) return res.status(403).json({ message: 'Not allowed' });
        await doc.deleteOne();
        broadcastWork(doc.section, Model.modelName);
        res.json({ ok: true });
      } catch (e) {
        console.error('sectionWork remove error:', e.message);
        res.status(500).json({ message: 'Failed to delete' });
      }
    },
  };
}

const tasks = makeHandlers(SectionTask, 'title', ['title', 'description', 'status', 'priority', 'dueDate', 'assignedTo']);
const complaints = makeHandlers(SectionComplaint, 'subject', ['subject', 'description', 'status', 'priority', 'resolution', 'assignedTo']);

// People a task/complaint can be assigned to (active internal staff).
async function assignees(req, res) {
  try {
    const users = await User.find({ isActive: true, role: { $ne: 'client' } })
      .select('firstName lastName role')
      .sort({ firstName: 1 })
      .limit(500)
      .lean();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load assignees' });
  }
}

module.exports = { tasks, complaints, assignees, SECTIONS };
