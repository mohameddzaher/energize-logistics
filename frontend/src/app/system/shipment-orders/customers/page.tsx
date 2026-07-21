'use client';
// عملاء طلبات الشحنات — each customer carries the two things that make creating
// an order a ten-second job: the price agreed per route, and the defaults they
// usually ship with. The create form reads both.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Users, Plus, Pencil, Trash2, Check, Loader2, X, Route } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select, SearchableSelect, ErrorNotice,
} from '@/components/hr/HRKit';
import { OrderCustomer, FormField, optionLabel, canEditOrders, canAdminOrders, Lang, money } from '@/lib/shipmentOrders';

const EMPTY = {
  name: '', phone: '', email: '', notes: '',
  routes: [] as { fromCity: string; toCity: string; price: number | null }[],
  defaults: { truckType: '', cargoType: '', paymentMethod: '', driverRentType: '', branch: '' },
};

export default function ShipmentOrderCustomersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user?.role);

  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<OrderCustomer | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers');
      setCustomers(d.customers || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:customers', useCallback(() => load(), [load]));
  // The route/defaults pickers reuse the SAME option lists the form uses, so a
  // city added in form-settings shows up here too — one vocabulary everywhere.
  useEffect(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, []);

  const optionsOf = (key: string) => fields.find((f) => f.key === key)?.options || [];

  const openCreate = () => { setEditing(null); setForm(JSON.parse(JSON.stringify(EMPTY))); setShowModal(true); };
  const openEdit = (c: OrderCustomer) => {
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '',
      routes: (c.routes || []).map((r) => ({ ...r })),
      defaults: { ...EMPTY.defaults, ...(c.defaults || {}) },
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        routes: form.routes
          .filter((r: any) => r.fromCity && r.toCity)
          .map((r: any) => ({ ...r, price: r.price === '' || r.price == null ? null : Number(r.price) })),
      };
      if (editing) await api.put(`/api/shipment-orders/customers/${editing._id}`, payload);
      else await api.post('/api/shipment-orders/customers', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (c: OrderCustomer) => {
    if (!(await confirm(ar
      ? `إزالة العميل «${c.name}»؟ شحناته السابقة تحتفظ باسمه.`
      : `Remove “${c.name}”? Their past shipments keep the name.`))) return;
    try { await api.delete(`/api/shipment-orders/customers/${c._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = customers.filter((c) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [c.name, c.phone, c.email].some((v) => (v || '').toLowerCase().includes(s));
  });

  if (loading) return <Spinner />;

  const setRoute = (i: number, k: string, v: any) =>
    setForm((f: any) => ({ ...f, routes: f.routes.map((r: any, x: number) => (x === i ? { ...r, [k]: v } : r)) }));
  const setDefault = (k: string, v: string) =>
    setForm((f: any) => ({ ...f, defaults: { ...f.defaults, [k]: v } }));

  const cities = optionsOf('fromCity');

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={ar ? 'عملاء الشحنات' : 'Shipment customers'}
        subtitle={ar ? `${customers.length} عميل — أسعار المسارات والتفضيلات تُقرأ تلقائياً عند إنشاء شحنة` : `${customers.length} customers — route prices and defaults feed the create form`}>
        {editor && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة عميل' : 'Add customer'}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="max-w-md">
        <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالاسم أو الجوال…' : 'Search name or phone…'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <p className="text-slate-500 py-10 text-center lg:col-span-2">{ar ? 'لا يوجد عملاء.' : 'No customers.'}</p>
        ) : filtered.map((c) => (
          <div key={c._id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{c.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {editor && <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                {canAdminOrders(user?.role) && <button type="button" onClick={() => remove(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mb-1.5"><Route className="w-3.5 h-3.5" /> {ar ? 'أسعار المسارات' : 'Route prices'}</p>
              {(c.routes || []).length === 0 ? (
                <p className="text-xs text-slate-400">{ar ? 'لا توجد مسارات بعد — أول شحنة بسعر تضيف مسارها هنا تلقائياً.' : 'No routes yet — the first priced shipment adds its route here automatically.'}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {c.routes.map((r, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-slate-100 text-xs text-slate-700">
                      {r.fromCity} ← {r.toCity} · <span className="font-semibold">{money(r.price)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {c.defaults && Object.values(c.defaults).some(Boolean) && (
              <p className="mt-3 text-xs text-slate-500">
                {ar ? 'التفضيلات: ' : 'Defaults: '}
                {[c.defaults.truckType, c.defaults.cargoType, c.defaults.paymentMethod, c.defaults.driverRentType, c.defaults.branch].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        ))}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل عميل' : 'Edit customer') : (ar ? 'إضافة عميل' : 'Add customer')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الاسم *' : 'Name *'} span2><TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label={ar ? 'البريد' : 'Email'}><TextInput value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} /></Field>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-600">{ar ? 'أسعار المسارات (من → إلى → السعر)' : 'Route prices (from → to → price)'}</p>
            <button type="button"
              onClick={() => setForm((f: any) => ({ ...f, routes: [...f.routes, { fromCity: '', toCity: '', price: '' }] }))}
              className="text-xs text-[#f37121] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> {ar ? 'إضافة مسار' : 'Add route'}</button>
          </div>
          {form.routes.length === 0 && <p className="text-xs text-slate-400">{ar ? 'لا توجد مسارات.' : 'No routes.'}</p>}
          <div className="space-y-2">
            {form.routes.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 min-w-[130px]">
                  <SearchableSelect value={r.fromCity} onChange={(x) => setRoute(i, 'fromCity', x)} searchAfter={0}
                    placeholder={ar ? 'من…' : 'From…'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'}
                    options={cities.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
                </div>
                <div className="flex-1 min-w-[130px]">
                  <SearchableSelect value={r.toCity} onChange={(x) => setRoute(i, 'toCity', x)} searchAfter={0}
                    placeholder={ar ? 'إلى…' : 'To…'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'}
                    options={cities.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
                </div>
                <TextInput type="number" value={r.price ?? ''} onChange={(e) => setRoute(i, 'price', e.target.value)} placeholder={ar ? 'السعر' : 'Price'} />
                <button type="button" onClick={() => setForm((f: any) => ({ ...f, routes: f.routes.filter((_: any, x: number) => x !== i) }))}
                  className="p-2 text-slate-400 hover:text-red-600 shrink-0" aria-label="remove"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-600 mb-2">{ar ? 'التفضيلات المعتادة (تُملأ تلقائياً في الشحنة)' : 'Usual defaults (autofilled on the form)'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ['truckType', ar ? 'نوع الشاحنة' : 'Truck type'],
              ['cargoType', ar ? 'نوع الحمولة' : 'Cargo type'],
              ['paymentMethod', ar ? 'طريقة الدفع' : 'Payment method'],
              ['driverRentType', ar ? 'نوع تأجير السائق' : 'Driver rent type'],
              ['branch', ar ? 'الفرع' : 'Branch'],
            ] as const).map(([k, label]) => (
              <Field key={k} label={label}>
                <Select value={form.defaults[k] || ''} onChange={(e) => setDefault(k, e.target.value)}>
                  <option value="">—</option>
                  {optionsOf(k).map((o) => <option key={o.key} value={o.key}>{optionLabel(o, lang as Lang)}</option>)}
                </Select>
              </Field>
            ))}
          </div>
        </div>

        <Field label={ar ? 'ملاحظات' : 'Notes'}>
          <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </Modal>
    </div>
  );
}
