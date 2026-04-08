'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench, Plus, Search, Filter, Loader2, X, Check, Trash2, Eye, Clock,
  AlertCircle, ChevronLeft, ChevronRight, Send, CheckCircle2, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface Part {
  name: string;
  quantity: number;
}

interface MaintenanceRequest {
  _id: string;
  vehicleNumber: string;
  vehicleType: string;
  driverName: string;
  technicianName: string;
  status: 'open' | 'in_progress' | 'completed';
  startTime: string;
  endTime?: string;
  duration?: number;
  workDescription?: string;
  notes?: string;
  partsNeeded?: (Part & { status?: string })[];
  createdAt: string;
  createdBy?: { firstName?: string; lastName?: string; _id?: string };
  branch?: { name?: string; _id?: string } | string;
}

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  open: { label: 'Open', labelAr: 'مفتوح', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  in_progress: { label: 'In Progress', labelAr: 'قيد التنفيذ', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  completed: { label: 'Completed', labelAr: 'مكتمل', color: 'text-green-400', bg: 'bg-green-500/20' },
};

export default function WorkshopPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Success notification
  const [success, setSuccess] = useState('');

  // Stats
  const [stats, setStats] = useState({ open: 0, inProgress: 0, completedToday: 0, avgDuration: 0 });

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState<string | null>(null);
  const [showViewModal, setShowViewModal] = useState<MaintenanceRequest | null>(null);

  // Create form
  const [createForm, setCreateForm] = useState({
    vehicleNumber: '', vehicleType: '', driverName: '', technicianName: '', notes: '',
  });
  const [creating, setCreating] = useState(false);

  // Complete form
  const [completeForm, setCompleteForm] = useState({
    workDescription: '', technicianName: '', notes: '',
    parts: [{ name: '', quantity: 1 }] as Part[],
  });
  const [completing, setCompleting] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (search) params.append('search', search);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      params.append('page', String(page));
      params.append('limit', String(limit));
      const data = await api.get<any>(`/api/workshop/maintenance?${params.toString()}`) || {};
      setRequests(data.requests || []);
      setTotal(data.total || 0);
      if (data.stats) {
        setStats({
          open: data.stats.open ?? 0,
          inProgress: data.stats.inProgress ?? 0,
          completedToday: data.stats.completedToday ?? 0,
          avgDuration: data.stats.avgDuration ?? 0,
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, dateFrom, dateTo, page]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // WebSocket
  const handleCreated = useCallback((r: MaintenanceRequest) => {
    setRequests(prev => [r, ...prev]);
    setTotal(t => t + 1);
  }, []);
  const handleUpdated = useCallback((r: MaintenanceRequest) => {
    setRequests(prev => prev.map(x => x._id === r._id ? r : x));
  }, []);
  const handleCompleted = useCallback((r: MaintenanceRequest) => {
    setRequests(prev => prev.map(x => x._id === r._id ? r : x));
  }, []);
  const handleDeleted = useCallback((d: { _id: string }) => {
    setRequests(prev => prev.filter(x => x._id !== d._id));
    setTotal(t => Math.max(0, t - 1));
  }, []);

  useSocket('maintenance:created', handleCreated);
  useSocket('maintenance:updated', handleUpdated);
  useSocket('maintenance:completed', handleCompleted);
  useSocket('maintenance:deleted', handleDeleted);

  const handleCreate = async () => {
    try {
      setCreating(true);
      await api.post('/api/workshop/maintenance', createForm);
      setShowCreateModal(false);
      setCreateForm({ vehicleNumber: '', vehicleType: '', driverName: '', technicianName: '', notes: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleComplete = async () => {
    if (!showCompleteModal) return;
    try {
      setCompleting(true);
      await api.put(`/api/workshop/maintenance/${showCompleteModal}/complete`, {
        workDescription: completeForm.workDescription,
        technicianName: completeForm.technicianName,
        notes: completeForm.notes,
        partsNeeded: completeForm.parts.filter(p => p.name.trim()),
      });
      setShowCompleteModal(null);
      setCompleteForm({ workDescription: '', technicianName: '', notes: '', parts: [{ name: '', quantity: 1 }] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(isAr ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) return;
    try {
      await api.delete(`/api/workshop/maintenance/${id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const sendPartToPurchasing = async (maintenanceId: string, part: Part) => {
    try {
      await api.post('/api/workshop/purchases', {
        maintenanceId,
        itemName: part.name,
        quantity: part.quantity,
      });
      setSuccess(isAr ? 'تم إرسال الطلب للمشتريات' : 'Sent to purchasing');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addPart = () => {
    setCompleteForm(prev => ({ ...prev, parts: [...prev.parts, { name: '', quantity: 1 }] }));
  };

  const removePart = (idx: number) => {
    setCompleteForm(prev => ({ ...prev, parts: prev.parts.filter((_, i) => i !== idx) }));
  };

  const updatePart = (idx: number, field: keyof Part, value: string | number) => {
    setCompleteForm(prev => ({
      ...prev,
      parts: prev.parts.map((p, i) => i === idx ? { ...p, [field]: value } : p),
    }));
  };

  const handleExport = () => {
    exportToExcel(requests, [
      { header: 'Vehicle #', key: 'vehicleNumber', width: 15 },
      { header: 'Type', key: 'vehicleType', width: 15 },
      { header: 'Driver', key: 'driverName', width: 20 },
      { header: 'Technician', key: 'technicianName', width: 20 },
      { header: 'Status', key: 'status', transform: fmt.status, width: 15 },
      { header: 'Start Time', key: 'startTime', transform: fmt.datetime, width: 20 },
      { header: 'End Time', key: 'endTime', transform: fmt.datetime, width: 20 },
      { header: 'Duration (min)', key: 'duration', width: 15 },
      { header: 'Work Description', key: 'workDescription', width: 30 },
      { header: 'Notes', key: 'notes', width: 30 },
    ], 'maintenance-requests', 'Maintenance');
  };

  const totalPages = Math.ceil(total / limit);

  const formatDuration = (minutes?: number) => {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wrench className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-white">
            {isAr ? 'الورشة والصيانة' : 'Workshop & Maintenance'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={requests.length === 0}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isAr ? 'تصدير' : 'Export'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e0611a] text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {isAr ? 'طلب صيانة جديد' : 'Add Request'}
          </button>
        </div>
      </div>

      {/* Success */}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: isAr ? 'مفتوح' : 'Open', value: stats.open, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: isAr ? 'قيد التنفيذ' : 'In Progress', value: stats.inProgress, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: isAr ? 'مكتمل اليوم' : 'Completed Today', value: stats.completedToday, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: isAr ? 'متوسط المدة' : 'Avg Duration', value: formatDuration(stats.avgDuration), color: 'text-purple-400', bg: 'bg-purple-500/10' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} border border-gray-700 rounded-lg p-4`}>
            <p className="text-gray-400 text-sm">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={isAr ? 'بحث برقم المركبة...' : 'Search by vehicle number...'}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        >
          <option value="">{isAr ? 'كل الحالات' : 'All Status'}</option>
          <option value="open">{isAr ? 'مفتوح' : 'Open'}</option>
          <option value="in_progress">{isAr ? 'قيد التنفيذ' : 'In Progress'}</option>
          <option value="completed">{isAr ? 'مكتمل' : 'Completed'}</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Wrench className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد طلبات صيانة' : 'No maintenance requests found'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {[
                  isAr ? 'رقم المركبة' : 'Vehicle #',
                  isAr ? 'النوع' : 'Type',
                  isAr ? 'السائق' : 'Driver',
                  isAr ? 'الفني' : 'Technician',
                  isAr ? 'الحالة' : 'Status',
                  isAr ? 'وقت البدء' : 'Start Time',
                  isAr ? 'وقت الانتهاء' : 'End Time',
                  isAr ? 'المدة' : 'Duration',
                  isAr ? 'إجراءات' : 'Actions',
                ].map((h, i) => (
                  <th key={i} className="text-left text-gray-400 font-medium py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(r => {
                const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.open;
                return (
                  <tr key={r._id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-3 px-3 text-white font-medium">{r.vehicleNumber}</td>
                    <td className="py-3 px-3 text-gray-300">{r.vehicleType || '-'}</td>
                    <td className="py-3 px-3 text-gray-300">{r.driverName || '-'}</td>
                    <td className="py-3 px-3 text-gray-300">{r.technicianName || '-'}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-300 whitespace-nowrap">
                      {r.startTime ? new Date(r.startTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="py-3 px-3 text-gray-300 whitespace-nowrap">
                      {r.endTime ? new Date(r.endTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="py-3 px-3 text-gray-300">{formatDuration(r.duration)}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {r.status !== 'completed' && (
                          <button
                            onClick={() => {
                              setShowCompleteModal(r._id);
                              setCompleteForm({ workDescription: '', technicianName: r.technicianName || '', notes: '', parts: [{ name: '', quantity: 1 }] });
                            }}
                            className="p-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                            title={isAr ? 'اكتمال' : 'Complete'}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setShowViewModal(r)}
                          className="p-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                          title={isAr ? 'عرض' : 'View'}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(r._id)}
                          className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          title={isAr ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            {isAr ? `${total} نتيجة` : `${total} results`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-400 text-sm">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">{isAr ? 'طلب صيانة جديد' : 'New Maintenance Request'}</h2>
                  <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'رقم المركبة' : 'Vehicle Number'}</label>
                    <input type="text" value={createForm.vehicleNumber} onChange={e => setCreateForm(p => ({ ...p, vehicleNumber: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'نوع المركبة' : 'Vehicle Type'}</label>
                    <input type="text" value={createForm.vehicleType} onChange={e => setCreateForm(p => ({ ...p, vehicleType: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'اسم السائق' : 'Driver Name'}</label>
                    <input type="text" value={createForm.driverName} onChange={e => setCreateForm(p => ({ ...p, driverName: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'اسم الفني' : 'Technician Name'}</label>
                    <input type="text" value={createForm.technicianName} onChange={e => setCreateForm(p => ({ ...p, technicianName: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea value={createForm.notes} onChange={e => setCreateForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleCreate} disabled={creating || !createForm.vehicleNumber}
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

      {/* Complete Modal */}
      <AnimatePresence>
        {showCompleteModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowCompleteModal(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">{isAr ? 'إكمال طلب الصيانة' : 'Complete Maintenance Request'}</h2>
                  <button onClick={() => setShowCompleteModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'وصف العمل' : 'Work Description'}</label>
                    <textarea value={completeForm.workDescription} onChange={e => setCompleteForm(p => ({ ...p, workDescription: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'اسم الفني' : 'Technician Name'}</label>
                    <input type="text" value={completeForm.technicianName} onChange={e => setCompleteForm(p => ({ ...p, technicianName: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea value={completeForm.notes} onChange={e => setCompleteForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={2} />
                  </div>

                  {/* Parts Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-gray-400 text-sm font-medium">{isAr ? 'قطع الغيار المطلوبة' : 'Parts Needed'}</label>
                      <button onClick={addPart} className="text-[#f37121] text-xs hover:underline flex items-center gap-1">
                        <Plus className="w-3 h-3" /> {isAr ? 'إضافة' : 'Add'}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {completeForm.parts.map((part, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text" placeholder={isAr ? 'اسم القطعة' : 'Part name'} value={part.name}
                            onChange={e => updatePart(idx, 'name', e.target.value)}
                            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
                          />
                          <input
                            type="number" min={1} value={part.quantity}
                            onChange={e => updatePart(idx, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-20 bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
                          />
                          {part.name.trim() && (
                            <button
                              onClick={() => sendPartToPurchasing(showCompleteModal, part)}
                              className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                              title={isAr ? 'إرسال للمشتريات' : 'Send to Purchasing'}
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {completeForm.parts.length > 1 && (
                            <button onClick={() => removePart(idx)} className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCompleteModal(null)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleComplete} disabled={completing}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {completing && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Check className="w-4 h-4" />
                    {isAr ? 'إكمال' : 'Complete'}
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">{isAr ? 'تفاصيل طلب الصيانة' : 'Maintenance Request Details'}</h2>
                  <button onClick={() => setShowViewModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: isAr ? 'رقم المركبة' : 'Vehicle #', value: showViewModal.vehicleNumber },
                    { label: isAr ? 'النوع' : 'Type', value: showViewModal.vehicleType || '-' },
                    { label: isAr ? 'السائق' : 'Driver', value: showViewModal.driverName || '-' },
                    { label: isAr ? 'الفني' : 'Technician', value: showViewModal.technicianName || '-' },
                    { label: isAr ? 'الحالة' : 'Status', value: isAr ? STATUS_CONFIG[showViewModal.status]?.labelAr : STATUS_CONFIG[showViewModal.status]?.label },
                    { label: isAr ? 'المدة' : 'Duration', value: formatDuration(showViewModal.duration) },
                    { label: isAr ? 'وقت البدء' : 'Start Time', value: showViewModal.startTime ? new Date(showViewModal.startTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-' },
                    { label: isAr ? 'وقت الانتهاء' : 'End Time', value: showViewModal.endTime ? new Date(showViewModal.endTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-' },
                    { label: isAr ? 'تاريخ الإنشاء' : 'Created At', value: showViewModal.createdAt ? new Date(showViewModal.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-' },
                    { label: isAr ? 'أنشئ بواسطة' : 'Created By', value: showViewModal.createdBy ? `${showViewModal.createdBy.firstName || ''} ${showViewModal.createdBy.lastName || ''}`.trim() || '-' : '-' },
                    { label: isAr ? 'الفرع' : 'Branch', value: typeof showViewModal.branch === 'object' ? showViewModal.branch?.name || '-' : showViewModal.branch || '-' },
                  ].map((item, i) => (
                    <div key={i}>
                      <p className="text-gray-500 text-xs">{item.label}</p>
                      <p className="text-white text-sm mt-0.5">{item.value}</p>
                    </div>
                  ))}
                </div>
                {showViewModal.workDescription && (
                  <div>
                    <p className="text-gray-500 text-xs">{isAr ? 'وصف العمل' : 'Work Description'}</p>
                    <p className="text-white text-sm mt-0.5">{showViewModal.workDescription}</p>
                  </div>
                )}
                {showViewModal.notes && (
                  <div>
                    <p className="text-gray-500 text-xs">{isAr ? 'ملاحظات' : 'Notes'}</p>
                    <p className="text-white text-sm mt-0.5">{showViewModal.notes}</p>
                  </div>
                )}
                {showViewModal.partsNeeded && showViewModal.partsNeeded.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs mb-2">{isAr ? 'قطع الغيار' : 'Parts Needed'}</p>
                    <div className="space-y-1">
                      {showViewModal.partsNeeded.map((p, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                          <span className="text-white text-sm">{p.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-sm">x{p.quantity}</span>
                            {p.status && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                p.status === 'delivered' ? 'bg-green-500/20 text-green-400' :
                                p.status === 'ordered' ? 'bg-blue-500/20 text-blue-400' :
                                p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-gray-700 text-gray-400'
                              }`}>
                                {p.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button onClick={() => setShowViewModal(null)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
