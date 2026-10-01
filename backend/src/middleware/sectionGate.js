// Per-section authorization gate. Mounted on a section's API prefixes in
// server.js: app.use('/api/hr', sectionGate('HR'), hrRoutes).
//
// Behaviour (see config/sections.js for the full model):
//   • super_admin            → always allowed (stamps edit).
//   • no saved override      → next() (legacy authorize() lists decide — no
//                              behaviour change, no lockout risk).
//   • override 'none'        → 403 for everything.
//   • override 'view'        → GET/HEAD allowed, writes 403.
//   • override 'view'/'edit' → stamps req.sectionAccess so authorize() can grant
//                              a role that isn't in a route's legacy list.
// Resolver errors fail OPEN (fall through to legacy authorize) to avoid locking
// users out on a transient DB issue.
const { getOverride } = require('../utils/permissions');
const { getSection, defaultAccess } = require('../config/sections');
const { FULL_ACCESS_ROLES } = require('../config/constants');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// HR self-service paths (relative to the /api/hr mount) are used by every logged
// in user for their own profile/leaves/requests and by managers acting on their
// team. They must stay open even when back-office HR access is removed.
const hrSelfServiceExempt = (req) => {
  const p = req.path || '';
  if (p.startsWith('/me') || p.startsWith('/team')) return true;
  if (req.method === 'GET' && p === '/leave-types') return true;
  // صندوقُ موافقات الإجازات وعدّادُه، والإجازةُ الواحدة (لملفّ PDF): المتحكّمُ
  // يبني الاستعلامَ من محطّات القارئ ويتحقّق من صاحب الطلب. كانت خارج هذه
  // القائمة، فمديرُ قسمٍ حُفظ له HR «لا شيء» لم يرَ طلبات فريقه أصلًا.
  if (req.method === 'GET' && /^\/leaves\/inbox(\/count)?$/.test(p)) return true;
  if (req.method === 'GET' && /^\/leaves\/[0-9a-f]{24}$/i.test(p)) return true;
  if (/^\/leaves\/[^/]+\/decision$/.test(p)) return true;
  if (/^\/requests\/[^/]+\/reply$/.test(p)) return true;
  if (req.method === 'GET' && /^\/employees\/[^/]+$/.test(p)) return true;
  return false;
};

