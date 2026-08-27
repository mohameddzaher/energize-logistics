'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { getInvoicesTranslations, getInvoicesExtraTranslations } from '@/lib/translations';
import DataTable from '@/components/system/DataTable';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FileText, Filter, X, Calendar, AlertTriangle, CheckCircle, Trash2, Pencil } from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

interface Customer {
  _id: string;
  companyName: string;
  creditTerm: number;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  customer: { _id: string; companyName: string; creditTerm: number; branch?: string };
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
}

interface InvoicesResponse {
  invoices: Invoice[];
  total: number;
  page: number;
  pages: number;
}

interface CustomersResponse {
  customers: Customer[];
  total: number;
}

const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  paid: { bg: 'bg-green-500/20', text: 'text-green-600' },
  partial: { bg: 'bg-yellow-500/20', text: 'text-yellow-700' },
  overdue: { bg: 'bg-red-500/20', text: 'text-red-600' },
  pending: { bg: 'bg-blue-500/20', text: 'text-blue-600' },
  frozen: { bg: 'bg-slate-500/20', text: 'text-slate-500' },
  disputed: { bg: 'bg-orange-500/20', text: 'text-orange-600' },
  refunded: { bg: 'bg-slate-500/20', text: 'text-slate-500' },
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  paid: 'paid',
  partial: 'partial',
  overdue: 'overdue',
  pending: 'pendingStatus',
  frozen: 'frozen',
  disputed: 'disputed',
  refunded: 'refunded',
};

