'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getAuditTranslations, getAuditExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, RefreshCw, Filter, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Calendar, Search, X
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { SearchableSelect } from '@/components/hr/HRKit';

interface AuditLog {
  _id: string;
  user: { _id: string; firstName: string; lastName: string; email: string; deleted?: boolean } | null;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  // Either a { before, after } diff or a flat summary object — both occur.
  changes?: Record<string, any> | null;
  ipAddress?: string;
  createdAt: string;
}

interface AuditActor { _id: string; firstName: string; lastName: string; email: string; role?: string }

// ---- Readable rendering helpers --------------------------------------------
// Arabic labels for the verbs and entities that actually occur, so a row reads
// as "إنشاء · طلب شحن" instead of "create_shipment_order · ShipmentOrder".
const ACTION_AR: Record<string, string> = {
  create: 'إنشاء', add: 'إضافة', update: 'تعديل', edit: 'تعديل', delete: 'حذف', remove: 'إزالة',
  complete: 'إكمال', receive: 'استلام', fulfill: 'تنفيذ', approve: 'اعتماد', reject: 'رفض',
  login: 'تسجيل دخول', logout: 'تسجيل خروج', activate: 'تفعيل', deactivate: 'إيقاف',
  transfer: 'نقل', assign: 'إسناد', revoke: 'إلغاء', import: 'استيراد', export: 'تصدير',
  wallet_transaction: 'حركة محفظة', lock: 'قفل', unlock: 'فتح',
};
const ENTITY_AR: Record<string, string> = {
  User: 'مستخدم', Customer: 'عميل', Invoice: 'فاتورة', Payment: 'دفعة', Dispute: 'نزاع',
  Branch: 'فرع', Vendor: 'مورد', Employee: 'موظف', Contract: 'عقد', Asset: 'عهدة',
  ShipmentOrder: 'طلب شحن', FleetShipment: 'حمولة أسطول', FleetDriver: 'سائق أسطول', FleetVehicle: 'سيارة أسطول',
  MaintenanceRequest: 'طلب صيانة', InventoryItem: 'صنف مستودع', WorkshopPurchaseRequest: 'طلب شراء ورشة',
  WalletTransaction: 'حركة محفظة', CustomsClearance: 'تخليص جمركي', B2CProject: 'مشروع B2C',
  CompanyLicense: 'ترخيص شركة', VehicleAuthorization: 'تفويض مركبة', VehicleAccident: 'حادث مركبة',
};
const actionLabel = (a: string, ar: boolean) => {
  if (!ar) return a.replace(/_/g, ' ');
  if (ACTION_AR[a]) return ACTION_AR[a];
  const [verb, ...rest] = a.split('_');
  return ACTION_AR[verb] ? `${ACTION_AR[verb]} ${rest.join(' ')}`.trim() : a.replace(/_/g, ' ');
};
const entityLabel = (e: string, ar: boolean) => (ar && ENTITY_AR[e]) || e;

