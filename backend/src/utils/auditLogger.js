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

const logAudit = async ({ user, action, entity, entityId, entityKey, changes, ipAddress }) => {
  if (SUPPRESSED) return;
  try {
    const id = isObjectId(entityId) ? entityId : undefined;
    const key = entityKey || (entityId != null && id === undefined ? String(entityId) : '');
    await AuditLog.create({
      user: user?._id || user,
      // يُلتقط الاسمُ الآن لا يُقرأ لاحقًا — راجع models/AuditLog.
      userName: user && (user.firstName || user.lastName)
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '',
      userEmail: (user && user.email) || '',
      action,
      entity,
      entityId: id,
      entityKey: key,
      changes,
      ipAddress,
    });
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = logAudit;
