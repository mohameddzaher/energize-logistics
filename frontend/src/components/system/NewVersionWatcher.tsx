'use client';
/**
 * يراقب نشرَ نسخةٍ جديدة والتبويبةُ مفتوحة — راجع lib/appVersion.
 * عند العودة إلى التبويبة وكلَّ خمس دقائق يسأل الخادم؛ فإن كانت أحدث ظهر شريطٌ
 * صغير «نسخة جديدة — تحديث»، وتُحدَّث الصفحةُ تلقائيًّا عند أوّل انتقالٍ بين
 * الصفحات (لحظةٌ لا يضيع فيها ما يُكتب في نموذج).
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { isOutdated } from '@/lib/appVersion';

export default function NewVersionWatcher({ ar }: { ar: boolean }) {
  const [outdated, setOutdated] = useState(false);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    const check = () => { isOutdated().then((o) => { if (alive && o) setOutdated(true); }); };
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // الانتقالُ بين الصفحات لحظةٌ آمنة: يُحمَّل الجديدُ بدل القديم.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (outdated) window.location.reload();
  }, [pathname, outdated]);

  if (!outdated) return null;
  return (
    <div className="fixed bottom-4 inset-x-0 z-[60] flex justify-center pointer-events-none" dir={ar ? 'rtl' : 'ltr'}>
      <div className="pointer-events-auto flex items-center gap-3 bg-slate-900 text-white text-sm rounded-xl shadow-lg px-4 py-2.5">
        <span>{ar ? 'نُشرت نسخة جديدة من النظام' : 'A new version of the system is available'}</span>
        <button type="button" onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] font-semibold">
          <RefreshCw className="w-4 h-4" />{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
