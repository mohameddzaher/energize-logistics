'use client';
// تقييم أداء السائقين — Location Solutions.
//
// Scores every driver on what the trucks themselves reported: عدد الرحلات،
// مدة الوصول، مدة التحميل والانتظار، أيام العمل، المسافة، والالتزام بالسرعة.
//
// Two depths on purpose. The default pass uses the daily-odometer mirror we
// already store, so the page opens instantly. "التحليل التفصيلي" additionally
// runs Wialon's trip report for each truck — that is one upstream report per
// truck, so it is a button, not a default. One driver's own card is always deep.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Target, Search, ChevronDown, ChevronRight, Loader2, Gauge, Timer,
  PackageCheck, TrendingUp, RefreshCw, Zap,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ScoreBadge, ScoreBar, ScoreBreakdown, BandLegend, KpiTile, type ScoreBand, type ScoreBreakdownItem } from '@/components/system/Scorecard';
import { isLs2Staff, thisMonthToDate, type Lang, type DateRange } from '@/lib/ls2';
import ReportButton from '@/components/system/ReportButton';

interface DriverScore {
  driver: string;
  km: number;
  activeDays: number;
  periodDays: number;
  vehicleCount: number;
  vehicles: { unitId: number; plate: string; km: number }[];
  currentVehicle: { unitId: number; plate: string } | null;
  trips: number | null;
  avgTripHours: number | null;
  avgLoadingHours: number | null;
  maxSpeed: number | null;
  score: number;
  band: string;
  bandAr: string;
  bandEn: string;
  bandColor: string;
  depth: 'deep' | 'basic';
  provisional: boolean;
  breakdown: ScoreBreakdownItem[];
}

interface Payload {
  from: string; to: string; periodDays: number; depth: 'deep' | 'basic';
  speedLimitKmh: number;
  bands: ScoreBand[];
  targets: Record<string, number>;
  summary: {
    drivers: number; averageScore: number;
    excellent: number | null; weak: number | null; provisional: boolean;
    activeDrivers: number; idleDrivers: number;
    totalKm: number; totalTrips: number;
  };
  items: DriverScore[];
}

interface DriverDetail {
  driver: string;
  km: number; activeDays: number; periodDays: number;
  score: number; bandAr: string; bandEn: string; bandColor: string;
  breakdown: ScoreBreakdownItem[];
  metrics: {
    tripCount: number; totalKm: number; drivingHours: number;
    avgTripHours: number; avgTripKm: number;
    stopCount: number; loadingHours: number; avgLoadingHours: number; longestLoadingHours: number;
    maxSpeed: number;
  } | null;
  trips: { beginTime: string | null; endTime: string | null; beginLocation: string; endLocation: string; km: number; durationSec: number | null; maxSpeed: number | null; plate: string }[];
  stops: { location: string; from: string | null; to: string | null; durationSec: number; plate: string }[];
}

const hrs = (sec: number | null) => (sec == null ? '—' : `${Math.round((sec / 3600) * 10) / 10}س`);

