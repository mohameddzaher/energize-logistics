'use client';
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { CreditCard, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getPortalTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';

export default function ClientPaymentsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getPortalTranslations(lang);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/payments');
      setPayments(data.payments || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  useSocket('payment:received', fetchPayments);
  useSocket('payment:logged', fetchPayments);
  useSocket('payment:deleted', fetchPayments);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);

  const handleExport = () => {
    if (!payments.length) return;
    exportToExcel(
      payments,
      [
        { header: 'Date', key: 'paymentDate', transform: fmt.date, width: 14 },
        { header: 'Invoice #', key: 'invoice.invoiceNumber', width: 14 },
        { header: 'Amount', key: 'amount', transform: fmt.money, width: 16 },
        { header: 'Method', key: 'paymentMethod', transform: (v: any) => v?.replace('_', ' ') || '', width: 16 },
        { header: 'Reference', key: 'reference', width: 20 },
      ],
      'Payment_History',
      'Payments'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-[#f37121]" />
          {T.myPayments}
        </h1>
        {payments.length > 0 && (
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
        )}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <p className="text-gray-400 text-sm">{T.totalPaid}: <span className="text-green-400 font-bold text-lg">{totalPaid.toLocaleString()}</span></p>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-800 border-b border-gray-700">
              <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">{T.paymentDate}</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">{T.invoiceNumber}</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">{T.amount}</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">{T.paymentMethod}</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase">{T.reference}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">{T.noPayments}</td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p._id} className="hover:bg-gray-700/30">
                  <td className="px-4 py-3 text-sm text-gray-300">{new Date(p.paymentDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-white font-medium">#{p.invoice?.invoiceNumber || '-'}</td>
                  <td className="px-4 py-3 text-sm text-green-400 font-bold">{p.amount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-300 capitalize">{p.paymentMethod?.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{p.reference || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
