'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { FileText, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getPortalTranslations, getPortalInvoicesExtraTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';

export default function ClientInvoicesPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getPortalTranslations(lang);
  const txx = getPortalInvoicesExtraTranslations(lang);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.get<any>('/api/analytics/portal/dashboard');
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useSocket('invoice:created', fetchData);
  useSocket('invoice:updated', fetchData);
  useSocket('payment:received', fetchData);
  useSocket('payment:logged', fetchData);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleExport = () => {
    if (!data?.invoices?.length) return;
    exportToExcel(
      data.invoices,
      [
        { header: T.invoiceNumber, key: 'invoiceNumber', width: 14 },
        { header: T.amount, key: 'amount', transform: fmt.money, width: 16 },
        { header: txx.paid, key: 'paidAmount', transform: fmt.money, width: 16 },
        { header: T.balance, key: 'balance', transform: fmt.money, width: 16 },
        { header: T.invoiceDate, key: 'invoiceDate', transform: fmt.date, width: 14 },
        { header: T.dueDate, key: 'dueDate', transform: fmt.date, width: 14 },
        { header: txx.days, key: 'overdueDays', transform: (_v: any, row: any) =>
          row.isOverdue ? `-${row.overdueDays}${txx.dayUnit}` : row.status === 'paid' ? txx.paid : `${row.remainingDays}${txx.dayUnit}`,
          width: 10,
        },
        { header: T.status, key: 'status', transform: fmt.status, width: 12 },
      ],
      'My_Invoices',
      'Invoices'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#f37121]" />
          {T.myInvoices}
        </h1>
        {data?.invoices?.length > 0 && (
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm font-medium rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200">
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.invoiceNumber}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.amount}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.totalPaid}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.balance}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.invoiceDate}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.dueDate}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.date}</th>
              <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.status}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {data?.invoices?.map((inv: any) => (
              <tr
                key={inv._id}
                className="hover:bg-slate-100 cursor-pointer"
                onClick={() => router.push(`/system/portal/invoices/${inv._id}`)}
              >
                <td className="px-4 py-3 text-sm text-slate-900 font-medium">#{inv.invoiceNumber}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{inv.amount?.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-green-600">{inv.paidAmount?.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-700 font-medium">{inv.balance?.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-800">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-sm text-slate-800">{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`font-bold ${
                    inv.statusColor === 'red' ? 'text-red-600' :
                    inv.statusColor === 'yellow' ? 'text-yellow-700' :
                    'text-green-600'
                  }`}>
                    {inv.isOverdue ? `-${inv.overdueDays}${txx.dayUnit}` : inv.status === 'paid' ? txx.paid : `${inv.remainingDays}${txx.dayUnit}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    inv.statusColor === 'red' ? 'bg-red-500/20 text-red-600' :
                    inv.statusColor === 'yellow' ? 'bg-yellow-500/20 text-yellow-700' :
                    'bg-green-500/20 text-green-600'
                  }`}>
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
