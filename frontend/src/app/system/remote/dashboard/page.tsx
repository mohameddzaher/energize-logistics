'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { CalendarDays, Clock, Plane, Hourglass, RefreshCw } from 'lucide-react';
import { isRemoteStaff, fmtDuration } from '@/lib/remote';

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
  const staff = isRemoteStaff(user?.role);

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
    { icon: <CalendarDays className="w-6 h-6" />, label: ar ? 'أيام العمل' : 'Days Worked', value: data?.summary.daysWorked ?? 0, color: 'text-blue-400 bg-blue-500/10' },
    { icon: <Clock className="w-6 h-6" />, label: ar ? 'إجمالي الساعات' : 'Total Hours', value: data ? fmtDuration(data.summary.totalMinutes, ar ? 'ar' : 'en') : '—', color: 'text-green-400 bg-green-500/10' },
    { icon: <Plane className="w-6 h-6" />, label: ar ? 'أيام الإجازات' : 'Leave Days', value: data?.summary.leaveDays ?? 0, color: 'text-purple-400 bg-purple-500/10' },
    { icon: <Hourglass className="w-6 h-6" />, label: ar ? 'إجازات معلقة' : 'Pending Leaves', value: data?.summary.pendingLeaves ?? 0, color: 'text-amber-400 bg-amber-500/10' },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{staff ? (ar ? 'لوحة فريق العمل عن بُعد' : 'Remote Team Dashboard') : (ar ? 'لوحتي' : 'My Dashboard')}</h1>
        <button type="button" onClick={load} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {staff && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-gray-400 text-xs mb-1">{ar ? 'الموظف' : 'Employee'}</label>
            <select aria-label="Employee" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm">
              <option value="">{ar ? 'كل الفريق' : 'Whole team'}</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1">{ar ? 'من' : 'From'}</label>
            <input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1">{ar ? 'إلى' : 'To'}</label>
            <input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((c, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-gray-800 border border-gray-700 rounded-xl p-5">
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.color}`}>{c.icon}</div>
                <p className="text-gray-400 text-sm mt-3">{c.label}</p>
                <p className="text-white text-2xl font-bold mt-1">{c.value}</p>
              </motion.div>
            ))}
          </div>

          {staff && data && data.perEmployee.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-700"><h2 className="text-white font-semibold">{ar ? 'تفصيل لكل موظف' : 'Per-Employee Breakdown'}</h2></div>
              <table className="w-full text-sm">
                <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="text-start px-4 py-3">{ar ? 'الموظف' : 'Employee'}</th>
                    <th className="text-start px-4 py-3">{ar ? 'أيام العمل' : 'Days'}</th>
                    <th className="text-start px-4 py-3">{ar ? 'الساعات' : 'Hours'}</th>
                    <th className="text-start px-4 py-3">{ar ? 'الإجازات' : 'Leave Days'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perEmployee.map((p) => (
                    <tr key={p.userId} className="border-t border-gray-700/50">
                      <td className="px-4 py-3 text-white">{p.name}</td>
                      <td className="px-4 py-3 text-gray-300">{p.daysWorked}</td>
                      <td className="px-4 py-3 text-gray-300">{fmtDuration(p.totalMinutes, ar ? 'ar' : 'en')}</td>
                      <td className="px-4 py-3 text-gray-300">{p.leaveDays}</td>
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
