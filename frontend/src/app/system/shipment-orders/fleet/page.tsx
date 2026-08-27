'use client';
// الموردون والمركبات — the fleet register the create form reads and feeds.
// A vehicle is either OURS (supplier = null) or belongs to a 3PL supplier —
// a company or a freelancer, one flag apart. Most rows here are born from the
// create-shipment form; this page is where they get enriched and corrected.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Building2, User as UserIcon, Plus, Pencil, Trash2, Check, Loader2 } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea,
  SearchableSelect, SmallBadge, Tabs, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { OrderSupplier, OrderVehicle, FormField, optionLabel, canEditOrders, canAdminOrders, Lang } from '@/lib/shipmentOrders';

const EMPTY_SUPPLIER = { name: '', type: 'company' as 'company' | 'freelancer', phone: '', email: '', notes: '' };
const EMPTY_VEHICLE = { plate: '', name: '', truckType: '', supplier: '', defaultDriverName: '', defaultDriverPhone: '', notes: '' };

export default function FleetPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user);

  const [suppliers, setSuppliers] = useState<OrderSupplier[]>([]);
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('vehicles');
  const [search, setSearch] = useState('');

  const [supModal, setSupModal] = useState(false);
  const [editingSup, setEditingSup] = useState<OrderSupplier | null>(null);
  const [supForm, setSupForm] = useState<any>(EMPTY_SUPPLIER);

  const [vehModal, setVehModal] = useState(false);
  const [editingVeh, setEditingVeh] = useState<OrderVehicle | null>(null);
  const [vehForm, setVehForm] = useState<any>(EMPTY_VEHICLE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sp, v] = await Promise.all([
        api.get<{ suppliers: OrderSupplier[] }>('/api/shipment-orders/suppliers'),
        api.get<{ vehicles: OrderVehicle[] }>('/api/shipment-orders/vehicles'),
      ]);
      setSuppliers(sp.suppliers || []);
      setVehicles(v.vehicles || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));
  // Truck types come from the same form vocabulary, so a type added in
  // form-settings is pickable here too.
  useEffect(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, []);

  const truckTypes = fields.find((f) => f.key === 'truckType')?.options || [];

  const fold = (x: string) => x.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const hit = (...vals: (string | undefined | null)[]) => {
    const s = fold(search.trim());
    if (!s) return true;
    return vals.some((v) => fold(String(v || '')).includes(s));
  };

  const supplierName = (v: OrderVehicle) =>
    typeof v.supplier === 'object' && v.supplier ? v.supplier.name : '';

  const saveSupplier = async () => {
    if (!supForm.name.trim()) return;
    setSaving(true);
    try {
      if (editingSup) await api.put(`/api/shipment-orders/suppliers/${editingSup._id}`, supForm);
      else await api.post('/api/shipment-orders/suppliers', supForm);
      setSupModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const saveVehicle = async () => {
    if (!vehForm.plate.trim()) return;
    setSaving(true);
    try {
      const payload = { ...vehForm, supplier: vehForm.supplier || null };
      if (editingVeh) await api.put(`/api/shipment-orders/vehicles/${editingVeh._id}`, payload);
      else await api.post('/api/shipment-orders/vehicles', payload);
      setVehModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const removeSupplier = async (s: OrderSupplier) => {
    if (!(await confirm(ar ? `إزالة المورد «${s.name}»؟ سياراته تبقى مسجلة.` : `Remove “${s.name}”? Their vehicles stay.`))) return;
    try { await api.delete(`/api/shipment-orders/suppliers/${s._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const removeVehicle = async (v: OrderVehicle) => {
    if (!(await confirm(ar ? `إزالة السيارة «${v.plate}»؟ الشحنات السابقة تحتفظ ببياناتها.` : `Remove “${v.plate}”? Past shipments keep their snapshot.`))) return;
    try { await api.delete(`/api/shipment-orders/vehicles/${v._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const shownVehicles = vehicles.filter((v) => hit(v.plate, v.name, supplierName(v), v.defaultDriverName));
  const shownSuppliers = suppliers.filter((s) => hit(s.name, s.phone));

  const vehicleCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 16 },
    { header: ar ? 'الوصف' : 'Description', key: 'name', width: 26, transform: (v) => v || '—' },
    { header: ar ? 'النوع' : 'Type', key: 'truckType', width: 18, transform: (v) => v || '—' },
    // العمود يعرض «أسطولنا» حين لا مورّد، تمامًا كشارة الجدول: خلوّ الخانة
    // يُقرأ نقصًا في البيانات، وهو هنا معلومة ملكيّةٍ صريحة.
    { header: ar ? 'المالك' : 'Owner', key: 'supplier', width: 26, transform: (_v, r) => supplierName(r) || (ar ? 'أسطولنا' : 'Our fleet') },
    { header: ar ? 'السائق المعتاد' : 'Usual driver', key: 'defaultDriverName', width: 24, transform: (v) => v || '—' },
    { header: ar ? 'جواله' : 'Driver phone', key: 'defaultDriverPhone', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];
  const supplierCols: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', width: 30 },
    { header: ar ? 'النوع' : 'Type', key: 'type', width: 14, transform: (v) => (v === 'freelancer' ? (ar ? 'فريلانسر' : 'Freelancer') : (ar ? 'شركة' : 'Company')) },
    { header: ar ? 'الجوال' : 'Phone', key: 'phone', width: 16 },
    { header: ar ? 'البريد' : 'Email', key: 'email', width: 26 },
    { header: ar ? 'عدد السيارات' : 'Vehicles', key: 'vehicleCount', width: 12, transform: (v) => Number(v || 0) },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];

  if (loading) return <Spinner />;

  const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={ar ? 'الموردون والمركبات' : 'Suppliers & vehicles'}
        subtitle={ar
          ? `${vehicles.length} سيارة (${vehicles.filter((v) => !v.supplier).length} من أسطولنا) · ${suppliers.length} مورد — تُسجَّل تلقائياً من نموذج الشحنة`
          : `${vehicles.length} vehicles (${vehicles.filter((v) => !v.supplier).length} ours) · ${suppliers.length} suppliers — auto-registered from the create form`}>
        {/* التبويبان يعرضان سجلّين مختلفين والبحث يصفّي المعروض منهما، فالخيار
            الأوّل يطابق الشاشة والثاني يخرج السجلّين كاملين في شيتين. */}
        <ExportMenu
          fileName="shipment-orders-fleet" lang={ar ? 'ar' : 'en'}
          options={[
            tab === 'vehicles'
              ? { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'المركبات' : 'Vehicles', rows: shownVehicles as any[], columns: vehicleCols }] }
              : { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'الموردون' : 'Suppliers', rows: shownSuppliers as any[], columns: supplierCols }] },
            {
              key: 'all', label: exportScopeLabels(ar).all,
              sheets: [
                { name: ar ? 'المركبات' : 'Vehicles', rows: vehicles as any[], columns: vehicleCols },
                { name: ar ? 'الموردون' : 'Suppliers', rows: suppliers as any[], columns: supplierCols },
              ],
            },
          ]}
        />
        {editor && (tab === 'vehicles'
          ? <PrimaryButton onClick={() => { setEditingVeh(null); setVehForm({ ...EMPTY_VEHICLE }); setVehModal(true); }}><Plus className="w-4 h-4" /> {ar ? 'إضافة سيارة' : 'Add vehicle'}</PrimaryButton>
          : <PrimaryButton onClick={() => { setEditingSup(null); setSupForm({ ...EMPTY_SUPPLIER }); setSupModal(true); }}><Plus className="w-4 h-4" /> {ar ? 'إضافة مورد' : 'Add supplier'}</PrimaryButton>)}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'vehicles', label: ar ? 'المركبات' : 'Vehicles', badge: vehicles.length },
        { key: 'suppliers', label: ar ? 'الموردون' : 'Suppliers', badge: suppliers.length },
      ]} />

      <div className="max-w-md">
        <SearchInput value={search} onChange={setSearch}
          placeholder={ar ? 'بحث باللوحة أو الاسم أو المورد…' : 'Search plate, name or supplier…'} />
      </div>

      {tab === 'vehicles' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{ar ? 'اللوحة' : 'Plate'}</th>
              <th className={th}>{ar ? 'الوصف' : 'Description'}</th>
              <th className={th}>{ar ? 'النوع' : 'Type'}</th>
              <th className={th}>{ar ? 'المالك' : 'Owner'}</th>
              <th className={th}>{ar ? 'السائق المعتاد' : 'Usual driver'}</th>
              <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr></thead>
            <tbody>
              {shownVehicles.map((v) => (
                <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900 font-bold font-mono">{v.plate}</td>
                  <td className="px-4 py-3 text-slate-700">{v.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{v.truckType || '—'}</td>
                  <td className="px-4 py-3">
                    {v.supplier
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={supplierName(v)} />
                      : <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={ar ? 'أسطولنا' : 'Our fleet'} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{[v.defaultDriverName, v.defaultDriverPhone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editor && <button type="button" onClick={() => { setEditingVeh(v); setVehForm({ ...EMPTY_VEHICLE, ...v, supplier: typeof v.supplier === 'object' ? v.supplier?._id || '' : (v.supplier || '') }); setVehModal(true); }} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                      {canAdminOrders(user) && <button type="button" onClick={() => removeVehicle(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-12">{ar ? 'لا توجد سيارات بعد — أول شحنة بسيارة جديدة تُسجّلها هنا تلقائياً.' : 'No vehicles yet — the first shipment with a new truck registers it here.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {shownSuppliers.map((s) => (
            <div key={s._id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${s.type === 'freelancer' ? 'bg-violet-500/15 text-violet-600' : 'bg-blue-500/15 text-blue-600'}`}>
                    {s.type === 'freelancer' ? <UserIcon className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.type === 'freelancer' ? (ar ? 'فريلانسر' : 'Freelancer') : (ar ? 'شركة' : 'Company')}
                      {s.phone ? ` · ${s.phone}` : ''}
                      {` · ${s.vehicleCount || 0} ${ar ? 'سيارة' : 'vehicles'}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {editor && <button type="button" onClick={() => { setEditingSup(s); setSupForm({ ...EMPTY_SUPPLIER, ...s }); setSupModal(true); }} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                  {canAdminOrders(user) && <button type="button" onClick={() => removeSupplier(s)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
              {s.notes && <p className="mt-2 text-xs text-slate-500">{s.notes}</p>}
            </div>
          ))}
          {suppliers.length === 0 && <p className="text-slate-500 py-10 text-center lg:col-span-2">{ar ? 'لا يوجد مورّدون بعد — أول سيارة مورّد في شحنة تُسجّل صاحبها هنا.' : 'No suppliers yet — the first supplier truck on a shipment registers them.'}</p>}
        </div>
      )}

      {/* Supplier modal */}
      <Modal open={supModal} onClose={() => setSupModal(false)}
        title={editingSup ? (ar ? 'تعديل مورد' : 'Edit supplier') : (ar ? 'إضافة مورد' : 'Add supplier')}
        footer={<>
          <button type="button" onClick={() => setSupModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveSupplier} disabled={saving || !supForm.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={ar ? 'الاسم *' : 'Name *'}><TextInput value={supForm.name} onChange={(e) => setSupForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <div>
            <label className={labelCls}>{ar ? 'النوع' : 'Type'}</label>
            <div className="flex gap-2">
              {([['company', ar ? 'شركة' : 'Company', Building2], ['freelancer', ar ? 'فريلانسر' : 'Freelancer', UserIcon]] as const).map(([k, label, Ic]) => (
                <button key={k} type="button" onClick={() => setSupForm((f: any) => ({ ...f, type: k }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 text-sm font-semibold ${supForm.type === k
                    ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <Ic className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          </div>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={supForm.phone} onChange={(e) => setSupForm((f: any) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label={ar ? 'البريد' : 'Email'}><TextInput value={supForm.email} onChange={(e) => setSupForm((f: any) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'}><TextArea rows={2} value={supForm.notes} onChange={(e) => setSupForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>

      {/* Vehicle modal */}
      <Modal open={vehModal} onClose={() => setVehModal(false)}
        title={editingVeh ? (ar ? 'تعديل سيارة' : 'Edit vehicle') : (ar ? 'إضافة سيارة' : 'Add vehicle')}
        footer={<>
          <button type="button" onClick={() => setVehModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveVehicle} disabled={saving || !vehForm.plate.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'رقم اللوحة *' : 'Plate *'}><TextInput value={vehForm.plate} onChange={(e) => setVehForm((f: any) => ({ ...f, plate: e.target.value }))} /></Field>
          <Field label={ar ? 'الوصف' : 'Description'}><TextInput value={vehForm.name} onChange={(e) => setVehForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <div className="sm:col-span-2">
            <label className={labelCls}>{ar ? 'نوع الشاحنة' : 'Truck type'}</label>
            <SearchableSelect value={vehForm.truckType} onChange={(x) => setVehForm((f: any) => ({ ...f, truckType: x }))} searchAfter={0}
              placeholder={ar ? 'اختر النوع…' : 'Choose…'} searchPlaceholder={ar ? 'اكتب للبحث…' : 'Search…'}
              options={truckTypes.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{ar ? 'المالك — اتركه فارغاً إن كانت من أسطولنا' : 'Owner — empty means our fleet'}</label>
            <SearchableSelect value={vehForm.supplier} onChange={(x) => setVehForm((f: any) => ({ ...f, supplier: x }))} searchAfter={0}
              placeholder={ar ? 'أسطولنا' : 'Our fleet'} searchPlaceholder={ar ? 'اكتب اسم المورد…' : 'Search supplier…'}
              options={[{ value: '', label: ar ? 'أسطولنا' : 'Our fleet' }, ...suppliers.map((sp) => ({ value: sp._id, label: sp.name, hint: sp.type === 'freelancer' ? (ar ? 'فريلانسر' : 'Freelancer') : (ar ? 'شركة' : 'Company') }))]} />
          </div>
          <Field label={ar ? 'السائق المعتاد' : 'Usual driver'}><TextInput value={vehForm.defaultDriverName} onChange={(e) => setVehForm((f: any) => ({ ...f, defaultDriverName: e.target.value }))} /></Field>
          <Field label={ar ? 'جواله' : 'Their phone'}><TextInput value={vehForm.defaultDriverPhone} onChange={(e) => setVehForm((f: any) => ({ ...f, defaultDriverPhone: e.target.value }))} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={vehForm.notes} onChange={(e) => setVehForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  );
}
