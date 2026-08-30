'use client';
// لوحة تحليلات إدارة الأسطول — الدخل، تحقيق الأهداف لكل سيارة، ترتيب السواقين
// والعملاء والمشرفين، الترند الشهري وتوزيع الحمولات — بفلاتر متعددة وتصدير Excel.
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
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
import { canViewFleet, FLEET_STATUSES, TRAILER_TYPES } from '@/lib/fleet';
import { BarChart3, TrendingUp, RotateCcw, Search, Star, CalendarClock, PackageSearch } from 'lucide-react';
import LoadsAnalysis from '@/components/fleet/LoadsAnalysis';
import { syncUrl } from '@/lib/urlSync';

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
};

const ORANGE = '#f37121';
const PALETTE = ['#f37121', '#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#64748b'];
const money = (n: number) => (Number(n) || 0).toLocaleString('en-US');
/** يوم/شهر بأرقامٍ لاتينيّة — الجدولُ يُقارَن رأسيًّا فتلزم محاذاةٌ ثابتة. */
const dmy = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

function FleetAnalyticsInner({ active = true }: { active?: boolean }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();

  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [supers, setSupers] = useState<{ _id: string; name: string }[]>([]);

  // ── الفلاتر — كلّها في عنوان الصفحة كي يُشارَك التحليل برابطٍ واحد ──
  const multi = (k: string) => (sp?.get(k) ? sp!.get(k)!.split(',').filter(Boolean) : []);
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  const [customerType, setCustomerType] = useState<string[]>(() => multi('customerType'));
  const [trailerType, setTrailerType] = useState<string[]>(() => multi('trailerType'));
  const [status, setStatus] = useState<string[]>(() => multi('status'));
  const [supervisor, setSupervisor] = useState<string[]>(() => multi('supervisor'));
  const [vehicle] = useState<string[]>(() => multi('vehicle'));
  const [q, setQ] = useState(() => sp?.get('q') || '');
  const [vehSort, setVehSort] = useState<'income' | 'trips' | 'achievedPct'>('income');
  // «وريني اللي مش محقّقة» — السؤالُ الذي يلي البطاقةَ مباشرةً، وكان بلا جواب.
  const [targetFilter, setTargetFilter] = useState<'all' | 'achieved' | 'below'>('all');
  const [custTab, setCustTab] = useState<'all' | 'heavy' | 'branch'>('all');

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const query = useMemo(() => {
    const p = new URLSearchParams(periodParams(period));
    if (customerType.length) p.set('customerType', customerType.join(','));
    if (trailerType.length) p.set('trailerType', trailerType.join(','));
    if (status.length) p.set('status', status.join(','));
    if (supervisor.length) p.set('supervisor', supervisor.join(','));
    if (vehicle.length) p.set('vehicle', vehicle.join(','));
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [period, customerType, trailerType, status, supervisor, vehicle, q]);

  const load = useCallback(async () => {
    try { setData(await api.get<Analytics>(`/api/fleet/analytics?${query}`)); } catch { /* keep last */ }
    setLoading(false);
  }, [query]);

  // لا يُجلَب شيءٌ والتبويبُ مخفيّ: التبويبان يبقيان مركَّبَين كي تُحفظ فلاترُ
  // كلٍّ منهما، لكنّ المخفيّ لا يُناديـ الخادمَ عند كلّ تغيير.
  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, active]);
  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<{ users: { _id: string; firstName: string; lastName: string }[] }>('/api/fleet/supervisors').catch(() => ({ users: [] }));
        setSupers((s.users || []).map((u) => ({ _id: u._id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() })));
      } catch { /* noop */ }
    })();
  }, []);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  // الرابطُ يُكتب ولا يُنتقَل إليه: `router.replace` تنقّلٌ كامل يعيد تركيب
  // الشجرة مع كلّ ضغطةِ فلتر — بطيءٌ وحدَه، وحلقةٌ لا تنتهي حين تصير الشاشةُ
  // تبويبًا. و`history.replaceState` تكتب الرابطَ ولا تفعل شيئًا سواه.
  useEffect(() => {
    if (!active) return;
    const q = new URLSearchParams(query);
    q.set('tab', 'overview');
    syncUrl('/system/fleet/dashboard', q);
  }, [query, active]);

  const reset = () => { setPeriod(EMPTY_PERIOD); setCustomerType([]); setTrailerType([]); setStatus([]); setSupervisor([]); setQ(''); };

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

      {/* ── شريط الفلاتر ── */}
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
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-400 self-center me-1">{ar ? 'نوع العميل:' : 'Customer:'}</span>
          <button type="button" onClick={() => toggle(customerType, setCustomerType, 'heavy')} className={chip(customerType.includes('heavy'))}>{ar ? 'نقل ثقيل' : 'Heavy'}</button>
          <button type="button" onClick={() => toggle(customerType, setCustomerType, 'branch')} className={chip(customerType.includes('branch'))}>{ar ? 'فروع' : 'Branch'}</button>
          <span className="text-[11px] text-slate-400 self-center mx-1">{ar ? 'التيدر:' : 'Trailer:'}</span>
          {TRAILER_TYPES.map((t) => <button key={t} type="button" onClick={() => toggle(trailerType, setTrailerType, t)} className={chip(trailerType.includes(t))}>{t}</button>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-400 self-center me-1">{ar ? 'الحالة:' : 'Status:'}</span>
          {FLEET_STATUSES.map((s) => <button key={s.key} type="button" onClick={() => toggle(status, setStatus, s.key)} className={chip(status.includes(s.key))}>{ar ? s.ar : s.en}</button>)}
        </div>
        {supers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-slate-400 self-center me-1">{ar ? 'المشرف:' : 'Supervisor:'}</span>
            {supers.map((s) => <button key={s._id} type="button" onClick={() => toggle(supervisor, setSupervisor, s._id)} className={chip(supervisor.includes(s._id))}>{s.name}</button>)}
          </div>
        )}
      </div>

      {/* شريط الفترة: الرقم الذي على الشاشة يخصّ هذا المدى وحده. غيابه هو ما
          جعل بحثًا عن سيارةٍ خارج الشهر الحالي يبدو «كل حاجة صفر» بلا تفسير. */}
      <PeriodBanner period={data?.period} lang={ar ? 'ar' : 'en'} count={data?.totals.tripCount} />

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <StatCard label={ar ? 'إجمالي إيجار السيارات' : 'Total vehicle rent'} value={money(data.totals.totalIncome)} accent="text-emerald-600" />
            <StatCard label={ar ? 'حصة قسم الفروع' : 'Branches’ share'} value={money(data.totals.branchShare)} accent="text-amber-600" />
            <StatCard label={ar ? 'عدد الرحلات' : 'Trips'} value={data.totals.tripCount} accent="text-[#f37121]" />
            <StatCard label={ar ? 'متوسط دخل الرحلة' : 'Avg / trip'} value={money(data.totals.avgTripIncome)} />
            {/* ── البطاقةُ سؤالٌ، فلتكن جوابًا ────────────────────────────────
                «سبعُ سيّاراتٍ دون الهدف» رقمٌ يليه سؤالٌ واحد: أيُّها؟ وكانت
                البطاقةُ تقف عند الرقم. صارت تُضغط فيُصفَّى الجدولُ عليها. */}
            <button type="button" onClick={() => setTargetFilter((f) => (f === 'achieved' ? 'all' : 'achieved'))}
              className={`text-start rounded-xl transition-shadow ${targetFilter === 'achieved' ? 'ring-2 ring-emerald-500' : 'hover:shadow-md'}`}>
              <StatCard label={ar ? 'سيارات محقّقة الهدف' : 'On target'} value={`${data.totals.vehiclesAchieved} / ${data.totals.vehicleCount}`} accent="text-emerald-600" />
            </button>
            <button type="button" onClick={() => setTargetFilter((f) => (f === 'below' ? 'all' : 'below'))}
              className={`text-start rounded-xl transition-shadow ${targetFilter === 'below' ? 'ring-2 ring-red-500' : 'hover:shadow-md'}`}>
              <StatCard label={ar ? 'سيارات دون الهدف' : 'Below target'} value={data.totals.vehiclesBelow} accent="text-red-600" />
            </button>
            <StatCard label={ar ? 'مصروف السائقين' : 'Driver expense'} value={money(data.totals.totalDriverExpense || 0)} accent="text-amber-600" />
          </div>

          {/* روابط الشاشات الشقيقة — التحليل يبدأ هنا وينتهي عند تفصيلةٍ هناك. */}
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
                <p className="font-bold text-slate-900">{ar ? 'أداء السيارات مقابل الهدف' : 'Vehicles vs target'}</p>
                {/* المقياسُ يُقال مع الرقم: بغيره يُقرأ الرقمُ على غير وجهه. */}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>{[ar ? 'اللوحة' : 'Plate', ar ? 'التيدر' : 'Trailer', ar ? 'المشرف' : 'Supervisor', ar ? 'الحمولات' : 'Loads', ar ? 'شغّالة من' : 'Active from', ar ? 'المحقَّق' : 'Achieved', ar ? 'الهدف' : 'Target', ar ? 'الناقص' : 'Shortfall', ar ? 'التحقيق' : 'Attained'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedVehicles.map((v) => (
                    <tr key={v._id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold">
                        <Link href={`/system/fleet/vehicles/${v._id}${query ? `?${query}` : ''}`} className="text-[#f37121] hover:underline">{v.plate}</Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{v.trailerType || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{v.supervisorName || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{v.trips}</td>
                      {/* «شغّالة من إمتى لإمتى» — أوّلُ حمولةٍ وآخرُها في الفترة. */}
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
                  ))}
                  {sortedVehicles.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا توجد بيانات لهذه الفلاتر' : 'No data'}</td></tr>}
                </tbody>
              </table>
            </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * صفحةُ تحليلات الأسطول — تبويبان لا صفحتان.
 *
 * كانتا شاشتين منفصلتين تجيبان سؤالين متجاورين: «كم دخلَ الأسطول ومن حقّق
 * هدفه؟» و«ماذا حملت كلُّ سيّارة وكم يُصرف لسائقها؟». والفصلُ بينهما جعل
 * المستخدمَ يقف أمام اسمين متشابهين لا يدري أيَّهما يفتح، ويقفز بينهما
 * ليقارن رقمًا برقم.
 *
 * فصارتا تبويبين تحت فلترِ فترةٍ واحد، والتبويبُ في الرابط فيُرسَل ويُحفظ.
 */
function FleetAnalyticsTabs() {
  const sp = useSearchParams();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'overview' | 'loads'>(sp?.get('tab') === 'loads' ? 'loads' : 'overview');
  // التبويبُ الثاني لا يُركَّب قبل أن يُطلَب: نداؤه يمسح آلافَ الحمولات، وتحميلُه
  // مع فتح الصفحة يُبطئ ما لم يُطلَب بعد. ومتى رُكِّب بقي مركَّبًا.
  const [mountedLoads, setMountedLoads] = useState(sp?.get('tab') === 'loads');

  const pick = (t: 'overview' | 'loads') => {
    if (t === tab) return;
    if (t === 'loads') setMountedLoads(true);
    setTab(t);
    // الرابطُ يُكتب فقط. أمّا `router.replace` فتنقّلٌ كامل، وكانت هي التي
    // أوقعت الصفحةَ في حلقةٍ لا تنتهي حين صارت الشاشتان تبويبين.
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
      {/* ── التبويبان ────────────────────────────────────────────────────────
          زرّان متجاوران يفصل بينهما شريطٌ برتقاليٌّ تحت المختار — لا حدودَ
          مزدوجةٌ ولا ظلال. ولكلٍّ سطرُ وصفٍ تحته: الاسمان متقاربان («تحليلات»
          و«حمولات») ومن غير وصفٍ يبقى الاختيارُ تخمينًا كما كان حين كانتا
          صفحتين. ويختفي الوصفُ على الجوّال حيث لا يتّسع. */}
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

      {/* كلا التبويبين يبقى مركَّبًا لكنّ غيرَ المعروض يُخفى: العودةُ إليه لا
          تُعيد الجلبَ من الخادم، والفلاترُ التي ضُبطت فيه تبقى كما تُركت. */}
      <div className={tab === 'overview' ? '' : 'hidden'}><FleetAnalyticsInner active={tab === 'overview'} /></div>
      {mountedLoads && <div className={tab === 'loads' ? '' : 'hidden'}><LoadsAnalysis active={tab === 'loads'} /></div>}
    </div>
  );
}

export default function FleetAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><FleetAnalyticsTabs /></Suspense>;
}
