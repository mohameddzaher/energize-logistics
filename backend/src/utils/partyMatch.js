/**
 * هل هذا العميلُ حسابٌ قائمٌ باسمٍ آخر؟ — قبل أن يُعطى كودًا جديدًا.
 *
 * أسماءُ التشغيل مختصرة («PV Hardware Middle east factory») وأسماءُ الدفتر
 * رسميّة («PV Hardware Middle East Factory Co., Ltd» بكود 11040037). وكودٌ
 * جديدٌ للمختصَر يقسم مديونيّةَ عميلٍ واحدٍ على حسابين. فيُقاس التشابهُ بالقاعدة
 * نفسِها التي ربط بها استيرادُ الدفتر (scripts/importCollectionsWorkbook):
 * كلماتٌ مميِّزة، وتقاطعٌ على اتّحاد — ويُزاد عليها «الاحتواء»: كلُّ كلمات
 * الاسم المختصر في اسم الحساب.
 */
const STOP = new Set(['شركه', 'شركة', 'مؤسسه', 'مؤسسة', 'موسسه', 'مصنع', 'مكتب', 'المحدوده', 'المحدودة',
  'شخص', 'واحد', 'التجاريه', 'التجارية', 'للخدمات', 'الخدمات', 'اللوجستيه', 'اللوجستية',
  'للنقليات', 'النقليات', 'للتجاره', 'للتجارة', 'co', 'ltd', 'company', 'est', 'for', 'and', 'the']);
const AUTO_LINK = 0.85;
const REVIEW_FLOOR = 0.30;

function toks(s) {
  const { fold } = require('../models/CollectionsParty');
  return new Set(fold(s).replace(/[.,()،\-/]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i += 1; const u = a.size + b.size - i; return u ? i / u : 0; };
const contains = (small, big) => small.size > 0 && [...small].every((x) => big.has(x));

/**
 * @returns {{ level: 'auto'|'review'|'none', best?: object, score: number }}
 *   auto   — حسابٌ واحدٌ لا لبسَ فيه: يُربط به.
 *   review — شبيهٌ يُعرَض على مدير التحصيل ولا يُمنح كودٌ حتّى يقرّر.
 *   none   — لا شبيه: عميلٌ جديدٌ حقًّا.
 */
function matchAccount(name, accounts) {
  const t = toks(name);
  const scored = accounts.map((a) => {
    const at = a._t || (a._t = toks(a.name));
    const j = jac(t, at);
    const c = contains(t, at) || contains(at, t);
    return { a, score: c ? Math.max(j, 0.9) : j, jac: j, contained: c };
  }).filter((x) => x.score >= REVIEW_FLOOR).sort((x, y) => y.score - x.score);
  if (!scored.length) return { level: 'none', score: 0 };
  const [top, second] = scored;
  // الربطُ التلقائيُّ بالتطابق وحدَه (تقاطعٌ ≥ ٠٫٨٥) ولا منافس — قاعدةُ استيراد
  // الدفتر نفسُها. أمّا الاحتواءُ فيُعرَض ولا يُربط: «الشركه الوطنيه» محتواةٌ في
  // «الشركه الوطنيه لمنتجات الكبريت» ولا يعني ذلك أنّها هي.
  const unique = !second || second.score < top.score - 0.1;
  const strong = top.jac >= AUTO_LINK && unique;
  return { level: strong ? 'auto' : 'review', best: top.a, score: top.score, runnerUp: second?.a };
}

module.exports = { matchAccount, toks, jac, AUTO_LINK, REVIEW_FLOOR };
