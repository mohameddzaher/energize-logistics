'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import StatCard from '@/components/system/StatCard';
import { useSocket } from '@/hooks/useSocket';
import Link from 'next/link';
import {
  DollarSign, TrendingUp, TrendingDown, Clock, AlertTriangle, Users,
  BarChart3, Target, ArrowUpRight, Calendar, UserX, Download,
  Wrench, ClipboardList, MessageSquare, ShoppingCart, CheckCircle, Loader2,
  Truck, Building2, PackageX
} from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getDashboardTranslations } from '@/lib/translations';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
  AreaChart, Area
} from 'recharts';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899'];

// Cache structure: { [dateQuery]: { dashboard, aging, dso, performance, timestamp } }
type CachedPeriod = { dashboard: any; aging: any; dso: any; performance: any; timestamp: number };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Role helpers ────────────────────────────────────────────
type Role = 'super_admin' | 'admin' | 'employee' | 'operations_manager' | 'operations' | 'moderator' | 'client';

function getRoleFlags(role?: string) {
  const isAdmin = role === 'super_admin' || role === 'admin';
  const isEmployee = role === 'employee';
  const isOpsManager = role === 'operations_manager';
  const isOps = role === 'operations';
  const isModerator = role === 'moderator';

  return {
    isAdmin,
    isEmployee,
    isOpsManager,
    isOps,
    isModerator,
    // Who sees full financial data (outstanding, collection rate, risk, forecast, DSO, collector ranking, high-risk)
    showFullFinancials: isAdmin,
    // Who sees collection-oriented financials (outstanding, collected, rate) but NOT risk/forecast/DSO/ranking
    showCollectionFinancials: isEmployee,
    // Who sees basic operational financials (outstanding, collection rate) but NOT risk/forecast/DSO
    showOpsFinancials: isOpsManager,
    // Who sees NO financial numbers at all
    showNoFinancials: isOps || isModerator,
    // Aging chart visible to all authenticated roles
    showAging: isAdmin || isEmployee || isOpsManager || isOps || isModerator,
    // DSO trend: admin only
    showDso: isAdmin,
    // Risk / forecast / credit terms / high-risk clients: admin only
    showRisk: isAdmin,
    showForecast: isAdmin,
    showCreditTerms: isAdmin,
    showHighRisk: isAdmin,
    // Collector ranking table: admin only
    showCollectorRanking: isAdmin,
    // Personal performance stats: employee
    showPersonalPerformance: isEmployee,
    // Export: admin only (they see everything)
    showExport: isAdmin,
    // Date filter: all roles
    showDateFilter: true,
    // Credit alerts / low visit: admin only
    showCreditAlerts: isAdmin,
    showLowVisit: isAdmin,
  };
}

// Determine which APIs to fetch based on role
function getRequiredApis(flags: ReturnType<typeof getRoleFlags>) {
  return {
    dashboard: true, // all roles need basic dashboard stats
    aging: flags.showAging,
    dso: flags.showDso,
    performance: flags.showCollectorRanking || flags.showPersonalPerformance,
    risk: flags.showRisk,
    forecast: flags.showForecast,
    creditAlerts: flags.showCreditAlerts,
    lowVisit: flags.showLowVisit,
  };
}

