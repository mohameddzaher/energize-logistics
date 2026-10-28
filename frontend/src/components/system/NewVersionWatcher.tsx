'use client';
/**
 * Notices a newer build while the tab is open: checks on returning to the tab
 * and every 5 minutes. A newer build must be seen twice (20 s apart) before the
 * bar shows, so a deploy in progress does not flicker it. The page then reloads
 * on the next navigation — once per build (lib/appVersion).
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { newerBuild, reloadOnceFor } from '@/lib/appVersion';

const CONFIRM_MS = 20000;

export default function NewVersionWatcher({ ar }: { ar: boolean }) {
  const [target, setTarget] = useState('');
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const id = await newerBuild();
      if (!alive || !id || pending) return;
      pending = setTimeout(async () => {
        pending = null;
        const again = await newerBuild();
        if (alive && again && again === id) setTarget(id);
      }, CONFIRM_MS);
    };
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); if (pending) clearTimeout(pending); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Navigation is a safe moment to load the new build (no form is lost).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (target) reloadOnceFor(target);
  }, [pathname, target]);

  if (!target) return null;
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
