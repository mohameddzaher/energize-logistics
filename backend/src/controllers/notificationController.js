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
const sectionsOf = async (user) => {
  try {
    const perms = await effectivePermissions(user.role);
    return Object.entries(perms || {})
      .filter(([, v]) => v === 'view' || v === 'edit')
      .map(([k]) => k);
  } catch (e) {
    // تعذّر قراءةُ الصلاحيّات: يُعرَض ما وُجِّه إليه شخصيًّا ولا يُخمَّن قسم.
    console.error('notifications: sections lookup failed:', e.message);
    return [];
  }
};

/** شرطُ «يخصّني»: موجَّهٌ إليّ، أو إلى قسمٍ أملكه. */
const mineFilter = (userId, sections) => ({
  $or: [{ recipient: userId }, ...(sections.length ? [{ section: { $in: sections } }] : [])],
});

/**
 * «غيرُ مقروء» يختلف بين الاثنين: الشخصيُّ له `isRead`، وإشعارُ القسم صفٌّ
 * واحدٌ يراه كثيرون فلا تسعه رايةٌ واحدة — يُقرأ من `readBy`.
 */
const unreadFilter = (userId, sections) => ({
  $or: [
    { recipient: userId, isRead: false },
    ...(sections.length ? [{ section: { $in: sections }, readBy: { $ne: userId } }] : []),
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
      sections.length
        ? Notification.updateMany({ section: { $in: sections }, readBy: { $ne: uid } }, { $addToSet: { readBy: uid } })
        : Promise.resolve(),
    ]);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('markAllAsRead:', error);
    res.status(500).json({ message: 'Failed to process notification request' });
  }
};
