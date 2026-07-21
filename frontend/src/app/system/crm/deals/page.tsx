'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { TrendingUp, Plus, Trash2, Edit } from 'lucide-react';
import {
  isCrmStaff, isCrmAdmin, CrmDeal, CrmCompany, CrmOptions, companyName, userName, money, fmtDate,
} from '@/lib/crm';
import {
  Spinner, PageHeader, PrimaryButton, SearchInput, Modal, Field, TextInput, TextArea, Select,
} from '@/components/crm/CrmKit';

const EMPTY = { title: '', company: '', stage: 'new', value: 0, currency: 'SAR', probability: 0, expectedCloseDate: '', owner: '', source: '', notes: '' };

export default function CrmDealsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);

  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmDeal | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const canDelete = isCrmAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      const d = await api.get<{ deals: CrmDeal[] }>(`/api/crm/deals?${qs}`);
      setDeals(d.deals || []);
    } catch { /* */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {});
    api.get<{ companies: CrmCompany[] }>('/api/crm/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  useSocket('crm:deal', useCallback(() => load(), [load]));

  const stages = opts?.PIPELINE_STAGES || [];

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, owner: user?._id || '' }); setShowModal(true); };
  const openEdit = (d: CrmDeal) => {
    setEditing(d);
    setForm({ ...EMPTY, ...d, expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate).toISOString().slice(0, 10) : '',
      company: typeof d.company === 'object' ? d.company?._id : (d.company || ''),
      owner: typeof d.owner === 'object' ? d.owner?._id : (d.owner || '') });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) { notify(ar ? 'العنوان مطلوب' : 'Title required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, value: Number(form.value) || 0, probability: Number(form.probability) || 0,
        company: form.company || undefined, owner: form.owner || undefined, expectedCloseDate: form.expectedCloseDate || undefined };
      if (editing) await api.put(`/api/crm/deals/${editing._id}`, payload);
      else await api.post('/api/crm/deals', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (d: CrmDeal) => {
    if (!(await confirm(T.confirmDelete))) return;
    try { await api.delete(`/api/crm/deals/${d._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const moveTo = async (dealId: string, stage: string) => {
    // optimistic
    setDeals((prev) => prev.map((d) => d._id === dealId ? { ...d, stage } : d));
    try { await api.patch(`/api/crm/deals/${dealId}/move`, { stage }); load(); } catch (e: any) { notify(e.message, 'error'); load(); }
  };

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<TrendingUp className="w-5 h-5" />} title={T.deals} subtitle={`${deals.length} · ${money(deals.filter((d) => d.status === 'open').reduce((s, d) => s + (d.value || 0), 0))}`}>
        <div className="w-48"><SearchInput value={search} onChange={setSearch} placeholder={T.search} /></div>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {T.addDeal}</PrimaryButton>
      </PageHeader>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((st) => {
          const col = deals.filter((d) => d.stage === st.key);
          const colVal = col.reduce((s, d) => s + (d.value || 0), 0);
          return (
            <div key={st.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId) moveTo(dragId, st.key); setDragId(null); }}
              className="shrink-0 w-72 bg-slate-50 border border-slate-200 rounded-xl flex flex-col">
              <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color }} />
                  <span className="text-slate-900 text-sm font-semibold">{ar ? st.nameAr : st.nameEn}</span>
                  <span className="text-slate-500 text-xs">{col.length}</span>
                </div>
                <span className="text-slate-500 text-xs">{money(colVal)}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {col.map((d) => (
                  <div key={d._id} draggable onDragStart={() => setDragId(d._id)} onDragEnd={() => setDragId(null)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-3 cursor-move hover:border-[#f37121]/50 group">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-900 text-sm font-medium">{d.title}</p>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" title={T.edit} onClick={() => openEdit(d)} className="text-blue-600 hover:text-blue-700"><Edit className="w-3.5 h-3.5" /></button>
                        {canDelete && <button type="button" title={T.delete} onClick={() => remove(d)} className="text-red-600 hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </div>
                    <p className="text-slate-500 text-xs mt-1">{companyName(d.company, lang)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-green-600 text-sm font-medium">{money(d.value, d.currency)}</span>
                      <span className="text-slate-500 text-xs">{userName(d.owner)}</span>
                    </div>
                    {d.expectedCloseDate && <p className="text-slate-600 text-[11px] mt-1">{fmtDate(d.expectedCloseDate)}</p>}
                  </div>
                ))}
                {col.length === 0 && <p className="text-slate-600 text-xs text-center py-4">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? T.edit : T.addDeal}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? T.saving : T.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={T.dealTitle} span2><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label={T.company} span2><Select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">{T.none}</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
          </Select></Field>
          <Field label={T.stage}><Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {stages.map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.value}><TextInput type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} dir="ltr" /></Field>
          <Field label={T.probability}><TextInput type="number" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} dir="ltr" /></Field>
          <Field label={T.expectedClose}><TextInput type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} /></Field>
          <Field label={T.owner}><Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
            <option value="">—</option>
            {(opts?.owners || []).map((o) => <option key={o._id} value={o._id}>{o.firstName} {o.lastName}</option>)}
          </Select></Field>
          <Field label={T.source}><Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="">—</option>
            {(opts?.SOURCES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
          </Select></Field>
          <Field label={T.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
