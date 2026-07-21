'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { ArrowLeft, Building2, Plus, Trash2, Star, Phone, MapPin, Pencil } from 'lucide-react';
import {
  isCrmStaff, isCrmAdmin, CrmCompany, CrmContact, CrmActivity, CrmTask, CrmDeal, CrmOptions,
  COMPANY_STATUS_STYLE, DEAL_STATUS_STYLE, TASK_STATUS_STYLE, PRIORITY_STYLE, optLabel,
  companyName, contactName, userName, money, fmtDate, fmtDateTime, toDateInput,
} from '@/lib/crm';
import {
  Spinner, PageHeader, PrimaryButton, Badge, Modal, Tabs,
  Field, TextInput, TextArea, Select, StarRating, ContactButtons,
} from '@/components/crm/CrmKit';
import ManagedSelect from '@/components/system/ManagedSelect';

export default function CrmCompanyDetailPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');

  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  // generic modal: which entity is being added
  const [modal, setModal] = useState<null | 'contact' | 'activity' | 'task' | 'deal'>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  // In-place company edit (so you can fix the email/phone/… without going back).
  const [editingCompany, setEditingCompany] = useState(false);
  const [cForm, setCForm] = useState<any>({});
  const [savingCompany, setSavingCompany] = useState(false);

  const canDelete = isCrmAdmin(user?.role);
  const canEdit = isCrmStaff(user?.role);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<{ company: CrmCompany; contacts: CrmContact[]; activities: CrmActivity[]; tasks: CrmTask[]; deals: CrmDeal[] }>(`/api/crm/companies/${id}`);
      setCompany(d.company); setContacts(d.contacts || []); setActivities(d.activities || []); setTasks(d.tasks || []); setDeals(d.deals || []);
    } catch { /* */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {}); }, []);
  const reload = useCallback(() => load(), [load]);
  useSocket('crm:company', reload); useSocket('crm:contact', reload);
  useSocket('crm:activity', reload); useSocket('crm:task', reload); useSocket('crm:deal', reload);

  const openModal = (kind: 'contact' | 'activity' | 'task' | 'deal') => {
    if (kind === 'contact') setForm({ firstName: '', lastName: '', title: '', phone: '', whatsapp: '', mobile: '', email: '', isPrimary: false });
    if (kind === 'activity') setForm({ type: 'call', subject: '', body: '', outcome: '', direction: 'outbound', date: new Date().toISOString().slice(0, 16) });
    if (kind === 'task') setForm({ title: '', priority: 'medium', status: 'todo', dueDate: '', assignedTo: user?._id || '' });
    if (kind === 'deal') setForm({ title: '', stage: 'new', value: 0, currency: 'SAR', expectedCloseDate: '' });
    setModal(kind);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (modal === 'contact') {
        if (!form.firstName?.trim()) throw new Error(ar ? 'الاسم مطلوب' : 'First name required');
        await api.post('/api/crm/contacts', { ...form, company: id });
      } else if (modal === 'activity') {
        if (!form.subject?.trim()) throw new Error(ar ? 'الموضوع مطلوب' : 'Subject required');
        await api.post('/api/crm/activities', { ...form, company: id, date: form.date ? new Date(form.date) : undefined });
      } else if (modal === 'task') {
        if (!form.title?.trim()) throw new Error(ar ? 'العنوان مطلوب' : 'Title required');
        await api.post('/api/crm/tasks', { ...form, company: id, dueDate: form.dueDate || undefined });
      } else if (modal === 'deal') {
        if (!form.title?.trim()) throw new Error(ar ? 'العنوان مطلوب' : 'Title required');
        await api.post('/api/crm/deals', { ...form, company: id, value: Number(form.value) || 0, expectedCloseDate: form.expectedCloseDate || undefined });
      }
      setModal(null); load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const delItem = async (kind: string, itemId: string) => {
    if (!(await confirm(T.confirmDelete))) return;
    try { await api.delete(`/api/crm/${kind}/${itemId}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const rate = async (v: number) => { try { await api.patch(`/api/crm/companies/${id}/rate`, { rating: v }); load(); } catch (e: any) { notify(e.message, 'error'); } };

  const openEditCompany = () => {
    setCForm({
      name: company?.name || '', arabicName: company?.arabicName || '', status: company?.status || 'lead', type: company?.type || 'customer',
      rating: company?.rating || 0, score: company?.score || 0, industry: company?.industry || '', size: company?.size || '',
      website: company?.website || '', phone: company?.phone || '', whatsapp: company?.whatsapp || '', email: company?.email || '',
      address: company?.address || '', city: company?.city || '', country: company?.country || '', source: company?.source || '',
      tags: (company?.tags || []).join(', '), notes: company?.notes || '',
    });
    setEditingCompany(true);
  };
  const saveCompany = async () => {
    if (!cForm.name?.trim()) { notify(ar ? 'الاسم مطلوب' : 'Name is required'); return; }
    setSavingCompany(true);
    try {
      const payload = {
        ...cForm,
        rating: Number(cForm.rating) || 0,
        score: Number(cForm.score) || 0,
        tags: String(cForm.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
      };
      await api.put(`/api/crm/companies/${id}`, payload);
      setEditingCompany(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSavingCompany(false); }
  };

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;
  if (!company) return <div className="text-slate-500 p-8">{T.noResults}</div>;

  const tabs = [
    { key: 'overview', label: T.overview },
    { key: 'contacts', label: `${T.contacts} (${contacts.length})` },
    { key: 'activities', label: `${T.activities} (${activities.length})` },
    { key: 'tasks', label: `${T.tasks} (${tasks.length})` },
    { key: 'deals', label: `${T.deals} (${deals.length})` },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.push('/system/crm/companies')} className="flex items-center gap-1 text-slate-500 hover:text-slate-900 text-sm">
        <ArrowLeft className="w-4 h-4" /> {T.companies}
      </button>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]"><Building2 className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{companyName(company, lang)}</h1>
              <div className="flex items-center flex-wrap gap-2 mt-1">
                <Badge style={COMPANY_STATUS_STYLE[company.status]} lang={lang} />
                <span className="text-slate-500 text-sm">{optLabel(opts?.COMPANY_TYPES, company.type, lang)}</span>
                {company.industry && <span className="text-slate-500 text-sm">· {optLabel(opts?.INDUSTRIES, company.industry, lang)}</span>}
              </div>
              <div className="mt-2"><StarRating value={company.rating || 0} size={18} onChange={rate} /></div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {canEdit && (
              <button type="button" onClick={openEditCompany} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010]">
                <Pencil className="w-4 h-4" /> {ar ? 'تعديل' : 'Edit'}
              </button>
            )}
            <ContactButtons phone={company.phone} whatsapp={company.whatsapp} email={company.email} website={company.website} size={18} />
            <div className="text-slate-500 text-sm space-y-0.5 text-end">
              {company.phone && <div dir="ltr">{company.phone}</div>}
              {company.email && <div dir="ltr">{company.email}</div>}
              {(company.city || company.country) && <div className="flex items-center gap-1 justify-end"><MapPin className="w-3 h-3" /> {[company.city, company.country].filter(Boolean).join(', ')}</div>}
              {company.linkedCustomer && <div className="text-[#f37121] text-xs">🔗 {typeof company.linkedCustomer === 'object' ? company.linkedCustomer.companyName : ''}</div>}
            </div>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 text-sm shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-2">{T.details}</h3>
            <Row label={T.owner} value={userName(company.owner)} />
            <Row label={T.source} value={optLabel(opts?.SOURCES, company.source, lang)} />
            <Row label={T.size} value={optLabel(opts?.COMPANY_SIZES, company.size, lang)} />
            <Row label={T.score} value={String(company.score ?? 0)} />
            <Row label={T.website} value={company.website || '—'} />
            <Row label={T.address} value={company.address || '—'} />
            <Row label={T.tags} value={(company.tags || []).join(', ') || '—'} />
            {company.notes && <div className="pt-2 border-t border-slate-200/70"><p className="text-slate-500 text-xs mb-1">{T.notes}</p><p className="text-slate-800">{company.notes}</p></div>}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3"><Phone className="w-4 h-4 text-[#f37121]" /> {T.recentActivity}</h3>
              <PrimaryButton onClick={() => openModal('activity')}><Plus className="w-4 h-4" /> {T.logActivity}</PrimaryButton>
            </div>
            <div className="space-y-2">
              {activities.slice(0, 6).map((a) => (
                <div key={a._id} className="border-b border-slate-200/70 pb-2">
                  <p className="text-slate-800 text-sm">{a.subject}</p>
                  <p className="text-slate-500 text-xs">{optLabel(opts?.ACTIVITY_TYPES, a.type, lang)} · {fmtDateTime(a.date)}</p>
                </div>
              ))}
              {activities.length === 0 && <p className="text-slate-500 text-sm">{T.noActivity}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Contacts */}
      {tab === 'contacts' && (
        <Section title={T.contacts} onAdd={() => openModal('contact')} addLabel={T.addContact}>
          {contacts.length === 0 ? <Empty t={T.noResults} /> : contacts.map((c) => (
            <div key={c._id} className="flex items-center justify-between bg-slate-100 rounded-lg px-4 py-3">
              <div>
                <p className="text-slate-900 text-sm font-medium flex items-center gap-2">{contactName(c, lang)} {c.isPrimary && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-700" />}</p>
                <p className="text-slate-500 text-xs">{[c.title, c.department].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <div className="flex items-center gap-3">
                <ContactButtons phone={c.phone || c.mobile} whatsapp={c.whatsapp} email={c.email} />
                <button onClick={() => delItem('contacts', c._id)} type="button" title={T.delete} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Activities */}
      {tab === 'activities' && (
        <Section title={T.activities} onAdd={() => openModal('activity')} addLabel={T.logActivity}>
          {activities.length === 0 ? <Empty t={T.noActivity} /> : activities.map((a) => (
            <div key={a._id} className="flex items-start justify-between bg-slate-100 rounded-lg px-4 py-3">
              <div>
                <p className="text-slate-900 text-sm font-medium">{a.subject}</p>
                {a.body && <p className="text-slate-500 text-xs mt-0.5">{a.body}</p>}
                <p className="text-slate-500 text-xs mt-1">{optLabel(opts?.ACTIVITY_TYPES, a.type, lang)} · {fmtDateTime(a.date)} · {userName(a.createdBy)}</p>
              </div>
              <button onClick={() => delItem('activities', a._id)} type="button" title={T.delete} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </Section>
      )}

      {/* Tasks */}
      {tab === 'tasks' && (
        <Section title={T.tasks} onAdd={() => openModal('task')} addLabel={T.addTask}>
          {tasks.length === 0 ? <Empty t={T.noResults} /> : tasks.map((t) => (
            <div key={t._id} className="flex items-center justify-between bg-slate-100 rounded-lg px-4 py-3">
              <div>
                <p className="text-slate-900 text-sm font-medium">{t.title}</p>
                <p className="text-slate-500 text-xs">{t.dueDate ? fmtDate(t.dueDate) : '—'} · {userName(t.assignedTo)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge style={PRIORITY_STYLE[t.priority]} lang={lang} />
                <Badge style={TASK_STATUS_STYLE[t.status]} lang={lang} />
                <button onClick={() => delItem('tasks', t._id)} type="button" title={T.delete} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Deals */}
      {tab === 'deals' && (
        <Section title={T.deals} onAdd={() => openModal('deal')} addLabel={T.addDeal}>
          {deals.length === 0 ? <Empty t={T.noResults} /> : deals.map((d) => (
            <div key={d._id} className="flex items-center justify-between bg-slate-100 rounded-lg px-4 py-3">
              <div>
                <p className="text-slate-900 text-sm font-medium">{d.title}</p>
                <p className="text-slate-500 text-xs">{optLabel(opts?.PIPELINE_STAGES, d.stage, lang)} · {fmtDate(d.expectedCloseDate)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-green-600 text-sm font-medium">{money(d.value, d.currency)}</span>
                <Badge style={DEAL_STATUS_STYLE[d.status]} lang={lang} />
                <button onClick={() => delItem('deals', d._id)} type="button" title={T.delete} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Add modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'contact' ? T.addContact : modal === 'activity' ? T.logActivity : modal === 'task' ? T.addTask : T.addDeal}
        footer={<><button onClick={() => setModal(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {modal === 'contact' && <>
            <Field label={T.firstName}><TextInput value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label={T.lastName}><TextInput value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            <Field label={T.title}><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={T.phone}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
            <Field label={T.whatsapp}><TextInput value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} dir="ltr" /></Field>
            <Field label={T.email}><TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
            <Field label={T.primaryContact} span2><label className="flex items-center gap-2 text-slate-700 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> {T.primary}</label></Field>
          </>}
          {modal === 'activity' && <>
            <Field label={T.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {(opts?.ACTIVITY_TYPES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
            </Select></Field>
            <Field label={T.date}><TextInput type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={T.subject} span2><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label={T.direction}><Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="outbound">{T.outbound}</option><option value="inbound">{T.inbound}</option>
            </Select></Field>
            <Field label={T.outcome}><TextInput value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} /></Field>
            <Field label={T.body} span2><TextArea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          </>}
          {modal === 'task' && <>
            <Field label={T.taskTitle} span2><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={T.dueDate}><TextInput type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label={T.priority}><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {(opts?.TASK_PRIORITIES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
            </Select></Field>
            <Field label={T.assignedTo} span2><Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              {(opts?.owners || []).map((o) => <option key={o._id} value={o._id}>{o.firstName} {o.lastName}</option>)}
            </Select></Field>
          </>}
          {modal === 'deal' && <>
            <Field label={T.dealTitle} span2><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={T.stage}><Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {(opts?.PIPELINE_STAGES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
            </Select></Field>
            <Field label={T.value}><TextInput type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} dir="ltr" /></Field>
            <Field label={T.expectedClose} span2><TextInput type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} /></Field>
          </>}
        </div>
      </Modal>

      {/* Edit company modal — in-place editing from the detail page */}
      <Modal open={editingCompany} onClose={() => setEditingCompany(false)} wide title={ar ? 'تعديل الشركة' : 'Edit Company'}
        footer={<><button onClick={() => setEditingCompany(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={saveCompany} disabled={savingCompany}>{savingCompany ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.name}><TextInput value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} /></Field>
          <Field label={T.arabicName}><TextInput value={cForm.arabicName} onChange={(e) => setCForm({ ...cForm, arabicName: e.target.value })} dir="rtl" /></Field>
          <Field label={T.status}><Select value={cForm.status} onChange={(e) => setCForm({ ...cForm, status: e.target.value })}>
            {['lead', 'prospect', 'active', 'inactive', 'churned'].map((s) => <option key={s} value={s}>{lang === 'ar' ? (COMPANY_STATUS_STYLE[s]?.ar || s) : (COMPANY_STATUS_STYLE[s]?.en || s)}</option>)}
          </Select></Field>
          <Field label={T.type}><ManagedSelect type="crm_company_type" value={cForm.type} onChange={(v) => setCForm({ ...cForm, type: v })} placeholder={T.type} /></Field>
          <Field label={T.industry}><ManagedSelect type="crm_industry" value={cForm.industry} onChange={(v) => setCForm({ ...cForm, industry: v })} placeholder={T.industry} /></Field>
          <Field label={T.size}><ManagedSelect type="crm_company_size" value={cForm.size} onChange={(v) => setCForm({ ...cForm, size: v })} placeholder={T.size} /></Field>
          <Field label={T.source}><ManagedSelect type="crm_source" value={cForm.source} onChange={(v) => setCForm({ ...cForm, source: v })} placeholder={T.source} /></Field>
          <Field label={T.score}><TextInput type="number" value={cForm.score} onChange={(e) => setCForm({ ...cForm, score: e.target.value })} dir="ltr" /></Field>
          <Field label={T.phone}><TextInput value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={T.whatsapp}><TextInput value={cForm.whatsapp} onChange={(e) => setCForm({ ...cForm, whatsapp: e.target.value })} dir="ltr" placeholder="9665XXXXXXXX" /></Field>
          <Field label={T.email}><TextInput type="email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} dir="ltr" /></Field>
          <Field label={T.website}><TextInput value={cForm.website} onChange={(e) => setCForm({ ...cForm, website: e.target.value })} dir="ltr" /></Field>
          <Field label={T.city}><TextInput value={cForm.city} onChange={(e) => setCForm({ ...cForm, city: e.target.value })} /></Field>
          <Field label={T.country}><TextInput value={cForm.country} onChange={(e) => setCForm({ ...cForm, country: e.target.value })} /></Field>
          <Field label={T.tags} span2><TextInput value={cForm.tags} onChange={(e) => setCForm({ ...cForm, tags: e.target.value })} placeholder={T.tagsHint} /></Field>
          <Field label={T.address} span2><TextInput value={cForm.address} onChange={(e) => setCForm({ ...cForm, address: e.target.value })} /></Field>
          <Field label={T.notes} span2><TextArea rows={3} value={cForm.notes} onChange={(e) => setCForm({ ...cForm, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span className="text-slate-500">{label}</span><span className="text-slate-800 text-end">{value}</span></div>;
}
function Section({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{title}</h3>
        <PrimaryButton onClick={onAdd}><Plus className="w-4 h-4" /> {addLabel}</PrimaryButton>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Empty({ t }: { t: string }) { return <p className="text-slate-500 text-sm text-center py-6">{t}</p>; }
