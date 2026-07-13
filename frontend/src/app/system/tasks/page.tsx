'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getTasksTranslations, getTasksExtraTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ListTodo, Plus, Search, Filter, X, Check, Clock, XCircle,
  Pause, Phone, Mail, MessageSquare, MapPin, Send,
  Loader2, Trash2, ChevronDown, ChevronUp, Calendar, Users, BarChart3,
  Lightbulb, ThumbsUp, ThumbsDown, AlertTriangle, RefreshCw,
  Edit, CalendarClock, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface Task {
  _id: string;
  createdBy: { _id: string; firstName: string; lastName: string };
  assignedTo: { _id: string; firstName: string; lastName: string };
  customer: { _id: string; companyName: string; customerNumber: string; currentOutstanding: number };
  contactMethod: string;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  collectedAmount: number;
  actionNotes: string;
  nextFollowUpDate: string | null;
  createdAt: string;
}

interface Suggestion {
  _id: string;
  customer: { _id: string; companyName: string; customerNumber: string; currentOutstanding: number; riskLevel: string; clientStatus: string; grade: string };
  suggestedTo: { _id: string; firstName: string; lastName: string };
  reason: string;
  riskLevel: string;
  overdueDays: number;
  outstanding: number;
}

interface Collector {
  _id: string;
  firstName: string;
  lastName: string;
  assignedCustomers: { _id: string; companyName: string }[];
}

interface TaskStats {
  total: number;
  done: number;
  postponed: number;
  cancelled: number;
  pending: number;
  completionRate: number;
  avgCompletionHours: number;
  totalCollected: number;
  byCollector: any[];
  byCustomer: any[];
}

type TabType = 'tasks' | 'monitoring' | 'suggestions';

const CONTACT_METHODS = [
  { value: 'call', labelKey: 'call' as const, icon: Phone },
  { value: 'whatsapp', labelKey: 'whatsapp' as const, icon: MessageSquare },
  { value: 'visit', labelKey: 'visit' as const, icon: MapPin },
  { value: 'email', labelKey: 'emailMethod' as const, icon: Mail },
  { value: 'message', labelKey: 'message' as const, icon: Send },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-700',
  done: 'bg-green-500/20 text-green-600',
  cancelled: 'bg-red-500/20 text-red-600',
  postponed: 'bg-blue-500/20 text-blue-600',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/20 text-green-600',
  medium: 'bg-yellow-500/20 text-yellow-700',
  high: 'bg-red-500/20 text-red-600',
};

