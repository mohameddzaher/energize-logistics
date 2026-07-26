'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { TrendingUp } from 'lucide-react';
import { isFinanceStaff, accountName, money } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { getAccountingProfitLossTranslations } from '@/lib/translations';

export default function ProfitLossPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getAccountingProfitLossTranslations(lang);
  const [data, setData] = useState<{ revenue: any[]; expenses: any[]; totalRevenue: number; totalExpenses: number; netIncome: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to);
      setData(await api.get(`/api/accounting/profit-loss?${qs}`));
    } catch { /* */ }
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  if (!isFinanceStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<TrendingUp className="w-5 h-5" />} title={tx.pageTitle}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label={tx.fromDate} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label={tx.toDate} />
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={tx.revenue} value={money(data.totalRevenue)} accent="text-green-600" />
        <StatCard label={tx.expenses} value={money(data.totalExpenses)} accent="text-red-600" />
        <StatCard label={tx.netIncome} value={money(data.netIncome)} accent={data.netIncome >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="text-green-600 font-semibold mb-3">{tx.revenue}</h3>
          {data.revenue.length === 0 ? <p className="text-slate-500 text-sm">—</p> : data.revenue.map((r, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-slate-200/70 text-sm"><span className="text-slate-700">{accountName(r.account, lang)}</span><span className="text-slate-900">{money(r.amount, '')}</span></div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="text-red-600 font-semibold mb-3">{tx.expenses}</h3>
          {data.expenses.length === 0 ? <p className="text-slate-500 text-sm">—</p> : data.expenses.map((r, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-slate-200/70 text-sm"><span className="text-slate-700">{accountName(r.account, lang)}</span><span className="text-slate-900">{money(r.amount, '')}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
