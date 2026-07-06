'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { LayoutDashboard, AlertTriangle, UserPlus } from 'lucide-react';
import { isHRStaff, empName, fmtDate, expiryBadge } from '@/lib/hr';
import { Spinner, PageHeader, StatCard, SmallBadge } from '@/components/hr/HRKit';
import { getHrDashboardTranslations } from '@/lib/translations';

interface ExpiringDoc {
  employeeId: string; employeeName: string; arabicName?: string;
  docType: string; docEn: string; docAr: string; expiry: string; expired: boolean;
}
interface ExpiringLicense { _id: string; name: string; category: string; location?: string; expiryDate: string; expired: boolean; }
interface Dash {
  summary: {
    totalEmployees: number; activeEmployees: number; onLeaveCount: number; suspendedCount: number; terminatedCount: number;
    pendingLeaves: number; openRequests: number; assignedAssets: number; expiringDocsCount: number; expiredDocsCount: number;
    licensesTotal: number; licensesExpiringCount: number; licensesExpiredCount: number;
  };
  byDepartment: { name: string; count: number }[];
  byProject: { name: string; count: number }[];
  byNationality: { name: string; count: number }[];
  recentHires: { _id: string; firstName: string; lastName: string; arabicName?: string; jobTitle?: string; hireDate?: string }[];
  expiringDocs: ExpiringDoc[];
  expiringContracts: { _id: string; employee: any; endDate?: string }[];
  expiringLicenses: ExpiringLicense[];
}

