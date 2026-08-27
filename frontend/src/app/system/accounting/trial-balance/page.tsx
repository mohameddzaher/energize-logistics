'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Scale } from 'lucide-react';
import { isFinanceStaff, accountName, money } from '@/lib/finance';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { getAccountingTrialBalanceTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

export default function TrialBalancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getAccountingTrialBalanceTranslations(lang);
  const [data, setData] = useState<{ rows: any[]; totalDebit: number; totalCredit: number; balanced: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/accounting/trial-balance')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isFinanceStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  const exportColumns: ExportColumn[] = [
    { header: tx.account, key: 'account', width: 32, transform: (v: any) => accountName(v, lang) },
    { header: tx.debit, key: 'debit', width: 16, transform: (v: any) => (v ? money(v, '') : '') },
    { header: tx.credit, key: 'credit', width: 16, transform: (v: any) => (v ? money(v, '') : '') },
  ];
  // ميزانُ مراجعةٍ لحظيّ بلا فلترٍ ولا ترقيم؛ وهو فوق ذلك لا يصحّ إلّا كاملًا:
  // ميزانٌ منقوصُ الحسابات لا يتوازن، فنطاقٌ واحد هو الصادق الوحيد هنا.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: tx.title, rows: data.rows, columns: exportColumns }] },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Scale className="w-5 h-5" />} title={tx.title}
        subtitle={data.balanced ? tx.balanced : tx.notBalanced}>
        <ExportMenu fileName="trial-balance" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={lang === 'ar' ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
      </PageHeader>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">{tx.account}</th>
            <th className="px-4 py-3 text-end">{tx.debit}</th>
            <th className="px-4 py-3 text-end">{tx.credit}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-100">
                <td className="px-4 py-2.5 text-slate-900">{accountName(r.account, lang)}</td>
                <td className="px-4 py-2.5 text-end text-green-600">{r.debit ? money(r.debit, '') : ''}</td>
                <td className="px-4 py-2.5 text-end text-red-600">{r.credit ? money(r.credit, '') : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-slate-200 font-bold text-slate-900">
            <td className="px-4 py-3">{tx.total}</td>
            <td className="px-4 py-3 text-end">{money(data.totalDebit, '')}</td>
            <td className="px-4 py-3 text-end">{money(data.totalCredit, '')}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}
