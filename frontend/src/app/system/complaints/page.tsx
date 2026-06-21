'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Plus, Search, Loader2, X, Check, Trash2, AlertCircle, AlertTriangle,
  ChevronLeft, ChevronRight, Phone, User, Flag, Eye, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface Complaint {
  _id: string;
  subject: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  customerName: string;
  customerPhone?: string;
  resolution?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  resolvedAt?: string;
}

const CATEGORIES = [
  { value: 'service', label: 'Service', labelAr: 'الخدمة' },
  { value: 'delivery', label: 'Delivery', labelAr: 'التوصيل' },
  { value: 'billing', label: 'Billing', labelAr: 'الفواتير' },
  { value: 'damage', label: 'Damage', labelAr: 'أضرار' },
  { value: 'delay', label: 'Delay', labelAr: 'تأخير' },
  { value: 'staff', label: 'Staff', labelAr: 'الموظفين' },
  { value: 'other', label: 'Other', labelAr: 'أخرى' },
];

const PRIORITY_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  low: { label: 'Low', labelAr: 'منخفض', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  medium: { label: 'Medium', labelAr: 'متوسط', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  high: { label: 'High', labelAr: 'عالي', color: 'text-orange-600', bg: 'bg-orange-500/20' },
  urgent: { label: 'Urgent', labelAr: 'عاجل', color: 'text-red-600', bg: 'bg-red-500/20' },
};

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  open: { label: 'Open', labelAr: 'مفتوح', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  in_progress: { label: 'In Progress', labelAr: 'قيد المعالجة', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  resolved: { label: 'Resolved', labelAr: 'تم الحل', color: 'text-green-600', bg: 'bg-green-500/20' },
  closed: { label: 'Closed', labelAr: 'مغلق', color: 'text-slate-500', bg: 'bg-slate-500/20' },
};

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{message: string; onConfirm: () => void} | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState<string | null>(null);
  const [showViewModal, setShowViewModal] = useState<Complaint | null>(null);

  // Create form
  const [createForm, setCreateForm] = useState({
    subject: '', description: '', category: 'service', priority: 'medium',
    customerName: '', customerPhone: '',
  });
  const [creating, setCreating] = useState(false);

  // Resolve form
  const [resolution, setResolution] = useState('');
  const [resolving, setResolving] = useState(false);

  const fetchComplaints = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', String(limit));
      const data = await api.get<any>(`/api/complaints?${params.toString()}`) || {};
      setComplaints(data.complaints || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, priorityFilter, search, page]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // WebSocket
  const handleCreated = useCallback((c: Complaint) => {
    setComplaints(prev => [c, ...prev]);
    setTotal(t => t + 1);
  }, []);
  const handleUpdated = useCallback((c: Complaint) => {
    setComplaints(prev => prev.map(x => x._id === c._id ? c : x));
  }, []);
  const handleDeleted = useCallback((d: { _id: string }) => {
    setComplaints(prev => prev.filter(x => x._id !== d._id));
    setTotal(t => Math.max(0, t - 1));
  }, []);

  useSocket('complaint:created', handleCreated);
  useSocket('complaint:updated', handleUpdated);
  useSocket('complaint:resolved', handleUpdated);
  useSocket('complaint:deleted', handleDeleted);

  const handleCreate = async () => {
    try {
      setCreating(true);
      await api.post('/api/complaints', createForm);
      setShowCreateModal(false);
      setCreateForm({ subject: '', description: '', category: 'service', priority: 'medium', customerName: '', customerPhone: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleResolve = async () => {
    if (!showResolveModal) return;
    try {
      setResolving(true);
      await api.put(`/api/complaints/${showResolveModal}/resolve`, { resolution });
      setShowResolveModal(null);
      setResolution('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResolving(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmModal({
      message: isAr ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete this complaint?',
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/complaints/${id}`); } catch (err: any) { setError(err.message); }
      },
    });
  };

  const handleExport = () => {
    exportToExcel(complaints, [
      { header: 'Subject', key: 'subject', width: 25 },
      { header: 'Category', key: 'category', transform: fmt.status, width: 15 },
      { header: 'Priority', key: 'priority', transform: fmt.status, width: 12 },
      { header: 'Status', key: 'status', transform: fmt.status, width: 15 },
      { header: 'Customer', key: 'customerName', width: 20 },
      { header: 'Phone', key: 'customerPhone', width: 15 },
      { header: 'Description', key: 'description', width: 35 },
      { header: 'Resolution', key: 'resolution', width: 30 },
      { header: 'Created', key: 'createdAt', transform: fmt.date, width: 15 },
      { header: 'Resolved', key: 'resolvedAt', transform: fmt.date, width: 15 },
    ], 'complaints', 'Complaints');
  };

  const totalPages = Math.ceil(total / limit);

  const getCategoryLabel = (cat: string) => {
    const c = CATEGORIES.find(x => x.value === cat);
    return c ? (isAr ? c.labelAr : c.label) : cat;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-slate-900">{isAr ? 'الشكاوى' : 'Complaints'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={complaints.length === 0}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-900 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isAr ? 'تصدير' : 'Export'}
          </button>
          <button onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e0611a] text-white px-4 py-2.5 rounded-lg font-medium transition-colors">
            <Plus className="w-4 h-4" />
            {isAr ? 'شكوى جديدة' : 'New Complaint'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-red-600 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder={isAr ? 'بحث...' : 'Search complaints...'}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:border-[#f37121]" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{isAr ? 'كل الحالات' : 'All Status'}</option>
          <option value="open">{isAr ? 'مفتوح' : 'Open'}</option>
          <option value="in_progress">{isAr ? 'قيد المعالجة' : 'In Progress'}</option>
          <option value="resolved">{isAr ? 'تم الحل' : 'Resolved'}</option>
          <option value="closed">{isAr ? 'مغلق' : 'Closed'}</option>
        </select>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{isAr ? 'كل الفئات' : 'All Categories'}</option>
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{isAr ? c.labelAr : c.label}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{isAr ? 'كل الأولويات' : 'All Priorities'}</option>
          <option value="low">{isAr ? 'منخفض' : 'Low'}</option>
          <option value="medium">{isAr ? 'متوسط' : 'Medium'}</option>
          <option value="high">{isAr ? 'عالي' : 'High'}</option>
          <option value="urgent">{isAr ? 'عاجل' : 'Urgent'}</option>
        </select>
      </div>

      {/* Complaints List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : complaints.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد شكاوى' : 'No complaints found'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {complaints.map(c => {
            const pc = PRIORITY_CONFIG[c.priority] || PRIORITY_CONFIG.medium;
            const sc = STATUS_CONFIG[c.status] || STATUS_CONFIG.open;
            return (
              <div key={c._id} className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-slate-900 font-medium">{c.subject}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                        {isAr ? pc.labelAr : pc.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {getCategoryLabel(c.category)}
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-slate-500 text-sm mt-1 line-clamp-2">{c.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {c.customerName}</span>
                      {c.customerPhone && (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.customerPhone}</span>
                      )}
                      <span>{new Date(c.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</span>
                    </div>
                    {c.resolution && (
                      <div className="mt-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                        <p className="text-green-600 text-xs font-medium mb-1">{isAr ? 'الحل' : 'Resolution'}</p>
                        <p className="text-green-700 text-sm">{c.resolution}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setShowViewModal(c)}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                    {(c.status === 'open' || c.status === 'in_progress') && (
                      <button
                        onClick={() => { setShowResolveModal(c._id); setResolution(''); }}
                        className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-600 hover:bg-green-500/30 text-xs font-medium transition-colors flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        {isAr ? 'حل' : 'Resolve'}
                      </button>
                    )}
                    <button onClick={() => handleDelete(c._id)}
                      className="p-1.5 rounded-lg bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">{isAr ? `${total} نتيجة` : `${total} results`}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-500 text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowCreateModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'شكوى جديدة' : 'New Complaint'}</h2>
                  <button onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الموضوع' : 'Subject'}</label>
                    <input type="text" value={createForm.subject} onChange={e => setCreateForm(p => ({ ...p, subject: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الوصف' : 'Description'}</label>
                    <textarea value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الفئة' : 'Category'}</label>
                      <select value={createForm.category} onChange={e => setCreateForm(p => ({ ...p, category: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        {CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>{isAr ? c.labelAr : c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الأولوية' : 'Priority'}</label>
                      <select value={createForm.priority} onChange={e => setCreateForm(p => ({ ...p, priority: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="low">{isAr ? 'منخفض' : 'Low'}</option>
                        <option value="medium">{isAr ? 'متوسط' : 'Medium'}</option>
                        <option value="high">{isAr ? 'عالي' : 'High'}</option>
                        <option value="urgent">{isAr ? 'عاجل' : 'Urgent'}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'اسم العميل' : 'Customer Name'}</label>
                    <input type="text" value={createForm.customerName} onChange={e => setCreateForm(p => ({ ...p, customerName: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'رقم الهاتف' : 'Phone Number'}</label>
                    <input type="tel" value={createForm.customerPhone} onChange={e => setCreateForm(p => ({ ...p, customerPhone: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleCreate} disabled={creating || !createForm.subject || !createForm.customerName}
                    className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0611a] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isAr ? 'إنشاء' : 'Create'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Resolve Modal */}
      <AnimatePresence>
        {showResolveModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowResolveModal(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'حل الشكوى' : 'Resolve Complaint'}</h2>
                  <button onClick={() => setShowResolveModal(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div>
                  <label className="text-slate-500 text-sm block mb-1">{isAr ? 'نص الحل' : 'Resolution'}</label>
                  <textarea value={resolution} onChange={e => setResolution(e.target.value)}
                    placeholder={isAr ? 'اكتب تفاصيل الحل...' : 'Describe the resolution...'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={4} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowResolveModal(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleResolve} disabled={resolving || !resolution.trim()}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {resolving && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Check className="w-4 h-4" />
                    {isAr ? 'حل' : 'Resolve'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* View Modal */}
      <AnimatePresence>
        {showViewModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowViewModal(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'تفاصيل الشكوى' : 'Complaint Details'}</h2>
                  <button onClick={() => setShowViewModal(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-slate-500 text-xs">{isAr ? 'الموضوع' : 'Subject'}</p>
                    <p className="text-slate-900 text-sm mt-0.5 font-medium">{showViewModal.subject}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">{isAr ? 'الوصف' : 'Description'}</p>
                    <p className="text-slate-900 text-sm mt-0.5">{showViewModal.description || '-'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-slate-500 text-xs">{isAr ? 'الفئة' : 'Category'}</p>
                      <p className="text-slate-900 text-sm mt-0.5">{getCategoryLabel(showViewModal.category)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">{isAr ? 'الأولوية' : 'Priority'}</p>
                      <p className="text-slate-900 text-sm mt-0.5">{isAr ? PRIORITY_CONFIG[showViewModal.priority]?.labelAr : PRIORITY_CONFIG[showViewModal.priority]?.label}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">{isAr ? 'الحالة' : 'Status'}</p>
                      <p className="text-slate-900 text-sm mt-0.5">{isAr ? STATUS_CONFIG[showViewModal.status]?.labelAr : STATUS_CONFIG[showViewModal.status]?.label}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">{isAr ? 'التاريخ' : 'Date'}</p>
                      <p className="text-slate-900 text-sm mt-0.5">{new Date(showViewModal.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-slate-500 text-xs">{isAr ? 'اسم العميل' : 'Customer'}</p>
                      <p className="text-slate-900 text-sm mt-0.5">{showViewModal.customerName}</p>
                    </div>
                    {showViewModal.customerPhone && (
                      <div>
                        <p className="text-slate-500 text-xs">{isAr ? 'الهاتف' : 'Phone'}</p>
                        <p className="text-slate-900 text-sm mt-0.5">{showViewModal.customerPhone}</p>
                      </div>
                    )}
                  </div>
                  {showViewModal.resolution && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                      <p className="text-green-600 text-xs font-medium mb-1">{isAr ? 'الحل' : 'Resolution'}</p>
                      <p className="text-green-700 text-sm">{showViewModal.resolution}</p>
                    </div>
                  )}
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setShowViewModal(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {isAr ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{isAr ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-slate-700 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">
                {isAr ? 'حذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
