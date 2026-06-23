'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { getWorkshopDashboardTranslations } from '@/lib/translations';
import {
  BarChart3, Wrench, CheckCircle2, ShoppingCart, Loader2,
  AlertCircle, X, TrendingUp, Activity, Users, Clock, AlertTriangle,
} from 'lucide-react';

interface DashboardData {
  kpis: {
    totalRequests: number;
    open: number;
    inProgress: number;
    completed: number;
    avgDuration: number;
    pendingPurchases: number;
  };
  requestsPerDay: { date: string; count: number }[];
  durationTrend: { date: string; avgMinutes: number }[];
  statusDistribution: { status: string; count: number }[];
  recentActivity: { _id: string; action: string; description: string; createdAt: string; user?: string }[];
  pendingPurchasesList: { _id: string; itemName: string; quantity: number; vehicleNumber: string; date: string }[];
  employeeStats: { _id: string; employeeName: string; totalRequests: number; avgDuration: number; completedCount: number }[];
  technicianStats: { _id: string; totalRequests: number; avgDuration: number; minDuration: number; maxDuration: number }[];
  topVehicles: { _id: string; visits: number; totalDuration: number; lastVisit: string }[];
  weekComparison: { thisWeek: number; lastWeek: number; change: number };
  lowStockCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  open: '#facc15',
  in_progress: '#60a5fa',
  completed: '#4ade80',
};

