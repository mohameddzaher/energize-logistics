'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getCollectionsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import DataTable from '@/components/system/DataTable';
import {
  Phone, Plus, X, Filter, Calendar, MessageSquare,
  CheckCircle2, Clock, Mail, MapPin, FileText, AlertCircle, Download
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call', icon: Phone, color: 'bg-blue-500/20 text-blue-600' },
  { value: 'email', label: 'Email', icon: Mail, color: 'bg-purple-500/20 text-purple-600' },
  { value: 'visit', label: 'Visit', icon: MapPin, color: 'bg-green-500/20 text-green-600' },
  { value: 'promise', label: 'Promise', icon: CheckCircle2, color: 'bg-yellow-500/20 text-yellow-700' },
  { value: 'follow_up', label: 'Follow-Up', icon: Clock, color: 'bg-orange-500/20 text-orange-600' },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'bg-emerald-500/20 text-emerald-600' },
  { value: 'note', label: 'Note', icon: FileText, color: 'bg-slate-500/20 text-slate-500' },
];

interface Activity {
  _id: string;
  customer: { _id: string; companyName: string } | null;
  invoice: { _id: string; invoiceNumber: string; amount: number } | null;
  collector: { _id: string; firstName: string; lastName: string } | null;
  type: string;
  promiseDate?: string;
  promiseAmount?: number;
  promiseFulfilled?: boolean;
  followUpDate?: string;
  notes?: string;
  contactType?: string;
  status?: string;
  amountCollected?: number;
  nextFollowUpDate?: string;
  completed?: boolean;
  completedAt?: string;
  completionNotes?: string;
  createdAt: string;
}

interface Customer {
  _id: string;
  companyName: string;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  amount: number;
  balance: number;
  customer: { _id: string; companyName: string };
}

