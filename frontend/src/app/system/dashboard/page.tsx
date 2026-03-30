'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import StatCard from '@/components/system/StatCard';
import { useSocket } from '@/hooks/useSocket';
import {
  DollarSign, TrendingUp, Clock, AlertTriangle, Users,
  BarChart3, Target, ArrowUpRight, Calendar, UserX, Download
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

export default function DashboardPage() {
  const { user } = useAuth();
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dateMode, setDateMode] = useState<'current' | 'lastMonth' | 'custom'>('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [initialLoaded, setInitialLoaded] = useState(false);

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
    setAging(cached.aging);
    setDso(cached.dso);
    setPerformance(cached.performance);
  }, []);

  // Fetch date-dependent data only (dashboard, aging, dso, performance)
  const fetchDateData = useCallback(async (dateQuery: string) => {
    const results = await Promise.allSettled([
      api.get(`/api/analytics/dashboard${dateQuery}`),
      api.get(`/api/analytics/aging${dateQuery}`),
      api.get(`/api/analytics/dso${dateQuery}`),
      api.get(`/api/analytics/performance${dateQuery}`),
    ]);

    const names = ['dashboard', 'aging', 'dso', 'performance'];
    const setters = [setDashboard, setAging, setDso, setPerformance];
    const failed: string[] = [];
    const data: any = {};

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        setters[i](r.value);
        data[names[i]] = r.value;
      } else {
        console.error(`Dashboard API failed: ${names[i]}`, r.reason?.message);
        failed.push(names[i]);
      }
    });

    // Cache the successful results
    if (failed.length === 0) {
      cacheRef.current[dateQuery] = {
        dashboard: data.dashboard,
        aging: data.aging,
        dso: data.dso,
        performance: data.performance,
        timestamp: Date.now(),
      };
    }

    return failed;
  }, []);

  // Full fetch (initial load + WebSocket triggered refresh)
  const fetchAll = useCallback(async () => {
    try {
      setError('');
      const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
      const isOpsManager = user?.role === 'operations_manager';
      const isEmployee = user?.role === 'employee';
      const isModerator = user?.role === 'moderator';
      const isOps = user?.role === 'operations';
      const showFinancials = isAdmin || isEmployee;

      if (isAdmin || isOpsManager || isEmployee || isModerator || isOps) {
        const dateQuery = buildDateQuery();

        // Fetch date-dependent data for all roles
        const fetches: Promise<any>[] = [fetchDateData(dateQuery)];

        // Financial analytics only for admin/employee
        if (showFinancials) {
          fetches.push(
            api.get('/api/analytics/risk').then(d => { setRisk(d); return null; }).catch(() => 'risk'),
            api.get('/api/analytics/forecast').then(d => { setForecast(d); return null; }).catch(() => 'forecast'),
            api.get('/api/analytics/credit-alerts').then(d => { setCreditAlerts(d); return null; }).catch(() => 'credit-alerts'),
            api.get('/api/tasks/low-visit-customers').then(d => { setLowVisitCustomers(d); return null; }).catch(() => null),
          );
        }

        const [dateFailed, ...staticResults] = await Promise.all(fetches);

        const allFailed = [...dateFailed, ...staticResults.filter(Boolean) as string[]];
        if (allFailed.length > 0) setError(`Failed to load: ${allFailed.join(', ')}`);
      }
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'Failed to load dashboard');
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

  // Initial load (only on mount / user change)
  useEffect(() => {
    fetchAll().then(() => {
      // Prefetch "Last Month" data in background so switching is instant
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthQuery = `?dateFrom=${start.toISOString().split('T')[0]}&dateTo=${end.toISOString().split('T')[0]}`;
      if (!cacheRef.current[lastMonthQuery]) {
        // Silent prefetch — results go to cache only, not to state
        Promise.allSettled([
          api.get(`/api/analytics/dashboard${lastMonthQuery}`),
          api.get(`/api/analytics/aging${lastMonthQuery}`),
          api.get(`/api/analytics/dso${lastMonthQuery}`),
          api.get(`/api/analytics/performance${lastMonthQuery}`),
        ]).then((results) => {
          const names = ['dashboard', 'aging', 'dso', 'performance'];
          const data: any = {};
          let allOk = true;
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') data[names[i]] = r.value;
            else allOk = false;
          });
          if (allOk) {
            cacheRef.current[lastMonthQuery] = { ...data, timestamp: Date.now() };
          }
        });
      }
    });
  }, [fetchAll]);

  // Date filter change — show cached data instantly, refresh in background
  useEffect(() => {
    if (!initialLoaded) return;
    let cancelled = false;
    const dateQuery = buildDateQuery();

    // Check cache first
    const cached = cacheRef.current[dateQuery];
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      // Instant switch — apply cached data with no loading indicator
      applyCached(cached);
      // Background refresh (silent)
      fetchDateData(dateQuery).then((failed) => {
        if (cancelled) return;
        if (failed.length > 0) setError(`Failed to load: ${failed.join(', ')}`);
      });
    } else {
      // No cache — show refreshing indicator
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

  const showFinancials = user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'employee';
  const hasExportableData = performance?.ranking?.length || risk?.highRiskClients?.length || aging?.buckets?.length || dso?.trend?.length || forecast?.forecast?.length;

  // Full Dashboard (Admin, Operations Manager, Employee)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{T.executiveDashboard}</h1>
        <div className="flex items-center gap-4">
          {hasExportableData && (
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {T.exportExcel}
            </button>
          )}
          <span className="text-gray-400 text-sm">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl p-3">
        <span className="text-gray-400 text-sm font-medium">{T.period}:</span>
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
                : 'bg-gray-700 text-gray-400 hover:text-white'
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
              className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
            />
            <span className="text-gray-500 text-xs">{T.to}</span>
            <input
              type="date"
              aria-label="Date to"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
            />
          </>
        )}
      </div>

      {/* Refreshing indicator */}
      {refreshing && (
        <div className="h-1 w-full bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full w-3/5 bg-[#f37121] rounded-full animate-[pulse_1s_ease-in-out_infinite]" />
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
          <span className="text-red-400 text-sm">{error}</span>
          <button type="button" onClick={() => { setLoading(true); fetchAll(); }} className="text-red-400 hover:text-red-300 text-xs font-medium underline">{T.retry}</button>
        </div>
      )}

      {/* KPI Cards - Financial (admin/employee only) */}
      {showFinancials && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={T.totalOutstanding} value={dashboard?.totalOutstanding || 0} icon={DollarSign} color="#ef4444" />
          <StatCard title={T.collectedMonth} value={dashboard?.monthlyCollected || 0} icon={TrendingUp} color="#10b981" />
          <StatCard title={T.collectionRate} value={`${dashboard?.collectionRate || 0}%`} icon={Target} color="#6366f1" />
          <div onClick={() => router.push('/system/credit-alerts')} className="cursor-pointer hover:scale-[1.02] transition-transform">
            <StatCard title={T.nearCreditLimit} value={creditAlerts?.total || 0} icon={AlertTriangle} color="#f59e0b" />
          </div>
        </div>
      )}

      {/* KPI Cards - Operational (visible to all) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {showFinancials && (
          <div onClick={() => router.push('/system/low-visit-customers')} className="cursor-pointer hover:scale-[1.02] transition-transform">
            <StatCard title={T.lowVisitCustomers} value={lowVisitCustomers?.count || 0} icon={UserX} color="#f59e0b" />
          </div>
        )}
        <div onClick={() => router.push('/system/overdue')} className="cursor-pointer hover:scale-[1.02] transition-transform">
          <StatCard title={T.overdueInvoices} value={dashboard?.overdueCount || 0} icon={AlertTriangle} color="#ef4444" />
        </div>
        <StatCard title={T.totalCustomers} value={dashboard?.customerCount || 0} icon={Users} />
        {showFinancials && (
          <StatCard
            title={T.highRiskClients}
            value={risk?.highRiskClients?.length || 0}
            icon={AlertTriangle}
            color="#ef4444"
          />
        )}
      </div>

      {/* Charts Row 1 - Aging visible to all, DSO for financials only */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Aging Chart */}
        {aging && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.agingBreakdown}</h3>
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
        )}

        {/* DSO Trend - Financial only */}
        {showFinancials && dso?.trend && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.dsoTrend}</h3>
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
        )}
      </div>

      {/* Charts Row 2 - Financial analytics only */}
      {showFinancials && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        {risk?.distribution && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.riskDistribution}</h3>
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
        )}

        {/* Credit Term Distribution */}
        {dashboard?.creditTermDistribution && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.creditTerms}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={dashboard.creditTermDistribution}
                  dataKey="count"
                  nameKey="term"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ term, count }) => `${term}d: ${count}`}
                >
                  {dashboard.creditTermDistribution.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cashflow Forecast */}
        {forecast?.forecast && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.cashflowForecast}</h3>
            <div className="space-y-4">
              {forecast.forecast.map((f: any) => (
                <div key={f.period} className="border border-gray-700 rounded-lg p-3">
                  <p className="text-white font-medium text-sm">{f.period}</p>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-gray-400">{T.expected}</span>
                    <span className="text-green-400">{f.expectedCollection?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">{T.outstanding}</span>
                    <span className="text-white">{f.totalOutstanding?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">{T.gap}</span>
                    <span className="text-red-400">{f.gap?.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}

      {/* Collector Ranking - Financial only */}
      {showFinancials && performance?.ranking && performance.ranking.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">{T.collectorPerformance}</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.rank}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.collector}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.target}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.collected}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.efficiency}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.promisePercent}</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400 uppercase">{T.avgDelay}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {performance.ranking.map((p: any, i: number) => (
                  <tr key={p.collector._id} className="hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-sm text-gray-300">#{i + 1}</td>
                    <td className="px-4 py-3 text-sm text-white font-medium">{p.collector.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{p.target?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-green-400">{p.totalCollected?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        p.efficiency >= 80 ? 'bg-green-500/20 text-green-400' :
                        p.efficiency >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {p.efficiency}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{p.promiseFulfillment}%</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{p.avgDelay} {T.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* High Risk Clients - Financial only */}
      {showFinancials && risk?.highRiskClients && risk.highRiskClients.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            {T.highRiskClients}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {risk.highRiskClients.slice(0, 6).map((c: any) => (
              <div key={c._id} className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
                <p className="text-white font-medium text-sm">{c.companyName}</p>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-gray-400">{T.riskScore}</span>
                  <span className="text-red-400 font-bold">{c.riskScore}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">{T.outstanding}</span>
                  <span className="text-white">{c.currentOutstanding?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">{T.creditTerm}</span>
                  <span className="text-white">{c.creditTerm} {T.days}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
