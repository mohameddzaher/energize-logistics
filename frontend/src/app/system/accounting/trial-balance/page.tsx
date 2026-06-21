'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Scale } from 'lucide-react';
import { isFinanceStaff, accountName, money } from '@/lib/finance';
import { Spinner, PageHeader } from '@/components/hr/HRKit';

export default function TrialBalancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [data, setData] = useState<{ rows: any[]; totalDebit: number; totalCredit: number; balanced: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/accounting/trial-balance')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isFinanceStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Scale className="w-5 h-5" />} title={ar ? 'ميزان المراجعة' : 'Trial Balance'}
        subtitle={data.balanced ? (ar ? 'متوازن ✓' : 'Balanced ✓') : (ar ? 'غير متوازن ✗' : 'Not balanced ✗')} />
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-left text-slate-300">
            <th className="px-4 py-3">{ar ? 'الحساب' : 'Account'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'مدين' : 'Debit'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'دائن' : 'Credit'}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-100">
                <td className="px-4 py-2.5 text-slate-900">{accountName(r.account, lang)}</td>
                <td className="px-4 py-2.5 text-right text-green-600">{r.debit ? money(r.debit, '') : ''}</td>
                <td className="px-4 py-2.5 text-right text-red-600">{r.credit ? money(r.credit, '') : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-slate-200 font-bold text-slate-900">
            <td className="px-4 py-3">{ar ? 'الإجمالي' : 'Total'}</td>
            <td className="px-4 py-3 text-right">{money(data.totalDebit, '')}</td>
            <td className="px-4 py-3 text-right">{money(data.totalCredit, '')}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}
