'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getOverdueTranslations, getOverdueExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import DataTable from '@/components/system/DataTable';
import { AlertTriangle, Search, Filter, ChevronDown } from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

interface OverdueInvoice {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  balance: number;
  status: string;
  overdueDays: number;
  customer?: {
    _id: string;
    companyName: string;
    customerNumber?: string;
    grade?: string;
    salesManager?: string;
    office?: string;
    assignedCollector?: {
      firstName: string;
      lastName: string;
    };
  };
}

export default function OverduePage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOverdueTranslations(lang);
  const txx = getOverdueExtraTranslations(lang);
  const router = useRouter();
  const [invoices, setInvoices] = useState<OverdueInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchOverdue = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      const data = await api.get<any>(`/api/analytics/overdue?${params}`);
      setInvoices(data.invoices || []);
      setTotal(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchOverdue();
  }, [fetchOverdue]);

  const exportColumns: ExportColumn[] = [
    { header: 'Customer', key: 'customer.companyName', width: 25 },
    { header: 'Customer #', key: 'customer.customerNumber', width: 14 },
    { header: 'Invoice #', key: 'invoiceNumber', width: 18 },
    { header: 'Invoice Date', key: 'invoiceDate', transform: fmt.date, width: 14 },
    { header: 'Due Date', key: 'dueDate', transform: fmt.date, width: 14 },
    { header: 'Overdue Days', key: 'overdueDays', width: 14 },
    { header: 'Amount', key: 'amount', transform: fmt.money, width: 15 },
    { header: 'Outstanding', key: 'balance', transform: fmt.money, width: 15 },
    { header: 'Collector', key: 'customer.assignedCollector', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 18 },
    { header: 'Sales Manager', key: 'customer.salesManager', width: 18 },
    { header: 'Grade', key: 'customer.grade', width: 8 },
    { header: 'Status', key: 'status', transform: fmt.status, width: 12 },
  ];
  // الصفحة خمسون فاتورة والمتأخّرات تُعَدّ بالمئات؛ فمن يبحث ثمّ يصدّر كان يأخذ
  // أوّل خمسينَ من نتيجته ويحسبها كلَّها. النطاقان الأخيران يعيدان الجلب بحدٍّ مفتوح.
  const fetchForExport = async (withFilters: boolean) => {
    const params = new URLSearchParams({ page: '1', limit: '100000' });
    if (withFilters && search) params.set('search', search);
    const data = await api.get<any>(`/api/analytics/overdue?${params}`);
    return [{ name: 'Overdue', rows: data.invoices || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: 'Overdue', rows: invoices, columns: exportColumns }] },
    { key: 'matching', label: search ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(total) },
    ...(search ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];

  useSocket('payment:logged', fetchOverdue);
  useSocket('invoice:updated', fetchOverdue);
  useSocket('invoice:deleted', fetchOverdue);
  useSocket('customer:deleted', fetchOverdue);

  const formatCurrency = (val: number) =>
    'SAR ' + Math.round(val || 0).toLocaleString('en-US');

  const formatDate = (d: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

  const gradeBadge = (grade?: string) => {
    const colors: Record<string, string> = {
      A: 'bg-green-500/20 text-green-600',
      B: 'bg-blue-500/20 text-blue-600',
      C: 'bg-yellow-500/20 text-yellow-700',
      D: 'bg-red-500/20 text-red-600',
    };
    return grade ? (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[grade] || 'bg-slate-500/20 text-slate-500'}`}>
        {grade}
      </span>
    ) : '-';
  };

  const columns = [
    {
      key: 'customer.companyName',
      label: T.customer,
      render: (row: OverdueInvoice) => (
        <div>
          <span className="text-slate-900 font-medium text-sm">{row.customer?.companyName || '-'}</span>
          {row.customer?.customerNumber && (
            <span className="text-slate-500 text-xs block">{row.customer.customerNumber}</span>
          )}
        </div>
      ),
    },
    { key: 'invoiceNumber', label: T.invoiceNumber, render: (row: OverdueInvoice) => <span className="text-[#f37121] font-medium text-sm">{row.invoiceNumber}</span> },
    { key: 'invoiceDate', label: T.invoiceDate, render: (row: OverdueInvoice) => <span className="text-slate-700 text-sm">{formatDate(row.invoiceDate)}</span> },
    { key: 'dueDate', label: T.dueDate, render: (row: OverdueInvoice) => <span className="text-slate-700 text-sm">{formatDate(row.dueDate)}</span> },
    {
      key: 'overdueDays',
      label: T.overdueDays,
      render: (row: OverdueInvoice) => (
        <span className={`text-sm font-bold ${row.overdueDays > 60 ? 'text-red-600' : row.overdueDays > 30 ? 'text-yellow-700' : 'text-orange-600'}`}>
          {row.overdueDays}d
        </span>
      ),
    },
    { key: 'balance', label: T.balance, render: (row: OverdueInvoice) => <span className="text-red-600 font-medium text-sm">{formatCurrency(row.balance)}</span> },
    {
      key: 'collector',
      label: T.assignedCollector,
      render: (row: OverdueInvoice) => {
        const c = row.customer?.assignedCollector;
        return c ? <span className="text-slate-700 text-sm">{c.firstName} {c.lastName}</span> : <span className="text-slate-500 text-sm">-</span>;
      },
    },
    { key: 'salesManager', label: T.salesManager, render: (row: OverdueInvoice) => <span className="text-slate-700 text-sm">{row.customer?.salesManager || '-'}</span> },
    { key: 'grade', label: T.grade, render: (row: OverdueInvoice) => gradeBadge(row.customer?.grade) },
    {
      key: 'status',
      label: T.status,
      render: (row: OverdueInvoice) => {
        const colors: Record<string, string> = {
          overdue: 'bg-red-500/20 text-red-600',
          pending: 'bg-blue-500/20 text-blue-600',
          partial: 'bg-yellow-500/20 text-yellow-700',
          disputed: 'bg-orange-500/20 text-orange-600',
        };
        const labels: Record<string, string> = {
          overdue: txx.statusOverdue,
          pending: txx.statusPending,
          partial: txx.statusPartial,
          disputed: txx.statusDisputed,
        };
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[row.status] || 'bg-slate-500/20 text-slate-500'}`}>
            {labels[row.status] || row.status}
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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{total} {txx.overdueInvoicesCount}</p>
          </div>
        </div>
        <ExportMenu
          fileName={`Overdue_Invoices${search ? `_search-${search}` : ''}`}
          lang={lang === 'ar' ? 'ar' : 'en'}
          variant="subtle"
          label={T.export}
          options={exportOptions}
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={T.searchOverdue}
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">{error}</div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={invoices}
        onRowClick={(row: OverdueInvoice) => router.push(`/system/invoices/${row._id}`)}
        emptyMessage={T.noOverdue}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">{T.page} {page} {T.of} {totalPages} ({total} {T.invoices})</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 hover:bg-slate-100 transition-colors"
            >
              {T.previous}
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 hover:bg-slate-100 transition-colors"
            >
              {T.next}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
