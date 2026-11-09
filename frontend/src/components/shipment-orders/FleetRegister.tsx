'use client';
/**
 * Suppliers and vehicles: the fleet register the create form reads and feeds.
 * Three ownership states, not two: has a supplier, ours, or unknown. Thousands of trucks were imported from order history with no supplier reference, so absence means unknown, not ours (our fleet is 58 trucks).
 * Counts come from the server, not the received array (a capped page would count the cap). Search is server-side too, with whitespace and hamza folding there, otherwise it searches only the loaded rows and reports no results.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { canAccessSection, permsOf } from '@/lib/sections';
import { formatPlate } from '@/lib/flexMatch';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Building2, User as UserIcon, Plus, Pencil, Trash2, Check, Loader2, IdCard, GitMerge } from 'lucide-react';
import SupplierMergeModal, { supplierNameKey } from '@/components/shipment-orders/SupplierMergeModal';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea,
  SearchableSelect, SmallBadge, Tabs, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { OrderSupplier, OrderVehicle, OrderDriver, FormField, optionLabel, canEditOrders, canAdminOrders, canMergeSuppliers, Lang } from '@/lib/shipmentOrders';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { ContactButtons } from '@/components/crm/CrmKit';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';
import { PersonDocDate, docStateLabel, personDocExportColumns } from '@/components/system/PersonDocDate';

const EMPTY_SUPPLIER = { name: '', type: 'company' as 'company' | 'freelancer', phone: '', email: '', notes: '' };
const EMPTY_VEHICLE = {
  plate: '', name: '', truckType: '', brand: '', color: '', modelYear: '',
  operationCardNumber: '', operationCardExpiry: '',
  supplier: '', ownership: 'unknown', defaultDriverName: '', defaultDriverPhone: '', notes: '',
};

const PAGE = 200;
type Owner = '' | 'not_ours' | 'supplier' | 'ours' | 'unknown';

/**
 * One register, three screens: Shipment Orders «الموردون والمركبات», and the vendors section's «السيارات» and
 * «السائقون الأفراد». Same endpoints and the same live event, so an edit on one shows on the others at once.
 */
