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
const build = (roles, { strict = false } = {}) => {
  const allowed = new Set(roles.map(canonicalRole));
  const guard = (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (allowed.has(canonicalRole(req.user.role))) {
      return next();
    }

    // ── وبابٌ لا يُفتَح بمنحٍ من المصفوفة ─────────────────────────────────────
    // `authorize.strict` لا يقرأ ختمَ قسمٍ ولا تأشيرةَ صفحة: قائمتُه هي كلُّ
    // شيء. وهو لمَن يملك المصفوفةَ نفسَها — من يضبط الصلاحيّاتَ يضبط صلاحيّاتَه،
    // فلو فُتحت شاشتُه بتأشيرةٍ لمنح صاحبُها نفسَه كلَّ شيءٍ في ضغطتين. ومعها
    // محوُ البيانات: فعلٌ لا رجعةَ فيه.
    if (strict) return res.status(403).json({ message: 'Insufficient permissions' });

    // Dynamic permissions: sectionGate() stamps req.sectionAccess when the
    // super_admin has granted this role access to the section this route lives
    // in. Honour it so a granted role passes even when it isn't in the route's
    // legacy role list. 'view' grants reads only; 'edit' grants everything.
    const access = req.sectionAccess;
    if (access === 'edit') return next();
    if (access === 'view' && READ_METHODS.has(req.method)) return next();

    // ── وتأشيرةُ الصفحة تُقرأ كما يُقرأ ختمُ القسم ─────────────────────────
    // `pageGate` يختم `pageGranted` إن كانت هذه النقطةُ تملكها صفحةٌ أُشِّر
    // عليها صراحةً لهذا الدور، ولا قسمَ مُدارًا لها (هناك الحارسُ الأعلى هو
    // القسم). وشاشاتُ تلك الأقسام — المستخدمون، سجلُّ المراجعة، الفروع،
    // القوائمُ المرجعيّة، مركزُ التقارير، النظرةُ التنفيذيّة، تقييمُ الأداء —
    // لا تُمنَح بغير هذا الطريق: يحرسها سطرُ أدوارٍ مكتوبٌ في كلّ مسار لا
    // يعرف الأنواعَ المصنوعة. فكان من يُؤشَّر له عليها يفتحها ويُقال له «لا
    // تملك صلاحيّة» ولا شيءَ يقول لماذا.
    //
    // والتأشيرةُ تفتح الشاشةَ وأفعالَها، كما يفتحها القسمُ بـ«تعديل»: من يؤشّر
    // على شاشةٍ في مصفوفة الصلاحيّات يقصد أن تعمل، لا أن تُعرَض معطّلة.
    //
    // وبقي حدٌّ واحدٌ خارجَ هذا البابِ كلِّه: **مديرُ النظام لا يُصنَع ولا يُمسّ
    // حسابُه إلّا من مديرِ نظام** (راجع `guardSuperAdminRole` في
    // controllers/userController). ذاك تسليمُ النظام لا فتحُ شاشة، فلا يجوز أن
    // يكون مربّعٌ واحدٌ طريقًا إليه.
    if (req.pageGranted) return next();

    return res.status(403).json({ message: 'Insufficient permissions' });
  };
  // ── والحارسُ يقول عن نفسِه ────────────────────────────────────────────────
  // توثيقُ الـ API يُبنى من الراوتر نفسِه كي لا يبعد عنه (راجع
  // `services/apiDocs`)، والحارسُ بعد تركيبه دالّةٌ مغلقةٌ لا يُقرأ منها شيء.
  // فيُعلَّق عليها ما تحرسه — سطرٌ واحدٌ يجعل الوثيقةَ تقول الحقيقة.
  guard.__roles = [...allowed];
  if (strict) guard.__strict = true;
  return guard;
};

const authorize = (...roles) => build(roles);

/** قائمتُه وحدَها تقرّر — لا ختمَ قسمٍ ولا تأشيرةَ صفحةٍ تفتحه. */
authorize.strict = (...roles) => build(roles, { strict: true });

module.exports = authorize;
