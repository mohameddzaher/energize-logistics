'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench, Plus, Search, Loader2, X, Check, Trash2, Eye,
  AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface Part {
  name: string;
  quantity: number;
  sentToPurchasing?: boolean;
  purchaseRequestId?: string;
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
  open: { label: 'Open', labelAr: 'مفتوح', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  in_progress: { label: 'In Progress', labelAr: 'قيد التنفيذ', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  completed: { label: 'Completed', labelAr: 'مكتمل', color: 'text-green-600', bg: 'bg-green-500/20' },
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

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{message: string; onConfirm: () => void} | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState<string | null>(null);
  const [showViewModal, setShowViewModal] = useState<MaintenanceRequest | null>(null);
  const [viewPurchases, setViewPurchases] = useState<any[]>([]);

  // Create form
  const [createForm, setCreateForm] = useState({
    vehicleNumber: '', vehicleType: '', driverName: '', technicianName: '', notes: '',
  });
  const [creating, setCreating] = useState(false);

  // Technicians list (for dropdowns)
  const [technicians, setTechnicians] = useState<{ _id: string; name: string }[]>([]);
  const [showAddTechnician, setShowAddTechnician] = useState(false);
  const [newTechnicianName, setNewTechnicianName] = useState('');

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

  // Fetch technicians for dropdown
  const fetchTechnicians = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/workshop/technicians');
      setTechnicians(Array.isArray(data) ? data : []);
    } catch {}
  }, []);
  useEffect(() => { fetchTechnicians(); }, [fetchTechnicians]);

  // Add technician inline
  const handleAddTechnician = async () => {
    if (!newTechnicianName.trim()) return;
    try {
      const tech = await api.post<any>('/api/workshop/technicians', { name: newTechnicianName.trim() });
      setTechnicians(prev => [...prev, tech]);
      setNewTechnicianName('');
      setShowAddTechnician(false);
      // Auto-select in current form
      if (showCompleteModal) {
        setCompleteForm(p => ({ ...p, technicianName: tech.name }));
      } else {
        setCreateForm(p => ({ ...p, technicianName: tech.name }));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add technician');
    }
  };

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // WebSocket - refetch all data (including stats) on any change
  const handleSocketRefresh = useCallback(() => {
    fetchRequests();
  }, [fetchRequests]);

  useSocket('maintenance:created', handleSocketRefresh);
  useSocket('maintenance:updated', handleSocketRefresh);
  useSocket('maintenance:completed', handleSocketRefresh);
  useSocket('maintenance:deleted', handleSocketRefresh);
  useSocket('technician:created', fetchTechnicians);
  useSocket('technician:updated', fetchTechnicians);
  useSocket('technician:deleted', fetchTechnicians);

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
      const filledParts = completeForm.parts.filter(p => p.name.trim());
      await api.put(`/api/workshop/maintenance/${showCompleteModal}/complete`, {
        workDescription: completeForm.workDescription,
        technicianName: completeForm.technicianName,
        notes: completeForm.notes,
        partsNeeded: filledParts,
      });

      // Auto-send all filled parts to purchasing (in parallel)
      if (filledParts.length > 0) {
        const vehicleNumber = requests.find(r => r._id === showCompleteModal)?.vehicleNumber || '';
        await Promise.all(
          filledParts.map(part =>
            api.post('/api/workshop/purchases', {
              maintenanceRequest: showCompleteModal,
              itemName: part.name,
              quantity: part.quantity,
              vehicleNumber,
            }).catch(() => {})
          )
        );
      }

      setShowCompleteModal(null);
      setCompleteForm({ workDescription: '', technicianName: '', notes: '', parts: [{ name: '', quantity: 1 }] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmModal({
      message: isAr ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete this request?',
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/workshop/maintenance/${id}`); } catch (err: any) { setError(err.message); }
      },
    });
  };


  const openViewModal = async (req: MaintenanceRequest) => {
    setShowViewModal(req);
    setViewPurchases([]);
    try {
      // Fetch detailed request and purchases in parallel
      const [detailData, purchaseData] = await Promise.all([
        api.get<any>(`/api/workshop/maintenance/${req._id}`).catch(() => null),
        api.get<any>(`/api/workshop/purchases?maintenanceRequest=${req._id}`).catch(() => ({ purchases: [] })),
      ]);
      // Update modal with full details if available
      if (detailData) {
        setShowViewModal(detailData);
      }
      setViewPurchases(purchaseData?.purchases || []);
    } catch {
      setViewPurchases([]);
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
          <h1 className="text-2xl font-bold text-slate-900">
            {isAr ? 'الورشة والصيانة' : 'Workshop & Maintenance'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={requests.length === 0}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-900 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
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
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-600 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-red-600 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: isAr ? 'مفتوح' : 'Open', value: stats.open, color: 'text-yellow-700', bg: 'bg-yellow-500/10' },
          { label: isAr ? 'قيد التنفيذ' : 'In Progress', value: stats.inProgress, color: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: isAr ? 'مكتمل اليوم' : 'Completed Today', value: stats.completedToday, color: 'text-green-600', bg: 'bg-green-500/10' },
          { label: isAr ? 'متوسط المدة' : 'Avg Duration', value: formatDuration(stats.avgDuration), color: 'text-purple-600', bg: 'bg-purple-500/10' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} border border-slate-200 rounded-lg p-4`}>
            <p className="text-slate-500 text-sm">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={isAr ? 'بحث برقم المركبة...' : 'Search by vehicle number...'}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
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
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Wrench className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد طلبات صيانة' : 'No maintenance requests found'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
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
                  <th key={i} className="text-left text-slate-300 font-semibold py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(r => {
                const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.open;
                return (
                  <tr key={r._id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 text-slate-900 font-medium">{r.vehicleNumber}</td>
                    <td className="py-3 px-3 text-slate-700">{r.vehicleType || '-'}</td>
                    <td className="py-3 px-3 text-slate-700">{r.driverName || '-'}</td>
                    <td className="py-3 px-3 text-slate-700">{r.technicianName || '-'}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                      {r.startTime ? new Date(r.startTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                      {r.endTime ? new Date(r.endTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="py-3 px-3 text-slate-700">{formatDuration(r.duration)}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {r.status !== 'completed' && (
                          <button
                            onClick={() => {
                              setShowCompleteModal(r._id);
                              setCompleteForm({ workDescription: '', technicianName: r.technicianName || '', notes: '', parts: [{ name: '', quantity: 1 }] });
                            }}
                            className="p-1.5 rounded-lg bg-green-500/20 text-green-600 hover:bg-green-500/30 transition-colors"
                            title={isAr ? 'اكتمال' : 'Complete'}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openViewModal(r)}
                          className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                          title={isAr ? 'عرض' : 'View'}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(r._id)}
                          className="p-1.5 rounded-lg bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors"
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
          <p className="text-slate-500 text-sm">
            {isAr ? `${total} نتيجة` : `${total} results`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-500 text-sm">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'طلب صيانة جديد' : 'New Maintenance Request'}</h2>
                  <button onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'رقم المركبة' : 'Vehicle Number'}</label>
                    <input type="text" value={createForm.vehicleNumber} onChange={e => setCreateForm(p => ({ ...p, vehicleNumber: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'نوع المركبة' : 'Vehicle Type'}</label>
                    <input type="text" value={createForm.vehicleType} onChange={e => setCreateForm(p => ({ ...p, vehicleType: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'اسم السائق' : 'Driver Name'}</label>
                    <input type="text" value={createForm.driverName} onChange={e => setCreateForm(p => ({ ...p, driverName: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'اسم الفني' : 'Technician Name'}</label>
                    <div className="flex gap-2">
                      <select title={isAr ? 'اسم الفني' : 'Technician Name'} value={createForm.technicianName} onChange={e => setCreateForm(p => ({ ...p, technicianName: e.target.value }))}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="">{isAr ? '— اختر فني —' : '— Select Technician —'}</option>
                        {technicians.map(t => (
                          <option key={t._id} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setShowAddTechnician(true)}
                        className="px-3 py-2.5 rounded-lg bg-[#f37121]/20 text-[#f37121] hover:bg-[#f37121]/30 text-sm font-medium" title={isAr ? 'إضافة فني جديد' : 'Add new technician'}>
                        + {isAr ? 'جديد' : 'New'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea value={createForm.notes} onChange={e => setCreateForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'إكمال طلب الصيانة' : 'Complete Maintenance Request'}</h2>
                  <button onClick={() => setShowCompleteModal(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'وصف العمل' : 'Work Description'}</label>
                    <textarea value={completeForm.workDescription} onChange={e => setCompleteForm(p => ({ ...p, workDescription: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'اسم الفني' : 'Technician Name'}</label>
                    <div className="flex gap-2">
                      <select title={isAr ? 'اسم الفني' : 'Technician Name'} value={completeForm.technicianName} onChange={e => setCompleteForm(p => ({ ...p, technicianName: e.target.value }))}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="">{isAr ? '— اختر فني —' : '— Select Technician —'}</option>
                        {technicians.map(t => (
                          <option key={t._id} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setShowAddTechnician(true)}
                        className="px-3 py-2.5 rounded-lg bg-[#f37121]/20 text-[#f37121] hover:bg-[#f37121]/30 text-sm font-medium">
                        + {isAr ? 'جديد' : 'New'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea value={completeForm.notes} onChange={e => setCompleteForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={2} />
                  </div>

                  {/* Parts Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-slate-500 text-sm font-medium">{isAr ? 'قطع الغيار المطلوبة' : 'Parts Needed'}</label>
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
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
                          />
                          <input
                            type="number" min={1} value={part.quantity}
                            onChange={e => updatePart(idx, 'quantity', parseInt(e.target.value) || 1)}
                            onFocus={e => e.target.select()}
                            className="w-20 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
                          />
                          {completeForm.parts.length > 1 && (
                            <button onClick={() => removePart(idx)} className="p-2 rounded-lg bg-red-500/20 text-red-600 hover:bg-red-500/30">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCompleteModal(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
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
              className="fixed inset-0 bg-black/60 z-50" onClick={() => { setShowViewModal(null); setViewPurchases([]); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{isAr ? 'تفاصيل طلب الصيانة' : 'Maintenance Request Details'}</h2>
                  <button onClick={() => { setShowViewModal(null); setViewPurchases([]); }} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                {/* Status Badge */}
                {(() => { const sc = STATUS_CONFIG[showViewModal.status] || STATUS_CONFIG.open; return (
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${sc.bg} ${sc.color} text-sm font-medium`}>
                    <span className={`w-2 h-2 rounded-full ${showViewModal.status === 'completed' ? 'bg-green-400' : showViewModal.status === 'in_progress' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
                    {isAr ? sc.labelAr : sc.label}
                    {showViewModal.duration ? ` • ${formatDuration(showViewModal.duration)}` : ''}
                  </div>
                ); })()}

                {/* Vehicle & Staff */}
                <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'رقم المركبة' : 'Vehicle'}</p><p className="text-slate-900 text-lg font-bold mt-0.5">{showViewModal.vehicleNumber}</p></div>
                    <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'النوع' : 'Type'}</p><p className="text-slate-900 text-sm mt-0.5">{showViewModal.vehicleType || '-'}</p></div>
                    <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'السائق' : 'Driver'}</p><p className="text-slate-900 text-sm mt-0.5">{showViewModal.driverName || '-'}</p></div>
                    <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'الفني' : 'Technician'}</p><p className="text-slate-900 text-sm mt-0.5">{showViewModal.technicianName || '-'}</p></div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-3">{isAr ? 'المواعيد' : 'Timeline'}</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-slate-500 text-xs w-16">{isAr ? 'البداية' : 'Start'}</span>
                      <span className="text-slate-900 text-sm">{showViewModal.startTime ? new Date(showViewModal.startTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</span>
                    </div>
                    {showViewModal.endTime && (
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-slate-500 text-xs w-16">{isAr ? 'النهاية' : 'End'}</span>
                        <span className="text-slate-900 text-sm">{new Date(showViewModal.endTime).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-slate-300" />
                      <span className="text-slate-500 text-xs w-16">{isAr ? 'الإنشاء' : 'Created'}</span>
                      <span className="text-slate-900 text-sm">{showViewModal.createdAt ? new Date(showViewModal.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-200 text-xs text-slate-500">
                    <span>{isAr ? 'بواسطة' : 'By'}: <span className="text-slate-900">{showViewModal.createdBy ? `${showViewModal.createdBy.firstName || ''} ${showViewModal.createdBy.lastName || ''}`.trim() : '-'}</span></span>
                    <span>{isAr ? 'الفرع' : 'Branch'}: <span className="text-slate-900">{typeof showViewModal.branch === 'object' ? showViewModal.branch?.name || '-' : '-'}</span></span>
                  </div>
                </div>

                {/* Work Details */}
                {(showViewModal.workDescription || showViewModal.notes) && (
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    {showViewModal.workDescription && (
                      <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'وصف العمل' : 'Work Description'}</p><p className="text-slate-900 text-sm mt-1">{showViewModal.workDescription}</p></div>
                    )}
                    {showViewModal.notes && (
                      <div><p className="text-slate-500 text-[10px] uppercase tracking-wider">{isAr ? 'ملاحظات' : 'Notes'}</p><p className="text-slate-900 text-sm mt-1">{showViewModal.notes}</p></div>
                    )}
                  </div>
                )}

                {/* Parts & Purchase Requests - Combined */}
                {((showViewModal.partsNeeded && showViewModal.partsNeeded.length > 0) || viewPurchases.length > 0) && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-3">{isAr ? 'قطع الغيار وطلبات المشتريات' : 'Parts & Purchase Requests'}</p>
                    <div className="space-y-2">
                      {showViewModal.partsNeeded?.map((p, i) => {
                        const pr = viewPurchases.find(vp => vp.itemName?.toLowerCase() === p.name?.toLowerCase());
                        return (
                          <div key={i} className="border border-slate-200 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-900 text-sm font-medium">{p.name}</span>
                                <span className="text-slate-500 text-xs">x{p.quantity}</span>
                              </div>
                              {pr ? (
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                                  pr.status === 'fulfilled' ? 'bg-green-500/20 text-green-600 border border-green-500/30' :
                                  pr.status === 'received' ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30' :
                                  'bg-yellow-500/20 text-yellow-700 border border-yellow-500/30'
                                }`}>
                                  {pr.status === 'fulfilled' ? (isAr ? '✓ تم التوفير' : '✓ Fulfilled') :
                                   pr.status === 'received' ? (isAr ? '↓ تم الاستلام' : '↓ Received by Purchasing') :
                                   (isAr ? '⏳ في انتظار المشتريات' : '⏳ Waiting for Purchasing')}
                                </span>
                              ) : p.sentToPurchasing ? (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-600 border border-blue-500/30">{isAr ? 'تم الإرسال' : 'Sent'}</span>
                              ) : (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">{isAr ? 'لم يُرسل' : 'Not Sent'}</span>
                              )}
                            </div>
                            {pr && (
                              <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap gap-3 text-xs text-slate-500">
                                {pr.cost != null && <span>{isAr ? 'التكلفة' : 'Cost'}: <span className="text-slate-900 font-medium">{pr.cost} SAR</span></span>}
                                {pr.supplier && <span>{isAr ? 'المورد' : 'Supplier'}: <span className="text-slate-900">{pr.supplier}</span></span>}
                                {pr.invoiceNumber && <span>{isAr ? 'فاتورة' : 'Invoice'}: <span className="text-slate-900">{pr.invoiceNumber}</span></span>}
                                {pr.receivedAt && <span>{isAr ? 'استُلم' : 'Received'}: <span className="text-slate-900">{new Date(pr.receivedAt).toLocaleDateString()}</span></span>}
                                {pr.fulfilledAt && <span>{isAr ? 'تم التوفير' : 'Fulfilled'}: <span className="text-slate-900">{new Date(pr.fulfilledAt).toLocaleDateString()}</span></span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Show purchase requests not matched to parts */}
                      {viewPurchases.filter(pr => !showViewModal.partsNeeded?.some(p => p.name?.toLowerCase() === pr.itemName?.toLowerCase())).map((pr: any) => (
                        <div key={pr._id} className="border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-900 text-sm font-medium">{pr.itemName}</span>
                              <span className="text-slate-500 text-xs">x{pr.quantity}</span>
                            </div>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                              pr.status === 'fulfilled' ? 'bg-green-500/20 text-green-600 border border-green-500/30' :
                              pr.status === 'received' ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30' :
                              'bg-yellow-500/20 text-yellow-700 border border-yellow-500/30'
                            }`}>
                              {pr.status === 'fulfilled' ? (isAr ? '✓ تم التوفير' : '✓ Fulfilled') :
                               pr.status === 'received' ? (isAr ? '↓ تم الاستلام' : '↓ Received') :
                               (isAr ? '⏳ في انتظار المشتريات' : '⏳ Pending')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button onClick={() => { setShowViewModal(null); setViewPurchases([]); }} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {isAr ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Technician Modal */}
      {showAddTechnician && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{isAr ? 'إضافة فني جديد' : 'Add New Technician'}</h3>
              <input type="text" autoFocus value={newTechnicianName}
                onChange={e => setNewTechnicianName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTechnician(); }}
                placeholder={isAr ? 'اسم الفني' : 'Technician name'}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-[#f37121]" />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowAddTechnician(false); setNewTechnicianName(''); }} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" onClick={handleAddTechnician} disabled={!newTechnicianName.trim()}
                className="px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] disabled:opacity-50">
                {isAr ? 'إضافة' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

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
