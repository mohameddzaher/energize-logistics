'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getAuditTranslations } from '@/lib/translations';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, RefreshCw, Filter, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Calendar, Search, X, Download
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface AuditLog {
  _id: string;
  user: { _id: string; firstName: string; lastName: string; email: string } | null;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  ipAddress?: string;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const entityTypes = ['All', 'User', 'Customer', 'Invoice', 'Payment', 'Dispute'];

export default function AuditPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getAuditTranslations(lang);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 25, total: 0, pages: 0 });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters
  const [entityFilter, setEntityFilter] = useState('All');
  const [actionSearch, setActionSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchLogs = useCallback(async (page = 1) => {
    try {
      setError('');
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '25');
      if (entityFilter !== 'All') params.set('entity', entityFilter);
      if (actionSearch.trim()) params.set('action', actionSearch.trim());
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const data = await api.get<any>(`/api/audit?${params.toString()}`);
      setLogs(data.logs || data.auditLogs || data || []);
      if (data.pagination) {
        setPagination(data.pagination);
      } else {
        setPagination({
          page,
          limit: 25,
          total: data.total || (data.logs || data.auditLogs || data || []).length,
          pages: data.pages || Math.ceil((data.total || (data.logs || data.auditLogs || data || []).length) / 25),
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [entityFilter, actionSearch, dateFrom, dateTo]);

  useEffect(() => {
    setLoading(true);
    fetchLogs(1);
  }, [fetchLogs]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    setLoading(true);
    fetchLogs(newPage);
  };

  const clearFilters = () => {
    setEntityFilter('All');
    setActionSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = entityFilter !== 'All' || actionSearch || dateFrom || dateTo;

  const formatTimestamp = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatRelativeTime = (date: string) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatTimestamp(date);
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add')) return 'text-green-400 bg-green-500/10';
    if (a.includes('delete') || a.includes('remove') || a.includes('deactivate')) return 'text-red-400 bg-red-500/10';
    if (a.includes('update') || a.includes('edit') || a.includes('modify')) return 'text-blue-400 bg-blue-500/10';
    if (a.includes('login') || a.includes('auth')) return 'text-purple-400 bg-purple-500/10';
    if (a.includes('lock') || a.includes('unlock')) return 'text-yellow-400 bg-yellow-500/10';
    return 'text-gray-400 bg-gray-500/10';
  };

  const getEntityColor = (entity: string) => {
    const e = entity.toLowerCase();
    if (e === 'user') return 'text-purple-400';
    if (e === 'customer') return 'text-blue-400';
    if (e === 'invoice') return 'text-[#f37121]';
    if (e === 'payment') return 'text-green-400';
    if (e === 'dispute') return 'text-red-400';
    return 'text-gray-400';
  };

  const renderJsonDiff = (before: Record<string, any> | undefined, after: Record<string, any> | undefined) => {
    if (!before && !after) return <p className="text-gray-500 text-xs">No change details available</p>;

    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

    return (
      <div className="space-y-1">
        {Array.from(allKeys).map((key) => {
          const bVal = before?.[key];
          const aVal = after?.[key];
          const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);

          return (
            <div key={key} className={`flex items-start gap-3 px-3 py-1.5 rounded text-xs ${changed ? 'bg-gray-800' : ''}`}>
              <span className="text-gray-400 font-mono min-w-[120px] shrink-0">{key}</span>
              {changed ? (
                <div className="flex-1 space-y-0.5">
                  {bVal !== undefined && (
                    <div className="flex items-start gap-1">
                      <span className="text-red-400 shrink-0">-</span>
                      <span className="text-red-300 font-mono break-all">
                        {typeof bVal === 'object' ? JSON.stringify(bVal) : String(bVal)}
                      </span>
                    </div>
                  )}
                  {aVal !== undefined && (
                    <div className="flex items-start gap-1">
                      <span className="text-green-400 shrink-0">+</span>
                      <span className="text-green-300 font-mono break-all">
                        {typeof aVal === 'object' ? JSON.stringify(aVal) : String(aVal)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-gray-500 font-mono break-all">
                  {typeof bVal === 'object' ? JSON.stringify(bVal) : String(bVal ?? '-')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  if (loading && logs.length === 0) {
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
        <div>
          <h1 className="text-2xl font-bold text-white">{T.title}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {pagination.total > 0 && (
              <span className="text-gray-500">{pagination.total.toLocaleString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => exportToExcel(logs, [
              { header: T.date, key: 'createdAt', transform: fmt.datetime, width: 22 },
              { header: T.user, key: 'user', transform: (_: any, row: any) => row.user ? `${row.user.firstName} ${row.user.lastName}` : 'System', width: 20 },
              { header: T.email, key: 'user.email', width: 24 },
              { header: T.action, key: 'action', width: 20 },
              { header: T.entity, key: 'entity', width: 14 },
              { header: T.entityId, key: 'entityId', width: 26 },
              { header: T.details, key: 'details', width: 40 },
              { header: T.ipAddress, key: 'ipAddress', width: 16 },
            ], `audit-log-${new Date().toISOString().split('T')[0]}`, T.title)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
          >
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
              hasActiveFilters
                ? 'border-[#f37121] text-[#f37121] bg-[#f37121]/10'
                : 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Filter className="w-4 h-4" />
            {T.filters}
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-[#f37121]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchLogs(pagination.page); }}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-medium text-sm">{T.filters}</h3>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[#f37121] text-xs hover:underline flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    {T.clearFilters}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Entity Type */}
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">{T.entity}</label>
                  <select
                    value={entityFilter}
                    onChange={(e) => setEntityFilter(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    {entityTypes.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </div>

                {/* Action Search */}
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">{T.action}</label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={actionSearch}
                      onChange={(e) => setActionSearch(e.target.value)}
                      placeholder={T.searchAction}
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>
                </div>

                {/* Date From */}
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">{T.from}</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
                    />
                  </div>
                </div>

                {/* Date To */}
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">{T.to}</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit Logs Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800 border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{T.date}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{T.user}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{T.action}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{T.entity}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{T.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                    {T.noLogs}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <React.Fragment key={log._id}>
                    <tr
                      onClick={() => log.changes ? toggleRow(log._id) : undefined}
                      className={`bg-gray-800/50 hover:bg-gray-700/50 transition-colors ${log.changes ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {log.changes && (
                          expandedRow === log._id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>
                          <span className="text-gray-300 text-xs">{formatTimestamp(log.createdAt)}</span>
                          <span className="text-gray-500 text-xs block">{formatRelativeTime(log.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {log.user ? (
                          <div>
                            <span className="text-white text-xs font-medium">{log.user.firstName} {log.user.lastName}</span>
                            <span className="text-gray-500 text-xs block">{log.user.email}</span>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">System</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`font-medium text-xs ${getEntityColor(log.entity)}`}>
                          {log.entity}
                        </span>
                        {log.entityId && (
                          <span className="text-gray-500 text-xs block font-mono truncate max-w-[120px]">
                            {log.entityId}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 text-xs max-w-[200px] truncate">
                        {log.details || '-'}
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRow === log._id && log.changes && (
                        <tr>
                          <td colSpan={6}>
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-gray-900/50 border-t border-gray-700/50">
                                <h4 className="text-white text-xs font-semibold uppercase tracking-wider mb-3">{T.changes} ({T.before} / {T.after})</h4>
                                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto">
                                  {renderJsonDiff(log.changes.before, log.changes.after)}
                                </div>
                                {log.ipAddress && (
                                  <p className="text-gray-500 text-xs mt-3">{T.ipAddress}: {log.ipAddress}</p>
                                )}
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

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            {T.page} {pagination.page} {T.of} {pagination.pages}
            <span className="text-gray-500"> &middot; {pagination.total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              {T.previous}
            </button>
            {/* Page number buttons */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                let page: number;
                if (pagination.pages <= 5) {
                  page = i + 1;
                } else if (pagination.page <= 3) {
                  page = i + 1;
                } else if (pagination.page >= pagination.pages - 2) {
                  page = pagination.pages - 4 + i;
                } else {
                  page = pagination.page - 2 + i;
                }
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => handlePageChange(page)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      page === pagination.page
                        ? 'bg-[#f37121] text-white'
                        : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {T.next}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay for pagination */}
      {loading && logs.length > 0 && (
        <div className="fixed inset-0 bg-black/20 z-40 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
