'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getDisputesTranslations, getDisputesExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Plus, X, ChevronDown, ChevronUp,
  Filter, RefreshCw, User, FileText, MessageSquare,
  Search, Loader2, Calendar, Download
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface Dispute {
  _id: string;
  invoice: { _id: string; invoiceNumber: string; customer?: { _id: string; companyName: string } };
  customer: { _id: string; companyName: string };
  reason: string;
  status: 'open' | 'under_review' | 'resolved';
  raisedBy: { _id: string; firstName: string; lastName: string };
  resolution?: string;
  assignedTo?: { _id: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  customer: { _id: string; companyName: string };
}

interface UserOption {
  _id: string;
  firstName: string;
  lastName: string;
  role: string;
}

const statusConfig: Record<string, { bg: string; text: string; labelKey: string }> = {
  open: { bg: 'bg-red-500/20', text: 'text-red-600', labelKey: 'openDispute' },
  under_review: { bg: 'bg-yellow-500/20', text: 'text-yellow-700', labelKey: 'escalated' },
  resolved: { bg: 'bg-green-500/20', text: 'text-green-600', labelKey: 'resolvedDispute' },
};

export default function DisputesPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getDisputesTranslations(lang);
  const txx = getDisputesExtraTranslations(lang);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const initialLoadDone = useRef(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Date range
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);

  // Create form state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [createForm, setCreateForm] = useState({ invoiceId: '', reason: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Update form state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [updateForm, setUpdateForm] = useState({ status: '', resolution: '', assignedTo: '' });
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  const fetchDisputes = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      if (!initialLoadDone.current) setLoading(true);
      else setSearching(true);
    }
    try {
      setError('');
      const params = new URLSearchParams();
      // "All" = unresolved only (open + under_review)
      if (statusFilter === 'all') {
        params.set('status', 'unresolved');
      } else {
        params.set('status', statusFilter);
      }
      if (search) params.set('search', search);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const data = await api.get<any>(`/api/disputes?${params.toString()}`);
      setDisputes(data.disputes || data || []);
    } catch (err: any) {
      setError(err.message || txx.failedToLoad);
    } finally {
      setLoading(false);
      setSearching(false);
      initialLoadDone.current = true;
    }
  }, [statusFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleRealTime = useCallback(() => { fetchDisputes(true); }, [fetchDisputes]);
  useSocket('dispute:opened', handleRealTime);
  useSocket('dispute:updated', handleRealTime);

  // Search handler
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(val); }, 300);
  };

  const openCreateModal = async () => {
    setCreateForm({ invoiceId: '', reason: '' });
    setCreateError('');
    try {
      const data = await api.get<any>('/api/invoices');
      setInvoices(data.invoices || data || []);
    } catch {
      setInvoices([]);
    }
    setShowCreateModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.invoiceId || !createForm.reason.trim()) {
      setCreateError(txx.selectInvoiceReason);
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      await api.post('/api/disputes', {
        invoice: createForm.invoiceId,
        reason: createForm.reason,
      });
      setShowCreateModal(false);
      fetchDisputes();
    } catch (err: any) {
      setCreateError(err.message || txx.failedToCreate);
    } finally {
      setCreating(false);
    }
  };

  const openUpdateModal = async (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setUpdateForm({
      status: dispute.status,
      resolution: dispute.resolution || '',
      assignedTo: dispute.assignedTo?._id || '',
    });
    setUpdateError('');
    try {
      const data = await api.get<any>('/api/users');
      setUsers(data.users || data || []);
    } catch {
      setUsers([]);
    }
    setShowUpdateModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute) return;
    setUpdating(true);
    setUpdateError('');
    try {
      const payload: any = { status: updateForm.status };
      if (updateForm.resolution) payload.resolution = updateForm.resolution;
      if (updateForm.assignedTo) payload.assignedTo = updateForm.assignedTo;
      await api.put(`/api/disputes/${selectedDispute._id}`, payload);
      setShowUpdateModal(false);
      setSelectedDispute(null);
      fetchDisputes();
    } catch (err: any) {
      setUpdateError(err.message || txx.failedToUpdate);
    } finally {
      setUpdating(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const columns = [
    {
      key: 'invoiceNumber',
      label: `${T.invoice} #`,
      render: (_: any, row: Dispute) => (
        <span className="text-[#f37121] font-medium">{row.invoice?.invoiceNumber || '-'}</span>
      ),
    },
    {
      key: 'customer',
      label: T.customer,
      render: (_: any, row: Dispute) => row.customer?.companyName || row.invoice?.customer?.companyName || '-',
    },
    {
      key: 'reason',
      label: T.reason,
      render: (_: any, row: Dispute) => (
        <span className="truncate max-w-[200px] block">{row.reason}</span>
      ),
    },
    {
      key: 'status',
      label: T.status,
      render: (_: any, row: Dispute) => {
        const config = statusConfig[row.status] || statusConfig.open;
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
            {(T as any)[config.labelKey]}
          </span>
        );
      },
    },
    {
      key: 'raisedBy',
      label: T.firstName,
      render: (_: any, row: Dispute) =>
        row.raisedBy ? `${row.raisedBy.firstName} ${row.raisedBy.lastName}` : '-',
    },
    {
      key: 'createdAt',
      label: T.date,
      render: (_: any, row: Dispute) => formatDate(row.createdAt),
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{T.disputeDetails}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => exportToExcel(disputes, [
              { header: `${T.invoice} #`, key: 'invoice.invoiceNumber', width: 16 },
              { header: T.customer, key: 'customer.companyName', width: 24 },
              { header: T.reason, key: 'reason', width: 35 },
              { header: T.status, key: 'status', transform: (v: string) => { const c = statusConfig[v]; return c ? (T as any)[c.labelKey] : v; }, width: 16 },
              { header: T.firstName, key: 'raisedBy', transform: (_: any, row: any) => row.raisedBy ? `${row.raisedBy.firstName} ${row.raisedBy.lastName}` : '', width: 20 },
              { header: T.name, key: 'assignedTo', transform: (_: any, row: any) => row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '', width: 20 },
              { header: T.resolution, key: 'resolution', width: 35 },
              { header: T.createdAt, key: 'createdAt', transform: fmt.date, width: 14 },
              { header: T.date, key: 'updatedAt', transform: fmt.date, width: 14 },
            ], `disputes-${new Date().toISOString().split('T')[0]}`, 'Disputes')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors"
          >
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          <button
            type="button"
            onClick={() => { fetchDisputes(); }}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title={txx.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {T.openDispute}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <div className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </div>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={T.searchDisputes}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full ps-10 pe-10 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); searchInputRef.current?.focus(); }}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
              title={txx.clearSearch}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Date filter toggle */}
        <button
          type="button"
          onClick={() => setShowDateFilter(!showDateFilter)}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors shrink-0 justify-center w-full sm:w-auto ${
            showDateFilter || dateFrom || dateTo ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" />
          {T.date}
        </button>
      </div>

      {/* Date Range Filter */}
      <AnimatePresence>
        {showDateFilter && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3 shadow-sm">
              <div>
                <label className="text-slate-500 text-xs mb-1 block">{T.from}</label>
                <input type="date" aria-label={txx.dateFrom} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>
              <div>
                <label className="text-slate-500 text-xs mb-1 block">{T.to}</label>
                <input type="date" aria-label={txx.dateTo} value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="px-3 py-2 text-slate-500 hover:text-slate-900 text-sm"
                >
                  {T.clearFilters}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Filter */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="text-slate-500 text-sm">{T.status}:</span>
        {(['all', 'open', 'under_review', 'resolved'] as const).map((s) => {
          const statusLabels: Record<string, string> = {
            all: T.all,
            open: T.openDispute,
            under_review: T.escalated,
            resolved: T.resolvedDispute,
          };
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-[#f37121] text-white'
                  : 'bg-white text-slate-500 hover:text-slate-900 border border-slate-200'
              }`}
            >
              {statusLabels[s]}
            </button>
          );
        })}
      </div>

      {/* Table with expandable rows */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider w-8" />
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider"
                  >
                    {col.label}
                  </th>
                ))}
                {isAdmin && (
                  <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase">{T.actions}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {disputes.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-slate-800 text-sm">
                    {T.noDisputes}
                  </td>
                </tr>
              ) : (
                disputes.map((dispute) => (
                  <React.Fragment key={dispute._id}>
                    <tr
                      onClick={() => toggleRow(dispute._id)}
                      className="bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm text-slate-800">
                        {expandedRow === dispute._id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-3 text-sm text-slate-700">
                          {col.render ? col.render(dispute[col.key as keyof Dispute], dispute) : (dispute[col.key as keyof Dispute] as any) ?? '-'}
                        </td>
                      ))}
                      {isAdmin && (
                        <td className="px-4 py-3 text-sm">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openUpdateModal(dispute);
                            }}
                            className="px-3 py-1 bg-[#f37121]/20 text-[#f37121] rounded text-xs font-medium hover:bg-[#f37121]/30 transition-colors"
                          >
                            {T.edit}
                          </button>
                        </td>
                      )}
                    </tr>
                    <AnimatePresence>
                      {expandedRow === dispute._id && (
                        <tr>
                          <td colSpan={columns.length + 2}>
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-slate-100 border-t border-slate-200/70 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                  <div>
                                    <p className="text-slate-500 text-xs uppercase font-medium mb-1">{T.reason}</p>
                                    <p className="text-slate-900 text-sm">{dispute.reason}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs uppercase font-medium mb-1">{T.resolution}</p>
                                    <p className="text-slate-900 text-sm">{dispute.resolution || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs uppercase font-medium mb-1">{T.name}</p>
                                    <p className="text-slate-900 text-sm">
                                      {dispute.assignedTo
                                        ? `${dispute.assignedTo.firstName} ${dispute.assignedTo.lastName}`
                                        : '-'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-200/70">
                                  <span>{T.createdAt}: {formatDate(dispute.createdAt)}</span>
                                  <span>{T.date}: {formatDate(dispute.updatedAt)}</span>
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Create Dispute Modal */}
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-[#f37121]" />
                    {T.openDispute}
                  </h2>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900">
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
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.invoice}</label>
                    <select
                      value={createForm.invoiceId}
                      onChange={(e) => setCreateForm({ ...createForm, invoiceId: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      required
                    >
                      <option value="">...</option>
                      {invoices.map((inv) => (
                        <option key={inv._id} value={inv._id}>
                          {inv.invoiceNumber} - {inv.customer?.companyName || 'N/A'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.reason}</label>
                    <textarea
                      value={createForm.reason}
                      onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                      placeholder={T.reason}
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={creating}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {creating && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.openDispute}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Update Dispute Modal */}
      <AnimatePresence>
        {showUpdateModal && selectedDispute && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUpdateModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <MessageSquare className="w-5 h-5 text-[#f37121]" />
                    {T.title}
                  </h2>
                  <button type="button" onClick={() => setShowUpdateModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleUpdate} className="p-5 space-y-4">
                  {updateError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
                      {updateError}
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <p className="text-slate-500 text-xs uppercase font-medium">{T.invoice}</p>
                    <p className="text-slate-900 text-sm font-medium mt-0.5">
                      {selectedDispute.invoice?.invoiceNumber} - {selectedDispute.customer?.companyName}
                    </p>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.status}</label>
                    <select
                      value={updateForm.status}
                      onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="open">{T.openDispute}</option>
                      <option value="under_review">{T.escalated}</option>
                      <option value="resolved">{T.resolvedDispute}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.name}</label>
                    <select
                      value={updateForm.assignedTo}
                      onChange={(e) => setUpdateForm({ ...updateForm, assignedTo: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="">-</option>
                      {users.map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.firstName} {u.lastName} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.resolution}</label>
                    <textarea
                      value={updateForm.resolution}
                      onChange={(e) => setUpdateForm({ ...updateForm, resolution: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                      placeholder={T.resolution}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowUpdateModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={updating}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {updating && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.save}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
