'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { getCollectorsTranslations, getCollectorsExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import StatCard from '@/components/system/StatCard';
import { Users, Target, TrendingUp } from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const REAL_TIME_EVENTS = [
  'payment:logged', 'payment:deleted',
  'invoice:created', 'invoice:refunded', 'invoice:deleted',
  'customer:updated',
];

export default function CollectorsPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getCollectorsTranslations(lang);
  const txx = getCollectorsExtraTranslations(lang);
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const perfData = await api.get<any>('/api/analytics/performance');
      setRanking(perfData.ranking || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const exportColumns: ExportColumn[] = [
    { header: txx.collector, key: 'collector.name', width: 22 },
    { header: txx.role, key: 'collector.role', width: 16 },
    { header: T.target, key: 'target', transform: fmt.money, width: 14 },
    { header: T.totalCollected, key: 'totalCollected', transform: fmt.money, width: 18 },
    { header: txx.assignedCollected, key: 'assignedCollected', transform: fmt.money, width: 20 },
    { header: txx.extraCollected, key: 'extraCollected', transform: fmt.money, width: 18 },
    { header: `${T.efficiency} %`, key: 'efficiency', width: 14 },
    { header: txx.promises, key: 'totalPromises', width: 12 },
    { header: txx.promiseFulfillmentPct, key: 'promiseFulfillment', width: 22 },
    { header: txx.avgDelayDays, key: 'avgDelay', width: 18 },
    { header: txx.activities, key: 'activityCount', width: 12 },
    { header: T.assignedCustomers, key: 'assignedCustomers', width: 18 },
  ];
  // ترتيبُ المحصّلين يأتي محسوبًا كاملًا من الخادم بلا فلترٍ ولا ترقيم، والجدول
  // يعرضه كلَّه؛ فنطاقٌ ثانٍ لن يزيد صفًّا واحدًا وإنّما يوحي بفرقٍ لا وجود له.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: 'Performance', rows: ranking, columns: exportColumns }] },
  ];

  const totalCollected = ranking.reduce((s, r) => s + (r.totalCollected || 0), 0);
  const avgEfficiency = ranking.length > 0 ? Math.round(ranking.reduce((s, r) => s + (r.efficiency || 0), 0) / ranking.length) : 0;
  const totalTeamMembers = ranking.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
        <ExportMenu fileName="collector-performance" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={T.downloadExcel} options={exportOptions} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={T.name} value={totalTeamMembers} icon={Users} />
        <StatCard title={T.totalCollected} value={totalCollected} icon={Target} color="#10b981" />
        <StatCard title={T.efficiency} value={`${avgEfficiency}%`} icon={TrendingUp} color="#6366f1" />
        <StatCard title={T.viewProfile} value={ranking[0]?.collector?.name || 'N/A'} icon={TrendingUp} color="#f37121" />
      </div>

      {/* Efficiency Chart */}
      {ranking.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.efficiency}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ranking.map((r) => ({ name: r.collector?.name?.split(' ')[0] || '', efficiency: r.efficiency, collected: r.totalCollected }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
              <Bar dataKey="efficiency" fill="#f37121" radius={[4, 4, 0, 0]} name={`${T.efficiency} %`} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ranking Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">#</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.name}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.target}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.totalCollected}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.assignedCustomers}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{txx.extra}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.efficiency}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{txx.promises}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{txx.fulfilled}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{txx.avgDelay}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{txx.activities}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 uppercase">{T.customers}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ranking.map((p, i) => (
                <tr
                  key={p.collector?._id || i}
                  className="hover:bg-slate-100 cursor-pointer transition-colors"
                  onClick={() => p.collector?._id && router.push(`/system/collectors/${p.collector._id}`)}
                >
                  <td className="px-4 py-3 text-sm text-slate-700 font-bold">#{i + 1}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{p.collector?.name}</span>
                      {p.collector?.role === 'admin' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-600">{txx.deptManager}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.target?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-green-600 font-medium">{p.totalCollected?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-cyan-700">{p.assignedCollected?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">
                    {(p.extraCollected || 0) > 0 ? (
                      <span className="text-[#f37121] font-medium">{p.extraCollected?.toLocaleString()}</span>
                    ) : (
                      <span className="text-slate-700">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      p.efficiency >= 80 ? 'bg-green-500/20 text-green-600' :
                      p.efficiency >= 50 ? 'bg-yellow-500/20 text-yellow-700' :
                      'bg-red-500/20 text-red-600'
                    }`}>{p.efficiency}%</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.totalPromises}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.promiseFulfillment}%</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.avgDelay}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.activityCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{p.assignedCustomers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
