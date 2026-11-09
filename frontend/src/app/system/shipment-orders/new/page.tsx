'use client';
// Create shipment: one page instead of the external system's four-step wizard.
// Order mirrors how a load is booked: customer, truck, route, when and how much, payment. Picking the customer autofills defaults and route price; picking the truck autofills its regular driver; an unknown truck registers itself (and its 3PL supplier) as a side effect.
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  PackagePlus, ArrowRight, Check, Loader2, X, UserPlus, Truck,
  MapPin, Package, Clock3, Wallet, User as UserIcon, Building2,
  TrendingUp, TrendingDown, AlertCircle,
  Lock,
} from 'lucide-react';
import { Spinner, PageHeader, Select, SearchableSelect, PrimaryButton, PhoneSA } from '@/components/hr/HRKit';
import { ContactButtons } from '@/components/crm/CrmKit';
import {
  FormField, OrderCustomer, OrderVehicle, OrderSupplier, GROUP_LABELS, fieldLabel, optionLabel,
  FIXED_KEYS, Lang, canEditOrders, vocabLabel, OrderDriver,
} from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useSocket } from '@/hooks/useSocket';
import DriverPicker, { realVal } from '@/components/shipment-orders/DriverPicker';
import { canAccessSection, permsOf } from '@/lib/sections';

// Labels are the form's wayfinding — near-black and readable, not a whisper.
const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
const labelMissCls = 'block text-sm font-semibold text-red-600 mb-1.5';
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
const inputMissCls = 'w-full px-3 py-2.5 rounded-lg bg-red-50 border border-red-400 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50';

const SYSTEM_KEYS = new Set([
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'paymentSubtype', 'driverRentType', 'paymentMethod', 'branch', 'notes',
  'advanceAmount', 'blNumber', 'containerNumber',
]);

const GROUP_ICONS: Record<FormField['group'], any> = {
  pickup_delivery: MapPin, shipment: Package, pricing_time: Clock3, payment: Wallet,
};

// Shipment dates are a day, not a moment. Asking for hour and minute produced precise-looking but false values, since nobody knows the pickup was at 7:42 and users typed any hour to proceed.
const toDateInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => toDateInput(new Date().toISOString());

function CreateShipmentInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const params = useSearchParams();
  const editId = params?.get('id') || null;
  // The edited order's own driver details (see the driver-name effect below).
  const savedDriver = useRef<{ name: string; nat: string; iqama: string } | null>(null);
  // Money after save is writable only for roles the server allows. On create the creator writes it; on edit it is locked except for system admins and the operations manager. The role list comes from the server (MONEY_EDIT_ROLES), not duplicated here.
  // `editable` fields are written directly after save, `byRequest` ones go to approval (the data team's selling price).
  // `owned`: the half of the order this reader writes after saving (sales vs the vendors team; null = all). `priceView`: which side of the price it may see.
  type MoneyEdit = { fields: string[]; canEdit: boolean; editable: string[]; byRequest: string[]; customerLocked?: boolean;
    owned?: string[] | null; priceView?: { sell: boolean; buy: boolean }; supplierLocked?: boolean; directCreate?: boolean };
  const [moneyEdit, setMoneyEdit] = useState<MoneyEdit>({ fields: [], canEdit: true, editable: [], byRequest: [], directCreate: true });
  useEffect(() => {
    api.get<MoneyEdit>('/api/shipment-orders/money-editors')
      .then((d) => setMoneyEdit({ ...d, fields: d.fields || [], canEdit: !!d.canEdit, editable: d.editable || [], byRequest: d.byRequest || [], customerLocked: !!d.customerLocked }))
      .catch(() => {});
  }, []);
  const pv = moneyEdit.priceView || { sell: true, buy: true };
  const hiddenPrice = (key: string) => (key === 'sellPrice' && !pv.sell) || (['buyPrice', 'advanceAmount', 'driverRentPrice'].includes(key) && !pv.buy);
  const notOwned = (key: string) => !!editId && !!moneyEdit.owned && !moneyEdit.owned.includes(key);
  const lockSupplier = !!editId && (!!moneyEdit.supplierLocked || notOwned('vehicle'));
  const lockTruck = notOwned('vehicle');
  const moneyLocked = (key: string) => !!editId && !moneyEdit.canEdit && moneyEdit.fields.includes(key)
    && !moneyEdit.editable.includes(key) && !moneyEdit.byRequest.includes(key);
  // Customer of a saved shipment: fixed for the team, editable by management and the operations manager.
  const customerLocked = !!editId && !!moneyEdit.customerLocked;
  const moneyByRequest = (key: string) => !!editId && moneyEdit.byRequest.includes(key);
  const { notify } = useDialog();

  const [fields, setFields] = useState<FormField[]>([]);
  // An option added from the list itself; see saveOption.
  const [addingFor, setAddingFor] = useState('');
  const [newOption, setNewOption] = useState('');
  const [optionBusy, setOptionBusy] = useState(false);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  // Both lists are searched on the server. They used to load with a blind cap (1000 of 13000 trucks, 500 of 3000 suppliers) and then search the received rows, so a supplier whose trucks fell outside the cap saw an empty list, and a supplier past the cap showed no results though registered.
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  const [suppliers, setSuppliers] = useState<OrderSupplier[]>([]);
  const [supTotal, setSupTotal] = useState(0);
  const [vehTotal, setVehTotal] = useState(0);
  const [supBusy, setSupBusy] = useState(false);
  const [vehBusy, setVehBusy] = useState(false);
  // A supplier's drivers are picked, not typed. A free-text driver gave inconsistent spellings, incomplete ID numbers and no way to know about a valid operating card. The driver register has about 17000 files, so choose from it and type only for those not in it.
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Turned on by a failed save: from then on every missing required input is
  // red until it is filled — the user asked to SEE which fields block them.
  const [showErrors, setShowErrors] = useState(false);

  const statusVocab = useOrderStatuses();
  // Pickup and start default to today. A shipment is registered when booked, so its day is almost always today, and a required empty field would block saving for something that could fill itself.
  const [form, setForm] = useState<Record<string, any>>({ status: 'requesting', pickupTime: today(), startTime: today() });
  // Operational sales: who brought the load, from the sales or operations team, via search.
  const [salesRep, setSalesRep] = useState('');
  const [salesReps, setSalesReps] = useState<{ value: string; label: string; roleAr?: string }[]>([]);
  useEffect(() => { api.get<{ options: { value: string; label: string; roleAr?: string }[] }>('/api/shipment-orders/sales-reps').then((d) => setSalesReps(d.options || [])).catch(() => {}); }, []);
  const [customerId, setCustomerId] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [customerBusy, setCustomerBusy] = useState(false);

  // Supplier first, then its truck. Choosing from all suppliers' trucks gave hundreds of plates in one list, then asked about the owner in a panel with two buttons and two text boxes. The real order is supplier first, then which of its trucks; the second question is limited to the first answer.
  const [supplierId, setSupplierId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  // A plate we have not seen: typed here and registered on the chosen supplier at save.
  const [newPlate, setNewPlate] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', type: 'company' as 'company' | 'freelancer' });
  const [supplierBusy, setSupplierBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [f, c, sp] = await Promise.all([
          api.get<{ fields: FormField[] }>('/api/shipment-orders/fields'),
          api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers?picker=1'),
          api.get<{ suppliers: OrderSupplier[]; total: number }>('/api/shipment-orders/suppliers?limit=60&fresh=1'),
        ]);
        setFields(f.fields || []);
        setCustomers(c.customers || []);
        setSuppliers(sp.suppliers || []);
        setSupTotal(sp.total || (sp.suppliers || []).length);
        if (editId) {
          // The order directly by id — paging through the list capped at 1000
          // used to silently blank the form for older orders.
          const d = await api.get<{ order: any }>(`/api/shipment-orders/orders/${editId}`);
          const o = d.order;
          if (o) {
            setForm({
              ...o,
              pickupTime: toDateInput(o.pickupTime),
              startTime: toDateInput(o.startTime),
              arrivalTime: toDateInput(o.arrivalTime),
              ...(o.customFields || {}),
            });
            setCustomerId(typeof o.customer === 'object' ? o.customer?._id : (o.customer || ''));
            setSalesRep(o.salesRep ? String(typeof o.salesRep === 'object' ? o.salesRep._id : o.salesRep) : '');
            setVehicleId(typeof o.vehicle === 'object' ? o.vehicle?._id : (o.vehicle || ''));
            setSupplierId(typeof o.supplier === 'object' ? (o.supplier?._id || '') : (o.supplier || ''));
            // The order's own driver details: they are what its waybill prints, so the edit shows them rather than the register's.
            savedDriver.current = { name: String(o.driverName || '').trim(), nat: o.driverNationality || '', iqama: o.driverIqama || '' };
            if (o.driverNationality || o.driverIqama) setDetails((dd) => ({ ...dd, driverNationality: o.driverNationality || '', driverIqama: o.driverIqama || '' }));
            // Seed the selected item into its list: the list is one page of a large register, so an item outside it would show an empty field while selected.
            if (o.vehicle && typeof o.vehicle === 'object') {
              setVehicles((p) => (p.some((x) => x._id === o.vehicle._id) ? p : [o.vehicle, ...p]));
            }
            if (o.supplier && typeof o.supplier === 'object') {
              setSuppliers((p) => (p.some((x) => x._id === o.supplier._id) ? p : [o.supplier, ...p]));
            }
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

  /**
   * Supplier and truck search. Every request is guarded by `useLatestRequest`: typing fires a request per pause and the network does not keep order, so a late reply for a partial query would wipe the results of the full one and show no results.
   * A supplier's trucks are requested by its id, not filtered from a loaded list; that was the original bug where picking a supplier showed nothing.
   */
  const supGuard = useLatestRequest();
  const vehGuard = useLatestRequest();
  const supQuery = useRef('');

  const searchSuppliers = useCallback(async (q: string) => {
    supQuery.current = q;
    const mine = supGuard.begin();
    setSupBusy(true);
    try {
      const d = await api.get<{ suppliers: OrderSupplier[]; total: number }>(
        `/api/shipment-orders/suppliers?limit=60&fresh=1${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!supGuard.isCurrent(mine)) return;
      setSuppliers(d.suppliers || []);
      setSupTotal(d.total || 0);
    } catch { /* The field keeps its previous value. */ }
    finally { if (supGuard.isCurrent(mine)) setSupBusy(false); }
  }, [supGuard]);

  // An edit on the customers or suppliers page reaches the open form at once.
  const reloadCustomers = useCallback(() => {
    api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers?picker=1')
      .then((c) => setCustomers(c.customers || [])).catch(() => {});
  }, []);
  useSocket('shipmentOrders:customers', reloadCustomers);
  useSocket('customers:changed', reloadCustomers);
  useSocket('shipmentOrders:fleet', useCallback(() => { searchSuppliers(supQuery.current); }, [searchSuppliers]));

  // The selected supplier's trucks, or a search across all suppliers' trucks when none is chosen. `ownership=supplier` excludes our fleet, which is managed in fleet management and cannot be assigned a shipment order from here.
  const searchVehicles = useCallback(async (q: string, sup: string) => {
    const mine = vehGuard.begin();
    setVehBusy(true);
    try {
      const qs = new URLSearchParams({ limit: '80' });
      // With no supplier: everything not in our fleet, including trucks with unknown owner; restricting to known owners would hide most of the register.
      // Search covers every truck, ours included; otherwise the list narrows to the supplier.
      if (sup && !q) qs.set('supplier', sup);
      if (q) qs.set('q', q);
      const d = await api.get<{ vehicles: OrderVehicle[]; total: number }>(`/api/shipment-orders/vehicles?${qs}`);
      if (!vehGuard.isCurrent(mine)) return;
      setVehicles(d.vehicles || []);
      setVehTotal(d.total || 0);
    } catch { /* As is. */ }
    finally { if (vehGuard.isCurrent(mine)) setVehBusy(false); }
  }, [vehGuard]);

  // A supplier change reloads its truck list immediately, without waiting for the list to be opened.
  useEffect(() => { searchVehicles('', supplierId); }, [supplierId, searchVehicles]);

  /**
   * Drivers of the selected truck, falling back to its supplier's drivers.
   * The order is deliberate: the driver registered on the truck is its usual one, other supplier drivers are the substitute when it changes; avoids asking about 140 drivers when the truck has its own.
   */
  useEffect(() => {
    if (!vehicleId && !supplierId) { setDrivers([]); return; }
    const qs = vehicleId ? `vehicle=${vehicleId}` : `supplier=${supplierId}`;
    api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?${qs}&limit=200`)
      .then(async (d) => {
        let rows = d.drivers || [];
        if (!rows.length && supplierId) {
          const alt = await api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?supplier=${supplierId}&limit=200`);
          rows = alt.drivers || [];
        }
        setDrivers(rows);
      })
      .catch(() => setDrivers([]));
  }, [vehicleId, supplierId]);

  // An option added by a colleague appears here without reopening: a new truck length added in another office is needed by whoever is booking now.
  useSocket('shipmentOrders:fields', useCallback(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, []));

  const customer = useMemo(() => customers.find((c) => c._id === customerId) || null, [customers, customerId]);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Payment method follows the rental type and is not chosen. The return type means a credit account and the forward type means the driver collects on delivery; as independent choices they could contradict. The option carries its payment method (`option.paymentMethod`, set in section settings for any added type), and the field is shown read-only.
  const rentOption = (fields.find((f) => f.key === 'driverRentType')?.options || [])
    .find((o) => o.key === form.driverRentType);
  const derivedPay = rentOption?.paymentMethod || '';
  useEffect(() => {
    if (derivedPay && form.paymentMethod !== derivedPay) set('paymentMethod', derivedPay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedPay]);

  const applyCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x._id === id);
    if (!c) return;
    setForm((f) => {
      const next = { ...f };
      const d = c.defaults || {};
      (['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch'] as const)
        .forEach((k) => { if (!next[k] && d[k]) next[k] = d[k]; });
      const route = findRoute(c, next.fromCity, next.toCity);
      // A price already typed stays; the route only fills an empty box.
      // Only on a new shipment: on an edit an empty price stays empty rather than taking a number nobody chose.
      if (!editId && route?.price != null && (next.sellPrice == null || next.sellPrice === '')) next.sellPrice = route.price;
      return next;
    });
  };

  // Picking the truck plants its regular driver and its type — one tap, three
  // answers. All still editable per shipment.
  const applyVehicle = (id: string) => {
    setVehicleId(id);
    setNewPlate('');
    const v = vehicles.find((x) => x._id === id);
    if (!v) return;
    // Picking a truck shows its owner but does not change the chosen supplier. The supplier is filled from the truck's owner only when none is chosen yet; a supplier picked first is a deal decision and used to be silently replaced by the truck owner, saving the shipment on a supplier nobody agreed with.
    const sup = typeof v.supplier === 'object' && v.supplier ? v.supplier._id : (v.supplier || '');
    if (sup && !supplierId) setSupplierId(String(sup));
    setForm((f) => ({
      ...f,
      driverName: f.driverName || realVal(v.defaultDriverName),
      driverPhone: f.driverPhone || realVal(v.defaultDriverPhone),
      truckType: f.truckType || v.truckType || '',
    }));
  };

  // A new customer is registered when the name is typed, not at shipment save, so collections, the customers page and colleagues see it at once.
  const saveCustomer = async () => {
    const name = newCustomer.name.trim();
    if (!name) { notify(ar ? 'اكتب اسم العميل.' : 'Name the customer.', 'error'); return; }
    setCustomerBusy(true);
    try {
      const d = await api.post<{ customer: OrderCustomer }>('/api/shipment-orders/customers', {
        name, phone: newCustomer.phone.trim(),
      });
      setCustomers((p) => [...p, d.customer].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
      setCustomerId(d.customer._id);
      setNewCustomerOpen(false);
      setNewCustomer({ name: '', phone: '' });
      notify(ar ? `سُجِّل العميل «${d.customer.name}»` : `Customer “${d.customer.name}” registered`, 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error'); }
    setCustomerBusy(false);
  };

  // A new supplier is registered at once, not at shipment save: someone who adds one and leaves for half an hour must find it on the suppliers page, as must a colleague. Registering fires `shipmentOrders:fleet`, picked up by every open screen in the section.
  /**
   * Supplier and driver are registered together. They are one register: a supplier has trucks which have drivers. Registration used to stop at the supplier, so a load was booked with no driver in the register and the name was typed by hand per shipment.
   * A freelancer is both supplier and driver (one truck, drives it himself), so his name is seeded into the driver field and not typed twice.
   */
  const [newDriver, setNewDriver] = useState({ name: '', phone: '', residenceNumber: '' });

  /**
   * One load on several trucks. A customer orders a load leaving on five trucks: customer, route, price, date and payment are the same while supplier, truck and driver differ. Re-typing twenty fields five times invited an error found only at accounting.
   * Trucks are added here and seen before save; the server creates an independent order per truck with its waybill number from the same counter (no parent order, no link), since each truck moves, arrives and is settled alone.
   */
  // What the waybill prints beyond the form: filled from the choice, editable here.
  const [details, setDetails] = useState({ driverNationality: '', driverIqama: '', vehicleBrand: '', vehicleColor: '' });
  useEffect(() => {
    const v = vehicles.find((x) => x._id === vehicleId) as any;
    setDetails((d) => ({ ...d, vehicleBrand: v?.brand || '', vehicleColor: v?.color || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);
  useEffect(() => {
    const name = String(form.driverName || '').trim();
    if (!name) { setDetails((d) => ({ ...d, driverNationality: '', driverIqama: '' })); return undefined; }
    // Editing with the same driver: keep what the order holds.
    const saved = savedDriver.current;
    if (saved && saved.name === name && (saved.nat || saved.iqama)) {
      setDetails((d) => ({ ...d, driverNationality: saved.nat, driverIqama: saved.iqama }));
      return undefined;
    }
    const t = setTimeout(() => {
      api.get<{ drivers: any[] }>(`/api/shipment-orders/drivers?q=${encodeURIComponent(name)}&limit=10`).then((r) => {
        const hit = (r.drivers || []).find((x) => String(x.name || '').trim() === name);
        if (hit) setDetails((d) => ({ ...d, driverNationality: hit.nationality || '', driverIqama: hit.residenceNumber || '' }));
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [form.driverName]);

  type ExtraTruck = {
    uid: string;
    supplierId: string; supplierName: string;
    vehicleId: string; vehicleLabel: string;
    newPlate: string;
    driverName: string; driverPhone: string;
    blNumber: string; containerNumber: string;
    vehicles: OrderVehicle[]; busy: boolean;
  };
  const [extras, setExtras] = useState<ExtraTruck[]>([]);
  const addExtra = () => setExtras((p) => [...p, {
    uid: `x${Date.now()}${p.length}`,
    supplierId: '', supplierName: '', vehicleId: '', vehicleLabel: '',
    newPlate: '', driverName: '', driverPhone: '', blNumber: '', containerNumber: '', vehicles: [], busy: false,
  }]);
  const setExtra = (uid: string, patch: Partial<ExtraTruck>) =>
    setExtras((p) => p.map((x) => (x.uid === uid ? { ...x, ...patch } : x)));
  const dropExtra = (uid: string) => setExtras((p) => p.filter((x) => x.uid !== uid));

  /** Trucks of this row's supplier, requested by its id as in the first row. */
  const loadExtraVehicles = async (uid: string, supplierId: string, q = '') => {
    setExtra(uid, { busy: true });
    try {
      const qs = new URLSearchParams({ limit: '80' });
      if (supplierId && !q) qs.set('supplier', supplierId);
      if (q) qs.set('q', q);
      const d = await api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?${qs}`);
      setExtra(uid, { vehicles: d.vehicles || [], busy: false });
    } catch { setExtra(uid, { busy: false }); }
  };
  const saveSupplier = async () => {
    const name = newSupplier.name.trim();
    if (!name) { notify(ar ? 'اكتب اسم المورد.' : 'Name the supplier.', 'error'); return; }
    setSupplierBusy(true);
    try {
      const d = await api.post<{ supplier: OrderSupplier }>('/api/shipment-orders/suppliers', {
        name, phone: newSupplier.phone.trim(), type: newSupplier.type,
      });
      setSuppliers((p) => [...p, d.supplier].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
      setSupplierId(d.supplier._id);
      setVehicleId('');

      // His driver is registered with him if typed; a freelancer with no driver name is the driver himself.
      const drvName = newDriver.name.trim() || (newSupplier.type === 'freelancer' ? name : '');
      let savedDriver: OrderDriver | null = null;
      if (drvName) {
        try {
          const dd = await api.post<{ driver: OrderDriver }>('/api/shipment-orders/drivers', {
            name: drvName,
            phone: newDriver.phone.trim() || (newSupplier.type === 'freelancer' ? newSupplier.phone.trim() : ''),
            residenceNumber: newDriver.residenceNumber.trim(),
            supplier: d.supplier._id,
          });
          savedDriver = dd.driver;
          setDrivers((p) => [dd.driver, ...p]);
          set('driverName', dd.driver.name);
          if (dd.driver.phone) set('driverPhone', dd.driver.phone);
        } catch (e: any) { notify(e?.message || (ar ? 'سُجِّل المورّد ولم يُسجَّل السائق' : 'Supplier saved, driver did not'), 'error'); }
      }

      setAddingSupplier(false);
      setNewSupplier({ name: '', phone: '', type: 'company' });
      setNewDriver({ name: '', phone: '', residenceNumber: '' });
      notify(ar
        ? `سُجِّل المورد «${d.supplier.name}»${savedDriver ? ` وسائقُه «${savedDriver.name}»` : ''} — تجدهما في صفحة المورّدين`
        : `Supplier “${d.supplier.name}”${savedDriver ? ` and driver “${savedDriver.name}”` : ''} registered`, 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error'); }
    setSupplierBusy(false);
  };

  // The route is recognised even when typed by hand from the lists. Picking from and to from the lists means the route itself, so its price is filled as if the shortcut were pressed. Matching is folded: two spellings of one city are the same city, where a literal comparison left them as two routes with two prices.
  useEffect(() => {
    if (!customer) return;
    const route = findRoute(customer, form.fromCity, form.toCity);
    if (!editId && route?.price != null && (form.sellPrice == null || form.sellPrice === '')) set('sellPrice', route.price);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fromCity, form.toCity, customerId]);

  const missingKeys = useMemo(() => {
    const missing = new Set<string>();
    fields.forEach((f) => {
      if (hiddenPrice(f.key) || notOwned(f.key)) return;
      if (f.required && !FIXED_KEYS.has(f.key) && !String(form[f.key] ?? '').trim()) missing.add(f.key);
    });
    // The selling price is required on a new shipment, whatever the form settings say.
    if (!editId && pv.sell && !(Number(form.sellPrice) > 0)) missing.add('sellPrice');
    if (!customerId && !newCustomer.name.trim()) missing.add('customer');
    return missing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, form, customerId, newCustomer.name, moneyEdit, editId]);

  const save = async () => {
    if (!vehicleId && newPlate.trim() && !supplierId) {
      notify(ar ? 'اختر المورد صاحب اللوحة الجديدة.' : 'Pick the new plate’s supplier.', 'error');
      return;
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
      // These two are fixed boxes on the form, not configured fields, so the loop above misses them.
      payload.blNumber = String(form.blNumber || '').trim();
      payload.containerNumber = String(form.containerNumber || '').trim();
      payload.waybillDetails = details;
      payload.status = form.status || 'requesting';
      payload.driverName = form.driverName || '';
      payload.driverPhone = form.driverPhone || '';
      if (customerId) payload.customer = customerId;
      else payload.newCustomer = { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() };

      // The chosen supplier is sent even when the truck is registered. Thousands of registered trucks have an unknown owner and the person booking the load knows it, so the server records it when none is stored and it is not asked again next shipment.
      if (supplierId) payload.supplierChoice = supplierId;
      // Operational sales: who brought the load.
      payload.salesRep = salesRep || null;
      if (vehicleId) payload.vehicle = vehicleId;
      else if (newPlate.trim()) {
        // The new plate is registered on the chosen supplier, which was registered before it.
        payload.newVehicle = { plate: newPlate.trim(), name: '', supplierId: supplierId || null, newSupplier: null };
      }

      // The day is sent at noon: a bare "2026-09-05" is read as midnight GMT and becomes the 4th in Riyadh. Noon is safe in every timezone.
      ['pickupTime', 'startTime', 'arrivalTime'].forEach((k) => {
        payload[k] = form[k] ? new Date(`${form[k]}T12:00:00`).toISOString() : null;
      });
      ['quantity', 'sellPrice', 'buyPrice', 'advanceAmount'].forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
        else if (payload[k] != null) payload[k] = Number(payload[k]);
      });

      if (editId) {
        const out = await api.put<{ sellingRequestMessage?: string }>(`/api/shipment-orders/orders/${editId}`, payload);
        if (out?.sellingRequestMessage) notify(out.sellingRequestMessage, 'info');
      }
      else if (extras.length) {
        // Load on several trucks: the first row is a truck like the rest and is sent in the same list. Creating it alone and then sending the others could save the first while the second is rejected, leaving the user not knowing where it stopped.
        const truckOf = (sup: string, veh: string, plate: string, dn: string, dp: string, bl: string, cn: string) => ({
          blNumber: String(bl || '').trim(),
          containerNumber: String(cn || '').trim(),
          ...(veh ? { vehicle: veh } : {}),
          ...(!veh && plate.trim() ? { newVehicle: { plate: plate.trim(), name: '', supplierId: sup || null, newSupplier: null } } : {}),
          ...(sup ? { supplierChoice: sup } : {}),
          ...(dn ? { driverName: dn } : {}),
          ...(dp ? { driverPhone: dp } : {}),
          plateLabel: plate.trim() || undefined,
        });
        const body = { ...payload };
        delete body.waybillDetails;
        delete body.vehicle; delete body.newVehicle; delete body.supplierChoice;
        body.trucks = [
          { ...truckOf(supplierId, vehicleId, newPlate, form.driverName || '', form.driverPhone || '', form.blNumber, form.containerNumber), waybillDetails: details },
          ...extras.map((x) => truckOf(x.supplierId, x.vehicleId, x.newPlate, x.driverName, x.driverPhone, x.blNumber, x.containerNumber)),
        ];
        const d = await api.post<{ waybills: number[]; created: number; failed: any[] }>(
          '/api/shipment-orders/orders/batch', body);
        const nums = (d.waybills || []).join('، ');
        notify(ar
          ? `أُنشئت ${d.created} شحنة — أوامر نقل ${nums}${d.failed?.length ? ` · تعذّرت ${d.failed.length}` : ''}`
          : `${d.created} shipments created — waybills ${nums}${d.failed?.length ? ` · ${d.failed.length} failed` : ''}`,
          d.failed?.length ? 'error' : 'success');
        if (d.failed?.length) { setSaving(false); return; }   // The form stays so the failed part can be resent.
      } else {
        const d = await api.post<{ order: any }>('/api/shipment-orders/orders', payload);
        notify(ar ? `تم إنشاء الشحنة — رقم أمر النقل ${d.order.waybillNumber}` : `Created — waybill ${d.order.waybillNumber}`, 'success');
      }
      router.push('/system/shipment-orders');
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!canEditOrders(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  // Sales and the vendors team create in two steps: sales asks, the vendors team places.
  if (!editId && moneyEdit.directCreate === false) {
    return (
      <div className="max-w-xl mx-auto mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" dir={isRTL ? 'rtl' : 'ltr'}>
        <PackagePlus className="w-8 h-8 mx-auto text-[#f37121]" />
        <p className="mt-3 font-bold text-slate-900">{ar ? 'تُنشأ الشحنة على خطوتين' : 'Shipments are created in two steps'}</p>
        <p className="mt-1 text-sm text-slate-600">{ar ? 'يكتب فريقُ المبيعات «طلبَ شحنة»، ويُكمله فريقُ الموردين بالمورّد والسيارة والسائق وسعر الشراء فيصير أمرَ نقل.' : 'Sales writes a shipment request; the vendors team completes it into a transport order.'}</p>
        <button type="button" onClick={() => router.push(user && ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'vendors_trainee'].includes(user.role) ? '/system/shipment-orders/requests' : '/system/shipment-orders/request')}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold">
          {user && ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'vendors_trainee'].includes(user.role) ? (ar ? 'الطلبات من المبيعات' : 'Requests from sales') : (ar ? 'طلب شحنة' : 'Shipment request')}
        </button>
      </div>
    );
  }

  const miss = (k: string) => showErrors && missingKeys.has(k);

  // A new list option: saved in the field definition and selected immediately.
  const saveOption = async (f: FormField) => {
    const ar2 = newOption.trim();
    if (!ar2) return;
    setOptionBusy(true);
    try {
      const d = await api.post<{ field: FormField }>(`/api/shipment-orders/fields/${f._id}/options`, { ar: ar2 });
      setFields((prev) => prev.map((x) => (x._id === f._id ? d.field : x)));
      set(f.key, ar2);
      setAddingFor('');
      setNewOption('');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّرت الإضافة' : 'Could not add'), 'error'); }
    setOptionBusy(false);
  };
  // Local number: the part after +966, shown and typed; the stored value is always the full number.
  const localPhone = String(form.driverPhone || '').replace(/\D/g, '').replace(/^966/, '').slice(0, 9);

  const renderField = (f: FormField) => {
    const label = fieldLabel(f, lang as Lang);
    const v = form[f.key] ?? '';
    const bad = miss(f.key);
    if (hiddenPrice(f.key)) return null;
    // The other team's half: shown, not editable.
    if (notOwned(f.key)) {
      const opt = (f.options || []).find((o) => o.key === v);
      return (
        <div key={f._id} className={f.inputType === 'cards' || f.inputType === 'textarea' ? 'col-span-full' : ''}>
          <label className={labelCls}>{label}</label>
          <div className={`${inputCls} flex items-center justify-between bg-slate-50 cursor-not-allowed`} title={ar ? 'يعدّله الفريقُ صاحبُ هذا الجزء من أمر النقل' : 'Edited by the team that owns this part'}>
            <span className={v !== '' && v != null ? 'font-semibold text-slate-800' : 'text-slate-400'}>{opt ? optionLabel(opt, lang as Lang) : (v !== '' && v != null ? String(v) : '—')}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Lock className="w-3 h-3" />{ar ? 'للفريق الآخر' : 'other team'}</span>
          </div>
        </div>
      );
    }
    const lab = (
      <label className={bad ? labelMissCls : labelCls}>{label}{f.required && <span className="text-red-500"> *</span>}
        {moneyByRequest(f.key) && <span className="ms-1.5 text-[11px] font-normal text-amber-700">{ar ? '(التعديل يُرسَل للاعتماد)' : '(change needs approval)'}</span>}
      </label>
    );
    // Payment method is read, not chosen. It follows the driver rental type (return means credit, forward means cash), so it is shown with its reason rather than as a field that could contradict the type.
    if (moneyLocked(f.key)) {
      return (
        <div key={f._id}>
          <label className={labelCls}>{label}</label>
          <div className={`${inputCls} flex items-center justify-between bg-slate-50 cursor-not-allowed`}
            title={ar ? 'تعديل الأسعار بعد الحفظ لمدير النظام والإدارة ومدير التشغيل فقط' : 'Only system admins and the operations manager can change prices after saving'}>
            <span className={v !== '' && v != null ? 'font-semibold text-slate-800 tabular-nums' : 'text-slate-400'}>{v !== '' && v != null ? Number(v).toLocaleString('en-US') : '—'}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Lock className="w-3 h-3" />{ar ? 'مقفول' : 'locked'}</span>
          </div>
        </div>
      );
    }
    if (f.key === 'paymentMethod') {
      const opt = (f.options || []).find((o) => o.key === v);
      return (
        <div key={f._id}>
          {lab}
          <div className={`${inputCls} flex items-center justify-between bg-slate-50`}>
            <span className={v ? 'font-semibold text-slate-800' : 'text-slate-400'}>
              {opt ? optionLabel(opt, lang as Lang) : (ar ? 'تُحدَّد من نوع تأجير السائق' : 'Set by the rental type')}
            </span>
            {v && <span className="text-[11px] text-slate-400">{ar ? 'تلقائي' : 'automatic'}</span>}
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
            {/* Missing list items are added in place. A new city or load type used to stop the form and send the user to section settings, losing what was typed. What is added is written to the same settings and appears for everyone at once (`so:fields`). */}
            {/* Branch is the company's branches, so nothing can be added from here (`locked`). */}
            {(f as any).locked ? null : addingFor === f._id ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input autoFocus value={newOption} onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveOption(f); if (e.key === 'Escape') setAddingFor(''); }}
                  placeholder={ar ? `${label} الجديد…` : `New ${label}…`}
                  className={`${inputCls} flex-1`} />
                <button type="button" onClick={() => saveOption(f)} disabled={optionBusy}
                  className="px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-50">
                  {optionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : (ar ? 'إضافة' : 'Add')}
                </button>
                <button type="button" onClick={() => setAddingFor('')} className="px-2 py-2 text-slate-400 hover:text-slate-700 text-sm">
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { setAddingFor(f._id); setNewOption(''); }}
                className="mt-1 text-[12px] font-semibold text-[#f37121] hover:underline">
                + {ar ? `إضافة ${label}` : `Add ${label}`}
              </button>
            )}
          </div>
        );
      case 'number':
        return <div key={f._id}>{lab}<input type="number" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
      case 'date':
        return <div key={f._id}>{lab}<input type="date" value={v} onChange={(e) => set(f.key, e.target.value)} className={bad ? inputMissCls : inputCls} /></div>;
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
  // Complete means no missing required field and something was written. A card with no required fields (payments) used to be green from the first open, before a payment type was chosen, reading as done while untouched.
  const hasVal = (v: any) => v != null && String(v).trim() !== '';
  const filledIn = (g: FormField['group']) =>
    fields.some((f) => f.group === g && !FIXED_KEYS.has(f.key) && hasVal(form[f.key]));

  const SEC = {
    customer: 'sec-customer', truck: 'sec-truck', status: 'sec-status',
    group: (g: string) => `sec-${g}`,
  };
  const steps = [
    { id: SEC.customer, no: 1, title: ar ? 'العميل والمورّد' : 'Customer & supplier', missing: missingKeys.has('customer') ? 1 : 0, filled: !!customer || !!supplierId },
    { id: SEC.truck, no: 2, title: ar ? 'مالك السيارة' : 'Truck owner', missing: 0, filled: !!vehicleId || hasVal(newPlate) || hasVal(form.driverName) },
    ...activeGroups.map((g, i) => ({
      id: SEC.group(g), no: i + 3,
      title: ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en,
      missing: missingIn(g),
      filled: filledIn(g),
    })),
    { id: SEC.status, no: activeGroups.length + 3, title: ar ? 'الحالة والملاحظات' : 'Status & notes', missing: 0, filled: hasVal(form.status || 'requesting') },
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
  const hasDeal = pv.sell && pv.buy && Number.isFinite(sell) && sell > 0 && Number.isFinite(buy) && buy > 0;
  const dealMargin = hasDeal ? sell - buy : null;
  const money = (n: number) => n.toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-US', { maximumFractionDigits: 2 });

  // A card carries its own state: the number turns into a tick when nothing in
  // it is still required, and into a red count when something is. The person
  // filling a six-card form should never have to scroll to find out.
  const sectionCard = (icon: any, no: number, title: string, children: React.ReactNode,
    opts?: { id?: string; missing?: number; filled?: boolean }) => {
    const Icon = icon;
    const missing = opts?.missing || 0;
    const done = missing === 0 && opts?.filled !== false;
    return (
      // No overflow-hidden here: SearchableSelect renders its panel absolutely inside the card, and clipping it hid the dropdown. The header rounds its own top corners instead.
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

  // Empty is not "our fleet". A missing supplier used to read as our fleet, then carriers' trucks were imported from order history with no supplier reference, so thousands of other people's trucks were reported as ours. Ownership is read explicitly from `ownership`.
  const supplierOf = (v: OrderVehicle) => {
    const n = typeof v.supplier === 'object' && v.supplier ? v.supplier.name : '';
    if (n) return n;
    if ((v as any).ownership === 'ours') return ar ? 'أسطولنا' : 'Our fleet';
    return ar ? 'مالكٌ غير مسجَّل' : 'Owner not recorded';
  };

  // The selected truck, its owner and the agreed supplier: three names shown in the owner card.
  const vehicle = vehicles.find((v) => v._id === vehicleId) || null;
  const supplierName = suppliers.find((x) => x._id === supplierId)?.name || '';
  const ownerSupId = vehicle && typeof vehicle.supplier === 'object' && vehicle.supplier
    ? String(vehicle.supplier._id) : String(vehicle?.supplier || '');
  const ownerDiffers = !!(vehicle && supplierId && ownerSupId && ownerSupId !== supplierId);

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
            const done = st.missing === 0 && st.filled;
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
      {/* 1. Customer and supplier, the two parties to the deal. A shipment is a contract between who it is carried for and who carries it. The supplier sat in the truck card because it filters trucks, so it read as a truck attribute. It now sits beside the customer in the same shape (searchable list plus a new button registering at once), and the truck card asks only about the truck and its owner. */}
      {sectionCard(UserIcon, 1, ar ? 'العميل والمورّد' : 'Customer & supplier', (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12.5px] font-semibold text-slate-600">{ar ? 'مندوب المبيعات — مَن جاء بهذه الحمولة' : 'Operational sales — who brought this load'}</label>
            <SearchableSelect value={salesRep} onChange={setSalesRep} searchAfter={0}
              placeholder={ar ? 'اختر من فريق المبيعات أو العمليات…' : 'Pick from sales or operations…'}
              searchPlaceholder={ar ? 'اكتب الاسم للبحث…' : 'Type a name…'}
              emptyLabel={ar ? 'لا نتائج' : 'No matches'}
              options={salesReps.map((u) => ({ value: u.value, label: u.label, hint: u.roleAr || '' }))} />
          </div>
          {customerLocked ? (
            <div className={`${inputCls} flex items-center justify-between bg-slate-50 cursor-not-allowed`}
              title={ar ? 'عميل الشحنة لا يتغيّر بعد الحفظ إلّا من الإدارة ومدير التشغيل' : 'Only management and the operations manager change the customer after saving'}>
              <span className="font-semibold text-slate-800">{customer?.name || '—'}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Lock className="w-3 h-3" />{ar ? 'مقفول' : 'locked'}</span>
            </div>
          ) : !newCustomerOpen ? (
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
              <div className="sm:w-56">
                {/* Same mobile box as everywhere in the system: country code at the left and nine digits. */}
                <PhoneSA value={newCustomer.phone} onChange={(v) => setNewCustomer((c) => ({ ...c, phone: v }))} />
              </div>
              <PrimaryButton onClick={saveCustomer} disabled={customerBusy}>
                {customerBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {ar ? 'حفظ العميل' : 'Save customer'}
              </PrimaryButton>
              <button type="button" onClick={() => { setNewCustomerOpen(false); setNewCustomer({ name: '', phone: '' }); }}
                className="p-2.5 text-slate-400 hover:text-slate-700" aria-label="close"><X className="w-4 h-4" /></button>
            </div>
          )}
          {newCustomerOpen && (
            <p className="text-xs text-slate-500">
              {ar ? 'يُسجَّل في صفحة العملاء فورًا — لا ينتظر حفظ الشحنة — ويُحفَظ المسار والسعر في ملفه عند الحفظ.'
                  : 'Registered on the customers page at once — it does not wait for the shipment — and the route + price land on their profile on save.'}
            </p>
          )}
          {/* The approved-routes shortcut was removed: destinations are typed in the two fields as on every shipment, and the buttons above them were redundant. */}

          {/* Supplier below it in the same shape: same question and button, a list searched on the server and a new-supplier button that registers on the suppliers page immediately, without waiting for the shipment save, along with its driver if known. Choosing it here filters its trucks in the next card. */}
          {/* The supplier of a saved order is fixed for the team, and it is the vendors team's half. */}
          <fieldset disabled={lockSupplier} className={`pt-3 border-t border-slate-200/70 space-y-3 ${lockSupplier ? 'opacity-70' : ''}`}>
            <label className={labelCls}>{ar ? 'المورّد' : 'Supplier'}{lockSupplier && <span className="ms-1.5 inline-flex items-center gap-1 text-[11px] font-normal text-slate-400"><Lock className="w-3 h-3" />{ar ? 'مقفول بعد الحفظ' : 'locked after save'}</span>}</label>
            {!addingSupplier ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <SearchableSelect value={supplierId} onChange={(x) => { setSupplierId(x); setVehicleId(''); setNewPlate(''); }} searchAfter={0}
                    onSearch={searchSuppliers} loading={supBusy}
                    placeholder={ar ? 'اختر المورّد — اكتب للبحث…' : 'Pick the supplier — type to search…'}
                    searchPlaceholder={ar ? 'اكتب اسم المورّد أو جوّاله أو سجلَّه…' : 'Name, phone or CR…'}
                    emptyLabel={ar ? 'لا نتائج — سجّله كمورّد جديد' : 'No matches — register them as new'}
                    footer={supTotal > suppliers.length
                      ? (ar ? `${suppliers.length} من ${supTotal} مورّدًا — اكتب لتضيّق` : `${suppliers.length} of ${supTotal} — type to narrow`)
                      : (ar ? `${suppliers.length} مورّدًا` : `${suppliers.length} suppliers`)}
                    options={suppliers.map((sp) => ({
                      value: sp._id, label: sp.name,
                      hint: [sp.type === 'freelancer' ? (ar ? 'سائق فرد' : 'Freelancer') : (ar ? 'شركة' : 'Company'), sp.phone].filter(Boolean).join(' · '),
                    }))} />
                </div>
                <button type="button" onClick={() => { setAddingSupplier(true); setSupplierId(''); setVehicleId(''); }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-semibold">
                  <UserPlus className="w-4 h-4" /> {ar ? 'مورّد جديد' : 'New supplier'}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={newSupplier.name} onChange={(e) => setNewSupplier((v) => ({ ...v, name: e.target.value }))}
                    placeholder={ar ? 'اسم المورّد *' : 'Supplier name *'} className={inputCls + ' flex-1'} />
                  <div className="sm:w-56">
                    <PhoneSA value={newSupplier.phone} onChange={(v) => setNewSupplier((x) => ({ ...x, phone: v }))} />
                  </div>
                  {([['company', ar ? 'شركة' : 'Company'], ['freelancer', ar ? 'سائق فرد' : 'Freelancer']] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setNewSupplier((v) => ({ ...v, type: k }))}
                      className={`px-4 py-2 rounded-full border text-sm font-semibold shrink-0 ${newSupplier.type === k
                        ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* His driver goes with him: supplier, its trucks and its drivers are one linked register. */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[#f37121]/20">
                  <input value={newDriver.name} onChange={(e) => setNewDriver((v) => ({ ...v, name: e.target.value }))}
                    placeholder={newSupplier.type === 'freelancer'
                      ? (ar ? 'اسم السائق — يُترك فارغًا فهو المورّد نفسُه' : 'Driver name — blank means the supplier himself')
                      : (ar ? 'اسم سائقه (اختياري)' : 'His driver (optional)')}
                    className={inputCls + ' flex-1'} />
                  <div className="sm:w-52">
                    <PhoneSA value={newDriver.phone} onChange={(v) => setNewDriver((x) => ({ ...x, phone: v }))} />
                  </div>
                  <input value={newDriver.residenceNumber} onChange={(e) => setNewDriver((v) => ({ ...v, residenceNumber: e.target.value }))}
                    placeholder={ar ? 'رقم الإقامة' : 'Iqama'} dir="ltr" className={inputCls + ' sm:w-40'} />
                </div>
                <div className="flex items-center gap-2">
                  <PrimaryButton onClick={saveSupplier} disabled={supplierBusy}>
                    {supplierBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {ar ? 'حفظ المورّد' : 'Save supplier'}
                  </PrimaryButton>
                  <button type="button" onClick={() => { setAddingSupplier(false); setNewSupplier({ name: '', phone: '', type: 'company' }); }}
                    className="p-2.5 text-slate-400 hover:text-slate-700" aria-label="close"><X className="w-4 h-4" /></button>
                  <p className="text-xs text-slate-500">
                    {ar ? 'يُسجَّل هو وسائقُه في صفحة المورّدين فورًا، ويظهران عند زملائك في اللحظة نفسِها.'
                        : 'He and his driver are registered at once — colleagues see them immediately.'}
                  </p>
                </div>
              </div>
            )}
          </fieldset>
        </div>
      ), { id: SEC.customer, missing: missingKeys.has('customer') ? 1 : 0, filled: !!customer || !!supplierId })}

      {/* 2. Vehicle owner: the truck, who owns it and its driver. The supplier is a deal party now beside the customer; here is the truck itself, its plate and its owner in the register. They need not be the same, since a supplier may carry our load on someone else's truck. Then the driver and his mobile. */}
      {sectionCard(Truck, 2, ar ? 'مالك السيارة' : 'Truck owner', (
        <fieldset disabled={lockTruck} className={`space-y-4 ${lockTruck ? 'opacity-70' : ''}`}>
          {/* The card is half the page from xl, so its fields are one column there and two only on very wide screens; otherwise each field would be a quarter of the screen with clipped text. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{ar ? 'السيارة' : 'Vehicle'}</label>
              {/* Only the selected supplier's trucks: a list of three is chosen from, a list of three hundred is searched. */}
              {/* The server does the filtering: `supplier=<id>` fetches only its trucks, and with no supplier it searches all suppliers' trucks. No local filter on top: a `.filter(v => v.supplier)` on a loaded page gave an empty list although the supplier's trucks were registered. */}
              <SearchableSelect value={vehicleId} onChange={applyVehicle} searchAfter={0}
                onSearch={(q) => searchVehicles(q, supplierId)} loading={vehBusy}
                placeholder={supplierId
                  ? (ar ? 'اختر شاحنة المورّد…' : 'Pick the supplier’s truck…')
                  : (ar ? 'اختر المورّد أوّلًا، أو ابحث في كل الشاحنات…' : 'Pick a supplier first, or search all trucks…')}
                searchPlaceholder={ar ? 'ابحث باللوحة أو السائق أو بطاقة التشغيل…' : 'Plate, driver or operation card…'}
                emptyLabel={supplierId
                  ? (ar ? 'لا شاحنةَ مسجّلةً لهذا المورّد — اكتب اللوحة في الخانة تحت' : 'No truck registered for them — type the plate below')
                  : (ar ? 'غير موجودة؟ اكتب اللوحة في الخانة تحت' : 'Not listed? Type the plate below')}
                footer={vehTotal > vehicles.length
                  ? (ar ? `${vehicles.length} من ${vehTotal} شاحنة — اكتب لتضيّق` : `${vehicles.length} of ${vehTotal} — type to narrow`)
                  : (ar ? `${vehicles.length} شاحنة` : `${vehicles.length} trucks`)}
                options={vehicles.map((v) => ({
                  value: v._id,
                  label: [v.plate, v.name].filter(Boolean).join(' — '),
                  hint: [supplierOf(v), v.defaultDriverName].filter(Boolean).join(' · '),
                }))} />
              {/* A plate we have not seen is typed here, not opened as a four-field form. */}
              <input value={newPlate} onChange={(e) => { setNewPlate(e.target.value); if (e.target.value.trim()) setVehicleId(''); }}
                placeholder={ar ? 'أو اكتب لوحةً جديدة — تُسجَّل على المورّد' : 'Or type a new plate — registered to the supplier'}
                className={`${inputCls} mt-2`} />
            </div>

            {/* The owner is read, not typed. The truck's owner in the register is information about the truck, not a decision in the shipment; shown to see whose truck carries our load. If it differs from the agreed supplier, that is stated: it is normal (a supplier using someone else's truck), not an error, but worth knowing before save. */}
            <div>
              <label className={labelCls}>{ar ? 'مالك السيارة (من السجلّ)' : 'Owner (from the registry)'}</label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 min-h-[42px] flex items-center flex-wrap gap-x-2 gap-y-1 text-sm">
                {vehicle ? (
                  <>
                    <span className="font-semibold text-slate-900">{supplierOf(vehicle)}</span>
                    {vehicle.plate && <span className="font-mono text-xs text-slate-500" dir="ltr">{vehicle.plate}</span>}
                    {ownerDiffers && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
                        {ar ? `المتّفقُ معه: ${supplierName}` : `Agreed with: ${supplierName}`}
                      </span>
                    )}
                  </>
                ) : newPlate.trim() ? (
                  <span className="text-slate-600">
                    {supplierName
                      ? (ar ? `لوحةٌ جديدة — تُسجَّل على «${supplierName}»` : `New plate — will be registered to “${supplierName}”`)
                      : (ar ? 'لوحةٌ جديدة — اختر المورّد لتُسجَّل عليه' : 'New plate — pick the supplier to register it to')}
                  </span>
                ) : (
                  <span className="text-slate-400">{ar ? 'يظهر عند اختيار الشاحنة' : 'Shows once a truck is picked'}</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{ar ? 'السائق' : 'Driver'}</label>
              {/* Combo box: registered drivers are suggestions, not a restriction (`allowCustom`), so someone not in the register is typed and work continues. Typing searches all drivers on the server by name, mobile and residency; choosing a registered one fills his mobile and says whether his operating card is expired. */}
              <DriverPicker ar={ar} value={form.driverName || ''} contextDrivers={drivers}
                supplierId={supplierId || undefined} vehicleId={vehicleId || undefined}
                onPick={(d) => {
                  if (d.driver) setDrivers((p) => (p.some((x) => x._id === d.driver!._id) ? p : [d.driver!, ...p]));
                  set('driverName', d.name);
                  if (d.phone) set('driverPhone', d.phone);
                }} />
            </div>
            <div>
              <label className={labelCls}>{ar ? 'جوال السائق' : 'Driver phone'}</label>
              {/* Saudi number of nine digits with the key always at the left. `PhoneSA` is shared by every mobile in the system: the key is fixed and not typed, nine digits at most, and the box is `ltr` so +966 stays left of the digits in Arabic or English. */}
              <PhoneSA value={form.driverPhone || ''} onChange={(v) => set('driverPhone', v)}>
                {(form.driverPhone || '').trim() ? <ContactButtons phone={form.driverPhone} /> : null}
              </PhoneSA>
              {localPhone && localPhone.length !== 9 && (
                <p className="mt-1 text-[11.5px] text-red-600">{ar ? 'الرقم تسع خانات بعد +966' : 'Nine digits after +966'}</p>
              )}
            </div>
          </div>
        </fieldset>
      ), { id: SEC.truck, filled: !!vehicleId || hasVal(newPlate) || hasVal(form.driverName) })}
      </div>

      <fieldset disabled={lockTruck} className={`bg-white border border-slate-200 rounded-xl p-5 ${lockTruck ? 'opacity-70' : ''}`}>
        <p className="font-bold text-slate-900 mb-1">{ar ? 'بيانات أمر النقل' : 'Transport order details'}</p>
        <p className="text-xs text-slate-500 mb-3">{ar ? 'تُملأ من السائق والشاحنة المختارين، وما تعدّله هنا يُحفظ في سجلّهما ويظهر في أمر النقل.' : 'Filled from the chosen driver and truck. Edits save to their records and print on the waybill.'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            ['driverNationality', ar ? 'جنسية السائق' : 'Driver nationality'],
            ['driverIqama', ar ? 'رقم إقامة السائق' : 'Driver iqama no.'],
            ['vehicleBrand', ar ? 'ماركة الشاحنة' : 'Truck brand'],
            ['vehicleColor', ar ? 'لون الشاحنة' : 'Truck colour'],
          ] as const).map(([k, label]) => (
            <div key={k}>
              <label className={labelCls}>{label}</label>
              <input value={details[k]} onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))} className={inputCls} />
            </div>
          ))}
        </div>
      </fieldset>

      {/* 3..6 ── the config-driven groups */}
      {activeGroups.map((g, i) => {
        const gf = fields.filter((f) => f.group === g && !FIXED_KEYS.has(f.key));
        const cols = g === 'pickup_delivery'
          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
          : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
        return (
          <div key={g}>
            {sectionCard(GROUP_ICONS[g], i + 3, ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en, (
              <div className={cols}>
                {gf.map(renderField)}
                {/* Trip note beside its cities, where it is written. It is printed on the transport order when present, shown as a table column and filterable. */}
                {g === 'pickup_delivery' && (
                  <div className="col-span-full">
                    <label className={labelCls}>{ar ? 'ملاحظة الرحلة' : 'Trip note'}</label>
                    <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} disabled={notOwned('notes')}
                      placeholder={ar ? 'تظهر في أمر النقل (أمر النقل) إن كُتبت' : 'Printed on the waybill when written'}
                      className={`${inputCls} disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                  </div>
                )}
                {/* Waybill and container are optional and linked to customs. Written here, they link the shipment to the customs file carrying them (and its transport order); written on the customs side, they fill here by themselves. See services/customsOpsLink. */}
                {g === 'pickup_delivery' && (
                  <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>{ar ? 'رقم البوليصة' : 'B/L number'} <span className="text-slate-400 font-normal text-xs">{ar ? '(اختياري)' : '(optional)'}</span></label>
                      <input value={form.blNumber || ''} onChange={(e) => set('blNumber', e.target.value)} dir="ltr" disabled={notOwned('blNumber')}
                        placeholder="COSU6444523620" className={`${inputCls} font-mono disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                    </div>
                    <div>
                      <label className={labelCls}>{ar ? 'رقم الحاوية' : 'Container number'} <span className="text-slate-400 font-normal text-xs">{ar ? '(اختياري)' : '(optional)'}</span></label>
                      <input value={form.containerNumber || ''} onChange={(e) => set('containerNumber', e.target.value)} dir="ltr" disabled={notOwned('containerNumber')}
                        placeholder="MRKU7016023" className={`${inputCls} font-mono disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                    </div>
                    {form.customsLink?.clearance ? (
                      <p className="col-span-full text-[12.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        {ar ? 'مربوطة بمعاملة التخليص ' : 'Linked to customs clearance '}
                        {/* File link only for users who open the customs section; otherwise the number is plain text. */}
                        {(['super_admin', 'admin', 'it_manager', 'it_specialist'].includes((user as any)?.role || '') || canAccessSection(permsOf(user as any), 'Customs'))
                          ? <a href={`/system/customs/${form.customsLink.clearance}`} target="_blank" rel="noreferrer" className="font-bold underline">{form.customsLink.refNumber || '—'}</a>
                          : <b>{form.customsLink.refNumber || '—'}</b>}
                        {form.customsLink.customerName ? ` · ${form.customsLink.customerName}` : ''}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ), { id: SEC.group(g), missing: missingIn(g), filled: filledIn(g) })}
          </div>
        );
      })}

      {/* Notes moved up to the from/to card: they are the trip note and print on the transport order; see notes in the cities card. */}
      {sectionCard(Check, activeGroups.length + 3, ar ? 'الحالة' : 'Status', (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{ar ? 'الحالة' : 'Status'}</label>
            <Select value={form.status || 'requesting'} onChange={(e) => set('status', e.target.value)}>
              {statusVocab.map((s) => <option key={s.key} value={s.key}>{vocabLabel(s, lang as Lang)}</option>)}
            </Select>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'المندوب' : 'Agent'}</label>
            <input value={`${user?.firstName || ''} ${user?.lastName || ''}`.trim()} readOnly disabled className={inputCls + ' opacity-70'} />
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
            {/* Another truck with the same details: beside the create button because it is the same moment's decision (this load goes out on more than one truck). Hidden on edit, since editing is on an existing shipment, not a load being booked. */}
            {!editId && (
              <button type="button" onClick={addExtra}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#f37121]/40 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/10">
                <Truck className="w-4 h-4" /> {ar ? '+ شاحنة أخرى بنفس التفاصيل' : '+ Another truck, same details'}
              </button>
            )}
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? (ar ? 'حفظ التعديلات' : 'Save changes')
                : extras.length
                  ? (ar ? `إنشاء ${extras.length + 1} شحنات` : `Create ${extras.length + 1} shipments`)
                  : (ar ? 'إنشاء الشحنة' : 'Create shipment')}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {/* Extra trucks are shown before save. Each row is an independent shipment created with its own waybill number: same customer, route, price and date, differing supplier, truck and driver. */}
      {!editId && extras.length > 0 && (
        <div className="rounded-2xl border border-[#f37121]/30 bg-[#f37121]/[0.03] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-[#f37121]" />
            <h3 className="font-bold text-slate-900 text-sm">
              {ar ? `الحمولة على ${extras.length + 1} شاحنات` : `This load on ${extras.length + 1} trucks`}
            </h3>
            <span className="text-xs text-slate-500">
              {ar ? 'كلُّ شاحنةٍ شحنةٌ مستقلّةٌ برقم أمر نقل خاصّ بها — نفس بقيّة البيانات'
                  : 'each truck becomes its own shipment with its own waybill — everything else identical'}
            </span>
          </div>

          {/* The first row is shown for information, not edited; it is edited in its own card above. */}
          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-bold text-slate-900">{ar ? 'الشاحنة 1' : 'Truck 1'}</span>
            <span>{suppliers.find((x) => x._id === supplierId)?.name || (ar ? 'بلا مورّد' : 'no supplier')}</span>
            <span className="font-mono">{vehicles.find((x) => x._id === vehicleId)?.plate || newPlate || (ar ? 'بلا شاحنة' : 'no truck')}</span>
            <span>{form.driverName || (ar ? 'بلا سائق' : 'no driver')}</span>
            <span className="text-slate-400">{ar ? '— تُحرَّر من بطاقتَي «العميل والمورّد» و«مالك السيارة» أعلاه' : '— edited in the cards above'}</span>
          </div>

          {extras.map((x, i) => (
            <div key={x.uid} className="rounded-xl bg-white border border-slate-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900">{ar ? `الشاحنة ${i + 2}` : `Truck ${i + 2}`}</span>
                <button type="button" onClick={() => dropExtra(x.uid)}
                  className="text-xs font-semibold text-slate-400 hover:text-red-600">{ar ? 'إزالة' : 'Remove'}</button>
              </div>
              {/* Four fields in a row squeezed the driver and its button until clipped, so two. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'المورّد' : 'Supplier'}</label>
                  <SearchableSelect
                    value={x.supplierId} searchAfter={0} onSearch={searchSuppliers} loading={supBusy}
                    onChange={(v) => {
                      const sp = suppliers.find((y) => y._id === v);
                      setExtra(x.uid, { supplierId: v, supplierName: sp?.name || '', vehicleId: '', vehicleLabel: '' });
                      loadExtraVehicles(x.uid, v);
                    }}
                    placeholder={ar ? 'اختر المورّد…' : 'Pick supplier…'}
                    searchPlaceholder={ar ? 'اسمه أو جوّاله…' : 'Name or phone…'}
                    options={suppliers.map((sp) => ({
                      value: sp._id, label: sp.name,
                      hint: [sp.type === 'freelancer' ? (ar ? 'سائق فرد' : 'Freelancer') : (ar ? 'شركة' : 'Company'), sp.phone].filter(Boolean).join(' · '),
                    }))} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'الشاحنة' : 'Truck'}</label>
                  <SearchableSelect
                    value={x.vehicleId} searchAfter={0} loading={x.busy}
                    onSearch={(q) => loadExtraVehicles(x.uid, x.supplierId, q)}
                    onChange={(v) => {
                      const veh = x.vehicles.find((y) => y._id === v);
                      setExtra(x.uid, {
                        vehicleId: v, vehicleLabel: veh?.plate || '', newPlate: '',
                        driverName: x.driverName || realVal(veh?.defaultDriverName),
                        driverPhone: x.driverPhone || realVal(veh?.defaultDriverPhone),
                      });
                    }}
                    placeholder={x.supplierId ? (ar ? 'اختر شاحنته…' : 'Pick his truck…') : (ar ? 'اختر المورّد أوّلًا' : 'Pick a supplier first')}
                    searchPlaceholder={ar ? 'باللوحة أو السائق…' : 'Plate or driver…'}
                    emptyLabel={ar ? 'لا شاحنة — اكتب اللوحة' : 'None — type the plate'}
                    options={x.vehicles.map((v) => ({
                      value: v._id, label: [v.plate, v.name].filter(Boolean).join(' — '),
                      // Owner and driver: same as in the vehicle owner card above.
                      hint: [supplierOf(v), v.defaultDriverName].filter(Boolean).join(' · ') || undefined,
                    }))} />
                  <input value={x.newPlate}
                    onChange={(e) => setExtra(x.uid, { newPlate: e.target.value, vehicleId: e.target.value.trim() ? '' : x.vehicleId })}
                    placeholder={ar ? 'أو لوحة جديدة' : 'or a new plate'}
                    className={`${inputCls} mt-1.5 text-xs py-1.5`} />
                  {(() => {
                    const veh = x.vehicles.find((y) => y._id === x.vehicleId);
                    if (!veh) return null;
                    const own = typeof veh.supplier === 'object' && veh.supplier ? String(veh.supplier._id) : String(veh.supplier || '');
                    return (
                      <p className={`mt-1 text-[11px] ${own && x.supplierId && own !== x.supplierId ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                        {ar ? 'مالكها: ' : 'Owner: '}{supplierOf(veh)}
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'السائق' : 'Driver'}</label>
                  {/* Same field as on the first truck: search by name, mobile and residency, plus new driver. */}
                  <DriverPicker ar={ar} compact value={x.driverName} contextDrivers={[]}
                    supplierId={x.supplierId || undefined} vehicleId={x.vehicleId || undefined}
                    placeholder={ar ? 'يُملأ من الشاحنة — أو ابحث' : 'from the truck — or search'}
                    onPick={(d) => setExtra(x.uid, { driverName: d.name, ...(d.phone ? { driverPhone: d.phone } : {}) })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'جوّاله' : 'His phone'}</label>
                  {/* Same shared mobile box: key at the left and nine digits at most. */}
                  <PhoneSA compact value={x.driverPhone} onChange={(v) => setExtra(x.uid, { driverPhone: v })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'رقم البوليصة (اختياري)' : 'B/L number (optional)'}</label>
                  <input value={x.blNumber} onChange={(e) => setExtra(x.uid, { blNumber: e.target.value })} dir="ltr" className={`${inputCls} font-mono`} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{ar ? 'رقم الحاوية (اختياري)' : 'Container number (optional)'}</label>
                  <input value={x.containerNumber} onChange={(e) => setExtra(x.uid, { containerNumber: e.target.value })} dir="ltr" className={`${inputCls} font-mono`} />
                </div>
              </div>
            </div>
          ))}

          <button type="button" onClick={addExtra}
            className="text-xs font-semibold text-[#f37121] hover:underline">{ar ? '+ شاحنة أخرى' : '+ another truck'}</button>
        </div>
      )}

    </div>
  );
}

// Route key as the server folds it. Mirrors `routeKey` in backend/src/utils/customerRoutes: direction matters, spelling does not; without it two spellings of one city would be two routes with two prices.
const cityFold = (v: string) => String(v || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const findRoute = (c: any, from: string, to: string) => {
  if (!c || !from || !to) return null;
  const k = `${cityFold(from)}→${cityFold(to)}`;
  return (c.routes || []).find((r: any) => `${cityFold(r.fromCity)}→${cityFold(r.toCity)}` === k) || null;
};

export default function Page() {
  // useSearchParams needs a Suspense boundary in the app router.
  return <Suspense fallback={<Spinner />}><CreateShipmentInner /></Suspense>;
}
