'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { getWorkshopTasksTranslations } from '@/lib/translations';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ListTodo, Plus, Search, Loader2, X, Check, Trash2, AlertCircle, AlertTriangle,
  ChevronLeft, ChevronRight, Clock, Flag, User,
} from 'lucide-react';

interface WorkshopTask {
  _id: string;
  title: string;
  description: string;
  assignedTo: string | { _id: string; firstName?: string; lastName?: string; role?: string };
  assignedToName?: string;
  technicianName?: string;
  vehicleNumber?: string;
  maintenanceType?: { _id: string; name: string; estimatedDuration?: number } | string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  low: { label: 'Low', labelAr: 'منخفض', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  medium: { label: 'Medium', labelAr: 'متوسط', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  high: { label: 'High', labelAr: 'عالي', color: 'text-orange-600', bg: 'bg-orange-500/20' },
  urgent: { label: 'Urgent', labelAr: 'عاجل', color: 'text-red-600', bg: 'bg-red-500/20' },
};

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  pending: { label: 'Pending', labelAr: 'معلق', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  in_progress: { label: 'In Progress', labelAr: 'قيد التنفيذ', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  completed: { label: 'Completed', labelAr: 'مكتمل', color: 'text-green-600', bg: 'bg-green-500/20' },
  cancelled: { label: 'Cancelled', labelAr: 'ملغي', color: 'text-red-600', bg: 'bg-red-500/20' },
};

export default function WorkshopTasksPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const tx = getWorkshopTasksTranslations(lang);

  const [tasks, setTasks] = useState<WorkshopTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Workshop users + technicians + maintenance types for dropdowns
  const [workshopUsers, setWorkshopUsers] = useState<{ _id: string; firstName: string; lastName: string; role: string }[]>([]);
  const [technicians, setTechnicians] = useState<{ _id: string; name: string }[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<{ _id: string; name: string }[]>([]);

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{message: string; onConfirm: () => void} | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '', description: '', assignedTo: '', technicianName: '', maintenanceType: '', vehicleNumber: '', priority: 'medium', dueDate: '',
  });
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', String(limit));
      const data = await api.get<any>(`/api/workshop/tasks?${params.toString()}`) || {};
      setTasks(data.tasks || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, search, page]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Fetch workshop users (filtered to workshop roles only) + technicians + maintenance types
  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        const [users, techs, types] = await Promise.all([
          api.get<any>('/api/workshop/users').catch(() => []),
          api.get<any>('/api/workshop/technicians').catch(() => []),
          api.get<any>('/api/workshop/maintenance-types').catch(() => []),
        ]);
        setWorkshopUsers(Array.isArray(users) ? users : []);
        setTechnicians(Array.isArray(techs) ? techs : []);
        setMaintenanceTypes(Array.isArray(types) ? types : []);
      } catch {}
    };
    loadDropdowns();
  }, []);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // WebSocket
  const handleCreated = useCallback((t: WorkshopTask) => {
    setTasks(prev => [t, ...prev]);
    setTotal(tot => tot + 1);
  }, []);
  const handleUpdated = useCallback((t: WorkshopTask) => {
    setTasks(prev => prev.map(x => x._id === t._id ? t : x));
  }, []);
  const handleDeleted = useCallback((d: { _id: string }) => {
    setTasks(prev => prev.filter(x => x._id !== d._id));
    setTotal(tot => Math.max(0, tot - 1));
  }, []);

  useSocket('workshopTask:created', handleCreated);
  useSocket('workshopTask:updated', handleUpdated);
  useSocket('workshopTask:deleted', handleDeleted);
  // Refetch dropdowns on changes
  const refetchDropdowns = useCallback(async () => {
    try {
      const [techs, types] = await Promise.all([
        api.get<any>('/api/workshop/technicians').catch(() => []),
        api.get<any>('/api/workshop/maintenance-types').catch(() => []),
      ]);
      setTechnicians(Array.isArray(techs) ? techs : []);
      setMaintenanceTypes(Array.isArray(types) ? types : []);
    } catch {}
  }, []);
  useSocket('technician:created', refetchDropdowns);
  useSocket('technician:deleted', refetchDropdowns);
  useSocket('maintenanceType:created', refetchDropdowns);
  useSocket('maintenanceType:updated', refetchDropdowns);
  useSocket('maintenanceType:deleted', refetchDropdowns);

  const handleCreate = async () => {
    try {
      setCreating(true);
      const payload: any = { ...createForm };
      if (!payload.maintenanceType) delete payload.maintenanceType;
      if (!payload.technicianName) delete payload.technicianName;
      if (!payload.vehicleNumber) delete payload.vehicleNumber;
      if (!payload.dueDate) delete payload.dueDate;
      await api.post('/api/workshop/tasks', payload);
      setShowCreateModal(false);
      setCreateForm({ title: '', description: '', assignedTo: '', technicianName: '', maintenanceType: '', vehicleNumber: '', priority: 'medium', dueDate: '' });
      fetchTasks();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/workshop/tasks/${id}/status`, { status });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteTask = (id: string) => {
    setConfirmModal({
      message: tx.confirmDeleteMessage,
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/workshop/tasks/${id}`); } catch (err: any) { setError(err.message); }
      },
    });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ListTodo className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-slate-900">{tx.pageTitle}</h1>
        </div>
        <button onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e0611a] text-white px-4 py-2.5 rounded-lg font-medium transition-colors">
          <Plus className="w-4 h-4" />
          {tx.newTask}
        </button>
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
            placeholder={tx.searchPlaceholder}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:border-[#f37121]" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{tx.allStatus}</option>
          <option value="pending">{tx.statusPending}</option>
          <option value="in_progress">{tx.statusInProgress}</option>
          <option value="completed">{tx.statusCompleted}</option>
          <option value="cancelled">{tx.statusCancelled}</option>
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{tx.allPriorities}</option>
          <option value="low">{tx.priorityLow}</option>
          <option value="medium">{tx.priorityMedium}</option>
          <option value="high">{tx.priorityHigh}</option>
          <option value="urgent">{tx.priorityUrgent}</option>
        </select>
      </div>

      {/* Tasks List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <ListTodo className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{tx.noTasks}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const pc = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
            const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            return (
              <div key={task._id} className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-slate-900 font-medium truncate">{task.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                        {isAr ? pc.labelAr : pc.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-slate-500 text-sm mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                      {(() => {
                        const at = typeof task.assignedTo === 'object' ? task.assignedTo : null;
                        const name = at ? `${at.firstName || ''} ${at.lastName || ''}`.trim() : task.assignedToName;
                        return name && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-600">
                            <User className="w-3 h-3" /> {tx.employeeLabel} {name}
                          </span>
                        );
                      })()}
                      {task.technicianName && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-600">
                          <User className="w-3 h-3" /> {tx.techLabel} {task.technicianName}
                        </span>
                      )}
                      {task.maintenanceType && typeof task.maintenanceType === 'object' && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-orange-500/10 text-orange-600">
                          <Flag className="w-3 h-3" /> {task.maintenanceType.name}
                        </span>
                      )}
                      {task.vehicleNumber && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          🚗 {task.vehicleNumber}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(task.dueDate).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Inline status update */}
                    <select
                      value={task.status}
                      onChange={e => updateStatus(task._id, e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-xs px-2 py-1.5 focus:outline-none focus:border-[#f37121]"
                    >
                      <option value="pending">{tx.statusPending}</option>
                      <option value="in_progress">{tx.statusInProgress}</option>
                      <option value="completed">{tx.statusCompleted}</option>
                      <option value="cancelled">{tx.statusCancelled}</option>
                    </select>
                    <button onClick={() => deleteTask(task._id)}
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
          <p className="text-slate-500 text-sm">{`${total} ${tx.results}`}</p>
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{tx.newTask}</h2>
                  <button onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.fieldTitle}</label>
                    <input type="text" value={createForm.title} onChange={e => setCreateForm(p => ({ ...p, title: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.fieldDescription}</label>
                    <textarea value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.fieldAssignTo} *</label>
                    <select title={tx.fieldAssignTo} value={createForm.assignedTo} onChange={e => setCreateForm(p => ({ ...p, assignedTo: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                      <option value="">{tx.selectWorkshopEmployee}</option>
                      {workshopUsers.map(u => (
                        <option key={u._id} value={u._id}>{u.firstName} {u.lastName} ({u.role.replace('_', ' ')})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.fieldTechnician}</label>
                    <select title={tx.technicianTitle} value={createForm.technicianName} onChange={e => setCreateForm(p => ({ ...p, technicianName: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                      <option value="">{tx.optional}</option>
                      {technicians.map(t => (
                        <option key={t._id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{tx.fieldMaintenanceType}</label>
                      <select title={tx.fieldMaintenanceType} value={createForm.maintenanceType} onChange={e => setCreateForm(p => ({ ...p, maintenanceType: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="">{tx.optional}</option>
                        {maintenanceTypes.map(t => (
                          <option key={t._id} value={t._id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{tx.fieldVehicleNumber}</label>
                      <input type="text" value={createForm.vehicleNumber} onChange={e => setCreateForm(p => ({ ...p, vehicleNumber: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{tx.fieldPriority}</label>
                      <select value={createForm.priority} onChange={e => setCreateForm(p => ({ ...p, priority: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="low">{tx.priorityLow}</option>
                        <option value="medium">{tx.priorityMedium}</option>
                        <option value="high">{tx.priorityHigh}</option>
                        <option value="urgent">{tx.priorityUrgent}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-500 text-sm block mb-1">{tx.fieldDueDate}</label>
                      <input type="date" value={createForm.dueDate} onChange={e => setCreateForm(p => ({ ...p, dueDate: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button onClick={handleCreate} disabled={creating || !createForm.title}
                    className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0611a] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    {tx.create}
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
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.confirm}</h3>
              </div>
              <p className="text-slate-700 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
              <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">
                {tx.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
