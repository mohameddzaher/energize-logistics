'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Wallet } from 'lucide-react';
import { isFinanceStaff, money, fmtDate } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';

export default function ReceivablesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [data, setData] = useState<{ rows: any[]; buckets: any; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/accounting/receivables')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isFinanceStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;
  const b = data.buckets;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wallet className="w-5 h-5" />} title={ar ? 'الذمم المدينة' : 'Receivables (AR Aging)'} subtitle={money(data.total)} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label={ar ? 'حالية' : 'Current'} value={money(b.current)} accent="text-green-600" />
        <StatCard label="1-30" value={money(b.d30)} accent="text-blue-600" />
        <StatCard label="31-60" value={money(b.d60)} accent="text-amber-700" />
        <StatCard label="61-90" value={money(b.d90)} accent="text-orange-600" />
        <StatCard label="90+" value={money(b.over90)} accent="text-red-600" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-left text-slate-300">
            <th className="px-4 py-3">{ar ? 'الفاتورة' : 'Invoice'}</th>
            <th className="px-4 py-3">{ar ? 'العميل' : 'Customer'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'الرصيد' : 'Balance'}</th>
            <th className="px-4 py-3">{ar ? 'الاستحقاق' : 'Due'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'أيام التأخير' : 'Days Overdue'}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">—</td></tr> : data.rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-100">
                <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">{r.invoice}</td>
                <td className="px-4 py-2.5 text-slate-900">{r.customer?.companyName || '—'}</td>
                <td className="px-4 py-2.5 text-right text-slate-900">{money(r.balance, '')}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.dueDate)}</td>
                <td className={`px-4 py-2.5 text-right ${r.daysOverdue > 0 ? 'text-red-600' : 'text-slate-500'}`}>{r.daysOverdue > 0 ? r.daysOverdue : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
