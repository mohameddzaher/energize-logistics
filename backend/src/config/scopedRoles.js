/**
 * الأدوارُ المحصورة — حسابٌ خارجيٌّ يرى شاشةً واحدةً من نظامنا ولا يرى غيرَها.
 *
 * ── لماذا ليس حسابَ «شريك» في البوابة ────────────────────────────────────────
 * بوابةُ الشركاء (`role: 'client'`) لعميلٍ أو مورّدٍ مسجَّلٍ في أحد سجلّاتنا،
 * وتبني صفحاتِها ممّا له عندنا من شحناتٍ وفواتيرَ ومعاملات. وMedia Go ليست
 * عميلًا ولا مورّدًا في أيّ سجلّ: شريكٌ يركّب شاشاتٍ على دبّاباتنا، وعملُه
 * معنا شيءٌ واحد — بلاغاتُ أعطال الشاشات التي نرفعها له. فشاشتُه شاشةٌ من
 * قسم الأفراد نفسِها، يراها هو ونراها نحن، لا بوابةٌ تُبنى له.
 *
 * ── والحصرُ في الخادم لا في القائمة ─────────────────────────────────────────
 * إخفاءُ الروابط لا يحرس شيئًا: نقاطٌ كثيرةٌ في النظام تكتفي بـ`authenticate`
 * (الإشعارات، القوائم المرجعيّة، مهامُّ الأقسام، التقارير…) فيصلها أيُّ حسابٍ
 * مسجَّل. فالحسابُ المحصورُ يمرّ بـ`middleware/scopedRoleFence` قبل كلّ شيء،
 * وما ليس في `api` أدناه يُردّ ٤٠٣ — قائمةُ سماحٍ لا قائمةُ منع، فنقطةٌ تُضاف
 * غدًا في أيّ قسمٍ مغلقةٌ عليه من يومها.
 *
 * ومعه: صلاحيّاتُ الأقسام كلُّها «لا شيء»، وصفحاتُه هي `pages` وحدَها، وبيتُه
 * `home` — فلا يُنتظَر من مصفوفة الصلاحيّات أن تتذكّره. ولا يصله البثُّ العامّ
 * للأقسام (راجع websocket/socketManager): يصله ما يُرسَل إلى دوره فحسب.
 *
 * والمفتاحُ لا ينتهي بـ`_manager` عمدًا وإن كان لقبُه «مدير حساب»: تلك اللاحقةُ
 * تُجلِس صاحبَها في اجتماعات الإدارة (راجع config/roles.js، القاعدة ٢).
 *
 * الملفُّ لا يستورد شيئًا من config — يُقرأ من roles وsections وpermissions.
 */
const MEDIAGO_ROLE = 'mediago_account';
const MEDIAGO_PAGE = '/system/b2c/mediago-complaints';
const MEDIAGO_API = '/api/b2c/mediago-complaints';

const SCOPED_ROLES = {
  [MEDIAGO_ROLE]: {
    home: MEDIAGO_PAGE,
    pages: [MEDIAGO_PAGE],
    // البادئاتُ المسموحة. الدخولُ والخروجُ وملفُّه وكلمةُ مروره (`/api/auth`)،
    // وجرسُ الإشعارات (لا يرى فيه إلّا ما أُرسل إليه باسمه — notificationController)،
    // وشاشتُه. والمرفقاتُ تُخدَم قبل هذا الحارس (`/api/uploads`، أسماءٌ عشوائيّة).
    api: ['/api/auth', '/api/notifications', MEDIAGO_API, '/api/health'],
  },
};

const isScopedRole = (role) => Object.prototype.hasOwnProperty.call(SCOPED_ROLES, String(role || ''));
const scopeOf = (role) => (isScopedRole(role) ? SCOPED_ROLES[role] : null);

/** كلُّ حسابٍ من خارج الشركة: الشريكُ في البوابة والأدوارُ المحصورة. */
const EXTERNAL_ROLES = ['client', ...Object.keys(SCOPED_ROLES)];
const isExternalRole = (role) => EXTERNAL_ROLES.includes(String(role || ''));

module.exports = {
  MEDIAGO_ROLE, MEDIAGO_PAGE, MEDIAGO_API,
  SCOPED_ROLES, isScopedRole, scopeOf, EXTERNAL_ROLES, isExternalRole,
};
