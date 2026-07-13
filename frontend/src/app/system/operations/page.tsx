'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnFilter } from '@/components/ColumnFilter';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getOperationsTranslations } from '@/lib/translations';
import { SHIPMENT_STATUSES, PAYMENT_METHODS } from '@/lib/ops';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import {
  ClipboardList, Plus, Search, Filter, FilterX, Upload,
  Lock, Unlock, Edit, Trash2, ArrowRight, Loader2, X, FileSpreadsheet, Calendar, AlertCircle,
  CheckSquare, Check
} from 'lucide-react';

interface Workflow {
  _id: string;
  reportNumber: string;
  reportDate: string;
  fromLocation: string;
  toLocation: string;
  branch: string;
  carOwner: string;
  carNumber: string;
  ownerType: string;
  executionStatus: string;
  applicationStatus: string;
  paymentMethod: string;
  username: string;
  userPhone: string;
  taxIndicator: string;
  purchaseValue: number;
  sellingValue: number;
  loadingTime: string;
  driverRentalType: string;
  reference: string;
  driverName: string;
  driverPhone: string;
  carName: string;
  plateNumber: string;
  truckType: string;
  truckSize: string;
  loadType: string;
  quantity: string;
  goodsValue: number;
  representativeName: string;
  country: string;
  operationsReview: string;
  paymentDate: string;
  payingBranch: string;
  finalReportDestination: string;
  documentNumber: string;
  sendingDate: string;
  deliveryDate: string;
  accountingReview: string;
  invoiceNumber: string;
  netInvoice: number;
  tax: number;
  totalInvoice: number;
  invoiceDate: string;
  invoiceNotes: string;
  collectionDate: string;
  stage: string;
  lockedBy: { _id: string; firstName: string; lastName: string } | null;
  lockedByName: string;
  lockedAt: string | null;
  createdAt: string;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  submitted_to_ops: { label: 'Submitted to Ops', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  ops_completed: { label: 'Ops Completed', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  submitted_to_collections: { label: 'To Collections', color: 'text-purple-600', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-500/20' },
};

// Stable empty set so unfiltered columns don't create new refs each render.
const EMPTY_SET = new Set<string>();
// Columns whose filter-dropdown labels should be formatted as dates / money.
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUM_FIELDS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice']);

export default function OperationsWorkflowPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);
  // Translate raw UPL status/payment values for DISPLAY only (stored raw, so new
  // values the vendor adds still show — falling back to the raw value).
  const trStatus = (v: string) => { const s = SHIPMENT_STATUSES.find((x) => x.key === v); return s ? (lang === 'ar' ? s.ar : s.en) : v; };
  const trPayment = (v: string) => { const p = PAYMENT_METHODS.find((x) => x.value === v); return p ? (lang === 'ar' ? p.ar : p.en) : v; };

  const stageLabels: Record<string, string> = {
    draft: T.draft,
    submitted_to_ops: T.submittedToOps,
    ops_completed: T.opsCompleted,
    submitted_to_collections: T.toCollections,
    completed: T.completedStage,
  };
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Workflow>>({});
  // Which field's input to auto-focus after a click-to-edit (so a single click
  // on a cell drops you straight into typing).
  const [focusField, setFocusField] = useState<string | null>(null);
  // Fields pulled from the Operations Platform (read-only in this table — you
  // edit them at the source). Everything else is manually entered here and is
  // click-to-edit. المرحلة/stage is system-driven too.
  const SYSTEM_FIELDS = new Set<string>([
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
    'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
    'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue', 'loadingTime',
    'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
    'reference', 'representativeName', 'stage',
  ]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [showBulkReview, setShowBulkReview] = useState(false);
  const [bulkReviewText, setBulkReviewText] = useState('تم');
  // Excel-style per-column filters: field → set of allowed raw string values.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  // Once the user engages any column filter we load the WHOLE matching dataset
  // (not just the current 50-row page) so the filter spans everything, then
  // paginate client-side.
  const [loadAll, setLoadAll] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const hasColFilters = Object.keys(colFilters).length > 0;

  const role = user?.role || '';
  const canCreate = role === 'super_admin' || role === 'moderator';
  const canDelete = role === 'super_admin';
  // Financial columns (invoice #, net, tax, total, invoice/collection dates,
  // stage) are only visible to owners + accounting. Everyone else never sees them.
  const canViewFinancials = ['super_admin', 'admin', 'finance_manager', 'accountant'].includes(role);
  // Who may tick the accounting-review checkbox (matches backend write access).
  const canEditAccountingReview = ['super_admin', 'admin', 'finance_manager', 'accountant'].includes(role);
  // Who may tick the operations-review checkbox (matches backend `operations` group).
  const canEditOperationsReview = ['super_admin', 'operations_manager'].includes(role);

  // Aggregates over the WHOLE matching dataset (all ~27k rows, not one page).
  const [stats, setStats] = useState<{ total: number; pendingInvoices: number; sumPurchaseValue: number }>({ total: 0, pendingInvoices: 0, sumPurchaseValue: 0 });

  const fetchWorkflows = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) {
        if (!initialLoadDone.current) setLoading(true);
        else setSearching(true);
      }
      const params = new URLSearchParams();
      if (stageFilter) params.append('stage', stageFilter);
      if (search) params.append('search', search);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (showPendingOnly) {
        params.append('pendingOnly', 'true');
        params.append('page', '1');
        params.append('limit', '10000');
      } else if (loadAll) {
        // Full dataset for client-side Excel-style column filtering.
        params.append('page', '1');
        params.append('limit', '100000');
      } else {
        params.append('page', String(page));
        params.append('limit', '50');
      }
      const data = await api.get<any>(`/api/workflows?${params.toString()}`);
      setWorkflows(data.workflows || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
      setSearching(false);
      initialLoadDone.current = true;
    }
  }, [stageFilter, search, page, dateFrom, dateTo, showPendingOnly, loadAll]);

  // Initial load
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Fetch full-dataset aggregates (for the summary cards) whenever the server
  // filters change. Reflects all matching rows, not just the loaded page.
  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.append('stage', stageFilter);
      if (search) params.append('search', search);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      const data = await api.get<any>(`/api/workflows/stats?${params.toString()}`);
      setStats({ total: data.total || 0, pendingInvoices: data.pendingInvoices || 0, sumPurchaseValue: data.sumPurchaseValue || 0 });
    } catch { /* non-critical */ }
  }, [stageFilter, search, dateFrom, dateTo]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Clear selection when filters/page change
  useEffect(() => { setSelectedIds(new Set()); }, [stageFilter, search, page, dateFrom, dateTo]);

  // Apply the Excel-style column filters client-side over the loaded rows.
  const displayed = useMemo(() => {
    const fields = Object.keys(colFilters);
    if (!fields.length) return workflows;
    return workflows.filter((row) => fields.every((f) => colFilters[f].has(String((row as any)[f] ?? ''))));
  }, [workflows, colFilters]);

  // Client-side pagination when in full-load mode (filtering); otherwise the
  // server already paginated to 50. Note the server-mode branch ALSO slices to a
  // single page: when leaving full-load mode (e.g. "clear filters") `workflows`
  // still briefly holds the whole dataset before the 50-row refetch lands, and
  // rendering tens of thousands of <tr> at once would freeze the tab.
  const CLIENT_PAGE_SIZE = 50;
  const clientMode = loadAll || showPendingOnly;
  const clientPaged = clientMode
    ? displayed.slice((clientPage - 1) * CLIENT_PAGE_SIZE, clientPage * CLIENT_PAGE_SIZE)
    : displayed.slice(0, CLIENT_PAGE_SIZE);

  const setColFilter = (field: string, set: Set<string>) => {
    if (!loadAll) setLoadAll(true);
    setClientPage(1);
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size === 0) delete next[field]; else next[field] = set;
      return next;
    });
  };

  // Clear every column filter at once and drop back to normal server paging.
  const clearColFilters = () => {
    setColFilters({});
    setLoadAll(false);
    setClientPage(1);
  };

  // Reset client pagination when the result set changes.
  useEffect(() => { setClientPage(1); }, [stageFilter, search, dateFrom, dateTo, showPendingOnly]);

  // WebSocket real-time
  const handleCreated = useCallback((wf: Workflow) => { setWorkflows((p) => [wf, ...p]); setTotal((t) => t + 1); }, []);
  const handleUpdated = useCallback((wf: Workflow) => { setWorkflows((p) => p.map((w) => w._id === wf._id ? wf : w)); }, []);
  const handleDeleted = useCallback((d: { _id: string }) => {
    setWorkflows((p) => p.filter((w) => w._id !== d._id));
    setTotal((t) => Math.max(0, t - 1));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(d._id); return next; });
  }, []);
  const handleLocked = useCallback((d: any) => { setWorkflows((p) => p.map((w) => w._id === d._id ? { ...w, lockedBy: d.lockedBy, lockedByName: d.lockedByName, lockedAt: d.lockedAt } : w)); }, []);
  const handleUnlocked = useCallback((d: { _id: string }) => { setWorkflows((p) => p.map((w) => w._id === d._id ? { ...w, lockedBy: null, lockedByName: '', lockedAt: null } : w)); }, []);
  const handleUnlockAll = useCallback((d: { userId: string }) => { setWorkflows((p) => p.map((w) => w.lockedBy && w.lockedBy._id === d.userId ? { ...w, lockedBy: null, lockedByName: '', lockedAt: null } : w)); }, []);
  const handleBulkImported = useCallback(() => { fetchWorkflows(true); }, [fetchWorkflows]);

  useSocket('workflow:created', handleCreated);
  useSocket('workflow:updated', handleUpdated);
  useSocket('workflow:deleted', handleDeleted);
  useSocket('workflow:locked', handleLocked);
  useSocket('workflow:unlocked', handleUnlocked);
  useSocket('workflow:unlockAll', handleUnlockAll);
  useSocket('workflow:stageChanged', handleUpdated);
  useSocket('workflow:bulkImported', handleBulkImported);

  const isLockedByOther = (wf: Workflow) => {
    if (!wf.lockedBy) return false;
    if (wf.lockedAt && Date.now() - new Date(wf.lockedAt).getTime() > 5 * 60 * 1000) return false;
    return wf.lockedBy._id !== user?._id;
  };

  const getTransitions = (wf: Workflow) => {
    const map: Record<string, { stage: string; label: string; roles: string[] }[]> = {
      draft: [{ stage: 'submitted_to_ops', label: T.submitToOps, roles: ['moderator', 'super_admin'] }],
      submitted_to_ops: [
        { stage: 'ops_completed', label: T.markOpsComplete, roles: ['operations_manager', 'super_admin'] },
        { stage: 'draft', label: T.returnToDraft, roles: ['operations_manager', 'super_admin'] },
      ],
      ops_completed: [
        { stage: 'submitted_to_collections', label: T.submitToCollections, roles: ['operations_manager', 'super_admin'] },
        { stage: 'submitted_to_ops', label: T.returnToOps, roles: ['operations_manager', 'super_admin'] },
      ],
      submitted_to_collections: [
        { stage: 'completed', label: T.markComplete, roles: ['admin', 'employee', 'super_admin'] },
        { stage: 'ops_completed', label: T.returnToOps, roles: ['admin', 'employee', 'super_admin'] },
      ],
      completed: [],
    };
    return (map[wf.stage] || []).filter((t) => t.roles.includes(role));
  };

  const handleTransition = async (wfId: string, stage: string) => {
    try {
      setTransitioningId(wfId);
      await api.put(`/api/workflows/${wfId}/stage`, { stage });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTransitioningId(null);
    }
  };

  const handleDelete = (wfId: string) => {
    setConfirmModal({
      message: T.deleteWorkflowConfirm,
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/workflows/${wfId}`); } catch (err: any) { setError(err.message); }
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setConfirmModal({
      message: T.deleteBulkConfirm.replace('{count}', String(selectedIds.size)),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setBulkDeleting(true);
          await api.post('/api/workflows/bulk-delete', { ids: Array.from(selectedIds) });
          setSelectedIds(new Set());
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBulkDeleting(false);
        }
      },
    });
  };

  const handleInlineSave = async () => {
    if (!editingId) return;
    try {
      await api.put(`/api/workflows/${editingId}`, editData);
      setEditingId(null);
      setEditData({});
      setFocusField(null);
      fetchWorkflows(true);
      fetchStats();
    } catch (err: any) { setError(err.message); }
  };

  const handleInlineCancel = () => {
    setEditingId(null);
    setEditData({});
    setFocusField(null);
  };

  // Enter row-edit mode from a single cell click and remember which field to
  // focus. Skips locked rows.
  const beginEditField = (wf: Workflow, field: string) => {
    if (isLockedByOther(wf)) return;
    setEditingId(wf._id);
    setEditData({ ...wf });
    setFocusField(field);
  };

  // Accounting review is a one-click checklist toggle (تم / not) — no row edit.
  const toggleAccountingReview = async (wf: Workflow) => {
    const next = wf.accountingReview ? '' : 'تم';
    // Optimistic update so the tick feels instant.
    setWorkflows((p) => p.map((w) => w._id === wf._id ? { ...w, accountingReview: next } : w));
    try {
      await api.put(`/api/workflows/${wf._id}`, { accountingReview: next });
    } catch (err: any) {
      setError(err.message);
      fetchWorkflows(true);
    }
  };

  // Operations review is a one-click checklist toggle (تم / not) — no row edit.
  const toggleOperationsReview = async (wf: Workflow) => {
    const next = wf.operationsReview ? '' : 'تم';
    // Optimistic update so the tick feels instant.
    setWorkflows((p) => p.map((w) => w._id === wf._id ? { ...w, operationsReview: next } : w));
    try {
      await api.put(`/api/workflows/${wf._id}`, { operationsReview: next });
    } catch (err: any) {
      setError(err.message);
      fetchWorkflows(true);
    }
  };

  const handleBulkReview = async () => {
    try {
      await Promise.all(Array.from(selectedIds).map(id =>
        api.put(`/api/workflows/${id}`, { operationsReview: bulkReviewText })
      ));
      setSelectedIds(new Set());
      setShowBulkReview(false);
      fetchWorkflows(true);
    } catch (err: any) { setError(err.message); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = clientPaged.map((w) => w._id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleExportExcel = () => {
    const exportParams = new URLSearchParams();
    if (stageFilter) exportParams.append('stage', stageFilter);
    if (dateFrom) exportParams.append('dateFrom', dateFrom);
    if (dateTo) exportParams.append('dateTo', dateTo);
    const qs = exportParams.toString() ? `?${exportParams.toString()}` : '';
    window.open(`/api/workflows/export${qs}`, '_blank');
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '-';
  const formatMoney = (v: number) => v ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  // Summary cards. In "client mode" (a column filter or the pending toggle is
  // engaged) the full matching dataset is already loaded and filtered in the
  // browser, so the cards reflect `displayed` live. Otherwise they come from the
  // backend aggregate over ALL matching rows (not just the 50-row page).
  const inClientMode = hasColFilters || showPendingOnly;
  const pendingCount = inClientMode
    ? displayed.filter((w) => !w.paymentDate && !w.invoiceNumber).length
    : stats.pendingInvoices;
  const filteredRowsCount = inClientMode ? displayed.length : (stats.total || total);
  const filteredPurchaseSum = inClientMode
    ? displayed.reduce((s, w) => s + (Number(w.purchaseValue) || 0), 0)
    : stats.sumPurchaseValue;

  // A column header with an Excel-style filter funnel. `field` is the Workflow
  // key it filters on; pass filterable={false} for non-data columns.
  const ColHead = (field: keyof Workflow, label: string, color = 'text-slate-300') => (
    <th className="px-3 py-3 text-start text-xs font-semibold whitespace-nowrap">
      <span className={`inline-flex items-center ${color}`}>
        {label}
        <ColumnFilter
          rows={workflows}
          field={field as string}
          selected={colFilters[field as string] || EMPTY_SET}
          onChange={(s) => setColFilter(field as string, s)}
          onOpen={() => setLoadAll(true)}
          lang={lang}
          format={field === 'stage' ? ((v: any) => stageLabels[v] || v) : DATE_FIELDS.has(field as string) ? formatDate : NUM_FIELDS.has(field as string) ? (formatMoney as any) : undefined}
        />
      </span>
    </th>
  );

  if (loading && workflows.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <OpsLiveSummary />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-[#f37121]" />
          {T.title}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {canDelete && selectedIds.size > 0 && (
            <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {T.deleteCount} ({selectedIds.size})
            </button>
          )}
          {(role === 'operations_manager' || role === 'super_admin') && selectedIds.size > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setShowBulkReview(prev => !prev)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium transition-colors">
                <CheckSquare className="w-4 h-4" /> {lang === 'ar' ? 'مراجعة' : 'Review'} ({selectedIds.size})
              </button>
              {showBulkReview && (
                <div className="absolute top-full mt-2 end-0 bg-slate-50 border border-slate-200 rounded-lg shadow-xl z-50 p-3 min-w-[220px]">
                  <label className="block text-xs text-slate-500 mb-1">{lang === 'ar' ? 'نص المراجعة:' : 'Review text:'}</label>
                  <input
                    type="text"
                    value={bulkReviewText}
                    onChange={(e) => setBulkReviewText(e.target.value)}
                    placeholder={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    title={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    className="w-full px-2 py-1.5 rounded bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#f37121] mb-2"
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleBulkReview} className="flex-1 px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-medium transition-colors">
                      {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setShowBulkReview(false)} className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors">
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <FileSpreadsheet className="w-4 h-4" /> {T.exportExcel}
          </button>
          {canCreate && (
            <>
              <button type="button" onClick={() => router.push('/system/operations/new?mode=import')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
                <Upload className="w-4 h-4" /> {T.importExcel}
              </button>
              <button type="button" onClick={() => router.push('/system/operations/new')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> {T.newRequest}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-[260px]">
            {searching ? (
              <Loader2 className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#f37121] animate-spin" />
            ) : (
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => {
                const val = e.target.value;
                setSearchInput(val);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => { setSearch(val); setPage(1); }, 300);
              }}
              placeholder={T.searchPlaceholder}
              className="w-full ps-10 pe-8 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            />
            {searchInput && (
              <button type="button" title={T.clearSearch} onClick={() => { setSearchInput(''); setSearch(''); setPage(1); searchInputRef.current?.focus(); }} className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              title={T.fromDate}
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [&::-webkit-calendar-picker-indicator]:invert"
            />
            <span className="text-slate-500 text-sm">{T.to}</span>
            <input
              type="date"
              title={T.toDate}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [&::-webkit-calendar-picker-indicator]:invert"
            />
            {(dateFrom || dateTo) && (
              <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }} className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-red-500/50 transition-colors" title={T.clearDates}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-500" />
          {[{ value: '', label: T.all }, ...Object.entries(STAGE_CONFIG).map(([k]) => ({ value: k, label: stageLabels[k] || k }))].map((opt) => (
            <button key={opt.value} type="button" onClick={() => { setStageFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${stageFilter === opt.value ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900 border border-slate-200'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="flex items-stretch gap-3 flex-wrap">
        {/* Pending Invoices — over ALL matching rows (click to filter) */}
        <button
          type="button"
          onClick={() => setShowPendingOnly(prev => !prev)}
          className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border transition-all duration-200 ${
            showPendingOnly
              ? 'bg-amber-500/20 border-amber-500/60 ring-2 ring-amber-500/30'
              : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15 hover:border-amber-500/50'
          }`}
        >
          <div className={`p-2 rounded-lg ${showPendingOnly ? 'bg-amber-500/30' : 'bg-amber-500/20'}`}>
            <AlertCircle className="w-5 h-5 text-amber-700" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-2xl font-bold text-amber-700">{pendingCount.toLocaleString()}</span>
            <span className="text-xs text-amber-700/80">{lang === 'ar' ? 'فواتير لم تصل' : 'Pending Invoices'}</span>
          </div>
          {showPendingOnly && (
            <span className="ms-2 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/30 text-amber-700">
              {lang === 'ar' ? 'مُفعّل' : 'ACTIVE'}
            </span>
          )}
        </button>

        {/* Filtered row count — live with the active filters */}
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-blue-500/10 border-blue-500/30">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <ClipboardList className="w-5 h-5 text-blue-700" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-2xl font-bold text-blue-700">{filteredRowsCount.toLocaleString()}</span>
            <span className="text-xs text-blue-700/80">{lang === 'ar' ? 'عدد الصفوف (حسب الفلتر)' : 'Rows (filtered)'}</span>
          </div>
        </div>

        {/* Sum of purchase value for the filtered rows — finance-only */}
        {canViewFinancials && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-emerald-500/10 border-emerald-500/30">
            <div className="p-2 rounded-lg bg-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-2xl font-bold text-emerald-700">{filteredPurchaseSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className="text-xs text-emerald-700/80">{lang === 'ar' ? 'مجموع قيمة الشراء (حسب الفلتر)' : 'Total purchase value (filtered)'}</span>
            </div>
          </div>
        )}

        {/* Clear all column filters */}
        {hasColFilters && (
          <button
            type="button"
            onClick={clearColFilters}
            title={lang === 'ar' ? 'مسح كل الفلاتر' : 'Clear all filters'}
            className="flex items-center gap-2 px-4 py-3.5 rounded-xl border border-slate-300 bg-white text-slate-600 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
          >
            <FilterX className="w-5 h-5" />
            <span className="text-sm font-medium">{lang === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[3200px]">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-3 py-3 sticky start-0 bg-slate-900 z-10 w-20">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      title={T.selectAll}
                      checked={clientPaged.length > 0 && clientPaged.every((w) => selectedIds.has(w._id))}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 appearance-none rounded border border-slate-300 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                    />
                    <span className="text-xs text-slate-300 font-semibold">{T.actions}</span>
                  </div>
                </th>
                {/* Application Details */}
                {ColHead('reportNumber', T.thReportNumber)}
                {ColHead('reportDate', T.thReportDate)}
                {ColHead('fromLocation', T.thFrom)}
                {ColHead('toLocation', T.thTo)}
                {ColHead('branch', T.thBranch)}
                {ColHead('carOwner', T.thCarOwner)}
                {ColHead('carNumber', T.thCarNumber)}
                {ColHead('ownerType', T.thOwnerType)}
                {ColHead('executionStatus', T.thExecution)}
                {ColHead('applicationStatus', T.thApplication)}
                {ColHead('paymentMethod', T.thPaymentMethod)}
                {ColHead('username', T.thUsername)}
                {ColHead('userPhone', T.thUserPhone)}
                {ColHead('taxIndicator', T.thTaxIndicator)}
                {ColHead('purchaseValue', T.thPurchaseValue)}
                {ColHead('sellingValue', T.thSellingValue)}
                {ColHead('loadingTime', T.thLoadingTime)}
                {ColHead('driverName', T.thDriverName)}
                {ColHead('driverPhone', T.thDriverPhone)}
                {ColHead('truckType', T.thTruckType)}
                {ColHead('truckSize', T.thTruckSize)}
                {ColHead('loadType', T.thLoadType)}
                {ColHead('quantity', T.thQuantity)}
                {ColHead('reference', T.thReference)}
                {ColHead('representativeName', T.thRepresentative)}
                {/* Operations Review */}
                {ColHead('operationsReview', T.thOpsReview, 'text-yellow-400')}
                {/* Manual Moderator */}
                {ColHead('paymentDate', T.thPaymentDate, 'text-purple-300')}
                {ColHead('payingBranch', T.thPayingBranch, 'text-purple-300')}
                {ColHead('documentNumber', T.thDocNumber, 'text-purple-300')}
                {ColHead('sendingDate', T.thSendingDate, 'text-purple-300')}
                {ColHead('deliveryDate', T.thDeliveryDate, 'text-purple-300')}
                {ColHead('accountingReview', T.thAccountingReview, 'text-purple-300')}
                {/* Collections — financial columns, finance/owner roles only */}
                {canViewFinancials && ColHead('invoiceNumber', T.thInvoiceNumber, 'text-green-400')}
                {canViewFinancials && ColHead('netInvoice', T.thNetInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('tax', T.thTax, 'text-green-400')}
                {canViewFinancials && ColHead('totalInvoice', T.thTotalInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('invoiceDate', T.thInvoiceDate, 'text-green-400')}
                {canViewFinancials && ColHead('collectionDate', T.thCollectionDate, 'text-green-400')}
                {/* Meta — stage/المرحلة is treated as financial too */}
                {canViewFinancials && ColHead('stage', T.thStage)}
                <th className="px-3 py-3 text-start text-xs text-slate-300 font-semibold whitespace-nowrap w-10">{T.lock}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {displayed.length === 0 ? (
                <tr><td colSpan={41} className="px-4 py-12 text-center text-slate-800 text-sm">{showPendingOnly ? (lang === 'ar' ? 'لا توجد فواتير معلقة' : 'No pending invoices') : (hasColFilters ? (lang === 'ar' ? 'لا نتائج للفلتر المحدد' : 'No rows match the filters') : T.noWorkflows)}</td></tr>
              ) : clientPaged.map((wf) => {
                const locked = isLockedByOther(wf);
                const transitions = getTransitions(wf);
                const sc = STAGE_CONFIG[wf.stage] || STAGE_CONFIG.draft;
                const isSelected = selectedIds.has(wf._id);
                return (
                  <tr key={wf._id} className={`hover:bg-slate-100 transition-colors ${editingId === wf._id ? '' : 'cursor-pointer'} ${locked ? 'opacity-60' : ''} ${isSelected ? 'bg-[#f37121]/5' : ''} ${editingId === wf._id ? 'ring-1 ring-[#f37121]/40' : ''}`}
                    onClick={() => { if (editingId !== wf._id) router.push(`/system/operations/${wf._id}`); }}>
                    {/* Checkbox + Actions */}
                    <td className="px-3 py-2.5 sticky start-0 bg-white z-10" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          title={T.selectRow}
                          checked={isSelected}
                          onChange={() => toggleSelect(wf._id)}
                          className="w-4 h-4 appearance-none rounded border border-slate-300 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                        />
                        {editingId === wf._id ? (
                          <>
                            <button type="button" onClick={handleInlineSave} className="p-1 text-green-600 hover:text-green-700 rounded" title={lang === 'ar' ? 'حفظ' : 'Save'}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={handleInlineCancel} className="p-1 text-red-600 hover:text-red-700 rounded" title={lang === 'ar' ? 'إلغاء' : 'Cancel'}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {!locked && (
                              <button type="button" onClick={() => { setEditingId(wf._id); setEditData({...wf}); setFocusField(null); }} className="p-1 text-slate-500 hover:text-[#f37121] rounded" title={T.edit}>
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => handleDelete(wf._id)} className="p-1 text-slate-500 hover:text-red-600 rounded" title={T.delete}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {transitions.length > 0 && (
                              <div className="relative group">
                                <button type="button" className="p-1 text-slate-500 hover:text-blue-600 rounded" title={T.stageTransition}>
                                  {transitioningId === wf._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                                </button>
                                <div className="absolute start-0 top-full mt-1 bg-slate-50 border border-slate-200 rounded-lg shadow-xl z-50 hidden group-hover:block min-w-[160px]">
                                  {transitions.map((t) => (
                                    <button key={t.stage} type="button" onClick={() => handleTransition(wf._id, t.stage)}
                                      className="block w-full text-start px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                                      {t.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    {(() => {
                      const isEditing = editingId === wf._id;
                      const ic = "w-full px-1.5 py-1 rounded bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:ring-1 focus:ring-[#f37121] focus:outline-none";
                      // Click-to-edit: a single click on a manual (non-system) cell
                      // enters edit mode for the row and focuses that field. System
                      // cells keep the row's navigate-on-click behaviour.
                      const editableClass = 'cursor-text hover:bg-amber-50 rounded px-1 -mx-1';
                      const cellClick = (field: keyof Workflow) => {
                        if (isEditing) return (e: any) => e.stopPropagation();
                        if (!SYSTEM_FIELDS.has(field as string) && !locked) return (e: any) => { e.stopPropagation(); beginEditField(wf, field as string); };
                        return undefined;
                      };
                      const spanCls = (field: keyof Workflow, color: string) =>
                        `${color} ${!isEditing && !SYSTEM_FIELDS.has(field as string) && !locked ? editableClass : ''}`;
                      const textCell = (field: keyof Workflow, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={cellClick(field)}>
                          {isEditing ? <input type="text" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={spanCls(field, color)}>{(wf as any)[field] || '-'}</span>}
                        </td>
                      );
                      // Like textCell but translates the value for display (edits the raw value).
                      const transCell = (field: keyof Workflow, tr: (v: string) => string, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={cellClick(field)}>
                          {isEditing ? <input type="text" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={spanCls(field, color)}>{(wf as any)[field] ? tr((wf as any)[field]) : '-'}</span>}
                        </td>
                      );
                      const numCell = (field: keyof Workflow, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={cellClick(field)}>
                          {isEditing ? <input type="number" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value ? Number(e.target.value) : ''}))} /> : <span className={spanCls(field, color)}>{formatMoney((wf as any)[field])}</span>}
                        </td>
                      );
                      const dateCell = (field: keyof Workflow, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={cellClick(field)}>
                          {isEditing ? <input type="date" autoFocus={focusField === field} title={field} className={`${ic} [&::-webkit-calendar-picker-indicator]:invert`} value={(editData as any)[field] ? (editData as any)[field].slice(0, 10) : ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={spanCls(field, color)}>{formatDate((wf as any)[field])}</span>}
                        </td>
                      );
                      // Operations review is a one-click checkbox (checklist), not text.
                      const operationsReviewCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={T.thOpsReview}
                            title={T.thOpsReview}
                            disabled={!canEditOperationsReview || locked}
                            checked={!!wf.operationsReview}
                            onChange={() => toggleOperationsReview(wf)}
                            className="w-4 h-4 appearance-none rounded border border-slate-300 bg-white checked:bg-yellow-500 checked:border-yellow-500 cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                      );
                      // Accounting review is a one-click checkbox (checklist), not text.
                      const accountingReviewCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={T.thAccountingReview}
                            title={T.thAccountingReview}
                            disabled={!canEditAccountingReview || locked}
                            checked={!!wf.accountingReview}
                            onChange={() => toggleAccountingReview(wf)}
                            className="w-4 h-4 appearance-none rounded border border-slate-300 bg-white checked:bg-purple-600 checked:border-purple-600 cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                      );
                      return (<>
                        {/* Application Details */}
                        {textCell('reportNumber', 'text-[#f37121] font-medium')}
                        {dateCell('reportDate')}
                        {textCell('fromLocation')}
                        {textCell('toLocation')}
                        {textCell('branch')}
                        {textCell('carOwner', 'text-slate-900')}
                        {textCell('carNumber')}
                        {textCell('ownerType')}
                        {transCell('executionStatus', trStatus)}
                        {transCell('applicationStatus', trStatus)}
                        {transCell('paymentMethod', trPayment)}
                        {textCell('username')}
                        {textCell('userPhone')}
                        {textCell('taxIndicator')}
                        {numCell('purchaseValue')}
                        {numCell('sellingValue')}
                        {textCell('loadingTime')}
                        {textCell('driverName')}
                        {textCell('driverPhone')}
                        {textCell('truckType')}
                        {textCell('truckSize')}
                        {textCell('loadType')}
                        {textCell('quantity')}
                        {textCell('reference')}
                        {textCell('representativeName')}
                        {/* Operations Review */}
                        {operationsReviewCell()}
                        {/* Manual Moderator */}
                        {dateCell('paymentDate', 'text-purple-700')}
                        {textCell('payingBranch', 'text-purple-700')}
                        {textCell('documentNumber', 'text-purple-700')}
                        {dateCell('sendingDate', 'text-purple-700')}
                        {dateCell('deliveryDate', 'text-purple-700')}
                        {accountingReviewCell()}
                        {/* Collections — financial, finance/owner roles only */}
                        {canViewFinancials && textCell('invoiceNumber', 'text-green-700')}
                        {canViewFinancials && numCell('netInvoice', 'text-green-700')}
                        {canViewFinancials && numCell('tax', 'text-green-700')}
                        {canViewFinancials && numCell('totalInvoice', 'text-green-700')}
                        {canViewFinancials && dateCell('invoiceDate', 'text-green-700')}
                        {canViewFinancials && dateCell('collectionDate', 'text-green-700')}
                      </>);
                    })()}
                    {/* Meta — stage/المرحلة, finance/owner roles only */}
                    {canViewFinancials && (
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color}`}>{stageLabels[wf.stage] || sc.label}</span></td>
                    )}
                    <td className="px-3 py-2.5">
                      {wf.lockedBy ? (
                        <div className="flex items-center gap-1" title={T.lockedByTooltip.replace('{name}', wf.lockedByName)}>
                          <Lock className="w-3.5 h-3.5 text-red-600" />
                        </div>
                      ) : <Unlock className="w-3.5 h-3.5 text-slate-600" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!clientMode && total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <span className="text-slate-500 text-sm">{T.showing} {(page - 1) * 50 + 1}-{Math.min(page * 50, total)} {T.of} {total}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.previous}</button>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.next}</button>
            </div>
          </div>
        )}
        {clientMode && displayed.length > CLIENT_PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <span className="text-slate-500 text-sm">{T.showing} {(clientPage - 1) * CLIENT_PAGE_SIZE + 1}-{Math.min(clientPage * CLIENT_PAGE_SIZE, displayed.length)} {T.of} {displayed.length}{hasColFilters ? ` (${lang === 'ar' ? 'مُفلتر' : 'filtered'})` : ''}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setClientPage((p) => Math.max(1, p - 1))} disabled={clientPage === 1} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.previous}</button>
              <button type="button" onClick={() => setClientPage((p) => p + 1)} disabled={clientPage * CLIENT_PAGE_SIZE >= displayed.length} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.next}</button>
            </div>
          </div>
        )}
      </div>

      {/* Stage counts */}
      <div className="flex flex-wrap gap-3 items-center">
        {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
          <div key={key} className={`px-3 py-2 rounded-lg ${cfg.bg} ${cfg.color} text-xs font-medium`}>
            {stageLabels[key] || cfg.label}: {displayed.filter((w) => w.stage === key).length}
          </div>
        ))}
        <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">{T.total}: {hasColFilters ? `${displayed.length} / ${total}` : total}</div>
        {hasColFilters && (
          <button type="button" onClick={() => { setColFilters({}); setClientPage(1); }} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-medium hover:bg-[#f37121]/20 transition-colors">
            <X className="w-3.5 h-3.5" /> {lang === 'ar' ? `مسح كل الفلاتر (${Object.keys(colFilters).length})` : `Clear all filters (${Object.keys(colFilters).length})`}
          </button>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#f37121]/20 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#f37121]" />
                </div>
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{lang === 'ar' ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-slate-700 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{T.cancel || 'Cancel'}</button>
              <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
                {lang === 'ar' ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
