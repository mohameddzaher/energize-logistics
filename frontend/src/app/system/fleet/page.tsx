'use client';
// الحمولات — the fleet section's main list. Inline status, follow-up recency at
// a glance, filter by supervisor, and بوليصة downloads: one per row, or tick
// several and download them all as a ZIP named
// «بوليصة-<الرقم>-<العميل>-<التاريخ>».
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ContactButtons } from '@/components/crm/CrmKit';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Plus, Pencil, Trash2, FileDown, Loader2, PhoneCall } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, StatCard, Select, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, periodFromParams, type Period } from '@/components/fleet/PeriodFilter';
import { useFleetLookups } from '@/hooks/useFleetLookups';
import {
  FleetShipment, FleetCustomer, FLEET_STATUSES, fleetStatus, fleetStatusLabel,
  fmtDT, fmtD, hoursSince, canEditFleet, canAdminFleet, shipmentVehicleId, Lang,
} from '@/lib/fleet';
import type { DispatchSheetRow } from '@/lib/dispatchSheetExcelParser';

// One shipment → one بوليصة sheet row. Untracked sheet fields stay blank.
const toSheetRow = (s: FleetShipment): DispatchSheetRow => ({
  rowIndex: 1,
  rentalType: s.rentType || '',
  carBrand: s.vehicleBrand || '',
  carColor: s.vehicleColor || '',
  carType: s.trailerType || '',
  plateNumber: s.vehiclePlate || '',
  driverAdvance: s.driverAdvance || '',
  driverPhone: s.driverPhone || '',
  driverIqama: s.driverIqama || '',
  driverNationality: s.driverNationality || '',
  driverName: [s.driverName, s.secondDriverName].filter(Boolean).join(' + '),
  customerName: s.customerName || '',
  branch: s.branch || '',
  toLocation: s.toCity || '',
  fromLocation: s.fromCity || '',
  date: fmtD(s.loadDate || s.createdAt),
  dispatchNumber: String(s.waybillNumber || ''),
  missingRequired: [],
});

// أعمدة تصدير الحمولات — معرَّفة مرة واحدة لأن الصفحة تصدّر مرّتين: الصفحة
// المعروضة، وكل ما يطابق الفلتر مجلوبًا من الخادم. تعريفان يفترقان يومًا ما.
const SHIPMENT_COLUMNS = [
  { header: 'Waybill', key: 'waybillNumber', width: 10 },
  { header: 'Customer', key: 'customerName', width: 26 },
  { header: 'From', key: 'fromCity', width: 14 },
  { header: 'To', key: 'toCity', width: 14 },
  { header: 'Plate', key: 'vehiclePlate', width: 14 },
  { header: 'Driver', key: 'driverName', width: 18 },
  { header: 'Second driver', key: 'secondDriverName', width: 18 },
  { header: 'Supervisor', key: 'supervisorName', width: 18 },
  { header: 'Customer type', key: 'customerType', transform: (v: any) => (v === 'heavy' ? 'Heavy' : v === 'branch' ? 'Branch' : ''), width: 14 },
  { header: 'Load type', key: 'loadType', width: 16 },
  { header: 'Vehicle rent', key: 'price', width: 14 },
  { header: 'Full rent', key: 'fullRent', width: 14 },
  { header: 'Driver expense', key: 'driverExpense', width: 14 },
  { header: 'Payment', key: 'paymentType', width: 12 },
  { header: 'Load date', key: 'loadDate', transform: (v: any) => fmtD(v), width: 14 },
  { header: 'Status', key: 'status', transform: (v: any) => fleetStatusLabel(v, 'en'), width: 14 },
];

