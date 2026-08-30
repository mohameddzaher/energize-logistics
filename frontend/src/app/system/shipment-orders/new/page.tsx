'use client';
// إنشاء شحنة — ONE page instead of the external system's four-step wizard.
//
// Reading order mirrors how the team actually books a load: who is it for →
// which truck carries it → where it goes → when and for how much → how it is
// paid. Picking the customer autofills their defaults and route price; picking
// the truck autofills its regular driver; a truck we have never seen registers
// itself (and its 3PL supplier) as a side effect.
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  PackagePlus, ArrowRight, Check, Loader2, X, UserPlus, Truck,
  MapPin, Package, Clock3, Wallet, User as UserIcon, Building2,
  TrendingUp, TrendingDown, AlertCircle,
} from 'lucide-react';
import { Spinner, PageHeader, Select, SearchableSelect, PrimaryButton } from '@/components/hr/HRKit';
import { ContactButtons } from '@/components/crm/CrmKit';
import {
  FormField, OrderCustomer, OrderVehicle, OrderSupplier, GROUP_LABELS, fieldLabel, optionLabel,
  ORDER_STATUSES, FIXED_KEYS, Lang, canEditOrders,
} from '@/lib/shipmentOrders';

// Labels are the form's wayfinding — near-black and readable, not a whisper.
const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
const labelMissCls = 'block text-sm font-semibold text-red-600 mb-1.5';
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
const inputMissCls = 'w-full px-3 py-2.5 rounded-lg bg-red-50 border border-red-400 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50';

const SYSTEM_KEYS = new Set([
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch', 'notes',
]);

