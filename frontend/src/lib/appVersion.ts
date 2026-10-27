/**
 * ── هل الصفحةُ المفتوحةُ أقدمُ من المنشور؟ (٢٠٢٦/١٠/٢٧) ──────────────────────
 * بعد كلّ نشرٍ تبقى التبويباتُ المفتوحةُ على الشيفرة القديمة، لأنّ ملفّاتها
 * القديمة تبقى على الخادم فلا يقع ChunkLoadError يُعيد تحميلَها. فإصلاحٌ نُشر
 * لا يصل مَن فتح الصفحةَ قبله: ياسر وزملاؤه في التحصيل رأوا «حدث خطأ» بعد
 * نشر إصلاحه، من ملفٍّ قديم.
 *
 * فالحزمةُ تحمل رقمَها (next.config → NEXT_PUBLIC_BUILD_ID)، والخادمُ يقول
 * رقمَ المنشور (`/app-version`). والفرقُ بينهما يعني: حدِّث.
 */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID || '';

export async function isOutdated(): Promise<boolean> {
  if (!MINE || typeof window === 'undefined') return false;
  try {
    const r = await fetch('/app-version', { cache: 'no-store' });
    if (!r.ok) return false;
    const { id } = await r.json();
    return !!id && id !== MINE;
  } catch { return false; }
}

const RELOAD_KEY = 'version-reload-at';
/** إعادةُ تحميلٍ واحدةٌ في الدقيقة على الأكثر — فلا تدور الصفحةُ في حلقة. */
export function reloadOnce(): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* لا تخزين */ }
  if (Date.now() - last < 60000) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* لا يضرّ */ }
  window.location.reload();
  return true;
}