const getTodayLocal = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const getTodayDate = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function TasksPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getTasksTranslations(lang);
  const txx = getTasksExtraTranslations(lang);
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  const contactMethodLabel = (value: string) => {
    const m = CONTACT_METHODS.find((cm) => cm.value === value);
    return m ? (T as any)[m.labelKey] : value;
  };
  const statusLabel = (value: string) => (T as any)[value] || value;

  // State
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const initialLoadDone = useRef(false);

  // Expanded row (separate states for follow-up and main table)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedFollowUpId, setExpandedFollowUpId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [collectorFilter, setCollectorFilter] = useState('');
  const [contactMethodFilter, setContactMethodFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Date filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Create task modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [selectedCollector, setSelectedCollector] = useState('');
  const [collectorCustomers, setCollectorCustomers] = useState<{ _id: string; companyName: string }[]>([]);
  const [taskBatch, setTaskBatch] = useState<{ customer: string; contactMethod: string; dueDate: string }[]>([
    { customer: '', contactMethod: 'call', dueDate: '' },
  ]);
  const [creating, setCreating] = useState(false);

  // Update task modal (complete/postpone/cancel)
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [updateForm, setUpdateForm] = useState({ status: '', collectedAmount: '', actionNotes: '', nextFollowUpDate: '' });
  const [updating, setUpdating] = useState(false);

  // Edit task modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ contactMethod: '', dueDate: '', actionNotes: '', nextFollowUpDate: '', collectedAmount: '' });
  const [editing, setEditing] = useState(false);

  // Monitoring tab
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Suggestions tab
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // ─── FETCH TASKS ────────────────────────────────────────────
  const fetchTasks = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      if (!initialLoadDone.current) setLoading(true);
      else setSearching(true);
    }
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (collectorFilter) params.set('assignedTo', collectorFilter);
      if (contactMethodFilter) params.set('contactMethod', contactMethodFilter);
      if (search) params.set('search', search);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('page', String(page));

      const endpoint = isAdmin ? '/api/tasks' : '/api/tasks/my-tasks';
      const data = await api.get<any>(`${endpoint}?${params.toString()}`);
      setTasks(data.tasks || []);
      setTotal(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
      setSearching(false);
      initialLoadDone.current = true;
    }
  }, [isAdmin, statusFilter, collectorFilter, contactMethodFilter, search, dateFrom, dateTo, page]);

  // ─── FETCH FOLLOW-UP TASKS ──────────────────────────────────
  const fetchFollowUps = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/tasks/follow-ups');
      setFollowUpTasks(data.tasks || []);
    } catch {}
  }, []);

  // ─── FETCH COLLECTORS ──────────────────────────────────────
  const fetchCollectors = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/users?role=employee&limit=200');
      setCollectors(data.users || []);
    } catch {}
  }, []);

  // ─── FETCH STATS ───────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (collectorFilter) params.set('assignedTo', collectorFilter);
      if (contactMethodFilter) params.set('contactMethod', contactMethodFilter);
      const data = await api.get<any>(`/api/tasks/stats?${params.toString()}`);
      setStats(data);
    } catch {}
    setStatsLoading(false);
  }, [dateFrom, dateTo, collectorFilter, contactMethodFilter]);

  // ─── FETCH SUGGESTIONS ────────────────────────────────────
  const fetchSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const data = await api.get<any>('/api/tasks/suggestions');
      setSuggestions(data.suggestions || []);
    } catch {}
    setSuggestionsLoading(false);
  }, []);

  // ─── EFFECTS ───────────────────────────────────────────────
  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchFollowUps(); }, [fetchFollowUps]);
  useEffect(() => { if (isAdmin) fetchCollectors(); }, [isAdmin, fetchCollectors]);
  useEffect(() => { if (activeTab === 'monitoring' && isAdmin) fetchStats(); }, [activeTab, isAdmin, fetchStats]);
  useEffect(() => { if (activeTab === 'suggestions' && isAdmin) fetchSuggestions(); }, [activeTab, isAdmin, fetchSuggestions]);

  // ─── WEBSOCKET ─────────────────────────────────────────────
  const handleTaskEvent = useCallback(() => {
    fetchTasks(true);
    fetchFollowUps();
    if (activeTab === 'monitoring') fetchStats();
  }, [fetchTasks, fetchFollowUps, activeTab, fetchStats]);

  useSocket('task:created', handleTaskEvent);
  useSocket('task:updated', handleTaskEvent);
  useSocket('task:deleted', handleTaskEvent);
  useSocket('suggestion:approved', useCallback(() => { fetchTasks(true); fetchFollowUps(); fetchSuggestions(); }, [fetchTasks, fetchFollowUps, fetchSuggestions]));
  useSocket('suggestion:dismissed', useCallback(() => { fetchSuggestions(); }, [fetchSuggestions]));
  useSocket('suggestion:generated', useCallback(() => { fetchSuggestions(); }, [fetchSuggestions]));
  useSocket('payment:logged', handleTaskEvent);
  useSocket('customer:updated', handleTaskEvent);

  // ─── COLLECTOR SELECTION (CREATE MODAL) ────────────────────
  useEffect(() => {
    if (selectedCollector) {
      const col = collectors.find((c) => c._id === selectedCollector);
      setCollectorCustomers(col?.assignedCustomers || []);
      setTaskBatch([{ customer: '', contactMethod: 'call', dueDate: '' }]);
    } else {
      setCollectorCustomers([]);
    }
  }, [selectedCollector, collectors]);

  // ─── CREATE TASKS ──────────────────────────────────────────
  const handleCreateTasks = async () => {
    const validTasks = taskBatch.filter((t) => t.customer);
    if (!selectedCollector || validTasks.length === 0) return;

    setCreating(true);
    try {
      await api.post('/api/tasks', {
        tasks: validTasks.map((t) => ({
          assignedTo: selectedCollector,
          customer: t.customer,
          contactMethod: t.contactMethod,
          dueDate: t.dueDate || null,
        })),
      });
      setShowCreateModal(false);
      setSelectedCollector('');
      setTaskBatch([{ customer: '', contactMethod: 'call', dueDate: '' }]);
      fetchTasks();
      fetchFollowUps();
    } catch {}
    setCreating(false);
  };

  // ─── UPDATE TASK (STATUS CHANGE) ────────────────────────────
  const handleUpdateTask = async () => {
    if (!selectedTask || !updateForm.status) return;
    if ((updateForm.status === 'cancelled' || updateForm.status === 'postponed') && !updateForm.actionNotes.trim()) return;

    setUpdating(true);
    try {
      await api.put(`/api/tasks/${selectedTask._id}`, {
        status: updateForm.status,
        collectedAmount: updateForm.collectedAmount ? Number(updateForm.collectedAmount) : 0,
        actionNotes: updateForm.actionNotes,
        nextFollowUpDate: updateForm.nextFollowUpDate || null,
      });
      setShowUpdateModal(false);
      setSelectedTask(null);
      fetchTasks();
      fetchFollowUps();
    } catch {}
    setUpdating(false);
  };

  // ─── EDIT TASK (FIELD CHANGES) ──────────────────────────────
  const handleEditTask = async () => {
    if (!editTask) return;
    setEditing(true);
    try {
      const payload: any = {
        contactMethod: editForm.contactMethod,
        dueDate: editForm.dueDate || null,
        actionNotes: editForm.actionNotes,
        nextFollowUpDate: editForm.nextFollowUpDate || null,
      };
      if (editForm.collectedAmount) payload.collectedAmount = Number(editForm.collectedAmount);
      await api.put(`/api/tasks/${editTask._id}`, payload);
      setShowEditModal(false);
      setEditTask(null);
      fetchTasks();
      fetchFollowUps();
    } catch {}
    setEditing(false);
  };

  // ─── DELETE TASK ───────────────────────────────────────────
  const handleDeleteTask = async (taskId: string) => {
    if (!confirm(txx.confirmDeleteTask)) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      fetchTasks();
      fetchFollowUps();
    } catch {}
  };

  // ─── CLEAR FOLLOW-UP (remove follow-up date only, keep task) ──
  const handleClearFollowUp = async (taskId: string) => {
    if (!confirm(txx.confirmRemoveFollowUp)) return;
    try {
      await api.put(`/api/tasks/${taskId}`, { nextFollowUpDate: null });
      fetchTasks();
      fetchFollowUps();
    } catch {}
  };

  // ─── GENERATE SUGGESTIONS ─────────────────────────────────
  const handleGenerateSuggestions = async () => {
    setGeneratingSuggestions(true);
    try {
      await api.post('/api/tasks/suggestions/generate');
      fetchSuggestions();
    } catch {}
    setGeneratingSuggestions(false);
  };

  // ─── APPROVE SUGGESTION ───────────────────────────────────
  const handleApproveSuggestion = async (id: string) => {
    try {
      await api.post(`/api/tasks/suggestions/${id}/approve`, { contactMethod: 'call' });
      fetchSuggestions();
      fetchTasks();
    } catch {}
  };

  // ─── DISMISS SUGGESTION ───────────────────────────────────
  const handleDismissSuggestion = async (id: string) => {
    try {
      await api.put(`/api/tasks/suggestions/${id}/dismiss`);
      fetchSuggestions();
    } catch {}
  };

  // ─── OPEN UPDATE MODAL ────────────────────────────────────
  const openUpdateModal = (task: Task) => {
    setSelectedTask(task);
    setUpdateForm({ status: '', collectedAmount: '', actionNotes: '', nextFollowUpDate: '' });
    setShowUpdateModal(true);
  };

  // ─── OPEN EDIT MODAL ─────────────────────────────────────
  const openEditModal = (task: Task) => {
    setEditTask(task);
    const toLocal = (d: string | null) => {
      if (!d) return '';
      const dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const h = String(dt.getHours()).padStart(2, '0');
      const min = String(dt.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${dd}T${h}:${min}`;
    };
    setEditForm({
      contactMethod: task.contactMethod,
      dueDate: toLocal(task.dueDate),
      actionNotes: task.actionNotes || '',
      nextFollowUpDate: toLocal(task.nextFollowUpDate),
      collectedAmount: task.collectedAmount > 0 ? String(task.collectedAmount) : '',
    });
    setShowEditModal(true);
  };

  // ─── SEARCH HANDLER ───────────────────────────────────────
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1); }, 300);
  };

  // Add task to batch
  const addTaskToBatch = () => {
    setTaskBatch((prev) => [...prev, { customer: '', contactMethod: 'call', dueDate: '' }]);
  };

  const removeTaskFromBatch = (index: number) => {
    setTaskBatch((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTaskBatch = (index: number, field: string, value: string) => {
    setTaskBatch((prev) => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatDateTime = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getFollowUpStatus = (d: string) => {
    const now = new Date();
    const followDate = new Date(d);
    // Compare dates only (strip time) for accurate day count
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const followStart = new Date(followDate.getFullYear(), followDate.getMonth(), followDate.getDate());
    const diff = Math.round((followStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: `${txx.overduePrefix} ${Math.abs(diff)}${txx.daysShortSuffix}`, color: 'text-red-600 bg-red-500/20' };
    if (diff === 0) return { label: T.today, color: 'text-[#f37121] bg-[#f37121]/20' };
    if (diff === 1) return { label: txx.tomorrow, color: 'text-yellow-700 bg-yellow-500/20' };
    if (diff <= 3) return { label: `${txx.inPrefix} ${diff} ${txx.daysSuffix}`, color: 'text-yellow-700 bg-yellow-500/20' };
    return { label: `${txx.inPrefix} ${diff} ${txx.daysSuffix}`, color: 'text-green-600 bg-green-500/20' };
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
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
            <ListTodo className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {T.title}
            </h1>
            <p className="text-slate-500 text-sm">{total} {T.title}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportToExcel(tasks, [
              { header: T.customer, key: 'customer.companyName', width: 24 },
              { header: txx.exCustomerNumber, key: 'customer.customerNumber', width: 14 },
              { header: T.assignedTo, key: 'assignedTo', transform: (_: any, row: any) => row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '', width: 20 },
              { header: txx.exCreatedBy, key: 'createdBy', transform: (_: any, row: any) => row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : '', width: 20 },
              { header: T.contactMethod, key: 'contactMethod', width: 16 },
              { header: T.status, key: 'status', transform: fmt.status, width: 12 },
              { header: txx.exOutstanding, key: 'customer.currentOutstanding', transform: fmt.money, width: 16 },
              { header: T.collectedAmount, key: 'collectedAmount', transform: fmt.money, width: 18 },
              { header: T.dueDate, key: 'dueDate', transform: fmt.date, width: 14 },
              { header: txx.exCompletedAt, key: 'completedAt', transform: fmt.datetime, width: 20 },
              { header: T.nextFollowUp, key: 'nextFollowUpDate', transform: fmt.date, width: 16 },
              { header: txx.exNotes, key: 'actionNotes', width: 30 },
              { header: T.createdAt, key: 'createdAt', transform: fmt.date, width: 14 },
            ], `tasks-${new Date().toISOString().split('T')[0]}`, T.title)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors"
          >
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setShowCreateModal(true); fetchCollectors(); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors"
            >
              <Plus className="w-4 h-4" />
              {T.createTask}
            </button>
          )}
        </div>
      </div>

      {/* Tabs (Admin only) */}
      {isAdmin && (
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {[
            { key: 'tasks' as TabType, label: T.title, icon: ListTodo },
            { key: 'monitoring' as TabType, label: T.monitoring, icon: BarChart3 },
            { key: 'suggestions' as TabType, label: T.suggestions, icon: Lightbulb },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-[#f37121] text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── TASKS TAB ──────────────────────────────────────── */}
      {activeTab === 'tasks' && (
        <>
          {/* ─── FOLLOW-UP SECTION ─────────────────────────────── */}
          {followUpTasks.length > 0 && (
            <div className="bg-white border border-[#f37121]/30 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-[#f37121]/5 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#f37121]" />
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm mb-3">{T.nextFollowUp}</h3>
                <span className="text-xs bg-[#f37121]/20 text-[#f37121] px-2 py-0.5 rounded-full font-medium">{followUpTasks.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-200">
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.customer}</th>
                      {isAdmin && <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.assignedTo}</th>}
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.contactMethod}</th>
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.amount}</th>
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.nextFollowUp}</th>
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.status}</th>
                      <th className="text-start text-slate-300 font-semibold px-4 py-2 text-xs">{T.date}</th>
                      <th className="text-end text-slate-300 font-semibold px-4 py-2 text-xs">{T.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followUpTasks.map((task) => {
                      const fStatus = getFollowUpStatus(task.nextFollowUpDate!);
                      return (
                        <Fragment key={task._id}>
                          <tr
                            className={`border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer ${expandedFollowUpId === task._id ? 'bg-slate-100' : ''}`}
                            onClick={() => setExpandedFollowUpId(expandedFollowUpId === task._id ? null : task._id)}
                          >
                            <td className="px-4 py-2">
                              <div className="text-slate-900 font-medium text-xs">{task.customer?.companyName || '—'}</div>
                              <div className="text-slate-500 text-xs">{task.customer?.customerNumber || ''}</div>
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-2 text-slate-700 text-xs">
                                {task.assignedTo?.firstName} {task.assignedTo?.lastName}
                              </td>
                            )}
                            <td className="px-4 py-2 text-slate-700 text-xs">{contactMethodLabel(task.contactMethod)}</td>
                            <td className="px-4 py-2 text-slate-700 text-xs">
                              {task.customer?.currentOutstanding?.toLocaleString() || 0} SAR
                            </td>
                            <td className="px-4 py-2 text-slate-900 text-xs font-medium">{formatDateTime(task.nextFollowUpDate)}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}>
                                {statusLabel(task.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${fStatus.color}`}>
                                {fStatus.label}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-end">
                              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => openUpdateModal(task)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-green-600 hover:bg-slate-100 transition-colors"
                                  title={txx.updateComplete}
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(task)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 transition-colors"
                                  title={txx.editTaskTooltip}
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleClearFollowUp(task._id)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors"
                                  title={txx.removeFollowUp}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                                {expandedFollowUpId === task._id ? (
                                  <ChevronUp className="w-4 h-4 text-slate-500" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-500" />
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Details Row */}
                          {expandedFollowUpId === task._id && (
                            <tr key={`${task._id}-fu-details`} className="border-b border-slate-200/70 bg-slate-100">
                              <td colSpan={isAdmin ? 8 : 7} className="px-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.name}</p>
                                    <p className="text-slate-900 text-sm">{task.createdBy?.firstName} {task.createdBy?.lastName}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.createdAt}</p>
                                    <p className="text-slate-900 text-sm">{formatDateTime(task.createdAt)}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.dueDate}</p>
                                    <p className="text-slate-900 text-sm">{formatDateTime(task.dueDate)}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.done}</p>
                                    <p className="text-slate-900 text-sm">{formatDateTime(task.completedAt)}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.collectedAmount}</p>
                                    <p className="text-slate-900 text-sm">
                                      {task.collectedAmount > 0 ? `${task.collectedAmount.toLocaleString()} SAR` : '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.nextFollowUp}</p>
                                    <p className={`text-sm ${task.nextFollowUpDate ? 'text-[#f37121] font-medium' : 'text-slate-900'}`}>
                                      {formatDateTime(task.nextFollowUpDate)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.contactMethod}</p>
                                    <p className="text-slate-900 text-sm">{contactMethodLabel(task.contactMethod)}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">{T.amount}</p>
                                    <p className="text-red-600 text-sm font-medium">
                                      {task.customer?.currentOutstanding?.toLocaleString() || 0} SAR
                                    </p>
                                  </div>
                                </div>
                                {task.actionNotes && (
                                  <div className="mt-4 p-3 bg-white border border-slate-200 rounded-lg">
                                    <p className="text-slate-500 text-xs mb-1">{T.actionNotes}</p>
                                    <p className="text-slate-900 text-sm whitespace-pre-wrap">{task.actionNotes}</p>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Search + Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <div className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </div>
              <input
                ref={searchInputRef}
                type="text"
                placeholder={`${T.search}...`}
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full ps-10 pe-10 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearch(''); setPage(1); searchInputRef.current?.focus(); }}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                  title={txx.clearSearch}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex gap-2 shrink-0">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                aria-label={txx.filterByStatus}
                className="w-full sm:w-44 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              >
                <option value="">{T.all} {T.status}</option>
                <option value="pending">{T.pending}</option>
                <option value="done">{T.done}</option>
                <option value="postponed">{T.postponed}</option>
                <option value="cancelled">{T.cancelled}</option>
              </select>

              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                aria-label={txx.toggleFilters}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  showFilters ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900'
                }`}
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Extended Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
                  {isAdmin && (
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{T.assignedTo}</label>
                      <select
                        value={collectorFilter}
                        onChange={(e) => { setCollectorFilter(e.target.value); setPage(1); }}
                        aria-label={T.assignedTo}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      >
                        <option value="">{T.all}</option>
                        {collectors.map((c) => (
                          <option key={c._id} value={c._id}>{c.firstName} {c.lastName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{T.contactMethod}</label>
                    <select
                      value={contactMethodFilter}
                      onChange={(e) => { setContactMethodFilter(e.target.value); setPage(1); }}
                      aria-label={T.contactMethod}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="">{T.all}</option>
                      {CONTACT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{(T as any)[m.labelKey]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{T.from}</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                      aria-label={T.from}
                    />
                  </div>
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{T.to}</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                      aria-label={T.to}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tasks Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-200">
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.customer}</th>
                    {isAdmin && <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.assignedTo}</th>}
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.contactMethod}</th>
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.amount}</th>
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.status}</th>
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.dueDate}</th>
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.createdAt}</th>
                    <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.collectedAmount}</th>
                    <th className="text-end text-slate-300 font-semibold px-4 py-3">{T.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 9 : 8} className="text-center text-slate-800 py-12">
                        {T.noTasks}
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task) => (
                      <Fragment key={task._id}>
                        <tr
                          className={`border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer ${expandedTaskId === task._id ? 'bg-slate-100' : ''}`}
                          onClick={() => setExpandedTaskId(expandedTaskId === task._id ? null : task._id)}
                        >
                          <td className="px-4 py-3">
                            <div className="text-slate-900 font-medium">{task.customer?.companyName || '—'}</div>
                            <div className="text-slate-500 text-xs">{task.customer?.customerNumber || ''}</div>
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-slate-700">
                              {task.assignedTo?.firstName} {task.assignedTo?.lastName}
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <span className="text-slate-700">{contactMethodLabel(task.contactMethod)}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {task.customer?.currentOutstanding?.toLocaleString() || 0} SAR
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}>
                              {statusLabel(task.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700 text-xs">{formatDate(task.dueDate)}</td>
                          <td className="px-4 py-3 text-slate-700 text-xs">{formatDate(task.createdAt)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {task.collectedAmount > 0 ? `${task.collectedAmount.toLocaleString()} SAR` : '—'}
                          </td>
                          <td className="px-4 py-3 text-end">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {task.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => openUpdateModal(task)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-green-600 hover:bg-slate-100 transition-colors"
                                  title={txx.completeTask}
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditModal(task)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 transition-colors"
                                title={txx.editTaskTooltip}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task._id)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors"
                                  title={txx.deleteTask}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              {expandedTaskId === task._id ? (
                                <ChevronUp className="w-4 h-4 text-slate-500" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Details Row */}
                        {expandedTaskId === task._id && (
                          <tr key={`${task._id}-details`} className="border-b border-slate-200/70 bg-slate-100">
                            <td colSpan={isAdmin ? 9 : 8} className="px-4 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.name}</p>
                                  <p className="text-slate-900 text-sm">{task.createdBy?.firstName} {task.createdBy?.lastName}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.createdAt}</p>
                                  <p className="text-slate-900 text-sm">{formatDateTime(task.createdAt)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.dueDate}</p>
                                  <p className="text-slate-900 text-sm">{formatDateTime(task.dueDate)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.done}</p>
                                  <p className="text-slate-900 text-sm">{formatDateTime(task.completedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.collectedAmount}</p>
                                  <p className="text-slate-900 text-sm">
                                    {task.collectedAmount > 0 ? `${task.collectedAmount.toLocaleString()} SAR` : '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.nextFollowUp}</p>
                                  <p className={`text-sm ${task.nextFollowUpDate ? 'text-[#f37121] font-medium' : 'text-slate-900'}`}>
                                    {formatDateTime(task.nextFollowUpDate)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.contactMethod}</p>
                                  <p className="text-slate-900 text-sm">{contactMethodLabel(task.contactMethod)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs mb-1">{T.amount}</p>
                                  <p className="text-red-600 text-sm font-medium">
                                    {task.customer?.currentOutstanding?.toLocaleString() || 0} SAR
                                  </p>
                                </div>
                              </div>
                              {task.actionNotes && (
                                <div className="mt-4 p-3 bg-white border border-slate-200 rounded-lg">
                                  <p className="text-slate-500 text-xs mb-1">{T.actionNotes}</p>
                                  <p className="text-slate-900 text-sm whitespace-pre-wrap">{task.actionNotes}</p>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <p className="text-slate-500 text-sm">{T.page} {page} {T.of} {totalPages}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-900 text-sm disabled:opacity-50 hover:bg-slate-200 transition-colors"
                  >
                    {T.previous}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-900 text-sm disabled:opacity-50 hover:bg-slate-200 transition-colors"
                  >
                    {T.next}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── MONITORING TAB ─────────────────────────────────── */}
      {activeTab === 'monitoring' && isAdmin && (
        <>
          {statsLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : stats && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: T.title, value: stats.total, color: 'text-slate-900' },
                  { label: T.done, value: stats.done, color: 'text-green-600' },
                  { label: T.pending, value: stats.pending, color: 'text-yellow-700' },
                  { label: T.postponed, value: stats.postponed, color: 'text-blue-600' },
                  { label: T.cancelled, value: stats.cancelled, color: 'text-red-600' },
                  { label: T.completionRate, value: `${stats.completionRate}%`, color: 'text-[#f37121]' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <p className="text-slate-500 text-xs mb-1">{stat.label}</p>
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Extra stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <p className="text-slate-500 text-xs mb-1">{T.avgCompletionHours}</p>
                  <p className="text-xl font-bold text-slate-900">{stats.avgCompletionHours}h</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <p className="text-slate-500 text-xs mb-1">{T.totalCollected}</p>
                  <p className="text-xl font-bold text-green-600">{stats.totalCollected.toLocaleString()} SAR</p>
                </div>
              </div>

              {/* Filters for monitoring */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.from}</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label={T.from}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.to}</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label={T.to}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.assignedTo}</label>
                  <select value={collectorFilter} onChange={(e) => setCollectorFilter(e.target.value)} aria-label={T.assignedTo}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                    <option value="">{T.all}</option>
                    {collectors.map((c) => (
                      <option key={c._id} value={c._id}>{c.firstName} {c.lastName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.contactMethod}</label>
                  <select value={contactMethodFilter} onChange={(e) => setContactMethodFilter(e.target.value)} aria-label={T.contactMethod}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                    <option value="">{T.all}</option>
                    {CONTACT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{(T as any)[m.labelKey]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* By Collector Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-[#f37121]" />
                    {T.byCollector}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-900 border-b border-slate-200">
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.name}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.title}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.done}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.pending}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.postponed}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.cancelled}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.collectedAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byCollector.length === 0 ? (
                        <tr><td colSpan={7} className="text-center text-slate-800 py-8">{T.noDataFound}</td></tr>
                      ) : (
                        stats.byCollector.map((c: any, i: number) => (
                          <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                            <td className="px-4 py-3 text-slate-900 font-medium">{c.collectorName}</td>
                            <td className="px-4 py-3 text-slate-700">{c.total}</td>
                            <td className="px-4 py-3 text-green-600">{c.done}</td>
                            <td className="px-4 py-3 text-yellow-700">{c.pending}</td>
                            <td className="px-4 py-3 text-blue-600">{c.postponed}</td>
                            <td className="px-4 py-3 text-red-600">{c.cancelled}</td>
                            <td className="px-4 py-3 text-slate-700">{c.totalCollected?.toLocaleString() || 0} SAR</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By Customer Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-[#f37121]" />
                    {T.byCustomer}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-900 border-b border-slate-200">
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.customer}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.title}</th>
                        <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.done}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byCustomer.length === 0 ? (
                        <tr><td colSpan={3} className="text-center text-slate-800 py-8">{T.noDataFound}</td></tr>
                      ) : (
                        stats.byCustomer.map((c: any, i: number) => (
                          <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                            <td className="px-4 py-3 text-slate-900 font-medium">{c.customerName}</td>
                            <td className="px-4 py-3 text-slate-700">{c.total}</td>
                            <td className="px-4 py-3 text-green-600">{c.done}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── SUGGESTIONS TAB ────────────────────────────────── */}
      {activeTab === 'suggestions' && isAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-500 text-sm">{suggestions.length} {T.suggestions}</p>
            <button
              type="button"
              onClick={handleGenerateSuggestions}
              disabled={generatingSuggestions}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50"
            >
              {generatingSuggestions ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {T.suggestions}
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
              <Lightbulb className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">{T.noDataFound}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {suggestions.map((s) => (
                <div key={s._id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-slate-900 font-medium truncate">{s.customer?.companyName}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[s.riskLevel] || 'bg-slate-100 text-slate-500'}`}>
                        {(T as any)[s.riskLevel] || s.riskLevel}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm">{s.reason}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                      <span>{T.amount}: {s.outstanding?.toLocaleString()} SAR</span>
                      {s.overdueDays > 0 && <span>{T.overdueDays}: {s.overdueDays}</span>}
                      <span>{T.assignedTo}: {s.suggestedTo?.firstName} {s.suggestedTo?.lastName}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleApproveSuggestion(s._id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-600 rounded-lg text-sm font-medium hover:bg-green-500/30 transition-colors"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      {T.acceptSuggestion}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismissSuggestion(s._id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      {T.rejectSuggestion}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── CREATE TASK MODAL ──────────────────────────────── */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg mb-3">{T.createTask}</h2>
                <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900" aria-label={T.close}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-4">
                {/* Collector selection */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.assignedTo} *</label>
                  <select
                    value={selectedCollector}
                    onChange={(e) => setSelectedCollector(e.target.value)}
                    aria-label={txx.selectCollector}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">...</option>
                    {collectors.map((c) => (
                      <option key={c._id} value={c._id}>{c.firstName} {c.lastName}</option>
                    ))}
                  </select>
                </div>

                {selectedCollector && collectorCustomers.length === 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-700 text-sm">
                    {T.noDataFound}
                  </div>
                )}

                {/* Task batch */}
                {selectedCollector && collectorCustomers.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-slate-900 text-sm font-medium">{T.title} ({taskBatch.length})</h3>
                      <button
                        type="button"
                        onClick={addTaskToBatch}
                        className="flex items-center gap-1 px-2 py-1 text-[#f37121] hover:bg-[#f37121]/10 rounded-lg text-xs transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        {T.add}
                      </button>
                    </div>

                    {taskBatch.map((task, index) => (
                      <div key={index} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs">{T.title} {index + 1}</span>
                          {taskBatch.length > 1 && (
                            <button type="button" onClick={() => removeTaskFromBatch(index)} className="text-slate-500 hover:text-red-600" aria-label={txx.removeTask}>
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-slate-500 text-xs mb-1 block">{T.customer} *</label>
                            <select
                              value={task.customer}
                              onChange={(e) => updateTaskBatch(index, 'customer', e.target.value)}
                              aria-label={T.customer}
                              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                            >
                              <option value="">...</option>
                              {collectorCustomers.map((c) => (
                                <option key={c._id} value={c._id}>{c.companyName}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-slate-500 text-xs mb-1 block">{T.contactMethod} *</label>
                            <select
                              value={task.contactMethod}
                              onChange={(e) => updateTaskBatch(index, 'contactMethod', e.target.value)}
                              aria-label={T.contactMethod}
                              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                            >
                              {CONTACT_METHODS.map((m) => (
                                <option key={m.value} value={m.value}>{(T as any)[m.labelKey]}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-slate-500 text-xs mb-1 block">{T.dueDate}</label>
                            <div className="flex gap-1">
                              <input
                                type="datetime-local"
                                value={task.dueDate}
                                onChange={(e) => updateTaskBatch(index, 'dueDate', e.target.value)}
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                                aria-label={T.dueDate}
                              />
                              <button
                                type="button"
                                onClick={() => updateTaskBatch(index, 'dueDate', getTodayLocal())}
                                className="px-2 py-2 rounded-lg bg-slate-100 text-[#f37121] text-xs font-medium hover:bg-slate-200 transition-colors whitespace-nowrap"
                                title={txx.setToToday}
                              >
                                {T.today}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm transition-colors"
                >
                  {T.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleCreateTasks}
                  disabled={creating || !selectedCollector || taskBatch.every((t) => !t.customer)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {T.create} ({taskBatch.filter((t) => t.customer).length})
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── UPDATE TASK MODAL (Complete/Postpone/Cancel) ──── */}
      <AnimatePresence>
        {showUpdateModal && selectedTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUpdateModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">{T.editTask}</h2>
                  <p className="text-slate-300 text-sm mt-1">{selectedTask.customer?.companyName}</p>
                </div>
                <button type="button" onClick={() => setShowUpdateModal(false)} className="text-slate-500 hover:text-slate-900" aria-label={T.close}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Status */}
                <div>
                  <label className="text-slate-500 text-xs mb-2 block">{T.status} *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'done', label: T.done, icon: Check, color: 'text-green-600 border-green-500/50 bg-green-500/10' },
                      { value: 'postponed', label: T.postponed, icon: Pause, color: 'text-blue-600 border-blue-500/50 bg-blue-500/10' },
                      { value: 'cancelled', label: T.cancelled, icon: XCircle, color: 'text-red-600 border-red-500/50 bg-red-500/10' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUpdateForm((prev) => ({ ...prev, status: opt.value }))}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-sm font-medium transition-all ${
                          updateForm.status === opt.value ? opt.color : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <opt.icon className="w-5 h-5" />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Collected Amount */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.collectedAmount} (SAR)</label>
                  <input
                    type="number"
                    min="0"
                    value={updateForm.collectedAmount}
                    onChange={(e) => setUpdateForm((prev) => ({ ...prev, collectedAmount: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>

                {/* Action Notes */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">
                    {T.actionNotes} {(updateForm.status === 'cancelled' || updateForm.status === 'postponed') && <span className="text-red-600">*</span>}
                  </label>
                  <textarea
                    value={updateForm.actionNotes}
                    onChange={(e) => setUpdateForm((prev) => ({ ...prev, actionNotes: e.target.value }))}
                    rows={3}
                    placeholder={T.actionNotes}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                  />
                </div>

                {/* Next Follow-Up Date */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.nextFollowUp}</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      value={updateForm.nextFollowUpDate}
                      onChange={(e) => setUpdateForm((prev) => ({ ...prev, nextFollowUpDate: e.target.value }))}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                      aria-label={T.nextFollowUp}
                    />
                    <button
                      type="button"
                      onClick={() => setUpdateForm((prev) => ({ ...prev, nextFollowUpDate: getTodayLocal() }))}
                      className="px-3 py-2.5 rounded-lg bg-slate-100 text-[#f37121] text-xs font-medium hover:bg-slate-200 transition-colors whitespace-nowrap"
                      title={txx.setToToday}
                    >
                      {T.today}
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm transition-colors"
                >
                  {T.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleUpdateTask}
                  disabled={updating || !updateForm.status || ((updateForm.status === 'cancelled' || updateForm.status === 'postponed') && !updateForm.actionNotes.trim())}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50"
                >
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {T.save}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── EDIT TASK MODAL ──────────────────────────────────── */}
      <AnimatePresence>
        {showEditModal && editTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowEditModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg flex items-center gap-2 mb-3">
                    <Edit className="w-5 h-5 text-[#f37121]" />
                    {T.editTask}
                  </h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {editTask.customer?.companyName} — {editTask.assignedTo?.firstName} {editTask.assignedTo?.lastName}
                  </p>
                </div>
                <button type="button" onClick={() => setShowEditModal(false)} className="text-slate-500 hover:text-slate-900" aria-label={T.close}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {/* Contact Method */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.contactMethod}</label>
                  <select
                    value={editForm.contactMethod}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, contactMethod: e.target.value }))}
                    aria-label={T.contactMethod}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    {CONTACT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{(T as any)[m.labelKey]}</option>
                    ))}
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.dueDate}</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      value={editForm.dueDate}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                      aria-label={T.dueDate}
                    />
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, dueDate: getTodayLocal() }))}
                      className="px-3 py-2.5 rounded-lg bg-slate-100 text-[#f37121] text-xs font-medium hover:bg-slate-200 transition-colors whitespace-nowrap"
                    >
                      {T.today}
                    </button>
                  </div>
                </div>

                {/* Collected Amount */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.collectedAmount} (SAR)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.collectedAmount}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, collectedAmount: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  />
                </div>

                {/* Action Notes */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.actionNotes}</label>
                  <textarea
                    value={editForm.actionNotes}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, actionNotes: e.target.value }))}
                    rows={3}
                    placeholder={T.actionNotes}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none"
                  />
                </div>

                {/* Next Follow-Up Date */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.nextFollowUp}</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      value={editForm.nextFollowUpDate}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, nextFollowUpDate: e.target.value }))}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                      aria-label={T.nextFollowUp}
                    />
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, nextFollowUpDate: getTodayLocal() }))}
                      className="px-3 py-2.5 rounded-lg bg-slate-100 text-[#f37121] text-xs font-medium hover:bg-slate-200 transition-colors whitespace-nowrap"
                    >
                      {T.today}
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm transition-colors"
                >
                  {T.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleEditTask}
                  disabled={editing}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50"
                >
                  {editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {T.save}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
