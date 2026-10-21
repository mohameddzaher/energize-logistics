'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { IdCard, ChevronLeft, ChevronRight } from 'lucide-react';
import FinanceDeptView from '@/components/finance/FinanceDeptView';

/**
 * ماليات الموارد البشرية — وفوقها مدخلٌ ظاهرٌ إلى «الإقامات ورخص العمل»: رسومٌ
 * مستحقّةٌ بتاريخ، وطلباتٌ تنتظر جوابًا. أرقامُه حيّةٌ (`hr-finance:changed`).
 */
export default function Page() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [s, setS] = useState<{ unpaid: number; unpaidExpired: number; pendingRequests: number } | null>(null);
  const load = useCallback(() => {
    api.get<{ unpaid: number; unpaidExpired: number; pendingRequests: number }>('/api/finance/hr-docs/summary')
      .then(setS).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('hr-finance:changed', load);
  const Arrow = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-5">
      <Link href="/system/finance/hr/residency" dir={isRTL ? 'rtl' : 'ltr'}
        className="group flex flex-wrap items-center gap-4 rounded-2xl border border-[#f37121]/40 bg-white p-4 shadow-sm transition hover:border-[#f37121] hover:shadow-md">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f37121]/15 text-[#f37121]"><IdCard className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-900">{t('الإقامات ورخص العمل', 'Iqamas & work permits')}</p>
          <p className="text-[12.5px] text-slate-500">{t('رسوم التجديد المنتهية وما بقي عليه 20 يومًا فأقل — وطلبات الموارد البشرية إلى المالية', 'Renewal fees expired or due within 20 days — and HR requests to Finance')}</p>
        </div>
        {s && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-[12.5px] font-bold text-white">{t('غير مدفوع', 'Unpaid')} <b className="tabular-nums">{s.unpaid}</b></span>
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[12.5px] font-bold text-red-700">{t('منها منتهية', 'Of which expired')} <b className="tabular-nums">{s.unpaidExpired}</b></span>
            <span className="rounded-full bg-[#f37121] px-3 py-1 text-[12.5px] font-bold text-white">{t('طلبات قيد الانتظار', 'Pending requests')} <b className="tabular-nums">{s.pendingRequests}</b></span>
          </div>
        )}
        <Arrow className="h-5 w-5 text-slate-400 transition group-hover:text-[#f37121]" />
      </Link>
      <FinanceDeptView dept="hr" />
    </div>
  );
}
