'use client';
// Create load: booking one of OUR trucks. Picking the vehicle answers most of the form on the spot: its seated drivers (with status), trailer type, GPS type and plate. Picking a driver seated on another truck moves him here, the swap operations asked to do without visiting the drivers page.
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Truck, ArrowRight, Check, Loader2, X, UserPlus, User as UserIcon,
  MapPin, Satellite, Users as UsersIcon, ShieldCheck, ShieldOff, AlertTriangle,
} from 'lucide-react';
import { Spinner, PageHeader, Select, SearchableSelect, PrimaryButton, SmallBadge } from '@/components/hr/HRKit';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import {
  FleetVehicle, FleetDriver, FleetCustomer, FLEET_STATUSES, fmtDT,
  canEditFleet, vehicleAvailabilityText, seatsOf, Lang,
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
  const [branches, setBranches] = useState<{ _id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Is today Friday? Shows the Friday bonus button automatically at creation time.
  const isFriday = new Date().getDay() === 5;

  const [customerId, setCustomerId] = useState('');
  const loadedCustomer = useRef('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [secondDriverId, setSecondDriverId] = useState('');
  /**
   * A truck with overdue maintenance: a blocker, not a badge.
   * The server replies 409 with what is overdue and its name. The screen shows which maintenance, how far overdue, and a button that raises the request to the maintenance manager in fleet requests. Loading proceeds only after approval, consumed by this load alone.
   */
  const [form, setForm] = useState<Record<string, any>>({ status: 'requesting' });

  useEffect(() => {
    (async () => {
      try {
        const [v, d, c, b] = await Promise.all([
          api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
          api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers'),
          api.get<{ customers: FleetCustomer[] }>('/api/fleet/customers'),
          api.get<{ branches: { _id: string; name: string }[] }>('/api/branches?active=true').catch(() => ({ branches: [] })),
        ]);
        setVehicles(v.vehicles || []);
        setDrivers(d.drivers || []);
        setCustomers(c.customers || []);
        setBranches(b.branches || []);
        if (editId) {
          const s = await api.get<{ shipment: any }>(`/api/fleet/shipments/${editId}`);
          const o = s.shipment;
          if (o) {
            setForm({
              status: o.status, fromCity: o.fromCity || '', toCity: o.toCity || '',
              loadDate: toLocalDate(o.loadDate), expectedArrival: toLocalInput(o.expectedArrival),
              notes: o.notes || '',
              rentType: o.rentType || '', paymentType: o.paymentType || '', paymentSubtype: o.paymentSubtype || '', loadType: o.loadType || '',
              blNumber: o.blNumber || '', containerNumber: o.containerNumber || '',
              price: o.price ?? '', fullRent: o.fullRent ?? '', customerType: o.customerType || '',
              driverExpense: o.driverExpense ?? '', fridayBonus: !!o.fridayBonus, branch: o.branch || '',
            });
            const cid = typeof o.customer === 'object' ? o.customer?._id || '' : (o.customer || '');
            loadedCustomer.current = cid;
            setCustomerId(cid);
            setVehicleId(typeof o.vehicle === 'object' ? o.vehicle?._id || '' : (o.vehicle || ''));
            setDriverId(typeof o.driver === 'object' ? o.driver?._id || '' : (o.driver || ''));
            setSecondDriverId(typeof o.secondDriver === 'object' ? o.secondDriver?._id || '' : (o.secondDriver || ''));
          }
        }
      } catch (e: any) {
        notify(e?.message || 'Failed to load the form', 'error');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Customers update live: a new customer (from here or the customers page) appears in the dropdown immediately without reload.
  const reloadCustomers = useCallback(async () => {
    try { const c = await api.get<{ customers: FleetCustomer[] }>('/api/fleet/customers'); setCustomers(c.customers || []); } catch { /* noop */ }
  }, []);
  useSocket('fleet:customers', reloadCustomers);
  // Same for the truck and driver: make and color come from the vehicle register, name and residency from HR; they are what is written on the waybill, so they are read as they are now.
  const reloadCrew = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([
        api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
        api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers'),
      ]);
      setVehicles(v.vehicles || []);
      setDrivers(d.drivers || []);
    } catch { /* noop */ }
  }, []);
  useSocket('fleet:vehicles', reloadCrew);
  useSocket('fleet:drivers', reloadCrew);
  useSocket('vreg:updated', reloadCrew);
  useSocket('hr:employee', reloadCrew);

  // Payment types and From/To cities are the shipment orders' own lists, so a city added in their settings appears here at once.
  const [formOptions, setFormOptions] = useState<{ paymentSubtypes: { key: string; ar: string; en: string }[]; cities: string[] }>({ paymentSubtypes: [], cities: [] });
  const reloadFormOptions = useCallback(() => {
    api.get<{ paymentSubtypes: { key: string; ar: string; en: string }[]; cities: string[] }>('/api/fleet/form-options')
      .then((d) => setFormOptions({ paymentSubtypes: d.paymentSubtypes || [], cities: d.cities || [] })).catch(() => {});
  }, []);
  useEffect(() => { reloadFormOptions(); }, [reloadFormOptions]);
  useSocket('shipmentOrders:fields', reloadFormOptions);
  const cityOptions = (current: string) => {
    const list = current && !formOptions.cities.includes(current) ? [current, ...formOptions.cities] : formOptions.cities;
    return list.map((c) => ({ value: c, label: c }));
  };

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const vehicle = useMemo(() => vehicles.find((v) => v._id === vehicleId) || null, [vehicles, vehicleId]);
  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);
  // Choosing a customer fills what was agreed with them: category and payment type. Both stay editable, since the agreement is a default for a new load, not a constraint (a tax customer may pay one load in cash).
  // When editing, the loaded shipment's customer is not a 'selection': its payment type and category stay as saved (they used to reset to the customer default, saving a tax customer's load as cash without anyone touching it).
  useEffect(() => {
    if (!customer) return;
    if (loadedCustomer.current && loadedCustomer.current === customerId) return;
    loadedCustomer.current = '';
    setForm((f) => ({
      ...f,
      ...(customer.customerType ? { customerType: customer.customerType } : {}),
      ...(customer.paymentType ? { paymentType: customer.paymentType } : {}),
      ...(customer.paymentType === 'tax' ? { paymentSubtype: 'deferred_invoice' } : customer.paymentType === 'cash' ? { paymentSubtype: 'cash_ht' } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);
  const driverOf = (id: string) => drivers.find((d) => d._id === id) || null;

  /**
   * Picking the truck seats its own drivers into the two slots automatically.
   * Rank comes from the truck record, not arrival order. `seatsOf` reads the written seat (first/second); the slots used to be filled by whoever arrived first from the base, so a waybill could print the second driver in the primary position. Changing a slot here reorders the truck's seats on save: whoever is chosen primary for the load is its first driver.
   */
  const applyVehicle = (id: string) => {
    setVehicleId(id);
    const v = vehicles.find((x) => x._id === id);
    if (!v) return;
    const [first, second] = seatsOf(v);
    if (first) setDriverId(first._id);
    setSecondDriverId(second?._id || '');
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
    // The rent is required: fleet sales are counted from it.
    if (!(Number(form.price) > 0)) { notify(ar ? 'إيجار السيارة مطلوب — اكتب قيمة أكبر من صفر.' : 'Vehicle rent is required.', 'error'); return; }
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
        paymentSubtype: form.paymentSubtype || '', loadType: form.loadType || '',
        blNumber: String(form.blNumber || '').trim(), containerNumber: String(form.containerNumber || '').trim(),
        price: form.price === '' || form.price == null ? 0 : Number(form.price),
        fullRent: form.fullRent === '' || form.fullRent == null ? 0 : Number(form.fullRent),
        customerType: form.customerType || '',
        driverExpense: form.driverExpense === '' || form.driverExpense == null ? 0 : Number(form.driverExpense),
        fridayBonus: !!form.fridayBonus,
        branch: form.branch || '',
      };
      if (customerId) payload.customer = customerId;
      else payload.newCustomer = { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() };

      if (editId) {
        const out = await api.put<{ sellingRequestMessage?: string }>(`/api/fleet/shipments/${editId}`, payload);
        // A price change from the data team is held for approval.
        if (out?.sellingRequestMessage) notify(out.sellingRequestMessage, 'info');
      } else {
        const d = await api.post<{ shipment: any }>('/api/fleet/shipments', payload);
        notify(ar ? `تم إنشاء الحمولة — رقم أمر النقل ${d.shipment.waybillNumber}` : `Created — waybill ${d.shipment.waybillNumber}`, 'success');
      }
      router.push('/system/fleet');
    } catch (e: any) {
      notify(e.message, 'error');
    }
    setSaving(false);
  };


  if (!canEditFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
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
        {/* Customer */}
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
            {customer && (customer.paymentType || customer.taxNumber) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {customer.paymentType && (
                  <span className={`px-2.5 py-1 rounded-full font-semibold ${customer.paymentType === 'tax' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {ar ? 'المتفق عليه: ' : 'Agreed: '}{customer.paymentType === 'tax' ? (ar ? 'ضريبي' : 'Tax invoice') : (ar ? 'كاش' : 'Cash')}
                  </span>
                )}
                {customer.taxNumber && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-mono">{customer.taxNumber}</span>}
                <span className="text-slate-400">{ar ? 'مُلئ تلقائيًّا — عدِّله لهذه الحمولة إن اختلف.' : 'Prefilled — change it for this shipment if it differs.'}</span>
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

        {/* Vehicle: the answer machine */}
        {card(ar ? 'السيارة' : 'Vehicle', Truck, (
          <div className="space-y-3">
            <SearchableSelect value={vehicleId} onChange={applyVehicle} searchAfter={0}
              placeholder={ar ? 'اختر من سياراتنا — اكتب اللوحة أو اسم السائق…' : 'Pick one of our trucks…'}
              searchPlaceholder={ar ? 'اكتب رقم اللوحة أو اسم السائق…' : 'Type plate or driver…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={vehicles.map((v) => ({
                value: v._id,
                label: v.plate,
                // Clear colored badge: green available, amber has a load, blue unloading. Its text is searchable too: type a city to find that city's vehicles at once.
                badge: vehicleAvailabilityText(v, lang as Lang),
                tone: (v.trip ? (v.atDestination ? 'info' : 'busy') : 'ok') as 'ok' | 'busy' | 'info',
                hint: [
                  (v.drivers || []).map((d) => d.name).join(' + ') || (ar ? 'بدون سائق' : 'no driver'),
                  v.trailerType,
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
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'مكانها الآن' : 'Location now'}</p>
                  <p className="font-semibold text-slate-900 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-[#f37121]" /> {vehicle.live?.city || (ar ? 'خارج نطاق المدن' : 'Between cities')}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'نوع التيدر' : 'Trailer'}</p>
                  <p className="font-semibold text-slate-900">{vehicle.trailerType || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">{ar ? 'السائقون عليها' : 'Seated drivers'}</p>
                  <p className="font-semibold text-slate-900">
                    {(() => {
                      const [a, b] = seatsOf(vehicle);
                      if (!a && !b) return '—';
                      return [a && `${a.name}${ar ? ' (أول)' : ' (1st)'}`, b && `${b.name}${ar ? ' (ثانٍ)' : ' (2nd)'}`]
                        .filter(Boolean).join(' · ');
                    })()}
                  </p>
                </div>
              </div>
            )}
            {/* Warning: the selected vehicle already has an active load */}
            {vehicle?.trip && (
              <div className={`rounded-lg border px-3 py-2.5 text-xs font-medium ${vehicle.atDestination ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                {vehicle.atDestination
                  ? (ar
                    ? `هذه السيارة وصلت نطاق ${vehicle.trip.toCity} (أمر نقل ${vehicle.trip.waybillNumber}) — يُفترض أنها تُفرِّغ الآن وستتاح قريبًا.`
                    : `This truck reached ${vehicle.trip.toCity} (WB ${vehicle.trip.waybillNumber}) — presumably unloading, free soon.`)
                  : (ar
                    ? `انتبه: هذه السيارة عليها حمولة نشطة إلى ${vehicle.trip.toCity || '—'} (أمر نقل ${vehicle.trip.waybillNumber})${vehicle.trip.expectedArrival ? ` — الوصول المتوقع ${fmtDT(vehicle.trip.expectedArrival, lang as Lang)}` : ''}.`
                    : `Heads-up: this truck is carrying an active load to ${vehicle.trip.toCity || '—'} (WB ${vehicle.trip.waybillNumber})${vehicle.trip.expectedArrival ? ` — ETA ${fmtDT(vehicle.trip.expectedArrival, lang as Lang)}` : ''}.`)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Drivers */}
      {card(ar ? 'السائقون' : 'Drivers', UsersIcon, (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {([
            { id: driverId, setId: setDriverId, label: ar ? 'السائق الأول' : 'First driver' },
            { id: secondDriverId, setId: setSecondDriverId, label: ar ? 'السائق الثاني (اختياري — للوصول الأسرع)' : 'Second driver (optional)' },
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

      {/* Route and timing */}
      {card(ar ? 'المسار والتوقيت' : 'Route & timing', MapPin, (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'من' : 'From'}</label>
            <SearchableSelect value={form.fromCity || ''} onChange={(v) => set('fromCity', v)} searchAfter={0}
              placeholder={ar ? 'اختر المدينة — اكتب للبحث…' : 'City — type to search…'}
              searchPlaceholder={ar ? 'ابحث عن مدينة…' : 'Search…'} emptyLabel={ar ? 'لا نتائج' : 'No matches'}
              options={cityOptions(form.fromCity || '')} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'إلى' : 'To'}</label>
            <SearchableSelect value={form.toCity || ''} onChange={(v) => set('toCity', v)} searchAfter={0}
              placeholder={ar ? 'اختر المدينة — اكتب للبحث…' : 'City — type to search…'}
              searchPlaceholder={ar ? 'ابحث عن مدينة…' : 'Search…'} emptyLabel={ar ? 'لا نتائج' : 'No matches'}
              options={cityOptions(form.toCity || '')} />
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

      {/* Status and supervisor */}
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
            {/* The vehicle's assigned supervisor takes the load automatically; if it has none yet, the load is stamped with its creator. Shown here so it is not a surprise. */}
            <input
              value={vehicle?.supervisorName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()}
              readOnly disabled className={inputCls + ' opacity-70'} />
            {vehicle?.supervisorName && (
              <p className="text-[11px] text-slate-500 mt-1">{ar ? 'مشرف هذه السيارة — يُسند تلقائيًا' : "This truck's assigned supervisor — set automatically"}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>{ar ? 'نوع الدفع' : 'Payment type'}</label>
            <SearchableSelect value={form.paymentSubtype || ''} onChange={(v) => set('paymentSubtype', v)} searchAfter={0}
              placeholder={ar ? 'اختر نوع الدفع' : 'Payment type'}
              searchPlaceholder={ar ? 'اكتب للبحث…' : 'Search…'} emptyLabel={ar ? 'لا نتائج' : 'No matches'}
              options={formOptions.paymentSubtypes.map((o) => ({ value: o.key, label: ar ? o.ar : o.en }))} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'الفرع' : 'Branch'}</label>
            <SearchableSelect value={form.branch || ''} onChange={(v) => set('branch', v)} searchAfter={0}
              placeholder={ar ? 'اختر الفرع — اكتب للبحث…' : 'Branch — type to search…'}
              searchPlaceholder={ar ? 'ابحث عن فرع…' : 'Search…'} emptyLabel={ar ? 'لا نتائج' : 'No matches'}
              options={branches.map((b) => ({ value: b.name, label: b.name }))} />
          </div>
        </div>
      ))}

      {/* Load data and pricing */}
      {card(ar ? 'بيانات الحمولة والتسعير' : 'Load & pricing', UsersIcon, (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'إيجار السيارة' : 'Vehicle rent'} <span className="text-red-600">*</span></label>
            <input type="number" min={1} required value={form.price ?? ''} onChange={(e) => set('price', e.target.value)}
              className={`${inputCls} ${!(Number(form.price) > 0) ? 'border-red-300' : ''}`} placeholder="0" />
            <p className="text-[11px] text-slate-500 mt-1">{ar ? 'مطلوب — المبلغ الداخل لقسم إدارة الأسطول من هذه الحمولة.' : 'Required — the amount the fleet section earns from this load.'}</p>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'الإيجار كامل (اختياري)' : 'Full rent (optional)'}</label>
            <input type="number" min={0} value={form.fullRent ?? ''} onChange={(e) => set('fullRent', e.target.value)}
              className={inputCls} placeholder={ar ? 'ما يستلمه السائق من العميل' : 'what the driver collects'} />
            {(() => {
              const vr = Number(form.price) || 0; const fr = Number(form.fullRent) || 0;
              const diff = fr - vr;
              if (fr > 0 && diff > 0) return <p className="text-[11px] text-amber-700 mt-1">{ar ? `الفرق ${diff.toLocaleString('en-US')} ر.س يذهب لقسم الفروع.` : `Difference ${diff.toLocaleString('en-US')} SAR goes to the branches dept.`}</p>;
              if (fr > 0 && diff < 0) return <p className="text-[11px] text-red-600 mt-1">{ar ? 'الإيجار كامل أقل من إيجار السيارة — تحقّق.' : 'Full rent is below the vehicle rent — check.'}</p>;
              return <p className="text-[11px] text-slate-500 mt-1">{ar ? 'يستلمه السائق من العميل — عادةً مع «قدام». الفرق لقسم الفروع.' : 'Collected by the driver — usually with “forward”. The gap goes to branches.'}</p>;
            })()}
          </div>
          <div>
            <label className={labelCls}>{ar ? 'نوع العميل' : 'Customer type'}</label>
            <Select value={form.customerType || ''} onChange={(e) => set('customerType', e.target.value)}>
              <option value="">{ar ? '— غير محدد —' : '— unset —'}</option>
              <option value="heavy">{ar ? 'عملاء النقل الثقيل' : 'Heavy transport'}</option>
              <option value="branch">{ar ? 'عملاء الفروع' : 'Branch customers'}</option>
            </Select>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'نوع الحمولة' : 'Load type'}</label>
            <SearchableManagedSelect type="fleet_load_type" value={form.loadType || ''} onChange={(v) => set('loadType', v)}
              placeholder={ar ? 'اختر أو أضف نوع الحمولة' : 'Pick or add a load type'} />
          </div>
          {/* B/L and container link the load to its customs transaction and print on the transport order, as on shipment orders. */}
          <div>
            <label className={labelCls}>{ar ? 'رقم البوليصة' : 'B/L No.'}</label>
            <input value={form.blNumber || ''} onChange={(e) => set('blNumber', e.target.value)} dir="ltr" className={inputCls}
              placeholder={ar ? 'اختياري — يربط الحمولة بالتخليص' : 'Optional — links to customs'} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'رقم الحاوية' : 'Container No.'}</label>
            <input value={form.containerNumber || ''} onChange={(e) => set('containerNumber', e.target.value.toUpperCase())} dir="ltr" className={inputCls}
              placeholder={ar ? 'اختياري — يربط الحمولة بالتخليص' : 'Optional — links to customs'} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'مصروف السائق' : 'Driver expense'}</label>
            <input type="number" min={0} value={form.driverExpense ?? ''} onChange={(e) => set('driverExpense', e.target.value)}
              className={inputCls} placeholder="0" />
          </div>
          {/* Friday bonus: prominent on Friday; one button adds the expense automatically on the server. */}
          <div className="sm:col-span-2 flex items-end">
            <button type="button" onClick={() => set('fridayBonus', !form.fridayBonus)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                form.fridayBonus
                  ? 'bg-emerald-500/15 border-emerald-300 text-emerald-800'
                  : isFriday
                    ? 'bg-amber-500/15 border-amber-300 text-amber-800 animate-pulse'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
              }`}>
              {form.fridayBonus ? <Check className="w-4 h-4" /> : <span className="text-lg leading-none">＋</span>}
              {ar ? `بونص الجمعة للسائق ${form.fridayBonus ? '(مُضاف)' : ''}` : `Friday driver bonus ${form.fridayBonus ? '(added)' : ''}`}
              {isFriday && !form.fridayBonus && <span className="text-[11px]">({ar ? 'اليوم جمعة' : 'today is Friday'})</span>}
            </button>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
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

      {/* Block panel: what is overdue, and a button that raises the request. A truck with overdue maintenance is not loaded without permission. Blocking alone is not enough: the load may be two hours to Jeddah and the maintenance manager may say go and bring it Thursday. This is that conversation, written. */}
      {/* The 'maintenance overdue, loading needs approval' panel is gone. A truck with overdue maintenance used to get a 409, showing this panel and raising a request to the maintenance manager. The block was lifted on request, so nothing is shown: loading proceeds and the badge on the truck card still warns. */}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><CreateFleetShipmentInner /></Suspense>;
}
