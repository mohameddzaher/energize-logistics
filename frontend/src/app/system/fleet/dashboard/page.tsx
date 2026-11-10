'use client';
// Fleet analytics dashboard: income, target attainment per vehicle, ranking of drivers, customers and supervisors, monthly trend and load distribution, with multiple filters and Excel export.
import { useState, useEffect, useMemo, useCallback, useRef, Suspense, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, periodFromParams, EMPTY_PERIOD, type Period } from '@/components/fleet/PeriodFilter';
import { canViewFleet, fleetStatus, fleetStatusLabel, fmtD, type Lang } from '@/lib/fleet';
import { BarChart3, TrendingUp, RotateCcw, Search, Star, CalendarClock, PackageSearch, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import LoadsAnalysis from '@/components/fleet/LoadsAnalysis';
import { syncUrl } from '@/lib/urlSync';
import ScrollX from '@/components/system/ScrollX';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import { EyeOff, Crosshair } from 'lucide-react';

// The analytics filters, in the HR quick-filter style. Each is multi-select with search and a count per value.
const QF_KEYS = [
  { key: 'vehicle', ar: 'السيارات', en: 'Trucks' },
  { key: 'excludeVehicle', ar: 'استبعاد سيارات', en: 'Exclude trucks' },
  { key: 'customer', ar: 'العميل', en: 'Customer' },
  { key: 'supervisor', ar: 'المشرف', en: 'Supervisor' },
  { key: 'trailerType', ar: 'التيدر', en: 'Trailer' },
  { key: 'customerType', ar: 'نوع العميل', en: 'Customer type' },
  { key: 'status', ar: 'الحالة', en: 'Status' },
];

type Cust = { _id: string | null; name: string; customerType: string; rating: number; trips: number; income: number };
type Analytics = {
  period: { from: string; to: string; monthsInRange: number; preset?: string };
  totals: { totalIncome: number; totalFullRent: number; branchShare: number; tripCount: number; totalDriverExpense: number; vehicleCount: number; customerCount: number; vehiclesAchieved: number; vehiclesBelow: number; avgTripIncome: number; targetBasis?: 'gross' | 'net' };
  byTrailerType: Record<string, number>;
  byCustomerType: { heavy: { count: number; income: number }; branch: { count: number; income: number } };
  vehicles: { _id: string; plate: string; name?: string; trailerType?: string; supervisorName?: string; trips: number; income: number; driverExpense?: number; achievedValue?: number; shortfall?: number; monthlyTarget: number; periodTarget: number; achievedPct: number | null; achieved: boolean | null; firstLoadAt?: string | null; lastLoadAt?: string | null }[];
  topDrivers: { name: string; trips: number; income: number }[];
  supervisors: { name: string; trips: number; income: number }[];
  customers: Cust[];
  topHeavyCustomers: Cust[];
  topBranchCustomers: Cust[];
  monthlyTrend: { month: string; income: number; trips: number }[];
  filterOptions?: Record<string, { value: string; label?: string; count: number }[]>;
};

/** A load row in the per-vehicle detail; same fields as the loads page. */
type VehLoad = {
  _id: string; waybillNumber: number; customerName?: string; customer?: string | null;
  fromCity?: string; toCity?: string; driverName?: string; secondDriverName?: string;
  loadType?: string; price?: number | null; fullRent?: number | null; driverExpense?: number | null;
  status: string; loadDate?: string | null; createdAt?: string;
};
type VehLoads = { loading: boolean; rows: VehLoad[]; totals?: { loads: number; income: number; driverExpense: number }; truncated?: boolean; error?: string };

const ORANGE = '#f37121';
const PALETTE = ['#f37121', '#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#64748b'];
const money = (n: number) => (Number(n) || 0).toLocaleString('en-US');
/** Day/month in Latin digits; the table is compared vertically so alignment must be fixed. */
const dmy = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

/**
 * Loads of a single vehicle: the table that opens under its row.
 * A file-level component, not defined inside the render body, because an inline component is rebuilt on every state change and loses its state.
 */
function VehicleLoads({ state, plate, ar, lang }: { state?: VehLoads; plate: string; ar: boolean; lang: Lang }) {
  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> {ar ? `يجلب حمولات ${plate}…` : `Loading loads for ${plate}…`}
      </div>
    );
  }
  if (state.error) return <div className="py-3 text-sm text-red-600">{state.error}</div>;
  if (!state.rows.length) {
    return <div className="py-4 text-sm text-slate-400">{ar ? 'لا حمولات لهذه السيارة داخل الفلتر الحالي.' : 'No loads for this truck under the current filter.'}</div>;
  }
  const th = 'px-2.5 py-1.5 text-start font-semibold whitespace-nowrap';
  const td = 'px-2.5 py-1.5 whitespace-nowrap';
  return (
    <div className="rounded-xl border border-orange-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-orange-50 border-b border-orange-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <b className="text-slate-900 text-xs">{ar ? `حمولات ${plate}` : `Loads of ${plate}`}</b>
        <span className="text-slate-600">{ar ? 'العدد' : 'Loads'} <b className="tabular-nums">{state.totals?.loads ?? state.rows.length}</b></span>
        <span className="text-emerald-700">{ar ? 'سعر البيع' : 'Selling price'} <b className="tabular-nums">{money(state.totals?.income || 0)}</b></span>
        <span className="text-amber-700">{ar ? 'مصروف السائق' : 'Driver expense'} <b className="tabular-nums">{money(state.totals?.driverExpense || 0)}</b></span>
        {state.truncated && <span className="text-slate-400">{ar ? 'معروضٌ أوّل 500 صفّ' : 'first 500 rows shown'}</span>}
      </div>
      <ScrollX>
        <table className="w-full text-[12px]">
          <thead className="bg-slate-100 text-slate-600">
            <tr>{[ar ? 'أمر النقل' : 'Transport order', ar ? 'التاريخ' : 'Date', ar ? 'العميل' : 'Customer', ar ? 'من' : 'From', ar ? 'إلى' : 'To',
              ar ? 'السائق' : 'Driver', ar ? 'نوع الحمولة' : 'Load type', ar ? 'السعر' : 'Price', ar ? 'مصروف السائق' : 'Driver expense',
              ar ? 'الحالة' : 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {state.rows.map((r) => {
              const st = fleetStatus(r.status);
              return (
                <tr key={r._id} className="hover:bg-orange-50/60">
                  <td className={`${td} font-mono font-bold`}>
                    <Link href={`/system/fleet/${r._id}`} className="text-[#f37121] hover:underline">{r.waybillNumber}</Link>
                  </td>
                  <td className={`${td} text-slate-600 tabular-nums`}>{fmtD(r.loadDate || r.createdAt)}</td>
                  <td className={`${td} text-slate-800 max-w-[200px] truncate`} title={r.customerName}>
                    {r.customer ? <Link href={`/system/fleet/customers/${r.customer}`} className="hover:underline">{r.customerName || '—'}</Link> : (r.customerName || '—')}
                  </td>
                  <td className={`${td} text-slate-600`}>{r.fromCity || '—'}</td>
                  <td className={`${td} text-slate-600`}>{r.toCity || '—'}</td>
                  <td className={`${td} text-slate-600 max-w-[160px] truncate`}>
                    {[r.driverName, r.secondDriverName].filter(Boolean).join(' + ') || '—'}
                  </td>
                  <td className={`${td} text-slate-500`}>{r.loadType || '—'}</td>
                  <td className={`${td} font-semibold text-emerald-700 tabular-nums`}>{r.price ? money(r.price) : '—'}</td>
                  <td className={`${td} text-amber-700 tabular-nums`}>{r.driverExpense ? money(r.driverExpense) : '—'}</td>
                  <td className={td}>
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-600'}`}>
                      {fleetStatusLabel(r.status, lang)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}

function FleetAnalyticsInner({ active = true }: { active?: boolean }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();

  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters all live in the page URL so an analysis can be shared by one link
  const multi = (k: string) => (sp?.get(k) ? sp!.get(k)!.split(',').filter(Boolean) : []);
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  // One object for every list filter, written to the URL as comma-separated values.
  const [qf, setQf] = useState<Record<string, string>>(() => Object.fromEntries(
    QF_KEYS.map((k) => [k.key, multi(k.key).join(',')]).filter(([, v]) => v),
  ));
  const listOf = (k: string) => String(qf[k] || '').split(',').filter(Boolean);
  const setList = (k: string, vals: string[]) => setQf((f) => {
    const n = { ...f };
    if (vals.length) n[k] = [...new Set(vals)].join(','); else delete n[k];
    return n;
  });
  const [q, setQ] = useState(() => sp?.get('q') || '');
  const [vehSort, setVehSort] = useState<'income' | 'trips' | 'achievedPct'>('income');
  // Show the vehicles that missed target: the question that follows the card, which had no answer.
  const [targetFilter, setTargetFilter] = useState<'all' | 'achieved' | 'below'>('all');
  // The card takes you to its answer. It used to filter a table at the bottom without moving the screen, so users saw nothing change and thought the button was broken; the answer was two screens down.
  const vehTableRef = useRef<HTMLDivElement>(null);
  const pickTarget = (k: 'achieved' | 'below') => {
    setTargetFilter((f) => (f === k ? 'all' : k));
    setTimeout(() => vehTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const [custTab, setCustTab] = useState<'all' | 'heavy' | 'branch'>('all');


  const query = useMemo(() => {
    const p = new URLSearchParams(periodParams(period));
    for (const k of QF_KEYS) if (qf[k.key]) p.set(k.key, qf[k.key]);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [period, qf, q]);

  const load = useCallback(async () => {
    try { setData(await api.get<Analytics>(`/api/fleet/analytics?${query}`)); } catch { /* keep last */ }
    setLoading(false);
  }, [query]);

  // Nothing is fetched while the tab is hidden: both tabs stay mounted to keep each one's filters, but the hidden one must not call the server on every change.
  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, active]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  // Trucks come from the vehicle register and drivers from HR: refetch when either changes.
  useSocket('vreg:updated', useCallback(() => load(), [load]));
  // Truck target and driver status are announced by these two events.
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));
  useSocket('fleet:drivers', useCallback(() => load(), [load]));
  useSocket('hr:employee', useCallback(() => load(), [load]));
  // The URL is written, not navigated to: router.replace is a full navigation that remounts the tree on every filter click, which is slow and loops forever once the screen is a tab. history.replaceState only writes the URL.
  useEffect(() => {
    if (!active) return;
    const q = new URLSearchParams(query);
    q.set('tab', 'overview');
    syncUrl('/system/fleet/dashboard', q);
  }, [query, active]);

  const reset = () => { setPeriod(EMPTY_PERIOD); setQf({}); setQ(''); };
  // From a table row: drop this truck from every figure, or look at it alone.
  const excludeVeh = (id: string) => { setList('vehicle', listOf('vehicle').filter((x) => x !== id)); setList('excludeVehicle', [...listOf('excludeVehicle'), id]); };
  const onlyVeh = (id: string) => { setList('excludeVehicle', listOf('excludeVehicle').filter((x) => x !== id)); setList('vehicle', [id]); };

  /**
   * Loads under each vehicle. The table says a vehicle carried eleven loads worth a given amount, and the next question is which eleven; the answer used to be on another screen with a hand-built filter, so a plate search showed an aggregate and not a single waybill.
   * The row now opens onto its loads: waybill, customer, route, price, expense and status, the same columns as the loads page, with this screen's filter (period, status, supervisor, search) and from the same loads-analysis call. Every number on screen has its detail below it.
   */
  const [openVeh, setOpenVeh] = useState<string>('');
  const [vehLoads, setVehLoads] = useState<Record<string, VehLoads>>({});

  const fetchVehLoads = useCallback(async (id: string) => {
    setVehLoads((m) => ({ ...m, [id]: { loading: true, rows: m[id]?.rows || [] } }));
    try {
      const p = new URLSearchParams(query);
      p.set('vehicle', id);          // Overrides any existing vehicle filter: this row is the target
      p.delete('excludeVehicle');
      p.set('limit', '500');
      const d = await api.get<{ shipments: VehLoad[]; totals: VehLoads['totals']; truncated: boolean }>(`/api/fleet/loads-analysis?${p}`);
      setVehLoads((m) => ({ ...m, [id]: { loading: false, rows: d.shipments || [], totals: d.totals, truncated: !!d.truncated } }));
    } catch (e) {
      setVehLoads((m) => ({ ...m, [id]: { loading: false, rows: [], error: (e as Error)?.message || 'Request failed' } }));
    }
  }, [query]);

  const toggleVeh = (id: string) => {
    if (openVeh === id) { setOpenVeh(''); return; }
    setOpenVeh(id);
    fetchVehLoads(id);
  };

  // When the filter changes, the open detail is refetched and cached details for other filters are dropped: a number from one period beside a detail from another is worse than no detail.
  useEffect(() => {
    setVehLoads({});
    if (openVeh) fetchVehLoads(openVeh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useSocket('fleet:updated', useCallback(() => { if (openVeh) fetchVehLoads(openVeh); }, [openVeh, fetchVehLoads]));

  const sortedVehicles = useMemo(() => {
    if (!data) return [];
    const rows = targetFilter === 'all'
      ? data.vehicles
      : data.vehicles.filter((v) => (targetFilter === 'achieved' ? v.achieved === true : v.achieved === false));
    return [...rows].sort((a, b) => {
      if (vehSort === 'trips') return b.trips - a.trips;
      if (vehSort === 'achievedPct') return (b.achievedPct ?? -1) - (a.achievedPct ?? -1);
      return b.income - a.income;
    });
  }, [data, vehSort, targetFilter]);

  // A search for a single plate needs no row click. Search narrows the table to one vehicle, so the intent is clear: its loads open on their own.
  useEffect(() => {
    if (!q.trim()) return;
    const withLoads = sortedVehicles.filter((v) => v.trips > 0);
    if (withLoads.length === 1 && openVeh !== withLoads[0]._id) {
      setOpenVeh(withLoads[0]._id);
      fetchVehLoads(withLoads[0]._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sortedVehicles]);

  const custRows = useMemo(() => {
    if (!data) return [];
    if (custTab === 'heavy') return data.customers.filter((c) => c.customerType === 'heavy');
    if (custTab === 'branch') return data.customers.filter((c) => c.customerType === 'branch');
    return data.customers;
  }, [data, custTab]);

  const exportSheets = data ? [
    { name: ar ? 'السيارات' : 'Vehicles', rows: sortedVehicles as any[], columns: [
      { header: 'Plate', key: 'plate', width: 16 }, { header: 'Trailer', key: 'trailerType', width: 14 },
      { header: 'Supervisor', key: 'supervisorName', width: 20 }, { header: 'Trips', key: 'trips', width: 10 },
      { header: 'Income', key: 'income', width: 14 }, { header: 'Period target', key: 'periodTarget', width: 14 },
      { header: 'Achieved %', key: 'achievedPct', width: 12 } ] },
    { name: ar ? 'السواقون' : 'Drivers', rows: data.topDrivers as any[], columns: [
      { header: 'Driver', key: 'name', width: 24 }, { header: 'Trips', key: 'trips', width: 10 }, { header: 'Income', key: 'income', width: 14 } ] },
    { name: ar ? 'المشرفون' : 'Supervisors', rows: data.supervisors as any[], columns: [
      { header: 'Supervisor', key: 'name', width: 24 }, { header: 'Loads', key: 'trips', width: 10 }, { header: 'Income', key: 'income', width: 14 } ] },
    { name: ar ? 'العملاء' : 'Customers', rows: data.customers as any[], columns: [
      { header: 'Customer', key: 'name', width: 28 }, { header: 'Type', key: 'customerType', width: 12 },
      { header: 'Rating', key: 'rating', width: 10 }, { header: 'Trips', key: 'trips', width: 10 }, { header: 'Income', key: 'income', width: 14 } ] },
    { name: ar ? 'الترند الشهري' : 'Monthly', rows: data.monthlyTrend as any[], columns: [
      { header: 'Month', key: 'month', width: 12 }, { header: 'Income', key: 'income', width: 14 }, { header: 'Trips', key: 'trips', width: 10 } ] },
  ] : [];

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading && !data) return <Spinner />;

  // Labels for keys the server sends as raw values (status, customer type).
  const qfOptions = (() => {
    const o = { ...(data?.filterOptions || {}) };
    if (o.status) o.status = o.status.map((x) => ({ ...x, label: fleetStatusLabel(x.value, lang as Lang) }));
    if (o.customerType) o.customerType = o.customerType.map((x) => ({ ...x, label: x.value === 'branch' ? (ar ? 'فروع' : 'Branch') : x.value === 'heavy' ? (ar ? 'نقل ثقيل' : 'Heavy') : x.value }));
    return o;
  })();

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`;
  const trailerData = data ? Object.entries(data.byTrailerType).map(([name, value]) => ({ name, value })) : [];

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />}
        title={ar ? 'تحليلات إدارة الأسطول' : 'Fleet Analytics'}
        subtitle={ar ? 'الدخل وتحقيق الأهداف والترتيبات — قابلة للفلترة والتصدير' : 'Income, targets, rankings — filterable & exportable'}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-analytics"
          options={[
            { key: 'all', label: ar ? 'التحليلات حسب الفلتر الحالي' : 'Analytics under the current filter', sheets: exportSheets },
            { key: 'vehicles', label: ar ? 'أداء السيارات فقط' : 'Vehicle performance only', sheets: exportSheets.slice(0, 1) },
          ]} />
      </PageHeader>

      {/* Filter bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'بحث' : 'Search'}</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'عميل / لوحة / سائق / مدينة…' : 'customer / plate / driver / city…'} className="w-full ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-sm" />
            </div>
          </div>
          <button type="button" onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm">
            <RotateCcw className="w-3.5 h-3.5" /> {ar ? 'مسح' : 'Reset'}
          </button>
        </div>
        {/* Filters as dropdowns with search and counts; "exclude trucks" gives the whole fleet but the chosen ones. */}
        <HrQuickFilters ar={ar} keys={QF_KEYS} value={qf}
          onChange={(v) => setQf(Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== '')) as Record<string, string>)}
          options={qfOptions} />
        {listOf('excludeVehicle').length > 0 && (
          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5" />
            {ar ? `التحليلات بدون ${listOf('excludeVehicle').length} سيارة مستبعدة` : `Analytics without ${listOf('excludeVehicle').length} excluded truck(s)`}
          </p>
        )}
      </div>

      {/* Period bar: the on-screen figure belongs to this range only. Without it, searching a vehicle outside the current month looked like 'everything is zero' with no explanation. */}
      <PeriodBanner period={data?.period} lang={ar ? 'ar' : 'en'} count={data?.totals.tripCount} />

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label={ar ? 'إجمالي سعر البيع' : 'Total selling price'} value={money(data.totals.totalIncome)} accent="text-emerald-600" />
            <StatCard label={ar ? 'عدد الرحلات' : 'Trips'} value={data.totals.tripCount} accent="text-[#f37121]" />
            <StatCard label={ar ? 'متوسط دخل الرحلة' : 'Avg / trip'} value={money(data.totals.avgTripIncome)} />
            {/* A card is a question, so make it an answer. 'Seven vehicles under target' is followed by 'which ones?'. The card used to stop at the number; now clicking it filters the table. */}
            <button type="button" onClick={() => pickTarget('achieved')}
              className={`text-start rounded-xl transition-shadow ${targetFilter === 'achieved' ? 'ring-2 ring-emerald-500' : 'hover:shadow-md'}`}>
              <StatCard label={ar ? 'سيارات محقّقة الهدف' : 'On target'} value={`${data.totals.vehiclesAchieved} / ${data.totals.vehicleCount}`} accent="text-emerald-600" />
            </button>
            <button type="button" onClick={() => pickTarget('below')}
              className={`text-start rounded-xl transition-shadow ${targetFilter === 'below' ? 'ring-2 ring-red-500' : 'hover:shadow-md'}`}>
              <StatCard label={ar ? 'سيارات دون الهدف' : 'Below target'} value={data.totals.vehiclesBelow} accent="text-red-600" />
            </button>
            <StatCard label={ar ? 'مصروف السائقين' : 'Driver expense'} value={money(data.totals.totalDriverExpense || 0)} accent="text-amber-600" />
          </div>

          {/* Links to sibling screens: analysis starts here and ends at a detail there. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/system/fleet/arrivals" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f37121] transition-colors">
              <span className="p-2 rounded-xl bg-[#f37121]/10 text-[#f37121]"><CalendarClock className="w-5 h-5" /></span>
              <span>
                <span className="block font-bold text-slate-900 text-sm">{ar ? 'المتوقع للوصول' : 'Expected arrivals'}</span>
                <span className="block text-xs text-slate-500">{ar ? 'مَن يصل ومتى وأين — ومعه السيارات الفاضية وقتها' : 'Who arrives, when and where — plus idle trucks'}</span>
              </span>
            </Link>
            <Link href={`/system/fleet/loads-analysis${query ? `?${query}` : ''}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#f37121] transition-colors">
              <span className="p-2 rounded-xl bg-amber-100 text-amber-700"><PackageSearch className="w-5 h-5" /></span>
              <span>
                <span className="block font-bold text-slate-900 text-sm">{ar ? 'تحليل الحمولات' : 'Loads analysis'}</span>
                <span className="block text-xs text-slate-500">{ar ? 'كل حمولة بمصروفها ومشرفها — بنفس فلتر هذه الشاشة' : 'Every load with its expense — same filter as here'}</span>
              </span>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /> {ar ? 'الدخل الشهري (آخر 12 شهرًا)' : 'Monthly income (last 12 months)'}</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="income" name={ar ? 'الدخل' : 'Income'} stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="trips" name={ar ? 'الرحلات' : 'Trips'} stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'الدخل حسب نوع العميل' : 'Income by customer type'}</p>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie dataKey="value" data={[
                    { name: ar ? 'نقل ثقيل' : 'Heavy', value: data.byCustomerType.heavy.income },
                    { name: ar ? 'فروع' : 'Branch', value: data.byCustomerType.branch.income },
                  ]} cx="50%" cy="50%" outerRadius={68} label>
                    <Cell fill={ORANGE} /><Cell fill="#2563eb" />
                  </Pie>
                  <Tooltip formatter={(v: number) => money(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg bg-orange-50 p-2"><p className="text-xs text-slate-500">{ar ? 'نقل ثقيل' : 'Heavy'}</p><p className="font-bold text-[#f37121]">{money(data.byCustomerType.heavy.income)}</p><p className="text-[11px] text-slate-500">{data.byCustomerType.heavy.count} {ar ? 'رحلة' : 'trips'}</p></div>
                <div className="rounded-lg bg-blue-50 p-2"><p className="text-xs text-slate-500">{ar ? 'فروع' : 'Branch'}</p><p className="font-bold text-blue-600">{money(data.byCustomerType.branch.income)}</p><p className="text-[11px] text-slate-500">{data.byCustomerType.branch.count} {ar ? 'رحلة' : 'trips'}</p></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'دخل السيارات مقابل الهدف (أعلى 15)' : 'Vehicle income vs target (top 15)'}</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={sortedVehicles.slice(0, 15)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="plate" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                  <Bar dataKey="income" name={ar ? 'الدخل' : 'Income'} fill={ORANGE} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="periodTarget" name={ar ? 'الهدف' : 'Target'} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'الرحلات حسب نوع التيدر' : 'Trips by trailer type'}</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie dataKey="value" data={trailerData} cx="50%" cy="50%" outerRadius={80} label>
                    {trailerData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-bold text-slate-900" >
                  <span ref={vehTableRef as any} className="block h-0 -mt-20 pt-20" aria-hidden="true" />
                  {ar ? 'أداء السيارات مقابل الهدف' : 'Vehicles vs target'}
                  {/* After clicking the under-target card, the user must see the table is restricted to it, or they read a part as the whole. */}
                  {targetFilter !== 'all' && (
                    <span className={`ms-2 text-xs font-semibold ${targetFilter === 'below' ? 'text-red-600' : 'text-emerald-600'}`}>
                      · {targetFilter === 'below' ? (ar ? 'دون الهدف' : 'below target') : (ar ? 'محقّقة الهدف' : 'on target')} ({sortedVehicles.length})
                      <button type="button" onClick={() => setTargetFilter('all')} className="ms-1.5 text-slate-400 hover:text-slate-700 font-normal underline">
                        {ar ? 'عرض الكل' : 'show all'}
                      </button>
                    </span>
                  )}
                </p>
                {/* State the metric with the number; without it the figure is misread. */}
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  {ar ? 'اضغط صفَّ سيّارةٍ لترى حمولاتها كلَّها بأمر النقل والعميل ومن/إلى والسعر.' : 'Click a row to see that truck’s loads — waybill, customer, route and price.'}
                </p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  {data.totals.targetBasis === 'net'
                    ? (ar ? 'الهدف يُقاس بالدخل بعد مصروف السائق (غير شامل)' : 'Target measured against income after driver expense')
                    : (ar ? 'الهدف يُقاس بالدخل كما هو (شامل مصاريف السائقين)' : 'Target measured against gross income')}
                  <Link href="/system/fleet/settings" className="ms-1.5 text-[#f37121] hover:underline">{ar ? 'تغيير' : 'change'}</Link>
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(['all', 'achieved', 'below'] as const).map((k) => (
                  <button key={k} onClick={() => setTargetFilter(k)} className={chip(targetFilter === k)}>
                    {k === 'all' ? (ar ? 'الكل' : 'All') : k === 'achieved' ? (ar ? 'محقّقة' : 'On target') : (ar ? 'غير محقّقة' : 'Below')}
                  </button>
                ))}
                <span className="w-px bg-slate-200 mx-1" />
                {(['income', 'trips', 'achievedPct'] as const).map((k) => (
                  <button key={k} onClick={() => setVehSort(k)} className={chip(vehSort === k)}>
                    {k === 'income' ? (ar ? 'الدخل' : 'Income') : k === 'trips' ? (ar ? 'الرحلات' : 'Trips') : (ar ? 'التحقيق' : 'Attainment')}
                  </button>
                ))}
              </div>
            </div>
            <ScrollX>
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>{['', ar ? 'الحالة' : 'Status', ar ? 'اللوحة' : 'Plate', ar ? 'التيدر' : 'Trailer', ar ? 'المشرف' : 'Supervisor', ar ? 'الحمولات' : 'Loads', ar ? 'شغّالة من' : 'Active from', ar ? 'المحقَّق' : 'Achieved', ar ? 'الهدف' : 'Target', ar ? 'الناقص' : 'Shortfall', ar ? 'التحقيق' : 'Attained'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedVehicles.map((v) => (
                    <Fragment key={v._id}>
                    <tr className={`cursor-pointer ${openVeh === v._id ? 'bg-orange-50' : v.achieved === false ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50'}`}
                      onClick={() => toggleVeh(v._id)}>
                      <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => excludeVeh(v._id)} title={ar ? 'استبعاد من التحليلات' : 'Exclude from analytics'}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50">
                            <EyeOff className="w-3.5 h-3.5" />{ar ? 'استبعاد' : 'Exclude'}
                          </button>
                          <button type="button" onClick={() => onlyVeh(v._id)} title={ar ? 'تحليلات هذه السيارة فقط' : 'This truck only'}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-[#f37121] hover:text-[#f37121] hover:bg-orange-50">
                            <Crosshair className="w-3.5 h-3.5" />{ar ? 'هذه فقط' : 'Only'}
                          </button>
                        </span>
                      </td>
                      {/* Status read at a glance. It used to be inferred from the attainment color in the last column, so finding the under-target vehicles meant scanning column by column and comparing colors. Now it is a word at the row start and an under-target row is fully shaded. */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        {v.achieved == null ? (
                          <span className="text-slate-300 text-xs">{ar ? 'بلا هدف' : 'no target'}</span>
                        ) : v.achieved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                            ✓ {ar ? 'محقّقة' : 'On target'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                            ✕ {ar ? 'دون الهدف' : 'Below'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {/* The arrow says the row has a detail; the whole row opens it. */}
                          <span className="text-slate-400">
                            {openVeh === v._id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />}
                          </span>
                          <Link href={`/system/fleet/vehicles/${v._id}${query ? `?${query}` : ''}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#f37121] hover:underline">{v.plate}</Link>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{v.trailerType || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{v.supervisorName || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{v.trips}</td>
                      {/* Active from when to when: first and last load in the period. */}
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap text-xs tabular-nums">
                        {v.firstLoadAt ? `${dmy(v.firstLoadAt)} → ${dmy(v.lastLoadAt || v.firstLoadAt)}` : <span className="text-slate-400">{ar ? 'لم تعمل' : 'idle'}</span>}
                      </td>
                      <td className="px-3 py-2 font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                        {money(v.achievedValue ?? v.income)}
                        {data.totals.targetBasis === 'net' && v.driverExpense ? (
                          <span className="block text-[10.5px] font-normal text-slate-400">
                            {ar ? 'دخل' : 'gross'} {money(v.income)} − {money(v.driverExpense)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-500 tabular-nums whitespace-nowrap">{money(v.periodTarget)}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {v.achieved === false && v.shortfall ? <span className="text-red-600 font-semibold">{money(v.shortfall)}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {v.achievedPct == null ? <span className="text-slate-400">—</span> : (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${v.achieved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{v.achievedPct}%</span>
                        )}
                      </td>
                    </tr>
                    {openVeh === v._id && (
                      <tr className="bg-orange-50/40">
                        <td colSpan={11} className="px-3 pb-4 pt-1">
                          <VehicleLoads state={vehLoads[v._id]} plate={v.plate} ar={ar} lang={lang as Lang} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                  {sortedVehicles.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا توجد بيانات لهذه الفلاتر' : 'No data'}</td></tr>}
                </tbody>
              </table>
            </ScrollX>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'أعلى السواقين دخلاً' : 'Top drivers by income'}</p>
              <ResponsiveContainer width="100%" height={Math.max(160, Math.min(360, data.topDrivers.length * 34))}>
                <BarChart data={data.topDrivers.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Bar dataKey="income" name={ar ? 'الدخل' : 'Income'} fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'أداء المشرفين' : 'Supervisor performance'}</p>
              <ResponsiveContainer width="100%" height={Math.max(160, Math.min(360, data.supervisors.length * 40))}>
                <BarChart data={data.supervisors} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                  <Bar dataKey="income" name={ar ? 'الدخل' : 'Income'} fill={ORANGE} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="trips" name={ar ? 'الحمولات' : 'Loads'} fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <p className="font-bold text-slate-900">{ar ? 'ترتيب العملاء' : 'Customer ranking'}</p>
              <div className="flex gap-1.5 text-xs">
                <button onClick={() => setCustTab('all')} className={chip(custTab === 'all')}>{ar ? 'الكل' : 'All'}</button>
                <button onClick={() => setCustTab('heavy')} className={chip(custTab === 'heavy')}>{ar ? 'نقل ثقيل' : 'Heavy'}</button>
                <button onClick={() => setCustTab('branch')} className={chip(custTab === 'branch')}>{ar ? 'فروع' : 'Branch'}</button>
              </div>
            </div>
            <ScrollX>
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>{[ar ? 'العميل' : 'Customer', ar ? 'النوع' : 'Type', ar ? 'التقييم' : 'Rating', ar ? 'الرحلات' : 'Trips', ar ? 'الدخل' : 'Income'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {custRows.map((c, i) => (
                    <tr key={c._id || i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold">{c._id ? <Link href={`/system/fleet/customers/${c._id}`} className="text-[#f37121] hover:underline">{c.name}</Link> : c.name}</td>
                      <td className="px-3 py-2">{c.customerType === 'heavy' ? (ar ? 'نقل ثقيل' : 'Heavy') : c.customerType === 'branch' ? (ar ? 'فروع' : 'Branch') : '—'}</td>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-0.5 text-amber-500">{c.rating ? <>{c.rating}<Star className="w-3.5 h-3.5 fill-amber-400" /></> : <span className="text-slate-300">—</span>}</span></td>
                      <td className="px-3 py-2">{c.trips}</td>
                      <td className="px-3 py-2 font-semibold text-emerald-700">{money(c.income)}</td>
                    </tr>
                  ))}
                  {custRows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا يوجد عملاء' : 'No customers'}</td></tr>}
                </tbody>
              </table>
            </ScrollX>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Fleet analytics page: two tabs, not two pages.
 * They were separate screens answering adjacent questions (how much did the fleet earn and who met target; what did each vehicle carry and what is paid to its driver). Two similar names forced users to guess and jump between them to compare numbers. They are now tabs under one period filter, and the tab lives in the URL so it is shared and kept.
 */
function FleetAnalyticsTabs() {
  const sp = useSearchParams();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'overview' | 'loads'>(sp?.get('tab') === 'loads' ? 'loads' : 'overview');
  // The second tab is not mounted until requested: its call scans thousands of loads and loading it on open slows what was not asked for. Once mounted it stays mounted.
  const [mountedLoads, setMountedLoads] = useState(sp?.get('tab') === 'loads');

  const pick = (t: 'overview' | 'loads') => {
    if (t === tab) return;
    if (t === 'loads') setMountedLoads(true);
    setTab(t);
    // The URL is only written. router.replace is a full navigation and put the page in an infinite loop when the two screens became tabs.
    const q = new URLSearchParams(Array.from(sp?.entries() || []));
    q.set('tab', t);
    syncUrl('/system/fleet/dashboard', q);
  };

  const TABS = [
    { key: 'overview' as const, icon: BarChart3, ar: 'نظرة عامة', en: 'Overview', hintAr: 'الدخل والأهداف والترتيبات', hintEn: 'Income, targets, rankings' },
    { key: 'loads' as const, icon: PackageSearch, ar: 'الحمولات ومصروف السائقين', en: 'Loads & driver expense', hintAr: 'كل حمولة بمصروفها ومشرفها وعميلها', hintEn: 'Every load with its expense, supervisor and customer' },
  ];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Tabs: two adjacent buttons with an orange bar under the selected one, no double borders or shadows. Each has a description line because the names are close; without it the choice is a guess, as when they were two pages. The description is hidden on mobile where it does not fit. */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm inline-flex flex-wrap gap-1 w-full sm:w-auto">
        {TABS.map((tb) => {
          const on = tab === tb.key;
          const Icon = tb.icon;
          return (
            <button key={tb.key} type="button" onClick={() => pick(tb.key)}
              aria-pressed={on}
              className={`flex-1 sm:flex-none text-start px-3.5 py-2 rounded-lg transition-colors ${
                on ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className={`w-4 h-4 ${on ? 'text-[#f37121]' : 'text-slate-400'}`} />
                {ar ? tb.ar : tb.en}
              </span>
              <span className={`hidden sm:block text-[11px] mt-0.5 ${on ? 'text-slate-300' : 'text-slate-400'}`}>
                {ar ? tb.hintAr : tb.hintEn}
              </span>
            </button>
          );
        })}
      </div>

      {/* Both tabs stay mounted but the non-displayed one is hidden: returning to it does not refetch, and its filters are kept. */}
      <div className={tab === 'overview' ? '' : 'hidden'}><FleetAnalyticsInner active={tab === 'overview'} /></div>
      {mountedLoads && <div className={tab === 'loads' ? '' : 'hidden'}><LoadsAnalysis active={tab === 'loads'} /></div>}
    </div>
  );
}

export default function FleetAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><FleetAnalyticsTabs /></Suspense>;
}
