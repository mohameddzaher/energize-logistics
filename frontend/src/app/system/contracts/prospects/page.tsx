'use client';
// تنشيط الموردين الجدد — the cold-outreach log: companies contacted but not
// yet contracted. Full CRUD + one-click promotion («تحويل إلى مورد») that
// creates the vendor record and stamps the prospect as converted.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { PhoneCall, Plus, ArrowUpRight } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, Modal, Field, TextInput, TextArea, Select,
  PrimaryButton, ErrorNotice, SmallBadge, StatCard,
} from '@/components/hr/HRKit';
import { ContractProspect, canViewContracts, canEditContracts, fmtN, fmtD, foldAr } from '@/lib/contracts';
import { useDialog } from '@/components/system/DialogProvider';

const emptyForm = { companyName: '', contactPerson: '', phone: '', headquarters: '', destinations: '', vehicleType: '', interestStatus: '', contactDate: '', assignedTo: '', notes: '' };

export default function ProspectsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const { confirm, notify } = useDialog();
  const ar = lang === 'ar';
  const router = useRouter();
  const canEdit = canEditContracts(user);

  const [prospects, setProspects] = useState<ContractProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [interestFilter, setInterestFilter] = useState<'' | 'interested' | 'not' | 'converted'>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContractProspect | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ prospects: ContractProspect[] }>('/api/contracts/prospects');
      setProspects(d.prospects || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  const filtered = useMemo(() => prospects.filter((p) => {
    if (interestFilter === 'interested' && !(p.isInterested === true && !p.convertedVendor)) return false;
    if (interestFilter === 'not' && !(p.isInterested === false && !p.convertedVendor)) return false;
    if (interestFilter === 'converted' && !p.convertedVendor) return false;
    const s = foldAr(q.trim());
    if (!s) return true;
    return [p.companyName, p.contactPerson, p.phone, p.headquarters, p.vehicleType, p.assignedTo].some((x) => foldAr(String(x || '')).includes(s));
  }), [prospects, q, interestFilter]);

  const openNew = () => { setEditing(null); setForm({ ...emptyForm, contactDate: new Date().toISOString().slice(0, 10) }); setShowForm(true); };
  const openEdit = (p: ContractProspect) => {
    setEditing(p);
    setForm({ ...emptyForm, ...p, contactDate: p.contactDate ? new Date(p.contactDate).toISOString().slice(0, 10) : '' });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.companyName.trim() || saving) return;
    setSaving(true);
    try {
      const body = { ...form, isInterested: form.interestStatus === 'مهتم' ? true : form.interestStatus === 'غير مهتم' ? false : null, contactDate: form.contactDate || null };
      delete body._id; delete body.convertedVendor;
      if (editing) await api.patch(`/api/contracts/prospects/${editing._id}`, body);
      else await api.post('/api/contracts/prospects', body);
      setShowForm(false);
      await load();
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
    setSaving(false);
  };

  const remove = async (p: ContractProspect) => {
    if (!(await confirm(ar ? `حذف «${p.companyName}» من سجل التنشيط؟` : 'Delete prospect?'))) return;
    try { await api.delete(`/api/contracts/prospects/${p._id}`); await load(); }
    catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  };

  const convert = async (p: ContractProspect) => {
    if (!(await confirm(ar ? `تحويل «${p.companyName}» إلى مورد في السجل الرسمي؟` : 'Convert to vendor?'))) return;
    try {
      const d = await api.post<{ vendor: { _id: string } }>(`/api/contracts/prospects/${p._id}/convert`, {});
      router.push(`/system/contracts/vendors/${d.vendor._id}`);
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  };

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const counts = {
    all: prospects.length,
    interested: prospects.filter((p) => p.isInterested === true && !p.convertedVendor).length,
    not: prospects.filter((p) => p.isInterested === false && !p.convertedVendor).length,
    converted: prospects.filter((p) => p.convertedVendor).length,
  };

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<PhoneCall className="w-7 h-7 text-cyan-700" />}
        title={ar ? 'تنشيط الموردين الجدد' : 'Prospect Outreach'}
        subtitle={ar ? 'شركات تم التواصل معها ولم تتعاقد بعد — تابعها ثم حوّل المهتم منها إلى مورد بضغطة' : 'Contacted, not yet contracted'}
      >
        {canEdit && <PrimaryButton onClick={openNew}><span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{ar ? 'إضافة شركة' : 'Add prospect'}</span></PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          { key: '', label: ar ? 'الكل' : 'All', count: counts.all, cls: 'text-slate-700' },
          { key: 'interested', label: ar ? 'مهتم' : 'Interested', count: counts.interested, cls: 'text-emerald-600' },
          { key: 'not', label: ar ? 'غير مهتم' : 'Not interested', count: counts.not, cls: 'text-red-600' },
          { key: 'converted', label: ar ? 'تحوّل إلى مورد' : 'Converted', count: counts.converted, cls: 'text-cyan-700' },
        ] as const).map((c) => (
          <button key={c.key} onClick={() => setInterestFilter(interestFilter === c.key ? '' : c.key as any)}
            className={`bg-white rounded-xl border px-3 py-2.5 text-start shadow-sm ${interestFilter === c.key ? 'border-cyan-600 ring-1 ring-cyan-600/40' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="text-[11px] font-medium text-slate-500">{c.label}</div>
            <div className={`text-xl font-bold tabular-nums ${c.cls}`}>{fmtN(c.count)}</div>
          </button>
        ))}
      </div>

      <div className="max-w-md"><SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو المقر أو الجوال…' : 'Search…'} /></div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{ar ? 'اسم الشركة' : 'Company'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'جهة الاتصال' : 'Contact'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الجوال' : 'Phone'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'المقر' : 'HQ'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'نوع السيارات' : 'Vehicles'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'الاهتمام' : 'Interest'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'تاريخ التواصل' : 'Contacted'}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-slate-800">{p.companyName}</span>
                    {p.notes && <p className="text-[11px] text-slate-400 mt-0.5 max-w-72 line-clamp-2">{p.notes}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{p.contactPerson || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 tabular-nums" dir="ltr">{p.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{p.headquarters || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs">{p.vehicleType || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {p.convertedVendor
                      ? <SmallBadge bg="bg-cyan-100" text="text-cyan-700" label={ar ? 'تحوّل إلى مورد' : 'Converted'} />
                      : p.isInterested === true
                        ? <SmallBadge bg="bg-emerald-100" text="text-emerald-700" label={p.interestStatus || (ar ? 'مهتم' : 'Interested')} />
                        : p.isInterested === false
                          ? <SmallBadge bg="bg-red-100" text="text-red-700" label={p.interestStatus || (ar ? 'غير مهتم' : 'Not interested')} />
                          : <SmallBadge bg="bg-slate-100" text="text-slate-600" label={p.interestStatus || (ar ? 'قيد المتابعة' : 'Following up')} />}
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-500 tabular-nums">{fmtD(p.contactDate)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2 text-xs font-medium">
                      {canEdit && !p.convertedVendor && (
                        <button onClick={() => convert(p)} className="inline-flex items-center gap-0.5 text-emerald-600 hover:text-emerald-800 font-semibold">
                          <ArrowUpRight className="w-3.5 h-3.5" />{ar ? 'تحويل إلى مورد' : 'Convert'}
                        </button>
                      )}
                      {canEdit && <button onClick={() => openEdit(p)} className="text-slate-500 hover:text-slate-800">{ar ? 'تعديل' : 'Edit'}</button>}
                      {canEdit && <button onClick={() => remove(p)} className="text-red-500 hover:text-red-700">{ar ? 'حذف' : 'Delete'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-10">{ar ? 'لا توجد شركات مطابقة' : 'No matches'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? (ar ? 'تعديل شركة' : 'Edit prospect') : (ar ? 'إضافة شركة للتنشيط' : 'Add prospect')} wide
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={save} disabled={!form.companyName.trim() || saving}>{editing ? (ar ? 'حفظ' : 'Save') : (ar ? 'إضافة' : 'Add')}</PrimaryButton>
          </div>
        }>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'اسم الشركة *' : 'Company *'} span2><TextInput value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
          <Field label={ar ? 'جهة الاتصال' : 'Contact'}><TextInput value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'المقر' : 'HQ'}><TextInput value={form.headquarters} onChange={(e) => setForm({ ...form, headquarters: e.target.value })} /></Field>
          <Field label={ar ? 'نوع السيارات' : 'Vehicle type'}><TextInput value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} /></Field>
          <Field label={ar ? 'الوجهات' : 'Destinations'} span2><TextInput value={form.destinations} onChange={(e) => setForm({ ...form, destinations: e.target.value })} /></Field>
          <Field label={ar ? 'حالة الاهتمام' : 'Interest'}>
            <Select value={form.interestStatus} onChange={(e) => setForm({ ...form, interestStatus: e.target.value })}>
              <option value="">{ar ? 'قيد المتابعة' : 'Following up'}</option>
              <option value="مهتم">{ar ? 'مهتم' : 'Interested'}</option>
              <option value="غير مهتم">{ar ? 'غير مهتم' : 'Not interested'}</option>
            </Select>
          </Field>
          <Field label={ar ? 'تاريخ التواصل' : 'Contact date'}><TextInput type="date" value={form.contactDate} onChange={(e) => setForm({ ...form, contactDate: e.target.value })} /></Field>
          <Field label={ar ? 'المتابع' : 'Assigned to'}><TextInput value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
