'use client';
// تحليل سيارةٍ واحدة عبر فترة — «أضغط على العربية فيطلع لي كل حاجة عنها».
//
// كانت شاشة التحليلات تجيب عن الأسطول كلّه ولا تُفتَح سيارةٌ منها، فمَن أراد
// سيارةً بعينها بحث باسم لوحتها في شاشةٍ مداها الشهر الحالي فخرجت أصفارًا.
// هنا السيارة هي الموضوع: الفترة تُختار، وكل رقمٍ يخصّها وحدها.
//
// والأرقام تُجمَّع في الخادم لا هنا: سيارةٌ واحدة عبر سنةٍ قد تحمل مئات
// الحمولات، وجرُّها كلّها إلى المتصفّح ليجمعها هو ما يجعل الصفحة تثقل ثم تكذب
// حين يُقتطَع السجلّ عند سقفٍ ما.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Spinner, PageHeader, StatCard, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu, { type ExportSheet } from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, periodFromParams, type Period } from '@/components/fleet/PeriodFilter';
import { useFleetLookups } from '@/hooks/useFleetLookups';
import {
  type FleetVehicleAnalytics, fleetStatus, fleetStatusLabel, fmtD, fmtDT,
  canViewFleet, money, shipmentCustomerId, type Lang,
} from '@/lib/fleet';
import { Car, ArrowLeft, Route, Users, Target, PackageSearch, Wrench, ExternalLink } from 'lucide-react';

const ORANGE = '#f37121';

function VehicleAnalyticsInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const lkp = useFleetLookups(ar);
  const router = useRouter();
  const sp = useSearchParams();
  const routeParams = useParams();
  const id = String(routeParams?.id || '');

  const [d, setD] = useState<FleetVehicleAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));

  const params = useMemo(() => periodParams(period), [period]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setD(await api.get<FleetVehicleAnalytics>(`/api/fleet/vehicles/${id}/analytics?${new URLSearchParams(params)}`));
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [id, params]);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));

  useEffect(() => {
    const qs = new URLSearchParams(params).toString();
    router.replace(`/system/fleet/vehicles/${id}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [params, router, id]);

  const shipCols = [
    { header: 'Waybill', key: 'waybillNumber', width: 10 },
    { header: 'Load date', key: 'loadDate', transform: (v: any, r: any) => fmtD(v || r.createdAt), width: 13 },
    { header: 'Customer', key: 'customerName', width: 24 },
    { header: 'From', key: 'fromCity', width: 13 },
    { header: 'To', key: 'toCity', width: 13 },
    { header: 'Driver', key: 'driverName', width: 18 },
    { header: 'Supervisor', key: 'supervisorName', width: 18 },
    { header: 'Load type', key: 'loadType', width: 15 },
    { header: 'Vehicle rent', key: 'price', width: 13 },
    { header: 'Full rent', key: 'fullRent', width: 13 },
    { header: 'Driver expense', key: 'driverExpense', width: 14 },
    { header: 'Status', key: 'status', transform: (v: any) => fleetStatusLabel(v, 'en'), width: 14 },
  ];
  const sheets: ExportSheet[] = d ? [
    { name: ar ? 'الرحلات' : 'Trips', rows: d.shipments as any[], columns: shipCols },
    { name: ar ? 'المسارات' : 'Routes', rows: d.byRoute as any[], columns: [
      { header: 'From', key: 'fromCity', width: 16 }, { header: 'To', key: 'toCity', width: 16 },
      { header: 'Trips', key: 'trips', width: 10 }, { header: 'Income', key: 'income', width: 14 }, { header: 'Driver expense', key: 'driverExpense', width: 14 } ] },
    { name: ar ? 'العملاء' : 'Customers', rows: d.byCustomer as any[], columns: [
      { header: 'Customer', key: 'name', width: 28 }, { header: 'Trips', key: 'trips', width: 10 },
      { header: 'Income', key: 'income', width: 14 }, { header: 'Driver expense', key: 'driverExpense', width: 14 } ] },
    { name: ar ? 'الترند الشهري' : 'Monthly', rows: d.monthlyTrend as any[], columns: [
      { header: 'Month', key: 'month', width: 12 }, { header: 'Trips', key: 'trips', width: 10 },
      { header: 'Income', key: 'income', width: 14 }, { header: 'Driver expense', key: 'driverExpense', width: 14 } ] },
  ] : [];

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading && !d) return <Spinner />;
  if (error && !d) return <div className="p-6"><ErrorNotice error={error} lang={lang} onRetry={load} /></div>;
  if (!d) return <Spinner />;

  const v = d.vehicle;
  const t = d.totals;
  const th = 'text-start font-semibold px-3 py-3 whitespace-nowrap';
  const cardCls = 'bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm';
  // رابط الفترة يُمرَّر إلى شاشة الحمولات كما هو، فلا يفتح المستخدمُ فترةً غير
  // التي كان ينظر إليها ثم يقارن رقمين لا يخصّان بعضهما.
  const periodQS = new URLSearchParams(params).toString();

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Car className="w-5 h-5" />}
        title={`${ar ? 'تحليل السيارة' : 'Vehicle analysis'} — ${v.plate}`}
        subtitle={[v.name, v.trailerType, v.gpsType, v.supervisorName && `${ar ? 'المشرف: ' : 'Supervisor: '}${v.supervisorName}`].filter(Boolean).join(' · ')}>
        <Link href={`/system/fleet/loads-analysis?vehicle=${id}${periodQS ? `&${periodQS}` : ''}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
          <PackageSearch className="w-4 h-4" /> {ar ? 'حمولاتها في تحليل الحمولات' : 'Its loads in loads analysis'}
        </Link>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`fleet-vehicle-${v.plate}`}
          options={[
            { key: 'all', label: ar ? 'التحليل كاملًا (كل الأوراق)' : 'Full analysis (all sheets)', sheets },
            { key: 'trips', label: ar ? 'الرحلات فقط' : 'Trips only', sheets: sheets.slice(0, 1) },
          ]} />
        <Link href="/system/fleet/vehicles" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> {ar ? 'كل السيارات' : 'All vehicles'}
        </Link>
      </PageHeader>

      {/* حالة السيارة الآن — التحليل يخصّ فترةً مضت، وهذا السطر يخصّ اللحظة. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          <span className="text-slate-500 text-xs">{ar ? 'السائقون:' : 'Drivers:'}</span>
          {v.drivers.length === 0
            ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">{ar ? 'بدون سائق' : 'No driver'}</span>
            : v.drivers.map((x) => (
              <span key={x._id} className={`px-2 py-0.5 rounded-lg text-[11px] ${x.working === false ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                {x.name}{x.working === false ? (ar ? ' · لا يعمل' : ' · off') : ''}
              </span>))}
        </div>
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-slate-400" />
          <span className="text-slate-500 text-xs">{ar ? 'الآن:' : 'Now:'}</span>
          {v.currentTrip ? (
            <Link href={`/system/fleet/${v.currentTrip._id}`} className="text-[#f37121] hover:underline font-medium">
              {ar ? 'بوليصة' : 'WB'} {v.currentTrip.waybillNumber} → {v.currentTrip.toCity || '—'}
              {v.currentTrip.expectedArrival ? ` · ${ar ? 'متوقع' : 'ETA'} ${fmtDT(v.currentTrip.expectedArrival, lang as Lang)}` : ''}
            </Link>
          ) : <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">{ar ? 'فاضية — بدون حمولة' : 'Idle — no load'}</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
      </div>

      <PeriodBanner period={d.period} lang={ar ? 'ar' : 'en'} count={t.trips} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={ar ? 'عدد الرحلات' : 'Trips'} value={t.trips} accent="text-[#f37121]" />
        <StatCard label={ar ? 'الدخل (إيجار السيارة)' : 'Income'} value={money(t.income)} accent="text-emerald-600" />
        <StatCard label={ar ? 'مصروف السائقين' : 'Driver expense'} value={money(t.driverExpense)} accent="text-amber-600" />
        <StatCard label={ar ? 'الصافي' : 'Net'} value={money(t.net)} />
        <StatCard label={ar ? 'متوسط دخل الرحلة' : 'Avg / trip'} value={money(t.avgTripIncome)} />
        <StatCard label={ar ? 'حصة قسم الفروع' : 'Branches’ share'} value={money(t.branchShare)} accent="text-blue-600" />
      </div>

      {/* الهدف: منسوبًا إلى عدد أشهر الفترة لا إلى شهرٍ واحد، وإلا بدت سيارةُ
          ثلاثة أشهرٍ محقِّقةً ٣٠٠٪ وهي على هدفها بالضبط. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <Target className="w-4 h-4 text-[#f37121]" />
          <p className="font-bold text-slate-900 text-sm">{ar ? 'مقابل الهدف' : 'Against target'}</p>
          <span className="text-xs text-slate-500">
            {ar ? `الهدف الشهري ${money(t.monthlyTarget)} × ${d.period.monthsInRange || 1} شهر = ${money(t.periodTarget)}` : `${money(t.monthlyTarget)} / month × ${d.period.monthsInRange || 1} = ${money(t.periodTarget)}`}
          </span>
          {t.achievedPct != null && (
            <span className={`ms-auto px-2.5 py-1 rounded-full text-xs font-bold ${t.achieved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.achievedPct}%</span>
          )}
        </div>
        <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${t.achieved ? 'bg-emerald-500' : 'bg-[#f37121]'}`}
            style={{ width: `${Math.max(0, Math.min(100, t.achievedPct ?? 0))}%` }} />
        </div>
      </div>

      {/* ── الحالة الفنّية: لوكيشن سوليوشن ومخزن النقل الثقيل ────────────────
          الأرقام فوق تقول ماذا كسبت الشاحنة؛ وهذه تقول هل تصلح أن تُشغَّل غدًا.
          والسؤالان يُقرَّران معًا أو لا يُقرَّران — ولهذا صارا شاشةً واحدة. */}
      {d.tech && (d.tech.ls2 || d.tech.partsCount > 0 || d.tech.mountedTires > 0) && (
        <div className={`rounded-2xl border p-4 shadow-sm ${d.tech.ls2?.maintenanceStatus === 'overdue' ? 'border-red-200 bg-red-50/40'
          : d.tech.ls2?.maintenanceStatus === 'due' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-slate-400" />
              {ar ? 'الحالة الفنّية — لوكيشن سوليوشن والمخزن' : 'Technical state — Location Solutions & store'}
            </p>
            <Link href={`/system/ls2/vehicles?q=${encodeURIComponent(d.vehicle.plate)}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> {ar ? 'فتحها في لوكيشن سوليوشن' : 'Open in Location Solutions'}
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">{ar ? 'الصيانة' : 'Maintenance'}</p>
              <p className={`font-bold text-sm mt-0.5 ${d.tech.ls2?.maintenanceStatus === 'overdue' ? 'text-red-600'
                : d.tech.ls2?.maintenanceStatus === 'due' ? 'text-amber-600' : 'text-emerald-600'}`}>
                {d.tech.ls2 ? (d.tech.ls2.maintenanceStatus === 'overdue' ? (ar ? 'متأخّرة' : 'Overdue')
                  : d.tech.ls2.maintenanceStatus === 'due' ? (ar ? 'مستحقّة' : 'Due') : (ar ? 'سليمة' : 'OK')) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">{ar ? 'المتبقّي للصيانة' : 'Km to service'}</p>
              <p className="font-bold text-sm mt-0.5 text-slate-800">
                {d.tech.ls2?.kmToService != null
                  ? `${money(d.tech.ls2.kmToService)} ${ar ? 'كم' : 'km'}`
                  : '—'}
              </p>
              {!!d.tech.ls2?.nextServiceName && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{d.tech.ls2.nextServiceName}</p>}
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">{ar ? 'العدّاد' : 'Odometer'}</p>
              <p className="font-bold text-sm mt-0.5 text-slate-800">{d.tech.ls2?.odometerKm != null ? money(d.tech.ls2.odometerKm) : '—'}</p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">{ar ? 'إطاراتٌ مركّبة' : 'Mounted tyres'}</p>
              <p className="font-bold text-sm mt-0.5 text-slate-800">{d.tech.mountedTires || '—'}</p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">{ar ? 'إصلاحاتٌ مفتوحة' : 'Open repairs'}</p>
              <p className={`font-bold text-sm mt-0.5 ${d.tech.openRepairs.length ? 'text-red-600' : 'text-slate-800'}`}>{d.tech.openRepairs.length || '—'}</p>
            </div>
          </div>

          {(d.tech.partsIssued.length > 0 || d.tech.recentServices.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {d.tech.partsIssued.length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">
                    {ar ? `قطعٌ صُرفت عليها من المخزن (${d.tech.partsCount})` : `Parts issued from the store (${d.tech.partsCount})`}
                  </p>
                  <ul className="space-y-1 max-h-52 overflow-y-auto">
                    {d.tech.partsIssued.slice(0, 20).map((m) => (
                      <li key={m._id} className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="text-slate-600 truncate">{m.itemName}</span>
                        <span className="shrink-0 text-slate-400">×{m.quantity} · {fmtD(m.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.tech.recentServices.length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">{ar ? 'آخر الصيانات' : 'Recent services'}</p>
                  <ul className="space-y-1 max-h-52 overflow-y-auto">
                    {d.tech.recentServices.map((sv) => (
                      <li key={sv._id} className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="text-slate-600 truncate">
                          {(sv.items || []).filter((i) => i.status === 'done').length || 0} {ar ? 'بندًا' : 'items'}
                          {sv.byName ? ` · ${sv.byName}` : ''}
                        </span>
                        <span className="shrink-0 text-slate-400">{fmtD(sv.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {d.monthlyTrend.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="font-bold text-slate-900 mb-3 text-sm">{ar ? 'أداء السيارة خلال آخر ١٢ شهرًا' : 'Last 12 months'}</p>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={d.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(x: number) => money(x)} />
              <Legend />
              <Bar yAxisId="l" dataKey="income" name={ar ? 'الدخل' : 'Income'} fill={ORANGE} radius={[4, 4, 0, 0]} />
              <Bar yAxisId="l" dataKey="driverExpense" name={ar ? 'المصروف' : 'Expense'} fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="trips" name={ar ? 'الرحلات' : 'Trips'} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={cardCls}>
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100"><p className="font-bold text-slate-900 text-sm">{ar ? 'المسارات التي سارتها' : 'Routes travelled'}</p></div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="table-head sticky top-0"><tr>
                {[ar ? 'المسار' : 'Route', ar ? 'الرحلات' : 'Trips', ar ? 'الدخل' : 'Income', ar ? 'المصروف' : 'Expense'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.byRoute.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">—</td></tr>}
                {d.byRoute.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.fromCity} ← <b>{r.toCity}</b></td>
                    <td className="px-3 py-2 tabular-nums">{r.trips}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-700 font-semibold">{money(r.income)}</td>
                    <td className="px-3 py-2 tabular-nums text-amber-700">{money(r.driverExpense)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={cardCls}>
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100"><p className="font-bold text-slate-900 text-sm">{ar ? 'العملاء الذين نقلت لهم' : 'Customers served'}</p></div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="table-head sticky top-0"><tr>
                {[ar ? 'العميل' : 'Customer', ar ? 'الرحلات' : 'Trips', ar ? 'الدخل' : 'Income', ar ? 'المصروف' : 'Expense'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.byCustomer.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">—</td></tr>}
                {d.byCustomer.map((c, i) => (
                  <tr key={c._id || i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{c._id ? <Link href={`/system/fleet/customers/${c._id}`} className="text-[#f37121] hover:underline">{c.name}</Link> : c.name}</td>
                    <td className="px-3 py-2 tabular-nums">{c.trips}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-700 font-semibold">{money(c.income)}</td>
                    <td className="px-3 py-2 tabular-nums text-amber-700">{money(c.driverExpense)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={cardCls}>
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <p className="font-bold text-slate-900">{ar ? 'رحلات السيارة في هذه الفترة' : 'Trips in this period'}</p>
          <span className="text-xs text-slate-500">({d.shipments.length})</span>
          {d.truncated && <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{ar ? 'المعروض مقتطع — المجاميع أعلاه كاملة' : 'Rows truncated — totals above are complete'}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              {[ar ? 'البوليصة' : 'Waybill', ar ? 'التاريخ' : 'Date', ar ? 'العميل' : 'Customer', ar ? 'المسار' : 'Route',
                ar ? 'السائق' : 'Driver', ar ? 'نوع الحمولة' : 'Load type', ar ? 'الإيجار' : 'Rent',
                ar ? 'مصروف السائق' : 'Driver expense', ar ? 'الحالة' : 'Status',
              ].map((h, i) => <th key={i} className={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {d.shipments.length === 0 && <tr><td colSpan={9} className="text-center text-slate-500 py-14">{ar ? 'لا رحلات لهذه السيارة ضمن الفترة المختارة.' : 'No trips for this vehicle in the selected period.'}</td></tr>}
              {d.shipments.map((s) => {
                const st = fleetStatus(s.status);
                const cid = shipmentCustomerId(s);
                return (
                  <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/fleet/${s._id}`)}>
                    <td className="px-3 py-3 font-mono font-bold text-slate-900">{s.waybillNumber}</td>
                    <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtD(s.loadDate || s.createdAt)}</td>
                    <td className="px-3 py-3 text-xs max-w-[180px] truncate" onClick={(e) => e.stopPropagation()}>
                      {cid ? <Link href={`/system/fleet/customers/${cid}`} className="text-[#f37121] hover:underline">{s.customerName || '—'}</Link> : (s.customerName || '—')}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap">{s.fromCity || '—'} ← {s.toCity || '—'}</td>
                    <td className="px-3 py-3 text-xs text-slate-700 max-w-[150px] truncate">{[s.driverName, s.secondDriverName].filter(Boolean).join(' + ') || '—'}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{lkp('fleet_load_type', s.loadType) || '—'}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                      {money(s.price)}{s.fullRent ? <span className="text-slate-400 font-normal"> / {money(s.fullRent)}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-amber-700 tabular-nums">{money(s.driverExpense)}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      <span className={`rounded-full px-2 py-1 font-medium ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}>{fleetStatusLabel(s.status, lang as Lang)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function FleetVehicleAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><VehicleAnalyticsInner /></Suspense>;
}
