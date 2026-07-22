'use client';
// لوحة تحليلات الأسطول — one screen for the operations lead. The follow-up
// debt sits ON TOP in amber, because an in-flight load nobody has called in
// three hours is the thing this section exists to prevent.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { BarChart3, AlertTriangle, PhoneCall } from 'lucide-react';
import { Spinner, PageHeader, StatCard, ErrorNotice } from '@/components/hr/HRKit';
import { FleetShipment, FLEET_STATUSES, fmtDT, hoursSince } from '@/lib/fleet';

interface DashboardData {
  byStatus: Record<string, number>;
  shipmentsToday: number;
  shipmentsWeek: number;
  bySupervisor: { name: string; count: number }[];
  drivers: { total: number; working: number; off: number; unassigned: number };
  vehicles: { total: number; withTwoDrivers: number; withOneDriver: number; withNoDriver: number };
  followupsToday: number;
  needFollowUp: FleetShipment[];
}

export default function FleetDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<DashboardData>('/api/fleet/dashboard');
      setData(d);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Every fleet mutation shifts at least one number here, so all four events reload.
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  useSocket('fleet:drivers', useCallback(() => load(), [load]));
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));
  useSocket('fleet:customers', useCallback(() => load(), [load]));

  // Formal Arabic hour phrasing follows the dual/plural rules — «منذ ساعتين»,
  // not a bare number glued to a noun.
  const hoursLabel = (v?: string | null) => {
    const h = hoursSince(v);
    if (h == null) return ar ? 'لم يُتواصَل معه بعد' : 'Not contacted yet';
    if (!ar) return h === 0 ? 'Less than an hour ago' : `${h}h ago`;
    if (h === 0) return 'منذ أقل من ساعة';
    if (h === 1) return 'منذ ساعة';
    if (h === 2) return 'منذ ساعتين';
    if (h <= 10) return `منذ ${h} ساعات`;
    return `منذ ${h} ساعة`;
  };

  if (loading) return <Spinner />;

  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';
  const supMax = Math.max(1, ...(data?.bySupervisor || []).map((s) => s.count));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={ar ? 'لوحة التحليلات' : 'Analytics dashboard'}
        subtitle={ar ? 'نظرة حية على الشحنات والسائقين والسيارات ومتابعات اليوم' : 'A live view of shipments, drivers, vehicles and today’s follow-ups'} />

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {data && (
        <>
          {/* The follow-up debt — deliberately first and loud. */}
          <div className="rounded-xl border border-amber-300 bg-amber-50 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="font-bold text-amber-900">{ar ? 'شحنات تحتاج متابعة' : 'Shipments needing follow-up'}</p>
              {data.needFollowUp.length > 0 && (
                <span className="bg-amber-600 text-white text-xs font-bold rounded-full px-2 py-0.5">{data.needFollowUp.length}</span>
              )}
              <p className="text-xs text-amber-700 ms-auto hidden sm:block">
                {ar ? 'شحنات جارية مضى على آخر تواصل معها ثلاث ساعات أو أكثر' : 'In-flight loads not contacted for 3+ hours'}
              </p>
            </div>
            {data.needFollowUp.length === 0 ? (
              <p className="px-4 py-6 text-sm text-amber-800">
                {ar ? 'لا توجد شحنات متأخرة عن المتابعة — جميع الشحنات الجارية جرى التواصل بشأنها حديثاً.' : 'Nothing overdue — every in-flight load was contacted recently.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white">
                  <thead><tr className="border-b border-amber-200 text-amber-900 bg-amber-100/60">
                    <th className={th}>{ar ? 'بوليصة' : 'Waybill'}</th>
                    <th className={th}>{ar ? 'العميل' : 'Customer'}</th>
                    <th className={th}>{ar ? 'السائق' : 'Driver'}</th>
                    <th className={th}>{ar ? 'اللوحة' : 'Plate'}</th>
                    <th className={th}>{ar ? 'آخر تواصل' : 'Last contact'}</th>
                  </tr></thead>
                  <tbody>
                    {data.needFollowUp.map((s) => (
                      <tr key={s._id} onClick={() => router.push(`/system/fleet/${s._id}`)}
                        className="border-b border-slate-200/70 hover:bg-amber-50 cursor-pointer">
                        <td className="px-4 py-3 font-mono font-bold text-[#f37121]">{s.waybillNumber}</td>
                        <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{s.customerName || '—'}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{s.driverName || '—'}</td>
                        <td className="px-4 py-3 text-slate-700 font-mono">{s.vehiclePlate || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-semibold text-amber-700">{hoursLabel(s.lastContactAt)}</span>
                          {s.lastContactAt && <span className="block text-xs text-slate-400">{fmtDT(s.lastContactAt, lang as 'ar' | 'en')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <StatCard label={ar ? 'شحنات اليوم' : 'Shipments today'} value={data.shipmentsToday} accent="text-[#f37121]" />
            <StatCard label={ar ? 'شحنات الأسبوع' : 'Shipments this week'} value={data.shipmentsWeek} />
            <StatCard label={ar ? 'متابعات اليوم' : 'Follow-ups today'} value={data.followupsToday} accent="text-emerald-600" />
            <StatCard label={ar ? 'السائقون العاملون' : 'Working drivers'} value={`${data.drivers.working} / ${data.drivers.total}`} />
            <StatCard label={ar ? 'سيارات بدون سائق' : 'Vehicles without a driver'} value={data.vehicles.withNoDriver}
              accent={data.vehicles.withNoDriver > 0 ? 'text-red-600' : 'text-emerald-600'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Status breakdown — same colour vocabulary as the shipments list. */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <p className="font-bold text-slate-900 mb-3">{ar ? 'الشحنات حسب الحالة' : 'Shipments by status'}</p>
              {Object.keys(data.byStatus).length === 0 ? (
                <p className="text-sm text-slate-400">{ar ? 'لا توجد شحنات بعد.' : 'No shipments yet.'}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {FLEET_STATUSES.filter((s) => data.byStatus[s.key]).map((s) => (
                    <span key={s.key} className={`px-2.5 py-1.5 rounded-lg text-sm font-medium ${s.bg} ${s.text}`}>
                      {ar ? s.ar : s.en} · <span className="font-bold">{data.byStatus[s.key]}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Who booked what this week — the supervisor workload at a glance. */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <p className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-[#f37121]" /> {ar ? 'شحنات الأسبوع حسب المشرف' : 'This week by supervisor'}
              </p>
              {data.bySupervisor.length === 0 ? (
                <p className="text-sm text-slate-400">{ar ? 'لا توجد شحنات هذا الأسبوع.' : 'No shipments this week.'}</p>
              ) : (
                <div className="space-y-2.5">
                  {data.bySupervisor.map((s) => (
                    <div key={s.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-slate-700 truncate">{s.name}</span>
                        <span className="font-bold text-slate-900 shrink-0 ms-2">{s.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-[#f37121]" style={{ width: `${Math.round((s.count / supMax) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
