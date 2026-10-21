/**
 * تأجيرُ اليوزرات — راجع models/LtUserRental.
 *
 * يُسجَّل التأجير (مشروع · لمن: شركة أو شخص · رقم إقامته)، وتاريخُه تلقائيّ.
 * ويُنهى ولا يُحذَف إلّا بيد مدير القطاع ونائبه ومدير النظام — الحذفُ لتصحيح
 * إدخالٍ خاطئ، والإنهاءُ هو انتهاءُ التأجير فعلًا.
 */
const LtUserRental = require('../models/LtUserRental');
const logAudit = require('../utils/auditLogger');
const { todayKey } = require('../utils/companyDay');

const S = (v) => String(v ?? '').trim();
const who = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const DELETE_ROLES = ['super_admin', 'b2c_manager', 'b2c_deputy'];
const changed = () => {
  // الإبطالُ قبل الإعلان — utils/ltRental.announce يمسح ذاكرةَ القسم ثمّ يبثّ.
  require('../utils/ltRental').announce();
};

/**
 * ── اليوزرُ صفٌّ في «موظفي النقل الخفيف» (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────
 * يُختار صفُّه (`ltEmployee`) فيُقرأ منه مشروعُه ورقمُ هويّته واسمُ حسابه، ويصير
 * نوعُ عقده «يوزرات» — راجع utils/ltRental. ولا يُربط صفٌّ بتأجيرين ساريين.
 */
async function linkOf(b, current = null) {
  if (b.ltEmployee === undefined) return { ok: true };
  const id = S(b.ltEmployee);
  if (!id) return { ok: true, set: { ltEmployee: null } };
  const mongoose = require('mongoose');
  if (!mongoose.isValidObjectId(id)) return { ok: false, message: 'اختر اليوزر من القائمة' };
  const { LightTransportEmployee } = require('../models/LightTransport');
  const lt = await LightTransportEmployee.findOne({ _id: id, isActive: { $ne: false } }).select('name idNumber projectAr phone').lean();
  if (!lt) return { ok: false, message: 'اليوزر غير موجود في سجلّ موظّفي النقل الخفيف' };
  const other = await LtUserRental.findOne({ ltEmployee: lt._id, status: 'active', ...(current ? { _id: { $ne: current } } : {}) }).select('renterName').lean();
  if (other) return { ok: false, message: `${lt.name} مؤجَّرٌ أصلًا (لـ${other.renterName}) — أنهِ ذلك التأجير أوّلًا` };
  return { ok: true, lt, set: { ltEmployee: lt._id, projectAr: S(lt.projectAr) || undefined } };
}

function pick(b) {
  const out = {};
  if (b.projectAr !== undefined) out.projectAr = S(b.projectAr);
  if (b.renterType !== undefined) out.renterType = b.renterType === 'company' ? 'company' : b.renterType === 'person' ? 'person' : '';
  if (b.renterName !== undefined) out.renterName = S(b.renterName).slice(0, 200);
  if (b.idNumber !== undefined) out.idNumber = S(b.idNumber).replace(/\s+/g, '');
  if (b.phone !== undefined) out.phone = S(b.phone);
  if (b.userAccount !== undefined) out.userAccount = S(b.userAccount);
  if (b.notes !== undefined) out.notes = S(b.notes).slice(0, 1000);
  return out;
}
function invalid(d, creating) {
  const fields = {};
  if (creating || d.projectAr !== undefined) if (!d.projectAr) fields.projectAr = 'اختر المشروع';
  if (creating || d.renterType !== undefined) if (!d.renterType) fields.renterType = 'لشركة أم لشخص؟';
  if (creating || d.renterName !== undefined) if (!d.renterName) fields.renterName = 'اكتب اسم الشركة أو الشخص';
  if (creating || d.idNumber !== undefined) if (!d.idNumber) fields.idNumber = 'اكتب رقم الإقامة';
  return Object.keys(fields).length ? fields : null;
}