const sectionGate = (sectionKey) => {
  const section = getSection(sectionKey);
  const exempt = section && section.exemptSelfService ? hrSelfServiceExempt : null;
  const guard = async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Authentication required' });
      if (FULL_ACCESS_ROLES.includes(req.user.role)) { req.sectionAccess = 'edit'; return next(); }
      // ── والاستثناءُ يرفع المنعَ، ولا يمنع الختم ─────────────────────────
      // هذه المساراتُ مُستثناةٌ ليقرأ كلُّ موظّفٍ ملفَّه وإجازاتَه وإن لم يكن من
      // الموارد البشريّة. وكان الاستثناءُ يُخرِج الطلبَ من الحارس كلِّه بلا ختم،
      // فيصل المتحكِّمَ بلا `sectionAccess` — والمتحكِّمُ يقرأ الختمَ ليعرف مَن
      // مُنح القسمَ من مصفوفة الصلاحيّات. فمن كانت صلاحيّتُه بالمنح لا بدوره
      // (مدير مالي مُنح «الموارد البشرية: تعديل») يُقرأ غريبًا عن القسم: القائمةُ
      // تفتح له والبحثُ يجد الموظّف، ثمّ يضغط عليه فيُقال «لا توجد بيانات».
      // وقع ذلك على البرودكشن: `GET /employees` ٢٠٠ و`GET /employees/:id` ٤٠٣
      // للدور نفسِه في اللحظة نفسِها.
      //
      // فالمنحُ يُختَم إن وُجد، والمنعُ لا يقع أبدًا على هذه المسارات.
      if (exempt && exempt(req)) {
        try {
          const g = await getOverride(req.user.role, sectionKey);
          const a = g == null ? defaultAccess(req.user.role, sectionKey) : g;
          if (a === 'view' || a === 'edit') req.sectionAccess = a;
        } catch (e) { /* الاستثناءُ يمضي بلا ختم */ }
        return next();
      }

      let access = await getOverride(req.user.role, sectionKey); // 'none'|'view'|'edit'|null
      if (access == null) {
        // مفيش override محفوظ → نستعمل الوصول الافتراضي للقسم. ده اللي بيخلّي
        // «مدير القسم وموظفوه ليهم قسمهم» (config/roles.js) تشتغل فعلاً على الـ
        // API، مش تفضل تزيّن الشريط الجانبي بس: من غيره كان الدور الجديد يفتح
        // القسم في القائمة وياخد 403 من كل endpoint جواه.
        const fallback = defaultAccess(req.user.role, sectionKey);
        // **زيادة بس، مش تضييق**: لو الافتراضي 'none' ما بنرفضش هنا — سايبين
        // قوائم authorize القديمة تقرّر زي ما كانت. كده مفيش حد بيخسر وصول
        // كان عنده.
        if (fallback === 'none') return next();
        access = fallback;
      }

      if (access === 'none') {
        return res.status(403).json({ message: 'No access to this section', code: 'SECTION_FORBIDDEN' });
      }
      if (access === 'view' && !READ_METHODS.has(req.method)) {
        return res.status(403).json({ message: 'Read-only access to this section', code: 'SECTION_READ_ONLY' });
      }
      req.sectionAccess = access; // 'view' or 'edit'
      next();
    } catch (e) {
      next(); // fail-open
    }
  };
  // الحارسُ يقول عن نفسِه — يقرؤه مولّدُ التوثيق من الراوتر. راجع `services/apiDocs`.
  guard.__section = (section && section.key) || sectionKey;
  return guard;
};

/**
 * ── يمنح ولا يمنع ───────────────────────────────────────────────────────────
 *
 * بعضُ السجلّات يكتب فيها أكثرُ من قسم: «الموردون» يكتبها التشغيلُ والمشتريات،
 * و«السائقون» يكتبها التشغيل. فلا تُحرَس بقسمٍ واحد — حراستُها بقسم التشغيل
 * تمنع المشترياتِ من عملها اليوميّ.
 *
 * وفي الوقت نفسِه، الدورُ المصنوعُ الممنوحُ «تعديلَ التشغيل» كان يُردّ عنها:
 * `authorize` يقرأ قائمةَ أدوارٍ لا اسمَ له فيها، و`req.sectionAccess` لا
 * يُختَم لأنّ المسارَ بلا حارس. فالنتيجةُ أسوأُ ما يكون: الزرُّ يظهر والحفظُ
 * يُرفَض.
 *
 * فهذا وسيطٌ يختم الصلاحيّةَ ولا يرفض أحدًا: من مُنح «تعديلًا» في أحد الأقسام
 * المذكورة مرّ، ومن لا فقائمةُ `authorize` تقرّر كما كانت. لا أحدَ يخسر وصولًا،
 * ومن مُنح يصل.
 */
const stampSection = (...sectionKeys) => async (req, res, next) => {
  try {
    if (!req.user) return next();
    if (FULL_ACCESS_ROLES.includes(req.user.role)) { req.sectionAccess = 'edit'; return next(); }
    let best = null;
    for (const key of sectionKeys) {
      const saved = await getOverride(req.user.role, getSection(key)?.key || key);
      if (saved === 'edit') { best = 'edit'; break; }
      if (saved === 'view' && best !== 'edit') best = 'view';
    }
    if (best) req.sectionAccess = best;
    return next();
  } catch (e) {
    return next(); // الختمُ تيسيرٌ لا شرط
  }
};

module.exports = sectionGate;
module.exports.stampSection = stampSection;
