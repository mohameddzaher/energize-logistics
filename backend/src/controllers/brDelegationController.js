/**
 * A section manager hands business review to others (utils/brDelegate): members of his own section, the shared
 * transition/backup accounts, and the data manager, who serve several sections. One account may act for several managers.
 * GET lists who can be delegated with who already is; PUT grants or revokes one. Executives may do it for any manager (?manager=).
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const { isManagerRole, isExecutive } = require('../config/businessReview');
const { sectionsOfUserIds } = require('../utils/userSection');
const { orgSectionOfRole } = require('../config/roles');
const { OPEN_BY_GRANT_ROLES } = require('../config/constants');
const brDelegate = require('../utils/brDelegate');
const name = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

// Accounts shared between sections, offered to every manager besides his own team.
const DATA_MANAGER_ROLES = ['data_manager'];
const isShared = (role) => OPEN_BY_GRANT_ROLES.includes(role) || DATA_MANAGER_ROLES.includes(role);

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

/** May this manager delegate to this account: his own section's staff, or a shared account. */
const eligible = (target, targetSection, mgrSection) =>
  isShared(target.role) || (!isManagerRole(target.role) && !!mgrSection && targetSection === mgrSection);

exports.list = async (req, res) => {
  try {
    const mgr = await managerFor(req);
    if (!mgr) return res.status(403).json({ message: 'التفويض لمديري الأقسام فقط' });
    const section = await sectionOf(mgr._id, mgr.role);
    const users = await User.find({ isActive: { $ne: false }, role: { $nin: ['client', 'super_admin'] }, _id: { $ne: mgr._id } })
      .select('firstName lastName role brActsFor email').lean();
    const secs = await sectionsOfUserIds(users.map((u) => u._id));
    const others = new Set(users.flatMap((u) => brDelegate.actsForIds(u)));
    const names = new Map((await User.find({ _id: { $in: [...others] } }).select('firstName lastName').lean()).map((m) => [String(m._id), name(m)]));
    const { LABELS_AR } = require('../config/roles');
    const members = users
      .filter((u) => eligible(u, secs.get(String(u._id)), section))
      .map((u) => {
        const ids = brDelegate.actsForIds(u);
        return {
          _id: String(u._id), name: name(u), role: u.role, roleAr: LABELS_AR[u.role] || u.role, email: u.email || '',
          shared: isShared(u.role),
          delegated: ids.includes(String(mgr._id)),
          // Other managers this account also acts for; a shared account may serve several sections at once.
          alsoFor: ids.filter((x) => x !== String(mgr._id)).map((x) => names.get(x)).filter(Boolean),
          actsForOther: ids.some((x) => x !== String(mgr._id)),
        };
      })
      .sort((a, b) => Number(b.delegated) - Number(a.delegated) || Number(a.shared) - Number(b.shared) || a.name.localeCompare(b.name, 'ar'));
    const { sectionLabel } = require('../config/sections');
    res.json({ section, sectionAr: section ? sectionLabel(section, 'ar') : '', sectionEn: section ? sectionLabel(section, 'en') : '', manager: { _id: String(mgr._id), name: name(mgr) }, members });
  } catch (e) { console.error('[br-delegates]', e); res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** Grant or revoke one delegation; shared by the HTTP route and the bulk script. */
async function setDelegation(mgr, targetId, on) {
  const target = await User.findById(targetId).select('firstName lastName role brActsFor isActive').lean();
  if (!target || target.isActive === false) return { status: 404, message: 'الموظّف غير موجود' };
  if (String(target._id) === String(mgr._id)) return { status: 400, message: 'لا يُفوَّض المدير لنفسه' };
  const [mSec, tSec] = await Promise.all([sectionOf(mgr._id, mgr.role), sectionOf(target._id, target.role)]);
  if (!eligible(target, tSec, mSec)) {
    return { status: isManagerRole(target.role) ? 400 : 403, message: isManagerRole(target.role) ? 'المدير يملك مراجعة الأعمال بنفسه' : 'يُفوَّض أعضاءُ قسمك والحساباتُ المشتركة فقط' };
  }
  const had = brDelegate.actsForIds(target).includes(String(mgr._id));
  if (had === on) return { ok: true, on, changed: false };
  await User.updateOne({ _id: target._id }, on ? { $addToSet: { brActsFor: mgr._id } } : { $pull: { brActsFor: mgr._id } });
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
  return { ok: true, on, changed: true };
}
exports.setDelegation = setDelegation;

exports.set = async (req, res) => {
  try {
    const mgr = await managerFor(req);
    if (!mgr) return res.status(403).json({ message: 'التفويض لمديري الأقسام فقط' });
    if (!mongoose.isValidObjectId(String(req.params.userId))) return res.status(400).json({ message: 'معرّف غير صالح' });
    const r = await setDelegation(mgr, req.params.userId, req.body && req.body.on === true);
    if (r.status) return res.status(r.status).json({ message: r.message });
    res.json({ ok: true, on: r.on });
  } catch (e) { console.error('[br-delegates] set', e); res.status(500).json({ message: 'تعذّر الحفظ' }); }
};
