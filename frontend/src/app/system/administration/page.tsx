'use client';
// الشؤون الإدارية (السكرتارية) — a Trello-style board kept deliberately simple:
// four fixed columns, drag a card OR tap the arrow button to move it, click a
// card to open it with EVERYTHING editable behind one explicit save button.
// The people using this screen are not technical, so every action has a
// visible button — drag & drop is a bonus, never the only way.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canAccessSection, canEditSection } from '@/lib/sections';
import {
  ClipboardList, Plus, CalendarDays, MessageSquare, User as UserIcon,
  ChevronLeft, ChevronRight, Trash2, CheckCircle2, History, Flag, Save,
} from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, Modal, Field, TextInput, TextArea, Select,
  PrimaryButton, ErrorNotice, StatCard,
} from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';

// ── Access ──────────────────────────────────────────────────────────────────
const STAFF = ['super_admin', 'admin', 'administrator', 'bd_manager', 'it_manager', 'it_specialist'];
const DELETE_ROLES = ['super_admin', 'admin', 'bd_manager', 'it_manager'];

// الكحلي — the navy the whole page keys off.
const NAVY = '#12325c';

// ── Vocabulary (فصحى) ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'new', ar: 'جديدة', en: 'New', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  { key: 'in_progress', ar: 'قيد التنفيذ', en: 'In Progress', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  { key: 'follow_up', ar: 'قيد المتابعة', en: 'Follow-up', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700' },
  { key: 'done', ar: 'مكتملة', en: 'Done', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
] as const;
type StatusKey = typeof COLUMNS[number]['key'];

const PRIORITIES = [
  { key: 'urgent', ar: 'عاجلة', en: 'Urgent', chip: 'bg-red-100 text-red-700' },
  { key: 'high', ar: 'مرتفعة', en: 'High', chip: 'bg-orange-100 text-orange-700' },
  { key: 'normal', ar: 'عادية', en: 'Normal', chip: 'bg-slate-100 text-slate-600' },
  { key: 'low', ar: 'منخفضة', en: 'Low', chip: 'bg-slate-50 text-slate-500' },
] as const;
const prio = (k?: string) => PRIORITIES.find((p) => p.key === k) || PRIORITIES[2];

interface Comment { _id?: string; byName: string; text: string; at: string }
interface Activity { _id?: string; byName: string; text: string; at: string }
interface Task {
  _id: string;
  title: string;
  description?: string;
  status: StatusKey;
  order: number;
  priority: string;
  dueDate?: string | null;
  assignee?: string | null;
  assigneeName?: string;
  createdByName?: string;
  completedAt?: string | null;
  comments: Comment[];
  activity: Activity[];
  createdAt: string;
}
interface Assignee { _id: string; name: string; role: string }

// datetime-local ⇄ ISO. The input works in local wall-clock time.
const toLocalInput = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toISO = (local: string): string | null => (local ? new Date(local).toISOString() : null);
// الافتراضي: اليوم في نهاية الدوام — يعدّله من يريد.
const defaultDue = (): string => {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return toLocalInput(d.toISOString());
};

const fmtDT = (v?: string | null, ar = true) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return String(v); }
};
const fmtFullDT = (v?: string | null, ar = true) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return String(v); }
};

// Due-state of a card: overdue (red), due today (amber), otherwise quiet.
// Time-aware: a 2pm deadline is overdue at 5pm the same day.
const dueState = (t: Task): 'overdue' | 'today' | null => {
  if (!t.dueDate || t.status === 'done') return null;
  const due = new Date(t.dueDate);
  const now = new Date();
  if (due.getTime() < now.getTime()) return 'overdue';
  return due.toDateString() === now.toDateString() ? 'today' : null;
};

