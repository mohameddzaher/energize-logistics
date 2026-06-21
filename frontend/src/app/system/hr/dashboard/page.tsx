'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { LayoutDashboard, AlertTriangle } from 'lucide-react';
import { isHRStaff, empName, fmtDate, expiryBadge } from '@/lib/hr';
import { Spinner, PageHeader, StatCard, SmallBadge } from '@/components/hr/HRKit';

interface Dash {
  summary: { totalEmployees: number; activeEmployees: number; pendingLeaves: number; openRequests: number; assignedAssets: number };
  expiringIqamas: { _id: string; firstName: string; lastName: string; iqamaNumber?: string; iqamaExpiry?: string }[];
  expiringContracts: { _id: string; employee: any; endDate?: string }[];
}

export default function HRDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isHRStaff(user?.role);

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api.get<Dash>('/api/hr/dashboard'); setData(d); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:leave', useCallback(() => load(), [load]));
  useSocket('hr:request', useCallback(() => load(), [load]));

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  const s = data?.summary;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-5 h-5" />} title={ar ? 'لوحة الموارد البشرية' : 'HR Dashboard'} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Link href="/system/hr/employees"><StatCard label={ar ? 'إجمالي الموظفين' : 'Total Employees'} value={s?.totalEmployees ?? 0} /></Link>
        <StatCard label={ar ? 'على رأس العمل' : 'Active'} value={s?.activeEmployees ?? 0} accent="text-green-600" />
        <Link href="/system/hr/leaves"><StatCard label={ar ? 'إجازات قيد المراجعة' : 'Pending Leaves'} value={s?.pendingLeaves ?? 0} accent="text-amber-700" /></Link>
        <Link href="/system/hr/requests"><StatCard label={ar ? 'طلبات مفتوحة' : 'Open Requests'} value={s?.openRequests ?? 0} accent="text-blue-600" /></Link>
        <Link href="/system/hr/custody"><StatCard label={ar ? 'عهد بعهدة الموظفين' : 'Assigned Custody'} value={s?.assignedAssets ?? 0} /></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><AlertTriangle className="w-4 h-4 text-amber-700" /> {ar ? 'إقامات قرب الانتهاء (٦٠ يوم)' : 'Iqamas Expiring (60 days)'}</div>
          {(!data?.expiringIqamas?.length) ? <p className="text-slate-500 text-sm p-6 text-center">{ar ? 'لا يوجد' : 'None'}</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data!.expiringIqamas.map((e) => {
                  const b = expiryBadge(e.iqamaExpiry, lang);
                  return (
                    <tr key={e._id} className="border-b border-slate-200/70">
                      <td className="px-4 py-2.5"><Link href={`/system/hr/employees/${e._id}`} className="text-slate-900 hover:text-[#f37121]">{empName(e, lang)}</Link></td>
                      <td className="px-4 py-2.5 text-slate-500">{e.iqamaNumber || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(e.iqamaExpiry)}</td>
                      <td className="px-4 py-2.5 text-end">{b && <SmallBadge bg={b.bg} text={b.text} label={b.label} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><AlertTriangle className="w-4 h-4 text-amber-700" /> {ar ? 'عقود قرب الانتهاء (٦٠ يوم)' : 'Contracts Expiring (60 days)'}</div>
          {(!data?.expiringContracts?.length) ? <p className="text-slate-500 text-sm p-6 text-center">{ar ? 'لا يوجد' : 'None'}</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data!.expiringContracts.map((c) => {
                  const b = expiryBadge(c.endDate, lang);
                  const empId = typeof c.employee === 'object' ? c.employee?._id : c.employee;
                  return (
                    <tr key={c._id} className="border-b border-slate-200/70">
                      <td className="px-4 py-2.5"><Link href={`/system/hr/employees/${empId}`} className="text-slate-900 hover:text-[#f37121]">{empName(c.employee, lang)}</Link></td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(c.endDate)}</td>
                      <td className="px-4 py-2.5 text-end">{b && <SmallBadge bg={b.bg} text={b.text} label={b.label} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
