'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, FileText, DollarSign, Calendar, Clock, User,
  CreditCard, X, Snowflake, Shield, AlertTriangle, CheckCircle, Download
} from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getInvoicesTranslations, getInvoicesIdExtraTranslations } from '@/lib/translations';

interface InvoiceDetail {
  _id: string;
  invoiceNumber: string;
  customer: {
    _id: string;
    companyName: string;
    creditTerm: number;
    contactPerson?: string;
    email?: string;
    phone?: string;
    office?: string;
    salesManager?: string;
    customerNumber?: string;
    grade?: string;
  };
  salesManager?: string;
  refundedAt?: string;
  refundedBy?: { firstName: string; lastName: string };
  amount: number;
  paidAmount: number;
  balance: number;
  invoiceDate: string;
  dueDate: string;
  remainingDays: number;
  overdueDays: number;
  isOverdue: boolean;
  status: string;
  creditTerm: number;
  isFrozen: boolean;
  frozenBy?: { firstName: string; lastName: string };
  frozenAt?: string;
  notes?: string;
  createdBy: { firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

interface Payment {
  _id: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  receivedBy?: { firstName: string; lastName: string };
  createdAt: string;
}

interface InvoiceResponse {
  invoice: InvoiceDetail;
}

interface PaymentsResponse {
  payments: Payment[];
  total: number;
}

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  paid: { bg: 'bg-green-500/20', text: 'text-green-600', label: 'Paid' },
  partial: { bg: 'bg-yellow-500/20', text: 'text-yellow-700', label: 'Partial' },
  overdue: { bg: 'bg-red-500/20', text: 'text-red-600', label: 'Overdue' },
  pending: { bg: 'bg-blue-500/20', text: 'text-blue-600', label: 'Pending' },
  frozen: { bg: 'bg-slate-500/20', text: 'text-slate-500', label: 'Frozen' },
  disputed: { bg: 'bg-orange-500/20', text: 'text-orange-600', label: 'Disputed' },
  refunded: { bg: 'bg-slate-500/20', text: 'text-slate-500', label: 'Refunded' },
};

const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  check: 'Check',
  cash: 'Cash',
  online: 'Online',
  other: 'Other',
};

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getInvoicesTranslations(lang);
  const txx = getInvoicesIdExtraTranslations(lang);

  const STATUS_LABELS: Record<string, string> = {
    paid: T.paid,
    partial: T.partial,
    overdue: T.overdue,
    pending: T.pendingStatus,
    frozen: T.frozen,
    disputed: T.disputed,
    refunded: T.refunded,
  };
  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    bank_transfer: txx.methodBankTransfer,
    check: txx.methodCheck,
    cash: txx.methodCash,
    online: txx.methodOnline,
    other: txx.methodOther,
  };

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Log Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [loggingPayment, setLoggingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'bank_transfer',
    reference: '',
    notes: '',
  });

  // Override Status Modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [submittingStatus, setSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Freeze
  const [freezing, setFreezing] = useState(false);

  // Refund
  const [refunding, setRefunding] = useState(false);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);

  const isSuperAdmin = user?.role === 'super_admin';

  const fetchInvoice = useCallback(async () => {
    try {
      setError('');
      const data = await api.get<InvoiceResponse>(`/api/invoices/${id}`);
      setInvoice(data.invoice);
    } catch (err: any) {
      setError(err.message || txx.errLoadInvoice);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchPayments = useCallback(async () => {
    try {
      const data = await api.get<PaymentsResponse>(`/api/payments?invoice=${id}`);
      setPayments(data.payments || []);
    } catch {
      setPayments([]);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
    fetchPayments();
  }, [fetchInvoice, fetchPayments]);

  // Real-time updates
  useSocket('invoice:updated', fetchInvoice);
  useSocket('payment:logged', () => {
    fetchInvoice();
    fetchPayments();
  });
  useSocket('status:changed', fetchInvoice);

  const handleLogPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError('');

    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      setPaymentError(txx.errAmountPositive);
      return;
    }
    if (invoice && Number(paymentForm.amount) > invoice.balance) {
      setPaymentError(`${txx.errExceedBalance} ${formatCurrency(invoice.balance)}`);
      return;
    }
    if (!paymentForm.paymentDate) {
      setPaymentError(txx.errPaymentDateRequired);
      return;
    }

    setLoggingPayment(true);
    try {
      await api.post('/api/payments', {
        invoice: id,
        amount: Number(paymentForm.amount),
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        reference: paymentForm.reference || undefined,
        notes: paymentForm.notes || undefined,
      });
      setShowPaymentModal(false);
      setPaymentForm({
        amount: '',
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: 'bank_transfer',
        reference: '',
        notes: '',
      });
      fetchInvoice();
      fetchPayments();
    } catch (err: any) {
      setPaymentError(err.message || txx.errLogPayment);
    } finally {
      setLoggingPayment(false);
    }
  };

  const handleOverrideStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError('');

    if (!overrideStatus) {
      setStatusError(txx.errSelectStatus);
      return;
    }

    setSubmittingStatus(true);
    try {
      await api.put(`/api/invoices/${id}/status`, { status: overrideStatus });
      setShowStatusModal(false);
      setOverrideStatus('');
      fetchInvoice();
    } catch (err: any) {
      setStatusError(err.message || txx.errOverrideStatus);
    } finally {
      setSubmittingStatus(false);
    }
  };

  const handleFreeze = async () => {
    setFreezing(true);
    try {
      await api.put(`/api/invoices/${id}/freeze`);
      fetchInvoice();
    } catch (err: any) {
      setError(err.message || txx.errToggleFreeze);
    } finally {
      setFreezing(false);
    }
  };

  const handleRefund = async () => {
    setRefunding(true);
    try {
      await api.post(`/api/invoices/${id}/refund`);
      setShowRefundConfirm(false);
      fetchInvoice();
      fetchPayments();
    } catch (err: any) {
      setError(err.message || txx.errRefundInvoice);
    } finally {
      setRefunding(false);
    }
  };

  const formatCurrency = (val: number) => {
    return 'SAR ' + Math.round(val || 0).toLocaleString('en-US');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.push('/system/invoices')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {T.back} {T.invoices}
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-red-600 text-center">
          {error}
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const badge = STATUS_BADGES[invoice.status] || STATUS_BADGES.pending;
  const remainingMessage =
    invoice.status === 'paid'
      ? null
      : invoice.remainingDays < 0
        ? `${invoice.overdueDays} ${txx.daysOverdue}`
        : `${invoice.remainingDays} ${txx.daysRemaining}`;
  const remainingColor =
    invoice.status === 'paid'
      ? ''
      : invoice.remainingDays < 0
        ? 'text-red-600'
        : invoice.remainingDays <= 5
          ? 'text-red-600'
          : invoice.remainingDays <= 15
            ? 'text-yellow-700'
            : 'text-green-600';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Back & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.push('/system/invoices')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {T.back} {T.title}
          </button>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <FileText className="w-6 h-6 text-[#f37121]" />
            {invoice.invoiceNumber}
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
              {STATUS_LABELS[invoice.status] || badge.label}
            </span>
            {invoice.isFrozen && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-700 flex items-center gap-1">
                <Snowflake className="w-3 h-3" />
                {T.frozen}
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Export Invoice */}
          <button
            type="button"
            onClick={() => {
              exportMultiSheet(
                [
                  {
                    name: 'Invoice',
                    data: [invoice],
                    columns: [
                      { header: 'Invoice #', key: 'invoiceNumber', width: 18 },
                      { header: 'Customer', key: 'customer.companyName', width: 25 },
                      { header: 'Contact Person', key: 'customer.contactPerson', width: 20 },
                      { header: 'Email', key: 'customer.email', width: 25 },
                      { header: 'Phone', key: 'customer.phone', width: 16 },
                      { header: 'Office', key: 'customer.office', width: 15 },
                      { header: 'Sales Manager', key: 'customer.salesManager', width: 18 },
                      { header: 'Amount', key: 'amount', transform: fmt.money, width: 15 },
                      { header: 'Paid', key: 'paidAmount', transform: fmt.money, width: 15 },
                      { header: 'Balance', key: 'balance', transform: fmt.money, width: 15 },
                      { header: 'Invoice Date', key: 'invoiceDate', transform: fmt.date, width: 14 },
                      { header: 'Due Date', key: 'dueDate', transform: fmt.date, width: 14 },
                      { header: 'Remaining Days', key: 'remainingDays', width: 16 },
                      { header: 'Overdue Days', key: 'overdueDays', width: 14 },
                      { header: 'Status', key: 'status', transform: fmt.status, width: 12 },
                      { header: 'Credit Term', key: 'creditTerm', width: 12 },
                      { header: 'Frozen', key: 'isFrozen', transform: fmt.yesNo, width: 10 },
                      { header: 'Notes', key: 'notes', width: 30 },
                      { header: 'Created At', key: 'createdAt', transform: fmt.datetime, width: 20 },
                    ],
                  },
                  {
                    name: 'Payments',
                    data: payments,
                    columns: [
                      { header: 'Payment Date', key: 'paymentDate', transform: fmt.date, width: 14 },
                      { header: 'Amount', key: 'amount', transform: fmt.money, width: 15 },
                      { header: 'Method', key: 'paymentMethod', width: 16 },
                      { header: 'Reference', key: 'reference', width: 18 },
                      { header: 'Received By', key: 'receivedBy', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 18 },
                      { header: 'Notes', key: 'notes', width: 30 },
                      { header: 'Created At', key: 'createdAt', transform: fmt.datetime, width: 20 },
                    ],
                  },
                ],
                `Invoice_${invoice.invoiceNumber}_${new Date().toISOString().split('T')[0]}`
              );
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
          {/* Log Payment */}
          {invoice.status !== 'paid' && !invoice.isFrozen && (
            <button
              type="button"
              onClick={() => {
                setShowPaymentModal(true);
                setPaymentError('');
                setPaymentForm({
                  amount: '',
                  paymentDate: new Date().toISOString().split('T')[0],
                  paymentMethod: 'bank_transfer',
                  reference: '',
                  notes: '',
                });
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <DollarSign className="w-4 h-4" />
              {T.payment}
            </button>
          )}

          {/* Override Status - super_admin only */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowStatusModal(true);
                setStatusError('');
                setOverrideStatus(invoice.status);
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              <Shield className="w-4 h-4" />
              {T.status}
            </button>
          )}

          {/* Freeze/Unfreeze - super_admin only */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleFreeze}
              disabled={freezing}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                invoice.isFrozen
                  ? 'bg-cyan-600 hover:bg-cyan-700'
                  : 'bg-slate-200 hover:bg-slate-100'
              }`}
            >
              <Snowflake className="w-4 h-4" />
              {freezing ? txx.processing : invoice.isFrozen ? txx.unfreeze : txx.freeze}
            </button>
          )}

          {/* Refund - super_admin only */}
          {isSuperAdmin && invoice.status !== 'refunded' && invoice.status !== 'paid' && (
            <button
              type="button"
              onClick={() => setShowRefundConfirm(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              {txx.refund}
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Dynamic remaining/overdue message */}
      {remainingMessage && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg border ${
            invoice.remainingDays < 0
              ? 'bg-red-500/10 border-red-500/30'
              : invoice.remainingDays <= 5
                ? 'bg-red-500/10 border-red-500/30'
                : invoice.remainingDays <= 15
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-green-500/10 border-green-500/30'
          }`}
        >
          {invoice.remainingDays < 0 ? (
            <AlertTriangle className={`w-5 h-5 ${remainingColor}`} />
          ) : (
            <Clock className={`w-5 h-5 ${remainingColor}`} />
          )}
          <span className={`font-semibold ${remainingColor}`}>{remainingMessage}</span>
        </motion.div>
      )}

      {/* Invoice Info Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Financial Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <DollarSign className="w-5 h-5 text-[#f37121]" />
            {T.invoiceDetails}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.amount}</p>
              <p className="text-slate-900 text-xl font-bold mt-1">{formatCurrency(invoice.amount)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.paidAmount}</p>
              <p className="text-green-600 text-xl font-bold mt-1">{formatCurrency(invoice.paidAmount)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.balance}</p>
              <p className={`text-xl font-bold mt-1 ${invoice.balance > 0 ? 'text-orange-600' : 'text-slate-500'}`}>
                {formatCurrency(invoice.balance)}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.creditTerm}</p>
              <p className="text-slate-900 text-xl font-bold mt-1">{invoice.creditTerm} {txx.days}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-500">{T.paymentHistory}</span>
              <span className="text-slate-900 font-medium">
                {invoice.amount > 0 ? Math.round((invoice.paidAmount / invoice.amount) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${invoice.amount > 0 ? Math.min(100, (invoice.paidAmount / invoice.amount) * 100) : 0}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-green-500 rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Date & Status Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <Calendar className="w-5 h-5 text-[#f37121]" />
            {T.dueDate} & {T.status}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.invoiceDate}</p>
              <p className="text-slate-900 font-medium mt-1">{formatDate(invoice.invoiceDate)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.dueDate}</p>
              <p className="text-slate-900 font-medium mt-1">{formatDate(invoice.dueDate)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.remainingDays}</p>
              <p className={`font-medium mt-1 ${
                invoice.status === 'paid' ? 'text-slate-500' : remainingColor
              }`}>
                {invoice.status === 'paid' ? '-' : invoice.remainingDays}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.overdueDays}</p>
              <p className={`font-medium mt-1 ${invoice.overdueDays > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {invoice.overdueDays > 0 ? invoice.overdueDays : '-'}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.status}</p>
              <p className="mt-1">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                  {STATUS_LABELS[invoice.status] || badge.label}
                </span>
              </p>
            </div>
            {invoice.isFrozen && invoice.frozenBy && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.frozen}</p>
                <p className="text-cyan-700 font-medium mt-1">
                  {invoice.frozenBy.firstName} {invoice.frozenBy.lastName}
                </p>
                {invoice.frozenAt && (
                  <p className="text-slate-500 text-xs mt-0.5">{formatDateTime(invoice.frozenAt)}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Refund Info */}
        {invoice.status === 'refunded' && invoice.refundedAt && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-red-600 font-medium">{T.refunded}</p>
            <p className="text-slate-500 text-sm mt-1">
              {txx.refundedOn} {formatDate(invoice.refundedAt)}
              {invoice.refundedBy && ` ${txx.byUser} ${invoice.refundedBy.firstName} ${invoice.refundedBy.lastName}`}
            </p>
          </div>
        )}

        {/* Customer Info */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <User className="w-5 h-5 text-[#f37121]" />
            {T.customer}
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.customer}</p>
              <p className="text-slate-900 font-medium mt-1">{invoice.customer.companyName}</p>
            </div>
            {invoice.customer.contactPerson && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.contactPerson}</p>
                <p className="text-slate-700 mt-1">{invoice.customer.contactPerson}</p>
              </div>
            )}
            {invoice.customer.email && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.email}</p>
                <p className="text-slate-700 mt-1">{invoice.customer.email}</p>
              </div>
            )}
            {invoice.customer.phone && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.phone}</p>
                <p className="text-slate-700 mt-1">{invoice.customer.phone}</p>
              </div>
            )}
            {invoice.customer.office && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.branch}</p>
                <p className="text-slate-700 mt-1">{invoice.customer.office}</p>
              </div>
            )}
            {invoice.customer.salesManager && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.user}</p>
                <p className="text-slate-700 mt-1">{invoice.customer.salesManager}</p>
              </div>
            )}
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.creditTerm}</p>
              <p className="text-slate-700 mt-1">{invoice.customer.creditTerm} {txx.days}</p>
            </div>
          </div>
        </div>

        {/* Audit Info */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-[#f37121]" />
            {T.details}
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.user}</p>
              <p className="text-slate-700 mt-1">
                {invoice.createdBy?.firstName} {invoice.createdBy?.lastName}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.createdAt}</p>
              <p className="text-slate-700 mt-1">{formatDateTime(invoice.createdAt)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{T.date}</p>
              <p className="text-slate-700 mt-1">{formatDateTime(invoice.updatedAt)}</p>
            </div>
            {invoice.notes && (
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{T.notes}</p>
                <p className="text-slate-700 mt-1 text-sm">{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <CreditCard className="w-5 h-5 text-[#f37121]" />
            {T.paymentHistory}
            <span className="text-slate-500 text-sm font-normal">({payments.length})</span>
          </h3>
        </div>

        {payments.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">{T.noInvoices}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.date}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.amount}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.type}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.reference}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.user}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.notes}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {payments.map((payment) => (
                  <motion.tr
                    key={payment._id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(payment.paymentDate)}</td>
                    <td className="px-4 py-3 text-sm text-green-600 font-medium">{formatCurrency(payment.amount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {PAYMENT_METHOD_LABELS[payment.paymentMethod] || PAYMENT_METHODS[payment.paymentMethod] || payment.paymentMethod}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{payment.reference || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {payment.receivedBy
                        ? `${payment.receivedBy.firstName} ${payment.receivedBy.lastName}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 max-w-[200px] truncate">
                      {payment.notes || '-'}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Payment Modal */}
      <AnimatePresence>
        {showPaymentModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.payment}</h2>
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(false)}
                    className="text-slate-500 hover:text-slate-900"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleLogPayment} className="p-5 space-y-4">
                  {paymentError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
                      {paymentError}
                    </div>
                  )}

                  <div className="bg-slate-100 border border-slate-200 rounded-lg p-3">
                    <p className="text-slate-500 text-xs">{T.balance}</p>
                    <p className="text-orange-600 font-bold text-lg">{formatCurrency(invoice.balance)}</p>
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{txx.amountUsdLabel} *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={invoice.balance}
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{txx.paymentDate} *</label>
                    <input
                      type="date"
                      value={paymentForm.paymentDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{txx.paymentMethod} *</label>
                    <select
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="bank_transfer">{txx.methodBankTransfer}</option>
                      <option value="check">{txx.methodCheck}</option>
                      <option value="cash">{txx.methodCash}</option>
                      <option value="online">{txx.methodOnline}</option>
                      <option value="other">{txx.methodOther}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.reference}</label>
                    <input
                      type="text"
                      value={paymentForm.reference}
                      onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                      placeholder={txx.referencePlaceholder}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.notes}</label>
                    <textarea
                      value={paymentForm.notes}
                      onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                      rows={2}
                      placeholder={txx.notesPlaceholder}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={loggingPayment}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loggingPayment && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {loggingPayment ? T.loading : T.save}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Override Status Modal */}
      <AnimatePresence>
        {showStatusModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStatusModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.status}</h2>
                  <button
                    type="button"
                    onClick={() => setShowStatusModal(false)}
                    className="text-slate-500 hover:text-slate-900"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleOverrideStatus} className="p-5 space-y-4">
                  {statusError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
                      {statusError}
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{txx.newStatusLabel} *</label>
                    <select
                      value={overrideStatus}
                      onChange={(e) => setOverrideStatus(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="">{txx.selectStatusPlaceholder}</option>
                      <option value="pending">{T.pendingStatus}</option>
                      <option value="partial">{T.partial}</option>
                      <option value="paid">{T.paid}</option>
                      <option value="overdue">{T.overdue}</option>
                      <option value="frozen">{T.frozen}</option>
                      <option value="disputed">{T.disputed}</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowStatusModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={submittingStatus}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {submittingStatus && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {submittingStatus ? T.loading : T.save}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Refund Confirmation Modal */}
      <AnimatePresence>
        {showRefundConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRefundConfirm(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.refunded}</h3>
                    <p className="text-slate-500 text-sm mt-2">
                      {txx.refundConfirmPrefix} <span className="text-slate-900 font-medium">{invoice.invoiceNumber}</span>{txx.refundConfirmSuffix}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowRefundConfirm(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleRefund}
                      disabled={refunding}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {refunding && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {refunding ? T.loading : T.confirm}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
