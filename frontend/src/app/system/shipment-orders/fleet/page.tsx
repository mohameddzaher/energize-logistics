'use client';
/**
 * الموردون والمركبات — the fleet register the create form reads and feeds.
 *
 * ── وثلاثةُ أحوالٍ للملكيّة لا حالان ────────────────────────────────────────
 * كان الحالان: لها مورّدٌ، أو «من أسطولنا». ثمّ استُوردت ثلاثةَ عشرَ ألفَ
 * شاحنةٍ من تاريخ الطلبات بلا مرجعِ مورّد، فقالت هذه الصفحةُ «١٠٠٠ سيارة،
 * ١٠٠٠ من أسطولنا» — وأسطولُنا ثمانٍ وخمسون شاحنة. الغيابُ «لا أعلم».
 *
 * والأعدادُ تُقرأ من الخادم لا من المصفوفةِ الواصلة: القائمةُ صفحةٌ بحدٍّ،
 * فعدُّها يعدّ الحدَّ. والبحثُ كذلك عند الخادم — طيُّ المسافاتِ والهمزةِ فيه
 * لا في المتصفّح، وإلّا بُحث في مئةٍ وصلت وقيل «لا نتائج» عن اثنيَ عشرَ ألفًا.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Building2, User as UserIcon, Plus, Pencil, Trash2, Check, Loader2, IdCard } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea,
  SearchableSelect, SmallBadge, Tabs, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { OrderSupplier, OrderVehicle, OrderDriver, FormField, optionLabel, canEditOrders, canAdminOrders, Lang } from '@/lib/shipmentOrders';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { ContactButtons } from '@/components/crm/CrmKit';
import ScrollX from '@/components/system/ScrollX';

const EMPTY_SUPPLIER = { name: '', type: 'company' as 'company' | 'freelancer', phone: '', email: '', notes: '' };
const EMPTY_VEHICLE = { plate: '', name: '', truckType: '', supplier: '', ownership: 'unknown', defaultDriverName: '', defaultDriverPhone: '', notes: '' };

const PAGE = 200;
type Owner = '' | 'not_ours' | 'supplier' | 'ours' | 'unknown';

export default function FleetPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user);

  const [suppliers, setSuppliers] = useState<OrderSupplier[]>([]);
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  // ── والسوّاق سجلٌّ ثالث ─────────────────────────────────────────────────
  // كان السائقُ اسمًا على صفّ الشاحنة: فلا يُسأل عن رقم إقامته ولا عن بطاقة
  // تشغيله ولا متى تنتهي، ولا «أرِني سوّاق هذا المورّد». وهو السجلُّ الذي
  // تحمل به المنصّةُ ربطَ الشاحنة بمالكها، فبه عُرف مالكُ أحدَ عشرَ ألفًا.
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('vehicles');
  const [search, setSearch] = useState('');
  // ── وأسطولُنا لا يُعرَض إلّا إن طُلب ───────────────────────────────────
  // هذا سجلُّ الناقلين: حمولاتُ هذا القسم تُسنَد إليهم، وأسطولُنا الثمانِ
  // والخمسون يُدار في «إدارة الأسطول». فالصفحةُ تُفتَح على ما يخصُّها، وشارةُ
  // «أسطولنا» تُظهره لمن أراد أن يتحقّق — ولا يُحذَف صفٌّ من السجلّ.
  const [owner, setOwner] = useState<Owner>('not_ours');
  const [sum, setSum] = useState({ vehicles: 0, suppliers: 0, drivers: 0, supplier: 0, ours: 0, unknown: 0 });
  const [shownTotals, setShownTotals] = useState({ vehicles: 0, suppliers: 0, drivers: 0 });

  const [supModal, setSupModal] = useState(false);
  const [editingSup, setEditingSup] = useState<OrderSupplier | null>(null);
  const [supForm, setSupForm] = useState<any>(EMPTY_SUPPLIER);

  const [vehModal, setVehModal] = useState(false);
  const [editingVeh, setEditingVeh] = useState<OrderVehicle | null>(null);
  const [vehForm, setVehForm] = useState<any>(EMPTY_VEHICLE);
  const [saving, setSaving] = useState(false);
  // قائمةُ المالك في النموذج مستقلّةٌ عن قائمة التبويب: تلك تتبع بحثَ الصفحة،
  // وهذه بحثَ الخانة — وخلطُهما يجعل الكتابةَ في النموذج تُعيد بناء الجدول.
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
  // شاحناتُ المورّد المختار وحدَها: سائقٌ يُربَط بشاحنةٍ ليست لمورّده خطأٌ
  // يُكتب مرّةً ويُقرأ طويلًا.
  const [drvVehicles, setDrvVehicles] = useState<OrderVehicle[]>([]);

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
      const [sp, v, dr, sm] = await Promise.all([
        api.get<{ suppliers: OrderSupplier[]; total: number }>(`/api/shipment-orders/suppliers?limit=${PAGE}${q}`),
        api.get<{ vehicles: OrderVehicle[]; total: number }>(`/api/shipment-orders/vehicles?limit=${PAGE}${q}${owner ? `&ownership=${owner}` : ''}`),
        api.get<{ drivers: OrderDriver[]; total: number }>(`/api/shipment-orders/drivers?limit=${PAGE}${q}`),
        api.get<typeof sum>('/api/shipment-orders/fleet-summary'),
      ]);
      if (!guard.isCurrent(mine)) return;
      setSuppliers(sp.suppliers || []);
      setVehicles(v.vehicles || []);
      setDrivers(dr.drivers || []);
      setShownTotals({ vehicles: v.total || 0, suppliers: sp.total || 0, drivers: dr.total || 0 });
      setSum(sm);
      setError('');
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || 'Request failed'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [search, owner, guard]);
  // البحثُ مؤجَّلٌ بعد سكونِ الكتابة — لا طلبٌ لكلّ حرف.
  useEffect(() => {
    const t = setTimeout(() => load(), search.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));
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
  // ملكيّةُ الصفّ في كلمة — والمجهولُ يُقال مجهولًا.
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
    // مورّدُه وشاحنتُه يُبذران في قائمتيهما: كلٌّ منهما صفحةٌ من سجلٍّ كبير.
    if (sup) setModalSups((p) => (p.some((x) => x._id === sup._id) ? p : [sup, ...p]));
    setDrvVehicles(veh ? [veh] : []);
    setModalSupQ('');
    setDrvModal(true);
  };

  // شاحناتُ المورّد تُطلَب بمعرّفه لا تُصفَّى من صفحةٍ محمَّلة.
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

  // الخادمُ صفّى بالبحث والملكيّة — وتصفيةُ الواصل ثانيًا تحجب ما وجده.
  const shownVehicles = vehicles;
  const shownSuppliers = suppliers;

  const vehicleCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 16 },
    { header: ar ? 'الوصف' : 'Description', key: 'name', width: 26, transform: (v) => v || '—' },
    { header: ar ? 'النوع' : 'Type', key: 'truckType', width: 18, transform: (v) => v || '—' },
    // خلوُّ الخانة يُقرأ نقصًا في البيانات، فالملكيّةُ تُكتب كلمةً.
    { header: ar ? 'المالك' : 'Owner', key: 'supplier', width: 26, transform: (_v, r) => ownerLabel(r) },
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
    { header: ar ? 'عدد السائقين' : 'Drivers', key: 'driverCount', width: 12, transform: (v) => Number(v || 0) },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];

  const driverCols: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', width: 28 },
    { header: ar ? 'الجوال' : 'Phone', key: 'phone', width: 16 },
    { header: ar ? 'الجنسية' : 'Nationality', key: 'nationality', width: 16 },
    { header: ar ? 'رقم الإقامة' : 'Iqama', key: 'residenceNumber', width: 16 },
    { header: ar ? 'بطاقة التشغيل' : 'Driver card', key: 'driverCardNumber', width: 16 },
    { header: ar ? 'انتهاء البطاقة' : 'Card expiry', key: 'driverCardExpiry', width: 14 },
    { header: ar ? 'المورّد' : 'Supplier', key: 'supplier', width: 28, transform: (v: any) => v?.name || '' },
    { header: ar ? 'الشاحنة' : 'Truck', key: 'vehicle', width: 16, transform: (v: any) => v?.plate || '' },
    { header: ar ? 'الكفيل' : 'Sponsor', key: 'sponsorName', width: 22 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 26 },
  ];

  // انتهاءُ بطاقة التشغيل يُلوَّن: سائقٌ بطاقتُه منتهيةٌ يُوقفه الطريقُ لا نحن،
  // ومعرفةُ التاريخ قبل الإسناد توفّر حمولةً متعطّلةً على الطريق.
  const cardState = (d: OrderDriver) => {
    const x = (d.driverCardExpiry || '').slice(0, 10);
    if (!x) return { cls: 'text-slate-300', label: '—' };
    const days = Math.round((new Date(`${x}T00:00:00`).getTime() - Date.now()) / 86400000);
    if (days < 0) return { cls: 'bg-red-500/15 text-red-700', label: ar ? `منتهية (${x})` : `Expired (${x})` };
    if (days <= 30) return { cls: 'bg-amber-500/15 text-amber-700', label: ar ? `تنتهي بعد ${days} يوم` : `${days} days left` };
    return { cls: 'bg-emerald-500/15 text-emerald-700', label: x };
  };

  if (loading) return <Spinner />;

  const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={ar ? 'الموردون والمركبات' : 'Suppliers & vehicles'}
        subtitle={ar
          ? `${sum.suppliers} مورّدًا · ${sum.vehicles} شاحنة (${sum.supplier} مالكُها مسجَّل · ${sum.unknown} غير مسجَّل · ${sum.ours} من أسطولنا) · ${sum.drivers} سائقًا`
          : `${sum.suppliers} suppliers · ${sum.vehicles} trucks (${sum.supplier} owner recorded · ${sum.unknown} not recorded · ${sum.ours} ours) · ${sum.drivers} drivers`}>
        {/* التبويبان يعرضان سجلّين مختلفين والبحث يصفّي المعروض منهما، فالخيار
            الأوّل يطابق الشاشة والثاني يخرج السجلّين كاملين في شيتين. */}
        <ExportMenu
          fileName="shipment-orders-fleet" lang={ar ? 'ar' : 'en'}
          options={[
            tab === 'vehicles'
              ? { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'المركبات' : 'Vehicles', rows: shownVehicles as any[], columns: vehicleCols }] }
              : tab === 'drivers'
                ? { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'السائقون' : 'Drivers', rows: drivers as any[], columns: driverCols }] }
                : { key: 'tab', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'الموردون' : 'Suppliers', rows: shownSuppliers as any[], columns: supplierCols }] },
            {
              // ── والتصديرُ الكامل يُجلَب عند طلبه ─────────────────────────
              // الصفحةُ تعرض مئتين من ثلاثةَ عشرَ ألفًا، فتصديرُ المصفوفةِ
              // الواصلة تحت عنوان «الكل» يسلّم مئتين ويُقال إنّها السجلّ.
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
        { key: 'vehicles', label: ar ? 'المركبات' : 'Vehicles', badge: sum.vehicles },
        { key: 'suppliers', label: ar ? 'الموردون' : 'Suppliers', badge: sum.suppliers },
        { key: 'drivers', label: ar ? 'السائقون' : 'Drivers', badge: sum.drivers },
      ]} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:max-w-md">
          <SearchInput value={search} onChange={setSearch}
            placeholder={tab === 'vehicles'
              ? (ar ? 'باللوحة أو السائق أو بطاقة التشغيل…' : 'Plate, driver or operation card…')
              : tab === 'drivers'
                ? (ar ? 'بالاسم أو الجوّال أو رقم الإقامة أو بطاقة التشغيل…' : 'Name, phone, iqama or driver card…')
                : (ar ? 'بالاسم أو الجوّال أو السجل أو الآيبان…' : 'Name, phone, CR or IBAN…')} />
        </div>
        {/* ── ومصفاةُ الملكيّة: «أرِني ما لا أعرف مالكَه» سؤالٌ يُسأل ───────
            خمسةُ آلافٍ وسبعُمئةِ شاحنةٍ لم يُعرَف مالكُها من تاريخ الطلبات،
            وهي عملٌ ينتظر — ولا تُرى إن لم تُطلَب. */}
        {tab === 'vehicles' && (
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
      {/* ما يُعرَض من الـمُطابِق: الصفحةُ حدُّها مئتان، والصمتُ عن الباقي يخفيه. */}
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
                  <td className="px-4 py-3 text-slate-900 font-bold font-mono">{v.plate}</td>
                  <td className="px-4 py-3 text-slate-700">{v.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{v.truckType || '—'}</td>
                  <td className="px-4 py-3">
                    {v.supplier
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={supplierName(v)} />
                      : v.ownership === 'ours'
                        ? <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={ar ? 'أسطولنا' : 'Our fleet'} />
                        : <SmallBadge bg="bg-slate-400/20" text="text-slate-600" label={ar ? 'غير مسجَّل' : 'Not recorded'} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{[v.defaultDriverName, v.defaultDriverPhone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editor && <button type="button" onClick={() => {
                        setEditingVeh(v);
                        setVehForm({ ...EMPTY_VEHICLE, ...v, ownership: v.ownership || 'unknown', supplier: typeof v.supplier === 'object' ? v.supplier?._id || '' : (v.supplier || '') });
                        // مورّدُ الصفّ يُبذَر في القائمة: هي صفحةٌ من ثلاثة آلاف.
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

      {/* ── والمورّدون جدولٌ لا بطاقات ────────────────────────────────────────
          كانا سجلَّين في صفحةٍ واحدة، أحدُهما جدولٌ والآخرُ بطاقتان في الصفّ:
          فيُقرأ الأوّلُ بالعين نزولًا ويُقرأ الثاني بالقفز بين المربّعات، ولا
          يُفرَز ولا يُقارَن. والسجلُّ يُقرأ صفًّا صفًّا. */}
      {tab === 'suppliers' && (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{ar ? 'المورّد' : 'Supplier'}</th>
              <th className={th}>{ar ? 'النوع' : 'Type'}</th>
              <th className={th}>{ar ? 'الجوال' : 'Phone'}</th>
              <th className={th}>{ar ? 'البريد' : 'Email'}</th>
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
                      <span className="font-bold text-slate-900 truncate">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.type === 'freelancer'
                      ? <SmallBadge bg="bg-violet-500/15" text="text-violet-700" label={ar ? 'فريلانسر' : 'Freelancer'} />
                      : <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={ar ? 'شركة' : 'Company'} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {(s.phone || '').trim()
                      ? <div className="flex items-center gap-2"><span className="font-mono text-[13px]">{s.phone}</span><ContactButtons phone={s.phone} size={15} /></div>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate" title={s.email || ''}>{s.email || '—'}</td>
                  {/* عددُ سياراته: من له سيّارةٌ واحدةٌ ليس كمن له عشرون، والفرقُ
                      يُقرأ من الرقم قبل أن يُفتَح أيُّ ملفّ. */}
                  <td className="px-4 py-3 tabular-nums text-slate-700">{s.vehicleCount || 0}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{s.driverCount || 0}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate" title={s.notes || ''}>{s.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editor && <button type="button" onClick={() => { setEditingSup(s); setSupForm({ ...EMPTY_SUPPLIER, ...s }); setSupModal(true); }} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
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

      {/* ── جدولُ السوّاق ───────────────────────────────────────────────────
          الملفُّ هو ما يُسأل عنه عند الإسناد: رقمُ الإقامة، وبطاقةُ التشغيل
          ومتى تنتهي، ومَن كفيلُه، وعلى أيّ شاحنةٍ هو ولأيّ مورّد. */}
      {tab === 'drivers' && (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{ar ? 'السائق' : 'Driver'}</th>
              <th className={th}>{ar ? 'الجوال' : 'Phone'}</th>
              <th className={th}>{ar ? 'الجنسية' : 'Nationality'}</th>
              <th className={th}>{ar ? 'رقم الإقامة' : 'Iqama'}</th>
              <th className={th}>{ar ? 'بطاقة التشغيل' : 'Driver card'}</th>
              <th className={th}>{ar ? 'انتهاؤها' : 'Expires'}</th>
              <th className={th}>{ar ? 'المورّد' : 'Supplier'}</th>
              <th className={th}>{ar ? 'شاحنته' : 'His truck'}</th>
              <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr></thead>
            <tbody>
              {drivers.map((d) => {
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
                    <td className="px-4 py-3 font-mono text-slate-700">{veh?.plate || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {editor && <button type="button" onClick={() => openDriver(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                        {canAdminOrders(user) && <button type="button" onClick={() => removeDriver(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {drivers.length === 0 && <tr><td colSpan={9} className="text-center text-slate-500 py-12">
                {search.trim()
                  ? (ar ? 'لا سائقَ يطابق البحث — جرّب رقم الإقامة.' : 'No driver matches — try the iqama number.')
                  : (ar ? 'لا سائقين بعد.' : 'No drivers yet.')}
              </td></tr>}
            </tbody>
          </table>
        </ScrollX>
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

      {/* ── نموذجُ السائق ───────────────────────────────────────────────────
          المورّدُ قبل الشاحنة: الشاحنةُ تُختار من شاحنات مورّده وحدَها، فلا
          يُربَط رجلٌ بشاحنةٍ ليست لمن يعمل عنده. */}
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
          {/* ── والمالكُ سؤالٌ صريحٌ بثلاثة أجوبة ────────────────────────────
              كان «اتركه فارغًا إن كانت من أسطولنا»، والفراغُ جوابان في واحد:
              «هي لنا» و«لا أعرف». فصار الأوّلُ خيارًا يُختار، والفراغُ يبقى
              «غير مسجَّل» — والقائمةُ تُبحَث عند الخادم لأنّ الموردين آلاف. */}
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
                  hint: sp.type === 'freelancer' ? (ar ? 'فريلانسر' : 'Freelancer') : (ar ? 'شركة' : 'Company'),
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
