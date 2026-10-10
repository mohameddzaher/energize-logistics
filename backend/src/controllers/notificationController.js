const Notification = require('../models/Notification');
const { effectivePermissions } = require('../utils/permissions');

/**
 * ── ما يراه المستخدم: ما وُجِّه إليه، وما وُجِّه إلى قسمٍ يملكه ───────────────
 *
 * كان الجرس يقرأ `recipient` وحدَه، فكلُّ خبرٍ يخصّ قسمًا كان يُكتب صفًّا لكلّ
 * شخصٍ في قائمةِ مستلمين مكتوبةٍ بيدٍ عند كلّ موضع. ومن لم يُذكر في القائمة لم
 * يصله شيء: ثمانيةٌ وثلاثون مستخدمًا نشِطًا بلا إشعارٍ واحد — مناديبُ التشغيل
 * وموظّفو التحصيل ومشرفو B2C ومديرو المركبات والجمارك.
 *
 * فالوجهةُ صارت القسمَ نفسَه، والقارئُ يُحدَّد بما فُتح له: **المصفوفةُ التي
 * تقرّر أيَّ الشاشات يفتح هي التي تقرّر أيَّ الأخبار يرى**. فمن مُنح قسمًا رآه
 * بلا أن يُضاف إلى قائمة، ومن أُغلق عنه لم يره — ولا قائمةَ تُنسى.
 */
//
// ── ثمّ صار القارئُ يُحدَّد بموقعه لا بما فُتح له (٢٠٢٦-١٠) ──────────────────
// المصفوفةُ تفتح القسمَ لمن يعمل فيه ولمن يحتاج شاشاتِه — فكان المحاسبُ يرى
// أخبارَ التشغيل لأنّ له شاشةً فيه. والمطلوبُ أبسط:
//
//   مديرُ النظام   كلَّ ما يُفعَل في النظام.
//   مديرُ القسم    كلَّ ما يدور في قسمه — أخبارَه وأفعالَ فريقه.
//   الموظّف        ما وُجِّه إليه هو وحدَه.
//
// فإشعارُ القسم (ومنه أخبارُ الأفعال — راجع services/activityFeed) يراه مديرُه
// ومديرُ النظام؛ والموظّفُ يصله ما كُتب باسمه: مهمّةٌ أُسنِدت، طلبٌ رُدّ عليه.
const { SECTION_ROLES } = require('../config/roles');
// من يدير قسمًا وليس دورُه دورَ مديره — المديرُ الماليُّ فوق مدير الحسابات.
const EXTRA_MANAGED = { cfo: ['Accounting'] };

/** نطاقُ القارئ: `all` لمدير النظام، وإلّا الأقسامُ التي يديرها. */
const scopeOf = async (user) => {
  const role = user?.role;
  if (role === 'super_admin') return { all: true, sections: [] };
  const sections = SECTION_ROLES.filter((s) => s.manager.key === role).map((s) => s.section);
  return { all: false, sections: [...sections, ...(EXTRA_MANAGED[role] || [])] };
};
const sectionsOf = scopeOf;

/** صفوفُ الأقسام التي يراها هذا القارئ — ولا يُعرَض عليه خبرُ ما فعله هو. */
const sectionClause = (userId, scope) => {
  if (scope.all) return [{ section: { $ne: null }, actor: { $ne: userId } }];
  return scope.sections.length ? [{ section: { $in: scope.sections }, actor: { $ne: userId } }] : [];
};

/** شرطُ «يخصّني»: موجَّهٌ إليّ، أو إلى قسمٍ أديره. */
const mineFilter = (userId, scope) => ({
  $or: [{ recipient: userId }, ...sectionClause(userId, scope)],
});

/**
 * «غيرُ مقروء» يختلف بين الاثنين: الشخصيُّ له `isRead`، وإشعارُ القسم صفٌّ
 * واحدٌ يراه كثيرون فلا تسعه رايةٌ واحدة — يُقرأ من `readBy`.
 */
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
    const [rows, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments(unreadFilter(uid, sections)),
    ]);

    // والشاشةُ تقرأ `isRead` واحدةً مهما كان نوعُ الإشعار — فتُشتقّ للقسميّ من
    // `readBy` بدل أن تتعلّم الشاشةُ الفرق.
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
    // القسميُّ: يُضاف القارئُ ولا يُقلَب لغيره.
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
