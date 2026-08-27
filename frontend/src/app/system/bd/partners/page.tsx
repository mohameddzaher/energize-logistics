'use client';
// Partners & alliances tracked by Business Development: carriers, overseas
// agents, technology vendors, government bodies and associations — from first
// contact through to a signed agreement.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Handshake, Plus, Edit, Trash2 } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  canViewBd, canEditBd, BdPartner, PARTNER_TYPE, PARTNER_STATUS,
  labelOf, optionsOf, bdName, userName, fmtDate, toDateInput,
  listToText, textToList,
} from '@/lib/bd';

const EMPTY = {
  name: '', nameAr: '', type: 'carrier', status: 'prospect',
  country: '', city: '', website: '',
  contactName: '', contactEmail: '', contactPhone: '',
  agreementStart: '', agreementEnd: '',
  services: '', description: '', notes: '', ownerName: '',
};

export default function BdPartnersPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const canEdit = canEditBd(user);

  const [rows, setRows] = useState<BdPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BdPartner | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (status) qs.set('status', status);
      const d = await api.get<{ partners: BdPartner[] }>(`/api/business-development/partners?${qs}`);
      setRows(d.partners || []);
    } catch { /* keep the last good render */ }
    setLoading(false);
  }, [search, status]);

  // Debounced: one request after typing pauses, not one per keystroke.
  useEffect(() => {
    const h = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(h);
  }, [load]);
  useSocket('bd:updated', useCallback(() => { load(); }, [load]));

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.status] = (m[r.status] || 0) + 1; });
    return m;
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, ownerName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() });
    setShowModal(true);
  };
  const openEdit = (r: BdPartner) => {
    setEditing(r);
    setForm({
      ...EMPTY, ...r,
      agreementStart: toDateInput(r.agreementStart),
      agreementEnd: toDateInput(r.agreementEnd),
      services: listToText(r.services),
      ownerName: r.ownerName || '',
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!String(form.name || '').trim()) { notify(ar ? 'الاسم مطلوب' : 'Name is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, services: textToList(form.services) };
      if (editing) await api.put(`/api/business-development/partners/${editing._id}`, payload);
      else await api.post('/api/business-development/partners', payload);
      setShowModal(false);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (r: BdPartner) => {
    if (!(await confirm(ar ? 'تأكيد الحذف؟' : 'Delete this partner?'))) return;
    try { await api.delete(`/api/business-development/partners/${r._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', transform: (_v, r) => bdName(r, lang) },
    { header: ar ? 'النوع' : 'Type', key: 'type', transform: (v) => labelOf(PARTNER_TYPE, v, lang) },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => labelOf(PARTNER_STATUS, v, lang) },
    { header: ar ? 'الدولة' : 'Country', key: 'country' },
    { header: ar ? 'المدينة' : 'City', key: 'city' },
    { header: ar ? 'جهة الاتصال' : 'Contact', key: 'contactName' },
    { header: ar ? 'البريد' : 'Email', key: 'contactEmail' },
    { header: ar ? 'الهاتف' : 'Phone', key: 'contactPhone' },
    { header: ar ? 'بداية الاتفاقية' : 'Agreement start', key: 'agreementStart' },
    { header: ar ? 'نهاية الاتفاقية' : 'Agreement end', key: 'agreementEnd' },
    { header: ar ? 'الخدمات' : 'Services', key: 'services', transform: (v) => (v || []).join(', ') },
    { header: ar ? 'المسؤول' : 'Owner', key: 'ownerName', transform: (v, r) => v || userName(r.owner) },
  ];
  // الفلترة على الخادم: ما في الذاكرة هو حصيلة البحث والحالة، لا السجلّ كلّه.
  // ومَن أراد الكلّ كان عليه أن يمسح فلاتره أوّلًا ويعيد التصدير، فنُعيد النداء
  // بلا معاملاتٍ نيابةً عنه حتى لا يخرج بملفٍّ ناقصٍ يحسبه كاملًا.
  const fetchAllForExport = async () => {
    const d = await api.get<{ partners: BdPartner[] }>('/api/business-development/partners');
    return [{ name: 'Partners', rows: d.partners || [], columns: exportColumns }];
  };
  const hasActiveFilters = !!(search.trim() || status);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: hasActiveFilters ? scope.shown : scope.all, sheets: [{ name: 'Partners', rows, columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!canViewBd(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Handshake className="w-5 h-5" />}
        title={ar ? 'الشراكات والتحالفات' : 'Partners & alliances'}
        subtitle={`${rows.length} ${ar ? 'شريك' : 'partners'}`}
      >
        <div className="w-56"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث…' : 'Search…'} /></div>
        <ExportMenu fileName="bd-partners" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير' : 'Export'} options={exportOptions} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'شريك جديد' : 'New partner'}</PrimaryButton>}
      </PageHeader>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatus('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${status === '' ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
          {ar ? 'الكل' : 'All'} ({rows.length})
        </button>
        {Object.keys(PARTNER_STATUS).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${status === s ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
            {labelOf(PARTNER_STATUS, s, lang)}{status === '' ? ` (${statusCounts[s] || 0})` : ''}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الشريك' : 'Partner'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النوع' : 'Type'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الموقع' : 'Location'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'جهة الاتصال' : 'Contact'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الاتفاقية' : 'Agreement'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المسؤول' : 'Owner'}</th>
                {canEdit && <th className="px-4 py-3 text-end font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const ty = PARTNER_TYPE[r.type];
                const stl = PARTNER_STATUS[r.status];
                return (
                  <tr key={r._id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="text-slate-900 font-medium">{bdName(r, lang)}</p>
                      {r.services && r.services.length > 0 && (
                        <p className="text-slate-500 text-xs">{r.services.join('، ')}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">{ty && <SmallBadge bg={ty.bg} text={ty.text} label={ar ? ty.ar : ty.en} />}</td>
                    <td className="px-4 py-3">{stl && <SmallBadge bg={stl.bg} text={stl.text} label={ar ? stl.ar : stl.en} />}</td>
                    <td className="px-4 py-3 text-slate-600">{[r.city, r.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{r.contactName || '—'}</p>
                      <p className="text-slate-500 text-xs" dir="ltr">{r.contactPhone || r.contactEmail || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.agreementStart || r.agreementEnd
                        ? `${fmtDate(r.agreementStart)} → ${fmtDate(r.agreementEnd)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.ownerName || userName(r.owner)}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" title={ar ? 'تعديل' : 'Edit'} onClick={() => openEdit(r)}
                            className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
                          <button type="button" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(r)}
                            className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} className="px-4 py-12 text-center text-slate-400">
                  {ar ? 'لا يوجد شركاء' : 'No partners'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل الشريك' : 'Edit partner') : (ar ? 'شريك جديد' : 'New partner')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'}>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={ar ? 'الاسم (عربي)' : 'Name (Arabic)'}>
            <TextInput value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          </Field>
          <Field label={ar ? 'النوع' : 'Type'}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {optionsOf(PARTNER_TYPE, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {optionsOf(PARTNER_STATUS, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الدولة' : 'Country'}>
            <TextInput value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </Field>
          <Field label={ar ? 'المدينة' : 'City'}>
            <TextInput value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label={ar ? 'الموقع الإلكتروني' : 'Website'} span2>
            <TextInput dir="ltr" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </Field>
          <Field label={ar ? 'اسم جهة الاتصال' : 'Contact name'}>
            <TextInput value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </Field>
          <Field label={ar ? 'المسؤول' : 'Owner'}>
            <TextInput value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label={ar ? 'البريد الإلكتروني' : 'Contact email'}>
            <TextInput type="email" dir="ltr" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </Field>
          <Field label={ar ? 'الهاتف' : 'Contact phone'}>
            <TextInput dir="ltr" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </Field>
          <Field label={ar ? 'بداية الاتفاقية' : 'Agreement start'}>
            <TextInput type="date" value={form.agreementStart} onChange={(e) => setForm({ ...form, agreementStart: e.target.value })} />
          </Field>
          <Field label={ar ? 'نهاية الاتفاقية' : 'Agreement end'}>
            <TextInput type="date" value={form.agreementEnd} onChange={(e) => setForm({ ...form, agreementEnd: e.target.value })} />
          </Field>
          <Field label={ar ? 'الخدمات (مفصولة بفواصل)' : 'Services (comma separated)'} span2>
            <TextInput value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} />
          </Field>
          <Field label={ar ? 'الوصف' : 'Description'} span2>
            <TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
