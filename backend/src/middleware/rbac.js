const { canonicalRole } = require('../config/roles');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ── الاسم القديم يُقرأ باسمه الجديد ─────────────────────────────────────────
 *
 * الأدوار تُعاد تسميتها — `b2c_head` صار `b2c_manager` — وخريطةُ الأسماء
 * القديمة موجودةٌ في config/roles.js منذ ذلك الحين، ولم تكن تُستعمل في مكان.
 *
 * فحارسٌ كُتب بالاسم القديم لا يفتح لأحد: يبدو أوسعَ ممّا هو، ويُقرأ كأنّ الدور
 * يصل وهو لا يصل. وحسابٌ بقي في القاعدة على الاسم القديم يُمنع من بابٍ هو
 * صاحبُه. والحالتان صامتتان: لا خطأ في السجلّ، ولا شيء في الشاشة إلّا «لا
 * تملك صلاحية».
 *
 * فيُطبَّع الطرفان قبل المقارنة: قائمةُ الحارس ودورُ الحساب. وبهذا لا يكسر
 * تغييرُ اسمٍ بابًا نسي أحدُهم تحديثَه.
 */
const authorize = (...roles) => {
  const allowed = new Set(roles.map(canonicalRole));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (allowed.has(canonicalRole(req.user.role))) {
      return next();
    }

    // Dynamic permissions: sectionGate() stamps req.sectionAccess when the
    // super_admin has granted this role access to the section this route lives
    // in. Honour it so a granted role passes even when it isn't in the route's
    // legacy role list. 'view' grants reads only; 'edit' grants everything.
    const access = req.sectionAccess;
    if (access === 'edit') return next();
    if (access === 'view' && READ_METHODS.has(req.method)) return next();

    return res.status(403).json({ message: 'Insufficient permissions' });
  };
};

module.exports = authorize;
