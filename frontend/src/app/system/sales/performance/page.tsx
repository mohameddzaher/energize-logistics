'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { BarChart3 } from 'lucide-react';
import { isSalesStaff, money, pct, thisPeriod } from '@/lib/finance';
import { Spinner, PageHeader } from '@/components/hr/HRKit';

export default function SalesPerformancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [period, setPeriod] = useState(thisPeriod());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api.get<{ rows: any[] }>(`/api/sales/performance?period=${period}`); setRows(d.rows || []); } catch { /* */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));

  if (!isSalesStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={ar ? 'أداء المبيعات' : 'Sales Performance'}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label="period" />
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-left text-slate-300">
            <th className="px-4 py-3">{ar ? 'المندوب' : 'Rep'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'محقق' : 'Won'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'الهدف' : 'Target'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'التحقيق' : 'Attainment'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'مفتوحة' : 'Open'}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">—</td></tr> : rows.map((r) => (
              <tr key={r.rep._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900">{r.rep.name}</td>
                <td className="px-4 py-3 text-right text-green-600">{money(r.wonValue)} <span className="text-slate-500 text-xs">({r.wonCount})</span></td>
                <td className="px-4 py-3 text-right text-slate-700">{money(r.target)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#f37121]" style={{ width: `${Math.min(100, r.attainment)}%` }} /></div>
                    <span className={r.attainment >= 100 ? 'text-green-600' : 'text-amber-700'}>{pct(r.attainment)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-slate-700">{money(r.openValue)} <span className="text-slate-500 text-xs">({r.openCount})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
