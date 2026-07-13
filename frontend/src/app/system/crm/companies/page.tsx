'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { Building2, Plus, Edit, Trash2, Eye, Search as SearchIcon } from 'lucide-react';
import {
  isCrmStaff, isCrmAdmin, CrmCompany, CrmOptions, COMPANY_STATUS_STYLE, optLabel,
  companyName, userName, exportToExcel, fmt, today,
} from '@/lib/crm';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, Modal,
  Field, TextInput, TextArea, Select, StarRating, ContactButtons,
} from '@/components/crm/CrmKit';
import ManagedSelect from '@/components/system/ManagedSelect';

const EMPTY = {
  name: '', arabicName: '', status: 'lead', type: 'customer', rating: 0, score: 0,
  industry: '', size: '', website: '', phone: '', whatsapp: '', email: '',
  address: '', city: '', country: '', source: '', tags: '', owner: '', linkedCustomer: '', notes: '',
};

export default function CrmCompaniesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);
  const router = useRouter();

  const [items, setItems] = useState<CrmCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmCompany | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // Logistics-customer link search (hybrid).
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<any[]>([]);
  const [linkedLabel, setLinkedLabel] = useState('');

  const canDelete = isCrmAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (status) qs.set('status', status);
      if (owner) qs.set('owner', owner);
      const d = await api.get<{ companies: CrmCompany[]; total?: number }>(`/api/crm/companies?${qs}`);
      setItems(d.companies || []);
      setTotal(typeof d.total === 'number' ? d.total : (d.companies || []).length);
    } catch { /* */ }
    setLoading(false);
  }, [search, status, owner]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {}); }, []);
  useSocket('crm:company', useCallback(() => load(), [load]));

  // Debounced customer search.
  useEffect(() => {
    if (!custQuery.trim()) { setCustResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api.get<{ customers: any[] }>(`/api/crm/customers-search?q=${encodeURIComponent(custQuery)}`);
        setCustResults(d.customers || []);
      } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [custQuery]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, owner: user?._id || '' });
    setLinkedLabel(''); setCustQuery(''); setCustResults([]);
    setShowModal(true);
  };
  const openEdit = (c: CrmCompany) => {
    setEditing(c);
    setForm({
      ...EMPTY, ...c,
      tags: (c.tags || []).join(', '),
      owner: typeof c.owner === 'object' ? c.owner?._id : (c.owner || ''),
      linkedCustomer: typeof c.linkedCustomer === 'object' ? c.linkedCustomer?._id : (c.linkedCustomer || ''),
    });
    setLinkedLabel(typeof c.linkedCustomer === 'object' && c.linkedCustomer ? c.linkedCustomer.companyName : '');
    setCustQuery(''); setCustResults([]);
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { alert(ar ? 'الاسم مطلوب' : 'Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        rating: Number(form.rating) || 0,
        score: Number(form.score) || 0,
        tags: String(form.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
        owner: form.owner || undefined,
        linkedCustomer: form.linkedCustomer || undefined,
      };
      if (editing) await api.put(`/api/crm/companies/${editing._id}`, payload);
      else await api.post('/api/crm/companies', payload);
      setShowModal(false);
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (c: CrmCompany) => {
    if (!confirm(ar ? `حذف ${companyName(c, lang)}؟ سيتم حذف كل جهات الاتصال والصفقات المرتبطة.` : `Delete ${companyName(c, lang)}? This also removes its contacts, deals, tasks and activities.`)) return;
    try { await api.delete(`/api/crm/companies/${c._id}`); load(); } catch (e: any) { alert(e.message); }
  };

  const rate = async (c: CrmCompany, rating: number) => {
    try { await api.patch(`/api/crm/companies/${c._id}/rate`, { rating }); load(); } catch (e: any) { alert(e.message); }
  };

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Building2 className="w-5 h-5" />} title={T.companies} subtitle={`${total} ${T.companies}`}>
        <ExportButton label={T.export} onClick={() => exportToExcel(items, [
          { header: 'Name', key: 'name', width: 26 },
          { header: 'Arabic Name', key: 'arabicName', width: 22 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Type', key: 'type', width: 12 },
          { header: 'Rating', key: 'rating', width: 8 },
          { header: 'Industry', key: 'industry', width: 16 },
          { header: 'Phone', key: 'phone', width: 16 },
          { header: 'WhatsApp', key: 'whatsapp', width: 16 },
          { header: 'Email', key: 'email', width: 24 },
          { header: 'City', key: 'city', width: 14 },
          { header: 'Owner', key: 'owner', transform: (v) => userName(v), width: 18 },
          { header: 'Created', key: 'createdAt', transform: fmt.date, width: 14 },
        ], `crm-companies-${today()}`, 'Companies')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {T.addCompany}</PrimaryButton>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={T.search} /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{T.allStatuses}</option>
          {(opts?.COMPANY_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{T.allOwners}</option>
          {(opts?.owners || []).map((o) => <option key={o._id} value={o._id}>{o.firstName} {o.lastName}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-start">
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.name}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.status}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.rating}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.industry}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.owner}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{ar ? 'تواصل' : 'Contact'}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold text-end">{T.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-800">{T.noResults}</td></tr>
            ) : items.map((c) => (
              <tr key={c._id} className="hover:bg-slate-100">
                <td className="px-4 py-3">
                  <button onClick={() => router.push(`/system/crm/companies/${c._id}`)} className="text-slate-900 font-medium hover:text-[#f37121]">{companyName(c, lang)}</button>
                  {c.city && <div className="text-slate-700 text-xs">{c.city}</div>}
                </td>
                <td className="px-4 py-3"><Badge style={COMPANY_STATUS_STYLE[c.status]} lang={lang} /></td>
                <td className="px-4 py-3"><StarRating value={c.rating || 0} size={14} onChange={(v) => rate(c, v)} /></td>
                <td className="px-4 py-3 text-slate-700">{optLabel(opts?.INDUSTRIES, c.industry, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{userName(c.owner)}</td>
                <td className="px-4 py-3"><ContactButtons phone={c.phone} whatsapp={c.whatsapp} email={c.email} website={c.website} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => router.push(`/system/crm/companies/${c._id}`)} className="text-slate-700 hover:text-slate-900" title={T.view}><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-700" title={T.edit}><Edit className="w-4 h-4" /></button>
                    {canDelete && <button onClick={() => remove(c)} className="text-red-600 hover:text-red-700" title={T.delete}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? T.edit : T.addCompany}
        footer={<>
          <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.name}><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={T.arabicName}><TextInput value={form.arabicName} onChange={(e) => setForm({ ...form, arabicName: e.target.value })} dir="rtl" /></Field>
          <Field label={T.status}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {(opts?.COMPANY_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.type}><ManagedSelect type="crm_company_type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} placeholder={T.type} /></Field>
          <Field label={T.rating}><div className="py-2"><StarRating value={Number(form.rating)} size={22} onChange={(v) => setForm({ ...form, rating: v })} /></div></Field>
          <Field label={T.industry}><ManagedSelect type="crm_industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} placeholder={T.industry} /></Field>
          <Field label={T.size}><ManagedSelect type="crm_company_size" value={form.size} onChange={(v) => setForm({ ...form, size: v })} placeholder={T.size} /></Field>
          <Field label={T.source}><ManagedSelect type="crm_source" value={form.source} onChange={(v) => setForm({ ...form, source: v })} placeholder={T.source} /></Field>
          <Field label={T.phone}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={T.whatsapp}><TextInput value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} dir="ltr" placeholder="9665XXXXXXXX" /></Field>
          <Field label={T.email}><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
          <Field label={T.website}><TextInput value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} dir="ltr" /></Field>
          <Field label={T.city}><TextInput value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label={T.country}><TextInput value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
          <Field label={T.owner}><Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
            <option value="">—</option>
            {(opts?.owners || []).map((o) => <option key={o._id} value={o._id}>{o.firstName} {o.lastName}</option>)}
          </Select></Field>
          <Field label={T.tags}><TextInput value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder={T.tagsHint} /></Field>
          <Field label={T.address} span2><TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>

          {/* Hybrid: link to a logistics customer */}
          <Field label={T.linkedCustomer} span2>
            {form.linkedCustomer ? (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-800 text-sm">{linkedLabel || T.linkedCustomer}</span>
                <button type="button" onClick={() => { setForm({ ...form, linkedCustomer: '' }); setLinkedLabel(''); }} className="text-red-600 text-xs">{T.noCustomer}</button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder={T.linkCustomer}
                    className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
                </div>
                {custResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg max-h-48 overflow-y-auto">
                    {custResults.map((c) => (
                      <button key={c._id} type="button" onClick={() => { setForm({ ...form, linkedCustomer: c._id }); setLinkedLabel(c.companyName); setCustResults([]); setCustQuery(''); }}
                        className="w-full text-start px-3 py-2 text-sm text-slate-800 hover:bg-slate-100">
                        {c.companyName} {c.phone ? <span className="text-slate-500">· {c.phone}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
          <Field label={T.notes} span2><TextArea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