export default function CollectionsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getCollectionsTranslations(lang);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [followUps, setFollowUps] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [form, setForm] = useState({
    customer: '',
    invoice: '',
    type: 'call',
    promiseDate: '',
    promiseAmount: '',
    followUpDate: '',
    notes: '',
    status: 'done',
    amountCollected: '',
    nextFollowUpDate: '',
  });

  // Tab
  const [activeTab, setActiveTab] = useState<'activities' | 'followups'>('activities');

  // Complete Follow-Up Modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingId, setCompletingId] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [completing, setCompleting] = useState(false);

  const fetchActivities = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (typeFilter) params.set('type', typeFilter);

      const data = await api.get<any>(`/api/collections?${params.toString()}`);
      setActivities(data.activities || []);
      setTotal(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  const fetchFollowUps = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/collections/follow-ups');
      setFollowUps(data.followUps || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchActivities();
    fetchFollowUps();
  }, [fetchActivities, fetchFollowUps]);

  useSocket('collection:logged', () => {
    fetchActivities();
    fetchFollowUps();
  });
  useSocket('collection:updated', () => {
    fetchActivities();
    fetchFollowUps();
  });
  useSocket('customer:deleted', fetchActivities);

  const fetchCustomers = async () => {
    try {
      const data = await api.get<any>('/api/customers?limit=500');
      setCustomers(data.customers || []);
    } catch {}
  };

  const fetchCustomerInvoices = async (customerId: string) => {
    if (!customerId) { setInvoices([]); return; }
    setLoadingInvoices(true);
    try {
      const data = await api.get<any>(`/api/invoices?customer=${customerId}&limit=200`);
      setInvoices(data.invoices || []);
    } catch {
      setInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setModalError('');
    setForm({ customer: '', invoice: '', type: 'call', promiseDate: '', promiseAmount: '', followUpDate: '', notes: '', status: 'done', amountCollected: '', nextFollowUpDate: '' });
    setInvoices([]);
    fetchCustomers();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (!form.customer) { setModalError('Please select a customer'); return; }
    if (!form.type) { setModalError('Please select an activity type'); return; }
    if (form.type === 'promise' && !form.promiseDate) { setModalError('Promise date is required for promise activities'); return; }
    if (form.type === 'follow_up' && !form.followUpDate) { setModalError('Follow-up date is required'); return; }

    setSubmitting(true);
    try {
      await api.post('/api/collections', {
        customer: form.customer,
        invoice: form.invoice || undefined,
        type: form.type,
        promiseDate: form.promiseDate || undefined,
        promiseAmount: form.promiseAmount ? Number(form.promiseAmount) : undefined,
        followUpDate: form.followUpDate || undefined,
        notes: form.notes || undefined,
        contactType: ['call', 'email', 'visit', 'whatsapp'].includes(form.type) ? form.type : undefined,
        status: form.status || 'done',
        amountCollected: form.amountCollected ? Number(form.amountCollected) : undefined,
        nextFollowUpDate: form.nextFollowUpDate || undefined,
      });
      setShowModal(false);
      fetchActivities();
      fetchFollowUps();
    } catch (err: any) {
      setModalError(err.message || 'Failed to log activity');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkPromise = async (id: string, fulfilled: boolean) => {
    try {
      await api.put(`/api/collections/${id}/promise`, { fulfilled });
      fetchActivities();
      fetchFollowUps();
    } catch {}
  };

  const handleCompleteFollowUp = async () => {
    if (!completingId) return;
    setCompleting(true);
    try {
      await api.put(`/api/collections/${completingId}/complete`, {
        notes: completionNotes || undefined,
      });
      setShowCompleteModal(false);
      setCompletingId('');
      setCompletionNotes('');
      fetchActivities();
      fetchFollowUps();
    } catch {}
    setCompleting(false);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const formatDateTime = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const getTypeInfo = (type: string) => ACTIVITY_TYPES.find(t => t.value === type) || ACTIVITY_TYPES[5];

  const getTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      call: T.call, email: T.emailType, visit: T.visit, promise: T.promise,
      follow_up: T.followUp, whatsapp: T.whatsapp, note: T.note,
    };
    return map[type] || type;
  };

  const columns = [
    {
      key: 'createdAt',
      label: T.date,
      render: (val: string) => <span className="text-slate-900 text-xs">{formatDateTime(val)}</span>,
    },
    {
      key: 'type',
      label: T.type,
      render: (val: string) => {
        const info = getTypeInfo(val);
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${info.color}`}>
            {getTypeLabel(val)}
          </span>
        );
      },
    },
    {
      key: 'contactType',
      label: T.activityType,
      render: (val: string) => val ? (
        <span className="text-slate-700 text-xs capitalize">{val}</span>
      ) : <span className="text-slate-500 text-xs">-</span>,
    },
    {
      key: 'customer',
      label: T.customer,
      render: (_: any, row: Activity) => (
        <span className="text-slate-900 font-medium text-sm">{row.customer?.companyName || '-'}</span>
      ),
    },
    {
      key: 'invoice',
      label: T.invoice,
      render: (_: any, row: Activity) => (
        <span className="text-[#f37121] text-sm">{row.invoice?.invoiceNumber || '-'}</span>
      ),
    },
    {
      key: 'collector',
      label: 'Collector',
      render: (_: any, row: Activity) => (
        <span className="text-slate-700 text-sm">
          {row.collector ? `${row.collector.firstName} ${row.collector.lastName}` : '-'}
        </span>
      ),
    },
    {
      key: 'notes',
      label: T.notes,
      render: (val: string) => (
        <span className="text-slate-500 text-xs truncate max-w-[200px] block">{val || '-'}</span>
      ),
    },
    {
      key: 'amountCollected',
      label: T.amountCollected,
      render: (val: number) => val ? (
        <span className="text-green-600 text-sm font-medium">
          {'SAR ' + Math.round(val || 0).toLocaleString('en-US')}
        </span>
      ) : <span className="text-slate-500 text-xs">-</span>,
    },
    {
      key: 'promiseFulfilled',
      label: T.status,
      render: (_: any, row: Activity) => {
        if (row.type === 'promise') {
          return row.promiseFulfilled ? (
            <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-600">Fulfilled</span>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleMarkPromise(row._id, true); }}
              className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-700 hover:bg-yellow-500/30 transition-colors"
            >
              Pending
            </button>
          );
        }
        if (row.type === 'follow_up' && row.followUpDate) {
          const isOverdue = new Date(row.followUpDate) < new Date();
          return (
            <span className={`px-2 py-0.5 rounded text-xs ${isOverdue ? 'bg-red-500/20 text-red-600' : 'bg-blue-500/20 text-blue-600'}`}>
              {isOverdue ? 'Overdue' : formatDate(row.followUpDate)}
            </span>
          );
        }
        return <span className="text-slate-500 text-xs">-</span>;
      },
    },
  ];

  const hasActiveFilters = !!typeFilter;

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Phone className="w-6 h-6 text-[#f37121]" />
            {T.title}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{total} total activities</p>
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
            {T.filters}
          </button>
          <button
            type="button"
            onClick={() => {
              const dataToExport = activeTab === 'activities' ? activities : followUps;
              const suffix = typeFilter ? `_${typeFilter}` : '';
              exportToExcel(
                dataToExport,
                [
                  { header: 'Date', key: 'createdAt', transform: fmt.datetime, width: 20 },
                  { header: 'Type', key: 'type', transform: fmt.status, width: 12 },
                  { header: 'Contact Type', key: 'contactType', transform: fmt.status, width: 14 },
                  { header: 'Customer', key: 'customer.companyName', width: 25 },
                  { header: 'Invoice #', key: 'invoice.invoiceNumber', width: 18 },
                  { header: 'Collector', key: 'collector', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 18 },
                  { header: 'Notes', key: 'notes', width: 30 },
                  { header: 'Amount Collected', key: 'amountCollected', transform: fmt.money, width: 18 },
                  { header: 'Status', key: 'status', transform: fmt.status, width: 12 },
                  { header: 'Promise Date', key: 'promiseDate', transform: fmt.date, width: 14 },
                  { header: 'Promise Amount', key: 'promiseAmount', transform: fmt.money, width: 16 },
                  { header: 'Promise Fulfilled', key: 'promiseFulfilled', transform: fmt.yesNo, width: 16 },
                  { header: 'Follow-Up Date', key: 'followUpDate', transform: fmt.date, width: 14 },
                  { header: 'Completed', key: 'completed', transform: fmt.yesNo, width: 12 },
                ],
                `Collections_${activeTab}${suffix}_${new Date().toISOString().split('T')[0]}`,
                activeTab === 'activities' ? 'Activities' : 'Follow-Ups'
              );
            }}
            disabled={(activeTab === 'activities' ? activities : followUps).length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
          <button
            type="button"
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors"
          >
            <Plus className="w-4 h-4" />
            {T.addActivity}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white p-1 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('activities')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'activities' ? 'bg-[#f37121] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          {T.title}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('followups')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'followups' ? 'bg-[#f37121] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          {T.followUps}
          {followUps.length > 0 && (
            <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center">
              {followUps.length}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-slate-900 font-medium text-sm">{T.filters}</h3>
                {hasActiveFilters && (
                  <button type="button" onClick={() => { setTypeFilter(''); setPage(1); }} className="text-[#f37121] text-xs hover:underline">
                    {T.clearFilters}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-500 text-xs mb-1.5">{T.activityType}</label>
                  <select
                    value={typeFilter}
                    onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.all}</option>
                    {ACTIVITY_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{getTypeLabel(t.value)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">{error}</div>
      )}

      {/* Content */}
      {activeTab === 'activities' ? (
        <>
          <DataTable
            columns={columns}
            data={activities}
            searchable
            searchPlaceholder={`${T.search}...`}
            emptyMessage={T.noActivities}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-slate-500 text-sm">{T.page} {page} {T.of} {totalPages}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 hover:bg-slate-100 transition-colors"
                >
                  {T.previous}
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm disabled:opacity-40 hover:bg-slate-100 transition-colors"
                >
                  {T.next}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Follow-Ups Tab */
        <div className="space-y-3">
          {followUps.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
              <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">{T.noActivities}</p>
            </div>
          ) : (
            followUps.map((fu) => {
              const isOverdue = fu.followUpDate ? new Date(fu.followUpDate) < new Date() : false;
              return (
                <div key={fu._id} className={`bg-white border rounded-xl p-4 ${isOverdue ? 'border-red-500/30' : 'border-slate-200'} shadow-sm`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-slate-900 font-medium text-sm">{fu.customer?.companyName || 'Unknown'}</p>
                      <p className="text-slate-500 text-xs mt-1">{fu.notes || 'No notes'}</p>
                      {fu.invoice && (
                        <p className="text-[#f37121] text-xs mt-1">Invoice: {fu.invoice.invoiceNumber}</p>
                      )}
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-right">
                        <p className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-orange-600'}`}>
                          {fu.followUpDate ? formatDate(fu.followUpDate) : '-'}
                        </p>
                        {isOverdue && (
                          <span className="text-xs text-red-600 flex items-center gap-1 mt-1 justify-end">
                            <AlertCircle className="w-3 h-3" /> Overdue
                          </span>
                        )}
                        <p className="text-slate-500 text-xs mt-1">
                          {fu.collector ? `${fu.collector.firstName} ${fu.collector.lastName}` : '-'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCompletingId(fu._id);
                          setCompletionNotes('');
                          setShowCompleteModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-600 text-xs font-medium border border-green-500/30 hover:bg-green-500/20 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {T.markComplete}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Complete Follow-Up Modal */}
      <AnimatePresence>
        {showCompleteModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCompleteModal(false)}
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
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.markComplete}</h2>
                  <button type="button" onClick={() => setShowCompleteModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {(() => {
                    const fu = followUps.find(f => f._id === completingId);
                    if (fu) {
                      return (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <p className="text-slate-900 text-sm font-medium">{fu.customer?.companyName || 'Unknown'}</p>
                          <p className="text-slate-500 text-xs mt-1">
                            {T.followUpDate}: {fu.followUpDate ? formatDate(fu.followUpDate) : '-'}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.completionNotes}</label>
                    <textarea
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      rows={3}
                      placeholder="Add notes about this follow-up completion..."
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCompleteModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleCompleteFollowUp}
                      disabled={completing}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {completing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {completing ? `${T.loading}` : T.markComplete}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Log Activity Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.addActivity}</h2>
                  <button type="button" onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                  {modalError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{modalError}</div>
                  )}

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.customer} *</label>
                    <select
                      value={form.customer}
                      onChange={(e) => {
                        setForm({ ...form, customer: e.target.value, invoice: '' });
                        fetchCustomerInvoices(e.target.value);
                      }}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="">{T.customer}...</option>
                      {customers.map(c => (
                        <option key={c._id} value={c._id}>{c.companyName}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.invoice}</label>
                    {loadingInvoices ? (
                      <div className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-sm">Loading...</div>
                    ) : (
                      <select
                        value={form.invoice}
                        onChange={(e) => setForm({ ...form, invoice: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                        disabled={!form.customer}
                      >
                        <option value="">{T.selectInvoice}</option>
                        {invoices.map(inv => (
                          <option key={inv._id} value={inv._id}>{inv.invoiceNumber} (Balance: ${inv.balance?.toLocaleString()})</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.activityType} *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {ACTIVITY_TYPES.map(t => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setForm({ ...form, type: t.value })}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                            form.type === t.value
                              ? 'border-[#f37121] bg-[#f37121]/20 text-[#f37121]'
                              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'
                          }`}
                        >
                          {getTypeLabel(t.value)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.status}</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="done">Done</option>
                      <option value="postponed">Postponed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  {/* Amount Collected */}
                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.amountCollected}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.amountCollected}
                      onChange={(e) => setForm({ ...form, amountCollected: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  {/* Next Follow-Up Date */}
                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.followUpDate}</label>
                    <input
                      type="date"
                      value={form.nextFollowUpDate}
                      onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    />
                  </div>

                  {form.type === 'promise' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-slate-500 text-xs mb-1.5">{T.promiseDate} *</label>
                        <input
                          type="date"
                          value={form.promiseDate}
                          onChange={(e) => setForm({ ...form, promiseDate: e.target.value })}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 text-xs mb-1.5">{T.promiseAmount}</label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.promiseAmount}
                          onChange={(e) => setForm({ ...form, promiseAmount: e.target.value })}
                          placeholder="0.00"
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                        />
                      </div>
                    </div>
                  )}

                  {form.type === 'follow_up' && (
                    <div>
                      <label className="block text-slate-500 text-xs mb-1.5">{T.followUpDate} *</label>
                      <input
                        type="date"
                        value={form.followUpDate}
                        onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-500 text-xs mb-1.5">{T.notes}</label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={3}
                      placeholder="Add notes about this activity..."
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {submitting ? `${T.loading}` : T.addActivity}
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