const isDiffShape = (c: any) => c && typeof c === 'object' && ('before' in c || 'after' in c);
const scalar = (v: any) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// One human-readable line for the table's details column — the values that were
// written, or which fields an update touched. No expanding needed to know what
// a row DID.
function changeSummary(log: AuditLog): string {
  const c = log.changes;
  if (!c || typeof c !== 'object') return '';
  if (isDiffShape(c)) {
    const before = (c as any).before || {};
    const after = (c as any).after || {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    const src = Object.keys(after).length ? after : before;
    return keys.slice(0, 4).map((k) => `${k}: ${scalar(src[k])}`).join(' · ') + (keys.length > 4 ? ` · +${keys.length - 4}` : '');
  }
  const entries = Object.entries(c).filter(([, v]) => v != null);
  return entries.slice(0, 4).map(([k, v]) => `${k}: ${scalar(v)}`).join(' · ') + (entries.length > 4 ? ` · +${entries.length - 4}` : '');
}

const hasChangeDetails = (log: AuditLog) =>
  !!log.changes && typeof log.changes === 'object' && Object.keys(log.changes).length > 0;

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export default function AuditPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const T = getAuditTranslations(lang);
  const txx = getAuditExtraTranslations(lang);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 25, total: 0, pages: 0 });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters — the vocabulary (real actors + entities that actually occur)
  // comes from /api/audit/options, not a hardcoded list.
  const [entityFilter, setEntityFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionSearch, setActionSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [entities, setEntities] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ entities: string[]; users: AuditActor[] }>('/api/audit/options')
      .then((d) => { setEntities(d.entities || []); setActors(d.users || []); })
      .catch(() => { /* filters degrade to free entry */ });
  }, []);

  const fetchLogs = useCallback(async (page = 1) => {
    try {
      setError('');
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '25');
      if (entityFilter) params.set('entity', entityFilter);
      if (userFilter) params.set('user', userFilter);
      if (actionSearch.trim()) params.set('action', actionSearch.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

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
      setError(err.message || txx.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [entityFilter, userFilter, actionSearch, dateFrom, dateTo]);

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
    setEntityFilter('');
    setUserFilter('');
    setActionSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = !!(entityFilter || userFilter || actionSearch || dateFrom || dateTo);

  const exportColumns: ExportColumn[] = [
    { header: T.date, key: 'createdAt', transform: fmt.datetime, width: 22 },
    { header: T.user, key: 'user', transform: (_: any, row: any) => row.user ? `${row.user.firstName} ${row.user.lastName}` : txx.system, width: 20 },
    { header: T.email, key: 'user.email', width: 24 },
    { header: T.action, key: 'action', width: 20 },
    { header: T.entity, key: 'entity', width: 14 },
    { header: T.entityId, key: 'entityId', width: 26 },
    { header: T.details, key: 'details', transform: (_: any, row: any) => changeSummary(row) || row.details || '', width: 48 },
    { header: T.ipAddress, key: 'ipAddress', width: 16 },
  ];
  // السجلّ مرقَّمٌ على الخادم بخمسةٍ وعشرين سطرًا، والسجلّ نفسه يبلغ عشرات الآلاف؛
  // فتصدير ما في الذاكرة كان يعطي ربع دقيقةٍ من التاريخ ويُسمّيه «تحميل السجلّ».
  // لذلك نُعيد الجلب بحدٍّ مفتوح قبل التصدير كلّما طُلب أكثر من الصفحة الحاضرة.
  const fetchForExport = async (withFilters: boolean) => {
    const params = new URLSearchParams({ page: '1', limit: '100000' });
    if (withFilters) {
      if (entityFilter) params.set('entity', entityFilter);
      if (userFilter) params.set('user', userFilter);
      if (actionSearch.trim()) params.set('action', actionSearch.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
    }
    const data = await api.get<any>(`/api/audit?${params.toString()}`);
    return [{ name: T.title, rows: data.logs || data.auditLogs || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: T.title, rows: logs, columns: exportColumns }] },
    { key: 'matching', label: hasActiveFilters ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(pagination.total) },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];

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

    if (diffMins < 1) return txx.justNow;
    if (diffMins < 60) return `${diffMins}${txx.minutesAgo}`;
    if (diffHours < 24) return `${diffHours}${txx.hoursAgo}`;
    if (diffDays < 7) return `${diffDays}${txx.daysAgo}`;
    return formatTimestamp(date);
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add')) return 'text-green-600 bg-green-500/10';
    if (a.includes('delete') || a.includes('remove') || a.includes('deactivate')) return 'text-red-600 bg-red-500/10';
    if (a.includes('update') || a.includes('edit') || a.includes('modify')) return 'text-blue-600 bg-blue-500/10';
    if (a.includes('login') || a.includes('auth')) return 'text-purple-600 bg-purple-500/10';
    if (a.includes('lock') || a.includes('unlock')) return 'text-yellow-700 bg-yellow-500/10';
    return 'text-slate-500 bg-slate-500/10';
  };

  const getEntityColor = (entity: string) => {
    const e = entity.toLowerCase();
    if (e === 'user') return 'text-purple-600';
    if (e === 'customer') return 'text-blue-600';
    if (e === 'invoice') return 'text-[#f37121]';
    if (e === 'payment') return 'text-green-600';
    if (e === 'dispute') return 'text-red-600';
    return 'text-slate-500';
  };

  // A plain label → value list (create logs, flat summaries).
  const renderValueList = (obj: Record<string, any>) => (
    <div className="space-y-1">
      {Object.entries(obj).map(([key, v]) => (
        <div key={key} className="flex items-start gap-3 px-3 py-1.5 rounded text-xs bg-white">
          <span className="text-slate-600 font-medium min-w-[140px] shrink-0 break-all">{key}</span>
          <span className="text-slate-900 break-all">{scalar(v)}</span>
        </div>
      ))}
    </div>
  );

  // Renders whatever shape the log carries: a before/after diff, an after-only
  // snapshot (creates), or a flat summary object. The old renderer assumed
  // before/after and showed "no details" for everything else.
  const renderChanges = (c: Record<string, any>) => {
    if (!c || !Object.keys(c).length) return <p className="text-slate-500 text-xs">{txx.noChangeDetails}</p>;
    if (isDiffShape(c)) {
      const before = (c as any).before || {};
      const after = (c as any).after || {};
      if (!Object.keys(before).length || !Object.keys(after).length) {
        return renderValueList(Object.keys(after).length ? after : before);
      }
      const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
      return (
        <div className="space-y-1">
          {allKeys.map((key) => {
            const bVal = before[key];
            const aVal = after[key];
            const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
            return (
              <div key={key} className={`flex items-start gap-3 px-3 py-1.5 rounded text-xs ${changed ? 'bg-white' : ''}`}>
                <span className="text-slate-600 font-medium min-w-[140px] shrink-0 break-all">{key}</span>
                {changed ? (
                  <div className="flex-1 space-y-0.5">
                    {bVal !== undefined && (
                      <div className="flex items-start gap-1">
                        <span className="text-red-600 shrink-0">-</span>
                        <span className="text-red-700 break-all">{scalar(bVal)}</span>
                      </div>
                    )}
                    {aVal !== undefined && (
                      <div className="flex items-start gap-1">
                        <span className="text-green-600 shrink-0">+</span>
                        <span className="text-green-700 break-all">{scalar(aVal)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-600 break-all">{scalar(bVal)}</span>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    return renderValueList(c);
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
          <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {pagination.total > 0 && (
              <span className="text-slate-500">{pagination.total.toLocaleString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu fileName="audit-log" lang={ar ? 'ar' : 'en'} variant="subtle" label={T.downloadExcel} options={exportOptions} />
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
              hasActiveFilters
                ? 'border-[#f37121] text-[#f37121] bg-[#f37121]/10'
                : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
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
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title={txx.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">
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
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-slate-900 font-medium text-sm">{T.filters}</h3>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Person — the whole point: one user's own history */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{ar ? 'الشخص' : 'Person'}</label>
                  <SearchableSelect
                    value={userFilter}
                    onChange={setUserFilter}
                    placeholder={ar ? 'كل المستخدمين' : 'All users'}
                    searchPlaceholder={ar ? 'ابحث بالاسم أو الإيميل…' : 'Search name or email…'}
                    options={[
                      { value: '', label: ar ? 'كل المستخدمين' : 'All users' },
                      ...actors.map((u) => ({ value: u._id, label: `${u.firstName} ${u.lastName}`.trim() || u.email, hint: u.email })),
                    ]}
                  />
                </div>

                {/* Entity Type — the entities that actually occur in the log */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{T.entity}</label>
                  <SearchableSelect
                    value={entityFilter}
                    onChange={setEntityFilter}
                    placeholder={ar ? 'كل الأنواع' : 'All entities'}
                    options={[
                      { value: '', label: ar ? 'كل الأنواع' : 'All entities' },
                      ...entities.map((e) => ({ value: e, label: entityLabel(e, ar), hint: ar ? e : undefined })),
                    ]}
                  />
                </div>

                {/* Action Search */}
                <div>
                  <label className="block text-slate-500 text-xs font-medium mb-1.5">{T.action}</label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={actionSearch}
                      onChange={(e) => setActionSearch(e.target.value)}
                      placeholder={T.searchAction}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>
                </div>

                {/* Date From */}
                <div>
                  <label className="block text-slate-500 text-xs font-medium mb-1.5">{T.from}</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                    />
                  </div>
                </div>

                {/* Date To */}
                <div>
                  <label className="block text-slate-500 text-xs font-medium mb-1.5">{T.to}</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
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
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider w-8" />
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.date}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.user}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.action}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.entity}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-800 text-sm">
                    {T.noLogs}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <React.Fragment key={log._id}>
                    <tr
                      onClick={() => hasChangeDetails(log) ? toggleRow(log._id) : undefined}
                      className={`bg-slate-50 hover:bg-slate-100 transition-colors ${hasChangeDetails(log) ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-800">
                        {hasChangeDetails(log) && (
                          expandedRow === log._id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>
                          <span className="text-slate-700 text-xs">{formatTimestamp(log.createdAt)}</span>
                          <span className="text-slate-700 text-xs block">{formatRelativeTime(log.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {log.user ? (
                          <div>
                            {/* Clicking a name filters straight to that person's history */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setUserFilter(log.user!._id); setShowFilters(true); }}
                              className="text-slate-900 text-xs font-medium hover:text-[#f37121] hover:underline text-start"
                              title={ar ? 'عرض كل نشاط هذا المستخدم' : "Show this user's full history"}
                            >
                              {log.user.firstName} {log.user.lastName}
                            </button>
                            {/* حسابٌ أُزيل: الفعلُ فعلُ إنسانٍ وإن ذهب حسابُه —
                                وتركُه بلا علامةٍ يجعل الاسمَ يبدو حسابًا قائمًا. */}
                            {log.user.deleted && (
                              <span className="ms-1 text-[10px] text-amber-600">{ar ? '(حساب محذوف)' : '(deleted account)'}</span>
                            )}
                            <span className="text-slate-700 text-xs block">{log.user.email}</span>
                          </div>
                        ) : (
                          <span className="text-slate-700 text-xs">{txx.system}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {actionLabel(log.action, ar)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`font-medium text-xs ${getEntityColor(log.entity)}`}>
                          {entityLabel(log.entity, ar)}
                        </span>
                        {log.entityId && (
                          <span className="text-slate-500 text-[10px] block font-mono truncate max-w-[120px]">
                            {log.entityId}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-800 max-w-[340px]">
                        <span className="line-clamp-2 break-words" title={changeSummary(log)}>
                          {changeSummary(log) || log.details || '—'}
                        </span>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRow === log._id && hasChangeDetails(log) && (
                        <tr>
                          <td colSpan={6}>
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-slate-100 border-t border-slate-200/70">
                                <h4 className="text-slate-900 text-xs font-semibold uppercase tracking-wider mb-3">{T.changes}</h4>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
                                  {renderChanges(log.changes as Record<string, any>)}
                                </div>
                                {log.ipAddress && (
                                  <p className="text-slate-700 text-xs mt-3">{T.ipAddress}: {log.ipAddress}</p>
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
          <p className="text-slate-500 text-sm">
            {T.page} {pagination.page} {T.of} {pagination.pages}
            <span className="text-slate-500"> &middot; {pagination.total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                        : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
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
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
