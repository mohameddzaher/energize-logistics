/**
 * خريطةُ «أيُّ الصفحات تنادي هذه النقطة» — بها تصير صلاحيّةُ الصفحة حراسةً.
 *
 * ── المشكلةُ التي تحلّها ────────────────────────────────────────────────────
 * صلاحيّةُ الصفحة كانت تُخفي الشاشةَ ولا تمنع البيانات: مَن يعرف المسارَ يكتبه،
 * ومَن يعرف نقطةَ الـ API ينادِيها من خارج الشاشة أصلًا. والمانعُ الظاهرُ كان
 * أنّ الصفحةَ تنادي عشرَ نقاطٍ والنقطةَ تخدم خمسَ صفحات — فلا انطباق.
 *
 * والجوابُ قلبُ السؤال: لا نسأل «أيُّ نقاطٍ لهذه الصفحة؟» بل **«أيُّ صفحاتٍ
 * تنادي هذه النقطة؟»**. فإن كانت كلُّها مغلقةً على هذا الدور فالنقطةُ مغلقةٌ
 * عليه — ولا حاجةَ إلى تصديق ما يقوله المتصفّح عن الصفحة التي هو فيها، وهو ما
 * لا يُوثَق به أصلًا.
 *
 * ── قاعدةُ القرار ───────────────────────────────────────────────────────────
 *   1. تُؤخذ **أطولُ** بادئةٍ مطابقة. فمن أُغلقت له «أنواع الدفع» يُمنع من
 *      `/api/workflows/payment-types` وإن كانت «سير عمل التشغيل» مفتوحةً له —
 *      وإلّا لم يكن لإغلاق الصفحة أثر.
 *   2. يُسمَح إن كانت **أيُّ** صفحةٍ عند ذلك الطول مفتوحة.
 *   3. ويُسمَح كذلك إن كانت للدور صفحةٌ مفتوحةٌ «موسَّعة» يشملها القسم — تلك
 *      صفحةٌ لم يُقرأ نداؤها ساكنًا، والشكُّ يوسِّع ولا يضيّق.
 *   4. ونقطةٌ لا تعرفها الخريطةُ تمرّ كما كانت. لا يُغلَق بابٌ لأنّنا لم نره.
 *
 * والحارسُ **يضيّق داخل ما منحه القسم**؛ حارسُ القسم باقٍ كما هو قبله.
 */
const { shell, pages } = require('./pageApis.json');
const { SECTIONS } = require('./sections');
const { getPage } = require('./pages');

const SHELL = shell.slice().sort((a, b) => b.length - a.length);

/** نقطةٌ يناديها الإطارُ في كلّ شاشة — لا تُنسَب إلى صفحةٍ ولا تُغلَق بإغلاقها. */
const isShell = (path) => SHELL.some((p) => path === p || path.startsWith(`${p}/`));

// بادئة → الصفحاتُ التي تنادِيها، مرتّبةً من الأطول إلى الأقصر.
const index = new Map();
for (const [key, def] of Object.entries(pages)) {
  for (const api of def.apis || []) {
    if (!index.has(api)) index.set(api, new Set());
    index.get(api).add(key);
  }
}
const PREFIXES = [...index.keys()].sort((a, b) => b.length - a.length);

// الصفحاتُ الموسَّعة وأقسامُها — للقاعدة الثالثة.
const sectionPrefixes = Object.fromEntries(SECTIONS.map((s) => [s.key, s.apiPrefixes]));
const WILDCARD_PAGES = Object.entries(pages)
  .filter(([, d]) => d.wildcard)
  .map(([key]) => ({ key, prefixes: sectionPrefixes[getPage(key)?.section] || [] }));

const matches = (prefix, path) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);

/**
 * قرارُ الحارس لهذه النقطة.
 *
 * `allowed(pageKey)` تُجيب: أهذه الصفحةُ مفتوحةٌ لهذا الدور؟
 * يُعيد `null` حين لا رأيَ للخريطة (تمرّ كما كانت)، أو `{ ok, pages }`.
 */
function decide(path, allowed) {
  if (isShell(path)) return null;

  const longest = PREFIXES.find((p) => matches(p, path));
  if (!longest) return null;

  const owners = [...index.get(longest)];
  if (owners.some((k) => allowed(k))) return { ok: true, prefix: longest, pages: owners };

  // صفحةٌ موسَّعةٌ مفتوحةٌ في قسمٍ يشمل هذه النقطة: لم نقرأ نداءها، فلا نمنع.
  const wide = WILDCARD_PAGES.find((w) => allowed(w.key) && w.prefixes.some((p) => matches(p, path)));
  if (wide) return { ok: true, prefix: longest, pages: [wide.key], widened: true };

  return { ok: false, prefix: longest, pages: owners };
}

module.exports = { decide, isShell, SHELL, PREFIXES };