export default function AdministrationBoardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const { confirm, notify } = useDialog();
  const ar = lang === 'ar';

  const role = user?.role || '';
  const perms = (user as any)?.permissions;
  const canView = STAFF.includes(role) || canAccessSection(perms, 'Administration');
  const canEdit = STAFF.includes(role) || canEditSection(perms, 'Administration');
  const canDelete = DELETE_ROLES.includes(role);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // New-task modal — due date pre-filled with today (end of workday).
  const [showNew, setShowNew] = useState(false);
  const blankForm = () => ({ title: '', description: '', assignee: '', dueDate: defaultDue(), priority: 'normal' });
  const [form, setForm] = useState(blankForm());

  // Detail modal: a DRAFT of every editable field + one explicit save button.
  const [openId, setOpenId] = useState<string | null>(null);
  const openTask = useMemo(() => tasks.find((t) => t._id === openId) || null, [tasks, openId]);
  const [draft, setDraft] = useState({ title: '', description: '', status: 'new' as StatusKey, priority: 'normal', dueDate: '', assignee: '' });
  const [comment, setComment] = useState('');
  const [showActivity, setShowActivity] = useState(false);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<StatusKey | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ tasks: Task[] }>('/api/admin-tasks');
      setTasks(d.tasks || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canEdit) return;
    api.get<{ users: Assignee[] }>('/api/admin-tasks/assignees')
      .then((d) => setAssignees(d.users || []))
      .catch(() => {});
  }, [canEdit]);
  useSocket('admintasks:updated', useCallback(() => load(), [load]));

  const openCard = (t: Task) => {
    setOpenId(t._id);
    setDraft({
      title: t.title,
      description: t.description || '',
      status: t.status,
      priority: t.priority,
      dueDate: toLocalInput(t.dueDate),
      assignee: t.assignee || '',
    });
    setComment('');
    setShowActivity(false);
  };

  const hit = useCallback((t: Task) => {
    const fold = (x: string) => x.toLowerCase()
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
    const s = fold(search.trim());
    if (!s) return true;
    return [t.title, t.description, t.assigneeName, t.createdByName].some((v) => fold(String(v || '')).includes(s));
  }, [search]);

  const byColumn = useMemo(() => {
    const map: Record<StatusKey, Task[]> = { new: [], in_progress: [], follow_up: [], done: [] };
    tasks.filter(hit).forEach((t) => { (map[t.status] || map.new).push(t); });
    (Object.keys(map) as StatusKey[]).forEach((k) => map[k].sort((a, b) => a.order - b.order || (a.createdAt < b.createdAt ? 1 : -1)));
    return map;
  }, [tasks, hit]);

  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => dueState(t) === 'overdue').length;
    const today = open.filter((t) => dueState(t) === 'today').length;
    const weekAgo = Date.now() - 7 * 86400000;
    const doneWeek = tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= weekAgo).length;
    return { open: open.length, overdue, today, doneWeek };
  }, [tasks]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const createTask = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      await api.post('/api/admin-tasks', {
        title: form.title,
        description: form.description,
        assignee: form.assignee || null,
        dueDate: toISO(form.dueDate),
        priority: form.priority,
      });
      setShowNew(false);
      setForm(blankForm());
      await load();
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
    setSaving(false);
  };

  const patchTask = async (id: string, body: Record<string, unknown>) => {
    // Optimistic status/order moves — the board must feel instant.
    setTasks((prev) => prev.map((t) => (t._id === id ? { ...t, ...body } as Task : t)));
    try {
      await api.patch(`/api/admin-tasks/${id}`, body);
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
    await load();
  };

  const saveDraft = async () => {
    if (!openTask || !draft.title.trim() || saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/admin-tasks/${openTask._id}`, {
        title: draft.title,
        description: draft.description,
        status: draft.status,
        priority: draft.priority,
        dueDate: toISO(draft.dueDate),
        assignee: draft.assignee || null,
      });
      setOpenId(null);
      await load();
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
    setSaving(false);
  };

  const completeTask = async () => {
    if (!openTask || saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/admin-tasks/${openTask._id}`, { status: 'done' });
      setOpenId(null);
      await load();
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
    setSaving(false);
  };

  const moveTask = (t: Task, dir: 1 | -1) => {
    const i = COLUMNS.findIndex((c) => c.key === t.status);
    const next = COLUMNS[i + dir];
    if (next) patchTask(t._id, { status: next.key });
  };

  const dropOn = (col: StatusKey) => {
    setDragOver(null);
    if (!dragId) return;
    const t = tasks.find((x) => x._id === dragId);
    setDragId(null);
    if (!t || t.status === col) return;
    patchTask(t._id, { status: col });
  };

  const sendComment = async () => {
    if (!openTask || !comment.trim() || saving) return;
    setSaving(true);
    try {
      await api.post(`/api/admin-tasks/${openTask._id}/comments`, { text: comment });
      setComment('');
      await load();
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
    setSaving(false);
  };

  const deleteTask = async () => {
    if (!openTask) return;
    if (!(await confirm(ar ? 'هل تريد حذف هذه المهمة نهائيًا؟' : 'Delete this task permanently?'))) return;
    try {
      await api.delete(`/api/admin-tasks/${openTask._id}`);
      setOpenId(null);
      await load();
    } catch (e: any) {
      notify(e?.message || 'Request failed', 'error');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!canView) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'You are not authorized to view this page.'}</div>;
  if (loading) return <Spinner />;

  const assigneeSelect = (value: string, onChange: (v: string) => void, disabled = false) => (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{ar ? 'دون مسؤول' : 'Unassigned'}</option>
      {assignees.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
    </Select>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<ClipboardList className="w-7 h-7" style={{ color: NAVY }} />}
        title={ar ? 'الشؤون الإدارية — لوحة المهام' : 'Administration — Task Board'}
        subtitle={ar ? 'أضف المهمة، ثم انقلها بين الأعمدة حتى تكتمل، وتابع الحوار داخل كل بطاقة' : 'Add a task, move it across the columns, and follow the conversation inside each card'}
      >
        {canEdit && (
          <button onClick={() => { setForm(blankForm()); setShowNew(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-white font-semibold shadow-sm hover:opacity-90 transition-opacity"
            style={{ backgroundColor: NAVY }}>
            <Plus className="w-4 h-4" />{ar ? 'مهمة جديدة' : 'New Task'}
          </button>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'مهام مفتوحة' : 'Open tasks'} value={stats.open} accent="text-sky-700" />
        <StatCard label={ar ? 'متأخرة عن موعدها' : 'Overdue'} value={stats.overdue} accent={stats.overdue ? 'text-red-600' : 'text-slate-400'} />
        <StatCard label={ar ? 'تستحق اليوم' : 'Due today'} value={stats.today} accent={stats.today ? 'text-amber-600' : 'text-slate-400'} />
        <StatCard label={ar ? 'أُنجزت هذا الأسبوع' : 'Done this week'} value={stats.doneWeek} accent="text-emerald-600" />
      </div>

      <div className="max-w-md">
        <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'ابحث في المهام بالعنوان أو الاسم…' : 'Search tasks by title or name…'} />
      </div>

      {/* The board. Columns stack on mobile, sit side-by-side from md up. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {COLUMNS.map((col) => {
          const list = byColumn[col.key];
          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((p) => (p === col.key ? null : p))}
              onDrop={() => dropOn(col.key)}
              className={`rounded-xl bg-white border border-slate-200 shadow-sm min-h-[12rem] transition-all ${dragOver === col.key ? 'ring-2 ring-offset-1' : ''}`}
              style={dragOver === col.key ? { ['--tw-ring-color' as any]: NAVY } : undefined}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2 font-bold" style={{ color: NAVY }}>
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                  {ar ? col.ar : col.en}
                </div>
                <span className="text-xs font-bold rounded-full px-2.5 py-0.5" style={{ backgroundColor: `${NAVY}14`, color: NAVY }}>{list.length}</span>
              </div>

              <div className="space-y-3 p-3">
                {list.length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-8 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                    {ar ? 'لا توجد مهام هنا' : 'No tasks here'}
                  </div>
                )}
                {list.map((t) => {
                  const p = prio(t.priority);
                  const due = dueState(t);
                  const first = COLUMNS[0].key === t.status;
                  const last = COLUMNS[COLUMNS.length - 1].key === t.status;
                  // In RTL the "forward" arrow points left visually.
                  const Fwd = isRTL ? ChevronLeft : ChevronRight;
                  const Back = isRTL ? ChevronRight : ChevronLeft;
                  return (
                    <div
                      key={t._id}
                      draggable={canEdit}
                      onDragStart={() => setDragId(t._id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      onClick={() => openCard(t)}
                      className={`bg-white rounded-lg border border-slate-200 border-t-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer ${dragId === t._id ? 'opacity-50' : ''}`}
                      style={{ borderTopColor: NAVY }}
                    >
                      <div className="p-3.5">
                        <div className="font-bold text-slate-800 text-sm leading-snug">{t.title}</div>

                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          {t.priority !== 'normal' && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${p.chip}`}>
                              <Flag className="w-3 h-3" />{ar ? p.ar : p.en}
                            </span>
                          )}
                          {t.dueDate && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                              due === 'overdue' ? 'bg-red-100 text-red-700' : due === 'today' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              <CalendarDays className="w-3 h-3" />
                              {due === 'overdue' ? (ar ? 'متأخرة · ' : 'Overdue · ') : ''}
                              {fmtDT(t.dueDate, ar)}
                            </span>
                          )}
                          {t.comments.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">
                              <MessageSquare className="w-3 h-3" />{t.comments.length}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                            <span className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: t.assigneeName ? NAVY : '#cbd5e1' }}>
                              {t.assigneeName ? t.assigneeName.trim()[0] : <UserIcon className="w-3 h-3" />}
                            </span>
                            <span className="truncate font-medium">{t.assigneeName || (ar ? 'دون مسؤول' : 'Unassigned')}</span>
                          </span>
                          {canEdit && (
                            <span className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {!first && (
                                <button onClick={() => moveTask(t, -1)} title={ar ? 'إرجاع خطوة' : 'Move back'}
                                  className="p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100">
                                  <Back className="w-4 h-4" />
                                </button>
                              )}
                              {!last && (
                                <button onClick={() => moveTask(t, 1)} title={ar ? 'نقل إلى الخطوة التالية' : 'Move forward'}
                                  className="p-1 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50">
                                  {t.status === 'follow_up' ? <CheckCircle2 className="w-4 h-4" /> : <Fwd className="w-4 h-4" />}
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── New task ── */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title={ar ? 'مهمة جديدة' : 'New Task'}
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إلغاء' : 'Cancel'}</button>
            <button onClick={createTask} disabled={!form.title.trim() || saving}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-white font-semibold disabled:opacity-40 hover:opacity-90"
              style={{ backgroundColor: NAVY }}>
              <Plus className="w-4 h-4" />{ar ? 'إضافة المهمة' : 'Add Task'}
            </button>
          </div>
        }>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'عنوان المهمة *' : 'Task title *'} span2>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={ar ? 'مثال: حجز تذاكر السفر للمدير العام' : 'e.g. Book travel tickets'} autoFocus />
          </Field>
          <Field label={ar ? 'التفاصيل' : 'Details'} span2>
            <TextArea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={ar ? 'اكتب أي تفاصيل تساعد على إنجاز المهمة…' : 'Any details that help get it done…'} />
          </Field>
          <Field label={ar ? 'المسؤول عن التنفيذ' : 'Assignee'}>
            {assigneeSelect(form.assignee, (v) => setForm({ ...form, assignee: v }))}
          </Field>
          <Field label={ar ? 'الأولوية' : 'Priority'}>
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{ar ? p.ar : p.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'موعد الاستحقاق (التاريخ والساعة)' : 'Due date & time'} span2>
            <TextInput type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* ── Task details: everything editable + one save button ── */}
      <Modal open={!!openTask} onClose={() => setOpenId(null)} title={ar ? 'تفاصيل المهمة' : 'Task Details'} wide
        footer={openTask ? (
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2">
              {canDelete && (
                <button onClick={deleteTask} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 font-medium text-sm">
                  <Trash2 className="w-4 h-4" />{ar ? 'حذف المهمة' : 'Delete'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setOpenId(null)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إغلاق' : 'Close'}</button>
              {canEdit && openTask.status !== 'done' && (
                <button onClick={completeTask} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-40">
                  <CheckCircle2 className="w-4 h-4" />{ar ? 'إتمام المهمة' : 'Mark done'}
                </button>
              )}
              {canEdit && (
                <button onClick={saveDraft} disabled={!draft.title.trim() || saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-white font-semibold disabled:opacity-40 hover:opacity-90"
                  style={{ backgroundColor: NAVY }}>
                  <Save className="w-4 h-4" />{ar ? 'حفظ التعديلات' : 'Save changes'}
                </button>
              )}
            </div>
          </div>
        ) : undefined}>
        {openTask && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={ar ? 'عنوان المهمة *' : 'Task title *'} span2>
                <TextInput value={draft.title} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label={ar ? 'التفاصيل' : 'Details'} span2>
                <TextArea rows={3} value={draft.description} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={ar ? 'لا توجد تفاصيل — أضفها هنا' : 'No details — add them here'} />
              </Field>
              <Field label={ar ? 'الحالة' : 'Status'}>
                <Select value={draft.status} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusKey })}>
                  {COLUMNS.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}
                </Select>
              </Field>
              <Field label={ar ? 'الأولوية' : 'Priority'}>
                <Select value={draft.priority} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{ar ? p.ar : p.en}</option>)}
                </Select>
              </Field>
              <Field label={ar ? 'موعد الاستحقاق (التاريخ والساعة)' : 'Due date & time'}>
                <TextInput type="datetime-local" disabled={!canEdit} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
              </Field>
              <Field label={ar ? 'المسؤول عن التنفيذ' : 'Assignee'}>
                {assigneeSelect(draft.assignee, (v) => setDraft({ ...draft, assignee: v }), !canEdit)}
              </Field>
            </div>

            {/* المحادثة */}
            <div className="border-t border-slate-100 pt-4">
              <div className="font-bold text-sm mb-2 flex items-center gap-1.5" style={{ color: NAVY }}>
                <MessageSquare className="w-4 h-4" />{ar ? 'المحادثة والمتابعة' : 'Conversation & follow-up'}
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
                {openTask.comments.length === 0 && (
                  <div className="text-xs text-slate-400 py-3 text-center">{ar ? 'لا توجد تعليقات بعد — ابدأ الحوار.' : 'No comments yet — start the conversation.'}</div>
                )}
                {openTask.comments.map((c, i) => (
                  <div key={c._id || i} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">{c.byName}</span>
                      <span className="text-[11px] text-slate-400" dir="ltr">{fmtFullDT(c.at, ar)}</span>
                    </div>
                    <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 mt-3">
                  <TextInput value={comment} onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); } }}
                    placeholder={ar ? 'اكتب تعليقًا أو متابعة…' : 'Write a comment or follow-up…'} />
                  <PrimaryButton onClick={sendComment} disabled={!comment.trim() || saving}>{ar ? 'إرسال' : 'Send'}</PrimaryButton>
                </div>
              )}
            </div>

            {/* سجل النشاط */}
            <div>
              <button onClick={() => setShowActivity((v) => !v)} className="text-xs font-semibold text-slate-400 hover:text-slate-600 inline-flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                {showActivity ? (ar ? 'إخفاء سجل النشاط' : 'Hide activity log') : (ar ? `سجل النشاط (${openTask.activity.length})` : `Activity log (${openTask.activity.length})`)}
              </button>
              {showActivity && (
                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pe-1">
                  {[...openTask.activity].reverse().map((a, i) => (
                    <div key={a._id || i} className="text-xs text-slate-500 flex items-start justify-between gap-3 border-b border-slate-50 pb-1.5">
                      <span><span className="font-semibold text-slate-600">{a.byName}</span> — {a.text}</span>
                      <span className="text-slate-300 shrink-0" dir="ltr">{fmtFullDT(a.at, ar)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-slate-400 mt-2">
                {ar ? 'أنشأها' : 'Created by'} {openTask.createdByName || '—'} · {fmtFullDT(openTask.createdAt, ar)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
