'use client';
// سجل موردي 3PL — the 212-vendor master register: search, filter by rep /
// headquarters / contract status, add & edit & delete, click through to the
// full vendor profile. Status cards on top double as filters.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Building2, Plus, Star, ExternalLink } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, Modal, Field, TextInput, TextArea, Select,
  PrimaryButton, ErrorNotice, SmallBadge, SearchableSelect,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ContractVendor, VENDOR_STATUS, canViewContracts, canEditContracts, fmtN, fmtD, foldAr,
} from '@/lib/contracts';
import { useDialog } from '@/components/system/DialogProvider';

const emptyForm = {
  name: '', energizeRep: '', operationsRep: '', vendorType: '', contactPerson: '', phone: '',
  headquarters: '', destinations: '', fleetSize: '', vehicleTypes: '', crNumber: '',
  vendorSideContract: false, ourSideContract: false, documentsReceived: false, missingDocuments: '',
  contractDate: '', paymentTermDays: '30', notes: '',
};

function VendorsPageInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const { confirm, notify } = useDialog();
  const ar = lang === 'ar';
  const params = useSearchParams();

  const canEdit = canEditContracts(user);
  const [vendors, setVendors] = useState<ContractVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'signed' | 'pending' | 'unsigned' | 'missingDocs'>(params?.get('filter') === 'missingDocs' ? 'missingDocs' : '');
  const [repFilter, setRepFilter] = useState('');
  const [hqFilter, setHqFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContractVendor | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vendors: ContractVendor[] }>('/api/contracts/vendors');
      setVendors(d.vendors || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  const reps = useMemo(() => [...new Set(vendors.map((v) => v.energizeRep).filter(Boolean))].sort() as string[], [vendors]);
  const hqs = useMemo(() => [...new Set(vendors.map((v) => v.headquarters).filter(Boolean))].sort() as string[], [vendors]);

  const filtered = useMemo(() => vendors.filter((v) => {
    if (statusFilter === 'missingDocs') { if (!(v.status === 'signed' && !v.documentsReceived)) return false; }
    else if (statusFilter && v.status !== statusFilter) return false;
    if (repFilter && v.energizeRep !== repFilter) return false;
    if (hqFilter && v.headquarters !== hqFilter) return false;
    const s = foldAr(q.trim());
    if (!s) return true;
    return [v.name, v.energizeRep, v.operationsRep, v.contactPerson, v.phone, v.headquarters, v.destinations, v.crNumber]
      .some((x) => foldAr(String(x || '')).includes(s));
  }), [vendors, q, statusFilter, repFilter, hqFilter]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (v: ContractVendor) => {
    setEditing(v);
    setForm({
      ...emptyForm, ...v,
      fleetSize: String(v.fleetSize ?? ''),
      paymentTermDays: String(v.paymentTermDays ?? '30'),
      contractDate: v.contractDate ? new Date(v.contractDate).toISOString().slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const body = {
        ...form,
        fleetSize: Number(form.fleetSize) || 0,
        paymentTermDays: Number(form.paymentTermDays) || 30,
        contractDate: form.contractDate || null,
      };
      delete body._id; delete body.attachments; delete body.profileTables; delete body.status;
      if (editing) await api.patch(`/api/contracts/vendors/${editing._id}`, body);
      else await api.post('/api/contracts/vendors', body);
      setShowForm(false);
      await load();
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
    setSaving(false);
  };

  const remove = async (v: ContractVendor) => {
    if (!(await confirm(ar ? `هل تريد حذف المورد «${v.name}» نهائيًا؟ تاريخه التشغيلي سيبقى محفوظًا.` : `Delete vendor "${v.name}"?`))) return;
    try { await api.delete(`/api/contracts/vendors/${v._id}`); await load(); }
    catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  };

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const counts = {
    all: vendors.length,
    signed: vendors.filter((v) => v.status === 'signed').length,
    pending: vendors.filter((v) => v.status === 'pending').length,
    unsigned: vendors.filter((v) => v.status === 'unsigned').length,
    missingDocs: vendors.filter((v) => v.status === 'signed' && !v.documentsReceived).length,
  };

  const exportColumns: ExportColumn[] = [
    { header: ar ? 'اسم المورد' : 'Vendor', key: 'name', width: 34 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v: string) => ((VENDOR_STATUS as any)[v] ? (ar ? (VENDOR_STATUS as any)[v].ar : (VENDOR_STATUS as any)[v].en) : v), width: 12 },
    { header: ar ? 'مندوب التنشيط' : 'Rep', key: 'energizeRep', width: 12 },
    { header: ar ? 'ممثل المورد' : 'Contact', key: 'contactPerson', width: 16 },
    { header: ar ? 'الجوال' : 'Phone', key: 'phone', width: 14 },
    { header: ar ? 'المقر' : 'HQ', key: 'headquarters', width: 12 },
    { header: ar ? 'عدد السيارات' : 'Fleet', key: 'fleetSize', width: 10 },
    { header: ar ? 'تاريخ العقد' : 'Contract date', key: 'contractDate', transform: (v: string) => fmtD(v), width: 12 },
    { header: ar ? 'الوجهات' : 'Destinations', key: 'destinations', width: 28 },
    { header: ar ? 'المستندات' : 'Docs', key: 'documentsReceived', transform: (v: boolean) => (v ? (ar ? 'مكتملة' : 'complete') : (ar ? 'ناقصة' : 'missing')), width: 10 },
  ];
  // بطاقات الحالة أعلى الصفحة تفلتر الجدول من غير أن يشعر المصدِّر أنّه فلتر،
  // فكان زرُّ التصدير الواحد يعطي الموقّعين وحدهم ويُسمّيه سجلَّ الموردين كلَّه.
  const scope = exportScopeLabels(ar);
  const sheetName = ar ? 'الموردون' : 'Vendors';
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: filtered, columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: vendors, columns: exportColumns }] },
  ];

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Building2 className="w-7 h-7 text-cyan-700" />}
        title={ar ? 'سجل موردي 3PL' : '3PL Vendor Register'}
        subtitle={ar ? `${fmtN(vendors.length)} مورد · ${fmtN(counts.signed)} موقّع · إجمالي أسطول ${fmtN(vendors.reduce((s, v) => s + (v.fleetSize || 0), 0))} سيارة` : `${fmtN(vendors.length)} vendors`}
      >
        <ExportMenu fileName="contract-vendors" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export'} options={exportOptions} />
        {canEdit && (
          <PrimaryButton onClick={openNew}><span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{ar ? 'إضافة مورد' : 'Add vendor'}</span></PrimaryButton>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />}

      {/* Status cards = filters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {([
          { key: '', label: ar ? 'الكل' : 'All', count: counts.all, cls: 'text-slate-700' },
          { key: 'signed', label: ar ? 'موقّع' : 'Signed', count: counts.signed, cls: 'text-emerald-700' },
          { key: 'pending', label: ar ? 'قيد التوقيع' : 'Pending', count: counts.pending, cls: 'text-amber-600' },
          { key: 'unsigned', label: ar ? 'غير موقّع' : 'Unsigned', count: counts.unsigned, cls: 'text-slate-500' },
          { key: 'missingDocs', label: ar ? 'مستندات ناقصة' : 'Missing docs', count: counts.missingDocs, cls: 'text-red-600' },
        ] as const).map((c) => (
          <button key={c.key} onClick={() => setStatusFilter(statusFilter === c.key ? '' : c.key as any)}
            className={`bg-white rounded-xl border px-3 py-2.5 text-start shadow-sm transition-all ${statusFilter === c.key ? 'border-cyan-600 ring-1 ring-cyan-600/40' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="text-[11px] font-medium text-slate-500">{c.label}</div>
            <div className={`text-xl font-bold tabular-nums ${c.cls}`}>{fmtN(c.count)}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72 max-w-full"><SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو المندوب أو الجوال أو المقر…' : 'Search…'} /></div>
        <div className="w-44"><SearchableSelect value={repFilter} onChange={setRepFilter} options={[{ value: '', label: ar ? 'كل المناديب' : 'All reps' }, ...reps.map((r) => ({ value: r, label: r }))]} placeholder={ar ? 'كل المناديب' : 'All reps'} /></div>
        <div className="w-44"><SearchableSelect value={hqFilter} onChange={setHqFilter} options={[{ value: '', label: ar ? 'كل المقرّات' : 'All HQs' }, ...hqs.map((h) => ({ value: h, label: h }))]} placeholder={ar ? 'كل المقرّات' : 'All HQs'} /></div>
        <span className="text-xs text-slate-400 ms-auto">{ar ? `عرض ${fmtN(filtered.length)} من ${fmtN(vendors.length)}` : `${fmtN(filtered.length)} of ${fmtN(vendors.length)}`}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{ar ? 'اسم المورد' : 'Vendor'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'مندوب التنشيط' : 'Rep'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'ممثل المورد' : 'Contact'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الجوال' : 'Phone'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'المقر' : 'HQ'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'السيارات' : 'Fleet'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'تاريخ العقد' : 'Date'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'التقييم' : 'Rating'}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const st = VENDOR_STATUS[v.status || 'unsigned'];
                return (
                  <tr key={v._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/system/contracts/vendors/${v._id}`} className="font-semibold text-slate-800 hover:text-cyan-700 inline-flex items-center gap-1">
                        {v.name}
                        {v.status === 'signed' && !v.documentsReceived && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title={ar ? 'مستندات ناقصة' : 'missing docs'} />}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-center"><SmallBadge bg={st.cls.split(' ')[0]} text={st.cls.split(' ')[1]} label={ar ? st.ar : st.en} /></td>
                    <td className="px-4 py-2.5 text-slate-600">{v.energizeRep || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{v.contactPerson || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600 tabular-nums" dir="ltr">{v.phone || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{v.headquarters || '—'}</td>
                    <td className="px-4 py-2.5 text-center font-bold tabular-nums text-slate-800">{fmtN(v.fleetSize)}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-slate-500 tabular-nums">{fmtD(v.contractDate)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {v.rating
                        ? <span className="inline-flex items-center gap-0.5 text-amber-500 text-xs font-bold"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{v.rating}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2 text-xs font-medium">
                        <Link href={`/system/contracts/vendors/${v._id}`} className="text-cyan-700 hover:underline inline-flex items-center gap-0.5">{ar ? 'الملف' : 'Profile'}<ExternalLink className="w-3 h-3" /></Link>
                        {canEdit && <button onClick={() => openEdit(v)} className="text-slate-500 hover:text-slate-800">{ar ? 'تعديل' : 'Edit'}</button>}
                        {canEdit && <button onClick={() => remove(v)} className="text-red-500 hover:text-red-700">{ar ? 'حذف' : 'Delete'}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-10">{ar ? 'لا توجد نتائج مطابقة' : 'No matches'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? (ar ? `تعديل المورد — ${editing.name}` : 'Edit vendor') : (ar ? 'إضافة مورد جديد' : 'Add vendor')} wide
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={save} disabled={!form.name.trim() || saving}>{editing ? (ar ? 'حفظ التعديلات' : 'Save') : (ar ? 'إضافة المورد' : 'Add')}</PrimaryButton>
          </div>
        }>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label={ar ? 'اسم المورد *' : 'Vendor name *'} span2><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={ar ? 'السجل التجاري' : 'CR number'}><TextInput value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'مندوب التنشيط' : 'Energize rep'}><TextInput value={form.energizeRep} onChange={(e) => setForm({ ...form, energizeRep: e.target.value })} /></Field>
          <Field label={ar ? 'مندوب التشغيل' : 'Operations rep'}><TextInput value={form.operationsRep} onChange={(e) => setForm({ ...form, operationsRep: e.target.value })} /></Field>
          <Field label={ar ? 'نوع المورد' : 'Vendor type'}>
            <Select value={form.vendorType} onChange={(e) => setForm({ ...form, vendorType: e.target.value })}>
              <option value="">—</option>
              {['ضريبي', 'آجل', 'كاش'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ممثل المورد' : 'Contact person'}><TextInput value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
          <Field label={ar ? 'رقم الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'المقر الرئيسي' : 'Headquarters'}><TextInput value={form.headquarters} onChange={(e) => setForm({ ...form, headquarters: e.target.value })} /></Field>
          <Field label={ar ? 'الوجهات' : 'Destinations'} span2><TextInput value={form.destinations} onChange={(e) => setForm({ ...form, destinations: e.target.value })} /></Field>
          <Field label={ar ? 'عدد السيارات' : 'Fleet size'}><TextInput type="number" value={form.fleetSize} onChange={(e) => setForm({ ...form, fleetSize: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'أنواع السيارات' : 'Vehicle types'}><TextInput value={form.vehicleTypes} onChange={(e) => setForm({ ...form, vehicleTypes: e.target.value })} /></Field>
          <Field label={ar ? 'تاريخ العقد' : 'Contract date'}><TextInput type="date" value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></Field>
          <Field label={ar ? 'مدة السداد (يوم)' : 'Payment term (days)'}><TextInput type="number" value={form.paymentTermDays} onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'حالة التوقيع والمستندات' : 'Signatures & documents'} span2>
            <div className="flex flex-wrap gap-4 text-sm pt-1.5">
              {([
                ['vendorSideContract', ar ? 'وقّع المورد' : 'Vendor signed'],
                ['ourSideContract', ar ? 'وقّعنا نحن' : 'We signed'],
                ['documentsReceived', ar ? 'المستندات مكتملة' : 'Documents complete'],
              ] as const).map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} className="accent-cyan-700 w-4 h-4" />
                  <span className="text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </Field>
          {!form.documentsReceived && (
            <Field label={ar ? 'المستندات الناقصة' : 'Missing documents'} span2>
              <TextInput value={form.missingDocuments} onChange={(e) => setForm({ ...form, missingDocuments: e.target.value })} placeholder={ar ? 'مثال: السجل التجاري ورقم الآيبان' : 'e.g. CR + IBAN'} />
            </Field>
          )}
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

export default function VendorsPage() {
  return <Suspense fallback={<Spinner />}><VendorsPageInner /></Suspense>;
}