// GET /user-rentals?status=&project=&q=
exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const f = {};
    if (q.status === 'active' || q.status === 'ended') f.status = q.status;
    if (S(q.project)) f.projectAr = S(q.project);
    if (S(q.q)) {
      const rx = new RegExp(S(q.q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const { LightTransportEmployee } = require('../models/LightTransport');
      const lts = await LightTransportEmployee.find({ $or: [{ name: rx }, { idNumber: rx }, { vehiclePlate: rx }] }).select('_id').limit(400).lean();
      f.$or = [{ renterName: rx }, { idNumber: rx }, { userAccount: rx }, { phone: rx }, { notes: rx },
        ...(lts.length ? [{ ltEmployee: { $in: lts.map((x) => x._id) } }] : [])];
    }
    // ── واليوزرُ يُقرأ بصفّه: اسمُه ومشروعُه ومركبتُه وحالتُه اليوم ─────────────
    const BOARD = require('../utils/b2cBoard');
    const items = (await LtUserRental.find(f).sort({ status: 1, startDate: -1, createdAt: -1 }).limit(2000)
      .populate({
        path: 'ltEmployee', select: 'name idNumber projectAr cityAr vehiclePlate opStatus workStatusAr isActive employee',
        populate: { path: 'employee', select: 'employmentStatus' },
      }).lean())
      .map((r) => {
        const l = r.ltEmployee && typeof r.ltEmployee === 'object' ? r.ltEmployee : null;
        return {
          ...r,
          ltEmployee: l ? String(l._id) : null,
          rep: l ? {
            _id: String(l._id), name: l.name, idNumber: l.idNumber, projectAr: l.projectAr || '', cityAr: l.cityAr || '',
            vehiclePlate: l.vehiclePlate || '', status: l.isActive === false ? 'خارج السجل' : BOARD.shownStatus(l),
          } : null,
        };
      });
    const all = await LtUserRental.find({ status: 'active' }).select('projectAr').lean();
    const byProject = {};
    for (const r of all) byProject[r.projectAr] = (byProject[r.projectAr] || 0) + 1;
    res.json({
      items,
      counts: { active: all.length, byProject },
      canDelete: DELETE_ROLES.includes(req.user?.role),
      today: todayKey(),
    });
  } catch (e) {
    console.error('ltUserRental list:', e);
    res.status(500).json({ message: 'تعذّر تحميل اليوزرات' });
  }
};

// POST /user-rentals — التاريخُ اليوم، لا يُرسَل.
exports.create = async (req, res) => {
  try {
    const d = pick(req.body || {});
    const link = await linkOf(req.body || {});
    if (!link.ok) return res.status(400).json({ message: link.message, fields: { ltEmployee: link.message } });
    if (link.lt) {
      // مشروعُه ورقمُ هويّته واسمُ حسابه من صفّه — لا يُكتبان مرّتين.
      Object.assign(d, { ...link.set, projectAr: S(link.lt.projectAr) || d.projectAr });
      if (!d.idNumber) d.idNumber = S(link.lt.idNumber);
      if (!d.userAccount) d.userAccount = S(link.lt.name);
    }
    const bad = invalid(d, true);
    if (bad) return res.status(400).json({ message: Object.values(bad)[0], fields: bad });
    const doc = await LtUserRental.create({ ...d, startDate: todayKey(), status: 'active', createdBy: req.user._id, createdByName: who(req.user) });
    if (doc.ltEmployee) await require('../utils/ltRental').syncEmployee(doc, { user: req.user });
    changed();
    await logAudit({ user: req.user, action: 'lt_user_rental_create', entity: 'LtUserRental', entityId: doc._id,
      changes: { details: `تأجير يوزر على ${doc.projectAr} — ${doc.renterType === 'company' ? 'شركة' : 'شخص'}: ${doc.renterName} (${doc.idNumber})` }, ipAddress: req.ip });
    res.status(201).json({ item: doc });
  } catch (e) {
    console.error('ltUserRental create:', e);
    res.status(500).json({ message: 'تعذّر تسجيل التأجير' });
  }
};

