'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { LifeBuoy, Plus, Edit, Trash2, Check, RefreshCw, ExternalLink } from 'lucide-react';
import { exportToExcel } from '@/utils/exportExcel';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, Loader2,
} from '@/components/hr/HRKit';
import {
  canViewIt, Ticket, EmployeeRef, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES,
  categoryLabel, priorityLabel, ticketStatusLabel, optionsOf, empName, fmtDate,
  fmtDuration, today, idOf,
} from '@/lib/it';

const EMPTY = {
  title: '', category: 'hardware', priority: 'medium', status: 'open',
  requester: '', requesterName: '', requesterDepartment: '',
  assignedToName: '', reportedAt: '', device: '',
  description: '', resolution: '', rootCause: '', preventiveAction: '', notes: '',
};

export default function ItTicketsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (priorityFilter) qs.set('priority', priorityFilter);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const d = await api.get<{ tickets: Ticket[] }>(`/api/it/tickets?${qs.toString()}`);
      setTickets(d.tickets || []);
    } catch {}
    setLoading(false);
  }, [statusFilter, categoryFilter, priorityFilter, from, to]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ employees: EmployeeRef[] }>('/api/it/employees')
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, reportedAt: today() }); setShowModal(true); };
  const openEdit = (t: Ticket) => {
    setEditing(t);
    setForm({ ...EMPTY, ...t, requester: idOf(t.requester), assignedTo: idOf(t.assignedTo) });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const body = { ...form, requester: form.requester || undefined };
      if (editing) await api.put(`/api/it/tickets/${editing._id}`, body);
      else await api.post('/api/it/tickets', body);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (t: Ticket) => {
    if (!(await confirm(ar ? 'حذف هذا البلاغ؟' : 'Delete this ticket?'))) return;
    try { await api.delete(`/api/it/tickets/${t._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = tickets.filter((t) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [t.title, t.ticketNumber, t.requesterName, t.device, t.description]
      .some((v) => (v || '').toLowerCase().includes(s));
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<LifeBuoy className="w-5 h-5" />}
        title={ar ? 'بلاغات الدعم الفني' : 'Support Tickets'}
        subtitle={`${filtered.length} ${ar ? 'بلاغ' : 'tickets'}`}
      >
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Ticket #', key: 'ticketNumber', width: 12 },
          { header: 'Title', key: 'title', width: 32 },
          { header: 'Category', key: 'category', transform: (v: any) => categoryLabel(v, 'en'), width: 16 },
          { header: 'Priority', key: 'priority', transform: (v: any) => priorityLabel(v, 'en'), width: 12 },
          { header: 'Status', key: 'status', transform: (v: any) => ticketStatusLabel(v, 'en'), width: 14 },
          { header: 'Requester', key: 'requesterName', width: 22 },
          { header: 'Department', key: 'requesterDepartment', width: 18 },
          { header: 'Reported', key: 'reportedAt', width: 14 },
          { header: 'Resolution time', key: 'resolutionMinutes', transform: (v: any) => fmtDuration(v, 'en'), width: 16 },
          { header: 'Recurring', key: 'isRecurring', transform: (v: any) => (v ? 'Yes' : 'No'), width: 10 },
          { header: 'Resolution', key: 'resolution', width: 40 },
          { header: 'Root cause', key: 'rootCause', width: 32 },
        ], `it-tickets-${today()}`, 'Tickets')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'بلاغ جديد' : 'New ticket'}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالعنوان أو رقم البلاغ...' : 'Search title or ticket #...'} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
          {optionsOf(TICKET_STATUSES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
        </Select>
        <div className="w-full lg:w-56 shrink-0">
          <SearchableSelect
            value={categoryFilter} onChange={setCategoryFilter}
            placeholder={ar ? 'كل التصنيفات' : 'All categories'} emptyLabel={ar ? 'كل التصنيفات' : 'All categories'}
            options={[{ value: '', label: ar ? 'كل التصنيفات' : 'All categories' }, ...optionsOf(TICKET_CATEGORIES).map((o) => ({ value: o.key, label: ar ? o.ar : o.en }))]}
          />
        </div>
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">{ar ? 'كل الأولويات' : 'All priorities'}</option>
          {optionsOf(TICKET_PRIORITIES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
        </Select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{ar ? 'رقم البلاغ' : 'Ticket #'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'العنوان' : 'Title'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'التصنيف' : 'Category'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الأولوية' : 'Priority'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'مقدم البلاغ' : 'Requester'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'التاريخ' : 'Reported'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'زمن الحل' : 'Resolution'}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-slate-500 py-12">{ar ? 'لا توجد بلاغات.' : 'No tickets found.'}</td></tr>
            ) : filtered.map((t) => (
              <tr key={t._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{t.ticketNumber || '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/system/it/tickets/${t._id}`} className="text-slate-900 font-medium hover:text-[#f37121] inline-flex items-center gap-1.5">
                    {t.isRecurring && <span className="text-red-600" title={ar ? 'مشكلة متكررة' : 'Recurring problem'}>⟳</span>}
                    {t.title}
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </Link>
                  {t.device && <div className="text-xs text-slate-500">{t.device}</div>}
                </td>
                <td className="px-4 py-3">
                  <SmallBadge bg={TICKET_CATEGORIES[t.category]?.bg || 'bg-slate-500/15'} text={TICKET_CATEGORIES[t.category]?.text || 'text-slate-700'} label={categoryLabel(t.category, lang)} />
                </td>
                <td className="px-4 py-3">
                  <SmallBadge bg={TICKET_PRIORITIES[t.priority]?.bg || 'bg-slate-500/15'} text={TICKET_PRIORITIES[t.priority]?.text || 'text-slate-700'} label={priorityLabel(t.priority, lang)} />
                </td>
                <td className="px-4 py-3">
                  <SmallBadge bg={TICKET_STATUSES[t.status]?.bg || 'bg-slate-500/15'} text={TICKET_STATUSES[t.status]?.text || 'text-slate-700'} label={ticketStatusLabel(t.status, lang)} />
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {t.requesterName || empName(t.requester, lang)}
                  {t.requesterDepartment && <div className="text-xs text-slate-500">{t.requesterDepartment}</div>}
                </td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(t.reportedAt)}</td>
                <td className="px-4 py-3 text-slate-700">{fmtDuration(t.resolutionMinutes, lang)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(t)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل البلاغ' : 'Edit ticket') : (ar ? 'بلاغ جديد' : 'New ticket')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'عنوان المشكلة' : 'Problem title'} span2>
            <TextInput value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={ar ? 'مثال: الطابعة لا تستجيب' : 'e.g. Printer not responding'} />
          </Field>
          <Field label={ar ? 'التصنيف' : 'Category'}>
            <SearchableSelect
              value={form.category} onChange={(v) => set('category', v)}
              options={optionsOf(TICKET_CATEGORIES).map((o) => ({ value: o.key, label: ar ? o.ar : o.en }))}
            />
          </Field>
          <Field label={ar ? 'الأولوية' : 'Priority'}>
            <Select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {optionsOf(TICKET_PRIORITIES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {optionsOf(TICKET_STATUSES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'تاريخ البلاغ' : 'Reported at'}>
            <TextInput type="date" value={form.reportedAt || ''} onChange={(e) => set('reportedAt', e.target.value)} />
          </Field>
          <Field label={ar ? 'الموظف (اختياري)' : 'Employee (optional)'}>
            <SearchableSelect
              value={form.requester || ''}
              onChange={(v) => set('requester', v)}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي…' : 'Search by name or number…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((emp) => ({
                value: emp._id,
                label: empName(emp, lang),
                hint: [emp.employeeNumber, emp.department, emp.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          <Field label={ar ? 'اسم مقدم البلاغ' : 'Requester name'}>
            <TextInput value={form.requesterName || ''} onChange={(e) => set('requesterName', e.target.value)} />
          </Field>
          <Field label={ar ? 'القسم' : 'Department'}>
            <TextInput value={form.requesterDepartment || ''} onChange={(e) => set('requesterDepartment', e.target.value)} />
          </Field>
          <Field label={ar ? 'المسؤول عن الحل' : 'Assigned to'}>
            <TextInput value={form.assignedToName || ''} onChange={(e) => set('assignedToName', e.target.value)} />
          </Field>
          <Field label={ar ? 'الجهاز' : 'Device'} span2>
            <TextInput value={form.device || ''} onChange={(e) => set('device', e.target.value)} placeholder={ar ? 'مثال: HP LaserJet - الدور الثاني' : 'e.g. HP LaserJet - 2nd floor'} />
          </Field>
          <Field label={ar ? 'وصف المشكلة' : 'Description'} span2>
            <TextArea rows={3} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label={ar ? 'ما تم عمله لحل المشكلة' : 'Resolution — what IT did'} span2>
            <TextArea rows={3} value={form.resolution || ''} onChange={(e) => set('resolution', e.target.value)} />
          </Field>
          <Field label={ar ? 'السبب الجذري' : 'Root cause'} span2>
            <TextArea rows={2} value={form.rootCause || ''} onChange={(e) => set('rootCause', e.target.value)} />
          </Field>
          <Field label={ar ? 'الإجراء الوقائي لمنع التكرار' : 'Preventive action'} span2>
            <TextArea rows={2} value={form.preventiveAction || ''} onChange={(e) => set('preventiveAction', e.target.value)} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
