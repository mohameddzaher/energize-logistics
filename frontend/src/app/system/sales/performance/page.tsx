'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { BarChart3 } from 'lucide-react';
import { isSalesStaff, money, pct, thisPeriod } from '@/lib/finance';
import { Spinner, PageHeader, ExportButton } from '@/components/hr/HRKit';
import { getSalesPerformanceTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

export default function SalesPerformancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getSalesPerformanceTranslations(lang);
  const [period, setPeriod] = useState(thisPeriod());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api.get<{ rows: any[] }>(`/api/sales/performance?period=${period}`); setRows(d.rows || []); } catch { /* */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));

  const handleExport = () => {
    exportToExcel(rows, [
      { header: tx.colRep, key: 'rep', width: 24, transform: (_v, r) => r.rep?.name ?? '' },
      { header: tx.colWon, key: 'wonValue', width: 16, transform: (_v, r) => money(r.wonValue) },
      { header: lang === 'ar' ? 'عدد الصفقات الفائزة' : 'Won Count', key: 'wonCount', width: 14 },
      { header: tx.colTarget, key: 'target', width: 16, transform: (v) => money(v) },
      { header: tx.colAttainment, key: 'attainment', width: 14, transform: (v) => pct(v) },
      { header: tx.colOpen, key: 'openValue', width: 16, transform: (_v, r) => money(r.openValue) },
      { header: lang === 'ar' ? 'عدد الصفقات المفتوحة' : 'Open Count', key: 'openCount', width: 14 },
    ], `sales-performance-${period}`, lang === 'ar' ? 'أداء المبيعات' : 'Sales Performance');
  };

  if (!isSalesStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={tx.title}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label={tx.periodAria} />
        <ExportButton onClick={handleExport} label={lang === 'ar' ? 'تصدير Excel' : 'Export Excel'} />
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">{tx.colRep}</th>
            <th className="px-4 py-3 text-end">{tx.colWon}</th>
            <th className="px-4 py-3 text-end">{tx.colTarget}</th>
            <th className="px-4 py-3 text-end">{tx.colAttainment}</th>
            <th className="px-4 py-3 text-end">{tx.colOpen}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">—</td></tr> : rows.map((r) => (
              <tr key={r.rep._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900">{r.rep.name}</td>
                <td className="px-4 py-3 text-end text-green-600">{money(r.wonValue)} <span className="text-slate-500 text-xs">({r.wonCount})</span></td>
                <td className="px-4 py-3 text-end text-slate-700">{money(r.target)}</td>
                <td className="px-4 py-3 text-end">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#f37121]" style={{ width: `${Math.min(100, r.attainment)}%` }} /></div>
                    <span className={r.attainment >= 100 ? 'text-green-600' : 'text-amber-700'}>{pct(r.attainment)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-end text-slate-700">{money(r.openValue)} <span className="text-slate-500 text-xs">({r.openCount})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
