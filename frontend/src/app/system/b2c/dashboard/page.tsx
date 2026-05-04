'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Target, TrendingUp, TrendingDown, Award, CalendarDays,
  Users as UsersIcon, RefreshCw, Filter, X, ArrowUp, ArrowDown, Minus, AlertCircle,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import B2CRepProfileModal from '@/components/system/B2CRepProfileModal';

interface Project { _id: string; name: string; color?: string }
interface Branch { _id: string; name: string; city?: string }
interface Rep { _id: string; englishName: string; arabicName?: string; repId?: string; project?: Project; branch?: Branch }

interface KPI {
  totalOrders: number;
  totalWorkingDays: number;
  avgDailyRate: number;
  repsActive: number;
  aboveTargetReps: number;
  onTrackReps: number;
  belowTargetReps: number;
  avgPerformance: number;
  bestRep: any;
  worstRep: any;
  bestDay: any;
  teamCapacity: number;
  capacityUsedPercent: number;
}

interface RepStat {
  repId: string;
  englishName: string;
  arabicName?: string;
  monthlyTarget: number;
  totalOrders: number;
  workingDays: number;
  dailyRate: number;
  performancePercent: number;
  project?: string;
}

interface Dashboard {
  kpis: KPI;
  byMonth: Array<{ key: string; year: number; month: number; totalOrders: number; workingDays: number; repsActive: number; avgDailyRate: number }>;
  byProject: Array<{ projectId: string; name: string; color?: string; totalOrders: number; repsActive: number }>;
  byBranch: Array<{ branchId: string; name: string; city?: string; totalOrders: number; repsActive: number }>;
  byRep: RepStat[];
  byDay: Array<{ dateKey: string; totalOrders: number; repsActive: number; worked: number; targetSum?: number; achievementPercent?: number; repsAboveTarget?: number; repsNotWorked?: number }>;
  monthsAvailable: Array<{ year: number; month: number; entries: number }>;
  topReps: RepStat[];
  bottomReps: RepStat[];
}

const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const performanceColor = (pct: number) => {
  if (pct >= 100) return '#10b981'; // green
  if (pct >= 80) return '#f59e0b';  // amber
  return '#ef4444';                 // red
};
const perfBucket = (pct: number) => {
  if (pct >= 120) return 'excellent';
  if (pct >= 100) return 'good';
  if (pct >= 80) return 'acceptable';
  return 'poor';
};

