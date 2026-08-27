'use client';
// تقييم أداء السائقين — إدارة الأسطول.
//
// The business half of a driver's record: كام حمولة شال، عمل كام، وصل في الموعد
// ولا اتأخر، اتلغى منه كام، والمتابعة معاه كانت منتظمة ولا لأ.
//
// The telemetry half (how he actually drives — trip duration, loading time,
// speed) lives in Location Solutions → تقييم أداء السائقين. Same people, two
// questions; neither one answers the other.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  Target, Search, ChevronDown, ChevronRight, Truck, TrendingUp,
  AlertTriangle, Users, Phone, RefreshCw, Loader2,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ScoreBadge, ScoreBar, ScoreBreakdown, BandLegend, KpiTile, type ScoreBand, type ScoreBreakdownItem } from '@/components/system/Scorecard';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, type Period } from '@/components/fleet/PeriodFilter';
import ReportButton from '@/components/system/ReportButton';

interface DriverKpi {
  _id: string | null;
  name: string;
  phone: string; iqama: string; nationality: string;
  working: boolean | null; offReason: string; onSponsorship: boolean | null;
  vehicle: { _id: string; plate: string; name?: string } | null;
  trips: number; sharedTrips: number;
  income: number; fullRent: number; expense: number; net: number;
  avgTripIncome: number; tripsPerMonth: number;
  done: number; late: number; cancelled: number; inFlight: number;
  onTimeRate: number | null; completionRate: number; followUpRate: number | null;
  followUpsDone: number; followUpsExpected: number;
  firstTrip: string | null; lastTrip: string | null;
  score: number; band: string; bandAr: string; bandEn: string; bandColor: string;
  breakdown: ScoreBreakdownItem[];
  noActivity?: boolean;
}

interface Payload {
  period: { from: string; to: string; monthsInRange: number; preset?: string };
  bands: ScoreBand[];
  followUpTargetHours: number;
  summary: {
    drivers: number; activeDrivers: number; idleDrivers: number;
    totalTrips: number; totalIncome: number; totalExpense: number;
    averageScore: number; lateTrips: number;
  };
  items: DriverKpi[];
}

