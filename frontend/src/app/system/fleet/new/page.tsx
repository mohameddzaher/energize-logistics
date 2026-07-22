'use client';
// إنشاء حمولة — booking one of OUR trucks. Picking the vehicle answers most of
// the form on the spot: its seated drivers (with their status), trailer type,
// GPS type, plate. Picking a driver seated on another truck moves him here —
// the swap the operations team asked to do WITHOUT visiting the drivers page.
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Truck, ArrowRight, Check, Loader2, X, UserPlus, User as UserIcon,
  MapPin, Satellite, Users as UsersIcon, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { Spinner, PageHeader, Select, SearchableSelect, PrimaryButton, SmallBadge } from '@/components/hr/HRKit';
import {
  FleetVehicle, FleetDriver, FleetCustomer, FLEET_STATUSES, fmtDT,
  canEditFleet, Lang,
} from '@/lib/fleet';

const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

const toLocalInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toLocalDate = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

function CreateFleetShipmentInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const params = useSearchParams();
  const editId = params?.get('id') || null;
  const { notify } = useDialog();

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [customers, setCustomers] = useState<FleetCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [secondDriverId, setSecondDriverId] = useState('');
  const [form, setForm] = useState<Record<string, any>>({ status: 'requesting' });

  useEffect(() => {
    (async () => {
      try {
        const [v, d, c] = await Promise.all([
          api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
          api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers'),
          api.get<{ customers: FleetCustomer[] }>('/api/fleet/customers'),
        ]);
        setVehicles(v.vehicles || []);
        setDrivers(d.drivers || []);
        setCustomers(c.customers || []);
        if (editId) {
          const s = await api.get<{ shipment: any }>(`/api/fleet/shipments/${editId}`);
          const o = s.shipment;
          if (o) {
            setForm({
              status: o.status, fromCity: o.fromCity || '', toCity: o.toCity || '',
              loadDate: toLocalDate(o.loadDate), expectedArrival: toLocalInput(o.expectedArrival),
              notes: o.notes || '',
            });
            setCustomerId(typeof o.customer === 'object' ? o.customer?._id || '' : (o.customer || ''));
            setVehicleId(typeof o.vehicle === 'object' ? o.vehicle?._id || '' : (o.vehicle || ''));
            setDriverId(typeof o.driver === 'object' ? o.driver?._id || '' : (o.driver || ''));
            setSecondDriverId(typeof o.secondDriver === 'object' ? o.secondDriver?._id || '' : (o.secondDriver || ''));
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, [editId]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const vehicle = useMemo(() => vehicles.find((v) => v._id === vehicleId) || null, [vehicles, vehicleId]);
  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);
  const driverOf = (id: string) => drivers.find((d) => d._id === id) || null;

  // Picking the truck seats its own drivers into the two slots automatically.
  const applyVehicle = (id: string) => {
    setVehicleId(id);
    const v = vehicles.find((x) => x._id === id);
    if (!v) return;
    const seated = v.drivers || [];
    if (seated[0]) setDriverId(seated[0]._id);
    if (seated[1]) setSecondDriverId(seated[1]._id);
    else setSecondDriverId('');
  };

  const vehicleOfDriver = (d: FleetDriver) => {
    const vid = typeof d.vehicle === 'object' ? d.vehicle?._id : d.vehicle;
    return vehicles.find((v) => v._id === vid) || null;
  };

  // The swap warning: choosing a driver seated elsewhere states what will
  // happen BEFORE the save does it.
  const moveHint = (id: string) => {
    if (!id || !vehicle) return '';
    const d = driverOf(id);
    if (!d) return '';
    const cur = vehicleOfDriver(d);
    if (cur && cur._id !== vehicle._id) {
      return ar
        ? `سيُنقل ${d.name} من السيارة ${cur.plate} إلى ${vehicle.plate} عند الحفظ.`
        : `${d.name} moves from ${cur.plate} to ${vehicle.plate} on save.`;
    }
    return '';
  };

  const driverOption = (d: FleetDriver) => {
    const cur = vehicleOfDriver(d);
    return {
      value: d._id,
      label: d.name,
      hint: [
        cur ? (ar ? `على ${cur.plate}` : `on ${cur.plate}`) : (ar ? 'بدون سيارة' : 'unassigned'),
        d.working ? (ar ? 'يعمل' : 'working') : (ar ? 'لا يعمل' : 'off'),
      ].join(' · '),
    };
  };

  const save = async () => {
    if (!customerId && !newCustomer.name.trim()) {
      notify(ar ? 'اختر العميل أو سجّل عميلاً جديداً.' : 'Pick or register a customer.', 'error');
      return;
    }
    if (!vehicleId) { notify(ar ? 'اختر السيارة.' : 'Pick the vehicle.', 'error'); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        vehicle: vehicleId,
        driver: driverId || null,
        secondDriver: secondDriverId || null,
        fromCity: form.fromCity || '', toCity: form.toCity || '',
        loadDate: form.loadDate ? new Date(form.loadDate).toISOString() : null,
        expectedArrival: form.expectedArrival ? new Date(form.expectedArrival).toISOString() : null,
        status: form.status || 'requesting',
        notes: form.notes || '',
      };
      if (customerId) payload.customer = customerId;
      else payload.newCustomer = { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() };

      if (editId) await api.put(`/api/fleet/shipments/${editId}`, payload);
      else {
        const d = await api.post<{ shipment: any }>('/api/fleet/shipments', payload);
        notify(ar ? `تم إنشاء الحمولة — رقم البوليصة ${d.shipment.waybillNumber}` : `Created — waybill ${d.shipment.waybillNumber}`, 'success');
      }
      router.push('/system/fleet');
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!canEditFleet(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const card = (title: string, icon: any, children: React.ReactNode) => {
    const Icon = icon;
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50/70 border-b border-slate-100 flex items-center gap-2.5 rounded-t-2xl">
          <Icon className="w-4 h-4 text-[#f37121]" />
          <p className="text-base font-bold text-slate-900">{title}</p>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    );
  };

  return (
    <div className="space-y-5 w-full pb-24" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />}
        title={editId ? (ar ? 'تعديل حمولة' : 'Edit shipment') : (ar ? 'إنشاء حمولة' : 'Create shipment')}
        subtitle={ar ? 'سياراتنا فقط — اختيار السيارة يملأ بقية البيانات' : 'Our trucks only — the vehicle answers most of the form'}>
        <button type="button" onClick={() => router.push('/system/fleet')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {ar ? 'رجوع للقائمة' : 'Back'}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* العميل */}
        {card(ar ? 'العميل' : 'Customer', UserIcon, (
          <div className="space-y-3">
            {!newCustomerOpen ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <SearchableSelect value={customerId} onChange={setCustomerId} searchAfter={0}
                    placeholder={ar ? 'اختر العميل — اكتب الاسم للبحث…' : 'Pick the customer…'}
                    searchPlaceholder={ar ? 'اكتب اسم العميل…' : 'Type the name…'}
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
                  placeholder={ar ? 'الجوال' : 'Phone'} className={inputCls + ' sm:w-40'} />
                <button type="button" onClick={() => { setNewCustomerOpen(false); setNewCustomer({ name: '', phone: '' }); }}
                  className="p-2.5 text-slate-400 hover:text-slate-700" aria-label="close"><X className="w-4 h-4" /></button>
              </div>
            )}
            {customer && (customer.routes || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customer.routes.map((r, i) => (
                  <button key={i} type="button"
                    onClick={() => setForm((f) => ({ ...f, fromCity: r.fromCity, toCity: r.toCity }))}
                    className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-sm text-slate-700 font-medium transition-colors">
                    {r.fromCity} ← {r.toCity}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* السيارة — the answer machine */}
        {card(ar ? 'السيارة' : 'Vehicle', Truck, (
          <div className="space-y-3">
            <SearchableSelect value={vehicleId} onChange={applyVehicle} searchAfter={0}
              placeholder={ar ? 'اختر من سياراتنا — اكتب اللوحة أو اسم السائق…' : 'Pick one of our trucks…'}
              searchPlaceholder={ar ? 'اكتب رقم اللوحة أو اسم السائق…' : 'Type plate or driver…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={vehicles.map((v) => ({
                value: v._id,
                label: v.plate,
                hint: [
                  (v.drivers || []).map((d) => d.name).join(' + ') || (ar ? 'بدون سائق' : 'no driver'),
                  v.trailerType, v.gpsType,
                ].filter(Boolean).join(' · '),
              }))} />

            {/* Everything the truck answers, visible the moment it is picked. */}
            {vehicle && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'رقم السيارة' : 'Plate'}</p>
                  <p className="font-bold text-slate-900 font-mono">{vehicle.plate}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'نوع التيدر' : 'Trailer'}</p>
                  <p className="font-semibold text-slate-900">{vehicle.trailerType || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">GPS</p>
                  <p className="font-semibold text-slate-900 flex items-center gap-1"><Satellite className="w-3.5 h-3.5 text-[#f37121]" /> {vehicle.gpsType || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'السائقون عليها' : 'Seated drivers'}</p>
                  <p className="font-semibold text-slate-900">{(vehicle.drivers || []).map((d) => d.name).join(' + ') || '—'}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* السائقون */}
      {card(ar ? 'السائقون' : 'Drivers', UsersIcon, (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {([
            { id: driverId, setId: setDriverId, label: ar ? 'السائق الأساسي' : 'Primary driver' },
            { id: secondDriverId, setId: setSecondDriverId, label: ar ? 'سائق ثانٍ (اختياري — للوصول الأسرع)' : 'Second driver (optional)' },
          ]).map((slot, i) => {
            const d = driverOf(slot.id);
            const hint = moveHint(slot.id);
            return (
              <div key={i} className="space-y-2">
                <label className={labelCls}>{slot.label}</label>
                <SearchableSelect value={slot.id} onChange={slot.setId} searchAfter={0}
                  placeholder={ar ? 'اختر السائق — اكتب الاسم…' : 'Pick a driver…'}
                  searchPlaceholder={ar ? 'اكتب اسم السائق…' : 'Type the name…'}
                  emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
                  options={[{ value: '', label: ar ? '— بدون —' : '— none —' },
                    ...drivers.filter((x) => x._id !== (i === 0 ? secondDriverId : driverId)).map(driverOption)]} />
                {d && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SmallBadge bg={d.working ? 'bg-emerald-500/15' : 'bg-red-500/15'} text={d.working ? 'text-emerald-700' : 'text-red-700'}
                      label={d.working ? (ar ? 'يعمل' : 'Working') : (ar ? 'لا يعمل' : 'Off duty')} />
                    <SmallBadge bg={d.onSponsorship ? 'bg-blue-500/15' : 'bg-slate-500/15'} text={d.onSponsorship ? 'text-blue-700' : 'text-slate-600'}
                      label={d.onSponsorship ? (ar ? 'على الكفالة' : 'Sponsored') : (ar ? 'خارج الكفالة' : 'Not sponsored')} />
                    {d.phone && <span className="text-xs text-slate-500 font-mono">{d.phone}</span>}
                  </div>
                )}
                {hint && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{hint}</p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* المسار والتوقيت */}
      {card(ar ? 'المسار والتوقيت' : 'Route & timing', MapPin, (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'من' : 'From'}</label>
            <input value={form.fromCity || ''} onChange={(e) => set('fromCity', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'إلى' : 'To'}</label>
            <input value={form.toCity || ''} onChange={(e) => set('toCity', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'تاريخ التحميل' : 'Load date'}</label>
            <input type="date" value={form.loadDate || ''} onChange={(e) => set('loadDate', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'متوقع الوصول (اختياري)' : 'Expected arrival (optional)'}</label>
            <input type="datetime-local" value={form.expectedArrival || ''} onChange={(e) => set('expectedArrival', e.target.value)} className={inputCls} />
          </div>
        </div>
      ))}

      {/* الحالة والمشرف */}
      {card(ar ? 'الحالة والمشرف' : 'Status & supervisor', ShieldCheck, (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'الحالة' : 'Status'}</label>
            <Select value={form.status || 'requesting'} onChange={(e) => set('status', e.target.value)}>
              {FLEET_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
            </Select>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'المشرف' : 'Supervisor'}</label>
            {/* Stamped from the signed-in account, shown so it is no surprise. */}
            <input value={`${user?.firstName || ''} ${user?.lastName || ''}`.trim()} readOnly disabled className={inputCls + ' opacity-70'} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
            <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
          </div>
        </div>
      ))}

      <div className="fixed bottom-0 inset-x-0 lg:ms-64 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-6 py-3">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => router.push('/system/fleet')}
            className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {editId ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الحمولة' : 'Create shipment')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><CreateFleetShipmentInner /></Suspense>;
}