export default function B2CDashboard() {
  const { lang } = useLanguage();
  const T = getB2CTranslations(lang);
  const monthNames = lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN;

  // Filters — default to "all data" so users see everything immediately after upload.
  // The latest-month auto-selection happens after data loads (see effect below).
  const [year, setYear] = useState<number | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [project, setProject] = useState('');
  const [branch, setBranch] = useState('');
  const [rep, setRep] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Sticky list of all months that exist in the DB. Fetched ONCE on mount via the
  // lightweight /months endpoint; doesn't refetch on every filter change.
  const [allMonths, setAllMonths] = useState<Array<{ year: number; month: number }>>([]);
  // Tracks whether the months endpoint has returned (success or empty) — used
  // to gate the auto-pick effect so we don't initialize before the data lands.
  const [monthsFetched, setMonthsFetched] = useState(false);
  const [monthPickerInitialized, setMonthPickerInitialized] = useState(false);

  // In-memory cache so flipping back to a month already viewed is instant.
  // Key = current filter signature. Stale-while-revalidate: show cached data
  // immediately and refetch in the background.
  const dashCacheRef = useRef<Map<string, Dashboard>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  // Token to discard stale responses — the user can flip months faster than the
  // network can return; without this, an old Overview response can land AFTER
  // a newer May response and overwrite the state.
  const dashReqIdRef = useRef(0);

  // Drilldowns — the modal fetches its own data based on the rep id
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'evaluation' | 'analytics'>('overview');

  const fetchOptions = useCallback(async () => {
    try {
      const [pData, bData, rData] = await Promise.all([
        api.get<any>('/api/b2c/projects'),
        api.get<any>('/api/branches?active=true'),
        api.get<any>('/api/b2c/reps'),
      ]);
      setProjects(pData.projects || []);
      setBranches(bData.branches || []);
      setReps(rData.reps || []);
    } catch {}
  }, []);

  const fetchDashboard = useCallback(async () => {
    const reqId = ++dashReqIdRef.current;
    const params = new URLSearchParams();
    if (year) params.set('year', String(year));
    if (month) params.set('month', String(month));
    if (project) params.set('project', project);
    if (branch) params.set('branch', branch);
    if (rep) params.set('rep', rep);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const cacheKey = params.toString();

    // Stale-while-revalidate: if we have cached data for this filter, show it instantly
    // and refetch in background. New filters fall back to a normal load.
    const cached = dashCacheRef.current.get(cacheKey);
    if (cached) {
      setDashboard(cached);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await api.get<Dashboard>(`/api/b2c/dashboard?${cacheKey}`);
      // Discard stale responses — only the latest in-flight request wins.
      // Without this, switching months fast can leave the dashboard showing the wrong scope.
      if (reqId !== dashReqIdRef.current) return;
      dashCacheRef.current.set(cacheKey, data);
      // Cap cache size to last 8 entries
      if (dashCacheRef.current.size > 8) {
        const firstKey = dashCacheRef.current.keys().next().value;
        if (firstKey !== undefined) dashCacheRef.current.delete(firstKey);
      }
      setDashboard(data);
    } catch {} finally {
      if (reqId === dashReqIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [year, month, project, branch, rep, dateFrom, dateTo]);

  // Fetch the month picker list ONCE on mount (or when project/branch scope changes).
  // Independent of the year/month filter so the picker stays stable.
  const fetchMonths = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (branch) params.set('branch', branch);
      const data = await api.get<{ months: Array<{ year: number; month: number }> }>(`/api/b2c/months?${params.toString()}`);
      setAllMonths(data.months || []);
    } catch {} finally {
      setMonthsFetched(true);
    }
  }, [project, branch]);

  const fetchEvaluations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (branch) params.set('branch', branch);
      const data = await api.get<any>(`/api/b2c/evaluations?${params.toString()}`);
      setEvaluations(data.evaluations || []);
    } catch {}
  }, [project, branch]);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);
  useEffect(() => { fetchMonths(); }, [fetchMonths]);
  // Skip the first fetchDashboard call until the month picker decides whether to
  // auto-pick a month — otherwise a brief Overview request fires before auto-pick
  // sets the latest month, racing the proper month-filtered request.
  useEffect(() => {
    if (!monthPickerInitialized) return;
    fetchDashboard();
  }, [fetchDashboard, monthPickerInitialized]);
  useEffect(() => { if (activeTab === 'evaluation') fetchEvaluations(); }, [activeTab, fetchEvaluations]);

  // On first load only: auto-pick the latest month so the user lands in the current month.
  // Wait for the months fetch to actually return — if we initialized eagerly on the
  // first render (before months arrive), the dashboard would default to "Overview"
  // instead of the latest month. If months come back empty (new install / no data),
  // we still flip the flag so the dashboard fetch can run and the page exits loading.
  useEffect(() => {
    if (monthPickerInitialized) return;
    if (!monthsFetched) return;
    if (allMonths.length > 0 && !year && !month && !dateFrom && !dateTo) {
      const latest = allMonths[allMonths.length - 1];
      setYear(latest.year);
      setMonth(latest.month);
    }
    setMonthPickerInitialized(true);
  }, [allMonths, monthsFetched, monthPickerInitialized, year, month, dateFrom, dateTo]);

  // Live updates — clear caches so fresh data wins
  const invalidateAndRefetch = useCallback(() => {
    dashCacheRef.current.clear();
    fetchDashboard();
    fetchMonths();
  }, [fetchDashboard, fetchMonths]);
  useSocket('b2c:order:upserted', invalidateAndRefetch);
  useSocket('b2c:bulk:upserted', invalidateAndRefetch);
  useSocket('b2c:rep:created', () => { fetchOptions(); invalidateAndRefetch(); });
  useSocket('b2c:rep:deleted', () => { fetchOptions(); invalidateAndRefetch(); });
  useSocket('b2c:cleanup', invalidateAndRefetch);

  const openRepProfile = (id: string) => setSelectedRepId(id);

  const clearFilters = () => {
    setProject(''); setBranch(''); setRep(''); setDateFrom(''); setDateTo('');
    setYear(''); setMonth('');
  };

  const k = dashboard?.kpis;

  // Performance distribution buckets (from byRep)
  const perfDist = useMemo(() => {
    const buckets = { excellent: 0, good: 0, acceptable: 0, poor: 0 };
    (dashboard?.byRep || []).forEach((r) => {
      const b = perfBucket(r.performancePercent);
      buckets[b as keyof typeof buckets]++;
    });
    return [
      { name: T.excellent, value: buckets.excellent, color: '#10b981' },
      { name: T.good, value: buckets.good, color: '#22c55e' },
      { name: T.acceptable, value: buckets.acceptable, color: '#f59e0b' },
      { name: T.poor, value: buckets.poor, color: '#ef4444' },
    ];
  }, [dashboard?.byRep, T]);

  const monthLabel = (key: string) => {
    const [y, m] = key.split('-');
    return `${monthNames[Number(m) - 1]} ${y}`;
  };

  const formatPct = (v: number) => `${(v || 0).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#f37121]" />
            {T.dashboardTitle}
          </h1>
          <p className="text-gray-400 text-sm mt-1">{T.dashboardSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              showFilters ? 'bg-[#f37121] text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}>
            <Filter className="w-4 h-4" /> {T.filters}
          </button>
          <button type="button" onClick={fetchDashboard} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{lang === 'ar' ? 'السنة' : 'Year'}</label>
                <input type="number" value={year} onChange={(e) => setYear(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Year"
                  placeholder={lang === 'ar' ? 'كل السنوات' : 'All years'}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{lang === 'ar' ? 'الشهر' : 'Month'}</label>
                <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                  <option value="">{lang === 'ar' ? 'كل الشهور' : 'All months'}</option>
                  {monthNames.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.project}</label>
                <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                  <option value="">{T.allProjects}</option>
                  {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.branch}</label>
                <select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                  <option value="">{T.allBranches}</option>
                  {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.rep}</label>
                <select aria-label="Rep" value={rep} onChange={(e) => setRep(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                  <option value="">{T.allReps}</option>
                  {reps.map((r) => <option key={r._id} value={r._id}>{r.englishName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.dateFrom}</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Date from"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.dateTo}</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Date to"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>
              <div className="col-span-2 md:col-span-4 lg:col-span-7 flex justify-end">
                <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">
                  {T.clearFilters}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Month picker — primary time-period control. "Overview" = all months combined. */}
      {allMonths.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex items-center gap-2 overflow-x-auto">
          <button type="button"
            onClick={() => { setYear(''); setMonth(''); setDateFrom(''); setDateTo(''); }}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              !year && !month
                ? 'bg-[#f37121] text-white shadow-lg shadow-[#f37121]/20'
                : 'bg-gray-900 text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}>
            📊 {lang === 'ar' ? 'نظرة عامة' : 'Overview'}
          </button>
          <div className="w-px h-7 bg-gray-700 flex-shrink-0" />
          {allMonths.map((m) => {
            const isActive = year === m.year && month === m.month;
            return (
              <button key={`${m.year}-${m.month}`} type="button"
                onClick={() => { setYear(m.year); setMonth(m.month); setDateFrom(''); setDateTo(''); }}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#f37121] text-white shadow-lg shadow-[#f37121]/20'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}>
                {monthNames[m.month - 1]} {m.year}
              </button>
            );
          })}
        </div>
      )}

      {/* Section tabs (Overview / Evaluation / Analytics) — orthogonal to month filter */}
      <div className="flex items-center gap-1 border-b border-gray-700 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
        {[
          { id: 'overview', label: T.overview },
          { id: 'evaluation', label: T.evaluationTitle },
          { id: 'analytics', label: lang === 'ar' ? 'التحليلات' : 'Analytics' },
        ].map((t) => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'text-[#f37121] border-[#f37121]'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Subtle thin progress bar at top while refreshing — keeps stale data visible */}
      {refreshing && (
        <div className="fixed top-0 left-0 right-0 h-0.5 bg-[#f37121]/30 overflow-hidden z-50">
          <div className="h-full w-1/3 bg-[#f37121] animate-pulse" />
        </div>
      )}

      {loading && !dashboard ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !dashboard ? null : (dashboard.kpis.totalOrders === 0 && dashboard.kpis.repsActive === 0) ? (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center">
          <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <h3 className="text-white font-semibold text-lg mb-2">
            {lang === 'ar' ? 'لا توجد بيانات في النطاق المحدد' : 'No data in this scope'}
          </h3>
          <p className="text-gray-400 text-sm mb-4">
            {lang === 'ar'
              ? 'جرب تمسح الفلاتر، أو ارفع ملف Excel من صفحة "أداء المناديب"، أو ابدأ إدخال يومي.'
              : 'Try clearing filters, upload an Excel from "Reps Performance" page, or start a daily entry.'}
          </p>
          {(year || month || project || branch || rep || dateFrom || dateTo) && (
            <button type="button" onClick={clearFilters}
              className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium">
              {T.clearFilters}
            </button>
          )}
        </div>
      ) : activeTab === 'overview' ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title={T.totalOrders} value={k!.totalOrders.toLocaleString()} icon={<Target className="w-5 h-5" />} color="#f37121" />
            <KpiCard title={T.activeReps} value={k!.repsActive} icon={<UsersIcon className="w-5 h-5" />} color="#3b82f6" />
            <KpiCard title={T.workingDays} value={k!.totalWorkingDays} icon={<CalendarDays className="w-5 h-5" />} color="#8b5cf6" />
            <KpiCard title={T.avgDailyRate} value={k!.avgDailyRate.toFixed(1)} icon={<TrendingUp className="w-5 h-5" />} color="#10b981" />
            <KpiCard title={T.avgPerformance} value={`${k!.avgPerformance.toFixed(1)}%`} icon={<BarChart3 className="w-5 h-5" />} color={performanceColor(k!.avgPerformance)} />
            <KpiCard title={T.aboveTarget} value={k!.aboveTargetReps} icon={<ArrowUp className="w-5 h-5" />} color="#10b981" />
            <KpiCard title={T.onTrack} value={k!.onTrackReps} icon={<Minus className="w-5 h-5" />} color="#f59e0b" />
            <KpiCard title={T.belowTarget} value={k!.belowTargetReps} icon={<ArrowDown className="w-5 h-5" />} color="#ef4444" />
          </div>

          {/* Best/Worst/Capacity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HighlightCard
              title={T.bestRep}
              value={k!.bestRep?.englishName || '—'}
              subtitle={k!.bestRep ? `${k!.bestRep.totalOrders} ${T.totalOrders.toLowerCase()}` : ''}
              icon={<Award className="w-5 h-5" />}
              color="#10b981"
              onClick={() => k!.bestRep?.repId && openRepProfile(k!.bestRep.repId)}
            />
            <HighlightCard
              title={T.bestDay}
              value={k!.bestDay?.dateKey || '—'}
              subtitle={k!.bestDay ? `${k!.bestDay.totalOrders} ${T.totalOrders.toLowerCase()}` : ''}
              icon={<CalendarDays className="w-5 h-5" />}
              color="#3b82f6"
            />
            <HighlightCard
              title={T.capacityUsed}
              value={`${k!.capacityUsedPercent.toFixed(1)}%`}
              subtitle={`${k!.totalOrders.toLocaleString()} / ${k!.teamCapacity.toLocaleString()}`}
              icon={<BarChart3 className="w-5 h-5" />}
              color={performanceColor(k!.capacityUsedPercent)}
            />
          </div>

          {/* Daily cards — clickable, color-coded by target achievement.
              Reflects current month filter; in "Overview" they're grouped by month. */}
          <DailyCardsSection
            days={dashboard.byDay}
            lang={lang} T={T}
            onDayClick={setSelectedDate}
            activeMonthLabel={year && month ? `${monthNames[(month as number) - 1]} ${year}` : null}
          />

          {/* Charts row 1: by month + perf distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={T.byMonth}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dashboard.byMonth.map((m) => ({ ...m, label: `${monthNames[m.month - 1].slice(0, 3)} ${m.year}` }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="totalOrders" name={T.totalOrders} fill="#f37121" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="repsActive" name={T.activeReps} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={T.performanceDistribution}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={perfDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {perfDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Daily trend */}
          <ChartCard title={T.dailyTrend}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={dashboard.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateKey" stroke="#9ca3af" fontSize={10} />
                <YAxis stroke="#9ca3af" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                <Area type="monotone" dataKey="totalOrders" name={T.totalOrders} stroke="#f37121" fill="#f37121" fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* By project + branch */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={T.byProject}>
              {dashboard.byProject.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">{T.noData}</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dashboard.byProject} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                    <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={11} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="totalOrders" name={T.totalOrders} radius={[0, 4, 4, 0]}>
                      {dashboard.byProject.map((p, i) => <Cell key={i} fill={p.color || '#f37121'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title={T.byBranch}>
              {dashboard.byBranch.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">{T.noData}</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dashboard.byBranch} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                    <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={11} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="totalOrders" name={T.totalOrders} fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Top + Bottom reps */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={T.topReps}>
              {dashboard.topReps.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">{T.noData}</p>
              ) : (
                <div className="space-y-2">
                  {dashboard.topReps.map((r, i) => (
                    <button key={r.repId || i} type="button" onClick={() => r.repId && openRepProfile(r.repId)}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-900/50 hover:bg-gray-900 border border-gray-700 hover:border-[#f37121]/30 transition-all text-left">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                          i === 1 ? 'bg-gray-400/20 text-gray-300' :
                          i === 2 ? 'bg-orange-700/30 text-orange-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{r.englishName}</p>
                          {r.project && <p className="text-gray-500 text-xs truncate">{r.project}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-white text-sm font-bold">{r.totalOrders.toLocaleString()}</p>
                        <p className="text-xs" style={{ color: performanceColor(r.performancePercent) }}>{formatPct(r.performancePercent)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title={T.bottomReps}>
              {dashboard.bottomReps.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">{T.noData}</p>
              ) : (
                <div className="space-y-2">
                  {dashboard.bottomReps.map((r, i) => (
                    <button key={r.repId || i} type="button" onClick={() => r.repId && openRepProfile(r.repId)}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-900/50 hover:bg-gray-900 border border-gray-700 hover:border-red-500/30 transition-all text-left">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-7 h-7 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-xs font-bold">!</span>
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{r.englishName}</p>
                          {r.project && <p className="text-gray-500 text-xs truncate">{r.project}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-white text-sm font-bold">{r.totalOrders.toLocaleString()}</p>
                        <p className="text-xs" style={{ color: performanceColor(r.performancePercent) }}>{formatPct(r.performancePercent)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>

          {/* Full table */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-white font-semibold">{T.byRep}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-xs uppercase">
                    <th className="text-left py-2 px-3">#</th>
                    <th className="text-left py-2 px-3">{T.rep}</th>
                    <th className="text-left py-2 px-3">{T.project}</th>
                    <th className="text-center py-2 px-3">{T.totalOrders}</th>
                    <th className="text-center py-2 px-3">{T.workingDays}</th>
                    <th className="text-center py-2 px-3">{T.avgDailyRate}</th>
                    <th className="text-center py-2 px-3">{T.performance}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {dashboard.byRep.map((r, i) => (
                    <tr key={r.repId || i} onClick={() => r.repId && openRepProfile(r.repId)}
                      className="hover:bg-gray-700/30 cursor-pointer transition-colors">
                      <td className="py-2 px-3 text-gray-500 text-sm">{i + 1}</td>
                      <td className="py-2 px-3">
                        <div>
                          <p className="text-white font-medium text-sm">{r.englishName}</p>
                          {r.arabicName && <p className="text-gray-500 text-xs">{r.arabicName}</p>}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-gray-300 text-sm">{r.project || '—'}</td>
                      <td className="py-2 px-3 text-center text-white font-semibold">{r.totalOrders.toLocaleString()}</td>
                      <td className="py-2 px-3 text-center text-gray-300">{r.workingDays}</td>
                      <td className="py-2 px-3 text-center text-gray-300">{r.dailyRate.toFixed(1)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className="px-2 py-0.5 rounded text-xs font-bold"
                          style={{ backgroundColor: `${performanceColor(r.performancePercent)}20`, color: performanceColor(r.performancePercent) }}>
                          {formatPct(r.performancePercent)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {dashboard.byRep.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-500 text-sm">{T.noData}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : activeTab === 'evaluation' ? (
        <EvaluationsView evaluations={evaluations} T={T} lang={lang} onRepClick={openRepProfile} />
      ) : (
        <AnalyticsView dashboard={dashboard} T={T} lang={lang} monthLabel={monthLabel} />
      )}

      {/* Rep profile modal */}
      <AnimatePresence>
        {selectedRepId && (
          <B2CRepProfileModal
            repId={selectedRepId}
            onClose={() => setSelectedRepId(null)}
            lang={lang}
          />
        )}
      </AnimatePresence>

      {/* Day details modal */}
      <AnimatePresence>
        {selectedDate && (
          <DayDetailsModal
            date={selectedDate}
            project={project}
            branch={branch}
            onClose={() => setSelectedDate(null)}
            onRepClick={(id: string) => { setSelectedDate(null); setSelectedRepId(id); }}
            lang={lang}
            T={T}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function KpiCard({ title, value, icon, color }: { title: string; value: any; icon: React.ReactNode; color: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-gray-600 transition-all">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-gray-400 text-[11px] font-medium uppercase tracking-wide truncate">{title}</p>
          <p className="text-white text-xl font-bold mt-1">{value}</p>
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20`, color }}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