const FLEET_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'];
export default function FleetDriverKpisPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  // نفس عنصر الفترة المستعمل في بقية القسم — كان هنا منتقي شهرٍ وحده، فتعذّر
  // سؤالُ «كيف كان أداء السائقين أمس» أو «خلال هذا الأسبوع» أصلًا.
  const [period, setPeriod] = useState<Period>({ preset: 'this_month', from: '', to: '', day: '' });
  const [q, setQ] = useState('');
  const [showIdle, setShowIdle] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const periodQS = useMemo(() => new URLSearchParams(periodParams(period)).toString(), [period]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Payload>(`/api/fleet/driver-kpis?${periodQS}`));
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, [periodQS]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', load);

  const items = useMemo(() => {
    let list = data?.items || [];
    if (!showIdle) list = list.filter((d) => d.trips > 0);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((d) => `${d.name} ${d.vehicle?.plate || ''} ${d.phone}`.toLowerCase().includes(s));
    return list;
  }, [data, q, showIdle]);

  const allowed = user && (FLEET_ROLES.includes(user.role) || user.permissions?.['Fleet Management'] === 'view' || user.permissions?.['Fleet Management'] === 'edit');
  if (!allowed) return <div className="text-slate-500 p-8">{tx('Not authorized', 'غير مصرّح')}</div>;
  if (loading && !data) return <Spinner />;

  const exportColumns: ExportColumn[] = [
    { header: tx('Driver', 'السائق'), key: 'name', width: 26 },
    { header: tx('Score', 'التقييم'), key: 'score', width: 10 },
    { header: tx('Band', 'التصنيف'), key: ar ? 'bandAr' : 'bandEn', width: 14 },
    { header: tx('Loads', 'الحمولات'), key: 'trips', width: 10 },
    { header: tx('Income', 'الدخل'), key: 'income', transform: (v: number) => v?.toLocaleString(), width: 14 },
    { header: tx('Driver expense', 'مصروف السائق'), key: 'expense', transform: (v: number) => v?.toLocaleString(), width: 14 },
    { header: tx('Delivered', 'وصلت'), key: 'done', width: 10 },
    { header: tx('Late', 'متأخرة'), key: 'late', width: 10 },
    { header: tx('Cancelled', 'ملغاة', ), key: 'cancelled', width: 10 },
    { header: tx('On-time %', 'نسبة الالتزام %'), key: 'onTimeRate', transform: (v: number | null) => v ?? '—', width: 14 },
    { header: tx('Follow-up %', 'انتظام المتابعة %'), key: 'followUpRate', transform: (v: number | null) => v ?? '—', width: 16 },
    { header: tx('Truck', 'المركبة'), key: 'vehicle', transform: (v: any) => v?.plate || '—', width: 14 },
    { header: tx('Phone', 'الجوال'), key: 'phone', width: 16 },
  ];
  // البحثُ وإخفاءُ الخاملين يفلتران في الذاكرة على قائمة الفترة كلّها؛ من صدّر
  // وهو يظنّ أنّه أخذ السائقين جميعًا بينما البحث فعّالٌ يخرج بملفٍّ ناقصٍ صامت،
  // فصار لكلّ نطاقٍ عدّادُه الظاهر.
  const scope = exportScopeLabels(ar);
  const sheetName = tx('Driver KPIs', 'تقييم السائقين');
  const allRows = (data?.items || []) as unknown as Record<string, any>[];
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: items as unknown as Record<string, any>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: allRows, columns: exportColumns }] },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Target className="w-5 h-5 text-[#f37121]" />}
        title={tx('Driver KPIs', 'تقييم أداء السائقين')}
        subtitle={tx(
          'Loads carried, income generated, on-time arrival, cancellations and follow-up discipline.',
          'الحمولات المنفَّذة، الدخل المحقق، الوصول في الموعد، الإلغاءات، وانتظام المتابعة.'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-slate-600 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {tx('Refresh', 'تحديث')}
          </button>
          <ExportMenu fileName="fleet-driver-kpis" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')} options={exportOptions} />
        </div>
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} />
      </div>
      <PeriodBanner period={data?.period} lang={ar ? 'ar' : 'en'} count={data?.summary.totalTrips} />

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <KpiTile label={tx('Drivers', 'السائقون')} value={data.summary.drivers} icon={<Users className="w-4 h-4" />} />
            <KpiTile label={tx('Worked this period', 'عملوا في الفترة')} value={data.summary.activeDrivers} accent="#22c55e" sub={`${data.summary.idleDrivers} ${tx('idle', 'بدون حمولات')}`} icon={<Truck className="w-4 h-4" />} />
            <KpiTile label={tx('Average score', 'متوسط التقييم')} value={data.summary.averageScore} accent="#0ea5e9" icon={<TrendingUp className="w-4 h-4" />} />
            <KpiTile label={tx('Loads', 'الحمولات')} value={data.summary.totalTrips.toLocaleString()} icon={<Target className="w-4 h-4" />} />
            <KpiTile label={tx('Income', 'الدخل')} value={data.summary.totalIncome.toLocaleString()} accent="#16a34a" sub={`${tx('expenses', 'مصروفات')}: ${data.summary.totalExpense.toLocaleString()}`} />
            <KpiTile label={tx('Late loads', 'حمولات متأخرة')} value={data.summary.lateTrips} accent="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-4">
            <BandLegend bands={data.bands} lang={ar ? 'ar' : 'en'} />
            <span className="text-[11px] text-slate-400 ms-auto flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {tx('Follow-up cadence', 'دورة المتابعة')}: {tx('every', 'كل')} {data.followUpTargetHours} {tx('hours', 'ساعات')}
            </span>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx('Search driver, plate or phone…', 'ابحث بالاسم أو اللوحة أو الجوال…')}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} className="accent-[#f37121]" />
          {tx('Include drivers with no loads', 'إظهار السائقين بلا حمولات')}
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Driver', 'السائق')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase w-52">{tx('Score', 'التقييم')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Loads', 'الحمولات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Income', 'الدخل')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('On time', 'في الموعد')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Follow-up', 'المتابعة')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Truck', 'المركبة')}</th>
                <th className="px-3 py-2 w-10" />
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Status', 'الحالة')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((d) => {
                const key = d._id || d.name;
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr className={`hover:bg-slate-50 cursor-pointer ${d.noActivity ? 'opacity-60' : ''}`} onClick={() => setOpen(isOpen ? null : key)}>
                      <td className="px-3 py-2 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm text-slate-900 font-medium">{d.name}</p>
                        {d.phone && <p className="text-[11px] text-slate-400 tabular-nums">{d.phone}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <ScoreBadge score={d.score} band={ar ? d.bandAr : d.bandEn} color={d.bandColor} size="sm" />
                        <div className="mt-1"><ScoreBar value={d.score} color={d.bandColor} height={4} /></div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">
                        {d.trips}
                        {d.sharedTrips > 0 && <span className="text-[10px] text-slate-400 ms-1">({d.sharedTrips} {tx('shared', 'مشتركة')})</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{d.income.toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {d.onTimeRate == null ? <span className="text-slate-400">—</span>
                          : <span className={d.onTimeRate >= 80 ? 'text-green-600' : d.onTimeRate >= 50 ? 'text-amber-600' : 'text-red-600'}>{d.onTimeRate}%</span>}
                      </td>
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {d.followUpRate == null ? <span className="text-slate-400">—</span>
                          : <span className={d.followUpRate >= 80 ? 'text-green-600' : d.followUpRate >= 50 ? 'text-amber-600' : 'text-red-600'}>{d.followUpRate}%</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-500">{d.vehicle?.plate || '—'}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <ReportButton subject="driver" id={d.name} compact />
                      </td>
                      <td className="px-3 py-2">
                        {d.working === false
                          ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                            {d.offReason === 'sick' ? tx('Sick', 'مرضية') : d.offReason === 'leave' ? tx('On leave', 'إجازة') : tx('Off', 'متوقف')}
                          </span>
                          : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700">{tx('Working', 'على رأس العمل')}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={10} className="px-5 py-4 space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                            <Mini label={tx('Delivered', 'وصلت')} value={d.done} />
                            <Mini label={tx('Late', 'متأخرة')} value={d.late} />
                            <Mini label={tx('In transit', 'جارية')} value={d.inFlight} />
                            <Mini label={tx('Cancelled', 'ملغاة')} value={d.cancelled} />
                            <Mini label={tx('Avg per load', 'متوسط الحمولة')} value={d.avgTripIncome.toLocaleString()} />
                            <Mini label={tx('Expenses', 'مصروفاته')} value={d.expense.toLocaleString()} />
                            <Mini label={tx('Net', 'الصافي')} value={d.net.toLocaleString()} />
                          </div>
                          <ScoreBreakdown items={d.breakdown} lang={ar ? 'ar' : 'en'} color={d.bandColor} />
                          <p className="text-[11px] text-slate-400">
                            {tx('Follow-up calls', 'مكالمات المتابعة')}: {d.followUpsDone}/{d.followUpsExpected}
                            {d.lastTrip && <> · {tx('Last load', 'آخر حمولة')}: {new Date(d.lastTrip).toLocaleDateString()}</>}
                            {d.iqama && <> · {tx('Iqama', 'الإقامة')}: {d.iqama}</>}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('No drivers', 'لا يوجد سائقون')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{label}</p>
      <p className="text-slate-900 text-sm font-bold tabular-nums">{value ?? '—'}</p>
    </div>
  );
}
