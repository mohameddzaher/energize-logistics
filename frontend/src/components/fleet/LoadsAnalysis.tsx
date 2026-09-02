'use client';
// تحليل الحمولات — شاشةُ صرفٍ قبل أن تكون شاشةَ تقارير.
//
// يقف المشرف عليها في آخر اليوم ليعرف كم يُسلِّم لكل سائق: ولذلك المصروف عمودٌ
// أمام كل حمولة **و** مجموعٌ لكل سائقٍ على حدة. والرقمان يأتيان من الخادم من
// نفس المطابقة، فلا يختلف مجموعُ البطاقة عن حاصل جمع الصفوف حين تتجاوز
// الحمولاتُ سقفَ العرض — وهو الخطأ الذي يُنتِج صرفًا ناقصًا.
//
// وكل حمولةٍ تحمل معها مشرفَها وعميلَها، لأن السؤال الذي يليها دائمًا: «الحمولة
// دي تبع مين؟».
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Spinner, PageHeader, StatCard, ErrorNotice, SearchInput, Select } from '@/components/hr/HRKit';
import ExportMenu, { type ExportSheet } from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, periodFromParams, type Period } from '@/components/fleet/PeriodFilter';
import { useFleetLookups } from '@/hooks/useFleetLookups';
import {
  type FleetLoadsAnalysis, type FleetCustomer, FLEET_STATUSES, fleetStatus, fleetStatusLabel,
  fmtD, canViewFleet, money, shipmentVehicleId, shipmentCustomerId, type Lang,
} from '@/lib/fleet';
import { Wallet, Coins, PackageSearch } from 'lucide-react';
import { syncUrl } from '@/lib/urlSync';

const ORANGE = '#f37121';

