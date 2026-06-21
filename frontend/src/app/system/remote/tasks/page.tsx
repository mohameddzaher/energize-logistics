'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { ListTodo, Plus, X, Trash2, RefreshCw } from 'lucide-react';
import { isRemoteStaff } from '@/lib/remote';

interface Task {
  _id: string;
  user?: { _id: string; firstName: string; lastName: string };
  assignedBy?: { firstName: string; lastName: string };
  title: string;
  description?: string;
  dueDate?: string;
  done: boolean;
  createdAt: string;
}
interface EmployeeOpt { _id: string; firstName: string; lastName: string }

export default function RemoteTasksPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isRemoteStaff(user?.role);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [showForm, setShowForm] = useState(false);

  // assign form
  const [assignTo, setAssignTo] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (userId) qs.set('userId', userId);
      const data = await api.get<{ tasks: Task[] }>(`/api/remote/tasks?${qs.toString()}`);
      setTasks(data.tasks || []);
    } catch {} finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (staff) api.get<{ employees: EmployeeOpt[] }>('/api/remote/employees').then((d) => setEmployees(d.employees || [])).catch(() => {});
  }, [staff]);
  // Employees get a live ping when a task is assigned to them.
  useSocket('remote:task', useCallback(() => load(), [load]));

  const toggle = async (t: Task) => {
    // optimistic
    setTasks((prev) => prev.map((x) => x._id === t._id ? { ...x, done: !x.done } : x));
    try { await api.patch(`/api/remote/tasks/${t._id}`, { done: !t.done }); } catch { load(); }
  };

  const remove = async (id: string) => {
    setTasks((prev) => prev.filter((x) => x._id !== id));
    try { await api.delete(`/api/remote/tasks/${id}`); } catch { load(); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!assignTo || !title.trim()) { setErr(ar ? 'اختر موظفًا واكتب عنوان المهمة' : 'Pick an employee and a title'); return; }
    setSubmitting(true);
    try {
      await api.post('/api/remote/tasks', { user: assignTo, title, description, dueDate: dueDate || undefined });
      setShowForm(false); setTitle(''); setDescription(''); setDueDate('');
      load();
    } catch (e: any) { setErr(e.message || 'Failed'); } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><ListTodo className="w-6 h-6 text-[#f37121]" />{staff ? (ar ? 'مهام الفريق' : 'Team Tasks') : (ar ? 'مهامي' : 'My Tasks')}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          {staff && (
            <button type="button" onClick={() => { setShowForm(true); setErr(''); }} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" />{ar ? 'إسناد مهمة' : 'Assign Task'}</button>
          )}
        </div>
      </div>

      {staff && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-xs shadow-sm">
          <label className="block text-slate-500 text-xs mb-1">{ar ? 'الموظف' : 'Employee'}</label>
          <select aria-label="Employee" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
            <option value="">{ar ? 'الكل' : 'All'}</option>
            {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <p className="text-slate-500 text-center py-10">{ar ? 'لا توجد مهام' : 'No tasks'}</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t._id} className={`bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 ${t.done ? 'opacity-60' : ''} shadow-sm`}>
              <button type="button" onClick={() => toggle(t)} className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${t.done ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-[#f37121]'}`} title="Toggle">
                {t.done && <span className="text-slate-900 text-sm">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-white font-medium ${t.done ? 'line-through' : ''}`}>{t.title}</p>
                {t.description && <p className="text-slate-500 text-sm mt-0.5">{t.description}</p>}
                <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                  {staff && t.user && <span>{ar ? 'لـ' : 'For'}: {t.user.firstName} {t.user.lastName}</span>}
                  {t.dueDate && <span>{ar ? 'الموعد' : 'Due'}: {t.dueDate}</span>}
                  {t.assignedBy && <span>{ar ? 'من' : 'By'}: {t.assignedBy.firstName} {t.assignedBy.lastName}</span>}
                </div>
              </div>
              {staff && (
                <button type="button" onClick={() => remove(t._id)} className="text-slate-500 hover:text-red-600 p-1" title="Delete"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowForm(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{ar ? 'إسناد مهمة' : 'Assign Task'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-900" title="Close"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{err}</div>}
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{ar ? 'الموظف' : 'Employee'}</label>
                <select aria-label="Assignee" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required>
                  <option value="">{ar ? 'اختر...' : 'Select...'}</option>
                  {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{ar ? 'عنوان المهمة' : 'Title'}</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required placeholder={ar ? 'ماذا يجب أن يفعل؟' : 'What to do?'} />
              </div>
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{ar ? 'تفاصيل (اختياري)' : 'Details (optional)'}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
              </div>
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{ar ? 'الموعد النهائي (اختياري)' : 'Due date (optional)'}</label>
                <input aria-label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                  {submitting && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {ar ? 'إسناد' : 'Assign'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
