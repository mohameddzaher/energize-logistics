'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import {
  ArrowLeft, User, Phone, Mail, Target, TrendingUp,
  Clock, CheckCircle2, Calendar, FileText, DollarSign,
  BarChart3, AlertTriangle, Users, ListTodo, Download
} from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getCollectorsTranslations } from '@/lib/translations';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#f37121', '#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function CollectorProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const { lang } = useLanguage();
  const T = getCollectorsTranslations(lang);
  const [collector, setCollector] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [assignedCustomersList, setAssignedCustomersList] = useState<any[]>([]);
  const [teamRanking, setTeamRanking] = useState<any[] | null>(null);
  const [taskStats, setTaskStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateMode, setDateMode] = useState<'current' | 'lastMonth' | 'custom'>('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const getDateParams = useCallback(() => {
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

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const dateQuery = getDateParams();

      const results = await Promise.allSettled([
        api.get(`/api/users`),
        api.get(`/api/analytics/performance/${id}${dateQuery}`),
        api.get(`/api/collections?collector=${id}&limit=20`),
        api.get(`/api/payments?limit=200`),
        api.get(`/api/tasks/collector-stats/${id}${dateQuery}`),
      ]);

      if (results[0].status === 'fulfilled') {
        const users = (results[0].value as any).users || [];
        const found = users.find((u: any) => u._id === id);
        setCollector(found || null);
      }

      if (results[1].status === 'fulfilled') {
        const perfData = results[1].value as any;
        setPerformance(perfData.performance);
        setTrend(perfData.trend || []);
        setAssignedCustomersList(perfData.assignedCustomersList || []);
        setTeamRanking(perfData.teamRanking || null);
      }

      if (results[2].status === 'fulfilled') {
        setActivities((results[2].value as any).activities || []);
      }

      if (results[3].status === 'fulfilled') {
        const allPayments = (results[3].value as any).payments || [];
        const collectorPayments = allPayments.filter((p: any) =>
          p.receivedBy?._id === id || p.receivedBy === id
        );
        setRecentPayments(collectorPayments.slice(0, 20));
      }

      if (results[4].status === 'fulfilled') {
        setTaskStats(results[4].value as any);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load collector profile');
    } finally {
      setLoading(false);
    }
  }, [id, getDateParams]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Real-time: refetch on payment/invoice/customer changes
  const handleRealTime = useCallback(() => { fetchData(); }, [fetchData]);
  useSocket('payment:logged', handleRealTime);
  useSocket('payment:deleted', handleRealTime);
  useSocket('invoice:created', handleRealTime);
  useSocket('invoice:refunded', handleRealTime);
  useSocket('invoice:deleted', handleRealTime);
  useSocket('customer:updated', handleRealTime);
  useSocket('task:created', handleRealTime);
  useSocket('task:updated', handleRealTime);
  useSocket('task:deleted', handleRealTime);

  const formatCurrency = (val: number) => 'SAR ' + Math.round(val || 0).toLocaleString('en-US');
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!collector) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">{T.noCollectors}</p>
        <button type="button" onClick={() => router.back()} className="text-[#f37121] mt-2 text-sm hover:underline">Go back</button>
      </div>
    );
  }

  const isAdmin = collector.role === 'admin';

  // Team ranking data for admin
  const topPerformers = teamRanking ? teamRanking.filter(r => r.collector?.role !== 'admin').slice(0, 5) : [];
  const bottomPerformers = teamRanking ? [...teamRanking.filter(r => r.collector?.role !== 'admin')].reverse().slice(0, 5) : [];

  // Pie chart data for collection distribution (admin)
  const pieData = teamRanking
    ? teamRanking
        .filter(r => r.totalCollected > 0)
        .map(r => ({ name: r.collector?.name?.split(' ')[0] || '', value: r.totalCollected }))
    : [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#f37121]/20 flex items-center justify-center">
              <User className="w-6 h-6 text-[#f37121]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{collector.firstName} {collector.lastName}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${isAdmin ? 'bg-purple-500/20 text-purple-600' : 'bg-blue-500/20 text-blue-600'}`}>
                  {isAdmin ? 'Department Manager' : 'Collector'}
                </span>
                <span className="text-slate-500 text-xs">{collector.email}</span>
              </div>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => {
          const sheets: { name: string; data: any[]; columns: any[] }[] = [];
          if (performance) sheets.push({
            name: 'Performance Summary',
            data: [performance],
            columns: [
              { header: 'Collector', key: '_', transform: () => `${collector.firstName} ${collector.lastName}`, width: 22 },
              { header: 'Target', key: 'target', transform: fmt.money, width: 14 },
              { header: 'Total Collected', key: 'totalCollected', transform: fmt.money, width: 18 },
              { header: 'Assigned Collected', key: 'assignedCollected', transform: fmt.money, width: 20 },
              { header: 'Extra Collected', key: 'extraCollected', transform: fmt.money, width: 18 },
              { header: 'Efficiency %', key: 'efficiency', width: 14 },
              { header: 'Payments', key: 'paymentCount', width: 12 },
              { header: 'Promise Fulfillment %', key: 'promiseFulfillment', width: 22 },
              { header: 'Avg Delay (days)', key: 'avgDelay', width: 18 },
              { header: 'Assigned Customers', key: 'assignedCustomers', width: 20 },
            ],
          });
          if (assignedCustomersList.length > 0) sheets.push({
            name: 'Assigned Customers',
            data: assignedCustomersList,
            columns: [
              { header: 'Company', key: 'companyName', width: 24 },
              { header: 'Outstanding', key: 'currentOutstanding', transform: fmt.money, width: 16 },
              { header: 'Grade', key: 'grade', width: 8 },
              { header: 'Status', key: 'clientStatus', transform: (v: string) => v?.replace('_', ' '), width: 16 },
              { header: 'Last Payment', key: 'lastPaymentDate', transform: fmt.date, width: 14 },
            ],
          });
          if (recentPayments.length > 0) sheets.push({
            name: 'Recent Payments',
            data: recentPayments,
            columns: [
              { header: 'Customer', key: 'customer.companyName', width: 24 },
              { header: 'Invoice #', key: 'invoice.invoiceNumber', width: 16 },
              { header: 'Amount', key: 'amount', transform: fmt.money, width: 14 },
              { header: 'Payment Method', key: 'paymentMethod', transform: (v: string) => v?.replace('_', ' '), width: 18 },
              { header: 'Payment Date', key: 'paymentDate', transform: fmt.date, width: 14 },
            ],
          });
          if (sheets.length > 0) exportMultiSheet(sheets, `collector-${collector.firstName}-${collector.lastName}-${new Date().toISOString().split('T')[0]}`);
        }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <Download className="w-4 h-4" /> {T.downloadExcel}
        </button>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <span className="text-slate-500 text-sm font-medium">Period:</span>
        {[
          { value: 'current', label: 'This Month' },
          { value: 'lastMonth', label: 'Last Month' },
          { value: 'custom', label: 'Custom' },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setDateMode(opt.value as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              dateMode === opt.value ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-900'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {dateMode === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
          </>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">{error}</div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">{T.target}</p>
          <p className="text-slate-900 text-lg font-bold mt-1">{formatCurrency(performance?.target || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">{T.totalCollected}</p>
          <p className="text-green-600 text-lg font-bold mt-1">{formatCurrency(performance?.totalCollected || 0)}</p>
          {!isAdmin && (performance?.extraCollected || 0) > 0 && (
            <div className="mt-1 space-y-0.5">
              <p className="text-cyan-700 text-xs">Assigned: {formatCurrency(performance?.assignedCollected || 0)}</p>
              <p className="text-[#f37121] text-xs">Extra: {formatCurrency(performance?.extraCollected || 0)}</p>
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">{T.efficiency}</p>
          <p className={`text-lg font-bold mt-1 ${(performance?.efficiency || 0) >= 80 ? 'text-green-600' : (performance?.efficiency || 0) >= 50 ? 'text-yellow-700' : 'text-red-600'}`}>
            {performance?.efficiency || 0}%
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">{T.payments}</p>
          <p className="text-slate-900 text-lg font-bold mt-1">{performance?.paymentCount || 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">Promise %</p>
          <p className="text-[#f37121] text-lg font-bold mt-1">{performance?.promiseFulfillment || 0}%</p>
          <p className="text-slate-500 text-xs">{performance?.fulfilledPromises || 0}/{performance?.totalPromises || 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs uppercase">{T.performance}</p>
          <p className="text-slate-900 text-lg font-bold mt-1">{performance?.avgDelay || 0} days</p>
        </div>
      </div>

      {/* Performance Trend Chart */}
      {trend.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.performance}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
              <Bar dataKey="totalCollected" fill="#10b981" radius={[4, 4, 0, 0]} name="Collected" />
              <Bar dataKey="target" fill="#374151" radius={[4, 4, 0, 0]} name="Target" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Admin: Team Overview Section */}
      {isAdmin && teamRanking && teamRanking.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 5 / Bottom 5 */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              Top 5 Performers
            </h3>
            <div className="space-y-2">
              {topPerformers.map((r, i) => (
                <div key={r.collector?._id || i} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[#f37121] font-bold text-sm">#{i + 1}</span>
                    <span className="text-slate-900 text-sm">{r.collector?.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-green-600 text-sm font-medium">{formatCurrency(r.totalCollected)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      r.efficiency >= 80 ? 'bg-green-500/20 text-green-600' :
                      r.efficiency >= 50 ? 'bg-yellow-500/20 text-yellow-700' :
                      'bg-red-500/20 text-red-600'
                    }`}>{r.efficiency}%</span>
                  </div>
                </div>
              ))}
              {topPerformers.length === 0 && <p className="text-slate-500 text-sm">No data</p>}
            </div>

            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mt-6 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Bottom 5 Performers
            </h3>
            <div className="space-y-2">
              {bottomPerformers.map((r, i) => (
                <div key={r.collector?._id || i} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 font-bold text-sm">#{teamRanking!.length - i}</span>
                    <span className="text-slate-900 text-sm">{r.collector?.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-500 text-sm">{formatCurrency(r.totalCollected)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      r.efficiency >= 80 ? 'bg-green-500/20 text-green-600' :
                      r.efficiency >= 50 ? 'bg-yellow-500/20 text-yellow-700' :
                      'bg-red-500/20 text-red-600'
                    }`}>{r.efficiency}%</span>
                  </div>
                </div>
              ))}
              {bottomPerformers.length === 0 && <p className="text-slate-500 text-sm">No data</p>}
            </div>
          </div>

          {/* Collection Distribution Pie Chart */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#f37121]" />
              Collection Distribution
            </h3>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={120}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-slate-500 text-sm text-center py-10">No collections in this period</p>
            )}
          </div>
        </div>
      )}

      {/* Employee: Assigned Customers Section */}
      {!isAdmin && assignedCustomersList.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-700" />
            {T.assignedCustomers} ({assignedCustomersList.length})
          </h3>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.customer}</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.totalOutstanding}</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.status}</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.status}</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-300 uppercase">{T.payments}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {assignedCustomersList.map((c: any) => (
                  <tr key={c._id} className="hover:bg-slate-100">
                    <td className="px-4 py-2.5 text-sm text-slate-900">{c.companyName}</td>
                    <td className="px-4 py-2.5 text-sm text-[#f37121] font-medium">{formatCurrency(c.currentOutstanding || 0)}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        c.grade === 'A' ? 'bg-green-500/20 text-green-600' :
                        c.grade === 'B' ? 'bg-yellow-500/20 text-yellow-700' :
                        c.grade === 'C' ? 'bg-orange-500/20 text-orange-600' :
                        'bg-red-500/20 text-red-600'
                      }`}>{c.grade || '-'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-700 capitalize">{c.clientStatus?.replace('_', ' ') || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-500">{formatDate(c.lastPaymentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Task Performance Stats */}
      {taskStats && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-[#f37121]" />
            Task Performance
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Total Tasks</p>
              <p className="text-slate-900 text-lg font-bold">{taskStats.total}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Completed</p>
              <p className="text-green-600 text-lg font-bold">{taskStats.done}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Pending</p>
              <p className="text-yellow-700 text-lg font-bold">{taskStats.pending}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Postponed</p>
              <p className="text-blue-600 text-lg font-bold">{taskStats.postponed}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Cancelled</p>
              <p className="text-red-600 text-lg font-bold">{taskStats.cancelled}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Completion %</p>
              <p className="text-[#f37121] text-lg font-bold">{taskStats.completionRate}%</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Collected via Tasks</p>
              <p className="text-green-600 text-lg font-bold">{formatCurrency(taskStats.totalCollected)}</p>
            </div>
          </div>

          {/* Recent Tasks */}
          {taskStats.recentTasks && taskStats.recentTasks.length > 0 && (
            <div className="mt-4">
              <h4 className="text-slate-500 text-xs uppercase mb-2">Recent Tasks</h4>
              <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                {taskStats.recentTasks.map((t: any) => (
                  <div key={t._id} className="flex items-center justify-between border border-slate-200 rounded-lg p-2.5">
                    <div>
                      <span className="text-slate-900 text-sm">{t.customer?.companyName || 'Unknown'}</span>
                      <span className="text-slate-500 text-xs ml-2 capitalize">{t.contactMethod}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.status === 'done' ? 'bg-green-500/20 text-green-600' :
                      t.status === 'pending' ? 'bg-yellow-500/20 text-yellow-700' :
                      t.status === 'postponed' ? 'bg-blue-500/20 text-blue-600' :
                      'bg-red-500/20 text-red-600'
                    }`}>{t.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Two column layout: Activities + Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
            <Phone className="w-4 h-4 text-[#f37121]" />
            {T.recentActivity} ({performance?.activityCount || 0})
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {activities.length === 0 ? (
              <p className="text-slate-500 text-sm">{T.noDataFound}</p>
            ) : (
              activities.map((a: any) => (
                <div key={a._id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-900 text-sm font-medium">{a.customer?.companyName || 'Unknown'}</span>
                    <span className="text-slate-500 text-xs">{formatDate(a.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 capitalize">{a.type?.replace('_', ' ')}</span>
                    {a.invoice && <span className="text-[#f37121] text-xs">#{a.invoice.invoiceNumber}</span>}
                  </div>
                  {a.notes && <p className="text-slate-500 text-xs mt-1 truncate">{a.notes}</p>}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Payments Collected */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            {T.totalCollected}
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {recentPayments.length === 0 ? (
              <p className="text-slate-500 text-sm">{T.noDataFound}</p>
            ) : (
              recentPayments.map((p: any) => (
                <div key={p._id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-900 text-sm font-medium">{p.customer?.companyName || p.invoice?.customer?.companyName || 'Unknown'}</span>
                    <span className="text-green-600 text-sm font-medium">{formatCurrency(p.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[#f37121] text-xs">#{p.invoice?.invoiceNumber || '-'}</span>
                    <span className="text-slate-500 text-xs">{formatDate(p.paymentDate)}</span>
                  </div>
                  <span className="text-slate-500 text-xs capitalize">{p.paymentMethod?.replace('_', ' ')}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Profile Details */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.collectorProfile}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-slate-500 text-xs uppercase">{T.role}</p>
            <p className="text-slate-900 text-sm mt-1 capitalize">{collector.role?.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs uppercase">{T.assignedCustomers}</p>
            <p className="text-slate-900 text-sm mt-1">{performance?.assignedCustomers || 0}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs uppercase">{T.date}</p>
            <p className="text-slate-900 text-sm mt-1">{collector.lastLogin ? formatDate(collector.lastLogin) : 'Never'}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