// PUT /user-rentals/:id — تصحيحُ البيانات (والتاريخُ لا يُعدَّل).
exports.update = async (req, res) => {
  try {
    const doc = await LtUserRental.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'التأجير غير موجود' });
    const d = pick(req.body || {});
    const link = await linkOf(req.body || {}, doc._id);
    if (!link.ok) return res.status(400).json({ message: link.message, fields: { ltEmployee: link.message } });
    if (link.set) Object.assign(d, link.set);
    // المربوطُ مشروعُه مشروعُ صفّه: يُنقل بـ«نقل مشروع» فيتبعه التأجير، لا العكس.
    const linkedTo = link.set ? link.set.ltEmployee : doc.ltEmployee;
    if (linkedTo && d.projectAr !== undefined && !link.lt) delete d.projectAr;
    if (link.lt) d.projectAr = S(link.lt.projectAr) || doc.projectAr;
    const bad = invalid(d, false);
    if (bad) return res.status(400).json({ message: Object.values(bad)[0], fields: bad });
    const previousLt = doc.ltEmployee ? String(doc.ltEmployee) : null;
    Object.assign(doc, d);
    await doc.save();
    if (previousLt || doc.ltEmployee) await require('../utils/ltRental').syncEmployee(doc, { previousLt, user: req.user });
    changed();
    await logAudit({ user: req.user, action: 'lt_user_rental_update', entity: 'LtUserRental', entityId: doc._id,
      changes: { details: `تعديل تأجير يوزر — ${doc.renterName} (${doc.projectAr})` }, ipAddress: req.ip });
    res.json({ item: doc });
  } catch (e) { res.status(500).json({ message: 'تعذّر تعديل التأجير' }); }
};

// POST /user-rentals/:id/end — انتهى التأجير (يبقى في السجلّ).
exports.end = async (req, res) => {
  try {
    const doc = await LtUserRental.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'التأجير غير موجود' });
    if (doc.status === 'ended') return res.status(400).json({ message: 'التأجير منتهٍ أصلًا' });
    Object.assign(doc, { status: 'ended', endDate: todayKey(), endedByName: who(req.user) });
    await doc.save();
    // استُرجع اليوزر: يعود نوعُ عقده إلى ما كان قبل التأجير، وتنقص الكروتُ فورًا.
    if (doc.ltEmployee) await require('../utils/ltRental').syncEmployee(doc, { user: req.user });
    changed();
    await logAudit({ user: req.user, action: 'lt_user_rental_end', entity: 'LtUserRental', entityId: doc._id,
      changes: { details: `إنهاء تأجير يوزر — ${doc.renterName} (${doc.projectAr})` }, ipAddress: req.ip });
    res.json({ item: doc });
  } catch (e) { res.status(500).json({ message: 'تعذّر إنهاء التأجير' }); }
};

// DELETE /user-rentals/:id — لتصحيح إدخالٍ خاطئ، لمدير القطاع ونائبه ومدير النظام.
exports.remove = async (req, res) => {
  try {
    if (!DELETE_ROLES.includes(req.user?.role)) return res.status(403).json({ message: 'الحذف لمدير القطاع ونائبه ومدير النظام' });
    const doc = await LtUserRental.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'التأجير غير موجود' });
    if (doc.ltEmployee) await require('../utils/ltRental').syncEmployee(doc, { removed: true, user: req.user });
    changed();
    await logAudit({ user: req.user, action: 'lt_user_rental_delete', entity: 'LtUserRental', entityId: doc._id,
      changes: { details: `حذف تأجير يوزر — ${doc.renterName} (${doc.projectAr})`, before: doc }, ipAddress: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر الحذف' }); }
};

/**
 * اليوزراتُ المؤجَّرة الآن **غيرُ المربوطة بصفّ** لكلّ مشروع — تُضاف في اللوحة
 * فوق الصفوف. والمربوطُ يُعَدّ بصفّه (utils/ltRental.isRented) فلا يُعَدّ مرّتين.
 */
exports.activeByProject = async () => {
  const rows = await LtUserRental.find({ status: 'active', ltEmployee: null }).select('projectAr').lean();
  const out = {};
  for (const r of rows) out[r.projectAr] = (out[r.projectAr] || 0) + 1;
  return out;
};
