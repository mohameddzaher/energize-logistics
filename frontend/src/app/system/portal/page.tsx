'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import StatCard from '@/components/system/StatCard';
import { DollarSign, FileText, Clock, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/context/LanguageContext';
import { getPortalTranslations, getPortalExtraTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

export default function ClientPortalPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getPortalTranslations(lang);
  const txx = getPortalExtraTranslations(lang);
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useSocket('payment:received', fetchData);
  useSocket('invoice:created', fetchData);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-slate-500">{txx.unableToLoad}</p>;
  }

  const overdueInvoices = data.invoices?.filter((inv: any) => inv.isOverdue) || [];
  const dueSoonInvoices = data.invoices?.filter((inv: any) => inv.isDueSoon) || [];
  const paidInvoices = data.invoices?.filter((inv: any) => inv.status === 'paid') || [];

  const handleExport = () => {
    exportToExcel(
      data.invoices || [],
      [
        { header: T.invoiceNumber, key: 'invoiceNumber', transform: (v: any) => `#${v}`, width: 16 },
        { header: T.amount, key: 'amount', transform: (v: any) => v?.toLocaleString() ?? '', width: 16 },
        { header: T.balance, key: 'balance', transform: (v: any) => v?.toLocaleString() ?? '', width: 16 },
        { header: T.dueDate, key: 'dueDate', transform: (v: any) => (v ? new Date(v).toLocaleDateString() : ''), width: 16 },
        {
          header: T.date,
          key: '_status',
          transform: (_v: any, r: any) =>
            r.isOverdue
              ? `${r.overdueDays}${txx.daysOverdueSuffix}`
              : r.status === 'paid'
              ? txx.paid
              : `${r.remainingDays}${txx.daysLeftSuffix}`,
          width: 18,
        },
        { header: T.status, key: 'status', width: 14 },
      ],
      'portal-invoices',
      T.myInvoices
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{data.customer?.companyName}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {txx.creditAgreement}: <span className="text-[#f37121] font-bold">{data.customer?.creditTerm} {txx.days}</span>
          {' | '}{txx.creditLimit}: <span className="text-slate-900 font-bold">{data.customer?.creditLimit?.toLocaleString()}</span>
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={T.totalOutstanding} value={data.totalOutstanding?.toLocaleString() || 0} icon={DollarSign} color="#ef4444" />
        <StatCard title={T.totalPaid} value={data.totalPaid?.toLocaleString() || 0} icon={CheckCircle} color="#10b981" />
        <StatCard title={T.openInvoices} value={data.invoices?.length || 0} icon={FileText} />
        <StatCard title={txx.overdue} value={overdueInvoices.length} icon={AlertTriangle} color="#ef4444" />
      </div>

      {/* Alerts */}
      {overdueInvoices.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <h3 className="text-red-600 font-bold text-sm flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            {txx.overdueInvoices}
          </h3>
          <div className="space-y-2">
            {overdueInvoices.slice(0, 5).map((inv: any) => (
              <div key={inv._id} className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-slate-900 font-medium text-sm">{T.invoiceNumber} {inv.invoiceNumber}</p>
                    <p className="text-red-600 text-xs mt-1">{inv.message}</p>
                  </div>
                  <p className="text-red-600 font-bold text-sm">{inv.balance?.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dueSoonInvoices.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <h3 className="text-yellow-700 font-bold text-sm flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" />
            {T.dueDate}
          </h3>
          <div className="space-y-2">
            {dueSoonInvoices.map((inv: any) => (
              <div key={inv._id} className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-slate-900 font-medium text-sm">{T.invoiceNumber} {inv.invoiceNumber}</p>
                    <p className="text-yellow-700 text-xs mt-1">{inv.message}</p>
                  </div>
                  <p className="text-yellow-700 font-bold text-sm">{inv.balance?.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Invoices */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.myInvoices}</h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              {lang === 'ar' ? 'تصدير Excel' : 'Export Excel'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/system/portal/invoices')}
              className="text-[#f37121] text-sm hover:underline"
            >
              {T.all}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.invoiceNumber}</th>
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.amount}</th>
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.balance}</th>
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.dueDate}</th>
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.date}</th>
                <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.invoices?.slice(0, 10).map((inv: any) => (
                <tr key={inv._id} className="hover:bg-slate-100 cursor-pointer" onClick={() => router.push(`/system/portal/invoices/${inv._id}`)}>
                  <td className="px-4 py-3 text-sm text-slate-900 font-medium">#{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{inv.amount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{inv.balance?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{new Date(inv.dueDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`font-medium ${
                      inv.statusColor === 'red' ? 'text-red-600' :
                      inv.statusColor === 'yellow' ? 'text-yellow-700' :
                      'text-green-600'
                    }`}>
                      {inv.isOverdue ? `${inv.overdueDays}${txx.daysOverdueSuffix}` : inv.status === 'paid' ? txx.paid : `${inv.remainingDays}${txx.daysLeftSuffix}`}
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
    </div>
  );
}
