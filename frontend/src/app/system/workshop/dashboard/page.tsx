'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  BarChart3, Wrench, Clock, CheckCircle2, ShoppingCart, Loader2,
  AlertCircle, X, TrendingUp, Activity, Users,
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
        <AlertCircle className="w-5 h-5 text-red-400" />
        <span className="text-red-400">{error}</span>
        <button onClick={() => { setError(''); fetchDashboard(); }} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  if (!data) return null;

  const kpis = data.kpis || { totalRequests: 0, open: 0, inProgress: 0, completed: 0, avgDuration: 0, pendingPurchases: 0 };
  const { requestsPerDay = [], durationTrend = [], statusDistribution = [], recentActivity = [], pendingPurchasesList = [], employeeStats = [] } = data;

  // Calculate max for bar chart scaling
  const maxDailyCount = Math.max(...(requestsPerDay?.map(d => d.count) || [1]), 1);
  const maxDuration = Math.max(...(durationTrend?.map(d => d.avgMinutes) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-[#f37121]" />
        <h1 className="text-2xl font-bold text-white">{isAr ? 'لوحة تحكم الورشة' : 'Workshop Dashboard'}</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: isAr ? 'إجمالي الطلبات' : 'Total Requests', value: kpis.totalRequests, icon: <Wrench className="w-5 h-5" />, color: 'text-[#f37121]', bg: 'bg-[#f37121]/10', href: '/system/workshop' },
          { label: isAr ? 'مفتوح' : 'Open', value: kpis.open, icon: <AlertCircle className="w-5 h-5" />, color: 'text-yellow-400', bg: 'bg-yellow-500/10', href: '/system/workshop?status=open' },
          { label: isAr ? 'قيد التنفيذ' : 'In Progress', value: kpis.inProgress, icon: <Clock className="w-5 h-5" />, color: 'text-blue-400', bg: 'bg-blue-500/10', href: '/system/workshop?status=in_progress' },
          { label: isAr ? 'مكتمل' : 'Completed', value: kpis.completed, icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-green-400', bg: 'bg-green-500/10', href: '/system/workshop?status=completed' },
          { label: isAr ? 'متوسط المدة' : 'Avg Duration', value: formatDuration(kpis.avgDuration), icon: <TrendingUp className="w-5 h-5" />, color: 'text-purple-400', bg: 'bg-purple-500/10', href: '/system/workshop' },
          { label: isAr ? 'مشتريات معلقة' : 'Pending Purchases', value: kpis.pendingPurchases, icon: <ShoppingCart className="w-5 h-5" />, color: 'text-orange-400', bg: 'bg-orange-500/10', href: '/system/workshop/purchases?status=pending' },
        ].map((kpi, i) => (
          <div key={i} onClick={() => router.push(kpi.href)} className={`${kpi.bg} border border-gray-700 rounded-lg p-4 cursor-pointer hover:scale-[1.02] transition-transform`}>
            <div className="flex items-center justify-between mb-2">
              <span className={kpi.color}>{kpi.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-gray-400 text-xs mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Requests Per Day - Bar Chart */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4">{isAr ? 'الطلبات يوميا' : 'Requests Per Day'}</h3>
          {requestsPerDay && requestsPerDay.length > 0 ? (
            <div className="flex items-end gap-1 h-40">
              {requestsPerDay.slice(-14).map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-gray-400 text-[10px]">{d.count}</span>
                  <div
                    className="w-full bg-[#f37121] rounded-t-sm min-h-[4px] transition-all"
                    style={{ height: `${(d.count / maxDailyCount) * 100}%` }}
                  />
                  <span className="text-gray-500 text-[9px] whitespace-nowrap rotate-[-45deg] origin-top-left mt-1">
                    {new Date(d.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا توجد بيانات' : 'No data'}</p>
          )}
        </div>

        {/* Duration Trend - Line Chart (simplified bar) */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4">{isAr ? 'متوسط المدة' : 'Duration Trend'}</h3>
          {durationTrend && durationTrend.length > 0 ? (
            <div className="flex items-end gap-1 h-40">
              {durationTrend.slice(-14).map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-gray-400 text-[10px]">{Math.round(d.avgMinutes)}m</span>
                  <div
                    className="w-full bg-purple-500 rounded-t-sm min-h-[4px] transition-all"
                    style={{ height: `${(d.avgMinutes / maxDuration) * 100}%` }}
                  />
                  <span className="text-gray-500 text-[9px] whitespace-nowrap rotate-[-45deg] origin-top-left mt-1">
                    {new Date(d.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا توجد بيانات' : 'No data'}</p>
          )}
        </div>

        {/* Status Distribution - Pie-like */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4">{isAr ? 'توزيع الحالات' : 'Status Distribution'}</h3>
          {statusDistribution && statusDistribution.length > 0 ? (
            <div className="space-y-3">
              {statusDistribution.map((s, i) => {
                const totalDist = statusDistribution.reduce((a, b) => a + b.count, 0) || 1;
                const pct = Math.round((s.count / totalDist) * 100);
                const color = STATUS_COLORS[s.status] || '#9ca3af';
                const statusLabel = isAr
                  ? (s.status === 'open' ? 'مفتوح' : s.status === 'in_progress' ? 'قيد التنفيذ' : 'مكتمل')
                  : (s.status === 'open' ? 'Open' : s.status === 'in_progress' ? 'In Progress' : 'Completed');
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-300 text-sm">{statusLabel}</span>
                      <span className="text-gray-400 text-sm">{s.count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2.5">
                      <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا توجد بيانات' : 'No data'}</p>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#f37121]" />
            {isAr ? 'النشاط الأخير' : 'Recent Activity'}
          </h3>
          {recentActivity && recentActivity.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {recentActivity.map((a, i) => (
                <div key={a._id || i} className="flex items-start gap-3 pb-3 border-b border-gray-700/50 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-[#f37121] mt-2 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white text-sm">{a.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {a.user && <span className="text-gray-500 text-xs">{a.user}</span>}
                      <span className="text-gray-600 text-xs">
                        {new Date(a.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا يوجد نشاط' : 'No recent activity'}</p>
          )}
        </div>

        {/* Pending Purchases */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-orange-400" />
            {isAr ? 'مشتريات معلقة' : 'Pending Purchases'}
          </h3>
          {pendingPurchasesList && pendingPurchasesList.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {pendingPurchasesList.map((p, i) => (
                <div key={p._id || i} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium">{p.itemName}</p>
                    <p className="text-gray-500 text-xs">
                      {isAr ? 'مركبة' : 'Vehicle'}: {p.vehicleNumber || '-'} | {isAr ? 'كمية' : 'Qty'}: {p.quantity}
                    </p>
                  </div>
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    {new Date(p.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا توجد مشتريات معلقة' : 'No pending purchases'}</p>
          )}
        </div>
      </div>

      {/* Employee Performance */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h3 className="text-white font-medium mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-[#f37121]" />
          {isAr ? 'أداء الموظفين' : 'Employee Performance'}
        </h3>
        {employeeStats && employeeStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-400 font-medium py-2.5 px-3">{isAr ? 'الموظف' : 'Employee'}</th>
                  <th className="text-left text-gray-400 font-medium py-2.5 px-3">{isAr ? 'الطلبات المنجزة' : 'Completed'}</th>
                  <th className="text-left text-gray-400 font-medium py-2.5 px-3">{isAr ? 'متوسط المدة' : 'Avg Duration'}</th>
                </tr>
              </thead>
              <tbody>
                {employeeStats.map((emp, i) => (
                  <tr key={emp._id || i} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 px-3 text-white font-medium">{emp.employeeName}</td>
                    <td className="py-2.5 px-3 text-gray-300">{emp.completedCount}</td>
                    <td className="py-2.5 px-3 text-gray-300">{formatDuration(emp.avgDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-8">{isAr ? 'لا توجد بيانات' : 'No data yet'}</p>
        )}
      </div>
    </div>
  );
}
