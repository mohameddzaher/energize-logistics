/**
 * A section manager hands business review to members of his team (utils/brDelegate).
 * GET lists his section's staff with who already acts for him; PUT grants or revokes one. Executives may do it for any manager.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const { isManagerRole, isExecutive } = require('../config/businessReview');
const { sectionsOfUserIds } = require('../utils/userSection');
const { orgSectionOfRole } = require('../config/roles');
const brDelegate = require('../utils/brDelegate');
const name = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

async function sectionOf(userId, role) {
  return (await sectionsOfUserIds([userId])).get(String(userId)) || orgSectionOfRole(role) || null;
}

/** The manager acting: the caller, or (for executives) the one named in ?manager=. */
async function managerFor(req) {
  const me = req.user;
  if (req.query.manager && isExecutive(me) && mongoose.isValidObjectId(String(req.query.manager))) {
    return User.findById(req.query.manager).select('firstName lastName role').lean();
  }
  return isManagerRole(me.role) ? me : null;
}

exports.list = async (req, res) => {
  try {
    const mgr = await managerFor(req);
    if (!mgr) return res.status(403).json({ message: 'التفويض لمديري الأقسام فقط' });
    const section = await sectionOf(mgr._id, mgr.role);
    if (!section) return res.json({ section: null, members: [] });
    const users = await User.find({ isActive: { $ne: false }, role: { $nin: ['client', 'super_admin'] }, _id: { $ne: mgr._id } })
      .select('firstName lastName role brActsFor email').lean();
    const secs = await sectionsOfUserIds(users.map((u) => u._id));
    const members = users
      .filter((u) => secs.get(String(u._id)) === section && !isManagerRole(u.role))
      .map((u) => ({ _id: String(u._id), name: name(u), role: u.role, email: u.email || '', delegated: String(u.brActsFor || '') === String(mgr._id), actsForOther: !!u.brActsFor && String(u.brActsFor) !== String(mgr._id) }))
      .sort((a, b) => Number(b.delegated) - Number(a.delegated) || a.name.localeCompare(b.name, 'ar'));
    res.json({ section, manager: { _id: String(mgr._id), name: name(mgr) }, members });
  } catch (e) { console.error('[br-delegates]', e); res.status(500).json({ message: 'تعذّر التحميل' }); }
};

exports.set = async (req, res) => {
  try {
    const mgr = await managerFor(req);
    if (!mgr) return res.status(403).json({ message: 'التفويض لمديري الأقسام فقط' });
    if (!mongoose.isValidObjectId(String(req.params.userId))) return res.status(400).json({ message: 'معرّف غير صالح' });
    const target = await User.findById(req.params.userId).select('firstName lastName role brActsFor isActive').lean();
    if (!target || target.isActive === false) return res.status(404).json({ message: 'الموظّف غير موجود' });
    if (isManagerRole(target.role)) return res.status(400).json({ message: 'المدير يملك مراجعة الأعمال بنفسه' });
    const [mSec, tSec] = await Promise.all([sectionOf(mgr._id, mgr.role), sectionOf(target._id, target.role)]);
    if (!mSec || mSec !== tSec) return res.status(403).json({ message: 'يُفوَّض أعضاءُ قسمك فقط' });
    const on = req.body && req.body.on === true;
    if (!on && String(target.brActsFor || '') !== String(mgr._id)) return res.json({ ok: true });
    await User.updateOne({ _id: target._id }, { $set: { brActsFor: on ? mgr._id : null } });
    // The auth cache holds the user object; drop it so the change applies on the next request.
    require('../middleware/auth').invalidateUserCache(String(target._id));
    brDelegate.clear(String(mgr._id));
    try {
      await require('../services/notificationService').createNotification({
        recipient: target._id, type: 'system_alert',
        title: on ? 'فُوِّضتَ في مراجعة الأعمال' : 'انتهى تفويضك في مراجعة الأعمال',
        message: on ? `فوّضك ${name(mgr)} في متابعة بنود القسم في مراجعة الأعمال.` : `أنهى ${name(mgr)} تفويضك في مراجعة الأعمال.`,
      });
    } catch (_) { /* a missed notification must not fail the change */ }
    try { require('../websocket/socketManager').emitToAll('br:updated', { delegate: String(target._id) }); } catch (_) { /* */ }
    try { require('../websocket/socketManager').emitToAll('user:updated', { id: String(target._id) }); } catch (_) { /* */ }
    res.json({ ok: true, on });
  } catch (e) { console.error('[br-delegates] set', e); res.status(500).json({ message: 'تعذّر الحفظ' }); }
};
