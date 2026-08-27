'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CreditCard } from 'lucide-react';
import { isFinanceStaff, money, fmtDate } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { getAccountingPayablesTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

export default function PayablesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getAccountingPayablesTranslations(lang);
  const [data, setData] = useState<{ rows: any[]; buckets: any; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/accounting/payables')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('procurement:bill', useCallback(() => load(), [load]));

  if (!isFinanceStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;
  const b = data.buckets;

  const exportColumns: ExportColumn[] = [
    { header: tx.bill, key: 'bill', width: 18 },
    { header: tx.vendor, key: 'vendor.name', transform: (v) => v || '—', width: 24 },
    { header: tx.balance, key: 'balance', transform: (v) => money(v, ''), width: 16 },
    { header: tx.due, key: 'dueDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.daysOverdue, key: 'daysOverdue', transform: (v) => (v > 0 ? v : '—'), width: 14 },
  ];
  // تقريرُ أعمارِ ديونٍ بلا فلترٍ ولا ترقيم: الشاشة هي الكلّ حرفيًّا، ولو أضفنا
  // نطاقًا ثانيًا لأنتج الملفَّ نفسَه وأوهم المستخدمَ أنّ بينهما فرقًا.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: tx.pageTitle, rows: data.rows, columns: exportColumns }] },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CreditCard className="w-5 h-5" />} title={tx.pageTitle} subtitle={money(data.total)}>
        <ExportMenu fileName="payables" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={lang === 'ar' ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label={tx.current} value={money(b.current)} accent="text-green-600" />
        <StatCard label="1-30" value={money(b.d30)} accent="text-blue-600" />
        <StatCard label="31-60" value={money(b.d60)} accent="text-amber-700" />
        <StatCard label="61-90" value={money(b.d90)} accent="text-orange-600" />
        <StatCard label="90+" value={money(b.over90)} accent="text-red-600" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">{tx.bill}</th>
            <th className="px-4 py-3">{tx.vendor}</th>
            <th className="px-4 py-3 text-end">{tx.balance}</th>
            <th className="px-4 py-3">{tx.due}</th>
            <th className="px-4 py-3 text-end">{tx.daysOverdue}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-800">—</td></tr> : data.rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-100">
                <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">{r.bill}</td>
                <td className="px-4 py-2.5 text-slate-900">{r.vendor?.name || '—'}</td>
                <td className="px-4 py-2.5 text-end text-slate-900">{money(r.balance, '')}</td>
                <td className="px-4 py-2.5 text-slate-800">{fmtDate(r.dueDate)}</td>
                <td className={`px-4 py-2.5 text-end ${r.daysOverdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{r.daysOverdue > 0 ? r.daysOverdue : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
