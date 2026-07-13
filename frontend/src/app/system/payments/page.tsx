'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  CreditCard,
  Filter,
  X,
  Calendar,
  Search,
  CheckSquare,
  Square,
  Zap,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getPaymentsTranslations, getPaymentsExtraTranslations } from '@/lib/translations';

// --------------- Interfaces ---------------

interface PaymentItem {
  _id: string;
  invoice: {
    _id: string;
    invoiceNumber: string;
    amount: number;
    balance: number;
    status: string;
  };
  customer: {
    _id: string;
    companyName: string;
  };
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  notes?: string;
  receivedBy?: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

interface PaymentsResponse {
  payments: PaymentItem[];
  total: number;
  page: number;
  pages: number;
}

interface Customer {
  _id: string;
  companyName: string;
  customerNumber?: string;
}

interface CustomersResponse {
  customers: Customer[];
  total: number;
}

interface OpenInvoice {
  _id: string;
  invoiceNumber: string;
  amount: number;
  balance: number;
  status: string;
  dueDate: string;
}

interface InvoicesResponse {
  invoices: OpenInvoice[];
  total: number;
}

// --------------- Constants ---------------

const getPaymentMethods = (T: any, onlineLabel: string): Record<string, string> => ({
  bank_transfer: T.bankTransfer,
  check: T.cheque,
  cash: T.cash,
  online: onlineLabel,
  other: T.other,
});

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-700',
  partial: 'bg-blue-500/20 text-blue-600',
  overdue: 'bg-red-500/20 text-red-600',
};

// --------------- Helpers ---------------

const formatCurrency = (val: number) =>
  'SAR ' + Math.round(val || 0).toLocaleString('en-US');

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

// --------------- Component ---------------