export default function DashboardPage() {
  const { user, loginKey } = useAuth();
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getDashboardTranslations(lang);
  const [dashboard, setDashboard] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [dso, setDso] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [creditAlerts, setCreditAlerts] = useState<any>(null);
  const [lowVisitCustomers, setLowVisitCustomers] = useState<any>(null);
  const [workshopSummary, setWorkshopSummary] = useState<any>(null);
  const [workflowsTotal, setWorkflowsTotal] = useState<number>(0);
  const [complaintsData, setComplaintsData] = useState<any>(null);
  const [superOverview, setSuperOverview] = useState<any>(null);
  const [superOverviewError, setSuperOverviewError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dateMode, setDateMode] = useState<'current' | 'lastMonth' | 'custom'>('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [initialLoaded, setInitialLoaded] = useState(false);

  const flags = getRoleFlags(user?.role);
  const apis = getRequiredApis(flags);

  // Period data cache
  const cacheRef = useRef<Record<string, CachedPeriod>>({});

  const buildDateQuery = useCallback(() => {
    const now = new Date();
    if (dateMode === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return `?dateFrom=${start.toISOString().split('T')[0]}&dateTo=${end.toISOString().split('T')[0]}`;
    }
    if (dateMode === 'custom' && customFrom && customTo) {
      return `?dateFrom=${customFrom}&dateTo=${customTo}`;
    }
    return '';
  }, [dateMode, customFrom, customTo]);

  // Apply cached data to state instantly
  const applyCached = useCallback((cached: CachedPeriod) => {
    setDashboard(cached.dashboard);
    if (cached.aging) setAging(cached.aging);
    if (cached.dso) setDso(cached.dso);
    if (cached.performance) setPerformance(cached.performance);
  }, []);

  // Fetch date-dependent data only (dashboard, aging, dso, performance) — filtered by role needs
  const fetchDateData = useCallback(async (dateQuery: string) => {
    const fetches: { name: string; promise: Promise<any>; setter: (d: any) => void }[] = [];

    // Dashboard stats are always needed
    fetches.push({ name: 'dashboard', promise: api.get(`/api/analytics/dashboard${dateQuery}`), setter: setDashboard });

    if (apis.aging) {
      fetches.push({ name: 'aging', promise: api.get(`/api/analytics/aging${dateQuery}`), setter: setAging });
    }
    if (apis.dso) {
      fetches.push({ name: 'dso', promise: api.get(`/api/analytics/dso${dateQuery}`), setter: setDso });
    }
    if (apis.performance) {
      fetches.push({ name: 'performance', promise: api.get(`/api/analytics/performance${dateQuery}`), setter: setPerformance });
    }

    const results = await Promise.allSettled(fetches.map(f => f.promise));
    const failed: string[] = [];
    const data: any = {};

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        fetches[i].setter(r.value);
        data[fetches[i].name] = r.value;
      } else {
        // Silently ignore auth-required errors (auth may still be settling on fresh login)
        if (r.reason?.message === 'Authentication required') return;
        console.error(`Dashboard API failed: ${fetches[i].name}`, r.reason?.message);
        failed.push(fetches[i].name);
      }
    });

    // Cache the successful results
    if (failed.length === 0) {
      cacheRef.current[dateQuery] = {
        dashboard: data.dashboard ?? null,
        aging: data.aging ?? null,
        dso: data.dso ?? null,
        performance: data.performance ?? null,
        timestamp: Date.now(),
      };
    }

    return failed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apis.aging, apis.dso, apis.performance]);

  // Auth-related transient errors that should be swallowed silently on first
  // page load. These come up when the cookie isn't set yet, the refresh token
  // is still in flight, or the user lost connection briefly.
  const isTransientError = (msg?: string) => {
    if (!msg) return false;
    return /Authentication required|timed out|Network/i.test(msg);
  };

  // Full fetch (initial load + WebSocket triggered refresh). `userInitiated`
  // controls whether failures show a visible banner — on the silent initial
  // load we just retry once after a delay instead of yelling at the user.
  const fetchAll = useCallback(async (userInitiated = false) => {
    try {
      if (userInitiated) setError('');
      const dateQuery = buildDateQuery();

      // Date-dependent data
      const fetches: Promise<any>[] = [fetchDateData(dateQuery)];

      // Static/non-date APIs — only fetch what the role needs. Each .catch
      // swallows transient/auth errors silently (returns null) and only
      // reports real failures by name.
      const safe = (name: string, p: Promise<any>, setter: (d: any) => void) =>
        p.then((d) => { setter(d); return null; })
         .catch((e) => isTransientError(e?.message) ? null : name);

      if (apis.risk) fetches.push(safe('risk', api.get('/api/analytics/risk'), setRisk));
      if (apis.forecast) fetches.push(safe('forecast', api.get('/api/analytics/forecast'), setForecast));
      if (apis.creditAlerts) fetches.push(safe('credit-alerts', api.get('/api/analytics/credit-alerts'), setCreditAlerts));
      if (apis.lowVisit) fetches.push(safe('low-visit', api.get('/api/tasks/low-visit-customers'), setLowVisitCustomers));

      if (user?.role === 'super_admin' || user?.role === 'admin') {
        fetches.push(
          api.get('/api/analytics/super-overview')
            .then((d) => { setSuperOverview(d); setSuperOverviewError(''); return null; })
            .catch((e) => {
              if (isTransientError(e?.message)) return null;
              setSuperOverviewError(e?.message || 'Failed to load system overview');
              return null;
            })
        );
      }
      if (user?.role === 'super_admin') {
        fetches.push(safe('workshop', api.get('/api/workshop/dashboard'), setWorkshopSummary));
        fetches.push(safe('workflows', api.get<any>('/api/workflows?limit=1'), (d) => setWorkflowsTotal(d.total || 0)));
        fetches.push(safe('complaints', api.get<any>('/api/complaints?limit=1'), setComplaintsData));
      }

      const [dateFailed, ...staticResults] = await Promise.all(fetches);
      const allFailed = [...dateFailed, ...staticResults.filter(Boolean) as string[]];

      // Only show the failure banner on user-initiated refresh. On the silent
      // initial load, transient/race-condition errors are common (cookie not
      // yet set, refresh token in flight) and showing them confuses the user.
      if (allFailed.length > 0 && userInitiated) {
        setError(`Failed to load: ${allFailed.join(', ')}`);
      }
    } catch (err: any) {
      if (isTransientError(err?.message)) {
        setLoading(false);
        setInitialLoaded(true);
        return;
      }
      console.error('Dashboard fetch error:', err);
      if (userInitiated) setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Invalidate cache on WebSocket events so next switch is fresh
  const invalidateCache = useCallback(() => {
    cacheRef.current = {};
    fetchAll();
  }, [fetchAll]);

  // Clear cache when user changes (login/logout with different account)
  useEffect(() => {
    cacheRef.current = {};
  }, [loginKey]);

  // Initial load - ONLY after user is authenticated (prevents 401 race
  // condition on fresh login). If the silent first-pass leaves the main
  // `dashboard` payload empty (transient auth race), retry once after a
  // short delay before giving up.
  useEffect(() => {
    if (!user) return; // wait for auth
    let retried = false;
    const run = (initial: boolean) => fetchAll(false).then(() => {
      // Auto-retry once if the main dashboard endpoint didn't load on the
      // first silent pass — the cookie was likely still settling.
      if (initial && !retried && !dashboard) {
        retried = true;
        setTimeout(() => fetchAll(false), 1500);
      }
      if (initial) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        const lastMonthQuery = `?dateFrom=${start.toISOString().split('T')[0]}&dateTo=${end.toISOString().split('T')[0]}`;
        if (!cacheRef.current[lastMonthQuery]) {
          fetchDateData(lastMonthQuery).catch(() => {});
        }
      }
    });
    run(true);
  }, [fetchAll, fetchDateData, loginKey, user]);

  // Date filter change — show cached data instantly, refresh in background
  useEffect(() => {
    if (!initialLoaded) return;
    let cancelled = false;
    const dateQuery = buildDateQuery();

    const cached = cacheRef.current[dateQuery];
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      applyCached(cached);
      fetchDateData(dateQuery).then((failed) => {
        if (cancelled) return;
        if (failed.length > 0) setError(`Failed to load: ${failed.join(', ')}`);
      });
    } else {
      setRefreshing(true);
      setError('');
      fetchDateData(dateQuery).then((failed) => {
        if (cancelled) return;
        setRefreshing(false);
        if (failed.length > 0) setError(`Failed to load: ${failed.join(', ')}`);
      });
    }

    return () => { cancelled = true; };
  }, [dateMode, customFrom, customTo]);

  // Real-time updates — invalidate cache + refetch
  useSocket('payment:logged', invalidateCache);
  useSocket('invoice:created', invalidateCache);
  useSocket('customer:updated', invalidateCache);
  useSocket('customer:deleted', invalidateCache);
  useSocket('invoice:deleted', invalidateCache);
  useSocket('payment:deleted', invalidateCache);
  useSocket('task:created', invalidateCache);
  useSocket('task:updated', invalidateCache);
  useSocket('task:deleted', invalidateCache);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Export handler (admin only) ───────────────────────────
  const handleExport = () => {
    const sheets: { name: string; data: Record<string, any>[]; columns: any[] }[] = [];

    if (performance?.ranking?.length) {
      sheets.push({
        name: 'Collector Performance',
        data: performance.ranking.map((p: any, i: number) => ({ ...p, rank: i + 1 })),
        columns: [
          { header: 'Rank', key: 'rank', width: 8 },
          { header: 'Collector', key: 'collector.name', width: 22 },
          { header: 'Target', key: 'target', transform: fmt.money, width: 16 },
          { header: 'Collected', key: 'totalCollected', transform: fmt.money, width: 16 },
          { header: 'Efficiency %', key: 'efficiency', width: 14 },
          { header: 'Promise %', key: 'promiseFulfillment', width: 14 },
          { header: 'Avg Delay (days)', key: 'avgDelay', width: 16 },
        ],
      });
    }

    if (risk?.highRiskClients?.length) {
      sheets.push({
        name: 'High Risk Clients',
        data: risk.highRiskClients,
        columns: [
          { header: 'Company Name', key: 'companyName', width: 28 },
          { header: 'Risk Score %', key: 'riskScore', width: 14 },
          { header: 'Outstanding', key: 'currentOutstanding', transform: fmt.money, width: 16 },
          { header: 'Credit Term (days)', key: 'creditTerm', width: 18 },
        ],
      });
    }

    if (aging?.buckets?.length) {
      sheets.push({
        name: 'Aging Breakdown',
        data: aging.buckets,
        columns: [
          { header: 'Period', key: 'label', width: 18 },
          { header: 'Amount', key: 'totalAmount', transform: fmt.money, width: 16 },
          { header: 'Count', key: 'count', width: 10 },
        ],
      });
    }

    if (dso?.trend?.length) {
      sheets.push({
        name: 'DSO Trend',
        data: dso.trend,
        columns: [
          { header: 'Month', key: 'month', width: 14 },
          { header: 'DSO (days)', key: 'dso', width: 12 },
        ],
      });
    }

    if (forecast?.forecast?.length) {
      sheets.push({
        name: 'Cashflow Forecast',
        data: forecast.forecast,
        columns: [
          { header: 'Period', key: 'period', width: 18 },
          { header: 'Expected Collection', key: 'expectedCollection', transform: fmt.money, width: 20 },
          { header: 'Total Outstanding', key: 'totalOutstanding', transform: fmt.money, width: 20 },
          { header: 'Gap', key: 'gap', transform: fmt.money, width: 16 },
        ],
      });
    }

    if (sheets.length > 0) {
      exportMultiSheet(sheets, 'Dashboard_Report');
    }
  };

  const hasExportableData = flags.showExport && (
    performance?.ranking?.length || risk?.highRiskClients?.length ||
    aging?.buckets?.length || dso?.trend?.length || forecast?.forecast?.length
  );

  // ─── Find current employee's personal performance data ─────
  const myPerformance = flags.showPersonalPerformance && performance?.ranking
    ? performance.ranking.find((p: any) => p.collector?._id === user?._id)
    : null;

  // ─── RENDER ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{T.executiveDashboard}</h1>
        <div className="flex items-center gap-4">
          {hasExportableData && (
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {T.exportExcel}
            </button>
          )}
          <span className="text-slate-500 text-sm">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Date Filter */}
      {flags.showDateFilter && (
        <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
          <span className="text-slate-500 text-sm font-medium">{T.period}:</span>
          {[
            { value: 'current', label: T.thisMonth },
            { value: 'lastMonth', label: T.lastMonth },
            { value: 'custom', label: T.custom },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setDateMode(opt.value as any); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                dateMode === opt.value
                  ? 'bg-[#f37121] text-white'
                  : 'bg-slate-100 text-slate-500 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {dateMode === 'custom' && (
            <>
              <input
                type="date"
                aria-label="Date from"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
              />
              <span className="text-slate-500 text-xs">{T.to}</span>
              <input
                type="date"
                aria-label="Date to"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
              />
            </>
          )}
        </div>
      )}

      {/* Refreshing indicator */}
      {refreshing && (
        <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full w-3/5 bg-[#f37121] rounded-full animate-[pulse_1s_ease-in-out_infinite]" />
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
          <span className="text-red-600 text-sm">{error}</span>
          <button type="button" onClick={() => { setLoading(true); fetchAll(true); }} className="text-red-600 hover:text-red-700 text-xs font-medium underline">{T.retry}</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          ADMIN / SUPER_ADMIN  —  Full executive dashboard
         ════════════════════════════════════════════════════════ */}

      {/* ── System-wide overview error banner — surfaces when backend
          hasn't loaded the /super-overview endpoint yet (needs restart) ── */}
      {flags.isAdmin && !superOverview && superOverviewError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-amber-200 font-semibold text-sm">
              {lang === 'ar' ? 'قسم "نظرة شاملة على النظام" غير محمّل' : 'System Overview section not loaded'}
            </p>
            <p className="text-amber-100/80 text-xs mt-1">
              {lang === 'ar'
                ? 'الـ endpoint الجديد بيحتاج backend restart. وقّف الـ backend (Ctrl+C) وشغّله تاني: cd backend && npm run dev'
                : 'New endpoint needs a backend restart. Stop the backend (Ctrl+C) and run: cd backend && npm run dev'}
            </p>
            <p className="text-amber-100/60 text-xs mt-1 font-mono">{superOverviewError}</p>
          </div>
        </div>
      )}

      {/* ── System-wide overview — every module at a glance ── */}
      {flags.isAdmin && superOverview && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">
              {lang === 'ar' ? 'نظرة شاملة على النظام' : 'System Overview'}
            </h2>
            <span className="text-xs text-slate-500">
              {lang === 'ar' ? 'كل الأقسام · اضغط للتفاصيل' : 'All modules · click any card'}
            </span>
          </div>
          {(() => {
            const Trend = ({ pct }: { pct: number | null | undefined }) => {
              if (pct === null || pct === undefined) return null;
              const positive = pct >= 0;
              return (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${positive ? 'text-emerald-600' : 'text-red-600'} ms-1.5`}>
                  {positive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {Math.abs(pct)}%
                </span>
              );
            };
            const fmt = (n: number) => (n || 0).toLocaleString();
            const fmtCur = (n: number) => `${Math.round(n || 0).toLocaleString()}`;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {/* Operations */}
                <Link href="/system/operations" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <ClipboardList className="w-5 h-5 text-[#f37121]" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-[#f37121]" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'العمليات' : 'Operations'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.operations?.total)}</p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {lang === 'ar' ? 'الشهر' : 'Month'}: {fmt(superOverview.operations?.thisMonth)}<Trend pct={superOverview.operations?.trendPct} />
                  </p>
                </Link>

                {/* B2C */}
                <Link href="/system/b2c/dashboard" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <Target className="w-5 h-5 text-violet-600" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-600" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'B2C - طلبات الشهر' : 'B2C – Month Orders'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.b2c?.monthOrders)}<Trend pct={superOverview.b2c?.trendPct} /></p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {fmt(superOverview.b2c?.reps)} {lang === 'ar' ? 'مندوب' : 'reps'} · {fmt(superOverview.b2c?.projects)} {lang === 'ar' ? 'مشاريع' : 'projects'}
                  </p>
                </Link>

                {/* Wallet */}
                <Link href="/system/wallet-dashboard" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <DollarSign className="w-5 h-5 text-emerald-600" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-emerald-600" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'المحفظة - عمليات الشهر' : 'Wallet – Month Tx'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.wallet?.monthTransactions)}</p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {fmt(superOverview.wallet?.openWallets)} {lang === 'ar' ? 'محفظة مفتوحة' : 'open wallets'}
                  </p>
                </Link>

                {/* Workshop tasks */}
                <Link href="/system/workshop/tasks" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <Wrench className="w-5 h-5 text-blue-600" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-blue-600" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'مهام الورشة' : 'Workshop Tasks'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.workshop?.openTasks)}</p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {fmt(superOverview.workshop?.pendingPurchases)} {lang === 'ar' ? 'مشتريات معلقة' : 'pending purchases'}
                  </p>
                </Link>

                {/* Inventory */}
                <Link href="/system/workshop/inventory" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <ShoppingCart className="w-5 h-5 text-amber-700" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-amber-700" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'المخزون' : 'Inventory'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.workshop?.inventoryItems)}</p>
                  <p className={`text-[10px] mt-1 ${(superOverview.workshop?.lowStockItems || 0) > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                    {fmt(superOverview.workshop?.lowStockItems)} {lang === 'ar' ? 'مخزون منخفض' : 'low stock'}
                    {(superOverview.workshop?.outOfStockItems || 0) > 0 && (
                      <span className="text-red-600 ms-2">· {fmt(superOverview.workshop?.outOfStockItems)} {lang === 'ar' ? 'نفد' : 'out'}</span>
                    )}
                  </p>
                </Link>

                {/* Tasks */}
                <Link href="/system/tasks" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <CheckCircle className="w-5 h-5 text-cyan-700" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-700" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'المهام المفتوحة' : 'Open Tasks'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.tasks?.open)}</p>
                  <p className={`text-[10px] mt-1 ${(superOverview.tasks?.dueToday || 0) > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                    {fmt(superOverview.tasks?.dueToday)} {lang === 'ar' ? 'تستحق اليوم' : 'due today'}
                  </p>
                </Link>

                {/* Complaints */}
                <Link href="/system/complaints" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <MessageSquare className="w-5 h-5 text-rose-600" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-rose-600" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'الشكاوى المفتوحة' : 'Open Complaints'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.service?.complaintsOpen)}</p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {fmt(superOverview.service?.disputesOpen)} {lang === 'ar' ? 'نزاعات' : 'disputes'}
                  </p>
                </Link>

                {/* Drivers */}
                <Link href="/system/drivers" className="group bg-white border border-slate-200 hover:border-[#f37121]/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <Users className="w-5 h-5 text-pink-600" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-pink-600" />
                  </div>
                  <p className="text-slate-500 text-[11px] font-medium">{lang === 'ar' ? 'السائقين' : 'Drivers'}</p>
                  <p className="text-slate-900 text-xl font-bold">{fmt(superOverview.roster?.drivers)}</p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    {fmt(superOverview.roster?.vendors)} {lang === 'ar' ? 'موردين' : 'vendors'} · {fmt(superOverview.roster?.branches)} {lang === 'ar' ? 'فروع' : 'branches'}
                  </p>
                </Link>
              </div>
            );
          })()}

          {/* ── Today + this-month KPIs strip (extra row, new) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-emerald-600" />
                <p className="text-emerald-700 text-[11px] font-semibold">{lang === 'ar' ? 'تحصيلات اليوم' : "Today's Collections"}</p>
              </div>
              <p className="text-slate-900 text-2xl font-bold">{(superOverview.wallet?.todayCollections || 0).toLocaleString()}</p>
              <p className="text-emerald-200/60 text-[10px] mt-0.5">{lang === 'ar' ? 'عمليات مسجّلة اليوم' : 'transactions today'}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <p className="text-emerald-700 text-[11px] font-semibold">{lang === 'ar' ? 'صافي المحفظة' : 'Wallet Net (Month)'}</p>
              </div>
              <p className={`text-2xl font-bold ${(superOverview.wallet?.monthNet || 0) >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {Math.round(superOverview.wallet?.monthNet || 0).toLocaleString()}
              </p>
              <p className="text-emerald-200/60 text-[10px] mt-0.5">
                {lang === 'ar' ? 'داخل' : 'In'} {Math.round(superOverview.wallet?.monthInflow || 0).toLocaleString()} · {lang === 'ar' ? 'خارج' : 'Out'} {Math.round(superOverview.wallet?.monthOutflow || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border border-violet-500/30 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-4 h-4 text-violet-600" />
                <p className="text-violet-700 text-[11px] font-semibold">{lang === 'ar' ? 'أيام عمل B2C الشهر' : 'B2C Working Days'}</p>
              </div>
              <p className="text-slate-900 text-2xl font-bold">{(superOverview.b2c?.monthWorkingDays || 0).toLocaleString()}</p>
              <p className="text-violet-200/60 text-[10px] mt-0.5">{lang === 'ar' ? 'إجمالي مناديب × أيام شغل' : 'rep × working days'}</p>
            </div>
            <div className="bg-gradient-to-br from-[#f37121]/10 to-[#f37121]/5 border border-[#f37121]/30 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="w-4 h-4 text-[#f37121]" />
                <p className="text-orange-700 text-[11px] font-semibold">{lang === 'ar' ? 'عمليات الشهر' : 'Month Operations'}</p>
              </div>
              <p className="text-slate-900 text-2xl font-bold">
                {(superOverview.operations?.thisMonth || 0).toLocaleString()}
              </p>
              <p className="text-orange-200/60 text-[10px] mt-0.5">
                {lang === 'ar' ? 'الشهر اللي فات' : 'Last month'}: {(superOverview.operations?.lastMonth || 0).toLocaleString()}
              </p>
            </div>
          </div>

          {/* ── Operations stage breakdown + Top active drivers (new) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            {/* Operations by stage */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[#f37121]" />
                {lang === 'ar' ? 'حالة العمليات' : 'Operations by Stage'}
              </h3>
              <div className="space-y-2">
                {[
                  { key: 'draft', label: lang === 'ar' ? 'مسودة' : 'Draft', color: 'bg-slate-300' },
                  { key: 'submitted_to_ops', label: lang === 'ar' ? 'في التشغيل' : 'In Ops', color: 'bg-blue-500' },
                  { key: 'ops_completed', label: lang === 'ar' ? 'تشغيل مكتمل' : 'Ops Done', color: 'bg-violet-500' },
                  { key: 'submitted_to_collections', label: lang === 'ar' ? 'تحصيلات' : 'Collections', color: 'bg-amber-500' },
                  { key: 'completed', label: lang === 'ar' ? 'مكتمل' : 'Completed', color: 'bg-emerald-500' },
                ].map((s) => {
                  const count = superOverview.operations?.byStage?.[s.key] || 0;
                  const total = superOverview.operations?.total || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={s.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-700">{s.label}</span>
                        <span className="text-slate-900 font-mono">{count.toLocaleString()} · {pct}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${s.color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top drivers this month */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4 text-pink-600" />
                {lang === 'ar' ? 'الأكثر نشاطاً (الشهر)' : 'Most Active Drivers (Month)'}
              </h3>
              {superOverview.roster?.topDrivers?.length ? (
                <div className="space-y-2">
                  {superOverview.roster.topDrivers.map((d: any, i: number) => {
                    const max = superOverview.roster.topDrivers[0].trips || 1;
                    const pct = Math.round((d.trips / max) * 100);
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-700 truncate flex items-center gap-1.5">
                            <span className="text-slate-500 font-mono">#{i + 1}</span>
                            {d.name}
                          </span>
                          <span className="text-slate-900 font-mono">{d.trips} {lang === 'ar' ? 'رحلة' : 'trips'}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-pink-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-500 text-xs">{lang === 'ar' ? 'لا توجد بيانات هذا الشهر' : 'No data this month'}</p>
              )}
            </div>
          </div>

          {/* ── Branches/Vendors + alerts strip (new) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Link href="/system/branches" className="group bg-white border border-slate-200 hover:border-indigo-400/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <p className="text-slate-700 text-[11px] font-semibold">{lang === 'ar' ? 'الفروع' : 'Branches'}</p>
              </div>
              <p className="text-slate-900 text-xl font-bold">{(superOverview.roster?.branches || 0).toLocaleString()}</p>
            </Link>
            <Link href="/system/vendors" className="group bg-white border border-slate-200 hover:border-pink-400/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingCart className="w-4 h-4 text-pink-600" />
                <p className="text-slate-700 text-[11px] font-semibold">{lang === 'ar' ? 'الموردين' : 'Vendors'}</p>
              </div>
              <p className="text-slate-900 text-xl font-bold">{(superOverview.roster?.vendors || 0).toLocaleString()}</p>
            </Link>
            <Link href="/system/workshop" className="group bg-white border border-slate-200 hover:border-blue-400/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-blue-600" />
                <p className="text-slate-700 text-[11px] font-semibold">{lang === 'ar' ? 'صيانة مفتوحة' : 'Open Maintenance'}</p>
              </div>
              <p className="text-slate-900 text-xl font-bold">{(superOverview.workshop?.openMaintenance || 0).toLocaleString()}</p>
            </Link>
            <Link href="/system/disputes" className="group bg-white border border-slate-200 hover:border-orange-400/60 rounded-xl p-3.5 transition-all hover:scale-[1.02] shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <p className="text-slate-700 text-[11px] font-semibold">{lang === 'ar' ? 'نزاعات مفتوحة' : 'Open Disputes'}</p>
              </div>
              <p className="text-slate-900 text-xl font-bold">{(superOverview.service?.disputesOpen || 0).toLocaleString()}</p>
            </Link>
          </div>
        </div>
      )}

      {flags.showFullFinancials && (
        <>
          {/* Financial KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title={T.totalOutstanding} value={dashboard?.totalOutstanding || 0} icon={DollarSign} color="#ef4444" />
            <StatCard title={T.collectedMonth} value={dashboard?.monthlyCollected || 0} icon={TrendingUp} color="#10b981" />
            <StatCard title={T.collectionRate} value={`${dashboard?.collectionRate || 0}%`} icon={Target} color="#6366f1" />
            <div onClick={() => router.push('/system/credit-alerts')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.nearCreditLimit} value={creditAlerts?.total || 0} icon={AlertTriangle} color="#f59e0b" />
            </div>
          </div>

          {/* Operational KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div onClick={() => router.push('/system/low-visit-customers')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.lowVisitCustomers} value={lowVisitCustomers?.count || 0} icon={UserX} color="#f59e0b" />
            </div>
            <div onClick={() => router.push('/system/overdue')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.overdueInvoices} value={dashboard?.overdueCount || 0} icon={AlertTriangle} color="#ef4444" />
            </div>
            <StatCard title={T.totalCustomers} value={dashboard?.customerCount || 0} icon={Users} />
            <StatCard title={T.highRiskClients} value={risk?.highRiskClients?.length || 0} icon={AlertTriangle} color="#ef4444" />
          </div>

          {/* Charts Row 1: Aging + DSO */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {aging && <AgingChart aging={aging} T={T} />}
            {dso?.trend && <DsoChart dso={dso} T={T} />}
          </div>

          {/* Charts Row 2: Risk, Credit Terms, Forecast */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {risk?.distribution && <RiskDistributionChart risk={risk} T={T} />}
            {dashboard?.creditTermDistribution && <CreditTermChart data={dashboard.creditTermDistribution} T={T} />}
            {forecast?.forecast && <ForecastPanel forecast={forecast} T={T} />}
          </div>

          {/* Collector Ranking Table */}
          {performance?.ranking && performance.ranking.length > 0 && (
            <CollectorRankingTable performance={performance} T={T} />
          )}

          {/* High Risk Clients */}
          {risk?.highRiskClients && risk.highRiskClients.length > 0 && (
            <HighRiskClientsPanel risk={risk} T={T} />
          )}

          {/* ── Super Admin Summary Sections ── */}
          {user?.role === 'super_admin' && (
            <>
              {/* Workshop Summary */}
              {workshopSummary && (
                <div>
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-[#f37121]" />
                    Workshop Summary
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Link href="/system/workshop" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="Open Maintenance" value={workshopSummary.openMaintenance ?? workshopSummary.statusBreakdown?.open ?? 0} icon={Wrench} color="#f59e0b" />
                    </Link>
                    <Link href="/system/workshop" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="In Progress" value={workshopSummary.inProgress ?? workshopSummary.statusBreakdown?.in_progress ?? 0} icon={Loader2} color="#6366f1" />
                    </Link>
                    <Link href="/system/workshop" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="Completed" value={workshopSummary.completed ?? workshopSummary.statusBreakdown?.completed ?? 0} icon={CheckCircle} color="#10b981" />
                    </Link>
                    <Link href="/system/workshop/purchases" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="Pending Purchases" value={workshopSummary.pendingPurchases ?? 0} icon={ShoppingCart} color="#ef4444" />
                    </Link>
                  </div>
                </div>
              )}

              {/* Operations Summary */}
              <div>
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-[#f37121]" />
                  Operations Summary
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Link href="/system/operations" className="hover:scale-[1.02] transition-transform">
                    <StatCard title="Total Workflows" value={workflowsTotal} icon={ClipboardList} color="#6366f1" />
                  </Link>
                </div>
              </div>

              {/* Complaints Summary */}
              {complaintsData && (
                <div>
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-[#f37121]" />
                    Complaints Summary
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Link href="/system/complaints" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="Total Complaints" value={complaintsData.total || complaintsData.complaints?.length || 0} icon={MessageSquare} color="#f59e0b" />
                    </Link>
                    <Link href="/system/complaints" className="hover:scale-[1.02] transition-transform">
                      <StatCard title="Open Complaints" value={complaintsData.openCount ?? complaintsData.complaints?.filter((c: any) => c.status === 'open' || c.status === 'in_progress').length ?? 0} icon={AlertTriangle} color="#ef4444" />
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          EMPLOYEE (Collector) — Collection-focused dashboard
         ════════════════════════════════════════════════════════ */}
      {flags.showCollectionFinancials && (
        <>
          {/* Collection KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title={T.totalCustomers}
              value={user?.assignedCustomers?.length || dashboard?.customerCount || 0}
              icon={Users}
            />
            <StatCard title={T.collectedMonth} value={dashboard?.monthlyCollected || 0} icon={TrendingUp} color="#10b981" />
            <StatCard title={T.collectionRate} value={`${dashboard?.collectionRate || 0}%`} icon={Target} color="#6366f1" />
            <div onClick={() => router.push('/system/overdue')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.overdueInvoices} value={dashboard?.overdueCount || 0} icon={AlertTriangle} color="#ef4444" />
            </div>
          </div>

          {/* Aging Chart */}
          {aging && (
            <div className="grid grid-cols-1 gap-6">
              <AgingChart aging={aging} T={T} />
            </div>
          )}

          {/* Personal Performance Stats */}
          {myPerformance && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.collectorPerformance}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title={T.target} value={myPerformance.target?.toLocaleString() || 0} icon={Target} color="#6366f1" />
                <StatCard title={T.collected} value={myPerformance.totalCollected?.toLocaleString() || 0} icon={TrendingUp} color="#10b981" />
                <StatCard title={T.efficiency} value={`${myPerformance.efficiency || 0}%`} icon={BarChart3} color={myPerformance.efficiency >= 80 ? '#10b981' : myPerformance.efficiency >= 50 ? '#f59e0b' : '#ef4444'} />
                <StatCard title={T.avgDelay} value={`${myPerformance.avgDelay || 0} ${T.days}`} icon={Clock} color="#f59e0b" />
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          OPERATIONS MANAGER — Operations overview
         ════════════════════════════════════════════════════════ */}
      {flags.showOpsFinancials && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title={T.totalCustomers} value={dashboard?.customerCount || 0} icon={Users} />
            <div onClick={() => router.push('/system/overdue')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.overdueInvoices} value={dashboard?.overdueCount || 0} icon={AlertTriangle} color="#ef4444" />
            </div>
            <StatCard title={T.totalOutstanding} value={dashboard?.totalOutstanding || 0} icon={DollarSign} color="#ef4444" />
            <StatCard title={T.collectionRate} value={`${dashboard?.collectionRate || 0}%`} icon={Target} color="#6366f1" />
          </div>

          {/* Aging Chart */}
          {aging && (
            <div className="grid grid-cols-1 gap-6">
              <AgingChart aging={aging} T={T} />
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          OPERATIONS & MODERATOR — Simple operational overview
         ════════════════════════════════════════════════════════ */}
      {flags.showNoFinancials && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard title={T.totalCustomers} value={dashboard?.customerCount || 0} icon={Users} />
            <div onClick={() => router.push('/system/overdue')} className="cursor-pointer hover:scale-[1.02] transition-transform">
              <StatCard title={T.overdueInvoices} value={dashboard?.overdueCount || 0} icon={AlertTriangle} color="#ef4444" />
            </div>
          </div>

          {/* Aging Chart only */}
          {aging && (
            <div className="grid grid-cols-1 gap-6">
              <AgingChart aging={aging} T={T} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Extracted chart/panel components ────────────────────────

function AgingChart({ aging, T }: { aging: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.agingBreakdown}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={aging.buckets}>
          <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
          <Bar dataKey="totalAmount" fill="#f37121" radius={[4, 4, 0, 0]} name="Amount" />
          <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Count" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DsoChart({ dso, T }: { dso: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.dsoTrend}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={dso.trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
          <Line type="monotone" dataKey="dso" stroke="#f37121" strokeWidth={2} dot={{ r: 3 }} name="DSO (days)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RiskDistributionChart({ risk, T }: { risk: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.riskDistribution}</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={risk.distribution}
            dataKey="count"
            nameKey="level"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ level, count }) => `${level}: ${count}`}
          >
            {risk.distribution.map((_: any, i: number) => (
              <Cell key={i} fill={['#10b981', '#f59e0b', '#ef4444'][i] || COLORS[i]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function CreditTermChart({ data, T }: { data: any[]; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.creditTerms}</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="term"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ term, count }) => `${term}d: ${count}`}
          >
            {data.map((_: any, i: number) => (
              <Cell key={i} fill={COLORS[i]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ForecastPanel({ forecast, T }: { forecast: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.cashflowForecast}</h3>
      <div className="space-y-4">
        {forecast.forecast.map((f: any) => (
          <div key={f.period} className="border border-slate-200 rounded-lg p-3">
            <p className="text-slate-900 font-medium text-sm">{f.period}</p>
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-slate-500">{T.expected}</span>
              <span className="text-green-600">{f.expectedCollection?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{T.outstanding}</span>
              <span className="text-slate-900">{f.totalOutstanding?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{T.gap}</span>
              <span className="text-red-600">{f.gap?.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectorRankingTable({ performance, T }: { performance: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.collectorPerformance}</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200">
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.rank}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.collector}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.target}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.collected}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.efficiency}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.promisePercent}</th>
              <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.avgDelay}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {performance.ranking.map((p: any, i: number) => (
              <tr key={p.collector._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-sm text-slate-700">#{i + 1}</td>
                <td className="px-4 py-3 text-sm text-slate-900 font-medium">{p.collector.name}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{p.target?.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-green-600">{p.totalCollected?.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    p.efficiency >= 80 ? 'bg-green-500/20 text-green-600' :
                    p.efficiency >= 50 ? 'bg-yellow-500/20 text-yellow-700' :
                    'bg-red-500/20 text-red-600'
                  }`}>
                    {p.efficiency}%
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{p.promiseFulfillment}%</td>
                <td className="px-4 py-3 text-sm text-slate-700">{p.avgDelay} {T.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HighRiskClientsPanel({ risk, T }: { risk: any; T: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600" />
        {T.highRiskClients}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {risk.highRiskClients.slice(0, 6).map((c: any) => (
          <div key={c._id} className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
            <p className="text-slate-900 font-medium text-sm">{c.companyName}</p>
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-slate-500">{T.riskScore}</span>
              <span className="text-red-600 font-bold">{c.riskScore}%</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{T.outstanding}</span>
              <span className="text-slate-900">{c.currentOutstanding?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{T.creditTerm}</span>
              <span className="text-slate-900">{c.creditTerm} {T.days}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
