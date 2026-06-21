'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { TrendingUp, Trophy } from 'lucide-react';
import { isSalesStaff, money, pct, thisPeriod } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';

interface Dash {
  period: string; wonValue: number; wonCount: number; lostValue: number; lostCount: number;
  openValue: number; openCount: number; teamTarget: number; attainment: number; winRate: number;
  topReps: { rep: string; count: number; value: number }[];
}

export default function SalesDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [period, setPeriod] = useState(thisPeriod());
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>(`/api/sales/dashboard?period=${period}`)); } catch { /* */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));
  useSocket('sales:target', useCallback(() => load(), [load]));

  if (!isSalesStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<TrendingUp className="w-5 h-5" />} title={ar ? 'المبيعات' : 'Sales'} subtitle={ar ? 'لوحة الأداء' : 'Performance overview'}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label="period" />
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={ar ? 'مبيعات محققة' : 'Won (value)'} value={money(data.wonValue)} accent="text-green-600" />
        <StatCard label={ar ? 'الهدف' : 'Target'} value={money(data.teamTarget)} accent="text-blue-600" />
        <StatCard label={ar ? 'نسبة التحقيق' : 'Attainment'} value={pct(data.attainment)} accent={data.attainment >= 100 ? 'text-green-600' : 'text-amber-700'} />
        <StatCard label={ar ? 'نسبة الإغلاق' : 'Win Rate'} value={pct(data.winRate)} accent="text-purple-600" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/sales/pipeline"><StatCard label={ar ? 'صفقات مفتوحة' : 'Open Deals'} value={data.openCount} /></Link>
        <Link href="/system/sales/pipeline"><StatCard label={ar ? 'قيمة المسار' : 'Pipeline Value'} value={money(data.openValue)} accent="text-amber-700" /></Link>
        <StatCard label={ar ? 'صفقات رابحة' : 'Won Deals'} value={data.wonCount} accent="text-green-600" />
        <StatCard label={ar ? 'صفقات خاسرة' : 'Lost Deals'} value={data.lostCount} accent="text-red-600" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#f37121]" /> {ar ? 'أفضل المناديب' : 'Top Reps'}</h3>
        {data.topReps.length === 0 ? <p className="text-slate-500 text-sm">—</p> : (
          <div className="space-y-2">
            {data.topReps.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                <span className="text-slate-800 text-sm">{i + 1}. {r.rep}</span>
                <span className="text-green-600 text-sm font-medium">{money(r.value)} · {r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