export default function PaymentsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getPaymentsTranslations(lang);
  const txx = getPaymentsExtraTranslations(lang);
  const PAYMENT_METHODS = getPaymentMethods(T, txx.online);
  const STATUS_LABELS: Record<string, string> = {
    pending: txx.statusPending,
    partial: txx.statusPartial,
    overdue: txx.statusOverdue,
  };

  // Payment listing state
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerInvoices, setCustomerInvoices] = useState<OpenInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, number>>({}); // invoiceId -> amount
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [notes, setNotes] = useState('');
  const [loggingPayment, setLoggingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // FIFO
  const [showFIFO, setShowFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState('');

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<PaymentItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Refs
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = user?.role === 'super_admin';
  const hasActiveFilters = dateFrom || dateTo;

  // --------------- Fetch Payments (listing) ---------------

  const fetchPayments = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const data = await api.get<PaymentsResponse>(`/api/payments?${params.toString()}`);
      setPayments(data.payments);
      setTotalPages(data.pages);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message || txx.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [page, dateFrom, dateTo]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // Real-time updates
  useSocket('payment:logged', fetchPayments);
  useSocket('payment:deleted', fetchPayments);

  // --------------- Fetch Customers ---------------

  const fetchCustomers = async () => {
    try {
      const data = await api.get<CustomersResponse>('/api/customers?limit=500');
      setCustomers(data.customers || []);
    } catch {
      setCustomers([]);
    }
  };

  // --------------- Fetch Customer Invoices ---------------

  const fetchCustomerInvoices = async (customerId: string) => {
    setLoadingInvoices(true);
    try {
      const [pendingData, partialData, overdueData] = await Promise.all([
        api.get<InvoicesResponse>(`/api/invoices?customer=${customerId}&status=pending&limit=500`),
        api.get<InvoicesResponse>(`/api/invoices?customer=${customerId}&status=partial&limit=500`),
        api.get<InvoicesResponse>(`/api/invoices?customer=${customerId}&status=overdue&limit=500`),
      ]);
      const allInvoices = [
        ...(pendingData.invoices || []),
        ...(partialData.invoices || []),
        ...(overdueData.invoices || []),
      ];
      setCustomerInvoices(allInvoices);
    } catch {
      setCustomerInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  };

  // --------------- Customer Selection ---------------

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter(
      (c) =>
        c.companyName.toLowerCase().includes(q) ||
        (c.customerNumber && c.customerNumber.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  const selectedCustomerObj = useMemo(
    () => customers.find((c) => c._id === selectedCustomer),
    [customers, selectedCustomer]
  );

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomer(customerId);
    setShowCustomerDropdown(false);
    setCustomerSearch('');
    setSelectedInvoices({});
    setInvoiceSearch('');
    setPaymentError('');
    fetchCustomerInvoices(customerId);
  };

  // --------------- Invoice Selection ---------------

  const filteredInvoices = useMemo(() => {
    if (!invoiceSearch.trim()) return customerInvoices;
    const q = invoiceSearch.toLowerCase();
    return customerInvoices.filter((inv) =>
      inv.invoiceNumber.toLowerCase().includes(q)
    );
  }, [customerInvoices, invoiceSearch]);

  const handleToggleInvoice = (invoiceId: string, balance: number) => {
    setSelectedInvoices((prev) => {
      const next = { ...prev };
      if (next[invoiceId] !== undefined) {
        delete next[invoiceId];
      } else {
        next[invoiceId] = balance;
      }
      return next;
    });
  };

  const handleAmountChange = (invoiceId: string, amount: number) => {
    setSelectedInvoices((prev) => ({
      ...prev,
      [invoiceId]: amount,
    }));
  };

  const handleSelectAll = () => {
    const newSelected: Record<string, number> = {};
    filteredInvoices.forEach((inv) => {
      newSelected[inv._id] = inv.balance;
    });
    setSelectedInvoices(newSelected);
  };

  const handleDeselectAll = () => {
    setSelectedInvoices({});
  };

  // --------------- Summary ---------------

  const selectedCount = Object.keys(selectedInvoices).length;
  const totalAmount = Object.values(selectedInvoices).reduce((sum, amt) => sum + amt, 0);

  // --------------- Open Modal ---------------

  const handleOpenPaymentModal = () => {
    setShowPaymentModal(true);
    setPaymentError('');
    setSelectedCustomer('');
    setCustomerSearch('');
    setShowCustomerDropdown(false);
    setCustomerInvoices([]);
    setSelectedInvoices({});
    setInvoiceSearch('');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentMethod('bank_transfer');
    setNotes('');
    setShowFIFO(false);
    setFifoAmount('');
    fetchCustomers();
  };

  // --------------- Submit Bulk Payment ---------------

  const handleSubmitBulk = async () => {
    setPaymentError('');

    if (!selectedCustomer) {
      setPaymentError(T.selectCustomer);
      return;
    }
    if (selectedCount === 0) {
      setPaymentError(T.selectInvoice);
      return;
    }

    // Validate amounts
    for (const [invoiceId, amount] of Object.entries(selectedInvoices)) {
      if (amount <= 0) {
        const inv = customerInvoices.find((i) => i._id === invoiceId);
        setPaymentError(
          `${txx.amountForPrefix}${inv?.invoiceNumber || txx.anInvoice}${txx.mustBeGreaterThanZero}`
        );
        return;
      }
      const inv = customerInvoices.find((i) => i._id === invoiceId);
      if (inv && amount > inv.balance) {
        setPaymentError(
          `${txx.amountForPrefix}${inv.invoiceNumber}${txx.cannotExceedBalance}${formatCurrency(inv.balance)}`
        );
        return;
      }
    }

    if (!paymentDate) {
      setPaymentError(T.paymentDate + txx.isRequired);
      return;
    }

    setLoggingPayment(true);
    try {
      const allocations = Object.entries(selectedInvoices).map(([invoiceId, amount]) => ({
        invoice: invoiceId,
        amount,
      }));

      await api.post('/api/payments/bulk', {
        customer: selectedCustomer,
        allocations,
        paymentDate,
        paymentMethod,
        notes: notes || undefined,
      });

      setShowPaymentModal(false);
      fetchPayments();
    } catch (err: any) {
      setPaymentError(err.message || txx.failedToLog);
    } finally {
      setLoggingPayment(false);
    }
  };

  // --------------- FIFO Auto-Allocate ---------------

  const handleFIFO = async () => {
    setPaymentError('');

    if (!selectedCustomer) {
      setPaymentError(T.selectCustomer);
      return;
    }
    const amount = Number(fifoAmount);
    if (!amount || amount <= 0) {
      setPaymentError(T.quickPay + txx.invalidAmount);
      return;
    }
    if (!paymentDate) {
      setPaymentError(T.paymentDate + txx.isRequired);
      return;
    }

    setLoggingPayment(true);
    try {
      await api.post('/api/payments/auto-allocate', {
        customer: selectedCustomer,
        totalAmount: amount,
        paymentDate,
        paymentMethod,
        notes: notes || undefined,
      });

      setShowPaymentModal(false);
      fetchPayments();
    } catch (err: any) {
      setPaymentError(err.message || txx.fifoFailed);
    } finally {
      setLoggingPayment(false);
    }
  };

  // --------------- Filters ---------------

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // --------------- Delete Payment ---------------

  const handleDeletePayment = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/payments/${deleteTarget._id}`);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      fetchPayments();
    } catch (err: any) {
      setError(err.message || txx.failedToDelete);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Close customer dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(e.target as Node)
      ) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --------------- Table Columns ---------------

  const columns = [
    {
      key: 'paymentDate',
      label: T.date,
      render: (val: string) => <span className="text-slate-900">{formatDate(val)}</span>,
    },
    {
      key: 'invoice',
      label: T.invoice + ' #',
      render: (_: any, row: PaymentItem) => (
        <span className="text-[#f37121] font-medium">
          {row.invoice?.invoiceNumber || '-'}
        </span>
      ),
    },
    {
      key: 'customer',
      label: T.customer,
      render: (_: any, row: PaymentItem) => (
        <span>{row.customer?.companyName || '-'}</span>
      ),
    },
    {
      key: 'amount',
      label: T.amount,
      render: (val: number) => (
        <span className="text-green-600 font-medium">{formatCurrency(val)}</span>
      ),
    },
    {
      key: 'paymentMethod',
      label: T.paymentMethod,
      render: (val: string) => (
        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
          {PAYMENT_METHODS[val] || val}
        </span>
      ),
    },
    {
      key: 'notes',
      label: T.notes,
      render: (val: string) => (
        <span className="text-slate-500 truncate max-w-[200px] block">{val || '-'}</span>
      ),
    },
    {
      key: 'receivedBy',
      label: T.receivedBy,
      render: (_: any, row: PaymentItem) => (
        <span>
          {row.receivedBy
            ? `${row.receivedBy.firstName} ${row.receivedBy.lastName}`
            : '-'}
        </span>
      ),
    },
  ];

  // --------------- Loading State ---------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // --------------- Render ---------------

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-[#f37121]" />
            {T.title}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{total} {T.title.toLowerCase()}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              hasActiveFilters
                ? 'bg-[#f37121]/20 text-[#f37121] border border-[#f37121]/50'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Filter className="w-4 h-4" />
            {T.search}
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-[#f37121]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              const filterParts: string[] = [];
              if (dateFrom) filterParts.push(`from-${dateFrom}`);
              if (dateTo) filterParts.push(`to-${dateTo}`);
              const suffix = filterParts.length > 0 ? `_${filterParts.join('_')}` : '';
              exportToExcel(
                payments,
                [
                  { header: T.paymentDate, key: 'paymentDate', transform: fmt.date, width: 14 },
                  { header: T.invoice + ' #', key: 'invoice.invoiceNumber', width: 18 },
                  { header: T.customer, key: 'customer.companyName', width: 25 },
                  { header: T.amount, key: 'amount', transform: fmt.money, width: 15 },
                  { header: T.paymentMethod, key: 'paymentMethod', transform: (v: any) => (PAYMENT_METHODS[v as string] || v), width: 16 },
                  { header: T.notes, key: 'notes', width: 30 },
                  { header: T.receivedBy, key: 'receivedBy', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 18 },
                  { header: T.date, key: 'createdAt', transform: fmt.datetime, width: 20 },
                ],
                `Payments${suffix}_${new Date().toISOString().split('T')[0]}`,
                'Payments'
              );
            }}
            disabled={payments.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {T.downloadExcel}
          </button>
          <button
            type="button"
            onClick={handleOpenPaymentModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors"
          >
            <Plus className="w-4 h-4" />
            {T.addPayment}
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-slate-900 font-medium text-sm">{T.search} {T.title}</h3>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[#f37121] text-xs hover:underline"
                  >
                    {T.cancel}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="filter-date-from" className="block text-slate-500 text-xs mb-1.5">
                    <Calendar className="w-3 h-3 inline me-1" />
                    {T.from}
                  </label>
                  <input
                    id="filter-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>
                <div>
                  <label htmlFor="filter-date-to" className="block text-slate-500 text-xs mb-1.5">
                    <Calendar className="w-3 h-3 inline me-1" />
                    {T.to}
                  </label>
                  <input
                    id="filter-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={payments}
        searchable
        searchPlaceholder={`${T.search}...`}
        emptyMessage={T.noPayments}
        actions={isSuperAdmin ? (row: PaymentItem) => (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); setShowDeleteConfirm(true); }}
              className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              {T.delete}
            </button>
          </div>
        ) : undefined}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">
            {lang === 'ar' ? `صفحة ${page} من ${totalPages} (${total})` : `Page ${page} of ${totalPages} (${total} payments)`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
            >
              {lang === 'ar' ? 'السابق' : 'Previous'}
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    page === pageNum
                      ? 'bg-[#f37121] text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
            >
              {lang === 'ar' ? 'التالي' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Payment Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && deleteTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                    <Trash2 className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.deletePayment}</h3>
                    <p className="text-slate-500 text-sm mt-2">
                      {T.deletePayment}: <span className="text-slate-900 font-medium">{formatCurrency(deleteTarget.amount)}</span> - {T.invoice} <span className="text-[#f37121] font-medium">{deleteTarget.invoice?.invoiceNumber || '-'}</span>
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleDeletePayment}
                      disabled={deleteLoading}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {deleteLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.delete}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ============================================================= */}
      {/* Log Payment Modal - Full-screen multi-invoice allocation       */}
      {/* ============================================================= */}
      <AnimatePresence>
        {showPaymentModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)}
              className="fixed inset-0 bg-black/70 z-50"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div
                className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <CreditCard className="w-5 h-5 text-[#f37121]" />
                    {T.addPayment}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(false)}
                    aria-label={txx.closePaymentModal}
                    className="text-slate-500 hover:text-slate-900 transition-colors p-1 rounded-lg hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body - Scrollable */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  {/* Error */}
                  {paymentError && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm"
                    >
                      {paymentError}
                    </motion.div>
                  )}

                  {/* Step 1: Customer Selection */}
                  <div>
                    <label className="block text-slate-500 text-xs font-medium mb-1.5 uppercase tracking-wider">
                      {T.customer} *
                    </label>
                    <div className="relative" ref={customerDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowCustomerDropdown(!showCustomerDropdown)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 transition-colors hover:border-slate-300"
                      >
                        <span className={selectedCustomerObj ? 'text-slate-900' : 'text-slate-500'}>
                          {selectedCustomerObj
                            ? selectedCustomerObj.companyName
                            : T.selectCustomer + '...'}
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-500 transition-transform ${
                            showCustomerDropdown ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      <AnimatePresence>
                        {showCustomerDropdown && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.15 }}
                            className="absolute z-10 start-0 end-0 mt-1 bg-slate-50 border border-slate-200 rounded-lg shadow-xl overflow-hidden"
                          >
                            {/* Search input */}
                            <div className="p-2 border-b border-slate-200">
                              <div className="relative">
                                <Search className="w-4 h-4 absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                  type="text"
                                  value={customerSearch}
                                  onChange={(e) => setCustomerSearch(e.target.value)}
                                  placeholder={`${T.search}...`}
                                  autoFocus
                                  className="w-full ps-8 pe-3 py-2 rounded-md bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#f37121]/50"
                                />
                              </div>
                            </div>
                            {/* Options list */}
                            <div className="max-h-64 overflow-y-auto">
                              {filteredCustomers.length === 0 ? (
                                <div className="px-3 py-4 text-center text-slate-500 text-sm">
                                  {T.noDataFound}
                                </div>
                              ) : (
                                filteredCustomers.map((c) => (
                                  <button
                                    key={c._id}
                                    type="button"
                                    onClick={() => handleSelectCustomer(c._id)}
                                    className={`w-full text-start px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors flex items-center justify-between ${
                                      selectedCustomer === c._id
                                        ? 'bg-[#f37121]/10 text-[#f37121]'
                                        : 'text-slate-700'
                                    }`}
                                  >
                                    <span>{c.companyName}</span>
                                    {c.customerNumber && (
                                      <span className="text-slate-500 text-xs">
                                        {c.customerNumber}
                                      </span>
                                    )}
                                  </button>
                                ))
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Step 2: Invoice Selection & Amount Allocation */}
                  {selectedCustomer && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3"
                    >
                      {/* Invoice section header */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <h3 className="text-slate-900 font-medium text-sm uppercase tracking-wider">
                          {T.invoice}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Search by invoice number */}
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="text"
                              value={invoiceSearch}
                              onChange={(e) => setInvoiceSearch(e.target.value)}
                              placeholder={`${T.search}...`}
                              className="ps-8 pe-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#f37121]/50 w-40"
                            />
                          </div>
                          {/* Select All / Deselect All */}
                          <button
                            type="button"
                            onClick={handleSelectAll}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-slate-200 transition-colors"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            {lang === 'ar' ? 'تحديد الكل' : 'Select All'}
                          </button>
                          <button
                            type="button"
                            onClick={handleDeselectAll}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-slate-200 transition-colors"
                          >
                            <Square className="w-3.5 h-3.5" />
                            {lang === 'ar' ? 'إلغاء التحديد' : 'Deselect All'}
                          </button>
                          {/* FIFO Auto-Allocate */}
                          <button
                            type="button"
                            onClick={() => setShowFIFO(!showFIFO)}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              showFIFO
                                ? 'bg-[#f37121]/20 text-[#f37121] border border-[#f37121]/50'
                                : 'bg-[#f37121] text-white hover:bg-[#e06010]'
                            }`}
                          >
                            <Zap className="w-3.5 h-3.5" />
                            {T.quickPay}
                          </button>
                        </div>
                      </div>

                      {/* FIFO Input */}
                      <AnimatePresence>
                        {showFIFO && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="bg-[#f37121]/5 border border-[#f37121]/20 rounded-lg p-4">
                              <p className="text-slate-700 text-xs mb-3">
                                {lang === 'ar'
                                  ? 'أدخل المبلغ الإجمالي. سيتم توزيعه تلقائياً على أقدم الفواتير أولاً (FIFO) ومعالجة الدفع فوراً.'
                                  : 'Enter a total amount. The backend will automatically distribute it across the oldest invoices first (FIFO) and process the payment immediately.'}
                              </p>
                              <div className="flex items-end gap-3">
                                <div className="flex-1">
                                  <label className="block text-slate-500 text-xs mb-1">
                                    {T.amount}
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={fifoAmount}
                                    onChange={(e) => setFifoAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={handleFIFO}
                                  disabled={loggingPayment || !fifoAmount}
                                  className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                  {loggingPayment && (
                                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  )}
                                  <Zap className="w-3.5 h-3.5" />
                                  {T.quickPay}
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Invoice Table */}
                      {loadingInvoices ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="w-6 h-6 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
                          <span className="ms-3 text-slate-500 text-sm">{lang === 'ar' ? 'جاري التحميل...' : 'Loading invoices...'}</span>
                        </div>
                      ) : customerInvoices.length === 0 ? (
                        <div className="text-center py-12">
                          <p className="text-slate-500 text-sm">
                            {T.noPayments}
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-slate-900 border-b border-slate-200">
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider w-10">
                                  {/* Checkbox col */}
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.invoice} #
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.amount}
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.invoiceBalance}
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.status}
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.date}
                                </th>
                                <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                  {T.amount}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {filteredInvoices.map((inv) => {
                                const isSelected = selectedInvoices[inv._id] !== undefined;
                                const allocatedAmt = selectedInvoices[inv._id] ?? '';
                                return (
                                  <tr
                                    key={inv._id}
                                    className={`transition-colors ${
                                      isSelected
                                        ? 'bg-[#f37121]/5'
                                        : 'bg-slate-50 hover:bg-slate-100'
                                    }`}
                                  >
                                    {/* Checkbox */}
                                    <td className="px-3 py-2.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleToggleInvoice(inv._id, inv.balance)
                                        }
                                        className="text-slate-500 hover:text-[#f37121] transition-colors"
                                      >
                                        {isSelected ? (
                                          <CheckSquare className="w-4.5 h-4.5 text-[#f37121]" />
                                        ) : (
                                          <Square className="w-4.5 h-4.5" />
                                        )}
                                      </button>
                                    </td>
                                    {/* Invoice Number */}
                                    <td className="px-3 py-2.5 text-sm">
                                      <span className="text-[#f37121] font-medium">
                                        {inv.invoiceNumber}
                                      </span>
                                    </td>
                                    {/* Total Amount */}
                                    <td className="px-3 py-2.5 text-sm text-slate-700">
                                      {formatCurrency(inv.amount)}
                                    </td>
                                    {/* Balance */}
                                    <td className="px-3 py-2.5 text-sm">
                                      <span className="text-orange-600 font-medium">
                                        {formatCurrency(inv.balance)}
                                      </span>
                                    </td>
                                    {/* Status */}
                                    <td className="px-3 py-2.5 text-sm">
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                          STATUS_STYLES[inv.status] ||
                                          'bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        {STATUS_LABELS[inv.status] || inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                                      </span>
                                    </td>
                                    {/* Due Date */}
                                    <td className="px-3 py-2.5 text-sm text-slate-700">
                                      {formatDate(inv.dueDate)}
                                    </td>
                                    {/* Pay Amount Input */}
                                    <td className="px-3 py-2.5">
                                      {isSelected ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0.01"
                                          max={inv.balance}
                                          value={allocatedAmt}
                                          onChange={(e) =>
                                            handleAmountChange(
                                              inv._id,
                                              Number(e.target.value)
                                            )
                                          }
                                          aria-label={`${txx.payAmountFor}${inv.invoiceNumber}`}
                                          className="w-28 px-2.5 py-1.5 rounded-md bg-slate-50 border border-[#f37121]/40 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                                        />
                                      ) : (
                                        <span className="text-slate-600 text-sm">--</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {filteredInvoices.length === 0 && customerInvoices.length > 0 && (
                                <tr>
                                  <td
                                    colSpan={7}
                                    className="px-3 py-6 text-center text-slate-500 text-sm"
                                  >
                                    {T.noDataFound}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Summary */}
                      {selectedCount > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-slate-100 border border-slate-200 rounded-lg p-4 flex items-center justify-between"
                        >
                          <div className="text-sm text-slate-700">
                            <span className="text-slate-900 font-medium">{selectedCount}</span>{' '}
                            {T.invoice}{selectedCount !== 1 ? (lang === 'ar' ? '' : 's') : ''}
                          </div>
                          <div className="text-sm">
                            <span className="text-slate-500 me-2">{T.amount}:</span>
                            <span className="text-green-600 font-bold text-base">
                              {formatCurrency(totalAmount)}
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}

                  {/* Step 3: Payment Details */}
                  {selectedCustomer && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-4"
                    >
                      {/* Payment Date */}
                      <div>
                        <label htmlFor="modal-payment-date" className="block text-slate-500 text-xs font-medium mb-1.5 uppercase tracking-wider">
                          {T.paymentDate} *
                        </label>
                        <input
                          id="modal-payment-date"
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                        />
                      </div>

                      {/* Payment Method */}
                      <div>
                        <label htmlFor="modal-payment-method" className="block text-slate-500 text-xs font-medium mb-1.5 uppercase tracking-wider">
                          {T.paymentMethod} *
                        </label>
                        <select
                          id="modal-payment-method"
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                        >
                          {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Notes */}
                      <div className="sm:col-span-1">
                        <label className="block text-slate-500 text-xs font-medium mb-1.5 uppercase tracking-wider">
                          {T.notes}
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={1}
                          placeholder={`${T.notes}...`}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                        />
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(false)}
                    className="px-5 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                  >
                    {T.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitBulk}
                    disabled={loggingPayment || selectedCount === 0}
                    className="px-6 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {loggingPayment && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {loggingPayment ? (lang === 'ar' ? 'جاري المعالجة...' : 'Processing...') : `${T.save}${selectedCount > 0 ? ` (${formatCurrency(totalAmount)})` : ''}`}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
