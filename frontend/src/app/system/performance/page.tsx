'use client';
// Performance — the central KPI evaluation board.
//
// The board itself lives in <TeamBoard/> so every section can mount its own
// copy at /system/<section>/kpis. This page is the Performance section's own
// entry point, and the only one carrying the cross-department and
// configuration links.
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Settings as SettingsIcon, Building2 } from 'lucide-react';
import TeamBoard from '@/components/performance/TeamBoard';
import { isPerfFull, canConfigurePerf } from '@/lib/performance';

export default function PerformancePage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return (
    <TeamBoard showScopeToggle>
      {isPerfFull(user?.role) && (
        <Link href="/system/performance/overview" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <Building2 className="w-4 h-4" /> {ar ? 'كل الأقسام' : 'All departments'}
        </Link>
      )}
      {canConfigurePerf(user?.role) && (
        <Link href="/system/performance/settings" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm">
          <SettingsIcon className="w-4 h-4" /> {ar ? 'إعداد المؤشرات' : 'Configure'}
        </Link>
      )}
    </TeamBoard>
  );
}
