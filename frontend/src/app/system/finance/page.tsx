'use client';
/**
 * الإدارة الماليّة — اللوحة.
 *
 * أهمُّ أرقام كلّ قسمٍ في بطاقةٍ تُفتح على صفحة مالياته. والأرقامُ هي نفسُ
 * بطاقات صفحة القسم (الخادمُ يقتطعها من الحمولة ذاتها)، فلا يختلف رقمُ اللوحة عن
 * رقم الصفحة. وتسمع كلَّ حركةٍ ماليّةٍ في أيّ قسم.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Landmark, ChevronLeft, ChevronRight, Radio, RefreshCw } from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import { PeriodBar, usePeriod } from '@/components/finance/FinanceDeptView';
import { FINANCE_DEPTS, fmtFin, type FinCard } from '@/lib/financeDept';

interface Overview { period: { from: string; to: string }; departments: { key: string; ar: string; en: string; ok: boolean; cards: FinCard[] }[] }
const TONE: Record<string, string> = { good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-600', neutral: 'text-slate-900' };

export default function FinanceOverviewPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const period = usePeriod();
  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const res = await api.get<Overview>(`/api/finance/overview?from=${period.range.from}&to=${period.range.to}`);
      if (guard.isCurrent(mine)) setD(res);
    } catch { /* keep */ }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [period.range.from, period.range.to, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('finance:changed', useCallback(() => load(), [load]));

  if (loading && !d) return <Spinner />;
  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><Landmark className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{ar ? 'الإدارة المالية' : 'Finance Management'}</h1>
            <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
              {ar ? 'مال كل قسم في مكان واحد — من بيانات الأقسام نفسها' : 'Every department’s money in one place — straight from the departments'}
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
        {FINANCE_DEPTS.map((dep) => {
          const row = d?.departments.find((x) => x.key === dep.key);
          return (
            <Link key={dep.key} href={dep.href}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f37121]/60 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-extrabold text-slate-900 text-[15px]">{ar ? dep.ar : dep.en}</h2>
                <Chevron className="w-4 h-4 text-slate-300 group-hover:text-[#f37121]" />
              </div>
              {row && !row.ok && <p className="text-[12px] text-red-600">{ar ? 'تعذّر تحميل هذا القسم' : 'Could not load'}</p>}
              <div className="space-y-1.5">
                {(row?.cards || []).map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] text-slate-500">{ar ? c.ar : c.en}</span>
                    <span className={`font-extrabold tabular-nums text-[14px] ${c.value < 0 ? 'text-red-600' : TONE[c.tone || 'neutral']}`}>{fmtFin(c.value, c.format, ar)}</span>
                  </div>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
