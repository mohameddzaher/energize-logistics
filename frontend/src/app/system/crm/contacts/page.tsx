'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations, getCrmContactsExtraTranslations } from '@/lib/translations';
import { Users, Plus, Edit, Trash2, Star } from 'lucide-react';
import {
  isCrmStaff, CrmContact, CrmCompany, companyName, contactName, exportToExcel, fmt, today,
} from '@/lib/crm';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Modal,
  Field, TextInput, TextArea, Select, StarRating, ContactButtons,
} from '@/components/crm/CrmKit';

const EMPTY = { company: '', firstName: '', lastName: '', arabicName: '', title: '', department: '', email: '', phone: '', mobile: '', whatsapp: '', linkedinUrl: '', isPrimary: false, rating: 0, notes: '' };

export default function CrmContactsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);
  const txx = getCrmContactsExtraTranslations(lang);

  const [items, setItems] = useState<CrmContact[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (companyFilter) qs.set('company', companyFilter);
      const d = await api.get<{ contacts: CrmContact[] }>(`/api/crm/contacts?${qs}`);
      setItems(d.contacts || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, companyFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ companies: CrmCompany[] }>('/api/crm/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  useSocket('crm:contact', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, company: companyFilter }); setShowModal(true); };
  const openEdit = (c: CrmContact) => {
    setEditing(c);
    setForm({ ...EMPTY, ...c, company: typeof c.company === 'object' ? c.company?._id : (c.company || '') });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.firstName.trim()) { notify(ar ? 'الاسم مطلوب' : 'First name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, rating: Number(form.rating) || 0, company: form.company || undefined };
      if (editing) await api.put(`/api/crm/contacts/${editing._id}`, payload);
      else await api.post('/api/crm/contacts', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (c: CrmContact) => {
    if (!(await confirm(T.confirmDelete))) return;
    try { await api.delete(`/api/crm/contacts/${c._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  if (!isCrmStaff(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={T.contacts} subtitle={`${items.length} ${T.contacts}`}>
        <ExportButton label={T.export} onClick={() => exportToExcel(items, [
          { header: T.firstName, key: 'firstName', width: 18 },
          { header: T.lastName, key: 'lastName', width: 18 },
          { header: T.company, key: 'company', transform: (v) => companyName(v), width: 24 },
          { header: txx.colTitle, key: 'title', width: 18 },
          { header: T.phone, key: 'phone', width: 16 },
          { header: T.mobile, key: 'mobile', width: 16 },
          { header: T.email, key: 'email', width: 24 },
          { header: T.primary, key: 'isPrimary', transform: fmt.yesNo, width: 8 },
          { header: txx.colCreated, key: 'createdAt', transform: fmt.date, width: 14 },
        ], `crm-contacts-${today()}`, 'Contacts')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {T.addContact}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={T.search} /></div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="w-full sm:w-52 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{T.companies}</option>
          {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-start">
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.name}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.company}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{T.title}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold">{ar ? 'تواصل' : 'Contact'}</th>
              <th className="px-4 py-3 text-slate-300 font-semibold text-end">{T.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-800">{T.noResults}</td></tr>
            ) : items.map((c) => (
              <tr key={c._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium flex items-center gap-2">{contactName(c, lang)} {c.isPrimary && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-700" />}</td>
                <td className="px-4 py-3 text-slate-700">{companyName(c.company, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{c.title || '—'}</td>
                <td className="px-4 py-3"><ContactButtons phone={c.phone || c.mobile} whatsapp={c.whatsapp} email={c.email} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => openEdit(c)} title={T.edit} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(c)} title={T.delete} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? T.edit : T.addContact}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.company} span2><Select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">{T.none}</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
          </Select></Field>
          <Field label={T.firstName}><TextInput value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label={T.lastName}><TextInput value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label={T.title}><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label={T.department}><TextInput value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
          <Field label={T.phone}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={T.mobile}><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" /></Field>
          <Field label={T.whatsapp}><TextInput value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} dir="ltr" placeholder="9665XXXXXXXX" /></Field>
          <Field label={T.email}><TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
          <Field label={T.rating}><div className="py-2"><StarRating value={Number(form.rating)} size={20} onChange={(v) => setForm({ ...form, rating: v })} /></div></Field>
          <Field label={T.primaryContact}><label className="flex items-center gap-2 text-slate-700 text-sm py-2"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> {T.primary}</label></Field>
          <Field label={T.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