function HighlightCard({ title, value, subtitle, icon, color, onClick }: any) {
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper onClick={onClick} type={onClick ? 'button' : undefined}
      className={`bg-gray-800 border border-gray-700 rounded-xl p-4 text-left hover:border-gray-600 transition-all w-full ${onClick ? 'cursor-pointer' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: color }}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-gray-400 text-xs uppercase font-medium">{title}</p>
          <p className="text-white text-lg font-bold mt-1 truncate">{value}</p>
          {subtitle && <p className="text-gray-500 text-xs mt-1 truncate">{subtitle}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20`, color }}>
          {icon}
        </div>
      </div>
    </Wrapper>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <h3 className="text-white font-semibold mb-3 text-sm">{title}</h3>
      {children}
    </motion.div>
  );
}

function EvaluationsView({ evaluations, T, lang, onRepClick }: any) {
  const [grade, setGrade] = useState('');
  const filtered = grade ? evaluations.filter((e: any) => e.grade === grade) : evaluations;

  const gradeBuckets = useMemo(() => {
    const buckets: Record<string, number> = { 'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0 };
    evaluations.forEach((e: any) => { buckets[e.grade] = (buckets[e.grade] || 0) + 1; });
    return buckets;
  }, [evaluations]);

  const gradeColor = (g: string) => {
    if (g === 'A+' || g === 'A') return '#10b981';
    if (g === 'B') return '#3b82f6';
    if (g === 'C') return '#f59e0b';
    return '#ef4444';
  };

  const trendIcon = (t: string) => {
    if (t === 'rising') return <TrendingUp className="w-3.5 h-3.5 text-green-400" />;
    if (t === 'falling') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
    return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {Object.entries(gradeBuckets).map(([g, count]) => (
          <button key={g} type="button" onClick={() => setGrade(grade === g ? '' : g)}
            className={`p-3 rounded-xl border transition-all ${
              grade === g ? 'border-[#f37121] bg-[#f37121]/10' : 'border-gray-700 bg-gray-800 hover:border-gray-600'
            }`}>
            <p className="text-2xl font-bold" style={{ color: gradeColor(g) }}>{g}</p>
            <p className="text-gray-400 text-xs mt-1">{count} {lang === 'ar' ? 'مندوب' : 'reps'}</p>
          </button>
        ))}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-gray-900/50 text-gray-400 text-xs uppercase">
                <th className="text-left py-2 px-3">#</th>
                <th className="text-left py-2 px-3">{T.rep}</th>
                <th className="text-left py-2 px-3">{T.project}</th>
                <th className="text-center py-2 px-3">{T.grade}</th>
                <th className="text-center py-2 px-3">{T.totalOrders}</th>
                <th className="text-center py-2 px-3">{T.monthsActive}</th>
                <th className="text-center py-2 px-3">{T.avgPerformance}</th>
                <th className="text-center py-2 px-3">{T.consistency}</th>
                <th className="text-center py-2 px-3">{T.trend}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {filtered.map((e: any, i: number) => (
                <tr key={e.repId} onClick={() => onRepClick(e.repId)} className="hover:bg-gray-700/30 cursor-pointer transition-colors">
                  <td className="py-2 px-3 text-gray-500 text-sm">{i + 1}</td>
                  <td className="py-2 px-3">
                    <p className="text-white font-medium text-sm">{e.englishName}</p>
                    {e.arabicName && <p className="text-gray-500 text-xs">{e.arabicName}</p>}
                  </td>
                  <td className="py-2 px-3 text-gray-300 text-sm">{e.project || '—'}</td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 rounded text-xs font-bold"
                      style={{ backgroundColor: `${gradeColor(e.grade)}20`, color: gradeColor(e.grade) }}>
                      {e.grade}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center text-white font-semibold">{e.totalOrders.toLocaleString()}</td>
                  <td className="py-2 px-3 text-center text-gray-300">{e.monthsActive}</td>
                  <td className="py-2 px-3 text-center text-gray-300">{e.avgPerformance.toFixed(1)}%</td>
                  <td className="py-2 px-3 text-center text-gray-300">{e.consistency.toFixed(0)}%</td>
                  <td className="py-2 px-3 text-center">
                    <div className="flex items-center justify-center">{trendIcon(e.trend)}</div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-gray-500 text-sm">{T.noData}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalyticsView({ dashboard, T, lang }: any) {
  const byRep = dashboard.byRep || [];
  const topPerformers = [...byRep].sort((a: any, b: any) => b.performancePercent - a.performancePercent).slice(0, 5);
  const atRisk = byRep.filter((r: any) => r.performancePercent < 60);
  const teamCapacity = dashboard.kpis?.teamCapacity || 0;
  const teamUsed = dashboard.kpis?.totalOrders || 0;
  const monthsCount = dashboard.kpis?.monthsCount || 0;
  const aboveCount = dashboard.kpis?.aboveTargetReps || 0;
  const onTrackCount = dashboard.kpis?.onTrackReps || 0;
  const belowCount = dashboard.kpis?.belowTargetReps || 0;
  const atRiskCount = dashboard.kpis?.atRiskReps ?? atRisk.length;
  const totalReps = byRep.length;

  const topImprovers = dashboard.topImprovers || [];
  const topDecliners = dashboard.topDecliners || [];
  const mostConsistent = dashboard.mostConsistent || [];
  const bestSingleDays = dashboard.bestSingleDays || [];
  const topTeamDays = dashboard.topTeamDays || [];
  const byDayOfWeek = dashboard.byDayOfWeek || [];

  const dowLabels = lang === 'ar'
    ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      {/* Achievement vs Target — clearer than "Capacity Used" */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h3 className="text-white font-semibold text-sm">
              {lang === 'ar' ? 'تحقيق الهدف الإجمالي' : 'Total Target Achievement'}
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">
              {lang === 'ar'
                ? `الهدف = ${monthsCount} شهر × عدد المناديب النشطين × 400 طلب`
                : `Target = ${monthsCount} month(s) × active reps × 400 orders`}
            </p>
          </div>
          <span className={`text-2xl font-bold ${teamUsed >= teamCapacity ? 'text-green-400' : 'text-amber-400'}`}>
            {pct(dashboard.kpis?.capacityUsedPercent || 0)}
          </span>
        </div>
        <div className="h-3 bg-gray-900 rounded-full overflow-hidden">
          <div
            className={`h-full ${teamUsed >= teamCapacity ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-[#f37121] to-orange-400'}`}
            style={{ width: `${Math.min(100, dashboard.kpis?.capacityUsedPercent || 0)}%` }}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <p className="text-gray-400 text-xs">{lang === 'ar' ? 'الفعلي' : 'Actual Orders'}</p>
            <p className="text-white font-bold text-lg">{teamUsed.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <p className="text-gray-400 text-xs">{lang === 'ar' ? 'الهدف الإجمالي' : 'Target'}</p>
            <p className="text-white font-bold text-lg">{teamCapacity.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <p className="text-gray-400 text-xs">{lang === 'ar' ? 'الفارق' : 'Delta'}</p>
            <p className={`font-bold text-lg ${teamUsed >= teamCapacity ? 'text-green-400' : 'text-red-400'}`}>
              {teamUsed >= teamCapacity ? '+' : ''}{(teamUsed - teamCapacity).toLocaleString()}
            </p>
          </div>
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <p className="text-gray-400 text-xs">{lang === 'ar' ? 'متوسط/مندوب/شهر' : 'Avg / Rep / Month'}</p>
            <p className="text-white font-bold text-lg">
              {totalReps > 0 && monthsCount > 0 ? Math.round(teamUsed / totalReps / monthsCount).toLocaleString() : 0}
            </p>
          </div>
        </div>
      </div>

      {/* Team Summary — clear performance buckets */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-3 text-sm">
          {lang === 'ar' ? `توزيع الأداء (${totalReps} مندوب)` : `Performance Distribution (${totalReps} reps)`}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
            <p className="text-green-400 text-2xl font-bold">{aboveCount}</p>
            <p className="text-green-300/80 text-xs mt-1">{lang === 'ar' ? '🏆 فوق الهدف (≥100%)' : '🏆 Above Target (≥100%)'}</p>
            <p className="text-gray-500 text-[10px]">{totalReps > 0 ? pct((aboveCount / totalReps) * 100) : '0%'}</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
            <p className="text-amber-400 text-2xl font-bold">{onTrackCount}</p>
            <p className="text-amber-300/80 text-xs mt-1">{lang === 'ar' ? '⚡ على المسار (80-99%)' : '⚡ On Track (80-99%)'}</p>
            <p className="text-gray-500 text-[10px]">{totalReps > 0 ? pct((onTrackCount / totalReps) * 100) : '0%'}</p>
          </div>
          <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-center">
            <p className="text-orange-400 text-2xl font-bold">{belowCount}</p>
            <p className="text-orange-300/80 text-xs mt-1">{lang === 'ar' ? '⚠️ تحت الهدف (<80%)' : '⚠️ Below Target (<80%)'}</p>
            <p className="text-gray-500 text-[10px]">{totalReps > 0 ? pct((belowCount / totalReps) * 100) : '0%'}</p>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
            <p className="text-red-400 text-2xl font-bold">{atRiskCount}</p>
            <p className="text-red-300/80 text-xs mt-1">{lang === 'ar' ? '🚨 في خطر (<60%)' : '🚨 At Risk (<60%)'}</p>
            <p className="text-gray-500 text-[10px]">{totalReps > 0 ? pct((atRiskCount / totalReps) * 100) : '0%'}</p>
          </div>
        </div>
      </div>

      {/* Team-wide attendance — total off-days + no-data cells */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-3 text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-purple-400" />
          {lang === 'ar' ? 'إجمالي الحضور والغياب' : 'Team Attendance Summary'}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center">
            <p className="text-green-400 text-2xl font-bold">{(dashboard.kpis?.totalWorkingDays ?? 0).toLocaleString()}</p>
            <p className="text-green-300/80 text-xs mt-1">{lang === 'ar' ? '✅ إجمالي أيام العمل' : '✅ Total Worked Days'}</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-center">
            <p className="text-amber-400 text-2xl font-bold">{(dashboard.kpis?.totalDaysOff ?? 0).toLocaleString()}</p>
            <p className="text-amber-300/80 text-xs mt-1">{lang === 'ar' ? "🛌 إجمالي أيام الغياب" : "🛌 Total Days Off"}</p>
            <p className="text-gray-500 text-[10px]">{lang === 'ar' ? "(القيمة في الشيت = 0)" : "(cell = 0 in sheet)"}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-700/30 border border-gray-700 text-center">
            <p className="text-gray-300 text-2xl font-bold">{(dashboard.kpis?.totalNoDataDays ?? 0).toLocaleString()}</p>
            <p className="text-gray-400 text-xs mt-1">{lang === 'ar' ? '⚪ بدون بيانات' : '⚪ No-Data Days'}</p>
            <p className="text-gray-500 text-[10px]">{lang === 'ar' ? "(لم تُدخَل بعد)" : "(not entered yet)"}</p>
          </div>
        </div>
      </div>

      {/* Top performers + at-risk */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <Award className="w-4 h-4 text-green-400" />
            {lang === 'ar' ? '🏆 أعلى أداء (نسبة %)' : '🏆 Top Performers (by %)'}
          </h3>
          <div className="space-y-2">
            {topPerformers.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">{T.noData}</p>
            ) : topPerformers.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-white text-sm truncate">{r.englishName}</p>
                    {r.project && <p className="text-gray-500 text-[10px] truncate">{r.project}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-green-400 text-sm font-bold">{pct(r.performancePercent)}</span>
                  <p className="text-gray-500 text-[10px]">{r.totalOrders.toLocaleString()} {lang === 'ar' ? 'طلب' : 'orders'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-red-400" />
            {lang === 'ar' ? '🚨 مناديب في خطر (<60%)' : '🚨 At-Risk Reps (<60%)'}
          </h3>
          <div className="space-y-2">
            {atRisk.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">{lang === 'ar' ? '✅ لا يوجد مناديب في خطر' : '✅ No at-risk reps'}</p>
            ) : atRisk.slice(0, 5).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-white text-sm truncate">{r.englishName}</p>
                    {r.project && <p className="text-gray-500 text-[10px] truncate">{r.project}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-red-400 text-sm font-bold">{pct(r.performancePercent)}</span>
                  <p className="text-gray-500 text-[10px]">{r.totalOrders.toLocaleString()} {lang === 'ar' ? 'طلب' : 'orders'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Improvers + Decliners */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-green-400" />
            {lang === 'ar' ? '📈 أعلى المتحسنين' : '📈 Top Improvers'}
            <span className="text-gray-500 text-[10px] font-normal ml-auto">
              {lang === 'ar' ? '(آخر شهر مقابل أول شهر)' : '(last month vs first)'}
            </span>
          </h3>
          <div className="space-y-2">
            {topImprovers.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">
                {lang === 'ar' ? 'تحتاج بيانات لـ ≥ شهرين' : 'Needs ≥2 months of data'}
              </p>
            ) : topImprovers.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{r.englishName}</p>
                  <p className="text-gray-500 text-[10px]">
                    {r.firstMonthAvg.toFixed(1)} → {r.lastMonthAvg.toFixed(1)} {lang === 'ar' ? 'طلب/يوم' : 'orders/day'}
                  </p>
                </div>
                <span className="text-green-400 text-sm font-bold">+{pct(r.deltaPercent)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <TrendingDown className="w-4 h-4 text-red-400" />
            {lang === 'ar' ? '📉 أعلى المتراجعين' : '📉 Top Decliners'}
            <span className="text-gray-500 text-[10px] font-normal ml-auto">
              {lang === 'ar' ? '(يحتاجون اهتمام)' : '(needs attention)'}
            </span>
          </h3>
          <div className="space-y-2">
            {topDecliners.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">
                {lang === 'ar' ? '✅ مفيش متراجعين' : '✅ No decliners'}
              </p>
            ) : topDecliners.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{r.englishName}</p>
                  <p className="text-gray-500 text-[10px]">
                    {r.firstMonthAvg.toFixed(1)} → {r.lastMonthAvg.toFixed(1)} {lang === 'ar' ? 'طلب/يوم' : 'orders/day'}
                  </p>
                </div>
                <span className="text-red-400 text-sm font-bold">{pct(r.deltaPercent)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Most consistent + best single days */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <Minus className="w-4 h-4 text-blue-400" />
            {lang === 'ar' ? '🎯 الأكثر ثباتاً' : '🎯 Most Consistent'}
            <span className="text-gray-500 text-[10px] font-normal ml-auto">
              {lang === 'ar' ? '(انخفاض التذبذب الشهري)' : '(low monthly variance)'}
            </span>
          </h3>
          <div className="space-y-2">
            {mostConsistent.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">
                {lang === 'ar' ? 'تحتاج بيانات لـ ≥ شهرين' : 'Needs ≥2 months'}
              </p>
            ) : mostConsistent.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{r.englishName}</p>
                  <p className="text-gray-500 text-[10px]">
                    {r.totalOrders.toLocaleString()} {lang === 'ar' ? 'طلب على' : 'orders over'} {r.monthsActive} {lang === 'ar' ? 'شهر' : 'months'}
                  </p>
                </div>
                <span className="text-blue-400 text-sm font-bold">{r.consistency.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <Award className="w-4 h-4 text-[#f37121]" />
            {lang === 'ar' ? '🔥 أفضل أيام فردية' : '🔥 Best Single-Day Records'}
          </h3>
          <div className="space-y-2">
            {bestSingleDays.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">{T.noData}</p>
            ) : bestSingleDays.map((d: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{d.englishName}</p>
                  <p className="text-gray-500 text-[10px]">{d.dateKey} · {d.project || '—'}</p>
                </div>
                <span className="text-[#f37121] text-sm font-bold">{d.orders} {lang === 'ar' ? 'طلب' : 'orders'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Day-of-week analysis + Best team days */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <CalendarDays className="w-4 h-4 text-purple-400" />
            {lang === 'ar' ? '📅 تحليل أيام الأسبوع' : '📅 Day-of-Week Analysis'}
            <span className="text-gray-500 text-[10px] font-normal ml-auto">
              {lang === 'ar' ? '(متوسط طلب/مندوب)' : '(avg orders / rep)'}
            </span>
          </h3>
          <div className="space-y-1.5">
            {byDayOfWeek.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">{T.noData}</p>
            ) : (() => {
              const maxAvg = Math.max(...byDayOfWeek.map((d: any) => d.avgPerWorker), 1);
              return byDayOfWeek.map((d: any) => (
                <div key={d.dow} className="flex items-center gap-2">
                  <span className="text-gray-300 text-xs w-12">{dowLabels[d.dow]}</span>
                  <div className="flex-1 h-5 bg-gray-900 rounded relative overflow-hidden">
                    <div className="h-full bg-purple-400/40"
                      style={{ width: `${(d.avgPerWorker / maxAvg) * 100}%` }} />
                    <span className="absolute inset-0 flex items-center px-2 text-white text-[10px] font-medium">
                      {d.avgPerWorker.toFixed(1)} · {d.totalOrders.toLocaleString()} total
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <Award className="w-4 h-4 text-emerald-400" />
            {lang === 'ar' ? '🚀 أكثر الأيام إنتاجاً للفريق' : '🚀 Most Productive Team Days'}
          </h3>
          <div className="space-y-2">
            {topTeamDays.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-2">{T.noData}</p>
            ) : topTeamDays.map((d: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-900/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-white text-sm">{d.dateKey}</p>
                    <p className="text-gray-500 text-[10px]">{d.repsActive} {lang === 'ar' ? 'مندوب نشط' : 'active reps'}</p>
                  </div>
                </div>
                <span className="text-emerald-400 text-sm font-bold">{d.totalOrders.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Daily Cards Section ─────────────────────────────────────────────────────
function DailyCardsSection({
  days, lang, T, onDayClick, activeMonthLabel,
}: {
  days: any[]; lang: string; T: any; onDayClick: (d: string) => void;
  activeMonthLabel: string | null;
}) {
  if (!days || days.length === 0) return null;

  // Group by month so big windows (multiple months) stay readable
  const byMonth = new Map<string, any[]>();
  for (const d of days) {
    const monthKey = d.dateKey.slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey)!.push(d);
  }

  const monthNamesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dowAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dowEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthLabel = (key: string) => {
    const [y, m] = key.split('-');
    const arr = lang === 'ar' ? monthNamesAr : monthNamesEn;
    return `${arr[Number(m) - 1]} ${y}`;
  };

  // Sort months ascending
  const sortedMonths = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const isSingleMonth = !!activeMonthLabel;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#f37121]" />
          {isSingleMonth
            ? (lang === 'ar' ? `📆 أيام ${activeMonthLabel} — اضغط أي يوم لرؤية التفاصيل` : `📆 Days of ${activeMonthLabel} — click any day for details`)
            : (lang === 'ar' ? '📆 العرض اليومي (كل الشهور) — اضغط أي يوم' : '📆 Daily view (all months) — click any day')}
        </h3>
        <span className="text-gray-500 text-xs">{days.length} {lang === 'ar' ? 'يوم' : 'days'}</span>
      </div>

      {sortedMonths.map(([monthKey, daysOfMonth]) => (
        <div key={monthKey} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          {!isSingleMonth && (
            <p className="text-gray-300 text-xs font-medium uppercase mb-3">{monthLabel(monthKey)}</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-2">
            {daysOfMonth.map((d: any) => {
              const day = Number(d.dateKey.slice(8, 10));
              const dow = new Date(`${d.dateKey}T00:00:00.000Z`).getUTCDay();
              const dowLabel = (lang === 'ar' ? dowAr : dowEn)[dow];
              const ach = d.achievementPercent ?? 0;
              const hasData = d.totalOrders > 0 || (d.repsActive ?? 0) > 0;
              // Stripe color rules
              let stripe = 'bg-gray-700';
              if (!hasData) stripe = 'bg-gray-700';
              else if (ach >= 100) stripe = 'bg-green-500';
              else if (ach >= 70) stripe = 'bg-amber-500';
              else stripe = 'bg-red-500';
              const opacity = hasData ? '' : 'opacity-50';
              const avg = (d.repsActive ?? 0) > 0 ? d.totalOrders / d.repsActive : 0;
              return (
                <button key={d.dateKey} type="button"
                  onClick={() => onDayClick(d.dateKey)}
                  className={`bg-gray-900 border border-gray-700 rounded-lg overflow-hidden hover:border-[#f37121]/50 transition-all text-left ${opacity}`}
                  title={d.dateKey}
                >
                  <div className={`h-1 ${stripe}`} />
                  <div className="p-2.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-white text-lg font-bold">{day}</span>
                      <span className="text-gray-500 text-[10px]">{dowLabel}</span>
                    </div>
                    {hasData ? (
                      <>
                        <p className="text-[#f37121] text-base font-bold mt-1">{d.totalOrders.toLocaleString()}</p>
                        <p className="text-gray-500 text-[10px]">
                          {d.repsActive} {lang === 'ar' ? 'اشتغلوا' : 'worked'} · {avg.toFixed(1)} {lang === 'ar' ? 'ط/م' : 'avg'}
                        </p>
                        {(d.repsNotWorked ?? 0) > 0 && (
                          <p className="text-gray-400 text-[10px]">
                            🛌 {d.repsNotWorked} {lang === 'ar' ? 'ما اشتغلوش' : 'off'}
                          </p>
                        )}
                        {d.targetSum != null && (
                          <p className="text-[10px] mt-0.5"
                            style={{ color: ach >= 100 ? '#10b981' : ach >= 70 ? '#f59e0b' : '#ef4444' }}>
                            {ach.toFixed(0)}% {lang === 'ar' ? 'هدف' : 'target'}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-600 text-[11px] mt-1">{lang === 'ar' ? 'لا بيانات' : 'No data'}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Day Details Modal ───────────────────────────────────────────────────────
function DayDetailsModal({ date, project, branch, onClose, onRepClick, lang, T }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    const params = new URLSearchParams({ date });
    if (project) params.set('project', project);
    if (branch) params.set('branch', branch);
    api.get<any>(`/api/b2c/day-details?${params.toString()}`)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [date, project, branch]);

  const dowAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dowEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-50" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
            <h2 className="text-white font-semibold text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-[#f37121]" />
              {date} {data && <span className="text-gray-500 text-sm font-normal">— {(lang === 'ar' ? dowAr : dowEn)[data.dow]}</span>}
            </h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" title="Close"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-7 h-7 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !data ? (
              <p className="text-gray-500 text-sm text-center py-6">{T.noData}</p>
            ) : (
              <div className="space-y-4">
                {/* KPIs — comprehensive view of the day */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <DayKpi label={lang === 'ar' ? 'إجمالي الطلبات' : 'Total Orders'} value={data.totalOrders.toLocaleString()} color="#f37121" />
                  <DayKpi label={lang === 'ar' ? 'مناديب اشتغلوا' : 'Worked Today'} value={data.repsActive} color="#3b82f6" />
                  <DayKpi label={lang === 'ar' ? 'متوسط طلبات/مندوب' : 'Avg / Rep'} value={data.avgPerRep.toFixed(1)} color="#8b5cf6" />
                  <DayKpi label={lang === 'ar' ? 'أعلى مندوب' : 'Top Rep'}
                    value={data.bestRepOrders ?? data.bestRep?.orders ?? 0} color="#eab308" />
                  <DayKpi label={lang === 'ar' ? 'حققوا الهدف' : 'Hit Target'} value={data.repsAboveTarget} color="#10b981" />
                  <DayKpi label={lang === 'ar' ? 'نسبة التحقيق' : 'Achievement Rate'}
                    value={`${(data.hitTargetPercent ?? 0).toFixed(0)}%`}
                    color={performanceColor(data.hitTargetPercent ?? 0)} />
                </div>

                {/* Secondary stats — not-worked + below + no-data */}
                <div className="grid grid-cols-3 gap-3">
                  <DayKpi label={lang === 'ar' ? '🛌 ما اشتغلوش' : "🛌 Didn't Work"}
                    value={data.repsNotWorked ?? 0} color="#9ca3af" />
                  <DayKpi label={lang === 'ar' ? '⚠️ تحت الهدف' : '⚠️ Below Target'}
                    value={data.repsBelowTarget} color="#ef4444" />
                  <DayKpi label={lang === 'ar' ? '⚪ بدون بيانات' : '⚪ No Data'}
                    value={data.noDataCount ?? 0} color="#6b7280" />
                </div>

                {data.bestRep && (
                  <button type="button" onClick={() => onRepClick(data.bestRep.repId)}
                    className="w-full bg-gradient-to-r from-[#f37121]/10 via-gray-900 to-gray-900 border border-[#f37121]/30 rounded-xl p-3 text-left hover:border-[#f37121]/50 transition-colors">
                    <p className="text-[#f37121] text-xs uppercase font-medium">🏆 {lang === 'ar' ? 'أفضل مندوب اليوم' : 'Top Rep Today'}</p>
                    <p className="text-white font-bold mt-1">{data.bestRep.englishName}</p>
                    <p className="text-gray-300 text-sm">{data.bestRep.orders} {lang === 'ar' ? 'طلب' : 'orders'}</p>
                  </button>
                )}

                {/* Reps table — includes source-row tracking for upload diagnostics */}
                <div className="bg-gray-900/50 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="bg-gray-900 text-gray-400 text-xs uppercase">
                        <th className="text-left py-2 px-3">{lang === 'ar' ? 'المندوب' : 'Rep'}</th>
                        <th className="text-left py-2 px-3">{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'الطلبات' : 'Orders'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'الفارق' : 'Diff'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th className="text-center py-2 px-3" title={lang === 'ar' ? 'الشيت والصف اللي القيمة جت منه في Excel' : 'Sheet + row in Excel that produced this value'}>
                          {lang === 'ar' ? 'المصدر' : 'Source'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {data.reps.length === 0 ? (
                        <tr><td colSpan={6} className="py-6 text-center text-gray-500 text-sm">{T.noData}</td></tr>
                      ) : data.reps.map((r: any, i: number) => (
                        <tr key={i} onClick={() => r.repId && onRepClick(r.repId)} className="cursor-pointer hover:bg-gray-700/30">
                          <td className="py-2 px-3">
                            <p className="text-white text-sm">{r.englishName}</p>
                            {r.arabicName && <p className="text-gray-500 text-xs">{r.arabicName}</p>}
                            {r.accountId && <p className="text-gray-600 text-[10px] font-mono">#{r.accountId}</p>}
                          </td>
                          <td className="py-2 px-3 text-gray-300 text-sm">{r.project || '—'}</td>
                          <td className="py-2 px-3 text-center text-white font-semibold">
                            {r.orders === null ? '—' : r.orders}
                          </td>
                          <td className="py-2 px-3 text-center text-sm">
                            {r.diff === null ? '—' : (
                              <span className={r.diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {r.diff >= 0 ? '+' : ''}{r.diff}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <StatusPill status={r.status} lang={lang} />
                          </td>
                          <td className="py-2 px-3 text-center text-[10px] text-gray-500">
                            {r.sourceSheet ? (
                              <span title={`Sheet "${r.sourceSheet}", row ${r.sourceRow ?? '?'}`}>
                                {r.sourceSheet} · {lang === 'ar' ? 'صف' : 'row'} {r.sourceRow ?? '?'}
                              </span>
                            ) : (
                              <span className="text-gray-600">{lang === 'ar' ? 'يدوي' : 'manual'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function DayKpi({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div className="bg-gray-900/60 rounded-lg p-3">
      <p className="text-gray-400 text-[11px] uppercase">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}

function StatusPill({ status, lang }: { status: string; lang: string }) {
  const m: Record<string, { bg: string; text: string; labelEn: string; labelAr: string }> = {
    above:      { bg: 'bg-green-500/20',  text: 'text-green-400',  labelEn: 'Above', labelAr: 'فوق' },
    on_track:   { bg: 'bg-amber-500/20',  text: 'text-amber-400',  labelEn: 'On Track', labelAr: 'متوسط' },
    below:      { bg: 'bg-red-500/20',    text: 'text-red-400',    labelEn: 'Below', labelAr: 'تحت' },
    not_worked: { bg: 'bg-gray-500/20',   text: 'text-gray-300',   labelEn: 'Off',   labelAr: 'ما اشتغل' },
    no_data:    { bg: 'bg-gray-700',      text: 'text-gray-500',   labelEn: '—',     labelAr: '—' },
  };
  const c = m[status] || m.no_data;
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${c.bg} ${c.text}`}>
      {lang === 'ar' ? c.labelAr : c.labelEn}
    </span>
  );
}
