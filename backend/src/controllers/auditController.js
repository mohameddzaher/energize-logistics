const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

exports.getAuditLogs = async (req, res) => {
  try {
    // The page historically sent from/to while this read dateFrom/dateTo — the
    // date filter never filtered anything. Accept both spellings.
    const { entity, action, user, page = 1, limit = 50 } = req.query;
    const dateFrom = req.query.dateFrom || req.query.from;
    const dateTo = req.query.dateTo || req.query.to;
    const filter = {};

    if (entity) filter.entity = entity;
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (user) filter.user = user;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      // A bare YYYY-MM-DD is midnight — push to end-of-day so the chosen last
      // day's activity is included.
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).getTime() + 86400000 - 1);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('user', 'firstName lastName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      AuditLog.countDocuments(filter),
    ]);

    // ── الفاعلُ يُقرأ من اللقطة حين يُحذَف حسابُه ──────────────────────────
    // `populate` تعود فارغةً لمستخدمٍ محذوف، فتقرأ الشاشةُ الفعلَ منسوبًا إلى
    // «النظام». فيُكمَّل من اللقطة المحفوظة ساعةَ الفعل، ويُعلَّم أنّ حسابَه
    // أُزيل — فلا يُنسَب فعلُ إنسانٍ إلى آلة.
    const shaped = logs.map((l) => {
      const o = l.toObject ? l.toObject() : l;
      if (!o.user && (o.userName || o.userEmail)) {
        o.user = { _id: String(l.user || ''), firstName: o.userName || o.userEmail, lastName: '', email: o.userEmail || '', deleted: true };
      }
      return o;
    });
    res.json({ logs: shaped, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load audit logs' });
  }
};

// Filter vocabulary for the audit page: the entities that actually occur in the
// log, and the people who actually performed something — so the person filter
// offers real actors, not the whole user table.
exports.getAuditOptions = async (req, res) => {
  try {
    const [entities, userIds] = await Promise.all([
      AuditLog.distinct('entity'),
      AuditLog.distinct('user'),
    ]);
    const users = await User.find({ _id: { $in: userIds.filter(Boolean) } })
      .select('firstName lastName email role')
      .lean();
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    res.json({ entities: entities.filter(Boolean).sort(), users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load audit options' });
  }
};
