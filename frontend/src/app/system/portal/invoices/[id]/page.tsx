'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import Link from 'next/link';
import { ArrowLeft, FileText, Calendar, Clock, DollarSign, Download } from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getPortalTranslations } from '@/lib/translations';

export default function ClientInvoiceDetailPage() {
  const params = useParams();
  const { lang } = useLanguage();
  const T = getPortalTranslations(lang);
  const [invoice, setInvoice] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [invData, payData] = await Promise.all([
          api.get<any>(`/api/invoices/${params.id}`),
          api.get<any>(`/api/payments?invoice=${params.id}`),
        ]);
        setInvoice(invData.invoice);
        setPayments(payData.payments || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) return <p className="text-gray-400">{T.noInvoices}</p>;

  const statusColor = invoice.isOverdue ? 'red' : (invoice.remainingDays <= 5 && invoice.status !== 'paid') ? 'yellow' : 'green';

  const handleExport = () => {
    exportMultiSheet(
      [
        {
          name: 'Invoice',
          data: [invoice],
          columns: [
            { header: 'Invoice #', key: 'invoiceNumber', width: 14 },
            { header: 'Status', key: 'status', transform: fmt.status, width: 12 },
            { header: 'Credit Term (Days)', key: 'creditTerm', width: 18 },
            { header: 'Amount', key: 'amount', transform: fmt.money, width: 16 },
            { header: 'Paid', key: 'paidAmount', transform: fmt.money, width: 16 },
            { header: 'Balance', key: 'balance', transform: fmt.money, width: 16 },
            { header: 'Invoice Date', key: 'invoiceDate', transform: fmt.date, width: 14 },
            { header: 'Due Date', key: 'dueDate', transform: fmt.date, width: 14 },
            { header: 'Overdue', key: 'isOverdue', transform: fmt.yesNo, width: 10 },
            { header: 'Overdue Days', key: 'overdueDays', width: 14 },
            { header: 'Remaining Days', key: 'remainingDays', width: 16 },
          ],
        },
        {
          name: 'Payments',
          data: payments,
          columns: [
            { header: 'Date', key: 'paymentDate', transform: fmt.date, width: 14 },
            { header: 'Amount', key: 'amount', transform: fmt.money, width: 16 },
            { header: 'Method', key: 'paymentMethod', transform: (v: any) => v?.replace('_', ' ') || '', width: 16 },
            { header: 'Reference', key: 'reference', width: 20 },
          ],
        },
      ],
      `Invoice_${invoice.invoiceNumber}`
    );
  };

  return (
    <div className="space-y-6">
      <Link href="/system/portal/invoices" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> {T.back} {T.myInvoices}
      </Link>

      {/* Invoice Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <FileText className="w-6 h-6 text-[#f37121]" />
              {T.invoiceNumber} {invoice.invoiceNumber}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Credit Term: <span className="text-[#f37121] font-bold">{invoice.creditTerm} Days</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {T.export}
            </button>
            <span className={`px-4 py-2 rounded-lg text-sm font-bold ${
            statusColor === 'red' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            statusColor === 'yellow' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
            'bg-green-500/20 text-green-400 border border-green-500/30'
          }`}>
            {invoice.status?.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Dynamic Message */}
        {invoice.isOverdue && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-red-400 text-sm font-medium">
              This invoice is <strong>{invoice.overdueDays} days overdue</strong> according to your {invoice.creditTerm}-day credit agreement.
            </p>
          </div>
        )}
        {!invoice.isOverdue && invoice.remainingDays <= 5 && invoice.status !== 'paid' && (
          <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-yellow-400 text-sm font-medium">
              You must pay Invoice #{invoice.invoiceNumber} within <strong>{invoice.remainingDays} days</strong> according to your {invoice.creditTerm}-day credit agreement.
            </p>
          </div>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div>
            <p className="text-gray-400 text-xs uppercase">{T.amount}</p>
            <p className="text-white text-lg font-bold">{invoice.amount?.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase">{T.totalPaid}</p>
            <p className="text-green-400 text-lg font-bold">{invoice.paidAmount?.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase">{T.balance}</p>
            <p className="text-red-400 text-lg font-bold">{invoice.balance?.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase">{invoice.isOverdue ? 'Overdue Days' : 'Remaining Days'}</p>
            <p className={`text-lg font-bold ${invoice.isOverdue ? 'text-red-400' : 'text-green-400'}`}>
              {invoice.isOverdue ? invoice.overdueDays : invoice.remainingDays} days
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-700">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">{T.invoiceDate}:</span>
            <span className="text-white">{new Date(invoice.invoiceDate).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">{T.dueDate}:</span>
            <span className="text-white">{new Date(invoice.dueDate).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          {T.myPayments}
        </h3>
        {payments.length === 0 ? (
          <p className="text-gray-500 text-sm">{T.noPayments}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.paymentDate}</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.amount}</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.paymentMethod}</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.reference}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {payments.map((p: any) => (
                <tr key={p._id} className="hover:bg-gray-700/30">
                  <td className="px-4 py-3 text-sm text-gray-300">{new Date(p.paymentDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-green-400 font-medium">{p.amount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-300 capitalize">{p.paymentMethod?.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{p.reference || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
