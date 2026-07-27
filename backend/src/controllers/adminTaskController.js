const AdminTask = require('../models/AdminTask');
const User = require('../models/User');
const { emitToAll } = require('../websocket/socketManager');

// الشؤون الإدارية — board controller. Every mutation appends a فصحى activity
// line and broadcasts ONE event; clients refetch the whole board (it is small)
// so the four columns can never drift out of sync between browsers.

const STATUSES = AdminTask.STATUSES;
const PRIORITIES = AdminTask.PRIORITIES;

const STATUS_AR = {
  new: 'جديدة',
  in_progress: 'قيد التنفيذ',
  follow_up: 'قيد المتابعة',
  done: 'مكتملة',
};

const emit = () => {
  try { emitToAll('admintasks:updated', {}); } catch (e) { /* socket optional */ }
};

const actorName = (req) => `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

const fmtDateAr = (d) => {
  try { return new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return String(d); }
};

// ── Board ────────────────────────────────────────────────────────────────────

exports.listTasks = async (req, res) => {
  try {
    const tasks = await AdminTask.find().sort({ status: 1, order: 1, createdAt: -1 }).lean();
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Whoever can be handed a task: the section's own people plus the admin tier
// that supervises them. Name + id only — this feeds a dropdown.
exports.listAssignees = async (req, res) => {
  try {
    const users = await User.find({
      role: { $in: ['administrator', 'admin', 'super_admin', 'bd_manager'] },
      status: { $ne: 'inactive' },
    }).select('firstName lastName email role').sort({ firstName: 1 }).lean();
    res.json({
      users: users.map((u) => ({
        _id: u._id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        role: u.role,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { title, description, priority, dueDate, assignee } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ message: 'Title is required' });

    let assigneeName = '';
    if (assignee) {
      const u = await User.findById(assignee).select('firstName lastName email').lean();
      if (!u) return res.status(400).json({ message: 'Assignee not found' });
      assigneeName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
    }

    // New cards land at the top of «جديدة» — the fresh work is what the team
    // opens the board to see.
    const top = await AdminTask.findOne({ status: 'new' }).sort({ order: 1 }).select('order').lean();
    const by = actorName(req);

    const task = await AdminTask.create({
      title: String(title).trim(),
      description: String(description || '').trim(),
      priority: PRIORITIES.includes(priority) ? priority : 'normal',
      dueDate: dueDate ? new Date(dueDate) : null,
      assignee: assignee || null,
      assigneeName,
      createdBy: req.user._id,
      createdByName: by,
      order: (top?.order ?? 1) - 1,
      activity: [{ byName: by, text: assigneeName ? `أنشأ المهمة وأسندها إلى ${assigneeName}` : 'أنشأ المهمة' }],
    });

    emit();
    res.status(201).json({ task });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await AdminTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const by = actorName(req);
    const b = req.body;
    const log = [];

    if (b.title !== undefined && String(b.title).trim() && String(b.title).trim() !== task.title) {
      task.title = String(b.title).trim();
      log.push('عدّل عنوان المهمة');
    }
    if (b.description !== undefined && String(b.description || '').trim() !== task.description) {
      task.description = String(b.description || '').trim();
      log.push('عدّل تفاصيل المهمة');
    }
    if (b.priority !== undefined && PRIORITIES.includes(b.priority) && b.priority !== task.priority) {
      task.priority = b.priority;
      log.push('غيّر أولوية المهمة');
    }
    if (b.dueDate !== undefined) {
      const next = b.dueDate ? new Date(b.dueDate) : null;
      const prev = task.dueDate ? task.dueDate.getTime() : null;
      if ((next ? next.getTime() : null) !== prev) {
        task.dueDate = next;
        log.push(next ? `حدّد تاريخ الاستحقاق: ${fmtDateAr(next)}` : 'ألغى تاريخ الاستحقاق');
      }
    }
    if (b.assignee !== undefined) {
      const nextId = b.assignee || null;
      if (String(nextId || '') !== String(task.assignee || '')) {
        if (nextId) {
          const u = await User.findById(nextId).select('firstName lastName email').lean();
          if (!u) return res.status(400).json({ message: 'Assignee not found' });
          task.assignee = nextId;
          task.assigneeName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
          log.push(`أسند المهمة إلى ${task.assigneeName}`);
        } else {
          task.assignee = null;
          task.assigneeName = '';
          log.push('ألغى إسناد المهمة');
        }
      }
    }
    if (b.status !== undefined && STATUSES.includes(b.status) && b.status !== task.status) {
      task.status = b.status;
      task.completedAt = b.status === 'done' ? new Date() : null;
      log.push(`نقل المهمة إلى «${STATUS_AR[b.status]}»`);
    }
    if (b.order !== undefined && Number.isFinite(Number(b.order))) {
      task.order = Number(b.order); // silent — pure reordering is not news
    }

    log.forEach((text) => task.activity.push({ byName: by, text }));
    await task.save();

    emit();
    res.json({ task });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ message: 'Comment text is required' });

    const task = await AdminTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    task.comments.push({ by: req.user._id, byName: actorName(req), text });
    await task.save();

    emit();
    res.status(201).json({ task });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const task = await AdminTask.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    emit();
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