export default function WorkshopDashboardPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const router = useRouter();
  const isAr = lang === 'ar';
  const tx = getWorkshopDashboardTranslations(lang);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<DashboardData>('/api/workshop/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Real-time updates
  const refresh = useCallback(() => { fetchDashboard(); }, [fetchDashboard]);
  useSocket('maintenance:created', refresh);
  useSocket('maintenance:updated', refresh);
  useSocket('maintenance:completed', refresh);
  useSocket('maintenance:deleted', refresh);
  useSocket('purchase:created', refresh);
  useSocket('purchase:received', refresh);
  useSocket('purchase:fulfilled', refresh);
  useSocket('workshop-task:created', refresh);
  useSocket('workshop-task:updated', refresh);

  const formatDuration = (minutes?: number) => {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-red-600" />
        <span className="text-red-600">{error}</span>
        <button onClick={() => { setError(''); fetchDashboard(); }} className="ml-auto text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  if (!data) return null;

  const kpis = data.kpis || { totalRequests: 0, open: 0, inProgress: 0, completed: 0, avgDuration: 0, pendingPurchases: 0 };
  const { requestsPerDay = [], durationTrend = [], statusDistribution = [], recentActivity = [], pendingPurchasesList = [], employeeStats = [], technicianStats = [], topVehicles = [], weekComparison = { thisWeek: 0, lastWeek: 0, change: 0 }, lowStockCount = 0 } = data;

  // Calculate max for bar chart scaling
  const maxDailyCount = Math.max(...(requestsPerDay?.map(d => d.count) || [1]), 1);
  const maxDuration = Math.max(...(durationTrend?.map(d => d.avgMinutes) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-[#f37121]" />
        <h1 className="text-2xl font-bold text-slate-900">{tx.pageTitle}</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: tx.kpiTotalRequests, value: kpis.totalRequests, icon: <Wrench className="w-5 h-5" />, color: 'text-[#f37121]', bg: 'bg-[#f37121]/10', href: '/system/workshop' },
          { label: tx.kpiOpen, value: kpis.open, icon: <AlertCircle className="w-5 h-5" />, color: 'text-yellow-700', bg: 'bg-yellow-500/10', href: '/system/workshop?status=open' },
          { label: tx.kpiInProgress, value: kpis.inProgress, icon: <Clock className="w-5 h-5" />, color: 'text-blue-600', bg: 'bg-blue-500/10', href: '/system/workshop?status=in_progress' },
          { label: tx.kpiCompleted, value: kpis.completed, icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-green-600', bg: 'bg-green-500/10', href: '/system/workshop?status=completed' },
          { label: tx.kpiAvgDuration, value: formatDuration(kpis.avgDuration), icon: <TrendingUp className="w-5 h-5" />, color: 'text-purple-600', bg: 'bg-purple-500/10', href: '/system/workshop' },
          { label: tx.kpiPendingPurchases, value: kpis.pendingPurchases, icon: <ShoppingCart className="w-5 h-5" />, color: 'text-orange-600', bg: 'bg-orange-500/10', href: '/system/workshop/purchases?status=pending' },
        ].map((kpi, i) => (
          <div key={i} onClick={() => router.push(kpi.href)} className={`${kpi.bg} border border-slate-200 rounded-lg p-4 cursor-pointer hover:scale-[1.02] transition-transform`}>
            <div className="flex items-center justify-between mb-2">
              <span className={kpi.color}>{kpi.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-slate-500 text-xs mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Requests Per Day - Bar Chart */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-4">{tx.requestsPerDay}</h3>
          {requestsPerDay && requestsPerDay.length > 0 ? (
            <div className="flex items-end gap-1 h-40">
              {requestsPerDay.slice(-14).map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-slate-500 text-[10px]">{d.count}</span>
                  <div
                    className="w-full bg-[#f37121] rounded-t-sm min-h-[4px] transition-all"
                    style={{ height: `${(d.count / maxDailyCount) * 100}%` }}
                  />
                  <span className="text-slate-500 text-[9px] whitespace-nowrap rotate-[-45deg] origin-top-left mt-1">
                    {new Date(d.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">{tx.noData}</p>
          )}
        </div>

        {/* Duration Trend - Line Chart (simplified bar) */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-4">{tx.durationTrend}</h3>
          {durationTrend && durationTrend.length > 0 ? (
            <div className="flex items-end gap-1 h-40">
              {durationTrend.slice(-14).map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-slate-500 text-[10px]">{Math.round(d.avgMinutes)}m</span>
                  <div
                    className="w-full bg-purple-500 rounded-t-sm min-h-[4px] transition-all"
                    style={{ height: `${(d.avgMinutes / maxDuration) * 100}%` }}
                  />
                  <span className="text-slate-500 text-[9px] whitespace-nowrap rotate-[-45deg] origin-top-left mt-1">
                    {new Date(d.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">{tx.noData}</p>
          )}
        </div>

        {/* Status Distribution - Pie-like */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-4">{tx.statusDistribution}</h3>
          {statusDistribution && statusDistribution.length > 0 ? (
            <div className="space-y-3">
              {statusDistribution.map((s, i) => {
                const totalDist = statusDistribution.reduce((a, b) => a + b.count, 0) || 1;
                const pct = Math.round((s.count / totalDist) * 100);
                const color = STATUS_COLORS[s.status] || '#9ca3af';
                const statusLabel = s.status === 'open' ? tx.statusOpen : s.status === 'in_progress' ? tx.statusInProgress : tx.statusCompleted;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-700 text-sm">{statusLabel}</span>
                      <span className="text-slate-500 text-sm">{s.count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5">
                      <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">{tx.noData}</p>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#f37121]" />
            {tx.recentActivity}
          </h3>
          {recentActivity && recentActivity.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {recentActivity.map((a, i) => (
                <div key={a._id || i} className="flex items-start gap-3 pb-3 border-b border-slate-200/70 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-[#f37121] mt-2 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-slate-900 text-sm">{a.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {a.user && <span className="text-slate-500 text-xs">{a.user}</span>}
                      <span className="text-slate-600 text-xs">
                        {new Date(a.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">{tx.noRecentActivity}</p>
          )}
        </div>

        {/* Pending Purchases */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-4 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-orange-600" />
            {tx.pendingPurchases}
          </h3>
          {pendingPurchasesList && pendingPurchasesList.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {pendingPurchasesList.map((p, i) => (
                <div key={p._id || i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-slate-900 text-sm font-medium">{p.itemName}</p>
                    <p className="text-slate-500 text-xs">
                      {tx.vehicle}: {p.vehicleNumber || '-'} | {tx.qty}: {p.quantity}
                    </p>
                  </div>
                  <span className="text-slate-500 text-xs whitespace-nowrap">
                    {new Date(p.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">{tx.noPendingPurchases}</p>
          )}
        </div>
      </div>

      {/* Employee Performance */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-slate-900 font-medium mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-[#f37121]" />
          {tx.employeePerformance}
        </h3>
        {employeeStats && employeeStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colEmployee}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colCompleted}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colAvgDuration}</th>
                </tr>
              </thead>
              <tbody>
                {employeeStats.map((emp, i) => (
                  <tr key={emp._id || i} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-slate-900 font-medium">{emp.employeeName}</td>
                    <td className="py-2.5 px-3 text-slate-700">{emp.completedCount}</td>
                    <td className="py-2.5 px-3 text-slate-700">{formatDuration(emp.avgDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-8">{tx.noDataYet}</p>
        )}
      </div>

      {/* Technician Team Performance */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-slate-900 font-medium mb-4 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-[#f37121]" />
          {tx.technicianTeamPerformance}
        </h3>
        {technicianStats && technicianStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colTechnician}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colTotalJobs}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colAvgDuration}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colFastest}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colSlowest}</th>
                </tr>
              </thead>
              <tbody>
                {technicianStats.map((t, i) => (
                  <tr key={t._id || i} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-slate-900 font-medium">{t._id}</td>
                    <td className="py-2.5 px-3 text-slate-700">{t.totalRequests}</td>
                    <td className="py-2.5 px-3 text-slate-700">{formatDuration(t.avgDuration)}</td>
                    <td className="py-2.5 px-3 text-green-600">{formatDuration(t.minDuration)}</td>
                    <td className="py-2.5 px-3 text-red-600">{formatDuration(t.maxDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-8">{tx.noDataYet}</p>
        )}
      </div>

      {/* Top Vehicles */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-slate-900 font-medium mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#f37121]" />
          {tx.topVehicles}
        </h3>
        {topVehicles && topVehicles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colVehicleNumber}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colVisits}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colTotalTime}</th>
                  <th className="text-left text-slate-300 font-semibold py-2.5 px-3">{tx.colLastVisit}</th>
                </tr>
              </thead>
              <tbody>
                {topVehicles.map((v) => (
                  <tr key={v._id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-slate-900 font-medium">{v._id}</td>
                    <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-[#f37121]/20 text-[#f37121] text-xs font-medium">{v.visits}x</span></td>
                    <td className="py-2.5 px-3 text-slate-700">{formatDuration(v.totalDuration)}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-xs">{v.lastVisit ? new Date(v.lastVisit).toLocaleDateString(isAr ? 'ar-EG' : 'en-US') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-8">{tx.noDataYet}</p>
        )}
      </div>

      {/* Week Comparison & Low Stock */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-slate-900 font-medium mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#f37121]" />
            {tx.weeklyComparison}
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-500 text-xs">{tx.thisWeek}</p>
              <p className="text-2xl font-bold text-slate-900">{weekComparison.thisWeek}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tx.lastWeek}</p>
              <p className="text-2xl font-bold text-slate-500">{weekComparison.lastWeek}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tx.change}</p>
              <p className={`text-2xl font-bold ${weekComparison.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {weekComparison.change >= 0 ? '+' : ''}{weekComparison.change}%
              </p>
            </div>
          </div>
        </div>

        <div className={`border rounded-lg p-4 ${lowStockCount > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-white border-slate-200'}`}>
          <h3 className="text-slate-900 font-medium mb-3 flex items-center gap-2">
            <AlertCircle className={`w-4 h-4 ${lowStockCount > 0 ? 'text-red-600' : 'text-[#f37121]'}`} />
            {tx.inventoryAlert}
          </h3>
          <div className="flex items-center gap-3">
            <p className={`text-3xl font-bold ${lowStockCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>{lowStockCount}</p>
            <p className="text-slate-500 text-sm">
              {tx.itemsLowOnStock}
            </p>
          </div>
          {lowStockCount > 0 && (
            <button type="button" onClick={() => router.push('/system/workshop/inventory')} className="mt-3 text-xs text-red-600 hover:text-red-700 underline">
              {tx.viewInventory} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
