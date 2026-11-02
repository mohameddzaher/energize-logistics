'use client';
// Loads: the fleet section's main list. Inline status, follow-up recency at a glance, filter by supervisor, and waybill output: one per row (download or print), or tick several, across searches and pages, and download or print them together in one server-rendered file.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ContactButtons } from '@/components/crm/CrmKit';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Ban, Check, Truck, Plus, Pencil, Trash2, FileDown, Loader2, PhoneCall, Printer, X, CheckSquare } from 'lucide-react';
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
import ScrollX from '@/components/system/ScrollX';
import { printPdfBlob } from '@/utils/printPdfBlob';

const PAYMENT_SUBTYPE_EN: Record<string, string> = { deferred_cash: 'Deferred – cash', deferred_invoice: 'Deferred – invoice', cash_3pl: 'Cash – 3PL', cash_ht: 'Cash – HT' };
const PAYMENT_SUBTYPE_AR: Record<string, string> = { deferred_cash: 'آجل - كاش', deferred_invoice: 'آجل - فاتورة', cash_3pl: 'نقدي - 3PL', cash_ht: 'نقدي - HT' };

// One shipment is one waybill sheet row. Untracked sheet fields stay blank.
const toSheetRow = (s: FleetShipment): DispatchSheetRow => ({
  rowIndex: 1,
  rentalType: PAYMENT_SUBTYPE_AR[(s as any).paymentSubtype] || s.rentType || '',
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

// Loads export columns: defined once because the page exports twice (the displayed page, and everything matching the filter fetched from the server); two definitions would eventually diverge.
const SHIPMENT_COLUMNS = [
  { header: 'Transport order', key: 'waybillNumber', width: 10 },
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
  { header: 'Payment', key: 'paymentSubtype', transform: (v: any, r: any) => PAYMENT_SUBTYPE_EN[v] || r?.paymentType || '', width: 14 },
  { header: 'Load date', key: 'loadDate', transform: (v: any) => fmtD(v), width: 14 },
  { header: 'Status', key: 'status', transform: (v: any) => fleetStatusLabel(v, 'en'), width: 14 },
];

// Waybill file name pattern: waybill, number, customer name, date
const waybillFileName = (s: FleetShipment) => {
  const d = new Date(s.loadDate || s.createdAt || Date.now());
  return `أمر نقل-${s.waybillNumber}-${s.customerName || 'عميل'}-${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
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

  // All list filters live in the page URL: the user opens a load, returns with the browser back button and finds the list as left, and a shared link shows exactly what the sender sees.
  const [search, setSearch] = useState(() => sp?.get('q') || '');
  const [debounced, setDebounced] = useState(search);
  const [statusFilter, setStatusFilter] = useState(() => sp?.get('status') || '');
  const [cityFilter, setCityFilter] = useState(() => sp?.get('toCity') || '');
  const [customerFilter, setCustomerFilter] = useState(() => sp?.get('customer') || '');
  const [supervisorFilter, setSupervisorFilter] = useState(() => sp?.get('supervisor') || '');
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  const [page, setPage] = useState(1);
  const [excludeCancelled, setExcludeCancelled] = useState<boolean>(() => {
    try { return localStorage.getItem('fleet:excludeCancelled') === '1'; } catch { return false; }
  });
  const toggleExcludeCancelled = () => {
    const next = !excludeCancelled;
    try { localStorage.setItem('fleet:excludeCancelled', next ? '1' : '0'); } catch { /* */ }
    setExcludeCancelled(next);
    setPage(1);
  };

  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /**
   * Selection is a map, not a set of ids. It used to be a `Set<string>` and download read rows from `shipments`, i.e. the displayed page only. Ticking twenty waybills then searching for a twenty-first kept the ticks in memory but produced a file with two waybills: the rows remaining on screen after the search.
   * The map holds the row itself with its id, so anything ticked once stays fully known even when off screen: it can be downloaded, printed, counted and named without going back to the current list.
   */
  const [picked, setPicked] = useState<Map<string, FleetShipment>>(new Map());
  const [showPicked, setShowPicked] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Filters without the page: used for the fetch, the URL and the full export together.
  const filterParams = useMemo(() => {
    const p: Record<string, string> = { ...periodParams(period) };
    if (debounced.trim()) p.q = debounced.trim();
    if (statusFilter) p.status = statusFilter;
    if (excludeCancelled) p.excludeCancelled = '1';
    if (cityFilter) p.toCity = cityFilter;
    if (customerFilter) p.customer = customerFilter;
    if (supervisorFilter) p.supervisor = supervisorFilter;
    return p;
  }, [debounced, statusFilter, excludeCancelled, cityFilter, customerFilter, supervisorFilter, period]);

  const guard = useLatestRequest(); // A stale response (previous filter) must not overwrite the latest one
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams({ ...filterParams, page: String(page), limit: '25' });
      const d = await api.get<{ shipments: FleetShipment[]; total: number; stats: any; period: any }>(`/api/fleet/shipments?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setShipments(d.shipments || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
      setPeriodResolved(d.period || null);
      setError('');
    } catch (e: any) { if (!guard.isCurrent(mine)) return; setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [filterParams, page, guard]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const qs = new URLSearchParams(filterParams).toString();
    router.replace(`/system/fleet${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [filterParams, router]);
  // Any filter change resets paging to the start; otherwise the user stays on a page number beyond the new results and the list looks empty for no visible reason.
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
      ? `حذف الشحنة أمر نقل رقم ${s.waybillNumber} (${s.customerName || '—'})؟`
      : `Delete shipment, waybill ${s.waybillNumber}?`))) return;
    try { await api.delete(`/api/fleet/shipments/${s._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const downloadOne = async (s: FleetShipment) => {
    setDownloadingId(s._id);
    try {
      // Same file as the mobile app: the server generates the waybill on the letterhead with the stamp.
      const blob = await api.getBlob(`/api/fleet/shipments/${s._id}/waybill.pdf?lang=${ar ? 'ar' : 'en'}`);
      const gen = await import('@/lib/dispatchSheetGenerator');
      gen.triggerDownload(blob, `${waybillFileName(s)}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  // Many waybills are requested once and built on the server. They used to be rendered in the browser one by one with `html2canvas`: the table mounted in the page, rendered at high scale, then removed, once per sheet, on the main thread, so thirty sheets meant thirty freezes that looked like repeated reloads.
  // The server already renders a single waybill with the same file (the row button calls it), so bulk is one call returning one file with a page per waybill.
  /**
   * Ticked waybills become one file. The server caps a call at one hundred (each waybill is a render in a headless browser), so larger selections are split into sequential batches rather than telling the user the cap and leaving them stuck at 120.
   * Batches are sixty, not a hundred: the server renders six at once at about four seconds each, so a hundred is near 75 seconds and nginx cuts off after 120. Sixty stays within half the timeout on a busy server.
   */
  const CHUNK = 60;
  const pickedRows = useMemo(() => Array.from(picked.values()), [picked]);

  const buildPickedPdfs = async (): Promise<Blob[]> => {
    const rows = pickedRows;
    const out: Blob[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      setBulkProgress(rows.length > CHUNK
        ? (ar ? `${i + part.length} من ${rows.length}` : `${i + part.length} of ${rows.length}`)
        : String(rows.length));
      out.push(await api.postBlob('/api/fleet/shipments/waybills.pdf', { ids: part.map((s) => s._id) }));
    }
    return out;
  };

  const downloadPicked = async () => {
    if (!picked.size) return;
    setBulkBusy(true);
    setBulkProgress(ar ? `يجهّز ${picked.size}…` : `preparing ${picked.size}…`);
    try {
      const blobs = await buildPickedPdfs();
      const gen = await import('@/lib/dispatchSheetGenerator');
      blobs.forEach((b, i) => gen.triggerDownload(
        b, blobs.length > 1 ? `أوامر نقل-الشحن-${picked.size}-جزء-${i + 1}.pdf` : `أوامر نقل-الشحن-${picked.size}.pdf`));
      setPicked(new Map());
      setShowPicked(false);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setBulkBusy(false);
    setBulkProgress('');
  };

  /** Print straight from the system to the connected printer, without going through downloads. */
  const printPicked = async () => {
    if (!picked.size) return;
    setBulkBusy(true);
    setBulkProgress(ar ? `يجهّز ${picked.size}…` : `preparing ${picked.size}…`);
    try {
      const blobs = await buildPickedPdfs();
      for (const b of blobs) {
        // One batch after another: the print dialog is per file, and opening them together hides some behind others.
        const ok = await printPdfBlob(b);
        if (!ok) { notify(ar ? 'تعذّر فتح حوار الطباعة — حمّل الملفّ واطبعه.' : 'Could not open the print dialog.', 'error'); break; }
      }
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setBulkBusy(false);
    setBulkProgress('');
  };

  /** Print one waybill from its row: the same file as the download, sent to the printer. */
  const printOne = async (s: FleetShipment) => {
    setDownloadingId(s._id);
    try {
      const blob = await api.getBlob(`/api/fleet/shipments/${s._id}/waybill.pdf?lang=${ar ? 'ar' : 'en'}`);
      const ok = await printPdfBlob(blob);
      if (!ok) notify(ar ? 'تعذّر فتح حوار الطباعة.' : 'Could not open the print dialog.', 'error');
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  const togglePick = (s: FleetShipment) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(s._id)) n.delete(s._id); else n.set(s._id, s);
      return n;
    });

  // Select all applies to the displayed page: it adds it to or removes it from the selection and never clears ticks on another page, otherwise what was gathered in one click is lost.
  const pageAllPicked = shipments.length > 0 && shipments.every((s) => picked.has(s._id));
  const togglePage = (on: boolean) =>
    setPicked((p) => {
      const n = new Map(p);
      shipments.forEach((s) => { if (on) n.set(s._id, s); else n.delete(s._id); });
      return n;
    });

  // How many selected rows are off screen right now, stated so the user trusts that their search did not cancel their selection.
  const pickedOffScreen = pickedRows.filter((s) => !shipments.some((x) => x._id === s._id)).length;

  if (loading) return <Spinner />;

  // The two groups are written once: the card counts what the button itself filters.
  const IN_FLIGHT_KEYS = ['loading', 'uploaded', 'on_way'];
  const DONE_KEYS = ['arrived', 'bond_sent', 'bond_received', 'invoiced'];
  const IN_FLIGHT = IN_FLIGHT_KEYS.join(',');
  const DONE_SET = DONE_KEYS.join(',');
  const inFlight = IN_FLIGHT_KEYS.reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);
  const arrived = DONE_KEYS.reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Truck className="w-5 h-5" />}
        title={ar ? 'حمولات الأسطول' : 'Fleet shipments'}
        subtitle={ar ? 'سياراتنا فقط — الحجز والمتابعة وأوامر النقل' : 'Our own trucks — booking, follow-ups and waybills'}
      >
        {picked.size > 0 && (
          <>
            <button type="button" onClick={downloadPicked} disabled={bulkBusy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {bulkBusy
                ? (ar ? `جارٍ التجهيز ${bulkProgress}…` : `Generating ${bulkProgress}…`)
                : (ar ? `تحميل ${picked.size} أمر نقل` : `Download ${picked.size} waybills`)}
            </button>
            <button type="button" onClick={printPicked} disabled={bulkBusy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-60">
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {ar ? `طباعة ${picked.size}` : `Print ${picked.size}`}
            </button>
          </>
        )}
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-shipments"
          options={[
            { key: 'page', label: ar ? 'الصفحة المعروضة' : 'This page', sheets: [{ name: 'Shipments', rows: shipments as any[], columns: SHIPMENT_COLUMNS }] },
            {
              key: 'filtered',
              label: ar ? 'كل الحمولات حسب الفلتر الحالي' : 'Everything under the current filter',
              hint: String(total),
              // The list is paged, so the full export must be fetched from the server, not built from the displayed page, otherwise it would export 25 rows labelled all.
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

      {/* The card filters the table below. 'In progress' groups three statuses and 'arrived/completed' four; the server now accepts several statuses in the filter (`status=a,b,c`) so the card opens onto its rows as read. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'إجمالي الحمولات' : 'Total shipments'} value={total} accent="text-[#f37121]"
          onClick={() => { setStatusFilter(''); setPage(1); }} active={!statusFilter}
          hint={ar ? 'اضغط لعرض الكل' : 'tap to show all'} />
        <StatCard label={ar ? 'قيد التنفيذ' : 'In flight'} value={inFlight} accent="text-blue-600"
          onClick={() => { setStatusFilter((v) => (v === IN_FLIGHT ? '' : IN_FLIGHT)); setPage(1); }}
          active={statusFilter === IN_FLIGHT} hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'وصلت / مكتملة' : 'Arrived / done'} value={arrived} accent="text-emerald-600"
          onClick={() => { setStatusFilter((v) => (v === DONE_SET ? '' : DONE_SET)); setPage(1); }}
          active={statusFilter === DONE_SET} hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'ملغاة' : 'Cancelled'} value={stats?.byStatus.cancelled || 0} accent="text-red-600"
          onClick={() => { setStatusFilter((v) => (v === 'cancelled' ? '' : 'cancelled')); setPage(1); }}
          active={statusFilter === 'cancelled'} hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
      </div>

      {/* Current destinations: number of vehicles heading to a city, without searching. Clicking filters the list. */}
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
            placeholder={ar ? 'بحث برقم أمر النقل أو العميل أو السائق أو اللوحة…' : 'Search waybill, customer, driver, plate…'} />
        </div>
        <div className="w-40 grow sm:grow-0">
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {FLEET_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
          </Select>
        </div>
        <button type="button" onClick={toggleExcludeCancelled} aria-pressed={excludeCancelled}
            title={ar ? 'يبقى مفعّلًا حتى تلغيه — الأرقام والجدول والتصدير بلا الملغاة' : 'Stays on until you turn it off'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold whitespace-nowrap ${excludeCancelled ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {excludeCancelled ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {ar ? 'باستثناء الملغاة' : 'Excluding cancelled'}
          </button>
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

      {/* Period: the same control and meanings used in loads analysis and vehicle analysis; 'this month' here is literally 'this month' there. */}
      <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
      <PeriodBanner period={resolvedPeriod} lang={ar ? 'ar' : 'en'} count={total} />

      {/* Selection bar. Selection survives search and paging, so it must be visible: its count, how many are off screen now, and the list of transport-order numbers for anyone verifying or removing one. Without it, a user who searched thinks their selection was lost. */}
      {picked.size > 0 && (
        <div className="rounded-xl border-2 border-[#f37121]/40 bg-orange-50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CheckSquare className="w-4 h-4 text-[#f37121]" />
            <span className="text-sm font-bold text-slate-900">
              {ar ? `${picked.size} أمر نقل محدَّدة` : `${picked.size} waybills selected`}
            </span>
            {pickedOffScreen > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white border border-orange-200 text-[11.5px] font-semibold text-orange-700">
                {ar ? `منها ${pickedOffScreen} خارج نتائج البحث الحالية — محفوظة` : `${pickedOffScreen} outside the current results — kept`}
              </span>
            )}
            {picked.size > CHUNK && (
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[11.5px] text-slate-600">
                {ar ? `تُجهَّز على ${Math.ceil(picked.size / CHUNK)} ملفّات` : `prepared as ${Math.ceil(picked.size / CHUNK)} files`}
              </span>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => setShowPicked((v) => !v)}
              className="text-xs font-semibold text-slate-700 underline hover:text-[#f37121]">
              {showPicked ? (ar ? 'إخفاء القائمة' : 'Hide list') : (ar ? 'عرض المحدَّد' : 'Show selected')}
            </button>
            <button type="button" onClick={() => { setPicked(new Map()); setShowPicked(false); }}
              className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
              <X className="w-3.5 h-3.5" /> {ar ? 'إلغاء التحديد' : 'Clear'}
            </button>
          </div>
          {showPicked && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-orange-200/70">
              {pickedRows.map((s) => (
                <span key={s._id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11.5px]">
                  <b className="font-mono">{s.waybillNumber}</b>
                  <span className="text-slate-500 max-w-[110px] truncate">{s.customerName || '—'}</span>
                  <button type="button" onClick={() => togglePick(s)} className="text-slate-400 hover:text-red-600" aria-label={ar ? 'رفع التحديد' : 'Unselect'}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="px-3 py-3">
              <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                checked={pageAllPicked}
                onChange={(e) => togglePage(e.target.checked)}
                aria-label={ar ? 'تحديد كل المعروض' : 'Select everything shown'} />
            </th>
            {[
              ar ? 'رقم أمر النقل' : 'Transport order',
              ar ? 'العميل' : 'Customer',
              // From and To are separate columns: an Arabic arrow points left while the text runs right-to-left and reads backwards, and two columns can be sorted, filtered and exported.
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
              <tr><td colSpan={15} className="text-center text-slate-500 py-14">
                {ar ? 'لا توجد حمولات بعد — ابدأ من زر «إنشاء حمولة».' : 'No shipments yet.'}
              </td></tr>
            ) : shipments.map((s) => {
              const st = fleetStatus(s.status);
              const hrs = hoursSince(s.lastContactAt);
              const contactStale = ['loading', 'uploaded', 'on_way'].includes(s.status) && (hrs === null || hrs >= 3);
              return (
                <tr key={s._id}
                  className={`border-b border-slate-200/70 cursor-pointer ${picked.has(s._id)
                    ? 'bg-orange-50 hover:bg-orange-100/70 shadow-[inset_3px_0_0_0_#f37121]'
                    : 'hover:bg-slate-50'}`}
                  onClick={() => router.push(`/system/fleet/${s._id}`)}>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                      checked={picked.has(s._id)} onChange={() => togglePick(s)}
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
                        title={ar ? 'تحميل أمر النقل' : 'Download transport order'}>
                        {downloadingId === s._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      </button>
                      <button type="button" onClick={() => printOne(s)} disabled={downloadingId === s._id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                        title={ar ? 'طباعة أمر النقل' : 'Print waybill'}>
                        <Printer className="w-4 h-4" />
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
      </ScrollX>

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
