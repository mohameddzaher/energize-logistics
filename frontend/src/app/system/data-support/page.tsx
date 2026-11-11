'use client';
/**
 * Data & Decision Support home: the headline figures of every section analysis (sliced by the server from the same
 * payloads as the analysis pages, so the two never differ), then the data-entry screens the team works in.
 * A work screen is listed only if the user's page permissions open it.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { BarChart3, ChevronLeft, ChevronRight, Radio, RefreshCw, PenSquare } from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import { PeriodBar, usePeriod } from '@/components/finance/PeriodBar';
import { fmtFin } from '@/lib/financeDept';
import { canAccessPage, canAccessSection, isManagedSection } from '@/lib/sections';
import { DS_SECTIONS, DS_WORK_SCREENS, type DsCard } from '@/lib/dataSupport';

interface Overview { period: { from: string; to: string }; sections: { key: string; ar: string; en: string; ok: boolean; cards: DsCard[] }[] }
const TONE: Record<string, string> = { good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-600', neutral: 'text-slate-900' };

// Section of each work screen, for the section check (the page check alone passes a page the section closes).
const SCREEN_SECTION: Record<string, string> = {
  '/system/shipment-orders': 'Shipment Orders', '/system/fleet': 'Fleet Management',
  '/system/operations': 'Operations', '/system/vendors-mgmt': 'Vendors Management',
};
const sectionOfScreen = (href: string) => Object.entries(SCREEN_SECTION).filter(([k]) => href === k || href.startsWith(`${k}/`)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];

export default function DataSupportHome() {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const period = usePeriod();
  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const res = await api.get<Overview>(`/api/data-support/overview?from=${period.range.from}&to=${period.range.to}`);
      if (guard.isCurrent(mine)) setD(res);
    } catch { /* keep the last figures */ }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [period.range.from, period.range.to, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('executive:changed', useCallback(() => load(), [load]));

  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  const screens = DS_WORK_SCREENS.filter((s) => {
    if (!canAccessPage(user?.pageAccess, s.href)) return false;
    const sec = sectionOfScreen(s.href);
    return !sec || !isManagedSection(sec) || canAccessSection(user?.permissions, sec);
  });

  if (loading && !d) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'} data-dash>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><BarChart3 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{ar ? 'إدارة البيانات ودعم القرار' : 'Data & Decision Support'}</h1>
            <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
              {ar ? 'تحليلٌ لكلّ قسمٍ من بيانات النظام نفسها' : 'An analysis of every section, straight from system data'}
              <span className="inline-flex items-center gap-1 ms-2 text-emerald-600"><Radio className="w-3 h-3" />{ar ? 'مباشر' : 'Live'}</span>
            </p>
          </div>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      <PeriodBar period={period} ar={ar} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {DS_SECTIONS.map((s) => {
          const row = d?.sections.find((x) => x.key === s.key);
          return (
            <Link key={s.key} href={s.href} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f37121]/60 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-extrabold text-slate-900 text-[15px]">{ar ? s.ar : s.en}</h2>
                <Chevron className="w-4 h-4 text-slate-300 group-hover:text-[#f37121]" />
              </div>
              {row && !row.ok && <p className="text-[12px] text-red-600">{ar ? 'تعذّر تحميل هذا القسم' : 'Could not load'}</p>}
              <div className="space-y-1.5">
                {(row?.cards || []).map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] text-slate-500">{ar ? c.ar : c.en}</span>
                    <span className={`font-extrabold tabular-nums text-[14px] ${Number(c.value) < 0 ? 'text-red-600' : TONE[c.tone || 'neutral']}`}>{fmtFin(c.value, c.format, ar)}</span>
                  </div>
                ))}
              </div>
            </Link>
          );
        })}
      </div>

      {!!screens.length && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-extrabold text-slate-900 text-[15px] mb-3 flex items-center gap-2"><PenSquare className="w-4 h-4 text-[#f37121]" />{ar ? 'شاشات إدخال البيانات' : 'Data-entry screens'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
            {screens.map((s) => (
              <Link key={s.href} href={s.href} className="rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:border-[#f37121]/60 hover:text-[#f37121]">
                {ar ? s.ar : s.en}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
