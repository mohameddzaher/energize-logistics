'use client';
/**
 * «طلب شحنة»: the sales half of creating a shipment. The same configured inputs as the shipment form (section
 * settings), minus the execution (supplier, truck, driver, purchase price), which the vendors team adds when placing.
 * Used on the Shipment Orders and Sales pages; a request saved on either is the same row everywhere.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, SearchableSelect, PhoneSA } from '@/components/hr/HRKit';
import {
  type FormField, type OrderCustomer, GROUP_LABELS, fieldLabel, optionLabel, type Lang,
} from '@/lib/shipmentOrders';
import { findRoute, VENDOR_FORM_KEYS, type ShipmentRequest } from '@/lib/shipmentRequests';
import { Check, Loader2, MapPin, Package, Clock3, Wallet, Users, Minus, Plus, Send, AlertCircle, UserPlus, Sparkles } from 'lucide-react';

const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
const labelMissCls = 'block text-sm font-semibold text-red-600 mb-1.5';
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
const inputMissCls = 'w-full px-3 py-2.5 rounded-lg bg-red-50 border border-red-400 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50';
const SYSTEM_KEYS = new Set(['fromCity', 'toCity', 'branch', 'notes', 'blNumber', 'containerNumber', 'truckType', 'cargoType', 'truckLength', 'quantity',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'paymentSubtype', 'paymentMethod']);
const GROUP_ICONS: Record<FormField['group'], any> = { pickup_delivery: MapPin, shipment: Package, pricing_time: Clock3, payment: Wallet };
const toDateInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => toDateInput(new Date().toISOString());

export default function ShipmentRequestForm({ editId, onDone }: { editId?: string | null; onDone?: (r: ShipmentRequest) => void }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [fields, setFields] = useState<FormField[]>([]);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [reps, setReps] = useState<{ value: string; label: string; roleAr?: string }[]>([]);
  const [form, setForm] = useState<Record<string, any>>({ pickupTime: today(), startTime: today() });
  const [customerId, setCustomerId] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [trucks, setTrucks] = useState(1);
  const [loaded, setLoaded] = useState<ShipmentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [newCust, setNewCust] = useState<{ open: boolean; name: string; phone: string; busy: boolean }>({ open: false, name: '', phone: '', busy: false });
  const [addingFor, setAddingFor] = useState('');
  const [newOption, setNewOption] = useState('');

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [f, c, r] = await Promise.all([
          api.get<{ fields: FormField[] }>('/api/shipment-orders/fields'),
          api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers?picker=1'),
          api.get<{ options: { value: string; label: string; roleAr?: string }[] }>('/api/shipment-orders/sales-reps'),
        ]);
        setFields((f.fields || []).filter((x) => x.active !== false && !VENDOR_FORM_KEYS.has(x.key)));
        setCustomers(c.customers || []);
        setReps(r.options || []);
        if (editId) {
          const d = await api.get<{ request: ShipmentRequest }>(`/api/shipment-requests/${editId}`);
          const q = d.request;
          setLoaded(q);
          setForm({ ...q, ...(q.customFields || {}), truckTypes: (q as any).truckTypes?.length ? (q as any).truckTypes : (q.truckType ? [q.truckType] : []), pickupTime: toDateInput(q.pickupTime), startTime: toDateInput(q.startTime), arrivalTime: toDateInput(q.arrivalTime) });
          setCustomerId(String(q.customer || ''));
          setSalesRep(String(q.salesRep || ''));
          setTrucks(q.trucks || 1);
        } else if (user?._id && (r.options || []).some((o) => o.value === String(user._id))) {
          setSalesRep(String(user._id));
        }
      } catch (e: any) { notify(e?.message || t('تعذّر تحميل النموذج', 'Could not load the form'), 'error'); }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Options added by a colleague (a new truck length) appear without reopening.
  useSocket('shipmentOrders:fields', useCallback(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields').then((d) => setFields((d.fields || []).filter((x) => x.active !== false && !VENDOR_FORM_KEYS.has(x.key)))).catch(() => {});
  }, []));
  useSocket('shipmentOrders:customers', useCallback(() => {
    api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers?picker=1').then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []));

  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);

  // The customer's last price on this route is offered, never written over a price already typed, and never on an edit.
  useEffect(() => {
    if (editId || !customer) { setSuggested(null); return; }
    const route = findRoute(customer, form.fromCity, form.toCity);
    setSuggested(route?.price != null ? Number(route.price) : null);
  }, [customer, form.fromCity, form.toCity, editId]);

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x._id === id);
    const dflt = (c as any)?.defaults || {};
    setForm((f) => {
      const n = { ...f };
      (['cargoType', 'branch'] as const).forEach((k) => { if (!n[k] && dflt[k]) n[k] = dflt[k]; });
      if (!(n.truckTypes || []).length && dflt.truckType) n.truckTypes = [dflt.truckType];
      return n;
    });
  };

  const saveCustomer = async () => {
    if (!newCust.name.trim()) { notify(t('اكتب اسم العميل', 'Name the customer'), 'error'); return; }
    setNewCust((s) => ({ ...s, busy: true }));
    try {
      const d = await api.post<{ customer: OrderCustomer }>('/api/shipment-orders/customers', { name: newCust.name.trim(), phone: newCust.phone.trim() });
      setCustomers((p) => [d.customer, ...p]);
      setCustomerId(d.customer._id);
      setNewCust({ open: false, name: '', phone: '', busy: false });
      notify(t(`سُجِّل العميل «${d.customer.name}»`, `Customer “${d.customer.name}” registered`), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر تسجيل العميل', 'Could not register'), 'error'); setNewCust((s) => ({ ...s, busy: false })); }
  };

  const missing = useMemo(() => {
    const m = new Set<string>();
    if (!customerId) m.add('customer');
    fields.forEach((f) => { if (f.required && (f.key === 'truckType' ? !(form.truckTypes || []).length : !String(form[f.key] ?? '').trim())) m.add(f.key); });
    if (!(Number(form.sellPrice) > 0)) m.add('sellPrice');
    ['fromCity', 'toCity'].forEach((k) => { if (!String(form[k] ?? '').trim()) m.add(k); });
    return m;
  }, [fields, form, customerId]);

  const saveOption = async (f: FormField) => {
    const v = newOption.trim();
    if (!v) return;
    try {
      const d = await api.post<{ field: FormField }>(`/api/shipment-orders/fields/${f._id}/options`, { ar: v });
      setFields((p) => p.map((x) => (x._id === f._id ? d.field : x)));
      set(f.key, v);
      setAddingFor(''); setNewOption('');
    } catch (e: any) { notify(e?.message || t('تعذّرت الإضافة', 'Could not add'), 'error'); }
  };

  const submit = async (resubmit = false) => {
    if (missing.size) { setShowErrors(true); notify(t('أكمِل الحقول المحدّدة باللون الأحمر', 'Fill the fields marked in red'), 'error'); return; }
    setSaving(true);
    try {
      const body: Record<string, any> = { customFields: {} };
      fields.forEach((f) => {
        if (f.key === 'truckType') return;
        const v = form[f.key];
        if (v === undefined) return;
        if (SYSTEM_KEYS.has(f.key)) body[f.key] = v; else body.customFields[f.key] = v;
      });
      ['notes', 'blNumber', 'containerNumber'].forEach((k) => { body[k] = String(form[k] || '').trim(); });
      ['pickupTime', 'startTime', 'arrivalTime'].forEach((k) => { if (k in body || form[k]) body[k] = form[k] ? new Date(`${form[k]}T12:00:00`).toISOString() : null; });
      ['quantity', 'sellPrice'].forEach((k) => { if (body[k] === '' || body[k] == null) body[k] = null; else body[k] = Number(body[k]); });
      body.sellPrice = Number(form.sellPrice);
      body.customer = customerId;
      body.salesRep = salesRep || null;
      body.trucks = trucks;
      // Sales may accept several truck types; the vendors team fixes the one actually sent.
      body.truckTypes = form.truckTypes || [];
      let d: { request: ShipmentRequest };
      if (editId) d = await api.put(`/api/shipment-requests/${editId}`, { ...body, resubmit });
      else d = await api.post('/api/shipment-requests', body);
      notify(editId
        ? (resubmit ? t(`أُعيد إرسال الطلب رقم ${d.request.number} إلى فريق الموردين`, `Request ${d.request.number} resent`) : t('حُفظ الطلب', 'Saved'))
        : t(`أُرسل طلب الشحنة رقم ${d.request.number} إلى فريق الموردين`, `Request ${d.request.number} sent to the vendors team`), 'success');
      if (!editId) { setForm({ pickupTime: today(), startTime: today(), truckTypes: [] }); setCustomerId(''); setTrucks(1); setShowErrors(false); }
      onDone?.(d.request);
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  if (loading) return <Spinner />;
  const miss = (k: string) => showErrors && missing.has(k);

  const renderField = (f: FormField) => {
    const label = fieldLabel(f, lang as Lang);
    const v = form[f.key] ?? '';
    const bad = miss(f.key);
    const required = f.required || f.key === 'sellPrice' || f.key === 'fromCity' || f.key === 'toCity';
    const lab = <label className={bad ? labelMissCls : labelCls}>{label}{required && <span className="text-red-500"> *</span>}</label>;
    // Truck type is a multi-choice on a request: any ticked type is acceptable for this load.
    if (f.key === 'truckType') {
      const picked: string[] = form.truckTypes || [];
      const toggle = (k: string) => set('truckTypes', picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
      return (
        <div key={f._id} className="col-span-full">
          {lab}
          <p className="-mt-0.5 mb-1.5 text-[11.5px] text-slate-500">{t('اختر نوعًا أو أكثر يصلح لهذه الحمولة، ويحدّد فريق الموردين النوعَ النهائيّ لكلّ شاحنة.', 'Tick one or more types that suit this load; the vendors team fixes the final type per truck.')}</p>
          <div className={`flex flex-wrap gap-2 ${bad ? 'p-2 rounded-xl border border-red-300 bg-red-50/50' : ''}`}>
            {f.options.map((o) => {
              const on = picked.includes(o.key);
              return (
                <button key={o.key} type="button" onClick={() => toggle(o.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${on
                    ? 'border-[#f37121] bg-[#f37121] text-white shadow-md shadow-[#f37121]/25'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/40 hover:bg-[#f37121]/[0.04]'}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'border-white bg-white/20' : 'border-slate-300'}`}>{on && <Check className="w-3 h-3" />}</span>
                  {optionLabel(o, lang as Lang)}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    switch (f.inputType) {
      case 'cards':
        return (
          <div key={f._id} className="col-span-full">
            {lab}
            <div className={`flex flex-wrap gap-2 ${bad ? 'p-2 rounded-xl border border-red-300 bg-red-50/50' : ''}`}>
              {f.options.map((o) => (
                <button key={o.key} type="button" onClick={() => set(f.key, o.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${v === o.key
                    ? 'border-[#f37121] bg-[#f37121] text-white shadow-md shadow-[#f37121]/25'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/40 hover:bg-[#f37121]/[0.04]'}`}>
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${v === o.key ? 'border-white bg-white/20' : 'border-slate-300'}`}>{v === o.key && <Check className="w-3 h-3" />}</span>
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
            <div className={bad ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
              <SearchableSelect value={v} onChange={(x) => set(f.key, x)} searchAfter={0}
                placeholder={t(`اختر ${label}`, `Choose ${label}`)} searchPlaceholder={t('اكتب للبحث…', 'Type to search…')} emptyLabel={t('لا نتائج', 'No matches')}
                options={f.options.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
            </div>
            {(f as any).locked ? null : addingFor === f._id ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input autoFocus value={newOption} onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveOption(f); if (e.key === 'Escape') setAddingFor(''); }}
                  placeholder={t(`${label} الجديد…`, `New ${label}…`)} className={`${inputCls} flex-1`} />
                <button type="button" onClick={() => saveOption(f)} className="px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold">{t('إضافة', 'Add')}</button>
                <button type="button" onClick={() => setAddingFor('')} className="px-2 py-2 text-slate-400 text-sm">{t('إلغاء', 'Cancel')}</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setAddingFor(f._id); setNewOption(''); }} className="mt-1 text-[12px] font-semibold text-[#f37121] hover:underline">+ {t(`إضافة ${label}`, `Add ${label}`)}</button>
            )}
          </div>
        );
      case 'number':
        if (f.key === 'sellPrice') {
          return (
            <div key={f._id}>
              {lab}
              <input type="number" min={0} value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} />
              {suggested != null && String(v) !== String(suggested) && (
                <button type="button" onClick={() => set('sellPrice', suggested)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 hover:underline">
                  <Sparkles className="w-3.5 h-3.5" />{t(`آخر سعرٍ لهذا العميل على المسار: ${suggested.toLocaleString('en-US')} — استخدمه`, `Last price on this route: ${suggested} — use it`)}
                </button>
              )}
            </div>
          );
        }
        return <div key={f._id}>{lab}<input type="number" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      case 'date':
        return <div key={f._id}>{lab}<input type="date" value={v} onChange={(e) => set(f.key, e.target.value)} className={`${bad ? inputMissCls : inputCls} [color-scheme:light]`} /></div>;
      case 'datetime':
        return <div key={f._id}>{lab}<input type="datetime-local" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      case 'textarea':
        return <div key={f._id} className="col-span-full">{lab}<textarea rows={2} value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      default:
        return <div key={f._id}>{lab}<input value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
    }
  };

  const groups: FormField['group'][] = ['pickup_delivery', 'shipment', 'pricing_time', 'payment'];
  const byGroup = (g: FormField['group']) => fields.filter((f) => f.group === g && f.key !== 'notes').sort((a, b) => a.order - b.order);
  const notesConfigured = fields.some((f) => f.key === 'notes');
  const missIn = (g: FormField['group']) => byGroup(g).filter((f) => missing.has(f.key)).length + (g === 'pickup_delivery' ? ['fromCity', 'toCity'].filter((k) => missing.has(k) && !byGroup(g).some((f) => f.key === k)).length : 0);
  const card = (no: number, Icon: any, title: string, missN: number, children: React.ReactNode) => (
    <div className={`rounded-2xl border bg-white shadow-sm ${showErrors && missN ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="px-4 sm:px-5 py-3.5 bg-slate-50/70 border-b border-slate-100 flex items-center gap-3 rounded-t-2xl">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${!missN ? 'bg-emerald-100 text-emerald-700' : showErrors ? 'bg-red-100 text-red-700' : 'bg-[#f37121]/15 text-[#f37121]'}`}>{!missN ? <Check className="w-4 h-4" /> : no}</span>
        <Icon className="w-4 h-4 text-slate-400" />
        <p className="text-base font-bold text-slate-900">{title}</p>
        {missN > 0 && <span className={`ms-auto text-xs font-semibold px-2 py-1 rounded-full ${showErrors ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{t(`${missN} مطلوب`, `${missN} required`)}</span>}
      </div>
      <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </div>
  );

  const rejected = loaded?.status === 'rejected';
  const locked = !!loaded && !['pending', 'in_progress', 'rejected'].includes(loaded.status);

  return (
    <div className="space-y-4 pb-24" dir={isRTL ? 'rtl' : 'ltr'}>
      {rejected && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold text-red-800">{t(`رفض فريقُ الموردين هذا الطلب: ${loaded?.rejectReason}`, `Rejected by the vendors team: ${loaded?.rejectReason}`)}</p>
            {loaded?.rejectNote && <p className="text-red-700 mt-0.5">{loaded.rejectNote}</p>}
            <p className="text-red-700/80 mt-1 text-[12.5px]">{t('عدّل ما يلزم ثمّ اضغط «حفظ وإعادة الإرسال».', 'Amend it, then press “Save and resend”.')}</p>
          </div>
        </div>
      )}
      {locked && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{t('الطلبُ مغلق؛ تُعدَّل أوامرُ النقل نفسُها من صفحة الشحنات.', 'This request is closed; edit its transport orders from the shipments page.')}</div>}

      {card(1, Users, t('العميل ومندوب المبيعات', 'Customer & operational sales'), missing.has('customer') ? 1 : 0, (
        <>
          <div className="sm:col-span-2">
            <label className={miss('customer') ? labelMissCls : labelCls}>{t('العميل', 'Customer')}<span className="text-red-500"> *</span></label>
            <div className={miss('customer') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
              <SearchableSelect value={customerId} onChange={pickCustomer} searchAfter={0} disabled={!!loaded?.placed?.length}
                placeholder={t('اختر العميل', 'Choose the customer')} searchPlaceholder={t('اكتب اسم العميل أو رقمه…', 'Type the customer name…')}
                options={customers.map((c) => ({ value: c._id, label: c.name, hint: (c as any).customerCode || c.phone || '' }))} />
            </div>
            {!loaded?.placed?.length && (newCust.open ? (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input value={newCust.name} onChange={(e) => setNewCust((s) => ({ ...s, name: e.target.value }))} placeholder={t('اسم العميل الجديد', 'New customer name')} className={inputCls} />
                <PhoneSA value={newCust.phone} onChange={(v: string) => setNewCust((s) => ({ ...s, phone: v }))} />
                <div className="flex gap-1.5">
                  <button type="button" onClick={saveCustomer} disabled={newCust.busy} className="flex-1 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-50">{newCust.busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('تسجيل', 'Register')}</button>
                  <button type="button" onClick={() => setNewCust({ open: false, name: '', phone: '', busy: false })} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm">{t('إلغاء', 'Cancel')}</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setNewCust((s) => ({ ...s, open: true }))} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[#f37121] hover:underline"><UserPlus className="w-3.5 h-3.5" />{t('عميلٌ جديد', 'New customer')}</button>
            ))}
          </div>
          <div>
            <label className={labelCls}>{t('مندوب المبيعات — مَن جاء بالحمولة', 'Operational sales — who brought the load')}</label>
            <SearchableSelect value={salesRep} onChange={setSalesRep} searchAfter={0} placeholder={t('اختر', 'Choose')}
              options={reps.map((r) => ({ value: r.value, label: r.label, hint: r.roleAr || '' }))} />
          </div>
          <div>
            <label className={labelCls}>{t('عدد الشاحنات بنفس المواصفات', 'Trucks with the same specs')}</label>
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
              <button type="button" onClick={() => setTrucks((n) => Math.max(Math.max(1, loaded?.placed?.length || 0), n - 1))} className="px-3 py-2.5 text-slate-600 hover:bg-slate-50"><Minus className="w-4 h-4" /></button>
              <input type="number" min={1} max={25} value={trucks} onChange={(e) => setTrucks(Math.min(25, Math.max(1, Number(e.target.value) || 1)))} className="w-16 text-center py-2 text-sm font-bold tabular-nums focus:outline-none" />
              <button type="button" onClick={() => setTrucks((n) => Math.min(25, n + 1))} className="px-3 py-2.5 text-slate-600 hover:bg-slate-50"><Plus className="w-4 h-4" /></button>
            </div>
            <p className="mt-1 text-[11.5px] text-slate-500">{t('كلّ شاحنةٍ تصير أمرَ نقلٍ مستقلًّا عند إكمالها', 'Each truck becomes its own transport order when placed')}</p>
          </div>
        </>
      ))}

      {groups.map((g, i) => {
        const list = byGroup(g);
        if (!list.length && g !== 'pickup_delivery') return null;
        return (
          <div key={g}>
            {card(i + 2, GROUP_ICONS[g], ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en, missIn(g), (
              <>
                {list.map(renderField)}
                {g === 'pickup_delivery' && (
                  <>
                    {!notesConfigured && (
                      <div className="col-span-full"><label className={labelCls}>{t('ملاحظة الرحلة', 'Trip note')}</label>
                        <textarea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inputCls} placeholder={t('تُطبع على أمر النقل', 'Printed on the transport order')} /></div>
                    )}
                    <div><label className={labelCls}>{t('رقم البوليصة (اختياري)', 'B/L number (optional)')}</label><input value={form.blNumber || ''} onChange={(e) => set('blNumber', e.target.value)} className={inputCls} /></div>
                    <div><label className={labelCls}>{t('رقم الحاوية (اختياري)', 'Container number (optional)')}</label><input value={form.containerNumber || ''} onChange={(e) => set('containerNumber', e.target.value)} className={inputCls} /></div>
                  </>
                )}
              </>
            ))}
          </div>
        );
      })}

      {!locked && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 lg:ps-72">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[12.5px] text-slate-600">
              {missing.size
                ? <span className="text-red-600 font-semibold">{t(`ينقص ${missing.size}: `, `${missing.size} missing: `)}{[...missing].map((k) => (k === 'customer' ? t('العميل', 'Customer') : fieldLabel(fields.find((f) => f.key === k) || ({ labelAr: k } as any), lang as Lang))).join('، ')}</span>
                : <span className="text-emerald-700 font-semibold">{t(`جاهز — ${trucks} ${trucks > 1 ? 'شاحنات' : 'شاحنة'} · سعر البيع ${Number(form.sellPrice || 0).toLocaleString('en-US')}`, `Ready — ${trucks} truck(s) · selling ${form.sellPrice}`)}</span>}
            </div>
            <div className="ms-auto flex gap-2">
              {rejected && (
                <button type="button" onClick={() => submit(true)} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold shadow-md disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('حفظ وإعادة الإرسال', 'Save and resend')}
                </button>
              )}
              <button type="button" onClick={() => submit(false)} disabled={saving}
                className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold shadow-md disabled:opacity-50 ${rejected ? 'bg-white border border-slate-200 text-slate-700' : 'bg-[#f37121] text-white'}`}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editId ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                {editId ? t('حفظ التعديل', 'Save') : t('إرسال الطلب إلى فريق الموردين', 'Send to the vendors team')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