export default function Ls2DriverPerformancePage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [deep, setDeep] = useState(false);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, DriverDetail>>({});
  const [detailBusy, setDetailBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Payload>(`/api/ls2/drivers/performance?from=${range.from}&to=${range.to}${deep ? '&deep=1' : ''}`);
      setData(r);
    } catch { /* keep the previous page rather than blanking it */ }
    setLoading(false);
  }, [range.from, range.to, deep]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (name: string) => {
    if (open === name) { setOpen(null); return; }
    setOpen(name);
    if (detail[name]) return;
    setDetailBusy(name);
    try {
      const r = await api.get<DriverDetail>(`/api/ls2/drivers/performance/${encodeURIComponent(name)}?from=${range.from}&to=${range.to}`);
      setDetail((p) => ({ ...p, [name]: r }));
    } catch { /* the row still shows the summary it already has */ }
    setDetailBusy('');
  };

  // Changing the period invalidates every cached driver card.
  useEffect(() => { setDetail({}); setOpen(null); }, [range.from, range.to]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data?.items || [];
    if (!s) return list;
    return list.filter((d) => `${d.driver} ${d.currentVehicle?.plate || ''}`.toLowerCase().includes(s));
  }, [data, q]);

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{tx('Not authorized', 'غير مصرّح')}</div>;
  if (loading && !data) return <Spinner />;

  const exportColumns: ExportColumn[] = [
    { header: tx('Driver', 'السائق'), key: 'driver', width: 26 },
    { header: tx('Score', 'التقييم'), key: 'score', width: 10 },
    { header: tx('Band', 'التصنيف'), key: ar ? 'bandAr' : 'bandEn', width: 14 },
    { header: tx('Trips', 'عدد الرحلات'), key: 'trips', transform: (v) => v ?? '—', width: 12 },
    { header: tx('Avg trip (h)', 'متوسط مدة الرحلة (س)'), key: 'avgTripHours', transform: (v) => v ?? '—', width: 18 },
    { header: tx('Avg loading (h)', 'متوسط التحميل (س)'), key: 'avgLoadingHours', transform: (v) => v ?? '—', width: 18 },
    { header: tx('Distance (km)', 'المسافة (كم)'), key: 'km', transform: (v) => Math.round(v || 0), width: 14 },
    { header: tx('Active days', 'أيام العمل'), key: 'activeDays', width: 12 },
    { header: tx('Max speed', 'أقصى سرعة'), key: 'maxSpeed', transform: (v) => v ?? '—', width: 12 },
    { header: tx('Current truck', 'المركبة الحالية'), key: 'currentVehicle', transform: (v: any) => v?.plate || '—', width: 16 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Target className="w-5 h-5 text-[#f37121]" />}
        title={tx('Driver performance', 'تقييم أداء السائقين')}
        subtitle={tx(
          'Scored from telemetry: trips, delivery time, loading time, working days, distance and speed discipline.',
          'تقييم من بيانات التتبّع: عدد الرحلات، مدة الوصول، مدة التحميل، أيام العمل، المسافة، والالتزام بالسرعة.'
        )}
      >
        <ExportMenu
          fileName={`driver-performance-${range.from}_${range.to}`}
          lang={lang as Lang}
          options={[
            { key: 'view', label: tx('Export the current view', 'تصدير المعروض'), sheets: [{ name: `${range.from} → ${range.to}`, rows: items as unknown as Record<string, any>[], columns: exportColumns }] },
            { key: 'all', label: tx('Export all drivers', 'تصدير كل السائقين'), sheets: [{ name: `${range.from} → ${range.to}`, rows: (data?.items || []) as unknown as Record<string, any>[], columns: exportColumns }] },
          ]}
        />
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={tx('From', 'من')} labelTo={tx('To', 'إلى')} />

      {/* Depth switch. The cost of the deep pass is stated plainly rather than
          hidden behind a spinner the user can't explain. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3 shadow-sm">
        <button
          type="button"
          onClick={() => setDeep((d) => !d)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
            deep ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          {tx('Detailed analysis (trip reports)', 'التحليل التفصيلي (تقارير الرحلات)')}
        </button>
        <span className="text-[11px] text-slate-500">
          {deep
            ? tx('Trips, delivery time and loading time are measured for every driver.', 'يتم قياس عدد الرحلات ومدة الوصول ومدة التحميل لكل سائق.')
            : tx('Quick mode: distance and working days only. Open a driver for their full card.', 'الوضع السريع: المسافة وأيام العمل فقط. افتح أي سائق لعرض بطاقته الكاملة.')}
        </span>
        <button type="button" onClick={load} className="ms-auto inline-flex items-center gap-1.5 text-slate-600 text-xs border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {tx('Refresh', 'تحديث')}
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label={tx('Drivers', 'السائقون')} value={data.summary.drivers} icon={<Gauge className="w-4 h-4" />} />
            <KpiTile label={tx('Average score', 'متوسط التقييم')} value={data.summary.averageScore} accent="#22c55e" icon={<TrendingUp className="w-4 h-4" />} />
            {data.depth === 'deep' ? (
              <>
                <KpiTile label={tx('Excellent', 'ممتاز')} value={data.summary.excellent ?? 0} accent="#16a34a" sub={tx('score ≥ 90', 'تقييم ≥ ٩٠')} icon={<PackageCheck className="w-4 h-4" />} />
                <KpiTile label={tx('Needs improvement', 'يحتاج تحسين')} value={data.summary.weak ?? 0} accent="#ef4444" sub={tx('score < 45', 'تقييم < ٤٥')} icon={<Timer className="w-4 h-4" />} />
              </>
            ) : (
              <>
                <KpiTile label={tx('Worked in period', 'عملوا في الفترة')} value={data.summary.activeDrivers} accent="#22c55e" icon={<PackageCheck className="w-4 h-4" />} />
                <KpiTile label={tx('No activity', 'بلا نشاط')} value={data.summary.idleDrivers} accent="#94a3b8" icon={<Timer className="w-4 h-4" />} />
              </>
            )}
            <KpiTile
              label={data.depth === 'deep' ? tx('Trips in period', 'رحلات الفترة') : tx('Distance (km)', 'المسافة (كم)')}
              value={(data.depth === 'deep' ? data.summary.totalTrips : data.summary.totalKm).toLocaleString()}
              icon={<Target className="w-4 h-4" />}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-4">
            {data.depth === 'deep' ? (
              <BandLegend bands={data.bands} lang={ar ? 'ar' : 'en'} />
            ) : (
              <span className="text-[11px] text-slate-500">
                {tx(
                  'Quick mode measures working days and distance only — the number is a provisional activity index, not a grade. Turn on the detailed analysis for the full score.',
                  'الوضع السريع يقيس أيام العمل والمسافة فقط — الرقم مؤشر نشاط مبدئي وليس تقييمًا نهائيًا. فعّل التحليل التفصيلي للتقييم الكامل.'
                )}
              </span>
            )}
            <span className="text-[11px] text-slate-400 ms-auto">
              {tx('Speed limit', 'حد السرعة')}: {data.speedLimitKmh} km/h · {tx('Period', 'الفترة')}: {data.periodDays} {tx('days', 'يوم')}
            </span>
          </div>
        </>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx('Search driver or plate…', 'ابحث باسم السائق أو اللوحة…')}
          className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Driver', 'السائق')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase w-52">
                  {data?.depth === 'deep' ? tx('Score', 'التقييم') : tx('Activity index (provisional)', 'مؤشر النشاط (مبدئي)')}
                </th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Trips', 'الرحلات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Delivery time', 'مدة الوصول')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Loading time', 'مدة التحميل')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Distance', 'المسافة')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Days', 'أيام العمل')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Truck', 'المركبة')}</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((d) => {
                const isOpen = open === d.driver;
                const det = detail[d.driver];
                return (
                  <Fragment key={d.driver}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggle(d.driver)}>
                      <td className="px-3 py-2 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-900 font-medium">{d.driver}</td>
                      <td className="px-3 py-2">
                        <ScoreBadge score={d.score} band={ar ? d.bandAr : d.bandEn} color={d.bandColor} size="sm" />
                        <div className="mt-1"><ScoreBar value={d.score} color={d.bandColor} height={4} /></div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{d.trips ?? '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{d.avgTripHours != null ? `${d.avgTripHours}س` : '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{d.avgLoadingHours != null ? `${d.avgLoadingHours}س` : '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{Math.round(d.km).toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{d.activeDays}/{d.periodDays}</td>
                      <td className="px-3 py-2 text-sm text-slate-500">{d.currentVehicle?.plate || '—'}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <ReportButton subject="driver" id={d.driver} from={range.from} to={range.to} compact />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={10} className="px-5 py-4">
                          {detailBusy === d.driver && !det ? (
                            <div className="flex items-center gap-2 text-slate-500 text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {tx('Reading the trip reports for this driver…', 'جارٍ قراءة تقارير الرحلات لهذا السائق…')}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {det?.metrics && (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                                  <Mini label={tx('Trips', 'رحلات')} value={det.metrics.tripCount} />
                                  <Mini label={tx('Avg trip', 'متوسط الرحلة')} value={`${det.metrics.avgTripHours}س`} />
                                  <Mini label={tx('Avg trip km', 'متوسط كم/رحلة')} value={det.metrics.avgTripKm} />
                                  <Mini label={tx('Driving', 'ساعات القيادة')} value={`${det.metrics.drivingHours}س`} />
                                  <Mini label={tx('Avg loading', 'متوسط التحميل')} value={`${det.metrics.avgLoadingHours}س`} />
                                  <Mini label={tx('Longest wait', 'أطول انتظار')} value={`${det.metrics.longestLoadingHours}س`} />
                                  <Mini label={tx('Max speed', 'أقصى سرعة')} value={det.metrics.maxSpeed} />
                                </div>
                              )}
                              <ScoreBreakdown items={det?.breakdown || d.breakdown} lang={ar ? 'ar' : 'en'} color={d.bandColor} />
                              {!!det?.stops?.length && (
                                <div>
                                  <p className="text-slate-700 text-xs font-semibold mb-1.5">{tx('Longest stops (loading / waiting)', 'أطول فترات التوقف (تحميل / انتظار)')}</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                    {det.stops.slice(0, 6).map((s, i) => (
                                      <div key={i} className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                                        <span className="text-slate-600 truncate">{s.location || '—'}</span>
                                        <span className="text-slate-900 font-medium shrink-0">{hrs(s.durationSec)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {!!det?.trips?.length && (
                                <div>
                                  <p className="text-slate-700 text-xs font-semibold mb-1.5">{tx('Recent trips', 'أحدث الرحلات')}</p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full min-w-[560px] text-[11px]">
                                      <thead>
                                        <tr className="text-slate-400">
                                          <th className="text-start font-medium py-1">{tx('From', 'من')}</th>
                                          <th className="text-start font-medium py-1">{tx('To', 'إلى')}</th>
                                          <th className="text-start font-medium py-1">{tx('Km', 'كم')}</th>
                                          <th className="text-start font-medium py-1">{tx('Duration', 'المدة')}</th>
                                          <th className="text-start font-medium py-1">{tx('Max speed', 'أقصى سرعة')}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="text-slate-600">
                                        {det.trips.slice(0, 10).map((t, i) => (
                                          <tr key={i} className="border-t border-slate-100">
                                            <td className="py-1 pe-2 truncate max-w-[180px]">{t.beginLocation || '—'}</td>
                                            <td className="py-1 pe-2 truncate max-w-[180px]">{t.endLocation || '—'}</td>
                                            <td className="py-1 pe-2 tabular-nums">{Math.round(t.km)}</td>
                                            <td className="py-1 pe-2 tabular-nums">{hrs(t.durationSec)}</td>
                                            <td className="py-1 tabular-nums">{t.maxSpeed ?? '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('No drivers in this period', 'لا يوجد سائقون في هذه الفترة')}</td></tr>
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
