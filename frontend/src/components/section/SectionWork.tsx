'use client';
// Reusable per-section Tasks / Complaints board. Drop into any section page as
// <SectionWork section="crm" kind="tasks" />. Visibility is enforced server-side
// (only assignee + creator + super_admin), so anything the API returns is
// something the current user is allowed to open and edit.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ClipboardList, MessageSquare, Plus, Edit, Trash2, Check, Loader2, User as UserIcon } from 'lucide-react';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, TextArea, Select } from '@/components/hr/HRKit';

type Kind = 'tasks' | 'complaints';
type Row = Record<string, any>;
interface Assignee { _id: string; firstName?: string; lastName?: string; role?: string }

const STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  todo: { bg: 'bg-slate-100', text: 'text-slate-700', en: 'To do', ar: 'قيد الانتظار' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', en: 'In progress', ar: 'جاري التنفيذ' },
  done: { bg: 'bg-emerald-100', text: 'text-emerald-700', en: 'Done', ar: 'منجزة' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', en: 'Cancelled', ar: 'ملغاة' },
  open: { bg: 'bg-amber-100', text: 'text-amber-700', en: 'Open', ar: 'مفتوحة' },
  resolved: { bg: 'bg-emerald-100', text: 'text-emerald-700', en: 'Resolved', ar: 'تم الحل' },
  closed: { bg: 'bg-slate-100', text: 'text-slate-600', en: 'Closed', ar: 'مغلقة' },
};
const PRIORITY: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  low: { bg: 'bg-slate-100', text: 'text-slate-600', en: 'Low', ar: 'منخفضة' },
  medium: { bg: 'bg-blue-100', text: 'text-blue-700', en: 'Medium', ar: 'متوسطة' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', en: 'High', ar: 'عالية' },
  urgent: { bg: 'bg-red-100', text: 'text-red-700', en: 'Urgent', ar: 'عاجلة' },
};

const cfgFor = (kind: Kind) => kind === 'tasks'
  ? { ep: 'tasks', titleField: 'title', statuses: ['todo', 'in_progress', 'done', 'cancelled'], icon: ClipboardList,
      title: { en: 'Tasks', ar: 'المهام' }, titleLabel: { en: 'Title', ar: 'العنوان' }, hasResolution: false }
  : { ep: 'complaints', titleField: 'subject', statuses: ['open', 'in_progress', 'resolved', 'closed'], icon: MessageSquare,
      title: { en: 'Complaints', ar: 'الشكاوى' }, titleLabel: { en: 'Subject', ar: 'الموضوع' }, hasResolution: true };

const personName = (p?: Assignee | null) => p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || '—' : '—';
const fmtDate = (v?: string, lang: 'en' | 'ar' = 'en') => v ? new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: '2-digit' }) : '';