export default function FleetRegister({ initialTab = 'suppliers', supplierType, title, subtitle }: {
  initialTab?: 'suppliers' | 'vehicles' | 'drivers';
  /** Only companies or only freelance drivers in the suppliers tab. */
  supplierType?: 'company' | 'freelancer';
  title?: string;
  subtitle?: string;
} = {}) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user);

  const [suppliers, setSuppliers] = useState<OrderSupplier[]>([]);
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  // The driver is a third register. A driver used to be a name on the truck row, so residency number, operating card and expiry, and a supplier's drivers could not be queried. It is also the record the platform uses to link a truck to its owner.
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** The page opens on suppliers: the supplier is the unit of this register, with its trucks and drivers. Opening on thousands of trucks gives an unorganised list. */
  const [tab, setTab] = useState<string>(initialTab);
  const vendorsSection = canAccessSection(permsOf(user), 'Vendors Management');
  // With a supplier open, the trucks and drivers tabs are limited to it until it is closed.
  const [focusSup, setFocusSup] = useState<OrderSupplier | null>(null);
  const [search, setSearch] = useState('');
  // Our own fleet is shown only on request. This is the carriers' register: this section's loads are assigned to them, while our 58 trucks are managed in fleet management. The badge for our fleet reveals them for verification; no row is deleted from the register.
  const [owner, setOwner] = useState<Owner>('not_ours');
  const [sum, setSum] = useState({ vehicles: 0, suppliers: 0, drivers: 0, supplier: 0, ours: 0, unknown: 0 });
  // Register gaps as counted by the server; shown explicitly and clickable to filter.
  const [gaps, setGaps] = useState({ unknown: 0, noBrand: 0, supNoVehicle: 0 });
  const [shownTotals, setShownTotals] = useState({ vehicles: 0, suppliers: 0, drivers: 0 });

  const [supModal, setSupModal] = useState(false);
  const [editingSup, setEditingSup] = useState<OrderSupplier | null>(null);
  // Merge of two duplicate suppliers; see SupplierMergeModal.
  const [mergeFor, setMergeFor] = useState<OrderSupplier | null>(null);
  const [supForm, setSupForm] = useState<any>(EMPTY_SUPPLIER);

  const [vehModal, setVehModal] = useState(false);
  const [editingVeh, setEditingVeh] = useState<OrderVehicle | null>(null);
  const [vehForm, setVehForm] = useState<any>(EMPTY_VEHICLE);
  const [saving, setSaving] = useState(false);
  // The owner list in the form is independent of the tab list: that one follows the page search, this one the field search; mixing them rebuilds the table while typing in the form.
  const [modalSupQ, setModalSupQ] = useState('');
  const [modalSups, setModalSups] = useState<OrderSupplier[]>([]);
  const [modalSupTotal, setModalSupTotal] = useState(0);
  const [modalSupBusy, setModalSupBusy] = useState(false);

  const EMPTY_DRIVER = {
    name: '', phone: '', nationality: '', residenceNumber: '',
    driverCardNumber: '', driverCardExpiry: '', sponsorName: '',
    supplier: '', vehicle: '', notes: '',
  };
  const [drvModal, setDrvModal] = useState(false);
  const [editingDrv, setEditingDrv] = useState<OrderDriver | null>(null);
  const [drvForm, setDrvForm] = useState<any>(EMPTY_DRIVER);
  // Only the selected supplier's trucks: linking a driver to a truck outside his supplier is an error written once and read for long.
  const [drvVehicles, setDrvVehicles] = useState<OrderVehicle[]>([]);

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
      const [sp, v, dr, sm] = await Promise.all([
        api.get<{ suppliers: OrderSupplier[]; total: number }>(`/api/shipment-orders/suppliers?limit=${PAGE}${q}${supplierType ? `&type=${supplierType}` : ''}`),
        api.get<{ vehicles: OrderVehicle[]; total: number }>(`/api/shipment-orders/vehicles?limit=${PAGE}${q}${focusSup ? `&supplier=${focusSup._id}` : (owner ? `&ownership=${owner}` : '')}`),
        api.get<{ drivers: OrderDriver[]; total: number }>(`/api/shipment-orders/drivers?limit=${PAGE}${q}${focusSup ? `&supplier=${focusSup._id}` : ''}`),
        api.get<typeof sum>('/api/shipment-orders/fleet-summary'),
      ]);
      if (!guard.isCurrent(mine)) return;
      setSuppliers(sp.suppliers || []);
      setVehicles(v.vehicles || []);
      setDrivers(dr.drivers || []);
      setShownTotals({ vehicles: v.total || 0, suppliers: sp.total || 0, drivers: dr.total || 0 });
      setSum(sm);
      setGaps((sm as any).gaps || { unknown: 0, noBrand: 0, supNoVehicle: 0 });
      setError('');
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || 'Request failed'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [search, owner, focusSup, guard, supplierType]);
  // Search is debounced after typing stops, not one request per character.
  useEffect(() => {
    const t = setTimeout(() => load(), search.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));
  // Drivers linked to an HR file show its name, residency and phone; an edit there shows here at once.
  useSocket('hr:employee', useCallback(() => load(), [load]));
  // Identity of our trucks (plate, make, colour) is read from the vehicle register at view time (vehicleView), so edits there show here immediately.
  useSocket('vreg:updated', useCallback(() => load(), [load]));
  // Truck types are read from the form fields, so a type added there is selectable here at once.
  useSocket('shipmentOrders:fields', useCallback(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, []));
  // Truck types come from the same form vocabulary, so a type added in
  // form-settings is pickable here too.
  useEffect(() => {
    api.get<{ fields: FormField[] }>('/api/shipment-orders/fields')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, []);

  const truckTypes = fields.find((f) => f.key === 'truckType')?.options || [];

  const modalGuard = useLatestRequest();
  useEffect(() => {
    if (!vehModal) return;
    const mine = modalGuard.begin();
    setModalSupBusy(true);
    api.get<{ suppliers: OrderSupplier[]; total: number }>(
      `/api/shipment-orders/suppliers?limit=60${modalSupQ.trim() ? `&q=${encodeURIComponent(modalSupQ.trim())}` : ''}`)
      .then((d) => {
        if (!modalGuard.isCurrent(mine)) return;
        setModalSups(d.suppliers || []);
        setModalSupTotal(d.total || 0);
      })
      .catch(() => {})
      .finally(() => { if (modalGuard.isCurrent(mine)) setModalSupBusy(false); });
  }, [vehModal, modalSupQ, modalGuard]);

  const supplierName = (v: OrderVehicle) =>
    typeof v.supplier === 'object' && v.supplier ? v.supplier.name : '';
  // Row ownership in one word, with unknown shown as unknown.
  const ownerLabel = (v: OrderVehicle) => supplierName(v)
    || (v.ownership === 'ours' ? (ar ? 'أسطولنا' : 'Our fleet') : (ar ? 'غير مسجَّل' : 'Not recorded'));

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
    // The waybill prints make and colour, so both are required here rather than left to the paper.
    if (!String(vehForm.brand || '').trim() || !String(vehForm.color || '').trim()) {
      notify(ar ? 'الماركة واللون مطلوبان — يُطبعان في أمر النقل.' : 'Brand and colour are required — they print on the waybill.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...vehForm,
        supplier: vehForm.supplier || null,
        ownership: vehForm.supplier ? 'supplier' : (vehForm.ownership === 'ours' ? 'ours' : 'unknown'),
      };
      if (editingVeh) await api.put(`/api/shipment-orders/vehicles/${editingVeh._id}`, payload);
      else await api.post('/api/shipment-orders/vehicles', payload);
      setVehModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openDriver = (d: OrderDriver | null) => {
    setEditingDrv(d);
    const sup = d && typeof d.supplier === 'object' && d.supplier ? d.supplier : null;
    const veh = d && typeof d.vehicle === 'object' && d.vehicle ? d.vehicle : null;
    setDrvForm(d
      ? {
        ...EMPTY_DRIVER, ...d,
        driverCardExpiry: (d.driverCardExpiry || '').slice(0, 10),
        supplier: sup?._id || (typeof d.supplier === 'string' ? d.supplier : ''),
        vehicle: veh?._id || (typeof d.vehicle === 'string' ? d.vehicle : ''),
      }
      : { ...EMPTY_DRIVER });
    // Its supplier and truck are seeded into their lists: each list is one page of a large register.
    if (sup) setModalSups((p) => (p.some((x) => x._id === sup._id) ? p : [sup, ...p]));
    setDrvVehicles(veh ? [veh] : []);
    setModalSupQ('');
    setDrvModal(true);
  };

  // A supplier's trucks are requested by its id, not filtered from a loaded page.
  useEffect(() => {
    if (!drvModal || !drvForm.supplier) return;
    api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?supplier=${drvForm.supplier}&limit=500`)
      .then((d) => setDrvVehicles(d.vehicles || [])).catch(() => {});
  }, [drvModal, drvForm.supplier]);

  const saveDriver = async () => {
    if (!drvForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...drvForm, supplier: drvForm.supplier || null, vehicle: drvForm.vehicle || null };
      if (editingDrv) await api.put(`/api/shipment-orders/drivers/${editingDrv._id}`, payload);
      else await api.post('/api/shipment-orders/drivers', payload);
      setDrvModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const removeDriver = async (d: OrderDriver) => {
    if (!(await confirm(ar ? `إزالة السائق «${d.name}»؟ شحناته السابقة تحتفظ ببياناتها.` : `Remove “${d.name}”? Past shipments keep their snapshot.`))) return;
    try { await api.delete(`/api/shipment-orders/drivers/${d._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const removeSupplier = async (s: OrderSupplier) => {
    if (!(await confirm(ar ? `إزالة المورد «${s.name}»؟ سياراته تبقى مسجلة.` : `Remove “${s.name}”? Their vehicles stay.`))) return;
    try { await api.delete(`/api/shipment-orders/suppliers/${s._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const removeVehicle = async (v: OrderVehicle) => {
    if (!(await confirm(ar ? `إزالة السيارة «${v.plate}»؟ الشحنات السابقة تحتفظ ببياناتها.` : `Remove “${v.plate}”? Past shipments keep their snapshot.`))) return;
    try { await api.delete(`/api/shipment-orders/vehicles/${v._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  // The server already filtered by search and ownership; filtering the received rows again would hide what it found.
  const shownVehicles = vehicles;
  const shownSuppliers = suppliers;
  // Names duplicated after letter folding are marked as duplicate and open the merge.
  const dupKeys = (() => {
    const n = new Map<string, number>();
    suppliers.forEach((x) => { const k = supplierNameKey(x.name); n.set(k, (n.get(k) || 0) + 1); });
    return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k));
  })();

  const vehicleCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 16 },
    { header: ar ? 'الوصف' : 'Description', key: 'name', width: 26, transform: (v) => v || '—' },
    { header: ar ? 'النوع' : 'Type', key: 'truckType', width: 18, transform: (v) => v || '—' },
    { header: ar ? 'الماركة' : 'Brand', key: 'brand', width: 18, transform: (v) => v || '—' },
    { header: ar ? 'اللون' : 'Color', key: 'color', width: 14, transform: (v) => v || '—' },
    { header: ar ? 'بطاقة التشغيل' : 'Operation card', key: 'operationCardNumber', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'انتهاؤها' : 'Card expiry', key: 'operationCardExpiry', width: 14, transform: (v) => (v || '').slice(0, 10) || '—' },
    // An empty cell reads as missing data, so ownership is written as a word.
    { header: ar ? 'المالك' : 'Owner', key: 'supplier', width: 26, transform: (_v, r) => ownerLabel(r) },
    { header: ar ? 'السائق المعتاد' : 'Usual driver', key: 'defaultDriverName', width: 24, transform: (v) => v || '—' },
    { header: ar ? 'جواله' : 'Driver phone', key: 'defaultDriverPhone', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];
  const supplierCols: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', width: 30 },
    { header: ar ? 'النوع' : 'Type', key: 'type', width: 14, transform: (v) => (v === 'freelancer' ? (ar ? 'سائق فرد' : 'Freelancer') : (ar ? 'شركة' : 'Company')) },
    { header: ar ? 'الجوال' : 'Phone', key: 'phone', width: 16 },
    { header: ar ? 'البريد' : 'Email', key: 'email', width: 26 },
    { header: ar ? 'عدد السيارات' : 'Vehicles', key: 'vehicleCount', width: 12, transform: (v) => Number(v || 0) },
    { header: ar ? 'عدد السائقين' : 'Drivers', key: 'driverCount', width: 12, transform: (v) => Number(v || 0) },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];

  const driverCols: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', width: 28 },
    { header: ar ? 'الجوال' : 'Phone', key: 'phone', width: 16 },
    { header: ar ? 'الجنسية' : 'Nationality', key: 'nationality', width: 16 },
    { header: ar ? 'رقم الإقامة' : 'Iqama', key: 'residenceNumber', width: 16 },
    ...personDocExportColumns(ar),
    { header: ar ? 'بطاقة التشغيل' : 'Driver card', key: 'driverCardNumber', width: 16 },
    { header: ar ? 'انتهاء البطاقة' : 'Card expiry', key: 'driverCardExpiry', width: 14 },
    { header: ar ? 'المورّد' : 'Supplier', key: 'supplier', width: 28, transform: (v: any) => v?.name || '' },
    { header: ar ? 'الشاحنة' : 'Truck', key: 'vehicle', width: 16, transform: (v: any) => v?.plate || '' },
    { header: ar ? 'الكفيل' : 'Sponsor', key: 'sponsorName', width: 22 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 26 },
  ];

  // Operating card expiry is coloured: a driver with an expired card is stopped by the road, so knowing the date before assignment avoids a stranded load.
  const cardState = (d: OrderDriver) => {
    const x = (d.driverCardExpiry || '').slice(0, 10);
    if (!x) return { cls: 'text-slate-300', label: '—' };
    const days = Math.round((new Date(`${x}T00:00:00`).getTime() - Date.now()) / 86400000);
    if (days < 0) return { cls: 'bg-red-500/15 text-red-700', label: ar ? `منتهية (${x})` : `Expired (${x})` };
    if (days <= 30) return { cls: 'bg-amber-500/15 text-amber-700', label: ar ? `تنتهي بعد ${days} يوم` : `${days} days left` };
    return { cls: 'bg-emerald-500/15 text-emerald-700', label: x };
  };

  // Residency and driving licence expiry: a funnel on their column headers filters by status, not by date.
  const cf = useColumnFilters<OrderDriver>({
    iqamaExp: (d) => docStateLabel(d.iqamaState, ar),
    licenseExp: (d) => docStateLabel(d.licenseState, ar),
  }, drivers, ar ? 'ar' : 'en');
  const shownDrivers = cf.apply(drivers);

  if (loading) return <Spinner />;

  const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={title || (ar ? 'الموردون والمركبات' : 'Suppliers & vehicles')}
        subtitle={subtitle || (ar
          ? `${sum.suppliers} مورّدًا · ${sum.vehicles} شاحنة · ${sum.drivers} سائقًا — المورّدُ أوّلًا، ومنه تُفتَح شاحناتُه وسوّاقُه`
          : `${sum.suppliers} suppliers · ${sum.vehicles} trucks · ${sum.drivers} drivers — start from the supplier, open his trucks and drivers from him`)}>
        {/* The two tabs show different registers and the search filters what is displayed, so the first option matches the screen and the second exports both registers in full as two sheets. */}
        <ExportMenu
          fileName="shipment-orders-fleet" lang={ar ? 'ar' : 'en'}
          options={[
            tab === 'vehicles'
              ? { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'المركبات' : 'Vehicles', rows: shownVehicles as any[], columns: vehicleCols }] }
              : tab === 'drivers'
                ? { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'السائقون' : 'Drivers', rows: shownDrivers as any[], columns: driverCols }] }
                : { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'الموردون' : 'Suppliers', rows: shownSuppliers as any[], columns: supplierCols }] },
            {
              // The full export is fetched on request: the page shows 200 of thousands, so exporting the received array under an all label would hand over 200 as if it were the register.
              key: 'all', label: exportScopeLabels(ar).all,
              resolve: async () => {
                const [v, sp] = await Promise.all([
                  api.get<{ vehicles: OrderVehicle[] }>('/api/shipment-orders/vehicles?limit=5000'),
                  api.get<{ suppliers: OrderSupplier[] }>('/api/shipment-orders/suppliers?limit=5000'),
                ]);
                const dr = await api.get<{ drivers: OrderDriver[] }>('/api/shipment-orders/drivers?limit=5000');
                return [
                  { name: ar ? 'المركبات' : 'Vehicles', rows: (v.vehicles || []) as any[], columns: vehicleCols },
                  { name: ar ? 'الموردون' : 'Suppliers', rows: (sp.suppliers || []) as any[], columns: supplierCols },
                  { name: ar ? 'السائقون' : 'Drivers', rows: (dr.drivers || []) as any[], columns: driverCols },
                ];
              },
            },
          ]}
        />
        {editor && (tab === 'vehicles'
          ? <PrimaryButton onClick={() => { setEditingVeh(null); setVehForm({ ...EMPTY_VEHICLE }); setVehModal(true); }}><Plus className="w-4 h-4" /> {ar ? 'إضافة سيارة' : 'Add vehicle'}</PrimaryButton>
          : tab === 'drivers'
            ? <PrimaryButton onClick={() => openDriver(null)}><Plus className="w-4 h-4" /> {ar ? 'إضافة سائق' : 'Add driver'}</PrimaryButton>
            : <PrimaryButton onClick={() => { setEditingSup(null); setSupForm({ ...EMPTY_SUPPLIER }); setSupModal(true); }}><Plus className="w-4 h-4" /> {ar ? 'إضافة مورد' : 'Add supplier'}</PrimaryButton>)}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'suppliers', label: supplierType === 'freelancer' ? (ar ? 'السائقون الأفراد' : 'Freelance drivers') : (ar ? 'الموردون' : 'Suppliers'), badge: supplierType ? shownTotals.suppliers : sum.suppliers },
        { key: 'vehicles', label: ar ? 'المركبات' : 'Vehicles', badge: focusSup ? shownTotals.vehicles : sum.vehicles },
        { key: 'drivers', label: ar ? 'السائقون' : 'Drivers', badge: focusSup ? shownTotals.drivers : sum.drivers },
      ]} />

      {/* Open supplier: trucks and drivers are limited to it. The next question after who the supplier is is what it has, which used to need a name search in another tab. */}
      {focusSup && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] px-4 py-2.5">
          <span className="text-sm font-bold text-slate-900">{focusSup.name}</span>
          <span className="text-xs text-slate-500">
            {ar ? `${focusSup.vehicleCount || 0} شاحنة · ${focusSup.driverCount || 0} سائق`
                : `${focusSup.vehicleCount || 0} trucks · ${focusSup.driverCount || 0} drivers`}
          </span>
          <button type="button" onClick={() => setFocusSup(null)}
            className="ms-auto text-xs font-semibold text-slate-400 hover:text-[#f37121]">
            {ar ? 'عرض الكل' : 'Show all'}
          </button>
        </div>
      )}

      {/* Register gaps are stated rather than left to look broken. Many empty cells read as a corrupt register, but the source platform carries no make or colour and many trucks have no known owner yet. Counts are explicit and each is clickable to filter: pending work, not a hidden defect. */}
      {tab !== 'drivers' && !focusSup && (gaps.unknown > 0 || gaps.noBrand > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5">
          <span className="text-xs font-bold text-amber-900">{ar ? 'ينقص السجلَّ:' : 'The register is missing:'}</span>
          {gaps.unknown > 0 && (
            <button type="button" onClick={() => { setTab('vehicles'); setOwner('unknown'); }}
              className="text-xs font-semibold text-amber-800 underline decoration-amber-300 hover:decoration-amber-700">
              {ar ? `${gaps.unknown} شاحنة بلا مورّد` : `${gaps.unknown} trucks with no supplier`}
            </button>
          )}
          {gaps.noBrand > 0 && (
            <span className="text-xs text-amber-800">
              {ar ? `· ${gaps.noBrand} بلا ماركة أو لون — تُطبَع فارغةً في أمر النقل`
                  : `· ${gaps.noBrand} with no brand or colour — they print blank on the waybill`}
            </span>
          )}
          {gaps.supNoVehicle > 0 && (
            <span className="text-xs text-amber-800">
              {ar ? `· ${gaps.supNoVehicle} مورّدًا بلا شاحنة` : `· ${gaps.supNoVehicle} suppliers with no truck`}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:max-w-md">
          <SearchInput value={search} onChange={setSearch}
            placeholder={tab === 'vehicles'
              ? (ar ? 'باللوحة أو السائق أو بطاقة التشغيل…' : 'Plate, driver or operation card…')
              : tab === 'drivers'
                ? (ar ? 'بالاسم أو الجوّال أو رقم الإقامة أو بطاقة التشغيل…' : 'Name, phone, iqama or driver card…')
                : (ar ? 'بالاسم أو الجوّال أو السجل أو الآيبان…' : 'Name, phone, CR or IBAN…')} />
        </div>
        {/* Ownership filter: showing trucks with unknown owner is a question users ask; thousands of such trucks are pending work and invisible unless requested. */}
        {tab === 'vehicles' && !focusSup && (
          <div className="flex flex-wrap gap-1.5">
            {([['not_ours', ar ? 'شاحنات الناقلين' : 'Carrier trucks', sum.vehicles - sum.ours],
              ['supplier', ar ? 'مالكُها مسجَّل' : 'Owner recorded', sum.supplier],
              ['unknown', ar ? 'مالكُها غير مسجَّل' : 'Owner not recorded', sum.unknown],
              ['ours', ar ? 'أسطولنا' : 'Ours', sum.ours],
              ['', ar ? 'الكل' : 'All', sum.vehicles]] as const).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setOwner(k as Owner)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${owner === k
                  ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                {label} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* What the matcher shows: the page caps at 200, and silence about the rest would hide it. */}
      {tab === 'vehicles' && shownTotals.vehicles > vehicles.length && (
        <p className="text-xs text-slate-500">
          {ar ? `يُعرَض ${vehicles.length} من ${shownTotals.vehicles} مطابقة — ضيّق البحث لترى البقيّة.`
              : `Showing ${vehicles.length} of ${shownTotals.vehicles} matches — narrow the search for the rest.`}
        </p>
      )}
      {tab === 'suppliers' && shownTotals.suppliers > suppliers.length && (
        <p className="text-xs text-slate-500">
          {ar ? `يُعرَض ${suppliers.length} من ${shownTotals.suppliers} مطابقة — ضيّق البحث لترى البقيّة.`
              : `Showing ${suppliers.length} of ${shownTotals.suppliers} matches — narrow the search for the rest.`}
        </p>
      )}
      {tab === 'drivers' && shownTotals.drivers > drivers.length && (
        <p className="text-xs text-slate-500">
          {ar ? `يُعرَض ${drivers.length} من ${shownTotals.drivers} مطابقة — ضيّق البحث لترى البقيّة.`
              : `Showing ${drivers.length} of ${shownTotals.drivers} matches — narrow the search for the rest.`}
        </p>
      )}

      {tab === 'vehicles' && (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
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
                  <td className="px-4 py-3 text-slate-900 font-bold font-mono">{formatPlate(v.plate)}</td>
                  <td className="px-4 py-3 text-slate-700">{v.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{v.truckType || '—'}</td>
                  <td className="px-4 py-3">
                    {v.supplier
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={supplierName(v)} />
                      : v.ownership === 'ours'
                        ? <span className="inline-flex flex-col items-start gap-0.5">
                            <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={ar ? 'أسطولنا' : 'Our fleet'} />
                            {/* Linked to the vehicle register: make and colour come from it, and edits there show here. */}
                            {v.registry && <span className="text-[11px] text-slate-500" title={ar ? 'من سجلّ المركبات' : 'From the vehicle register'}>{ar ? 'سجلّ المركبات: ' : 'Register: '}{v.registry.plateNumber}</span>}
                          </span>
                        : <SmallBadge bg="bg-slate-400/20" text="text-slate-600" label={ar ? 'غير مسجَّل' : 'Not recorded'} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{[v.defaultDriverName, v.defaultDriverPhone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editor && <button type="button" onClick={() => {
                        setEditingVeh(v);
                        setVehForm({ ...EMPTY_VEHICLE, ...v, ownership: v.ownership || 'unknown', supplier: typeof v.supplier === 'object' ? v.supplier?._id || '' : (v.supplier || '') });
                        // The row's supplier is seeded into the list, which is one page of thousands.
                        if (typeof v.supplier === 'object' && v.supplier) {
                          const sp = v.supplier as OrderSupplier;
                          setModalSups((pv) => (pv.some((x) => x._id === sp._id) ? pv : [sp, ...pv]));
                        }
                        setModalSupQ('');
                        setVehModal(true);
                      }} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                      {canAdminOrders(user) && <button type="button" onClick={() => removeVehicle(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-12">
                {search.trim() || owner
                  ? (ar ? 'لا شاحنةَ تطابق البحث — جرّب لوحةً أو جزءًا منها.' : 'No truck matches — try a plate or part of one.')
                  : (ar ? 'لا توجد سيارات بعد — أول شحنة بسيارة جديدة تُسجّلها هنا تلقائياً.' : 'No vehicles yet — the first shipment with a new truck registers it here.')}
              </td></tr>}
            </tbody>
          </table>
        </ScrollX>
      )}

      {/* Suppliers are a table, not cards. Two registers shared a page, one a table and one two cards per row; a table reads down the column and sorts and compares, whereas cards force jumping between boxes. A register is read row by row. */}
      {tab === 'suppliers' && (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{ar ? 'المورّد' : 'Supplier'}</th>
              <th className={th}>{ar ? 'النوع' : 'Type'}</th>
              <th className={th}>{ar ? 'التواصل' : 'Contact'}</th>
              {/* Email is replaced by what is actually asked for: email is filled for about one in ten suppliers, while commercial registration and IBAN are filled for about eight in ten and are needed at the first payment. */}
              <th className={th}>{ar ? 'السجل والآيبان' : 'CR & IBAN'}</th>
              <th className={th}>{ar ? 'سياراته' : 'Vehicles'}</th>
              <th className={th}>{ar ? 'سوّاقه' : 'Drivers'}</th>
              <th className={th}>{ar ? 'ملاحظات' : 'Notes'}</th>
              <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr></thead>
            <tbody>
              {shownSuppliers.map((s) => (
                <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${s.type === 'freelancer' ? 'bg-violet-500/15 text-violet-600' : 'bg-blue-500/15 text-blue-600'}`}>
                        {s.type === 'freelancer' ? <UserIcon className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                      </span>
                      <button type="button"
                        onClick={() => { setFocusSup(s); setTab('vehicles'); setSearch(''); }}
                        className="font-bold text-slate-900 truncate text-start hover:text-[#f37121]"
                        title={ar ? 'افتح شاحناته وسوّاقه' : 'Open his trucks and drivers'}>
                        {s.name}
                      </button>
                      {vendorsSection && (
                        <Link href={`/system/vendors-mgmt/vendors/${s._id}`} title={ar ? 'بطاقة المورّد في إدارة الموردين' : 'Carrier card'}
                          className="shrink-0 inline-flex items-center gap-0.5 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:text-[#f37121] hover:border-[#f37121]/40">
                          <IdCard className="w-3 h-3" />{ar ? 'البطاقة' : 'Card'}
                        </Link>
                      )}
                      {(s as any).inMaster && <span className="shrink-0 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 text-[10.5px] font-semibold">{ar ? 'معتمد' : 'Approved'}</span>}
                      {(s as any).contractStatus && <span className="shrink-0 rounded-md bg-slate-50 border border-slate-200 text-slate-600 px-1.5 py-0.5 text-[10.5px]">{(s as any).contractStatus}</span>}
                      {dupKeys.has(supplierNameKey(s.name)) && (
                        canMergeSuppliers(user)
                          ? <button type="button" onClick={() => setMergeFor(s)}
                              className="shrink-0 inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[11px] font-bold hover:bg-amber-200"
                              title={ar ? 'نفس الاسم مسجَّل أكثر من مرّة — اضغط للدمج' : 'Same name recorded more than once — tap to merge'}>
                              <GitMerge className="w-3 h-3" />{ar ? 'مكرَّر' : 'Duplicate'}
                            </button>
                          : <span className="shrink-0 rounded-md bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[11px] font-bold">{ar ? 'مكرَّر' : 'Duplicate'}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.type === 'freelancer'
                      ? <SmallBadge bg="bg-violet-500/15" text="text-violet-700" label={ar ? 'سائق فرد' : 'Freelancer'} />
                      : <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={ar ? 'شركة' : 'Company'} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {(s.phone || '').trim()
                      ? <div className="flex items-center gap-2"><span className="font-mono text-[13px]" dir="ltr">{s.phone}</span><ContactButtons phone={s.phone} size={15} /></div>
                      : <span className="text-slate-300">—</span>}
                    {/* And the manager by number: contacting the owner about an invoice wastes a day. */}
                    {s.managerName ? (
                      <span className="block text-[11px] text-slate-500 truncate max-w-[190px]">
                        {s.managerName}{s.managerPhone ? ` · ${s.managerPhone}` : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {s.commercialRegister || s.iban ? (
                      <span className="block text-[11.5px] text-slate-600 font-mono" dir="ltr">
                        {s.commercialRegister || '—'}
                        {s.iban ? <span className="block text-[10.5px] text-slate-400">{s.iban}</span> : null}
                      </span>
                    ) : <span className="text-amber-600 text-[11px] font-semibold">{ar ? 'بلا أوراق' : 'no paperwork'}</span>}
                  </td>
                  {/* Truck count: one truck differs from twenty, readable from the number before opening any file. */}
                  {/* The number is a door: a reader seeing the truck count wants to see those trucks, which used to need a supplier-name search in another tab. */}
                  <td className="px-4 py-3">
                    {s.vehicleCount
                      ? <button type="button" onClick={() => { setFocusSup(s); setTab('vehicles'); setSearch(''); }}
                          className="tabular-nums font-semibold text-slate-900 hover:text-[#f37121] underline decoration-slate-200 hover:decoration-[#f37121]">
                          {s.vehicleCount}
                        </button>
                      : <span className="text-amber-600 text-xs font-semibold">{ar ? 'بلا شاحنة' : 'none'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {s.driverCount
                      ? <button type="button" onClick={() => { setFocusSup(s); setTab('drivers'); setSearch(''); }}
                          className="tabular-nums font-semibold text-slate-900 hover:text-[#f37121] underline decoration-slate-200 hover:decoration-[#f37121]">
                          {s.driverCount}
                        </button>
                      : <span className="text-slate-300">0</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate" title={s.notes || ''}>{s.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editor && <button type="button" onClick={() => { setEditingSup(s); setSupForm({ ...EMPTY_SUPPLIER, ...s }); setSupModal(true); }} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                      {canMergeSuppliers(user) && <button type="button" onClick={() => setMergeFor(s)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'دمج مع مورّد آخر' : 'Merge with another supplier'}><GitMerge className="w-4 h-4" /></button>}
                      {canAdminOrders(user) && <button type="button" onClick={() => removeSupplier(s)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && <tr><td colSpan={8} className="text-center text-slate-500 py-12">
                {search.trim()
                  ? (ar ? 'لا مورّدَ يطابق البحث.' : 'No supplier matches.')
                  : (ar ? 'لا يوجد مورّدون بعد — أول سيارة مورّد في شحنة تُسجّل صاحبها هنا.' : 'No suppliers yet — the first supplier truck on a shipment registers them.')}
              </td></tr>}
            </tbody>
          </table>
        </ScrollX>
      )}

      {/* Drivers table: the file holds what is asked at assignment: residency number, operating card and its expiry, sponsor, and which truck and supplier he works for. */}
      {tab === 'drivers' && (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{ar ? 'السائق' : 'Driver'}</th>
              <th className={th}>{ar ? 'الجوال' : 'Phone'}</th>
              <th className={th}>{ar ? 'الجنسية' : 'Nationality'}</th>
              <th className={th}>{ar ? 'رقم الإقامة' : 'Iqama'}</th>
              <th className={th}>{cf.head('iqamaExp', ar ? 'انتهاء الإقامة' : 'Iqama expiry')}</th>
              <th className={th}>{cf.head('licenseExp', ar ? 'انتهاء رخصة القيادة' : 'Licence expiry')}</th>
              <th className={th}>{ar ? 'بطاقة التشغيل' : 'Driver card'}</th>
              <th className={th}>{ar ? 'انتهاؤها' : 'Expires'}</th>
              <th className={th}>{ar ? 'المورّد' : 'Supplier'}</th>
              <th className={th}>{ar ? 'شاحنته' : 'His truck'}</th>
              <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr></thead>
            <tbody>
              {shownDrivers.map((d) => {
                const card = cardState(d);
                const sup = typeof d.supplier === 'object' && d.supplier ? d.supplier : null;
                const veh = typeof d.vehicle === 'object' && d.vehicle ? d.vehicle : null;
                return (
                  <tr key={d._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-500/10 text-slate-600">
                          <IdCard className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-bold text-slate-900 truncate">{d.name}</span>
                          {/* Our own employee: name and mobile come from his HR file. */}
                          {d.hr ? <span className="block"><SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={ar ? 'موظّف — من الموارد البشرية' : 'Employee — from HR'} /></span> : null}
                          {d.sponsorName ? <span className="block text-[11px] text-slate-500 truncate">{ar ? 'كفيله: ' : 'Sponsor: '}{d.sponsorName}</span> : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {(d.phone || '').trim()
                        ? <div className="flex items-center gap-2"><span className="font-mono text-[13px]" dir="ltr">{d.phone}</span><ContactButtons phone={d.phone} size={15} /></div>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{d.nationality || '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{d.residenceNumber || '—'}</td>
                    <td className="px-4 py-3"><PersonDocDate ar={ar} date={d.iqamaExpiry} state={d.iqamaState} /></td>
                    <td className="px-4 py-3"><PersonDocDate ar={ar} date={d.licenseExpiry} state={d.licenseState} /></td>
                    <td className="px-4 py-3 font-mono text-slate-700">{d.driverCardNumber || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.driverCardExpiry
                        ? <span className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${card.cls}`}>{card.label}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {sup
                        ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={sup.name} />
                        : <span className="text-slate-400 text-xs">{ar ? 'غير مربوط' : 'Unlinked'}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatPlate(veh?.plate) || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {editor && <button type="button" onClick={() => openDriver(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                        {canAdminOrders(user) && <button type="button" onClick={() => removeDriver(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shownDrivers.length === 0 && <tr><td colSpan={11} className="text-center text-slate-500 py-12">
                {search.trim()
                  ? (ar ? 'لا سائقَ يطابق البحث — جرّب رقم الإقامة.' : 'No driver matches — try the iqama number.')
                  : (ar ? 'لا سائقين بعد.' : 'No drivers yet.')}
              </td></tr>}
            </tbody>
          </table>
        </ScrollX>
      )}

      {mergeFor && (
        <SupplierMergeModal supplier={mergeFor} all={suppliers} ar={ar}
          onClose={() => setMergeFor(null)} onDone={() => { setMergeFor(null); load(); }} />
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
              {([['company', ar ? 'شركة' : 'Company', Building2], ['freelancer', ar ? 'سائق فرد' : 'Freelancer', UserIcon]] as const).map(([k, label, Ic]) => (
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

      {/* Driver form: supplier before truck. The truck is chosen only from his supplier's trucks, so a man is never linked to a truck that is not his employer's. */}
      <Modal open={drvModal} onClose={() => setDrvModal(false)}
        title={editingDrv ? (ar ? 'تعديل سائق' : 'Edit driver') : (ar ? 'إضافة سائق' : 'Add driver')}
        footer={<>
          <button type="button" onClick={() => setDrvModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveDriver} disabled={saving || !drvForm.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الاسم *' : 'Name *'}><TextInput value={drvForm.name} onChange={(e) => setDrvForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={drvForm.phone} onChange={(e) => setDrvForm((f: any) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label={ar ? 'الجنسية' : 'Nationality'}><TextInput value={drvForm.nationality} onChange={(e) => setDrvForm((f: any) => ({ ...f, nationality: e.target.value }))} /></Field>
          <Field label={ar ? 'رقم الإقامة' : 'Iqama number'}><TextInput value={drvForm.residenceNumber} onChange={(e) => setDrvForm((f: any) => ({ ...f, residenceNumber: e.target.value }))} /></Field>
          <Field label={ar ? 'رقم بطاقة التشغيل' : 'Driver card number'}><TextInput value={drvForm.driverCardNumber} onChange={(e) => setDrvForm((f: any) => ({ ...f, driverCardNumber: e.target.value }))} /></Field>
          <Field label={ar ? 'انتهاء بطاقة التشغيل' : 'Driver card expiry'}>
            <input type="date" value={drvForm.driverCardExpiry || ''}
              onChange={(e) => setDrvForm((f: any) => ({ ...f, driverCardExpiry: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          </Field>
          <Field label={ar ? 'الكفيل' : 'Sponsor'}><TextInput value={drvForm.sponsorName} onChange={(e) => setDrvForm((f: any) => ({ ...f, sponsorName: e.target.value }))} /></Field>
          <div>
            <label className={labelCls}>{ar ? 'المورّد الذي يعمل عنده' : 'Supplier he works for'}</label>
            <SearchableSelect
              value={drvForm.supplier}
              onChange={(x) => setDrvForm((f: any) => ({ ...f, supplier: x, vehicle: '' }))}
              searchAfter={0} onSearch={setModalSupQ} loading={modalSupBusy}
              placeholder={ar ? 'غير مربوط' : 'Unlinked'}
              searchPlaceholder={ar ? 'اكتب اسم المورد…' : 'Search supplier…'}
              footer={modalSupTotal > modalSups.length
                ? (ar ? `${modalSups.length} من ${modalSupTotal} — اكتب لتضيّق` : `${modalSups.length} of ${modalSupTotal} — type to narrow`)
                : undefined}
              options={[{ value: '', label: ar ? 'غير مربوط' : 'Unlinked' },
                ...modalSups.map((sp) => ({ value: sp._id, label: sp.name }))]} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'شاحنته' : 'His truck'}</label>
            <SearchableSelect
              value={drvForm.vehicle} onChange={(x) => setDrvForm((f: any) => ({ ...f, vehicle: x }))}
              searchAfter={0} disabled={!drvForm.supplier}
              placeholder={drvForm.supplier ? (ar ? 'بدون شاحنة' : 'No truck') : (ar ? 'اختر المورّد أولًا' : 'Pick the supplier first')}
              searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
              options={[{ value: '', label: ar ? 'بدون شاحنة' : 'No truck' },
                ...drvVehicles.map((v) => ({ value: v._id, label: v.plate, hint: v.name || undefined }))]} />
          </div>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={drvForm.notes} onChange={(e) => setDrvForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>

      {/* Vehicle modal */}
      <Modal open={vehModal} onClose={() => setVehModal(false)}
        title={editingVeh ? (ar ? 'تعديل سيارة' : 'Edit vehicle') : (ar ? 'إضافة سيارة' : 'Add vehicle')}
        footer={<>
          <button type="button" onClick={() => setVehModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveVehicle} disabled={saving || !vehForm.plate.trim() || !String(vehForm.brand || '').trim() || !String(vehForm.color || '').trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'رقم اللوحة *' : 'Plate *'}><TextInput value={vehForm.plate} onChange={(e) => setVehForm((f: any) => ({ ...f, plate: e.target.value }))} /></Field>
          <Field label={ar ? 'الوصف' : 'Description'}><TextInput value={vehForm.name} onChange={(e) => setVehForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          {/* Make and colour are required. The transport order carries the vehicle data (plate, make, colour); both fields were printed empty on every sheet leaving with a driver and checked at gates, because the register never asked for them. */}
          <Field label={ar ? 'الماركة *' : 'Brand *'}>
            <TextInput value={vehForm.brand} onChange={(e) => setVehForm((f: any) => ({ ...f, brand: e.target.value }))} />
          </Field>
          <Field label={ar ? 'اللون *' : 'Color *'}>
            <TextInput value={vehForm.color} onChange={(e) => setVehForm((f: any) => ({ ...f, color: e.target.value }))} />
          </Field>
          <Field label={ar ? 'سنة الصنع' : 'Model year'}><TextInput value={vehForm.modelYear} onChange={(e) => setVehForm((f: any) => ({ ...f, modelYear: e.target.value }))} /></Field>
          <Field label={ar ? 'رقم بطاقة التشغيل' : 'Operation card no.'}><TextInput value={vehForm.operationCardNumber} onChange={(e) => setVehForm((f: any) => ({ ...f, operationCardNumber: e.target.value }))} /></Field>
          <Field label={ar ? 'انتهاء بطاقة التشغيل' : 'Operation card expiry'}>
            <input type="date" value={(vehForm.operationCardExpiry || '').slice(0, 10)}
              onChange={(e) => setVehForm((f: any) => ({ ...f, operationCardExpiry: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          </Field>
          <div className="sm:col-span-2">
            <label className={labelCls}>{ar ? 'نوع الشاحنة' : 'Truck type'}</label>
            <SearchableSelect value={vehForm.truckType} onChange={(x) => setVehForm((f: any) => ({ ...f, truckType: x }))} searchAfter={0}
              placeholder={ar ? 'اختر النوع…' : 'Choose…'} searchPlaceholder={ar ? 'اكتب للبحث…' : 'Search…'}
              options={truckTypes.map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) }))} />
          </div>
          {/* Owner is an explicit question with three answers. Leaving it empty meant both "ours" and "unknown"; now "ours" is a choice and empty stays unregistered. The list is searched on the server because suppliers number in the thousands. */}
          <div className="sm:col-span-2">
            <label className={labelCls}>{ar ? 'المالك' : 'Owner'}</label>
            <SearchableSelect
              value={vehForm.supplier || (vehForm.ownership === 'ours' ? '#ours' : '')}
              onChange={(x) => setVehForm((f: any) => (x === '#ours'
                ? { ...f, supplier: '', ownership: 'ours' }
                : { ...f, supplier: x, ownership: x ? 'supplier' : 'unknown' }))}
              searchAfter={0} onSearch={setModalSupQ} loading={modalSupBusy}
              placeholder={ar ? 'غير مسجَّل' : 'Not recorded'}
              searchPlaceholder={ar ? 'اكتب اسم المورد…' : 'Search supplier…'}
              footer={modalSupTotal > modalSups.length
                ? (ar ? `${modalSups.length} من ${modalSupTotal} — اكتب لتضيّق` : `${modalSups.length} of ${modalSupTotal} — type to narrow`)
                : undefined}
              options={[
                { value: '', label: ar ? 'غير مسجَّل' : 'Not recorded' },
                { value: '#ours', label: ar ? 'أسطولنا' : 'Our fleet' },
                ...modalSups.map((sp) => ({
                  value: sp._id, label: sp.name,
                  hint: sp.type === 'freelancer' ? (ar ? 'سائق فرد' : 'Freelancer') : (ar ? 'شركة' : 'Company'),
                })),
              ]} />
          </div>
          <Field label={ar ? 'السائق المعتاد' : 'Usual driver'}><TextInput value={vehForm.defaultDriverName} onChange={(e) => setVehForm((f: any) => ({ ...f, defaultDriverName: e.target.value }))} /></Field>
          <Field label={ar ? 'جواله' : 'Their phone'}><TextInput value={vehForm.defaultDriverPhone} onChange={(e) => setVehForm((f: any) => ({ ...f, defaultDriverPhone: e.target.value }))} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={vehForm.notes} onChange={(e) => setVehForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  );
}
