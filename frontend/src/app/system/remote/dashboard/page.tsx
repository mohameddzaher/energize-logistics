'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { CalendarDays, Clock, Plane, Hourglass, RefreshCw, Download } from 'lucide-react';
import { isRemoteStaff, fmtDuration } from '@/lib/remote';
import { getRemoteDashboardTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

interface PerEmployee { userId: string; name: string; daysWorked: number; totalMinutes: number; leaveDays: number }
interface DashData {
  scope: 'self' | 'team';
  summary: { daysWorked: number; totalMinutes: number; totalHours: number; leaveDays: number; pendingLeaves: number };
  perEmployee: PerEmployee[];
}
interface EmployeeOpt { _id: string; firstName: string; lastName: string }

export default function RemoteDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getRemoteDashboardTranslations(lang);
  const staff = isRemoteStaff(user);

  const [data, setData] = useState<DashData | null>(null);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (userId) qs.set('userId', userId);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const d = await api.get<DashData>(`/api/remote/dashboard?${qs.toString()}`);
      setData(d);
    } catch {} finally { setLoading(false); }
  }, [userId, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (staff) api.get<{ employees: EmployeeOpt[] }>('/api/remote/employees').then((d) => setEmployees(d.employees || [])).catch(() => {});
  }, [staff]);

  const cards = [
    { icon: <CalendarDays className="w-6 h-6" />, label: tx.daysWorked, value: data?.summary.daysWorked ?? 0, color: 'text-blue-600 bg-blue-500/10' },
    { icon: <Clock className="w-6 h-6" />, label: tx.totalHours, value: data ? fmtDuration(data.summary.totalMinutes, ar ? 'ar' : 'en') : '—', color: 'text-green-600 bg-green-500/10' },
    { icon: <Plane className="w-6 h-6" />, label: tx.leaveDays, value: data?.summary.leaveDays ?? 0, color: 'text-purple-600 bg-purple-500/10' },
    { icon: <Hourglass className="w-6 h-6" />, label: tx.pendingLeaves, value: data?.summary.pendingLeaves ?? 0, color: 'text-amber-700 bg-amber-500/10' },
  ];

  const handleExport = () => {
    const rows = data?.perEmployee ?? [];
    exportToExcel(
      rows,
      [
        { header: tx.employee, key: 'name', width: 26 },
        { header: tx.colDays, key: 'daysWorked', width: 14 },
        { header: tx.colHours, key: 'totalMinutes', width: 16, transform: (v) => fmtDuration(v, ar ? 'ar' : 'en') },
        { header: tx.leaveDays, key: 'leaveDays', width: 14 },
      ],
      'remote-dashboard',
      tx.perEmployeeBreakdown,
    );
  };

  const canExport = staff && !!data && data.perEmployee.length > 0;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{staff ? tx.teamDashboardTitle : tx.myDashboardTitle}</h1>
        <div className="flex items-center gap-2">
          {canExport && (
            <button type="button" onClick={handleExport} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
              <Download className="w-4 h-4" />{ar ? 'تصدير Excel' : 'Export Excel'}
            </button>
          )}
          <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title={tx.refresh}><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {staff && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 shadow-sm">
          <div>
            <label className="block text-slate-500 text-xs mb-1">{tx.employee}</label>
            <select aria-label={tx.employee} value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
              <option value="">{tx.wholeTeam}</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 text-xs mb-1">{tx.from}</label>
            <input aria-label={tx.from} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
          </div>
          <div>
            <label className="block text-slate-500 text-xs mb-1">{tx.to}</label>
            <input aria-label={tx.to} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((c, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.color}`}>{c.icon}</div>
                <p className="text-slate-500 text-sm mt-3">{c.label}</p>
                <p className="text-slate-900 text-2xl font-bold mt-1">{c.value}</p>
              </motion.div>
            ))}
          </div>

          {staff && data && data.perEmployee.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200"><h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.perEmployeeBreakdown}</h2></div>
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-300 text-xs uppercase">
                  <tr>
                    <th className="text-start px-4 py-3">{tx.employee}</th>
                    <th className="text-start px-4 py-3">{tx.colDays}</th>
                    <th className="text-start px-4 py-3">{tx.colHours}</th>
                    <th className="text-start px-4 py-3">{tx.leaveDays}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perEmployee.map((p) => (
                    <tr key={p.userId} className="border-t border-slate-200/70">
                      <td className="px-4 py-3 text-slate-900">{p.name}</td>
                      <td className="px-4 py-3 text-slate-700">{p.daysWorked}</td>
                      <td className="px-4 py-3 text-slate-700">{fmtDuration(p.totalMinutes, ar ? 'ar' : 'en')}</td>
                      <td className="px-4 py-3 text-slate-700">{p.leaveDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