const GROUP_ICONS: Record<FormField['group'], any> = {
  pickup_delivery: MapPin, shipment: Package, pricing_time: Clock3, payment: Wallet,
};

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
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  const [suppliers, setSuppliers] = useState<OrderSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Turned on by a failed save: from then on every missing required input is
  // red until it is filled — the user asked to SEE which fields block them.
  const [showErrors, setShowErrors] = useState(false);

  const [form, setForm] = useState<Record<string, any>>({ status: 'requesting' });
  const [customerId, setCustomerId] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });

  // The truck: an existing one (ours or a supplier's), or a brand-new plate
  // whose owner we name on the spot.
  const [vehicleId, setVehicleId] = useState('');
  const [newVehicleOpen, setNewVehicleOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ plate: '', name: '', owner: 'supplier' as 'supplier' | 'newSupplier', supplierId: '', supplierName: '', supplierType: 'company' as 'company' | 'freelancer' });

  useEffect(() => {
    (async () => {
      try {
        const [f, c, v, sp] = await Promise.all([
          api.get<{ fields: FormField[] }>('/api/shipment-orders/fields'),
          api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers'),
          api.get<{ vehicles: OrderVehicle[] }>('/api/shipment-orders/vehicles'),
          api.get<{ suppliers: OrderSupplier[] }>('/api/shipment-orders/suppliers'),
        ]);
        setFields(f.fields || []);
        setCustomers(c.customers || []);
        setVehicles(v.vehicles || []);
        setSuppliers(sp.suppliers || []);
        if (editId) {
          // The order directly by id — paging through the list capped at 1000
          // used to silently blank the form for older orders.
          const d = await api.get<{ order: any }>(`/api/shipment-orders/orders/${editId}`);
          const o = d.order;
          if (o) {
            setForm({
              ...o,
              pickupTime: toLocalInput(o.pickupTime),
              startTime: toLocalInput(o.startTime),
              arrivalTime: toLocalInput(o.arrivalTime),
              ...(o.customFields || {}),
            });
            setCustomerId(typeof o.customer === 'object' ? o.customer?._id : (o.customer || ''));
            setVehicleId(typeof o.vehicle === 'object' ? o.vehicle?._id : (o.vehicle || ''));
          }
        }
      } catch (e: any) {
        // A form rendered with zero questions reads as "nothing required" — say
        // what actually happened instead.
        notify(e?.message || (ar ? 'فشل تحميل النموذج — أعد المحاولة' : 'Failed to load the form — try again'), 'error');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

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

  // Picking the truck plants its regular driver and its type — one tap, three
  // answers. All still editable per shipment.
  const applyVehicle = (id: string) => {
    setVehicleId(id);
    setNewVehicleOpen(false);
    const v = vehicles.find((x) => x._id === id);
    if (!v) return;
    setForm((f) => ({
      ...f,
      driverName: f.driverName || v.defaultDriverName || '',
      driverPhone: f.driverPhone || v.defaultDriverPhone || '',
      truckType: f.truckType || v.truckType || '',
    }));
  };

  useEffect(() => {
    if (!customer) return;
    const route = (customer.routes || []).find((r) => r.fromCity === form.fromCity && r.toCity === form.toCity);
    if (route?.price != null && (form.sellPrice == null || form.sellPrice === '')) set('sellPrice', route.price);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fromCity, form.toCity, customerId]);

  const missingKeys = useMemo(() => {
    const missing = new Set<string>();
    fields.forEach((f) => {
      if (f.required && !FIXED_KEYS.has(f.key) && !String(form[f.key] ?? '').trim()) missing.add(f.key);
    });
    if (!customerId && !newCustomer.name.trim()) missing.add('customer');
    return missing;
  }, [fields, form, customerId, newCustomer.name]);

  const save = async () => {
    if (!vehicleId && newVehicle.plate.trim()) {
      if (newVehicle.owner === 'supplier' && !newVehicle.supplierId) {
        notify(ar ? 'اختر المورد صاحب السيارة الجديدة.' : 'Pick the new vehicle’s supplier.', 'error');
        return;
      }
      if (newVehicle.owner === 'newSupplier' && !newVehicle.supplierName.trim()) {
        notify(ar ? 'اكتب اسم المورد الجديد.' : 'Name the new supplier.', 'error');
        return;
      }
    }
    if (missingKeys.size) {
      setShowErrors(true);
      notify(ar
        ? 'أكمِل الحقول المحدَّدة باللون الأحمر.'
        : 'Fill the fields highlighted in red.', 'error');
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
      payload.driverName = form.driverName || '';
      payload.driverPhone = form.driverPhone || '';
      if (customerId) payload.customer = customerId;
      else payload.newCustomer = { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() };

      if (vehicleId) payload.vehicle = vehicleId;
      else if (newVehicle.plate.trim()) {
        payload.newVehicle = {
          plate: newVehicle.plate.trim(),
          name: newVehicle.name.trim(),
          supplierId: newVehicle.owner === 'supplier' ? newVehicle.supplierId : null,
          newSupplier: newVehicle.owner === 'newSupplier'
            ? { name: newVehicle.supplierName.trim(), type: newVehicle.supplierType }
            : null,
        };
      }

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

  if (!canEditOrders(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const miss = (k: string) => showErrors && missingKeys.has(k);

  const renderField = (f: FormField) => {
    const label = fieldLabel(f, lang as Lang);
    const v = form[f.key] ?? '';
    const bad = miss(f.key);
    const lab = <label className={bad ? labelMissCls : labelCls}>{label}{f.required && <span className="text-red-500"> *</span>}</label>;
    switch (f.inputType) {
      case 'cards':
        return (
          <div key={f._id} className="col-span-full">
            {lab}
            <div className={`flex flex-wrap gap-2 ${bad ? 'p-2 rounded-xl border border-red-300 bg-red-50/50' : ''}`}>
              {f.options.map((o) => (
                <button key={o.key} type="button" onClick={() => set(f.key, o.key)}
                  className={`group flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${v === o.key
                    ? 'border-[#f37121] bg-[#f37121] text-white shadow-md shadow-[#f37121]/25'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/40 hover:bg-[#f37121]/[0.04] hover:-translate-y-0.5'}`}>
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${v === o.key ? 'border-white bg-white/20' : 'border-slate-300 group-hover:border-[#f37121]/50'}`}>
                    {v === o.key && <Check className="w-3 h-3" />}
                  </span>
                  {optionLabel(o, lang as Lang)}
                </button>
              ))}
            </div>
          </div>
        );
      case 'select':
        return (
          <div key={f._id}>
            {lab}
            {/* searchAfter=0: every dropdown in this section searches, always. */}
            <div className={bad ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
              <SearchableSelect value={v} onChange={(x) => set(f.key, x)} searchAfter={0}
                placeholder={ar ? `اختر ${label}` : `Choose ${label}`}
                searchPlaceholder={ar ? 'اكتب للبحث…' : 'Type to search…'}
                emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
                options={f.options.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
            </div>
          </div>
        );
      case 'number':
        return <div key={f._id}>{lab}<input type="number" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      case 'datetime':
        return <div key={f._id}>{lab}<input type="datetime-local" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      case 'textarea':
        return <div key={f._id} className="col-span-full">{lab}<textarea rows={2} value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      default:
        return <div key={f._id}>{lab}<input value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
    }
  };

  const groups: FormField['group'][] = ['pickup_delivery', 'shipment', 'pricing_time', 'payment'];
  // Only groups that actually have fields get a number. Numbering off the full
  // list skipped digits whenever a group was emptied in form settings — the
  // form read «1, 2, 4, 6» and looked broken.
  const activeGroups = groups.filter((g) => fields.some((f) => f.group === g && !FIXED_KEYS.has(f.key)));
  const missingIn = (g: FormField['group']) =>
    fields.filter((f) => f.group === g && !FIXED_KEYS.has(f.key) && missingKeys.has(f.key)).length;

  const SEC = {
    customer: 'sec-customer', truck: 'sec-truck', status: 'sec-status',
    group: (g: string) => `sec-${g}`,
  };
  const steps = [
    { id: SEC.customer, no: 1, title: ar ? 'العميل' : 'Customer', missing: missingKeys.has('customer') ? 1 : 0 },
    { id: SEC.truck, no: 2, title: ar ? 'السيارة والسائق' : 'Truck & driver', missing: 0 },
    ...activeGroups.map((g, i) => ({
      id: SEC.group(g), no: i + 3,
      title: ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en,
      missing: missingIn(g),
    })),
    { id: SEC.status, no: activeGroups.length + 3, title: ar ? 'الحالة والملاحظات' : 'Status & notes', missing: 0 },
  ];
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Naming what is missing beats counting it: a chip per unfilled required
  // answer, and pressing it scrolls to that card.
  const missingChips = Array.from(missingKeys).map((k) => {
    if (k === 'customer') return { key: k, label: ar ? 'العميل' : 'Customer', to: SEC.customer };
    const f = fields.find((x) => x.key === k);
    return { key: k, label: f ? fieldLabel(f, lang as Lang) : k, to: f ? SEC.group(f.group) : SEC.customer };
  });

  // The one number a broker books against. It is derived from two inputs three
  // cards apart, so it is shown where the eye already is: on the save bar.
  const sell = Number(form.sellPrice); const buy = Number(form.buyPrice);
  const hasDeal = Number.isFinite(sell) && sell > 0 && Number.isFinite(buy) && buy > 0;
  const dealMargin = hasDeal ? sell - buy : null;
  const money = (n: number) => n.toLocaleString(ar ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 });

  // A card carries its own state: the number turns into a tick when nothing in
  // it is still required, and into a red count when something is. The person
  // filling a six-card form should never have to scroll to find out.
  const sectionCard = (icon: any, no: number, title: string, children: React.ReactNode,
    opts?: { id?: string; missing?: number }) => {
    const Icon = icon;
    const missing = opts?.missing || 0;
    const done = missing === 0;
    return (
      // NO overflow-hidden here: SearchableSelect renders its panel absolutely
      // inside the card, and clipping it is exactly the "الدروب ليست مستخبية"
      // bug. The header rounds its own top corners instead.
      <div id={opts?.id} className={`rounded-2xl border bg-white shadow-sm scroll-mt-24 transition-colors ${
        showErrors && missing ? 'border-red-300' : 'border-slate-200'}`}>
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50/70 border-b border-slate-100 flex items-center gap-3 rounded-t-2xl">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
            done ? 'bg-emerald-100 text-emerald-700'
              : showErrors ? 'bg-red-100 text-red-700' : 'bg-[#f37121]/15 text-[#f37121]'}`}>
            {done ? <Check className="w-4 h-4" /> : no}
          </span>
          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-base font-bold text-slate-900">{title}</p>
          {missing > 0 && (
            <span className={`ms-auto text-xs font-semibold px-2 py-1 rounded-full ${
              showErrors ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
              {ar ? `${missing} مطلوب` : `${missing} required`}
            </span>
          )}
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    );
  };

  const supplierOf = (v: OrderVehicle) =>
    (typeof v.supplier === 'object' && v.supplier ? v.supplier.name : '') || (ar ? 'أسطولنا' : 'Our fleet');

  return (
    <div className="space-y-5 w-full pb-28" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<PackagePlus className="w-5 h-5" />}
        title={editId ? (ar ? 'تعديل شحنة' : 'Edit shipment') : (ar ? 'إنشاء شحنة' : 'Create shipment')}
        subtitle={ar ? 'جميع التفاصيل في صفحة واحدة' : 'Everything on one page'}>
        <button type="button" onClick={() => router.push('/system/shipment-orders')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {ar ? 'رجوع للقائمة' : 'Back to list'}
        </button>
      </PageHeader>

      {/* The rail: the whole form at a glance. Green = answered, red = blocking,
          and a press jumps there instead of a scroll hunt. */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-slate-50/90 backdrop-blur border-b border-slate-200/70">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {steps.map((st) => {
            const done = st.missing === 0;
            return (
              <button key={st.id} type="button" onClick={() => jumpTo(st.id)}
                className={`shrink-0 flex items-center gap-2 ps-2 pe-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                  done ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : showErrors ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-[#f37121]/50 hover:text-[#f37121]'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  done ? 'bg-emerald-500 text-white'
                    : showErrors ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {done ? <Check className="w-3 h-3" /> : st.no}
                </span>
                {st.title}
                {st.missing > 0 && <span className="opacity-70">({st.missing})</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      {/* 1 ── العميل */}
      {sectionCard(UserIcon, 1, ar ? 'العميل' : 'Customer', (
        <div className="space-y-3">
          {!newCustomerOpen ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className={`flex-1 ${miss('customer') ? 'rounded-lg ring-2 ring-red-400/60' : ''}`}>
                <SearchableSelect value={customerId} onChange={applyCustomer} searchAfter={0}
                  placeholder={ar ? 'اختر العميل — اكتب الاسم للبحث…' : 'Pick the customer — type to search…'}
                  searchPlaceholder={ar ? 'اكتب اسم العميل أو جواله…' : 'Type name or phone…'}
                  emptyLabel={ar ? 'لا توجد نتائج — سجّله كعميل جديد' : 'No matches — register them as new'}
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
                placeholder={ar ? 'اسم العميل الجديد *' : 'New customer name *'}
                className={(miss('customer') ? inputMissCls : inputCls) + ' flex-1'} />
              <input value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
                placeholder={ar ? 'الجوال' : 'Phone'} className={inputCls + ' sm:w-44'} />
              <button type="button" onClick={() => { setNewCustomerOpen(false); setNewCustomer({ name: '', phone: '' }); }}
                className="p-2.5 text-slate-400 hover:text-slate-700" aria-label="close"><X className="w-4 h-4" /></button>
            </div>
          )}
          {newCustomerOpen && (
            <p className="text-xs text-slate-500">
              {ar ? 'يُسجَّل تلقائياً في صفحة العملاء، ويُحفَظ المسار والسعر في ملفه.' : 'Saved to the customers page automatically; the route + price land on their profile.'}
            </p>
          )}
          {customer && (customer.routes || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">{ar ? 'مساراته المعتمدة — بضغطة واحدة يُملأ المسار والسعر:' : 'Known routes — one tap fills route and price:'}</p>
              <div className="flex flex-wrap gap-2">
                {customer.routes.map((r, i) => (
                  <button key={i} type="button"
                    onClick={() => setForm((f) => ({ ...f, fromCity: r.fromCity, toCity: r.toCity, sellPrice: r.price ?? f.sellPrice }))}
                    className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-sm text-slate-700 font-medium transition-colors">
                    {r.fromCity} ← {r.toCity} · <span className="font-bold">{r.price ?? '—'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ), { id: SEC.customer, missing: missingKeys.has('customer') ? 1 : 0 })}

      {/* 2 ── السيارة والسائق — one row: pick the truck, driver fills itself */}
      {sectionCard(Truck, 2, ar ? 'السيارة والسائق' : 'Truck & driver', (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>{ar ? 'السيارة' : 'Vehicle'}</label>
              <SearchableSelect value={vehicleId} onChange={applyVehicle} searchAfter={0}
                placeholder={ar ? 'اكتب رقم اللوحة أو اسم السائق…' : 'Type plate or driver…'}
                searchPlaceholder={ar ? 'ابحث باللوحة أو السائق أو المورد…' : 'Search plate, driver or supplier…'}
                emptyLabel={ar ? 'غير موجودة؟ سجّلها من الرابط أدناه' : 'Not found? Register it below'}
                options={vehicles.filter((v) => v.supplier).map((v) => ({
                  // Our own fleet is deliberately absent here — it gets its own
                  // section later; shipment trucks are the suppliers' for now.
                  value: v._id,
                  label: [v.plate, v.name].filter(Boolean).join(' — '),
                  hint: [supplierOf(v), v.defaultDriverName].filter(Boolean).join(' · '),
                }))} />
              <button type="button" onClick={() => { setNewVehicleOpen((o) => !o); setVehicleId(''); }}
                className="mt-1.5 text-xs font-semibold text-[#f37121] hover:underline">
                {newVehicleOpen ? (ar ? 'إلغاء تسجيل السيارة الجديدة' : 'Cancel new vehicle') : (ar ? '+ سيارة جديدة (إن لم تكن في القائمة)' : '+ New vehicle (if not listed)')}
              </button>
            </div>
            <div>
              <label className={labelCls}>{ar ? 'السائق' : 'Driver'}</label>
              <input value={form.driverName || ''} onChange={(e) => set('driverName', e.target.value)}
                placeholder={ar ? 'يُملأ تلقائياً عند اختيار السيارة' : 'Autofills from the vehicle'} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ar ? 'جوال السائق' : 'Driver phone'}</label>
              <div className="flex items-center gap-2">
                <input value={form.driverPhone || ''} onChange={(e) => set('driverPhone', e.target.value)} className={`${inputCls} flex-1`} />
                {(form.driverPhone || '').trim() && <ContactButtons phone={form.driverPhone} />}
              </div>
            </div>
          </div>

          {newVehicleOpen && (
            <div className="rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{ar ? 'رقم اللوحة *' : 'Plate *'}</label>
                  <input value={newVehicle.plate} onChange={(e) => setNewVehicle((v) => ({ ...v, plate: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ar ? 'وصف السيارة (اختياري)' : 'Description (optional)'}</label>
                  <input value={newVehicle.name} onChange={(e) => setNewVehicle((v) => ({ ...v, name: e.target.value }))}
                    placeholder={ar ? 'مثال: مرسيدس بيضاء' : 'e.g. white Actros'} className={inputCls} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{ar ? 'مالك السيارة:' : 'Owner:'}</span>
                {([
                  { k: 'supplier', label: ar ? 'مورد موجود' : 'Existing supplier' },
                  { k: 'newSupplier', label: ar ? 'مورد جديد' : 'New supplier' },
                ] as const).map((o) => (
                  <button key={o.k} type="button" onClick={() => setNewVehicle((v) => ({ ...v, owner: o.k }))}
                    className={`px-3.5 py-2 rounded-full border text-sm font-semibold transition-all ${newVehicle.owner === o.k
                      ? 'border-[#f37121] bg-[#f37121] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              {newVehicle.owner === 'supplier' && (
                <SearchableSelect value={newVehicle.supplierId} onChange={(x) => setNewVehicle((v) => ({ ...v, supplierId: x }))} searchAfter={0}
                  placeholder={ar ? 'اختر المورد…' : 'Pick the supplier…'}
                  searchPlaceholder={ar ? 'اكتب اسم المورد…' : 'Type supplier name…'}
                  options={suppliers.map((sp) => ({ value: sp._id, label: sp.name, hint: sp.type === 'freelancer' ? (ar ? 'فريلانسر' : 'Freelancer') : (ar ? 'شركة' : 'Company') }))} />
              )}
              {newVehicle.owner === 'newSupplier' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={newVehicle.supplierName} onChange={(e) => setNewVehicle((v) => ({ ...v, supplierName: e.target.value }))}
                    placeholder={ar ? 'اسم المورد الجديد *' : 'New supplier name *'} className={inputCls + ' flex-1'} />
                  {([['company', ar ? 'شركة' : 'Company'], ['freelancer', ar ? 'فريلانسر' : 'Freelancer']] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setNewVehicle((v) => ({ ...v, supplierType: k }))}
                      className={`px-4 py-2 rounded-full border text-sm font-semibold ${newVehicle.supplierType === k
                        ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">{ar ? 'تُسجَّل تلقائياً في صفحة المورّدين والمركبات عند حفظ الشحنة.' : 'Registers automatically on the fleet page when the shipment saves.'}</p>
            </div>
          )}
        </div>
      ), { id: SEC.truck })}
      </div>

      {/* 3..6 ── the config-driven groups */}
      {activeGroups.map((g, i) => {
        const gf = fields.filter((f) => f.group === g && !FIXED_KEYS.has(f.key));
        const cols = g === 'pickup_delivery'
          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
          : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
        return (
          <div key={g}>
            {sectionCard(GROUP_ICONS[g], i + 3, ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en, (
              <div className={cols}>{gf.map(renderField)}</div>
            ), { id: SEC.group(g), missing: missingIn(g) })}
          </div>
        );
      })}

      {sectionCard(Check, activeGroups.length + 3, ar ? 'الحالة والملاحظات' : 'Status & notes', (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'الحالة' : 'Status'}</label>
            <Select value={form.status || 'requesting'} onChange={(e) => set('status', e.target.value)}>
              {ORDER_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
            </Select>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'المندوب' : 'Agent'}</label>
            <input value={`${user?.firstName || ''} ${user?.lastName || ''}`.trim()} readOnly disabled className={inputCls + ' opacity-70'} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
            <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
          </div>
        </div>
      ), { id: SEC.status })}

      {/* Sticky save bar: the margin the shipment is booked at, the answers that
          still block it (named, not counted), and the button — one strip. */}
      <div className="fixed bottom-0 inset-x-0 lg:ms-64 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
        {missingChips.length > 0 && showErrors && (
          <div className="px-4 sm:px-6 pt-2.5 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1.5">
              {missingChips.map((c) => (
                <button key={c.key} type="button" onClick={() => jumpTo(c.to)}
                  className="px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-100">
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            {/* The deal, live. Selling below cost is a decision, not a typo —
                so it is shown in red while it can still be changed. */}
            {hasDeal ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-500">{ar ? 'بيع' : 'Sell'} <b className="text-slate-900">{money(sell)}</b></span>
                <span className="text-slate-300">−</span>
                <span className="text-slate-500">{ar ? 'شراء' : 'Buy'} <b className="text-slate-900">{money(buy)}</b></span>
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold ${
                  (dealMargin as number) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {(dealMargin as number) >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {money(dealMargin as number)}
                  <span className="opacity-70 font-semibold">({Math.round(((dealMargin as number) / sell) * 100)}%)</span>
                </span>
              </div>
            ) : (
              <p className="text-xs text-slate-400">{ar ? 'أدخل سعر البيع والشراء ليظهر الهامش' : 'Enter sell and buy prices to see the margin'}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-slate-500 hidden sm:block">
              {missingKeys.size > 0
                ? (showErrors
                  ? <span className="text-red-600 font-semibold">{ar ? `${missingKeys.size} حقول مطلوبة ناقصة` : `${missingKeys.size} required missing`}</span>
                  : (ar ? `${missingKeys.size} حقول مطلوبة متبقية` : `${missingKeys.size} required fields left`))
                : <span className="text-emerald-600 font-semibold">{ar ? 'اكتملت جميع الحقول المطلوبة ✓' : 'All required complete ✓'}</span>}
            </p>
            <button type="button" onClick={() => router.push('/system/shipment-orders')}
              className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الشحنة' : 'Create shipment')}
            </PrimaryButton>
          </div>
        </div>
      </div>

    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary in the app router.
  return <Suspense fallback={<Spinner />}><CreateShipmentInner /></Suspense>;
}
