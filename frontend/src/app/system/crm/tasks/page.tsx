'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { ListTodo, Plus, Trash2, Edit, CheckCircle2, Circle } from 'lucide-react';
import {
  isCrmStaff, CrmTask, CrmCompany, CrmOptions, TASK_STATUS_STYLE, PRIORITY_STYLE,
  companyName, userName, fmtDate, dueBadge, exportToExcel, fmt, today,
} from '@/lib/crm';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, SmallBadge, Modal, Tabs,
  Field, TextInput, TextArea, Select,
} from '@/components/crm/CrmKit';

const EMPTY = { title: '', description: '', company: '', assignedTo: '', dueDate: '', dueTime: '', priority: 'medium', status: 'todo' };

export default function CrmTasksPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);

  const [items, setItems] = useState<CrmTask[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all'); // all | mine
  const [statusFilter, setStatusFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (scope === 'mine') qs.set('mine', 'true');
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ tasks: CrmTask[] }>(`/api/crm/tasks?${qs}`);
      setItems(d.tasks || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, scope, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {});
    api.get<{ companies: CrmCompany[] }>('/api/crm/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  useSocket('crm:task', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, assignedTo: user?._id || '' }); setShowModal(true); };
  const openEdit = (t: CrmTask) => {
    setEditing(t);
    setForm({ ...EMPTY, ...t, dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
      company: typeof t.company === 'object' ? t.company?._id : (t.company || ''),
      assignedTo: typeof t.assignedTo === 'object' ? t.assignedTo?._id : (t.assignedTo || '') });
    setShowModal(true);
  };
  const save = async () => {
    if (!form.title.trim()) { alert(ar ? 'العنوان مطلوب' : 'Title required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, company: form.company || undefined, assignedTo: form.assignedTo || undefined, dueDate: form.dueDate || undefined };
      if (editing) await api.put(`/api/crm/tasks/${editing._id}`, payload);
      else await api.post('/api/crm/tasks', payload);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };
  const remove = async (t: CrmTask) => {
    if (!confirm(T.confirmDelete)) return;
    try { await api.delete(`/api/crm/tasks/${t._id}`); load(); } catch (e: any) { alert(e.message); }
  };
  const toggle = async (t: CrmTask) => {
    const status = t.status === 'done' ? 'todo' : 'done';
    setItems((prev) => prev.map((x) => x._id === t._id ? { ...x, status } : x));
    try { await api.put(`/api/crm/tasks/${t._id}`, { status }); load(); } catch (e: any) { alert(e.message); load(); }
  };

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ListTodo className="w-5 h-5" />} title={T.tasks} subtitle={`${items.length} ${T.tasks}`}>
        <ExportButton label={T.export} onClick={() => exportToExcel(items, [
          { header: T.taskTitle, key: 'title', width: 28 },
          { header: T.company, key: 'company', transform: (v) => companyName(v), width: 22 },
          { header: T.assignedTo, key: 'assignedTo', transform: (v) => userName(v), width: 18 },
          { header: T.dueDate, key: 'dueDate', transform: fmt.date, width: 14 },
          { header: T.priority, key: 'priority', width: 10 },
          { header: T.status, key: 'status', width: 12 },
        ], `crm-tasks-${today()}`, 'Tasks')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {T.addTask}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <Tabs tabs={[{ key: 'all', label: T.all }, { key: 'mine', label: T.myTasks }]} active={scope} onChange={setScope} />
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={T.search} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{T.allStatuses}</option>
          {(opts?.TASK_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-10 text-center text-slate-500 shadow-sm">{T.noResults}</div>
        ) : items.map((t) => {
          const due = t.status !== 'done' ? dueBadge(t.dueDate, lang) : null;
          return (
            <div key={t._id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
              <button type="button" title={T.markDone} onClick={() => toggle(t)} className="shrink-0">
                {t.status === 'done' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Circle className="w-5 h-5 text-slate-500 hover:text-slate-700" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{t.title}</p>
                <p className="text-slate-500 text-xs">{companyName(t.company, lang)} · {userName(t.assignedTo)} {t.dueDate ? `· ${fmtDate(t.dueDate)}` : ''}</p>
              </div>
              {due && <SmallBadge bg={due.bg} text={due.text} label={due.label} />}
              <Badge style={PRIORITY_STYLE[t.priority]} lang={lang} />
              <Badge style={TASK_STATUS_STYLE[t.status]} lang={lang} />
              <button type="button" title={T.edit} onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
              <button type="button" title={T.delete} onClick={() => remove(t)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? T.edit : T.addTask}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.taskTitle} span2><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label={T.company} span2><Select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">{T.none}</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
          </Select></Field>
          <Field label={T.dueDate}><TextInput type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label={T.dueTime}><TextInput type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} /></Field>
          <Field label={T.priority}><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {(opts?.TASK_PRIORITIES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.status}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {(opts?.TASK_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.assignedTo} span2><Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
            <option value="">—</option>
            {(opts?.owners || []).map((o) => <option key={o._id} value={o._id}>{o.firstName} {o.lastName}</option>)}
          </Select></Field>
          <Field label={T.description} span2><TextArea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
