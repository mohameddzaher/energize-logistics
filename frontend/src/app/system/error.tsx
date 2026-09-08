'use client';
/**
 * حارسُ أخطاء الشاشات — بدل «Application error» التي لا تقول شيئًا.
 *
 * ── ولماذا كانت الصفحةُ تموت ────────────────────────────────────────────
 * لم يكن في التطبيق حارسُ أخطاءٍ أصلًا، فأيُّ استثناءٍ في أيّ شاشةٍ يُسقط
 * الصفحةَ إلى رسالةِ Next العامّة: «حدث استثناءٌ في المتصفّح — انظر الطرفيّة».
 * لا اسمَ للخطأ ولا موضع، ولا سبيلَ للعودة إلا إعادةُ التحميل باليد.
 *
 * ── وأكثرُها لم يكن عطبًا في الشيفرة ─────────────────────────────────────
 * ملفّاتُ الجافاسكربت مُوسَّمةٌ ببصمةِ محتواها (`1015-3027217d…js`). فحين
 * يُنشَر تحديثٌ جديد تختفي بصماتُ القديم من الاستضافة — والتبويبةُ المفتوحةُ
 * عند المستخدم ما زالت تشير إليها. فإن طلبت جزءًا لم يكن قد حُمّل بعد جاءها
 * ٤٠٤، وهو `ChunkLoadError`.
 *
 * وهذا يفسّر ما وُصف بالحرف: يقع في أقسامٍ شتّى، ولا يتكرّر إن أُعيدت
 * المحاولة — لأنّ إعادةَ التحميل تجلب البصماتِ الجديدة. وكثرةُ النشر في يومٍ
 * واحدٍ تكثّره.
 *
 * فمثلُ هذا يُعالَج بإعادة تحميلٍ واحدةٍ صامتة — مرّةً لا أكثر، وإلّا دارت
 * الصفحةُ في حلقةٍ إن كان العطبُ حقيقيًّا. وما سواه يُعرَض باسمه مع طريقٍ
 * للعودة.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';

const RELOAD_KEY = 'chunk-reload-at';

const isStaleChunk = (e: Error & { digest?: string }) => {
  const s = `${e?.name || ''} ${e?.message || ''}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(s);
};

export default function SystemError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [stale] = useState(() => isStaleChunk(error));

  useEffect(() => {
    if (!stale) return;
    // مرّةً واحدةً كلَّ دقيقة: لو تكرّر فالعطبُ ليس نشرًا، فيُعرَض ولا يُخفى.
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* لا تخزين */ }
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* لا يضرّ */ }
    window.location.reload();
  }, [stale]);

  // ويُبلَّغ الخادمُ ليُعرَف ما يقع فعلًا عند الناس — بلا انتظارٍ ولا تعطيل.
  useEffect(() => {
    if (stale) return;
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${base}/api/client-errors`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || 'unknown',
          name: error?.name || '',
          digest: error?.digest || '',
          stack: String(error?.stack || '').slice(0, 4000),
          path: typeof window !== 'undefined' ? window.location.pathname : '',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {});
    } catch { /* التبليغُ لا يُسقط الشاشة */ }
  }, [error, stale]);

  if (stale) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center" dir="rtl">
        <RefreshCw className="w-8 h-8 text-[#f37121] animate-spin" />
        <p className="mt-3 text-sm text-slate-600">جارٍ تحديث الصفحة بعد نشر إصدار جديد…</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm" dir="rtl">
      <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
      <p className="mt-3 text-base font-bold text-slate-900">حدث خطأ في هذه الشاشة</p>
      <p className="mt-1.5 text-[13px] text-slate-500 break-words">{error?.message || 'خطأ غير معروف'}</p>
      {error?.digest && <p className="mt-1 text-[11px] text-slate-400">رمز الخطأ: {error.digest}</p>}
      <p className="mt-3 text-[12px] text-slate-400">أُبلغ الفريق التقني تلقائيًا.</p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button type="button" onClick={reset}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium">
          <RefreshCw className="w-4 h-4" />إعادة المحاولة
        </button>
        <button type="button" onClick={() => { window.location.href = '/system/dashboard'; }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" />الرئيسية
        </button>
      </div>
    </div>
  );
}
