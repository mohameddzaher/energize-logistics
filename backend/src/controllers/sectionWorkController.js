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

// Notify the assignee when a task or complaint is assigned to him (not the creator): live, with sound on mobile.
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
  } catch (e) { /* The notification is an extra: it must not fail the save */ }
};

// Refresh trigger for every open tasks/complaints board — each client refetches
// through the strict visibility filter, so broadcasting leaks nothing; emitting
// to the assignee only left the creator's and super-admin's boards stale.
const broadcastWork = (section, modelName) => {
  try { emitToAll('section:work', { section, model: modelName }); } catch (e) { /* socket down ≠ failed save */ }
};

// Sections that may own tasks/complaints (mirror of the frontend SECTIONS list).
// Every section with staff has tasks and complaints. Business review is excluded on purpose: it has no roles of its own, it is a forum between section managers, and My Tasks there means meeting items read from a different collection.
const SECTIONS = [
  'crm', 'sales', 'accounting', 'procurement', 'hr', 'ops', 'customs',
  'marketing', 'bd', 'it', 'fleet', 'contracts', 'vehicles',
  'operations', 'shipment-orders', 'ls2', 'administration', 'b2c', 'remote',
  'collections', 'vendors',
];

/**
 * This screen's section strings map to the permission matrix's section keys.
 * Here sections are short strings in the path (`ls2`, `fleet`); there they are display keys (`Location Solutions`, `Fleet Management`). They name the same thing, so the translation is explicit: comparing without it fails silently, reads as no section and opens the list to everyone, the opposite of the intent.
 */
const SECTION_KEY_OF = {
  crm: 'CRM', sales: 'Sales', accounting: 'Accounting', procurement: 'Procurement',
  hr: 'HR', ops: 'Operations Platform', customs: 'Customs', marketing: 'Marketing',
  bd: 'Business Development', it: 'Software & IT', fleet: 'Fleet Management',
  contracts: 'Contracts', vehicles: 'Vehicles', operations: 'Operations',
  'shipment-orders': 'Shipment Orders', ls2: 'Location Solutions',
  administration: 'Administration', b2c: 'B2C', remote: 'Remote',
  collections: 'Collections', vendors: 'Vendors Management',
};

const isSuper = (u) => u && require('../config/constants').isTopRole(u.role);
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
/**
 * Who a task in this section may be assigned to.
 * The list used to be everyone in the company (~200 names in one dropdown), so picking a colleague was a search through a pile and a task could go to someone who cannot open the section, appearing on a screen he cannot open.
 * It is now read from the same permission matrix the server uses to guard the section: anyone with view or edit is on its team here. A matrix change shows in the list at once with no line added here.
 */
async function assignees(req, res) {
  try {
    // An archived person is not selectable and cannot be assigned, as if deleted.
    const archSets = await require('../utils/endedStaff').endedStaff();
    const users = (await User.find({ isActive: true, role: { $nin: require('../config/scopedRoles').EXTERNAL_ROLES } })
      .select('firstName lastName role')
      .sort({ firstName: 1 })
      .limit(500)
      .lean()).filter((u) => !require('../utils/endedStaff').userArchived(archSets, u));

    const sectionKey = SECTION_KEY_OF[String(req.query.section || '')];
    if (!sectionKey) return res.json({ users });

    const { getOverride } = require('../utils/permissions');
    const { FULL_ACCESS_ROLES } = require('../config/constants');
    const { defaultAccess } = require('../config/sections');

    // Roles are queried once, not once per user: dozens of roles, hundreds of people.
    const roles = [...new Set(users.map((u) => u.role))];
    const allowed = new Set();
    await Promise.all(roles.map(async (role) => {
      if (FULL_ACCESS_ROLES.includes(role)) { allowed.add(role); return; }
      const override = await getOverride(role, sectionKey);
      const access = override == null ? defaultAccess(role, sectionKey) : override;
      if (access === 'view' || access === 'edit') allowed.add(role);
    }));

    res.json({ users: users.filter((u) => allowed.has(u.role)) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load assignees' });
  }
}

module.exports = { tasks, complaints, assignees, SECTIONS };