export default function InvoicesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getInvoicesTranslations(lang);
  const txx = getInvoicesExtraTranslations(lang);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    customer: '',
    amount: '',
    invoiceDate: new Date().toISOString().split('T')[0],
  });

  const canCreate = user?.role === 'admin' || user?.role === 'super_admin';
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';

  // Action confirmation
  const [confirmAction, setConfirmAction] = useState<{ type: string; invoice: Invoice } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const handleMarkPaid = async (invoiceId: string) => {
    setActionLoading(true);
    try {
      await api.post(`/api/invoices/${invoiceId}/mark-paid`);
      setConfirmAction(null);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefund = async (invoiceId: string) => {
    setActionLoading(true);
    try {
      await api.post(`/api/invoices/${invoiceId}/refund`);
      setConfirmAction(null);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // تعديل الفاتورة: القيمة والاستحقاق والملاحظات — والعميل لا يُغيَّر، فتلك
  // فاتورةٌ أخرى تُنشأ باسمه.
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editInvForm, setEditInvForm] = useState({ amount: '', dueDate: '', notes: '' });
  const [editInvLoading, setEditInvLoading] = useState(false);

  const openEditInvoice = (row: Invoice) => {
    setEditInvoice(row);
    setEditInvForm({
      amount: String(row.amount ?? ''),
      dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      notes: (row as any).notes || '',
    });
  };

  const handleUpdateInvoice = async () => {
    if (!editInvoice) return;
    setEditInvLoading(true);
    try {
      await api.put(`/api/invoices/${editInvoice._id}`, {
        amount: Number(editInvForm.amount) || 0,
        dueDate: editInvForm.dueDate || undefined,
        notes: editInvForm.notes,
      });
      setEditInvoice(null);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setEditInvLoading(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    setActionLoading(true);
    try {
      await api.delete(`/api/invoices/${invoiceId}`);
      setConfirmAction(null);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const fetchInvoices = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (overdueOnly) params.set('overdue', 'true');

      const data = await api.get<InvoicesResponse>(`/api/invoices?${params.toString()}`);
      setInvoices(data.invoices);
      setTotalPages(data.pages);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, overdueOnly]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Real-time updates
  useSocket('invoice:created', fetchInvoices);
  useSocket('invoice:updated', fetchInvoices);
  useSocket('payment:logged', fetchInvoices);
  useSocket('invoice:refunded', fetchInvoices);
  useSocket('invoice:deleted', fetchInvoices);
  useSocket('payment:deleted', fetchInvoices);

  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const data = await api.get<CustomersResponse>('/api/customers?limit=500');
      setCustomers(data.customers || []);
    } catch {
      setCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleOpenCreate = () => {
    setShowCreateModal(true);
    setCreateError('');
    setFormData({
      invoiceNumber: '',
      customer: '',
      amount: '',
      invoiceDate: new Date().toISOString().split('T')[0],
    });
    fetchCustomers();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    if (!formData.invoiceNumber.trim()) {
      setCreateError(`${T.invoiceNumber} ${T.status === 'الحالة' ? 'مطلوب' : 'is required'}`);
      return;
    }
    if (!formData.customer) {
      setCreateError(T.selectCustomer);
      return;
    }
    if (!formData.amount || Number(formData.amount) <= 0) {
      setCreateError(`${T.amount} > 0`);
      return;
    }
    if (!formData.invoiceDate) {
      setCreateError(`${T.invoiceDate} ${T.status === 'الحالة' ? 'مطلوب' : 'is required'}`);
      return;
    }

    setCreating(true);
    try {
      await api.post('/api/invoices', {
        invoiceNumber: formData.invoiceNumber.trim(),
        customer: formData.customer,
        amount: Number(formData.amount),
        invoiceDate: formData.invoiceDate,
      });
      setShowCreateModal(false);
      fetchInvoices();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setOverdueOnly(false);
    setPage(1);
  };

  const hasActiveFilters = statusFilter || dateFrom || dateTo || overdueOnly;

  const exportColumns: ExportColumn[] = [
    { header: T.invoiceNumber, key: 'invoiceNumber', width: 18 },
    { header: T.customer, key: 'customer.companyName', width: 25 },
    { header: T.amount, key: 'amount', transform: fmt.money, width: 15 },
    { header: T.paidAmount, key: 'paidAmount', transform: fmt.money, width: 15 },
    { header: T.balance, key: 'balance', transform: fmt.money, width: 15 },
    { header: T.invoiceDate, key: 'invoiceDate', transform: fmt.date, width: 14 },
    { header: T.dueDate, key: 'dueDate', transform: fmt.date, width: 14 },
    { header: T.remainingDays, key: 'remainingDays', width: 16 },
    { header: T.overdueDays, key: 'overdueDays', width: 14 },
    { header: T.status, key: 'status', transform: fmt.status, width: 12 },
    { header: T.creditTerm, key: 'creditTerm', width: 12 },
  ];
  // الترقيم على الخادم: ما في الذاكرة خمسون صفًّا مهما بلغ عدد نتائج الفلتر،
  // فتصدير «المعروض» من غير إعادة جلبٍ كان يعطي ملفًّا ناقصًا بلا أيّ إنذار.
  const fetchForExport = async (withFilters: boolean) => {
    const params = new URLSearchParams({ page: '1', limit: '100000' });
    if (withFilters) {
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (overdueOnly) params.set('overdue', 'true');
    }
    const data = await api.get<InvoicesResponse>(`/api/invoices?${params.toString()}`);
    return [{ name: T.title, rows: data.invoices || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: T.title, rows: invoices, columns: exportColumns }] },
    { key: 'matching', label: hasActiveFilters ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(total) },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];
  const exportSuffix = (() => {
    const parts: string[] = [];
    if (statusFilter) parts.push(statusFilter);
    if (dateFrom) parts.push(`from-${dateFrom}`);
    if (dateTo) parts.push(`to-${dateTo}`);
    if (overdueOnly) parts.push('overdue');
    return parts.length > 0 ? `_${parts.join('_')}` : '';
  })();

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

  const getRemainingDaysColor = (days: number) => {
    if (days < 0) return 'text-red-600';
    if (days <= 5) return 'text-red-600';
    if (days <= 15) return 'text-yellow-700';
    return 'text-green-600';
  };

  const columns = [
    {
      key: 'invoiceNumber',
      label: T.invoiceNumber,
      render: (val: string) => (
        <span className="text-slate-900 font-medium">{val}</span>
      ),
    },
    {
      key: 'customer',
      label: T.customer,
      render: (_: any, row: Invoice) => (
        <span>{row.customer?.companyName || '-'}</span>
      ),
    },
    {
      key: 'amount',
      label: T.amount,
      render: (val: number) => (
        <span className="text-slate-900 font-medium">{formatCurrency(val)}</span>
      ),
    },
    {
      key: 'paidAmount',
      label: T.paidAmount,
      render: (val: number) => (
        <span className="text-green-600">{formatCurrency(val)}</span>
      ),
    },
    {
      key: 'balance',
      label: T.balance,
      render: (val: number) => (
        <span className={val > 0 ? 'text-orange-600 font-medium' : 'text-slate-500'}>
          {formatCurrency(val)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      label: T.dueDate,
      render: (val: string) => formatDate(val),
    },
    {
      key: 'remainingDays',
      label: T.remainingDays,
      render: (val: number, row: Invoice) => {
        if (row.status === 'paid') {
          return <span className="text-slate-500">-</span>;
        }
        const label = val < 0 ? `${Math.abs(val)}${txx.daysUnit} ${T.overdue}` : `${val}${txx.daysUnit}`;
        return (
          <span className={`font-medium ${getRemainingDaysColor(val)}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: T.status,
      render: (val: string) => {
        const badge = STATUS_BADGES[val] || STATUS_BADGES.pending;
        const labelKey = STATUS_LABEL_KEYS[val] || 'pendingStatus';
        return (
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
            {(T as any)[labelKey]}
          </span>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
            <FileText className="w-6 h-6 text-[#f37121]" />
            {T.title}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{total} {T.invoices}</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu fileName={`${T.title}${exportSuffix}`} lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={T.export} options={exportOptions} />
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
            {T.filters}
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-[#f37121]" />
            )}
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors"
            >
              <Plus className="w-4 h-4" />
              {T.addInvoice}
            </button>
          )}
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
                <h3 className="text-slate-900 font-medium text-sm">{T.searchInvoices}</h3>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[#f37121] text-xs hover:underline"
                  >
                    {T.clearFilters}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Status */}
                <div>
                  <label className="block text-slate-500 text-xs mb-1.5">{T.status}</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.selectStatus}</option>
                    <option value="pending">{T.pendingStatus}</option>
                    <option value="partial">{T.partial}</option>
                    <option value="paid">{T.paid}</option>
                    <option value="overdue">{T.overdue}</option>
                    <option value="frozen">{T.frozen}</option>
                    <option value="disputed">{T.disputed}</option>
                    <option value="refunded">{T.refunded}</option>
                  </select>
                </div>

                {/* Date From */}
                <div>
                  <label className="block text-slate-500 text-xs mb-1.5">{T.from}</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>

                {/* Date To */}
                <div>
                  <label className="block text-slate-500 text-xs mb-1.5">{T.to}</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>

                {/* Overdue Toggle */}
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overdueOnly}
                      onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }}
                      className="w-4 h-4 rounded border-slate-200 bg-slate-50 text-[#f37121] focus:ring-[#f37121]/50"
                    />
                    <span className="text-sm text-slate-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                      {T.showOverdueOnly}
                    </span>
                  </label>
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
        data={invoices}
        searchable
        searchPlaceholder={T.searchInvoices}
        onRowClick={(row) => router.push(`/system/invoices/${row._id}`)}
        emptyMessage={T.noInvoices}
        actions={isAdmin ? (row: Invoice) => (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {/* ── التعديل ──────────────────────────────────────────────────
                كانت الفاتورة تُنشأ وتُسدَّد وتُحذف ولا تُصحَّح: قيمةٌ كُتبت
                خطأً كان علاجُها حذفَ الفاتورة كلّها — بدفعاتها. والتعديل في
                الخادم يعيد حساب الرصيد وحالة الفاتورة ورصيد العميل معًا، ولا
                ينزل بالقيمة تحت ما سُدِّد منها فعلًا. */}
            <button
              type="button"
              onClick={() => openEditInvoice(row)}
              className="text-xs text-[#f37121] hover:text-[#e06010] font-medium flex items-center gap-1"
            >
              <Pencil className="w-3 h-3" />
              {T.edit || (lang === 'ar' ? 'تعديل' : 'Edit')}
            </button>
            {row.status !== 'paid' && row.status !== 'refunded' && row.status !== 'frozen' && (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'mark-paid', invoice: row })}
                className="text-xs text-green-600 hover:text-green-700 font-medium"
              >
                {T.markAsPaid}
              </button>
            )}
            {isSuperAdmin && row.status !== 'refunded' && (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'refund', invoice: row })}
                className="text-xs text-red-600 hover:text-red-700 font-medium"
              >
                {T.refunded}
              </button>
            )}
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'delete', invoice: row })}
                className="text-xs text-red-500 hover:text-red-600 font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {T.delete}
              </button>
            )}
          </div>
        ) : undefined}
      />

      {/* Edit Invoice Modal */}
      {editInvoice && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setEditInvoice(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl">
              <div className="px-5 py-4 border-b border-slate-200">
                <h3 className="font-bold text-slate-900">{lang === 'ar' ? 'تعديل الفاتورة' : 'Edit invoice'} {editInvoice.invoiceNumber}</h3>
              </div>
              <div className="p-5 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">{T.amount}</span>
                  <input type="number" step="0.01" value={editInvForm.amount}
                    onChange={(e) => setEditInvForm((f) => ({ ...f, amount: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  <span className="text-[11px] text-slate-400">
                    {lang === 'ar' ? `المسدَّد منها ${(editInvoice.paidAmount ?? 0).toLocaleString('en-US')} — لا تنزل القيمة تحته.`
                      : `Paid so far ${(editInvoice.paidAmount ?? 0).toLocaleString('en-US')} — the amount cannot go below it.`}
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">{T.dueDate}</span>
                  <input type="date" value={editInvForm.dueDate}
                    onChange={(e) => setEditInvForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">{T.notes}</span>
                  <textarea rows={2} value={editInvForm.notes}
                    onChange={(e) => setEditInvForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </label>
              </div>
              <div className="flex gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50">
                <button type="button" onClick={() => setEditInvoice(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">{T.cancel}</button>
                <button type="button" onClick={handleUpdateInvoice} disabled={editInvLoading || !editInvForm.amount}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                  {editInvLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {T.save || (lang === 'ar' ? 'حفظ' : 'Save')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">
            {T.page} {page} {T.of} {totalPages} ({total} {T.invoices})
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
            >
              {T.previous}
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
              {T.next}
            </button>
          </div>
        </div>
      )}

      {/* Action Confirmation Modal */}
      <AnimatePresence>
        {confirmAction && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmAction(null)} className="fixed inset-0 bg-black/60 z-50" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
                <div className="text-center space-y-4">
                  <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${confirmAction.type === 'delete' || confirmAction.type === 'refund' ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                    {confirmAction.type === 'delete' ? <Trash2 className="w-6 h-6 text-red-600" /> : confirmAction.type === 'refund' ? <AlertTriangle className="w-6 h-6 text-red-600" /> : <CheckCircle className="w-6 h-6 text-green-600" />}
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">
                      {confirmAction.type === 'mark-paid' ? T.markAsPaid : confirmAction.type === 'delete' ? T.deleteInvoice : T.refunded}
                    </h3>
                    <p className="text-slate-500 text-sm mt-2">
                      {confirmAction.type === 'mark-paid'
                        ? `${T.markAsPaid} ${confirmAction.invoice.invoiceNumber}?`
                        : confirmAction.type === 'delete'
                        ? `${T.deleteInvoice} ${confirmAction.invoice.invoiceNumber}?`
                        : `${T.refunded} ${confirmAction.invoice.invoiceNumber}?`}
                    </p>
                  </div>
                  {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setConfirmAction(null); setActionError(''); }} className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">{T.cancel}</button>
                    <button type="button" disabled={actionLoading} onClick={() => confirmAction.type === 'mark-paid' ? handleMarkPaid(confirmAction.invoice._id) : confirmAction.type === 'delete' ? handleDeleteInvoice(confirmAction.invoice._id) : handleRefund(confirmAction.invoice._id)} className={`flex-1 px-4 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 ${confirmAction.type === 'delete' || confirmAction.type === 'refund' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                      {actionLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {confirmAction.type === 'mark-paid' ? T.confirm : confirmAction.type === 'delete' ? T.delete : T.refunded}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Invoice Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
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
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.addInvoice}</h2>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="text-slate-500 hover:text-slate-900"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  {createError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
                      {createError}
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.invoiceNumber} *</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                      placeholder={txx.invoiceNumberPlaceholder}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.customer} *</label>
                    {loadingCustomers ? (
                      <div className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-sm">
                        {T.loading}
                      </div>
                    ) : (
                      <select
                        value={formData.customer}
                        onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      >
                        <option value="">{T.selectCustomer}...</option>
                        {customers.map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.companyName} ({c.creditTerm}{txx.daysUnit} {T.creditTerm})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.amount} *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.invoiceDate} *</label>
                    <input
                      type="date"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={creating}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {creating && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {creating ? T.loading : T.addInvoice}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
