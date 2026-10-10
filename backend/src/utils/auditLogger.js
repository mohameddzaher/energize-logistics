const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const isObjectId = (v) => !!v && mongoose.Types.ObjectId.isValid(String(v)) && String(new mongoose.Types.ObjectId(String(v))) === String(v);

/**
 * Write one audit entry. Never throws — an audit failure must not fail the
 * action being audited.
 *
 * `entityId` accepts anything the caller has: a real ObjectId goes to entityId,
 * anything else (a role name, a section key) goes to entityKey. Previously a
 * non-ObjectId hit a cast error and the entry was dropped entirely, which is how
 * every role-permission change went unrecorded.
 */
// ── سجلُّ المراجعة يُنسَب إلى إنسان ────────────────────────────────────────
// سكربتُ فحصٍ يستدعي متحكّمًا حقيقيًّا يحتاج `req.user`، فيُؤخذ أوّلُ مدير نظام
// من القاعدة — ويُقيَّد عملُ السكربت باسمه. وقد حدث: مئتان واثنان من إنشاء
// حساباتِ اختبارٍ وحذفِها نُسبت إلى موظّفةٍ لم تفتح الشاشةَ أصلًا، فقرأها
// صاحبُ الشركة في السجلّ وسأل عنها بحقّ.
//
// والسجلُّ الذي يتّهم بريئًا أسوأُ من سجلٍّ ناقص. فمتى كان النظامُ خارجَ
// الإنتاج (`AUDIT_SUPPRESS=1`، وتضعها سكربتاتُ الفحص) لم يُكتب شيء.
const SUPPRESSED = process.env.AUDIT_SUPPRESS === '1';

const logAudit = async ({
  user, action, entity, entityId, entityKey, changes, ipAddress, bySystem, details, ip,
}) => {
  if (SUPPRESSED) return;
  try {
    // الفاعلُ إمّا إنسانٌ وإمّا النظامُ صراحةً. وغيابُهما معًا خطأُ نداءٍ: يُقيَّد
    // في السجلّ التقنيّ ولا يُكتب قيدُ مراجعةٍ بلا فاعل.
    const actor = user?._id || (isObjectId(user) ? user : null);
    if (!actor && !bySystem) {
      console.error(`[audit] فعلٌ بلا فاعل: ${action} على ${entity} — لم يُقيَّد`);
      return;
    }
    /**
     * ── والاسمُ يُلتقط ولو لم يُمرَّر الكائن ────────────────────────────────
     * بعضُ النداءات تمرّر `user: req.user` وبعضُها `user: req.user._id` — وكان
     * الاسمُ يُلتقط من الأوّل وحدَه، فتُكتب قيودٌ بمرجعٍ صحيحٍ واسمٍ فارغ.
     * والسجلُّ يُقرأ بالاسم لا بالمعرّف: سُئل «مَن أنهى خدمةَ فلان؟» فأظهر
     * السجلُّ «(غير مسجَّل)» والفاعلُ مسجَّلٌ في الصفّ نفسِه.
     *
     * فمتى جاء المعرّفُ وحدَه يُقرأ اسمُه مرّةً — سؤالٌ صغيرٌ لا يقع إلّا حين
     * ينقص الاسم، ولا يُبطئ نداءً مرّر كائنَه.
     */
    let snapName = user && (user.firstName || user.lastName)
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
    let snapEmail = (user && user.email) || '';
    if (actor && !snapName) {
      try {
        const User = require('../models/User');
        const u = await User.findById(actor).select('firstName lastName email').lean();
        if (u) {
          snapName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          snapEmail = u.email || '';
        }
      } catch (e) { /* القيدُ يُكتب بمرجعه ولو تعذّر الاسم */ }
    }

    const id = isObjectId(entityId) ? entityId : undefined;
    const key = entityKey || (entityId != null && id === undefined ? String(entityId) : '');
    const entry = await AuditLog.create({
      user: actor || undefined,
      bySystem: !actor,
      // يُلتقط الاسمُ الآن لا يُقرأ لاحقًا — راجع models/AuditLog.
      userName: snapName || (actor ? '' : 'النظام'),
      userEmail: snapEmail,
      action,
      entity,
      entityId: id,
      entityKey: key,
      // ── و`details` لا تُرمى ──────────────────────────────────────────────
      // التعديلُ الجماعيّ في كشوف التشغيل يمرّر وصفَه في `details` وعنوانَه في
      // `ip` — اسمان لا يعرفهما هذا النداء، فكُتب اثنان وخمسون قيدًا بلا أيّ
      // تفصيل: «تعديل جماعي» ولا يُعرَف كم كشفًا ولا أيَّ حقل. فيُحفَظ الوصفُ
      // حيث تُقرأ التفاصيل.
      changes: changes !== undefined ? changes : (details ? { details } : undefined),
      ipAddress: ipAddress || ip,
    });
    // والفعلُ يصير خبرًا في الجرس لمن يحقّ له — راجع services/activityFeed.
    // لا يُنتظَر: الخبرُ لا يؤخّر الفعلَ ولا يُفشله.
    require('../services/activityFeed').announce(entry.toObject());
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = logAudit;
