'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getOperationsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  ClipboardList, Plus, Search, Filter, Upload,
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
  draft: { label: 'Draft', color: 'text-gray-400', bg: 'bg-gray-500/20' },
  submitted_to_ops: { label: 'Submitted to Ops', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  ops_completed: { label: 'Ops Completed', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  submitted_to_collections: { label: 'To Collections', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', color: 'text-green-400', bg: 'bg-green-500/20' },
};

export default function OperationsWorkflowPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);

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
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [showBulkReview, setShowBulkReview] = useState(false);
  const [bulkReviewText, setBulkReviewText] = useState('تم');

  const role = user?.role || '';
  const canCreate = role === 'super_admin' || role === 'moderator';
  const canDelete = role === 'super_admin';

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
  }, [stageFilter, search, page, dateFrom, dateTo, showPendingOnly]);

  // Initial load
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Clear selection when filters/page change
  useEffect(() => { setSelectedIds(new Set()); }, [stageFilter, search, page, dateFrom, dateTo]);

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
      fetchWorkflows(true);
    } catch (err: any) { setError(err.message); }
  };

  const handleInlineCancel = () => {
    setEditingId(null);
    setEditData({});
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
    const displayed = workflows;
    if (selectedIds.size === displayed.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayed.map((w) => w._id)));
    }
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

  const pendingCount = showPendingOnly ? total : workflows.filter(w => !w.paymentDate && !w.invoiceNumber).length;

  if (loading && workflows.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
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
                <div className="absolute top-full mt-2 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-3 min-w-[220px]">
                  <label className="block text-xs text-gray-400 mb-1">{lang === 'ar' ? 'نص المراجعة:' : 'Review text:'}</label>
                  <input
                    type="text"
                    value={bulkReviewText}
                    onChange={(e) => setBulkReviewText(e.target.value)}
                    placeholder={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    title={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#f37121] mb-2"
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleBulkReview} className="flex-1 px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-medium transition-colors">
                      {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setShowBulkReview(false)} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors">
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">
            <FileSpreadsheet className="w-4 h-4" /> {T.exportExcel}
          </button>
          {canCreate && (
            <>
              <button type="button" onClick={() => router.push('/system/operations/new?mode=import')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            {searching ? (
              <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#f37121] animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
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
              className="w-full pl-10 pr-8 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            />
            {searchInput && (
              <button type="button" title={T.clearSearch} onClick={() => { setSearchInput(''); setSearch(''); setPage(1); searchInputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              title={T.fromDate}
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [&::-webkit-calendar-picker-indicator]:invert"
            />
            <span className="text-gray-500 text-sm">{T.to}</span>
            <input
              type="date"
              title={T.toDate}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [&::-webkit-calendar-picker-indicator]:invert"
            />
            {(dateFrom || dateTo) && (
              <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }} className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-red-500/50 transition-colors" title={T.clearDates}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-500" />
          {[{ value: '', label: T.all }, ...Object.entries(STAGE_CONFIG).map(([k]) => ({ value: k, label: stageLabels[k] || k }))].map((opt) => (
            <button key={opt.value} type="button" onClick={() => { setStageFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${stageFilter === opt.value ? 'bg-[#f37121] text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pending Invoices Card */}
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
          <AlertCircle className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-2xl font-bold text-amber-400">{pendingCount}</span>
          <span className="text-xs text-amber-400/80">{lang === 'ar' ? 'فواتير لم تصل' : 'Pending Invoices'}</span>
        </div>
        {showPendingOnly && (
          <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/30 text-amber-300">
            {lang === 'ar' ? 'مُفعّل' : 'ACTIVE'}
          </span>
        )}
      </button>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[3200px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-3 py-3 sticky left-0 bg-gray-800 z-10 w-20">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      title={T.selectAll}
                      checked={workflows.length > 0 && selectedIds.size === workflows.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 appearance-none rounded border border-gray-600 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                    />
                    <span className="text-xs text-gray-400 font-medium">{T.actions}</span>
                  </div>
                </th>
                {/* Application Details */}
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thReportNumber}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thReportDate}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thFrom}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thTo}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thBranch}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thCarOwner}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thCarNumber}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thOwnerType}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thExecution}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thApplication}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thPaymentMethod}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thUsername}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thUserPhone}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thTaxIndicator}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thPurchaseValue}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thSellingValue}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thLoadingTime}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thDriverName}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thDriverPhone}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thTruckType}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thTruckSize}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thLoadType}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thQuantity}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thReference}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thRepresentative}</th>
                {/* Operations Review */}
                <th className="px-3 py-3 text-left text-xs text-yellow-400 font-medium whitespace-nowrap">{T.thOpsReview}</th>
                {/* Manual Moderator */}
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thPaymentDate}</th>
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thPayingBranch}</th>
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thDocNumber}</th>
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thSendingDate}</th>
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thDeliveryDate}</th>
                <th className="px-3 py-3 text-left text-xs text-purple-400 font-medium whitespace-nowrap">{T.thAccountingReview}</th>
                {/* Collections */}
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thInvoiceNumber}</th>
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thNetInvoice}</th>
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thTax}</th>
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thTotalInvoice}</th>
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thInvoiceDate}</th>
                <th className="px-3 py-3 text-left text-xs text-green-400 font-medium whitespace-nowrap">{T.thCollectionDate}</th>
                {/* Meta */}
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap">{T.thStage}</th>
                <th className="px-3 py-3 text-left text-xs text-gray-400 font-medium whitespace-nowrap w-10">{T.lock}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {workflows.length === 0 ? (
                <tr><td colSpan={41} className="px-4 py-12 text-center text-gray-500 text-sm">{showPendingOnly ? (lang === 'ar' ? 'لا توجد فواتير معلقة' : 'No pending invoices') : T.noWorkflows}</td></tr>
              ) : workflows.map((wf) => {
                const locked = isLockedByOther(wf);
                const transitions = getTransitions(wf);
                const sc = STAGE_CONFIG[wf.stage] || STAGE_CONFIG.draft;
                const isSelected = selectedIds.has(wf._id);
                return (
                  <tr key={wf._id} className={`hover:bg-gray-700/30 transition-colors ${editingId === wf._id ? '' : 'cursor-pointer'} ${locked ? 'opacity-60' : ''} ${isSelected ? 'bg-[#f37121]/5' : ''} ${editingId === wf._id ? 'ring-1 ring-[#f37121]/40' : ''}`}
                    onClick={() => { if (editingId !== wf._id) router.push(`/system/operations/${wf._id}`); }}>
                    {/* Checkbox + Actions */}
                    <td className="px-3 py-2.5 sticky left-0 bg-gray-800 z-10" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          title={T.selectRow}
                          checked={isSelected}
                          onChange={() => toggleSelect(wf._id)}
                          className="w-4 h-4 appearance-none rounded border border-gray-600 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                        />
                        {editingId === wf._id ? (
                          <>
                            <button type="button" onClick={handleInlineSave} className="p-1 text-green-400 hover:text-green-300 rounded" title={lang === 'ar' ? 'حفظ' : 'Save'}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={handleInlineCancel} className="p-1 text-red-400 hover:text-red-300 rounded" title={lang === 'ar' ? 'إلغاء' : 'Cancel'}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {!locked && (
                              <button type="button" onClick={() => { setEditingId(wf._id); setEditData({...wf}); }} className="p-1 text-gray-400 hover:text-[#f37121] rounded" title={T.edit}>
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => handleDelete(wf._id)} className="p-1 text-gray-400 hover:text-red-400 rounded" title={T.delete}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {transitions.length > 0 && (
                              <div className="relative group">
                                <button type="button" className="p-1 text-gray-400 hover:text-blue-400 rounded" title={T.stageTransition}>
                                  {transitioningId === wf._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                                </button>
                                <div className="absolute left-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 hidden group-hover:block min-w-[160px]">
                                  {transitions.map((t) => (
                                    <button key={t.stage} type="button" onClick={() => handleTransition(wf._id, t.stage)}
                                      className="block w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
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
                      const ic = "w-full px-1.5 py-1 rounded bg-gray-900 border border-gray-600 text-white text-xs focus:ring-1 focus:ring-[#f37121] focus:outline-none";
                      const textCell = (field: keyof Workflow, color = 'text-gray-300') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isEditing ? (e) => e.stopPropagation() : undefined}>
                          {isEditing ? <input type="text" title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={color}>{(wf as any)[field] || '-'}</span>}
                        </td>
                      );
                      const numCell = (field: keyof Workflow, color = 'text-gray-300') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isEditing ? (e) => e.stopPropagation() : undefined}>
                          {isEditing ? <input type="number" title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value ? Number(e.target.value) : ''}))} /> : <span className={color}>{formatMoney((wf as any)[field])}</span>}
                        </td>
                      );
                      const dateCell = (field: keyof Workflow, color = 'text-gray-300') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isEditing ? (e) => e.stopPropagation() : undefined}>
                          {isEditing ? <input type="date" title={field} className={`${ic} [&::-webkit-calendar-picker-indicator]:invert`} value={(editData as any)[field] ? (editData as any)[field].slice(0, 10) : ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={color}>{formatDate((wf as any)[field])}</span>}
                        </td>
                      );
                      return (<>
                        {/* Application Details */}
                        {textCell('reportNumber', 'text-[#f37121] font-medium')}
                        {dateCell('reportDate')}
                        {textCell('fromLocation')}
                        {textCell('toLocation')}
                        {textCell('branch')}
                        {textCell('carOwner', 'text-white')}
                        {textCell('carNumber')}
                        {textCell('ownerType')}
                        {textCell('executionStatus')}
                        {textCell('applicationStatus')}
                        {textCell('paymentMethod')}
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
                        {textCell('operationsReview', 'text-yellow-300')}
                        {/* Manual Moderator */}
                        {dateCell('paymentDate', 'text-purple-300')}
                        {textCell('payingBranch', 'text-purple-300')}
                        {textCell('documentNumber', 'text-purple-300')}
                        {dateCell('sendingDate', 'text-purple-300')}
                        {dateCell('deliveryDate', 'text-purple-300')}
                        {textCell('accountingReview', 'text-purple-300')}
                        {/* Collections */}
                        {textCell('invoiceNumber', 'text-green-300')}
                        {numCell('netInvoice', 'text-green-300')}
                        {numCell('tax', 'text-green-300')}
                        {numCell('totalInvoice', 'text-green-300')}
                        {dateCell('invoiceDate', 'text-green-300')}
                        {dateCell('collectionDate', 'text-green-300')}
                      </>);
                    })()}
                    {/* Meta */}
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color}`}>{stageLabels[wf.stage] || sc.label}</span></td>
                    <td className="px-3 py-2.5">
                      {wf.lockedBy ? (
                        <div className="flex items-center gap-1" title={T.lockedByTooltip.replace('{name}', wf.lockedByName)}>
                          <Lock className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      ) : <Unlock className="w-3.5 h-3.5 text-gray-600" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!showPendingOnly && total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
            <span className="text-gray-400 text-sm">{T.showing} {(page - 1) * 50 + 1}-{Math.min(page * 50, total)} {T.of} {total}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm disabled:opacity-50">{T.previous}</button>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm disabled:opacity-50">{T.next}</button>
            </div>
          </div>
        )}
      </div>

      {/* Stage counts */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
          <div key={key} className={`px-3 py-2 rounded-lg ${cfg.bg} ${cfg.color} text-xs font-medium`}>
            {stageLabels[key] || cfg.label}: {workflows.filter((w) => w.stage === key).length}
          </div>
        ))}
        <div className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 text-xs font-medium">{T.total}: {total}</div>
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#f37121]/20 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#f37121]" />
                </div>
                <h3 className="text-white font-semibold">{lang === 'ar' ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-gray-300 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{T.cancel || 'Cancel'}</button>
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