export default function SectionWork({ section, kind }: { section: string; kind: Kind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const cfg = cfgFor(kind);

  const [items, setItems] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ section });
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ items: Row[] }>(`/api/section-work/${cfg.ep}?${qs.toString()}`);
      setItems(d.items || []);
    } catch { /* keep last */ }
    setLoaded(true);
  }, [section, cfg.ep, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ users: Assignee[] }>(`/api/section-work/assignees`).then((d) => setAssignees(d.users || [])).catch(() => {}); }, []);
  useSocket('section:work', useCallback(() => load(), [load]));

  const openCreate = () => {
    setEditing(null);
    setForm({ [cfg.titleField]: '', description: '', priority: 'medium', status: cfg.statuses[0], dueDate: '', resolution: '', assignedTo: '' });
    setErr(''); setShowForm(true);
  };
  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      [cfg.titleField]: row[cfg.titleField] || '', description: row.description || '', priority: row.priority || 'medium',
      status: row.status || cfg.statuses[0], dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      resolution: row.resolution || '', assignedTo: row.assignedTo?._id || row.assignedTo || '',
    });
    setErr(''); setShowForm(true);
  };

  const save = async () => {
    if (!String(form[cfg.titleField] || '').trim()) { setErr(t('Required', 'مطلوب')); return; }
    setSaving(true); setErr('');
    try {
      const body: Row = { section, [cfg.titleField]: form[cfg.titleField], description: form.description, priority: form.priority, status: form.status, assignedTo: form.assignedTo || undefined };
      if (kind === 'tasks') body.dueDate = form.dueDate || undefined;
      if (cfg.hasResolution) body.resolution = form.resolution;
      if (editing) await api.patch(`/api/section-work/${cfg.ep}/${editing._id}`, body);
      else await api.post(`/api/section-work/${cfg.ep}`, body);
      setShowForm(false); load();
    } catch (e: any) { setErr(e?.message || t('Save failed', 'فشل الحفظ')); }
    setSaving(false);
  };

  const remove = async (row: Row) => {
    if (!confirm(t('Delete this record?', 'حذف هذا السجل؟'))) return;
    try { await api.delete(`/api/section-work/${cfg.ep}/${row._id}`); load(); } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  if (user?.role === 'client') return <div className="text-slate-500 p-8">{t('Not authorized', 'لا تملك صلاحية')}</div>;
  if (!loaded) return <Spinner />;
  const Icon = cfg.icon;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Icon className="w-5 h-5" />} title={ar ? cfg.title.ar : cfg.title.en} subtitle={`${items.length} · ${t('only yours & assigned to you', 'الخاصة بك والمُسندة إليك')}`}>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {t('Add', 'إضافة')}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t('All', 'الكل')}</button>
        {cfg.statuses.map((s) => {
          const st = STATUS[s];
          return (
            <button key={s} type="button" onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === s ? `${st.bg} ${st.text} border-current` : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {ar ? st.ar : st.en}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 shadow-sm">{t('No records', 'لا توجد سجلات')}</div>
      ) : (
        <div className="space-y-2">
          {items.map((row) => {
            const st = STATUS[row.status]; const pr = PRIORITY[row.priority];
            return (
              <div key={row._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-slate-900 font-semibold">{row[cfg.titleField]}</p>
                  {row.description && <p className="text-slate-500 text-sm mt-0.5 line-clamp-2">{row.description}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                    {st && <span className={`px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{ar ? st.ar : st.en}</span>}
                    {pr && <span className={`px-2 py-0.5 rounded-full font-medium ${pr.bg} ${pr.text}`}>{ar ? pr.ar : pr.en}</span>}
                    <span className="text-slate-500 flex items-center gap-1"><UserIcon className="w-3 h-3" /> {t('Assignee', 'المُسند إليه')}: {personName(row.assignedTo)}</span>
                    <span className="text-slate-400">· {t('By', 'بواسطة')} {personName(row.createdBy)}</span>
                    {kind === 'tasks' && row.dueDate && <span className="text-slate-400">· {t('Due', 'الاستحقاق')} {fmtDate(row.dueDate, lang)}</span>}
                  </div>
                  {cfg.hasResolution && row.resolution && <p className="text-emerald-700 text-xs mt-1">{t('Resolution', 'الحل')}: {row.resolution}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={t('Edit', 'تعديل')}><Edit className="w-4 h-4" /></button>
                  <button type="button" onClick={() => remove(row)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={t('Delete', 'حذف')}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} wide title={editing ? t('Edit', 'تعديل') : t('Add', 'إضافة')}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('Cancel', 'إلغاء')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('Save', 'حفظ')}</PrimaryButton>
        </>}>
        {err && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? cfg.titleLabel.ar : cfg.titleLabel.en} span2><TextInput value={form[cfg.titleField] || ''} onChange={(e) => setForm({ ...form, [cfg.titleField]: e.target.value })} /></Field>
          <Field label={t('Description', 'الوصف')} span2><TextArea rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label={t('Status', 'الحالة')}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {cfg.statuses.map((s) => <option key={s} value={s}>{ar ? STATUS[s].ar : STATUS[s].en}</option>)}
          </Select></Field>
          <Field label={t('Priority', 'الأولوية')}><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {Object.keys(PRIORITY).map((p) => <option key={p} value={p}>{ar ? PRIORITY[p].ar : PRIORITY[p].en}</option>)}
          </Select></Field>
          <Field label={t('Assign to', 'إسناد إلى')}><Select value={form.assignedTo || ''} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
            <option value="">{t('Me', 'أنا')}</option>
            {assignees.map((a) => <option key={a._id} value={a._id}>{personName(a)}{a.role ? ` (${a.role})` : ''}</option>)}
          </Select></Field>
          {kind === 'tasks' && <Field label={t('Due date', 'تاريخ الاستحقاق')}><TextInput type="date" value={form.dueDate || ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>}
          {cfg.hasResolution && <Field label={t('Resolution', 'الحل')} span2><TextArea rows={2} value={form.resolution || ''} onChange={(e) => setForm({ ...form, resolution: e.target.value })} /></Field>}
        </div>
      </Modal>
    </div>
  );
}
