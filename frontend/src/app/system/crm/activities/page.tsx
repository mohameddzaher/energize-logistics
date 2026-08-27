'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations, getCrmActivitiesExtraTranslations } from '@/lib/translations';
import { Phone, Plus, Trash2, Edit, MessageCircle, Mail, Users, MapPin, StickyNote } from 'lucide-react';
import {
  isCrmStaff, CrmActivity, CrmCompany, CrmOptions, optLabel, companyName, userName, fmtDateTime, fmt,
} from '@/lib/crm';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select,
} from '@/components/crm/CrmKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

const EMPTY = { type: 'call', subject: '', body: '', company: '', direction: 'outbound', outcome: '', date: '', durationMinutes: 0 };
const ICONS: Record<string, any> = { call: Phone, meeting: Users, email: Mail, whatsapp: MessageCircle, visit: MapPin, note: StickyNote };

export default function CrmActivitiesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);
  const txx = getCrmActivitiesExtraTranslations(lang);

  const [items, setItems] = useState<CrmActivity[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmActivity | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (typeFilter) qs.set('type', typeFilter);
      const d = await api.get<{ activities: CrmActivity[] }>(`/api/crm/activities?${qs}`);
      setItems(d.activities || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, typeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {});
    api.get<{ companies: CrmCompany[] }>('/api/crm/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  useSocket('crm:activity', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, date: new Date().toISOString().slice(0, 16) }); setShowModal(true); };
  const openEdit = (a: CrmActivity) => {
    setEditing(a);
    setForm({ ...EMPTY, ...a, date: a.date ? new Date(a.date).toISOString().slice(0, 16) : '',
      company: typeof a.company === 'object' ? a.company?._id : (a.company || '') });
    setShowModal(true);
  };
  const save = async () => {
    if (!form.subject.trim()) { notify(ar ? 'الموضوع مطلوب' : 'Subject required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, durationMinutes: Number(form.durationMinutes) || 0, company: form.company || undefined, date: form.date ? new Date(form.date) : undefined };
      if (editing) await api.put(`/api/crm/activities/${editing._id}`, payload);
      else await api.post('/api/crm/activities', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (a: CrmActivity) => {
    if (!(await confirm(T.confirmDelete))) return;
    try { await api.delete(`/api/crm/activities/${a._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: T.type, key: 'type', width: 12 },
    { header: T.subject, key: 'subject', width: 30 },
    { header: T.company, key: 'company', transform: (v) => companyName(v), width: 22 },
    { header: T.date, key: 'date', transform: fmt.datetime, width: 18 },
    { header: txx.by, key: 'createdBy', transform: (v) => userName(v), width: 18 },
  ];
  // البحث والنوع يُطبَّقان على الخادم، فما في الذاكرة نتيجةُ الفلتر لا السجلّ كلّه؛
  // ومَن أراد الكلّ كان عليه مسحُ فلاتره ثمّ إعادة التصدير، ولن يتنبّه إلى ذلك أحد.
  // ملاحظة: الخادم يسقّف هذا المسار بخمسمئة نشاطٍ في كلّ الأحوال، معروضًا كان أم مصدَّرًا.
  const fetchAllForExport = async () => {
    const d = await api.get<{ activities: CrmActivity[] }>('/api/crm/activities');
    return [{ name: 'Activities', rows: d.activities || [], columns: exportColumns }];
  };
  const hasActiveFilters = !!(search.trim() || typeFilter);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: hasActiveFilters ? scope.shown : scope.all, sheets: [{ name: 'Activities', rows: items, columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!isCrmStaff(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Phone className="w-5 h-5" />} title={T.activities} subtitle={`${items.length} ${T.activities}`}>
        <ExportMenu fileName="crm-activities" lang={ar ? 'ar' : 'en'} variant="subtle" label={T.export} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {T.logActivity}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={T.search} /></div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{T.allTypes_}</option>
          {(opts?.ACTIVITY_TYPES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-10 text-center text-slate-500 shadow-sm">{T.noActivity}</div>
        ) : items.map((a) => {
          const Icon = ICONS[a.type] || StickyNote;
          return (
            <div key={a._id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-[#f37121]/15 text-[#f37121] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-900 text-sm font-medium">{a.subject}</p>
                {a.body && <p className="text-slate-500 text-xs mt-0.5">{a.body}</p>}
                <p className="text-slate-500 text-xs mt-1">
                  {optLabel(opts?.ACTIVITY_TYPES, a.type, lang)} · {companyName(a.company, lang)} · {fmtDateTime(a.date)} · {userName(a.createdBy)}
                </p>
              </div>
              <button type="button" title={T.edit} onClick={() => openEdit(a)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
              <button type="button" title={T.delete} onClick={() => remove(a)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? T.edit : T.logActivity}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {(opts?.ACTIVITY_TYPES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.date}><TextInput type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={T.subject} span2><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label={T.company} span2><Select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">{T.none}</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
          </Select></Field>
          <Field label={T.direction}><Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
            <option value="outbound">{T.outbound}</option><option value="inbound">{T.inbound}</option>
          </Select></Field>
          <Field label={T.duration}><TextInput type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} dir="ltr" /></Field>
          <Field label={T.outcome} span2><TextInput value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} /></Field>
          <Field label={T.body} span2><TextArea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
