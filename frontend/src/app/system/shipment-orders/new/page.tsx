'use client';
// إنشاء شحنة — ONE page instead of the external system's four-step wizard.
// The four groups render as sections you can see at once; nothing is hidden
// behind a "next" button.
//
// The inputs come from the field config (form-settings page): each renders as
// whatever it was configured to be — dropdown, tappable cards, or typed. The
// few inputs wired to logic (customer, waybill, status, agent) are fixed here.
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { PackagePlus, ArrowRight, Check, Loader2, Plus, X, UserPlus } from 'lucide-react';
import { Spinner, PageHeader, Select, SearchableSelect, PrimaryButton } from '@/components/hr/HRKit';
import {
  FormField, OrderCustomer, GROUP_LABELS, fieldLabel, optionLabel,
  ORDER_STATUSES, FIXED_KEYS, Lang, canEditOrders,
} from '@/lib/shipmentOrders';

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

// Keys that live on the order document itself; anything else the user invents
// in form-settings goes into customFields.
const SYSTEM_KEYS = new Set([
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch', 'notes',
]);

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const toLocalInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function CreateShipmentInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const params = useSearchParams();
  const editId = params?.get('id') || null;
  const { notify } = useDialog();

  const [fields, setFields] = useState<FormField[]>([]);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Record<string, any>>({ status: 'requesting' });
  const [customerId, setCustomerId] = useState('');
  // Inline "first time we work with them" — no detour through the customers page.
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });

  useEffect(() => {
    (async () => {
      try {
        const [f, c] = await Promise.all([
          api.get<{ fields: FormField[] }>('/api/shipment-orders/fields'),
          api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers'),
        ]);
        setFields(f.fields || []);
        setCustomers(c.customers || []);
        if (editId) {
          const d = await api.get<{ orders: any[] }>(`/api/shipment-orders/orders?q=&limit=1000`);
          const o = (d.orders || []).find((x) => x._id === editId);
          if (o) {
            setForm({
              ...o,
              pickupTime: toLocalInput(o.pickupTime),
              startTime: toLocalInput(o.startTime),
              arrivalTime: toLocalInput(o.arrivalTime),
              ...(o.customFields || {}),
            });
            setCustomerId(typeof o.customer === 'object' ? o.customer?._id : (o.customer || ''));
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, [editId]);

  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Picking the customer fills their usual choices; picking a route they have a
  // price for fills the sell price. Everything stays editable — the autofill is
  // a head start, not a lock.
  const applyCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x._id === id);
    if (!c) return;
    setForm((f) => {
      const next = { ...f };
      const d = c.defaults || {};
      (['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch'] as const)
        .forEach((k) => { if (!next[k] && d[k]) next[k] = d[k]; });
      const route = (c.routes || []).find((r) => r.fromCity === next.fromCity && r.toCity === next.toCity);
      if (route?.price != null) next.sellPrice = route.price;
      return next;
    });
  };

  useEffect(() => {
    if (!customer) return;
    const route = (customer.routes || []).find((r) => r.fromCity === form.fromCity && r.toCity === form.toCity);
    if (route?.price != null && (form.sellPrice == null || form.sellPrice === '')) set('sellPrice', route.price);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fromCity, form.toCity, customerId]);

  const missingRequired = fields.filter((f) => f.required && !FIXED_KEYS.has(f.key) && !String(form[f.key] ?? '').trim());

  const save = async () => {
    if (!customerId && !newCustomer.name.trim()) {
      notify(ar ? 'اختر العميل أو سجّل عميلاً جديداً.' : 'Pick a customer or register a new one.', 'error');
      return;
    }
    if (missingRequired.length) {
      notify((ar ? 'أكمل الحقول المطلوبة: ' : 'Missing required: ') + missingRequired.map((f) => fieldLabel(f, lang as Lang)).join('، '), 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = { customFields: {} };
      fields.forEach((f) => {
        const v = form[f.key];
        if (v === undefined) return;
        if (SYSTEM_KEYS.has(f.key)) payload[f.key] = v;
        else payload.customFields[f.key] = v;
      });
      payload.notes = form.notes || '';
      payload.status = form.status || 'requesting';
      if (customerId) payload.customer = customerId;
      else payload.newCustomer = { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() };
      ['pickupTime', 'startTime', 'arrivalTime'].forEach((k) => {
        payload[k] = form[k] ? new Date(form[k]).toISOString() : null;
      });
      ['quantity', 'sellPrice', 'buyPrice', 'driverRentPrice'].forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
        else if (payload[k] != null) payload[k] = Number(payload[k]);
      });

      if (editId) await api.put(`/api/shipment-orders/orders/${editId}`, payload);
      else {
        const d = await api.post<{ order: any }>('/api/shipment-orders/orders', payload);
        notify(ar ? `تم إنشاء الشحنة — رقم البوليصة ${d.order.waybillNumber}` : `Created — waybill ${d.order.waybillNumber}`, 'success');
      }
      router.push('/system/shipment-orders');
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!canEditOrders(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const renderField = (f: FormField) => {
    const label = fieldLabel(f, lang as Lang);
    const v = form[f.key] ?? '';
    switch (f.inputType) {
      case 'cards':
        // Tappable tiles — the phone-friendly answer for short option lists.
        return (
          <div key={f._id}>
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            <div className="flex flex-wrap gap-2">
              {f.options.map((o) => (
                <button key={o.key} type="button" onClick={() => set(f.key, o.key)}
                  className={`px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors ${v === o.key
                    ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                  {optionLabel(o, lang as Lang)}
                </button>
              ))}
            </div>
          </div>
        );
      case 'select':
        return (
          <div key={f._id}>
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            {f.options.length > 8 ? (
              <SearchableSelect value={v} onChange={(x) => set(f.key, x)}
                placeholder={ar ? `اختر ${label}` : `Choose ${label}`}
                searchPlaceholder={ar ? 'ابحث…' : 'Search…'}
                options={f.options.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
            ) : (
              <Select value={v} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o.key} value={o.key}>{optionLabel(o, lang as Lang)}</option>)}
              </Select>
            )}
          </div>
        );
      case 'number':
        return (
          <div key={f._id}>
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            <input type="number" value={v} onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          </div>
        );
      case 'datetime':
        return (
          <div key={f._id}>
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            <input type="datetime-local" value={v} onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          </div>
        );
      case 'textarea':
        return (
          <div key={f._id} className="sm:col-span-2">
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            <textarea rows={2} value={v} onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          </div>
        );
      default:
        return (
          <div key={f._id}>
            <p className="text-xs text-slate-500 mb-1.5">{label}{f.required && ' *'}</p>
            <input value={v} onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          </div>
        );
    }
  };

  const groups: FormField['group'][] = ['pickup_delivery', 'shipment', 'pricing_time', 'payment'];

  return (
    <div className="space-y-6 max-w-5xl" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<PackagePlus className="w-5 h-5" />}
        title={editId ? (ar ? 'تعديل شحنة' : 'Edit shipment') : (ar ? 'إنشاء شحنة' : 'Create shipment')}
        subtitle={ar ? 'كل التفاصيل في صفحة واحدة — من غير خطوات' : 'Everything on one page — no wizard'}>
        <button type="button" onClick={() => router.push('/system/shipment-orders')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {ar ? 'رجوع للقائمة' : 'Back to list'}
        </button>
      </PageHeader>

      {/* العميل — fixed on top: picking them is what autofills the rest. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
        <p className="text-sm font-bold text-slate-900">{ar ? 'العميل' : 'Customer'}</p>
        {!newCustomerOpen ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <SearchableSelect value={customerId} onChange={applyCustomer}
                placeholder={ar ? 'اختر العميل…' : 'Pick the customer…'}
                searchPlaceholder={ar ? 'ابحث بالاسم أو الجوال…' : 'Search name or phone…'}
                emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
                options={customers.map((c) => ({ value: c._id, label: c.name, hint: c.phone || '' }))} />
            </div>
            <button type="button" onClick={() => { setNewCustomerOpen(true); setCustomerId(''); }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-semibold">
              <UserPlus className="w-4 h-4" /> {ar ? 'عميل جديد' : 'New customer'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <input value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))}
              placeholder={ar ? 'اسم العميل الجديد *' : 'New customer name *'} className={inputCls + ' flex-1'} />
            <input value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
              placeholder={ar ? 'الجوال' : 'Phone'} className={inputCls + ' sm:w-44'} />
            <button type="button" onClick={() => { setNewCustomerOpen(false); setNewCustomer({ name: '', phone: '' }); }}
              className="p-2.5 text-slate-400 hover:text-slate-700" aria-label="close"><X className="w-4 h-4" /></button>
          </div>
        )}
        {newCustomerOpen && (
          <p className="text-xs text-slate-500">
            {ar
              ? 'هيتسجّل تلقائياً في صفحة العملاء، والمسار والسعر اللي هتدخلهم دلوقتي هيتحفظوا في ملفه.'
              : 'They are saved to the customers page automatically, and the route + price you enter now lands on their profile.'}
          </p>
        )}
        {customer && (customer.routes || []).length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {customer.routes.map((r, i) => (
              // One tap plants the whole route AND its agreed price.
              <button key={i} type="button"
                onClick={() => setForm((f) => ({ ...f, fromCity: r.fromCity, toCity: r.toCity, sellPrice: r.price ?? f.sellPrice }))}
                className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-xs text-slate-600 transition-colors">
                {r.fromCity} ← {r.toCity} · {r.price ?? '—'}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.map((g) => {
        const gf = fields.filter((f) => f.group === g && !FIXED_KEYS.has(f.key));
        if (!gf.length) return null;
        return (
          <div key={g} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-sm font-bold text-slate-900 mb-4">{ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {gf.map(renderField)}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-1.5">{ar ? 'الحالة' : 'Status'}</p>
          <Select value={form.status || 'requesting'} onChange={(e) => set('status', e.target.value)}>
            {ORDER_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
          </Select>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1.5">{ar ? 'المندوب' : 'Agent'}</p>
          {/* Stamped from the signed-in account — displayed so it is no mystery,
              read-only so it is no lie. */}
          <input value={`${user?.firstName || ''} ${user?.lastName || ''}`.trim()} readOnly disabled className={inputCls + ' opacity-70'} />
        </div>
        <div className="sm:col-span-1">
          <p className="text-xs text-slate-500 mb-1.5">{ar ? 'ملاحظات' : 'Notes'}</p>
          <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pb-8">
        <button type="button" onClick={() => router.push('/system/shipment-orders')}
          className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {editId ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الشحنة' : 'Create shipment')}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary in the app router.
  return <Suspense fallback={<Spinner />}><CreateShipmentInner /></Suspense>;
}
