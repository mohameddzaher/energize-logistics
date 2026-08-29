/**
 * تحديثُ العنوان بلا ملاحة.
 *
 * الشاشات تكتب فلترَها وبحثَها في العنوان كي يُرسَل الرابط ويعمل التحديث. وكانت
 * تفعل ذلك بـ`router.replace`، وهي **ملاحةٌ كاملة** في موجّه Next: تُعيد رسم
 * قطعة المسار، فتسقط الشاشة إلى حدّ `Suspense` وتظهر الشاشةُ الفارغة، ثم تعود.
 * ومع كلّ حرفٍ في خانة البحث تتكرّر الدورة — فيرى المستخدم النتيجة تظهر وتختفي
 * وتظهر، ويظنّ البحث معطوبًا.
 *
 * و`history.replaceState` يكتب العنوان نفسه بلا ملاحةٍ ولا إعادة رسم: الرابط
 * يبقى صالحًا للإرسال وللتحديث، والجدول لا يرتجف.
 *
 * (ولا يُضاف إلى سجلّ التصفّح — وهو ما كان `replace` يفعله أصلًا، فلا فرق.)
 */
export function syncUrl(path: string, params: URLSearchParams | Record<string, string | number | null | undefined>) {
  if (typeof window === 'undefined') return;
  const p = params instanceof URLSearchParams
    ? params
    : new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => [k, String(v)]),
    );
  const qs = p.toString();
  const next = `${path}${qs ? `?${qs}` : ''}`;
  if (window.location.pathname + window.location.search === next) return;
  window.history.replaceState(null, '', next);
}
