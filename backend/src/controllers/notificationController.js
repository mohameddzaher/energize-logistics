const Notification = require('../models/Notification');
const { effectivePermissions } = require('../utils/permissions');

/**
 * What a user sees: what is addressed to them, and what is addressed to a section they own.
 * The bell used to read only `recipient`, so each section-wide item was written as a row per person in a hand-written recipient list at every call site. Anyone not listed got nothing (38 active users had no notification at all: operations reps, collections staff, B2C supervisors, vehicle and customs managers).
 * The destination is now the section itself, and the reader is determined by what the permission matrix opened for them: the matrix that decides which screens open also decides which items are seen. A granted section is seen without being added to a list, a closed one is not, and no list can be forgotten.
 */
// The reader is determined by role, not by what the matrix opens (an accountant saw operations news because of a screen there):
// system admin: everything; section manager: everything in their section; employee: only what is addressed to them.
// Section notifications (including action feeds; see services/activityFeed) go to the manager and system admin.
const { SECTION_ROLES } = require('../config/roles');
// Someone who manages a section without having its manager role: the finance manager sits above the accounts manager.
const EXTRA_MANAGED = { cfo: ['Accounting'] };

/** Reader scope: `all` for the system admin, otherwise the sections they manage. */
const scopeOf = async (user) => {
  const role = user?.role;
  if (require('../config/constants').isTopRole(role)) return { all: true, sections: [] };
  const sections = SECTION_ROLES.filter((s) => s.manager.key === role).map((s) => s.section);
  return { all: false, sections: [...sections, ...(EXTRA_MANAGED[role] || [])] };
};
const sectionsOf = scopeOf;

/**
 * Section rows this reader sees (their own actions are not shown to them), from the last SECTION_WINDOW_DAYS.
 * Section rows are written for every action across the company, so without a date bound the unread count of a super admin read every one of them on each bell refresh (Atlas query targeting ~18,000 examined per count). The bound lets the { section, createdAt } index answer it.
 */
const SECTION_WINDOW_DAYS = 60;
const sectionClause = (userId, scope) => {
  const recent = { $gte: new Date(Date.now() - SECTION_WINDOW_DAYS * 86400000) };
  if (scope.all) return [{ section: { $type: 'string' }, createdAt: recent, actor: { $ne: userId } }];
  return scope.sections.length ? [{ section: { $in: scope.sections }, createdAt: recent, actor: { $ne: userId } }] : [];
};

/** Concerns-me condition: addressed to me, or to a section I manage. */
const mineFilter = (userId, scope) => ({
  $or: [{ recipient: userId }, ...sectionClause(userId, scope)],
});

/** Unread differs between the two kinds: a personal one has `isRead`, while a section notification is one row seen by many, which a single flag cannot hold, so it is read from `readBy`. */
const unreadFilter = (userId, scope) => ({
  $or: [
    { recipient: userId, isRead: false },
    ...sectionClause(userId, scope).map((c) => ({ ...c, readBy: { $ne: userId } })),
  ],
});

exports.getNotifications = async (req, res) => {
  try {
    const { unreadOnly, page = 1, limit = 20 } = req.query;
    const sections = await sectionsOf(req.user);
    const uid = req.user._id;

    const filter = unreadOnly === 'true' ? unreadFilter(uid, sections) : mineFilter(uid, sections);
    const skip = (Number(page) - 1) * Number(limit);
    // The counts stop at a cap: the bell shows '9+' and the list pages through tens, while an exact count over ~20k section rows (each fetched to test readBy) cost ~180 ms per refresh.
    const [rows, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Notification.countDocuments(filter, { limit: 1000 }),
      Notification.countDocuments(unreadFilter(uid, sections), { limit: 100 }),
    ]);

    // The screen reads a single `isRead` whatever the notification type, so it is derived from `readBy` for section ones instead of teaching the screen the difference.
    const notifications = rows.map((n) => ({
      ...n,
      isRead: n.recipient ? !!n.isRead : (n.readBy || []).some((x) => String(x) === String(uid)),
    }));

    res.json({ notifications, total, unreadCount, page: Number(page) });
  } catch (error) {
    console.error('getNotifications:', error);
    res.status(500).json({ message: 'Failed to process notification request' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const uid = req.user._id;
    const sections = await sectionsOf(req.user);
    const n = await Notification.findOne({ _id: req.params.id, ...mineFilter(uid, sections) });
    if (!n) return res.status(404).json({ message: 'Notification not found' });

    if (n.recipient) { n.isRead = true; n.readAt = new Date(); }
    // Section type: the reader is added and never flipped for others.
    else if (!(n.readBy || []).some((x) => String(x) === String(uid))) n.readBy.push(uid);
    await n.save();

    res.json({ notification: { ...n.toObject(), isRead: true } });
  } catch (error) {
    console.error('markAsRead:', error);
    res.status(500).json({ message: 'Failed to process notification request' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const uid = req.user._id;
    const sections = await sectionsOf(req.user);
    await Promise.all([
      Notification.updateMany({ recipient: uid, isRead: false }, { isRead: true, readAt: new Date() }),
      ...sectionClause(uid, sections).map((c) => Notification.updateMany({ ...c, readBy: { $ne: uid } }, { $addToSet: { readBy: uid } })),
    ]);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('markAllAsRead:', error);
    res.status(500).json({ message: 'Failed to process notification request' });
  }
};