export default function HRDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrDashboardTranslations(lang);
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
  useSocket('hr:contract', useCallback(() => load(), [load]));
  useSocket('hr:license', useCallback(() => load(), [load]));

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;
  const s = data?.summary;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-5 h-5" />} title={tx.pageTitle} />

      {/* Workforce stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Link href="/system/hr/employees"><StatCard label={tx.totalEmployees} value={s?.totalEmployees ?? 0} /></Link>
        <Link href="/system/hr/employees?status=active"><StatCard label={tx.active} value={s?.activeEmployees ?? 0} accent="text-green-600" /></Link>
        <Link href="/system/hr/employees?status=on_leave"><StatCard label={ar ? 'في إجازة' : 'On Leave'} value={s?.onLeaveCount ?? 0} accent="text-blue-600" /></Link>
        <Link href="/system/hr/employees?status=suspended"><StatCard label={ar ? 'موقوف' : 'Suspended'} value={s?.suspendedCount ?? 0} accent="text-amber-700" /></Link>
        <Link href="/system/hr/employees?status=terminated"><StatCard label={ar ? 'منتهي الخدمة' : 'Terminated'} value={s?.terminatedCount ?? 0} accent="text-red-600" /></Link>
      </div>

      {/* Operational stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/system/hr/leaves"><StatCard label={tx.pendingLeaves} value={s?.pendingLeaves ?? 0} accent="text-amber-700" /></Link>
        <Link href="/system/hr/requests"><StatCard label={tx.openRequests} value={s?.openRequests ?? 0} accent="text-blue-600" /></Link>
        <Link href="/system/hr/custody"><StatCard label={tx.assignedCustody} value={s?.assignedAssets ?? 0} /></Link>
        <StatCard label={ar ? 'مستندات تنتهي قريباً' : 'Docs expiring soon'} value={s?.expiringDocsCount ?? 0} accent={(s?.expiredDocsCount ?? 0) > 0 ? 'text-red-600' : 'text-amber-700'} />
      </div>

      {/* Licenses & subscriptions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/system/hr/licenses"><StatCard label={ar ? 'التراخيص والاشتراكات' : 'Licenses & Subscriptions'} value={s?.licensesTotal ?? 0} /></Link>
        <Link href="/system/hr/licenses"><StatCard label={ar ? 'تراخيص تنتهي خلال ٦٠ يوم' : 'Licenses expiring ≤60d'} value={s?.licensesExpiringCount ?? 0} accent="text-amber-700" /></Link>
        <Link href="/system/hr/licenses"><StatCard label={ar ? 'تراخيص منتهية' : 'Licenses expired'} value={s?.licensesExpiredCount ?? 0} accent="text-red-600" /></Link>
      </div>

      {/* Expiring documents (unified) + expiring contracts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><AlertTriangle className="w-4 h-4 text-amber-700" /> {ar ? 'مستندات قاربت على الانتهاء' : 'Documents expiring / expired'}</div>
          {(!data?.expiringDocs?.length) ? <p className="text-slate-500 text-sm p-6 text-center">{tx.none}</p> : (
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {data!.expiringDocs.map((d, i) => {
                    const b = expiryBadge(d.expiry, lang);
                    return (
                      <tr key={`${d.employeeId}-${d.docType}-${i}`} className="border-b border-slate-200/70 hover:bg-slate-50">
                        <td className="px-4 py-2.5"><Link href={`/system/hr/employees/${d.employeeId}`} className="text-slate-900 hover:text-[#f37121]">{ar ? (d.arabicName || d.employeeName) : d.employeeName}</Link></td>
                        <td className="px-4 py-2.5 text-slate-500">{ar ? d.docAr : d.docEn}</td>
                        <td className="px-4 py-2.5 text-slate-500">{fmtDate(d.expiry)}</td>
                        <td className="px-4 py-2.5 text-end">{b && <SmallBadge bg={b.bg} text={b.text} label={b.label} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><AlertTriangle className="w-4 h-4 text-amber-700" /> {tx.contractsExpiring}</div>
          {(!data?.expiringContracts?.length) ? <p className="text-slate-500 text-sm p-6 text-center">{tx.none}</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data!.expiringContracts.map((c) => {
                  const b = expiryBadge(c.endDate, lang);
                  const empId = typeof c.employee === 'object' ? c.employee?._id : c.employee;
                  return (
                    <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-50">
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

      {/* Licenses & subscriptions expiring / expired */}
      {!!data?.expiringLicenses?.length && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><AlertTriangle className="w-4 h-4 text-amber-700" /> {ar ? 'تراخيص واشتراكات قاربت على الانتهاء' : 'Licenses & subscriptions expiring / expired'}</div>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {data!.expiringLicenses.map((l) => {
                  const b = expiryBadge(l.expiryDate, lang);
                  return (
                    <tr key={l._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                      <td className="px-4 py-2.5"><Link href="/system/hr/licenses" className="text-slate-900 hover:text-[#f37121]">{l.name}</Link></td>
                      <td className="px-4 py-2.5 text-slate-500">{l.category}</td>
                      <td className="px-4 py-2.5 text-slate-500">{l.location || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(l.expiryDate)}</td>
                      <td className="px-4 py-2.5 text-end">{b && <SmallBadge bg={b.bg} text={b.text} label={b.label} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Breakdowns + recent hires */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <BreakdownCard title={ar ? 'حسب القسم' : 'By Department'} rows={data?.byDepartment || []} />
        <BreakdownCard title={ar ? 'حسب المشروع' : 'By Project'} rows={data?.byProject || []} />
        <BreakdownCard title={ar ? 'حسب الجنسية' : 'By Nationality'} rows={data?.byNationality || []} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-slate-900 font-semibold"><UserPlus className="w-4 h-4 text-[#f37121]" /> {ar ? 'أحدث التعيينات' : 'Recent Hires'}</div>
        {(!data?.recentHires?.length) ? <p className="text-slate-500 text-sm p-6 text-center">{tx.none}</p> : (
          <table className="w-full text-sm">
            <tbody>
              {data!.recentHires.map((e) => (
                <tr key={e._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-2.5"><Link href={`/system/hr/employees/${e._id}`} className="text-slate-900 hover:text-[#f37121]">{empName(e, lang)}</Link></td>
                  <td className="px-4 py-2.5 text-slate-500">{e.jobTitle || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-end">{fmtDate(e.hireDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-slate-900 font-semibold mb-3 text-sm">{title}</h3>
      {!rows.length ? <p className="text-slate-400 text-sm text-center py-4">—</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-slate-700 truncate">{r.name}</span>
                <span className="text-slate-500">{r.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-[#f37121] rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
