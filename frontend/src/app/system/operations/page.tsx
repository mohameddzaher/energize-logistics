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
  Lock, Unlock, Edit, Trash2, ArrowRight, Loader2, X, FileSpreadsheet, Calendar
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
      params.append('page', String(page));
      params.append('limit', '50');
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
  }, [stageFilter, search, page, dateFrom, dateTo]);

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

  const handleDelete = async (wfId: string) => {
    if (!confirm(T.deleteWorkflowConfirm)) return;
    try { await api.delete(`/api/workflows/${wfId}`); } catch (err: any) { setError(err.message); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(T.deleteBulkConfirm.replace('{count}', String(selectedIds.size)))) return;
    try {
      setBulkDeleting(true);
      await api.post('/api/workflows/bulk-delete', { ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === workflows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(workflows.map((w) => w._id)));
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
                <tr><td colSpan={41} className="px-4 py-12 text-center text-gray-500 text-sm">{T.noWorkflows}</td></tr>
              ) : workflows.map((wf) => {
                const locked = isLockedByOther(wf);
                const transitions = getTransitions(wf);
                const sc = STAGE_CONFIG[wf.stage] || STAGE_CONFIG.draft;
                const isSelected = selectedIds.has(wf._id);
                return (
                  <tr key={wf._id} className={`hover:bg-gray-700/30 transition-colors cursor-pointer ${locked ? 'opacity-60' : ''} ${isSelected ? 'bg-[#f37121]/5' : ''}`}
                    onClick={() => router.push(`/system/operations/${wf._id}`)}>
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
                        {!locked && (
                          <button type="button" onClick={() => router.push(`/system/operations/${wf._id}?edit=1`)} className="p-1 text-gray-400 hover:text-[#f37121] rounded" title={T.edit}>
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
                      </div>
                    </td>
                    {/* Application Details */}
                    <td className="px-3 py-2.5 text-sm text-[#f37121] font-medium whitespace-nowrap">{wf.reportNumber}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{formatDate(wf.reportDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.fromLocation || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.toLocation || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.branch || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-white whitespace-nowrap">{wf.carOwner || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.carNumber || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.ownerType || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.executionStatus || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.applicationStatus || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.paymentMethod || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.username || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.userPhone || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.taxIndicator || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{formatMoney(wf.purchaseValue)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{formatMoney(wf.sellingValue)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.loadingTime || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.driverName || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.driverPhone || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.truckType || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.truckSize || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.loadType || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.quantity || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.reference || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{wf.representativeName || '-'}</td>
                    {/* Operations Review */}
                    <td className="px-3 py-2.5 text-sm text-yellow-300 whitespace-nowrap">{wf.operationsReview || '-'}</td>
                    {/* Manual Moderator */}
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{formatDate(wf.paymentDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{wf.payingBranch || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{wf.documentNumber || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{formatDate(wf.sendingDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{formatDate(wf.deliveryDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-purple-300 whitespace-nowrap">{wf.accountingReview || '-'}</td>
                    {/* Collections */}
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{wf.invoiceNumber || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{formatMoney(wf.netInvoice)}</td>
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{formatMoney(wf.tax)}</td>
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{formatMoney(wf.totalInvoice)}</td>
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{formatDate(wf.invoiceDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-green-300 whitespace-nowrap">{formatDate(wf.collectionDate)}</td>
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

        {total > 50 && (
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
    </div>
  );
}
