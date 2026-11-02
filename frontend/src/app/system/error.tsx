'use client';
/** Screen error boundary, instead of the uninformative Application error. The app had no error boundary, so any exception in any screen dropped the page to Next's generic message, with no error name or location and no way back except a manual reload. Most were not code defects: JavaScript files are named by a content hash, so when a new release is deployed the old hashes disappear from hosting while a user's open tab still points to them; requesting a not-yet-loaded chunk returns 404, a `ChunkLoadError`. It happens in varied sections and does not repeat on retry, since reloading fetches the new hashes, and frequent deploys in one day multiply it. So it is handled with one silent reload, once only, otherwise the page would loop if the defect were real. Anything else is shown by name with a way back. */
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';
import { reloadIfNewer } from '@/lib/appVersion';

const RELOAD_KEY = 'chunk-reload-at';

const isStaleChunk = (e: Error & { digest?: string }) => {
  const s = `${e?.name || ''} ${e?.message || ''}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(s);
};

export default function SystemError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [stale] = useState(() => isStaleChunk(error));

  useEffect(() => {
    if (!stale) return;
    // At most once per minute: if it repeats the defect is not a deploy, so it is shown, not hidden.
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* No storage. */ }
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* Harmless. */ }
    window.location.reload();
  }, [stale]);

  // A defect in an old version is fixed by refreshing. A tab opened before the fix was deployed keeps running the old code (its files were not deleted, so no ChunkLoadError). If the deployed version is newer, the page refreshes once and the fix arrives without anyone being asked.
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (stale) return;
    reloadIfNewer().then((r) => { if (r) setUpdating(true); });
  }, [stale]);

  // The server is notified so what really happens to people is known, without waiting or blocking.
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
    } catch { /* Reporting never crashes the screen. */ }
  }, [error, stale]);

  if (stale || updating) {
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
        <button type="button" onClick={() => { window.location.href = '/system'; }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" />الرئيسية
        </button>
      </div>
    </div>
  );
}
