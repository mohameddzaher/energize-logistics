'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ListTodo, Plus, Search, Loader2, X, Check, Trash2, AlertCircle, AlertTriangle,
  ChevronLeft, ChevronRight, Clock, Flag, User,
} from 'lucide-react';

interface WorkshopTask {
  _id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedToName?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  low: { label: 'Low', labelAr: 'منخفض', color: 'text-gray-400', bg: 'bg-gray-500/20' },
  medium: { label: 'Medium', labelAr: 'متوسط', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  high: { label: 'High', labelAr: 'عالي', color: 'text-orange-400', bg: 'bg-orange-500/20' },
  urgent: { label: 'Urgent', labelAr: 'عاجل', color: 'text-red-400', bg: 'bg-red-500/20' },
};

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  pending: { label: 'Pending', labelAr: 'معلق', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  in_progress: { label: 'In Progress', labelAr: 'قيد التنفيذ', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  completed: { label: 'Completed', labelAr: 'مكتمل', color: 'text-green-400', bg: 'bg-green-500/20' },
  cancelled: { label: 'Cancelled', labelAr: 'ملغي', color: 'text-red-400', bg: 'bg-red-500/20' },
};

export default function WorkshopTasksPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

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

  // Users for assignment
  const [users, setUsers] = useState<{ _id: string; firstName: string; lastName: string }[]>([]);

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{message: string; onConfirm: () => void} | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '', description: '', assignedTo: '', priority: 'medium', dueDate: '',
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

  // Fetch users for assignment dropdown
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await api.get<any>('/api/users?limit=200') || {};
        setUsers(data.users || []);
      } catch {}
    };
    loadUsers();
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

  useSocket('workshop-task:created', handleCreated);
  useSocket('workshop-task:updated', handleUpdated);
  useSocket('workshop-task:deleted', handleDeleted);

  const handleCreate = async () => {
    try {
      setCreating(true);
      await api.post('/api/workshop/tasks', createForm);
      setShowCreateModal(false);
      setCreateForm({ title: '', description: '', assignedTo: '', priority: 'medium', dueDate: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/workshop/tasks/${id}`, { status });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteTask = (id: string) => {
    setConfirmModal({
      message: isAr ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete this task?',
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
          <h1 className="text-2xl font-bold text-white">{isAr ? 'مهام الورشة' : 'Workshop Tasks'}</h1>
        </div>
        <button onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e0611a] text-white px-4 py-2.5 rounded-lg font-medium transition-colors">
          <Plus className="w-4 h-4" />
          {isAr ? 'مهمة جديدة' : 'New Task'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder={isAr ? 'بحث...' : 'Search tasks...'}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#f37121]" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{isAr ? 'كل الحالات' : 'All Status'}</option>
          <option value="pending">{isAr ? 'معلق' : 'Pending'}</option>
          <option value="in_progress">{isAr ? 'قيد التنفيذ' : 'In Progress'}</option>
          <option value="completed">{isAr ? 'مكتمل' : 'Completed'}</option>
          <option value="cancelled">{isAr ? 'ملغي' : 'Cancelled'}</option>
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]">
          <option value="">{isAr ? 'كل الأولويات' : 'All Priorities'}</option>
          <option value="low">{isAr ? 'منخفض' : 'Low'}</option>
          <option value="medium">{isAr ? 'متوسط' : 'Medium'}</option>
          <option value="high">{isAr ? 'عالي' : 'High'}</option>
          <option value="urgent">{isAr ? 'عاجل' : 'Urgent'}</option>
        </select>
      </div>

      {/* Tasks List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <ListTodo className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد مهام' : 'No tasks found'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const pc = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
            const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            return (
              <div key={task._id} className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-white font-medium truncate">{task.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                        {isAr ? pc.labelAr : pc.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-gray-400 text-sm mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      {task.assignedToName && (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {task.assignedToName}</span>
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
                      className="bg-gray-900 border border-gray-700 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#f37121]"
                    >
                      <option value="pending">{isAr ? 'معلق' : 'Pending'}</option>
                      <option value="in_progress">{isAr ? 'قيد التنفيذ' : 'In Progress'}</option>
                      <option value="completed">{isAr ? 'مكتمل' : 'Completed'}</option>
                      <option value="cancelled">{isAr ? 'ملغي' : 'Cancelled'}</option>
                    </select>
                    <button onClick={() => deleteTask(task._id)}
                      className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
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
          <p className="text-gray-400 text-sm">{isAr ? `${total} نتيجة` : `${total} results`}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-400 text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
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
                  <h2 className="text-lg font-bold text-white">{isAr ? 'مهمة جديدة' : 'New Task'}</h2>
                  <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'العنوان' : 'Title'}</label>
                    <input type="text" value={createForm.title} onChange={e => setCreateForm(p => ({ ...p, title: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'الوصف' : 'Description'}</label>
                    <textarea value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'تعيين إلى' : 'Assign To'}</label>
                    <select value={createForm.assignedTo} onChange={e => setCreateForm(p => ({ ...p, assignedTo: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                      <option value="">{isAr ? 'اختر مستخدم' : 'Select User'}</option>
                      {users.map(u => (
                        <option key={u._id} value={u._id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-gray-400 text-sm block mb-1">{isAr ? 'الأولوية' : 'Priority'}</label>
                      <select value={createForm.priority} onChange={e => setCreateForm(p => ({ ...p, priority: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]">
                        <option value="low">{isAr ? 'منخفض' : 'Low'}</option>
                        <option value="medium">{isAr ? 'متوسط' : 'Medium'}</option>
                        <option value="high">{isAr ? 'عالي' : 'High'}</option>
                        <option value="urgent">{isAr ? 'عاجل' : 'Urgent'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-sm block mb-1">{isAr ? 'تاريخ الاستحقاق' : 'Due Date'}</label>
                      <input type="date" value={createForm.dueDate} onChange={e => setCreateForm(p => ({ ...p, dueDate: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleCreate} disabled={creating || !createForm.title}
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

      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-white font-semibold">{isAr ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-gray-300 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
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
