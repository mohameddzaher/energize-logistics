/**
 * sectionWorkController — generic per-section Tasks + Complaints with STRICT
 * visibility: a record assigned to someone is visible only to (a) the assignee,
 * (b) the creator, and (c) super_admin. Everyone else — including managers of the
 * same section — cannot see or touch it.
 */
const SectionTask = require('../models/SectionTask');
const SectionComplaint = require('../models/SectionComplaint');
const User = require('../models/User');
const { emitToUser } = require('../websocket/socketManager');

// Sections that may own tasks/complaints (mirror of the frontend SECTIONS list).
const SECTIONS = ['crm', 'sales', 'accounting', 'procurement', 'hr', 'ops', 'workshop', 'customs'];

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
        }
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
        if (doc.assignedTo && !sameId(doc.assignedTo, req.user._id)) {
          try { emitToUser(String(doc.assignedTo), 'section:work', { section: doc.section, model: Model.modelName }); } catch (e) {}
        }
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