export default function LoadsAnalysis({ active = true }: { active?: boolean }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const lkp = useFleetLookups(ar);
  const router = useRouter();
  const sp = useSearchParams();

  const [d, setD] = useState<FleetLoadsAnalysis | null>(null);
  const [customers, setCustomers] = useState<FleetCustomer[]>([]);
  const [supers, setSupers] = useState<{ _id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  const [supervisor, setSupervisor] = useState(() => sp?.get('supervisor') || '');
  const [customer, setCustomer] = useState(() => sp?.get('customer') || '');
  const [status, setStatus] = useState(() => sp?.get('status') || '');
  const [customerType, setCustomerType] = useState(() => sp?.get('customerType') || '');
  const [q, setQ] = useState(() => sp?.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);
  // السيارة تأتي من رابطٍ خارجي (صفّ في تحليل السيارة، أو بطاقة في التحليلات).
  // حالةٌ لا قراءةٌ من الرابط: الرابطُ صار يُكتب بـ`replaceState` (بلا تنقّل)،
  // و`useSearchParams` لا تسمع ذلك — فتبقى القيمةُ مجمّدةً على ما كانت عند
  // الفتح، ولا يزول الفلترُ ولو ضُغطت «إزالة».
  const [vehicle, setVehicle] = useState(() => sp?.get('vehicle') || '');

  const params = useMemo(() => {
    const p: Record<string, string> = { ...periodParams(period) };
    if (supervisor) p.supervisor = supervisor;
    if (customer) p.customer = customer;
    if (status) p.status = status;
    if (customerType) p.customerType = customerType;
    if (vehicle) p.vehicle = vehicle;
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    return p;
  }, [period, supervisor, customer, status, customerType, vehicle, debouncedQ]);

  /** إزالةُ الفلاتر: تصفيرُ الحالة، لا تنقّلٌ إلى مسارٍ عارٍ. */
  const clearFilters = useCallback(() => {
    setSupervisor(''); setCustomer(''); setStatus(''); setCustomerType(''); setQ(''); setVehicle('');
  }, []);

  const load = useCallback(async () => {
    try {
      setD(await api.get<FleetLoadsAnalysis>(`/api/fleet/loads-analysis?${new URLSearchParams(params)}`));
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [params]);

  // لا جلبَ والتبويبُ مخفيّ — ونداءُ هذه الشاشة يمسح آلافَ الحمولات.
  useEffect(() => { if (active) load(); }, [load, active]);
  useSocket('fleet:updated', useCallback(() => { if (active) load(); }, [load, active]));
  useEffect(() => {
    api.get<{ customers: FleetCustomer[] }>('/api/fleet/customers').then((r) => setCustomers(r.customers || [])).catch(() => {});
    api.get<{ users: { _id: string; firstName: string; lastName: string }[] }>('/api/fleet/supervisors')
      .then((r) => setSupers((r.users || []).map((u) => ({ _id: u._id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() })))).catch(() => {});
  }, []);

  // ── الرابطُ يُكتب ولا يُنتقَل إليه ────────────────────────────────────────
  // كان هذا السطرُ `router.replace('/system/fleet/loads-analysis?…')`. وحين
  // صارت الشاشةُ تبويبًا داخل صفحة التحليلات انقلب إلى حلقةٍ لا تنتهي:
  // يستبدل الرابطَ بالمسار القديم، والمسارُ القديم يحوّل إلى التبويب، فيُركَّب
  // المكوّنُ من جديد فيستبدل الرابطَ… حتى يقف المتصفّح.
  //
  // وحتى قبل الدمج كان خطأً: `router.replace` تنقّلٌ كامل يعيد تركيب الشجرة
  // مع **كلّ ضغطةِ فلتر**. والمقصودُ أن يعكس الرابطُ ما على الشاشة فحسب —
  // وذلك `history.replaceState`: لا تنقّل، ولا إعادةَ تركيب، ولا حلقة.
  useEffect(() => {
    if (!active) return;
    const q = new URLSearchParams(params);
    q.set('tab', 'loads');
    syncUrl('/system/fleet/dashboard', q);
  }, [params, active]);

  const loadCols = [
    { header: 'Waybill', key: 'waybillNumber', width: 10 },
    { header: 'Load date', key: 'loadDate', transform: (v: any, r: any) => fmtD(v || r.createdAt), width: 13 },
    { header: 'Customer', key: 'customerName', width: 24 },
    { header: 'Customer type', key: 'customerType', transform: (v: any) => (v === 'heavy' ? 'Heavy' : v === 'branch' ? 'Branch' : ''), width: 13 },
    { header: 'Supervisor', key: 'supervisorName', width: 18 },
    { header: 'Plate', key: 'vehiclePlate', width: 13 },
    { header: 'Driver', key: 'driverName', width: 18 },
    { header: 'Second driver', key: 'secondDriverName', width: 18 },
    { header: 'From', key: 'fromCity', width: 13 },
    { header: 'To', key: 'toCity', width: 13 },
    { header: 'Load type', key: 'loadType', width: 15 },
    { header: 'Branch', key: 'branch', width: 13 },
    { header: 'Vehicle rent', key: 'price', width: 13 },
    { header: 'Full rent', key: 'fullRent', width: 13 },
    { header: 'Driver expense', key: 'driverExpense', width: 14 },
    { header: 'Friday bonus', key: 'fridayBonus', transform: (v: any) => (v ? 'Yes' : ''), width: 12 },
    { header: 'Status', key: 'status', transform: (v: any) => fleetStatusLabel(v, 'en'), width: 14 },
  ];
  const groupCols = (nameHeader: string, nameKey: string) => [
    { header: nameHeader, key: nameKey, width: 26 },
    { header: 'Loads', key: 'loads', width: 10 },
    { header: 'Income', key: 'income', width: 14 },
    { header: 'Driver expense', key: 'driverExpense', width: 14 },
  ];
  const sheets: ExportSheet[] = d ? [
    { name: ar ? 'الحمولات' : 'Loads', rows: d.shipments as any[], columns: loadCols },
    { name: ar ? 'مصروف السائقين' : 'Driver expenses', rows: d.byDriver as any[], columns: groupCols('Driver', 'name') },
    { name: ar ? 'حسب المشرف' : 'By supervisor', rows: d.bySupervisor as any[], columns: groupCols('Supervisor', 'name') },
    { name: ar ? 'حسب العميل' : 'By customer', rows: d.byCustomer as any[], columns: groupCols('Customer', 'name') },
    { name: ar ? 'حسب السيارة' : 'By vehicle', rows: d.byVehicle as any[], columns: groupCols('Plate', 'plate') },
    { name: ar ? 'حسب اليوم' : 'By day', rows: d.byDay as any[], columns: [
      { header: 'Day', key: 'day', width: 14 }, { header: 'Loads', key: 'loads', width: 10 },
      { header: 'Income', key: 'income', width: 14 }, { header: 'Driver expense', key: 'driverExpense', width: 14 } ] },
  ] : [];

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading && !d) return <Spinner />;

  const th = 'text-start font-semibold px-3 py-3 whitespace-nowrap';
  const cardCls = 'bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm';

  const groupTable = (title: string, nameHead: string, rows: { _id?: string | null; name?: string; plate?: string; loads: number; income: number; driverExpense: number }[], href?: (r: any) => string | null) => (
    <div className={cardCls}>
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100"><p className="font-bold text-slate-900 text-sm">{title}</p></div>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="table-head sticky top-0">
            <tr>{[nameHead, ar ? 'الحمولات' : 'Loads', ar ? 'الدخل' : 'Income', ar ? 'المصروف' : 'Expense'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">—</td></tr>}
            {rows.map((r, i) => {
              const to = href ? href(r) : null;
              const label = r.name || r.plate || '—';
              return (
                <tr key={r._id || i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">{to ? <Link href={to} className="text-[#f37121] hover:underline">{label}</Link> : label}</td>
                  <td className="px-3 py-2 tabular-nums">{r.loads}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700">{money(r.income)}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-amber-700">{money(r.driverExpense)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<PackageSearch className="w-5 h-5" />}
        title={ar ? 'تحليل الحمولات' : 'Loads analysis'}
        subtitle={ar
          ? 'كل حمولة بمصروفها ومشرفها وعميلها — لصرف مصروف السائقين ولمعرفة ماذا جرى في أي يوم'
          : 'Every load with its expense, supervisor and customer'}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-loads-analysis"
          options={[
            { key: 'view', label: ar ? 'حسب الفلتر الحالي (كل الأوراق)' : 'Current filter (all sheets)', sheets },
            { key: 'loads', label: ar ? 'جدول الحمولات فقط' : 'Loads table only', sheets: sheets.slice(0, 1) },
            { key: 'expenses', label: ar ? 'كشف مصروف السائقين' : 'Driver expense sheet', sheets: sheets.slice(1, 2) },
          ]} />
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[220px]">
            <SearchInput value={q} onChange={setQ} placeholder={ar ? 'بحث ببوليصة أو عميل أو سائق أو لوحة…' : 'waybill / customer / driver / plate…'} />
          </div>
          <div className="w-48 grow sm:grow-0">
            <Select value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
              <option value="">{ar ? 'كل المشرفين' : 'All supervisors'}</option>
              {supers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="w-52 grow sm:grow-0">
            <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">{ar ? 'كل العملاء' : 'All customers'}</option>
              {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="w-40 grow sm:grow-0">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
              {FLEET_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
            </Select>
          </div>
          <div className="w-40 grow sm:grow-0">
            <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
              <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
              <option value="heavy">{ar ? 'نقل ثقيل' : 'Heavy'}</option>
              <option value="branch">{ar ? 'فروع' : 'Branch'}</option>
            </Select>
          </div>
        </div>
        {vehicle && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-[#f37121]/10 text-[#f37121] font-semibold">
              {ar ? 'محصور بسيارة واحدة' : 'Filtered to one vehicle'}
            </span>
            <Link href={`/system/fleet/vehicles/${vehicle}`} className="text-[#f37121] hover:underline">{ar ? 'افتح تحليل السيارة' : 'Open vehicle analysis'}</Link>
            <button type="button" onClick={clearFilters} className="text-slate-500 hover:text-slate-900">{ar ? 'إزالة' : 'Remove'}</button>
          </div>
        )}
      </div>

      <PeriodBanner period={d?.period} lang={ar ? 'ar' : 'en'} count={d?.totals.loads} />

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label={ar ? 'عدد الحمولات' : 'Loads'} value={d.totals.loads} accent="text-[#f37121]" />
            <StatCard label={ar ? 'إجمالي الدخل' : 'Total income'} value={money(d.totals.income)} accent="text-emerald-600" />
            <StatCard label={ar ? 'إجمالي مصروف السائقين' : 'Total driver expense'} value={money(d.totals.driverExpense)} accent="text-amber-600" />
            <StatCard label={ar ? 'الصافي بعد المصروف' : 'Net after expense'} value={money(d.totals.net)} accent="text-slate-900" />
            <StatCard label={ar ? 'متوسط دخل الحمولة' : 'Avg income / load'} value={money(d.totals.avgIncome)} />
            <StatCard label={ar ? 'متوسط مصروف الحمولة' : 'Avg expense / load'} value={money(d.totals.avgExpense)} />
          </div>

          {d.byDay.length > 1 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-slate-900 mb-3 text-sm">{ar ? 'الحمولات والمصروف يومًا بيوم' : 'Loads and expense per day'}</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                  <Bar yAxisId="l" dataKey="income" name={ar ? 'الدخل' : 'Income'} fill={ORANGE} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="l" dataKey="driverExpense" name={ar ? 'مصروف السائقين' : 'Driver expense'} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="r" dataKey="loads" name={ar ? 'عدد الحمولات' : 'Loads'} fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* كشف صرف السائقين — الرقم الذي يُسلَّم باليد، فله صدارة الشاشة. */}
          <div className={cardCls}>
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-700" />
              <p className="font-bold text-amber-900">{ar ? 'مصروف السائقين — ما يُسلَّم لكل سائق عن هذه الفترة' : 'Driver expenses — what each driver is owed'}</p>
              <span className="ms-auto text-sm font-bold text-amber-900 tabular-nums">{money(d.totals.driverExpense)}</span>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="table-head sticky top-0">
                  <tr>{[ar ? 'السائق' : 'Driver', ar ? 'عدد الحمولات' : 'Loads', ar ? 'الدخل المُحقَّق' : 'Income', ar ? 'المصروف المستحق' : 'Expense owed'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.byDriver.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا حمولات في هذه الفترة' : 'No loads in this period'}</td></tr>}
                  {d.byDriver.map((r, i) => (
                    <tr key={r._id || i} className="hover:bg-amber-50/40">
                      <td className="px-3 py-2 font-semibold text-slate-900">{r.name}</td>
                      <td className="px-3 py-2 tabular-nums">{r.loads}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-700">{money(r.income)}</td>
                      <td className="px-3 py-2 tabular-nums font-bold text-amber-700">{money(r.driverExpense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {groupTable(ar ? 'حسب المشرف' : 'By supervisor', ar ? 'المشرف' : 'Supervisor', d.bySupervisor)}
            {groupTable(ar ? 'حسب العميل' : 'By customer', ar ? 'العميل' : 'Customer', d.byCustomer, (r) => (r._id ? `/system/fleet/customers/${r._id}` : null))}
            {groupTable(ar ? 'حسب السيارة' : 'By vehicle', ar ? 'اللوحة' : 'Plate', d.byVehicle, (r) => (r._id ? `/system/fleet/vehicles/${r._id}` : null))}
          </div>

          <div className={cardCls}>
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#f37121]" />
              <p className="font-bold text-slate-900">{ar ? 'تفاصيل كل حمولة' : 'Every load'}</p>
              <span className="text-xs text-slate-500">({d.shown}{d.truncated ? ` / ${d.totals.loads}` : ''})</span>
              {d.truncated && (
                <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  {ar ? 'المعروض مقتطع — المجاميع أعلاه محسوبة على الحمولات كلها' : 'Rows truncated — totals above cover all loads'}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
                  {[ar ? 'البوليصة' : 'Waybill', ar ? 'التاريخ' : 'Date', ar ? 'العميل' : 'Customer', ar ? 'المشرف' : 'Supervisor',
                    ar ? 'اللوحة' : 'Plate', ar ? 'السائق' : 'Driver', ar ? 'من' : 'From', ar ? 'إلى' : 'To', ar ? 'نوع الحمولة' : 'Load type',
                    ar ? 'الإيجار' : 'Rent', ar ? 'مصروف السائق' : 'Driver expense', ar ? 'الحالة' : 'Status',
                  ].map((h, i) => <th key={i} className={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.shipments.length === 0 && <tr><td colSpan={12} className="text-center text-slate-500 py-14">{ar ? 'لا توجد حمولات ضمن هذه الفلاتر.' : 'No loads for these filters.'}</td></tr>}
                  {d.shipments.map((s) => {
                    const st = fleetStatus(s.status);
                    const vid = shipmentVehicleId(s);
                    const cid = shipmentCustomerId(s);
                    return (
                      <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/fleet/${s._id}`)}>
                        <td className="px-3 py-3 font-mono font-bold text-slate-900">{s.waybillNumber}</td>
                        <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtD(s.loadDate || s.createdAt)}</td>
                        <td className="px-3 py-3 text-xs max-w-[180px] truncate" onClick={(e) => e.stopPropagation()}>
                          {cid ? <Link href={`/system/fleet/customers/${cid}`} className="text-[#f37121] hover:underline">{s.customerName || '—'}</Link> : (s.customerName || '—')}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600 max-w-[130px] truncate">{s.supervisorName || '—'}</td>
                        <td className="px-3 py-3 text-xs" onClick={(e) => e.stopPropagation()}>
                          {vid ? <Link href={`/system/fleet/vehicles/${vid}`} className="font-mono font-semibold text-[#f37121] hover:underline">{s.vehiclePlate || '—'}</Link> : <span className="font-mono">{s.vehiclePlate || '—'}</span>}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700 max-w-[150px] truncate">{[s.driverName, s.secondDriverName].filter(Boolean).join(' + ') || '—'}</td>
                        <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap">{s.fromCity || '—'}</td>
                        <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap">{s.toCity || '—'}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{lkp('fleet_load_type', s.loadType) || '—'}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                          {money(s.price)}{s.fullRent ? <span className="text-slate-400 font-normal"> / {money(s.fullRent)}</span> : null}
                        </td>
                        <td className="px-3 py-3 text-xs font-bold text-amber-700 tabular-nums">
                          {money(s.driverExpense)}
                          {s.fridayBonus && <span className="ms-1 text-[10px] text-amber-600">{ar ? '+جمعة' : '+Fri'}</span>}
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">
                          <span className={`rounded-full px-2 py-1 font-medium ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}>{fleetStatusLabel(s.status, lang as Lang)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