// بوليصة-100001-اسم العميل-22-7-2026
const waybillFileName = (s: FleetShipment) => {
  const d = new Date(s.loadDate || s.createdAt || Date.now());
  return `بوليصة-${s.waybillNumber}-${s.customerName || 'عميل'}-${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
};

function FleetShipmentsInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const lkp = useFleetLookups(ar);
  const router = useRouter();
  const sp = useSearchParams();
  const { confirm, notify } = useDialog();
  const editor = canEditFleet(user);

  const [shipments, setShipments] = useState<FleetShipment[]>([]);
  const [customers, setCustomers] = useState<FleetCustomer[]>([]);
  const [supervisors, setSupervisors] = useState<string[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; byDestination?: { city: string; n: number }[] } | null>(null);
  const [resolvedPeriod, setPeriodResolved] = useState<{ from: string; to: string; preset?: string } | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // كل فلاتر القائمة تعيش في عنوان الصفحة: يفتح المستخدم حمولةً ثم يرجع بزرّ
  // المتصفّح فيجد قائمته كما تركها، ويُرسِل الرابط لغيره فيرى ما يراه بالضبط.
  const [search, setSearch] = useState(() => sp?.get('q') || '');
  const [debounced, setDebounced] = useState(search);
  const [statusFilter, setStatusFilter] = useState(() => sp?.get('status') || '');
  const [cityFilter, setCityFilter] = useState(() => sp?.get('toCity') || '');
  const [customerFilter, setCustomerFilter] = useState(() => sp?.get('customer') || '');
  const [supervisorFilter, setSupervisorFilter] = useState(() => sp?.get('supervisor') || '');
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // The checklist: tick rows → download their بوليصات together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // الفلاتر بلا صفحة — تُستعمل للجلب وللعنوان وللتصدير الشامل معًا.
  const filterParams = useMemo(() => {
    const p: Record<string, string> = { ...periodParams(period) };
    if (debounced.trim()) p.q = debounced.trim();
    if (statusFilter) p.status = statusFilter;
    if (cityFilter) p.toCity = cityFilter;
    if (customerFilter) p.customer = customerFilter;
    if (supervisorFilter) p.supervisor = supervisorFilter;
    return p;
  }, [debounced, statusFilter, cityFilter, customerFilter, supervisorFilter, period]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ ...filterParams, page: String(page), limit: '25' });
      const d = await api.get<{ shipments: FleetShipment[]; total: number; stats: any; period: any }>(`/api/fleet/shipments?${qs}`);
      setShipments(d.shipments || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
      setPeriodResolved(d.period || null);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [filterParams, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const qs = new URLSearchParams(filterParams).toString();
    router.replace(`/system/fleet${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [filterParams, router]);
  // أيّ تغيير في الفلاتر يعيد الترقيم إلى أوّله، وإلا بقي المستخدم على صفحةٍ
  // رقمها أكبر من نتائج الفلتر الجديد فتظهر القائمة فارغةً بلا سبب ظاهر.
  useEffect(() => { setPage(1); }, [filterParams]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ customers: FleetCustomer[] }>('/api/fleet/customers')
      .then((d) => setCustomers(d.customers || [])).catch(() => {});
    // Supervisor filter options come from the data itself — whoever has
    // actually created shipments.
    api.get<{ shipments: FleetShipment[] }>('/api/fleet/shipments?limit=500')
      .then((d) => {
        const pairs = new Map<string, string>();
        (d.shipments || []).forEach((s) => { if (s.supervisor && s.supervisorName) pairs.set(String(s.supervisor), s.supervisorName); });
        setSupervisors(Array.from(pairs, ([id, name]) => `${id}|${name}`));
      }).catch(() => {});
  }, []);

  const changeStatus = async (s: FleetShipment, status: string) => {
    setBusyId(s._id);
    try { await api.patch(`/api/fleet/shipments/${s._id}/status`, { status }); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setBusyId(null);
  };

  const remove = async (s: FleetShipment) => {
    if (!(await confirm(ar
      ? `حذف الشحنة بوليصة رقم ${s.waybillNumber} (${s.customerName || '—'})؟`
      : `Delete shipment, waybill ${s.waybillNumber}?`))) return;
    try { await api.delete(`/api/fleet/shipments/${s._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const downloadOne = async (s: FleetShipment) => {
    setDownloadingId(s._id);
    try {
      // نفس ملف الموبايل بالضبط: الخادم يولّد البوليصة على الترويسة بالختم.
      const blob = await api.getBlob(`/api/fleet/shipments/${s._id}/waybill.pdf?lang=${ar ? 'ar' : 'en'}`);
      const gen = await import('@/lib/dispatchSheetGenerator');
      gen.triggerDownload(blob, `${waybillFileName(s)}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  // Ticked rows → one ZIP, each file named بوليصة-رقم-عميل-تاريخ.
  const downloadPicked = async () => {
    const rows = shipments.filter((s) => picked.has(s._id));
    if (!rows.length) return;
    setBulkBusy(true);
    try {
      const gen = await import('@/lib/dispatchSheetGenerator');
      const nameOf = new Map(rows.map((s) => [String(s.waybillNumber), waybillFileName(s)]));
      const { blob, fileName } = await gen.generateDispatchSheetsZip({
        rows: rows.map(toSheetRow),
        fileNameOf: (r) => nameOf.get(r.dispatchNumber) || `بوليصة-${r.dispatchNumber}`,
        onProgress: (p) => setBulkProgress(`${p.current}/${p.total}`),
      });
      gen.triggerDownload(blob, fileName.replace('كشوف-التخريج', 'بوليصات-الشحن'));
      setPicked(new Set());
    } catch (e: any) { notify(e?.message || 'ZIP failed', 'error'); }
    setBulkBusy(false);
    setBulkProgress('');
  };

  const togglePick = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <Spinner />;

  const inFlight = ['loading', 'uploaded', 'on_way'].reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);
  const arrived = ['arrived', 'bond_sent', 'bond_received', 'invoiced'].reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Truck className="w-5 h-5" />}
        title={ar ? 'حمولات الأسطول' : 'Fleet shipments'}
        subtitle={ar ? 'سياراتنا فقط — الحجز والمتابعة والبوليصات' : 'Our own trucks — booking, follow-ups and waybills'}
      >
        {picked.size > 0 && (
          <button type="button" onClick={downloadPicked} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {bulkBusy
              ? (ar ? `جارٍ التجهيز ${bulkProgress}…` : `Generating ${bulkProgress}…`)
              : (ar ? `تحميل ${picked.size} بوليصة` : `Download ${picked.size} waybills`)}
          </button>
        )}
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-shipments"
          options={[
            { key: 'page', label: ar ? 'الصفحة المعروضة' : 'This page', sheets: [{ name: 'Shipments', rows: shipments as any[], columns: SHIPMENT_COLUMNS }] },
            {
              key: 'filtered',
              label: ar ? 'كل الحمولات حسب الفلتر الحالي' : 'Everything under the current filter',
              hint: String(total),
              // القائمة مرقّمة، فالتصدير «الشامل» يجب أن يُجلَب من الخادم لا أن
              // يُبنى من الصفحة المعروضة — وإلا صدّر ٢٥ صفًّا باسم «الكل».
              resolve: async () => {
                const qs = new URLSearchParams({ ...filterParams, page: '1', limit: '2000' });
                const d = await api.get<{ shipments: FleetShipment[] }>(`/api/fleet/shipments?${qs}`);
                return [{ name: 'Shipments', rows: (d.shipments || []) as any[], columns: SHIPMENT_COLUMNS }];
              },
            },
          ]} />
        {editor && (
          <PrimaryButton onClick={() => router.push('/system/fleet/new')}>
            <Plus className="w-4 h-4" /> {ar ? 'إنشاء حمولة' : 'Create shipment'}
          </PrimaryButton>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'إجمالي الحمولات' : 'Total shipments'} value={total} accent="text-[#f37121]" />
        <StatCard label={ar ? 'قيد التنفيذ' : 'In flight'} value={inFlight} accent="text-blue-600" />
        <StatCard label={ar ? 'وصلت / مكتملة' : 'Arrived / done'} value={arrived} accent="text-emerald-600" />
        <StatCard label={ar ? 'ملغاة' : 'Cancelled'} value={stats?.byStatus.cancelled || 0} accent="text-red-600" />
      </div>

      {/* الوجهات الحالية — "عدد السيارات المتّجهة إلى جدة" دون بحث. الضغط يرشح القائمة. */}
      {(stats?.byDestination?.length || 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">{ar ? 'الوجهات الآن:' : 'Destinations now:'}</span>
          {stats!.byDestination!.map((d) => (
            <button key={d.city} type="button" onClick={() => { setCityFilter(cityFilter === d.city ? '' : d.city); setPage(1); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${cityFilter === d.city ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]'}`}>
              {d.city} <b className="tabular-nums">{d.n}</b>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px] basis-72">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث برقم البوليصة أو العميل أو السائق أو اللوحة…' : 'Search waybill, customer, driver, plate…'} />
        </div>
        <div className="w-40 grow sm:grow-0">
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {FLEET_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
          </Select>
        </div>
        <div className="w-48 grow sm:grow-0">
          <Select value={supervisorFilter} onChange={(e) => { setSupervisorFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل المشرفين' : 'All supervisors'}</option>
            {supervisors.map((pair) => {
              const [id, name] = pair.split('|');
              return <option key={id} value={id}>{name}</option>;
            })}
          </Select>
        </div>
        <div className="w-52 grow sm:grow-0">
          <Select value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل العملاء' : 'All customers'}</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        </div>
      </div>

      {/* الفترة: نفس العنصر ونفس المعاني المستعملة في تحليل الحمولات وتحليل
          السيارة — «هذا الشهر» هنا هو «هذا الشهر» هناك حرفيًّا. */}
      <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
      <PeriodBanner period={resolvedPeriod} lang={ar ? 'ar' : 'en'} count={total} />

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="px-3 py-3">
              <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                checked={picked.size > 0 && shipments.every((s) => picked.has(s._id))}
                onChange={(e) => setPicked(e.target.checked ? new Set(shipments.map((s) => s._id)) : new Set())}
                aria-label={ar ? 'تحديد الكل' : 'Select all'} />
            </th>
            {[
              ar ? 'رقم البوليصة' : 'Waybill',
              ar ? 'العميل' : 'Customer',
              // «من» و«إلى» عمودان: السهمُ في العربيّة يشير يسارًا والنصُّ يجري
              // يمينًا فيُقرأ عكسَه، وعمودان يُفرَزان ويُفلتَران ويُصدَّران.
              ar ? 'من' : 'From',
              ar ? 'إلى' : 'To',
              ar ? 'اللوحة' : 'Plate',
              ar ? 'السائقون' : 'Drivers',
              ar ? 'إيجار السيارة' : 'Vehicle rent',
              ar ? 'نوع العميل' : 'Cust. type',
              ar ? 'نوع الحمولة' : 'Load type',
              ar ? 'تاريخ التحميل' : 'Load date',
              ar ? 'آخر تواصل' : 'Last contact',
              ar ? 'المشرف' : 'Supervisor',
              ar ? 'الحالة' : 'Status',
              ar ? 'إجراءات' : 'Actions',
            ].map((h, i) => <th key={i} className="text-start font-semibold px-3 py-3 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {shipments.length === 0 ? (
              <tr><td colSpan={12} className="text-center text-slate-500 py-14">
                {ar ? 'لا توجد حمولات بعد — ابدأ من زر «إنشاء حمولة».' : 'No shipments yet.'}
              </td></tr>
            ) : shipments.map((s) => {
              const st = fleetStatus(s.status);
              const hrs = hoursSince(s.lastContactAt);
              const contactStale = ['loading', 'uploaded', 'on_way'].includes(s.status) && (hrs === null || hrs >= 3);
              return (
                <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/system/fleet/${s._id}`)}>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                      checked={picked.has(s._id)} onChange={() => togglePick(s._id)}
                      aria-label={String(s.waybillNumber)} />
                  </td>
                  <td className="px-3 py-3 text-slate-900 font-bold font-mono">{s.waybillNumber}</td>
                  <td className="px-3 py-3 text-slate-900 font-medium max-w-[200px] truncate" title={s.customerName}>{s.customerName || '—'}</td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{s.fromCity || '—'}</td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{s.toCity || '—'}</td>
                  <td className="px-3 py-3 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                    {shipmentVehicleId(s)
                      ? <Link href={`/system/fleet/vehicles/${shipmentVehicleId(s)}`} className="font-semibold text-[#f37121] hover:underline">{s.vehiclePlate || '—'}</Link>
                      : <span className="text-slate-700">{s.vehiclePlate || '—'}</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-700 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="max-w-[150px] truncate">{[s.driverName, s.secondDriverName].filter(Boolean).join(' + ') || '—'}</span>
                      {(s.driverPhone || '').trim() && <ContactButtons phone={s.driverPhone} size={13} />}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap">
                    <span className="font-semibold text-emerald-700">{s.price ? Number(s.price).toLocaleString('en-US') : '—'}</span>
                    {s.fullRent ? <span className="text-slate-400"> / {Number(s.fullRent).toLocaleString('en-US')}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap">
                    {s.customerType === 'heavy'
                      ? <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[11px] font-semibold">{ar ? 'نقل ثقيل' : 'Heavy'}</span>
                      : s.customerType === 'branch'
                        ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold">{ar ? 'فروع' : 'Branch'}</span>
                        : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-600 text-xs whitespace-nowrap">{lkp('fleet_load_type', s.loadType) || '—'}</td>
                  <td className="px-3 py-3 text-slate-700 text-xs whitespace-nowrap">{fmtD(s.loadDate)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {/* The follow-up cadence, visible per row: red once 3h pass. */}
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${contactStale ? 'text-red-600' : 'text-slate-600'}`}>
                      <PhoneCall className="w-3 h-3" />
                      {hrs === null ? (ar ? 'لم يُتواصل' : 'Never') : (ar ? `منذ ${hrs} س` : `${hrs}h ago`)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700 text-xs max-w-[140px] truncate">{s.supervisorName || '—'}</td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {editor ? (
                      <select value={s.status} disabled={busyId === s._id}
                        onChange={(e) => changeStatus(s, e.target.value)}
                        className={`text-xs font-medium rounded-full px-2 py-1.5 border-0 cursor-pointer focus:outline-none ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}>
                        {FLEET_STATUSES.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
                      </select>
                    ) : (
                      <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${st?.bg} ${st?.text}`}>{fleetStatusLabel(s.status, lang as Lang)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => downloadOne(s)} disabled={downloadingId === s._id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 disabled:opacity-50"
                        title={ar ? 'تحميل البوليصة' : 'Download waybill'}>
                        {downloadingId === s._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      </button>
                      {editor && (
                        <button type="button" onClick={() => router.push(`/system/fleet/new?id=${s._id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canAdminFleet(user) && (
                        <button type="button" onClick={() => remove(s)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'السابق' : 'Prev'}</button>
          <span className="text-slate-500">{page} / {Math.ceil(total / 25)}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(Math.ceil(total / 25), p + 1))} disabled={page >= Math.ceil(total / 25)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'التالي' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

export default function FleetShipmentsPage() {
  return <Suspense fallback={<Spinner />}><FleetShipmentsInner /></Suspense>;
}
