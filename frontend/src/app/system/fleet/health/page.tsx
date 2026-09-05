'use client';
/**
 * حالةُ المركبات — أرقامُ شاحناتنا الحيّة في قسمِ من يقودها.
 *
 * ── ما كان يحدث ──────────────────────────────────────────────────────────────
 * الشاحناتُ شاحناتُنا ومَن يتابعها هو الأسطول، وأرقامُها الحيّة — ضغطُ الكاوتش
 * وحرارتُه وحرارةُ الماء والصيانةُ والتنبيهات — في قسمٍ آخر لا يفتحه مشرفُ
 * الأسطول ولا يملكه. فكان يُتَّصل بالهاتف: «شوف الفلانيّة سخنت ولا لأ؟».
 *
 * ── والمصدرُ واحدٌ لا نسخة ──────────────────────────────────────────────────
 * كلُّ رقمٍ هنا يُقرأ من `Ls2Vehicle` نفسِه في كلّ فتحة. فما يُقرأ في هذه الشاشة
 * هو ما يُقرأ في لوكيشن سوليوشن حرفًا بحرف، ولا شاشتان تختلفان عن شاحنةٍ واحدة.
 *
 * والترتيبُ بما يحتاج عملًا: ما عليه تنبيهٌ حرِجٌ أوّلًا، ثمّ التنبيه، ثمّ
 * الصيانةُ المتأخّرة. الشاشةُ تُقرأ من أعلاها، والترتيبُ بالحروف يجعلها بحثًا.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Activity, Thermometer, Gauge, Wrench, TriangleAlert, Truck, Fuel, RefreshCw,
} from 'lucide-react';
import { Spinner, PageHeader, SearchInput, StatCard, ErrorNotice, SmallBadge } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { severityStyle, maintStyle, ALERT_TYPE_LABELS } from '@/lib/ls2';
import { canViewFleet, foldAr } from '@/lib/fleet';

interface TireRow { position: string; tempC: number | null; pressurePsi: number | null; fault: boolean }
interface AlertRow { type: string; severity: string; message: string; firstSeenAt: string; value: number | null; threshold: number | null; unit: string }
interface HealthRow {
  _id: string; plate: string; name: string; trailerType: string; supervisorName: string;
  drivers: { name: string; phone: string; working: boolean }[];
  tracked: boolean; stale: boolean; lastMessageAt: string | null;
  moving: boolean | null; speed: number | null;
  coolantC: number | null; fuelPct: number | null; odometerKm: number | null;
  engineHours: number | null; mainPowerV: number | null;
  tires: {
    count: number; maxTempC: number | null; minTempC: number | null;
    maxPressurePsi: number | null; minPressurePsi: number | null;
    faults: number; carriedOver: boolean; list: TireRow[];
  };
  maintenance: { status: string; kmToService: number | null; nextServiceName: string } | null;
  alerts: AlertRow[]; alertCount: number; unitId: number | null;
}

const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const n1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

// ── حدودُ اللون ──────────────────────────────────────────────────────────────
// لا تخترع الشاشةُ إنذارًا: التنبيهُ يصنعه محرّكُ التنبيهات في لوكيشن سوليوشن.
// وهذه ألوانُ قراءةٍ فقط — تجعل الرقمَ الشاذّ يُرى قبل أن يُقرأ.
const coolantTone = (c: number | null) => (c == null ? 'text-slate-300'
  : c >= 100 ? 'text-red-600 font-bold' : c >= 92 ? 'text-amber-600 font-semibold' : 'text-slate-700');
const tireTempTone = (c: number | null) => (c == null ? 'text-slate-300'
  : c >= 80 ? 'text-red-600 font-bold' : c >= 70 ? 'text-amber-600 font-semibold' : 'text-slate-700');
const pressureTone = (p: number | null) => (p == null ? 'text-slate-300'
  : p < 80 ? 'text-red-600 font-bold' : p < 95 ? 'text-amber-600 font-semibold' : 'text-slate-700');

export default function FleetHealthPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);

  const [rows, setRows] = useState<HealthRow[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'alerts' | 'maintenance' | 'tires' | 'untracked'>('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    try {
      const d = await api.get<{ vehicles: HealthRow[]; totals: any }>('/api/fleet/health');
      setRows(d.vehicles || []);
      setTotals(d.totals || {});
      setError('');
    } catch (e: any) { if (!background) setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // الأرقامُ تتغيّر كلَّ نبضةٍ من الجهاز، والشاشةُ تُترَك مفتوحةً على الحائط.
  useEffect(() => {
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [load]);
  useSocket('ls2:vehicles', useCallback(() => load(true), [load]));

  const shown = useMemo(() => {
    const f = foldAr(q.trim());
    return rows.filter((r) => {
      if (f && !foldAr(`${r.plate} ${r.name} ${r.drivers.map((d) => d.name).join(' ')} ${r.supervisorName}`).includes(f)) return false;
      if (filter === 'alerts') return r.alertCount > 0;
      if (filter === 'maintenance') return r.maintenance?.status === 'due' || r.maintenance?.status === 'overdue';
      if (filter === 'tires') return r.tires.faults > 0;
      if (filter === 'untracked') return !r.tracked;
      return true;
    });
  }, [rows, q, filter]);

  const cols: ExportColumn[] = [
    { header: t('اللوحة', 'Plate'), key: 'plate', width: 16 },
    { header: t('السائق', 'Driver'), key: 'drivers', width: 24, transform: (v: any) => (v || []).map((d: any) => d.name).join('، ') },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName', width: 18 },
    { header: t('حرارة الماء (°م)', 'Coolant (°C)'), key: 'coolantC', width: 16, transform: (v: any) => (v == null ? '' : Math.round(v)) },
    { header: t('أعلى حرارة كاوتش (°م)', 'Max tire temp (°C)'), key: 'tires', width: 20, transform: (v: any) => (v?.maxTempC == null ? '' : Math.round(v.maxTempC)) },
    { header: t('أقل ضغط (psi)', 'Min pressure (psi)'), key: 'tires', width: 18, transform: (v: any) => (v?.minPressurePsi == null ? '' : Math.round(v.minPressurePsi)) },
    { header: t('أعلى ضغط (psi)', 'Max pressure (psi)'), key: 'tires', width: 18, transform: (v: any) => (v?.maxPressurePsi == null ? '' : Math.round(v.maxPressurePsi)) },
    { header: t('حساسات الكاوتش', 'Tire sensors'), key: 'tires', width: 16, transform: (v: any) => v?.count ?? 0 },
    { header: t('أعطال الكاوتش', 'Tire faults'), key: 'tires', width: 16, transform: (v: any) => v?.faults ?? 0 },
    { header: t('الوقود %', 'Fuel %'), key: 'fuelPct', width: 12, transform: (v: any) => (v == null ? '' : Math.round(v)) },
    { header: t('العداد (كم)', 'Odometer (km)'), key: 'odometerKm', width: 16, transform: (v: any) => (v == null ? '' : Math.round(v)) },
    { header: t('حالة الصيانة', 'Maintenance'), key: 'maintenance', width: 16,
      transform: (v: any) => (v ? (ar ? maintStyle(v.status).ar : maintStyle(v.status).en) : '') },
    { header: t('كم حتى الصيانة', 'Km to service'), key: 'maintenance', width: 18, transform: (v: any) => (v?.kmToService == null ? '' : Math.round(v.kmToService)) },
    { header: t('الصيانة القادمة', 'Next service'), key: 'maintenance', width: 24, transform: (v: any) => v?.nextServiceName || '' },
    { header: t('تنبيهات مفتوحة', 'Open alerts'), key: 'alertCount', width: 16 },
    { header: t('آخر إشارة', 'Last signal'), key: 'lastMessageAt', width: 20,
      transform: (v: any) => (v ? new Date(v).toLocaleString(ar ? 'ar-EG' : 'en-GB') : '') },
  ];

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading) return <Spinner />;

  const th = 'text-start font-semibold px-3 py-3 whitespace-nowrap';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Activity className="w-5 h-5" />}
        title={t('حالة المركبات', 'Vehicle health')}
        subtitle={t('الكاوتش وحرارتُه وحرارةُ الماء والصيانةُ والتنبيهات — لشاحناتنا، من أجهزتها مباشرةً',
                    'Tyres, coolant, maintenance and alerts — for our trucks, straight from their devices')}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {t('تحديث', 'Refresh')}
        </button>
        <ExportMenu fileName="fleet-health" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'shown', label: exportScopeLabels(ar).shown, sheets: [{ name: t('حالة المركبات', 'Vehicle health'), rows: shown as any[], columns: cols }] },
            { key: 'all', label: exportScopeLabels(ar).all, sheets: [{ name: t('حالة المركبات', 'Vehicle health'), rows: rows as any[], columns: cols }] },
          ]} />
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={() => load()} />}

      {/* البطاقاتُ فلترٌ: كلُّ رقمٍ منها سؤالٌ يُسأل صباحًا. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {([
          ['', t('كل الشاحنات', 'All trucks'), totals.total ?? 0, 'text-[#f37121]'],
          ['alerts', t('عليها تنبيهات', 'With alerts'), totals.withAlerts ?? 0, totals.withAlerts ? 'text-red-600' : 'text-slate-400'],
          ['maintenance', t('صيانة متأخرة أو قريبة', 'Service overdue / due'), (totals.maintenanceOverdue ?? 0) + (totals.maintenanceDue ?? 0), (totals.maintenanceOverdue ?? 0) ? 'text-red-600' : 'text-amber-600'],
          ['tires', t('أعطال كاوتش', 'Tyre faults'), totals.tireFaults ?? 0, totals.tireFaults ? 'text-red-600' : 'text-slate-400'],
          ['untracked', t('بلا جهاز تتبّع', 'No tracker'), totals.untracked ?? 0, totals.untracked ? 'text-amber-600' : 'text-slate-400'],
        ] as [any, string, number, string][]).map(([k, label, value, accent]) => (
          <button key={k || 'all'} type="button" onClick={() => setFilter(filter === k ? '' : k)}
            className={`text-start rounded-xl transition-all ${filter === k ? 'ring-2 ring-[#f37121] rounded-xl' : ''}`}>
            <StatCard label={label} value={String(value)} accent={accent} />
          </button>
        ))}
      </div>

      <div className="max-w-md">
        <SearchInput value={q} onChange={setQ} placeholder={t('ابحث باللوحة أو السائق أو المشرف…', 'Plate, driver or supervisor…')} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className={th}>{t('الشاحنة', 'Truck')}</th>
            <th className={th}>{t('الحالة', 'State')}</th>
            <th className={th}><span className="inline-flex items-center gap-1"><Thermometer className="w-3.5 h-3.5" />{t('حرارة الماء', 'Coolant')}</span></th>
            <th className={th}>{t('حرارة الكاوتش', 'Tyre temp')}</th>
            <th className={th}><span className="inline-flex items-center gap-1"><Gauge className="w-3.5 h-3.5" />{t('ضغط الكاوتش', 'Tyre pressure')}</span></th>
            <th className={th}><span className="inline-flex items-center gap-1"><Fuel className="w-3.5 h-3.5" />{t('الوقود', 'Fuel')}</span></th>
            <th className={th}><span className="inline-flex items-center gap-1"><Wrench className="w-3.5 h-3.5" />{t('الصيانة', 'Service')}</span></th>
            <th className={th}><span className="inline-flex items-center gap-1"><TriangleAlert className="w-3.5 h-3.5" />{t('تنبيهات', 'Alerts')}</span></th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const isOpen = open === r._id;
              return (
                <>
                  <tr key={r._id} onClick={() => setOpen(isOpen ? null : r._id)}
                    className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-3">
                      <p className="font-bold text-slate-900 font-mono">{r.plate}</p>
                      <p className="text-[11.5px] text-slate-500 truncate max-w-[200px]">
                        {[r.drivers.map((d) => d.name).join('، '), r.trailerType].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {/* ── الشاحنةُ بلا جهازٍ تُقال ────────────────────────────
                          إخفاؤها يجعل الشاشةَ تبدو تامّةً وهي ناقصة. */}
                      {!r.tracked ? <SmallBadge bg="bg-amber-500/15" text="text-amber-700" label={t('بلا جهاز', 'No tracker')} />
                        : r.stale ? <SmallBadge bg="bg-slate-200" text="text-slate-600" label={t('قراءة قديمة', 'Stale')} />
                          : r.moving ? <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={t(`يتحرك ${n0(r.speed)} كم/س`, `Moving ${n0(r.speed)} km/h`)} />
                            : <SmallBadge bg="bg-slate-100" text="text-slate-600" label={t('متوقف', 'Stopped')} />}
                    </td>
                    <td className={`px-3 py-3 tabular-nums whitespace-nowrap ${coolantTone(r.coolantC)}`}>
                      {r.coolantC == null ? '—' : `${n0(r.coolantC)}°`}
                    </td>
                    <td className={`px-3 py-3 tabular-nums whitespace-nowrap ${tireTempTone(r.tires.maxTempC)}`}>
                      {r.tires.maxTempC == null ? '—' : `${n0(r.tires.maxTempC)}°`}
                      {r.tires.carriedOver && <span className="ms-1 text-[10px] text-slate-400">{t('محمولة', 'carried')}</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      {r.tires.count ? (
                        <>
                          <span className={pressureTone(r.tires.minPressurePsi)}>{n0(r.tires.minPressurePsi)}</span>
                          <span className="text-slate-300 mx-1">—</span>
                          <span className="text-slate-700">{n0(r.tires.maxPressurePsi)}</span>
                          <span className="text-[11px] text-slate-400 ms-1">psi · {r.tires.count}</span>
                          {r.tires.faults > 0 && <span className="ms-1.5 text-[11px] text-red-600 font-semibold">{t(`${r.tires.faults} عطل`, `${r.tires.faults} faults`)}</span>}
                        </>
                      ) : <span className="text-slate-300">{t('بلا حسّاسات', 'no sensors')}</span>}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-700">{r.fuelPct == null ? '—' : `${n0(r.fuelPct)}%`}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.maintenance ? (
                        <>
                          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${maintStyle(r.maintenance.status).bg} ${maintStyle(r.maintenance.status).text}`}>
                            {ar ? maintStyle(r.maintenance.status).ar : maintStyle(r.maintenance.status).en}
                          </span>
                          {r.maintenance.kmToService != null && (
                            <span className="block text-[11px] text-slate-500 tabular-nums mt-0.5">
                              {t(`${n0(r.maintenance.kmToService)} كم`, `${n0(r.maintenance.kmToService)} km`)}
                            </span>
                          )}
                        </>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {r.alertCount ? (
                        <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${
                          r.alerts.some((a) => a.severity === 'critical') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {r.alertCount}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>

                  {/* ── التفصيل عند الضغط ────────────────────────────────────
                      كاوتشٌ كاوتشًا بموضعه، والتنبيهاتُ بنصّها. الصفُّ يقول
                      «فيه شيء»، والتفصيلُ يقول «ما هو» — بلا مغادرة الشاشة. */}
                  {isOpen && (
                    <tr key={`${r._id}-d`} className="bg-slate-50/70 border-b border-slate-200">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                          <div>
                            <p className="text-[12px] font-bold text-slate-600 mb-2">{t('الكاوتش', 'Tyres')}</p>
                            {r.tires.list.length ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {r.tires.list.map((tr2, i) => (
                                  <div key={i} className={`rounded-lg border px-2.5 py-2 ${tr2.fault ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
                                    <p className="text-[11px] text-slate-500">{tr2.position || `#${i + 1}`}</p>
                                    <p className="text-[13px] tabular-nums">
                                      <span className={tireTempTone(tr2.tempC)}>{tr2.tempC == null ? '—' : `${n0(tr2.tempC)}°`}</span>
                                      <span className="text-slate-300 mx-1.5">·</span>
                                      <span className={pressureTone(tr2.pressurePsi)}>{tr2.pressurePsi == null ? '—' : `${n0(tr2.pressurePsi)} psi`}</span>
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : <p className="text-[13px] text-slate-400">{t('لا حسّاسات مركّبة على هذه الشاحنة.', 'No sensors fitted on this truck.')}</p>}
                            <p className="text-[11.5px] text-slate-500 mt-3 tabular-nums">
                              {t('العداد', 'Odometer')}: {n0(r.odometerKm)} {t('كم', 'km')}
                              {r.engineHours != null && <> · {t('ساعات المحرك', 'Engine hours')}: {n1(r.engineHours)}</>}
                              {r.mainPowerV != null && <> · {t('الكهرباء', 'Power')}: {n1(r.mainPowerV)}V</>}
                            </p>
                            {r.lastMessageAt && (
                              <p className="text-[11.5px] text-slate-400 mt-1">
                                {t('آخر إشارة', 'Last signal')}: {new Date(r.lastMessageAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-[12px] font-bold text-slate-600 mb-2">{t('التنبيهات المفتوحة', 'Open alerts')}</p>
                            {r.alerts.length ? (
                              <div className="space-y-1.5">
                                {r.alerts.map((a, i) => {
                                  const sv = severityStyle(a.severity);
                                  return (
                                    <div key={i} className={`rounded-lg border px-3 py-2 ${sv.border} ${sv.bg}`}>
                                      <div className="flex items-center gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full ${sv.dot}`} />
                                        <span className={`text-[12px] font-bold ${sv.text}`}>
                                          {ar ? (ALERT_TYPE_LABELS[a.type]?.ar || a.type) : (ALERT_TYPE_LABELS[a.type]?.en || a.type)}
                                        </span>
                                        {a.value != null && (
                                          <span className="text-[11.5px] text-slate-500 tabular-nums ms-auto">
                                            {n0(a.value)}{a.unit} {a.threshold != null ? `/ ${n0(a.threshold)}${a.unit}` : ''}
                                          </span>
                                        )}
                                      </div>
                                      {a.message && <p className="text-[12px] text-slate-600 mt-0.5">{a.message}</p>}
                                      <p className="text-[11px] text-slate-400 mt-0.5">
                                        {t('منذ', 'since')} {new Date(a.firstSeenAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : <p className="text-[13px] text-slate-400">{t('لا تنبيهات مفتوحة على هذه الشاحنة.', 'No open alerts on this truck.')}</p>}
                            {r.maintenance?.nextServiceName && (
                              <p className="text-[11.5px] text-slate-500 mt-3">
                                {t('الصيانة القادمة', 'Next service')}: <b>{r.maintenance.nextServiceName}</b>
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={8} className="text-center text-slate-500 py-14">
                <Truck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                {rows.length ? t('لا نتائج مطابقة', 'No matches') : t('لا شاحنات في نطاقك', 'No trucks in your scope')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── ومن أين تأتي الأرقام ────────────────────────────────────────────
          يُقال صراحةً: القراءةُ من جهاز الشاحنة، والتنبيهُ يصنعه محرّكُ لوكيشن
          سوليوشن لا هذه الشاشة. فمن رأى رقمًا يخالف توقّعَه يعرف أين يذهب. */}
      <p className="text-[11.5px] text-slate-400 leading-relaxed">
        {t('الأرقام من أجهزة التتبّع مباشرةً وتُحدَّث كلَّ نصف دقيقة. والتنبيهاتُ يصنعها محرّكُ التنبيهات في «لوكيشن سوليوشن» — تُقرأ هنا وتُغلَق هناك.',
           'Readings come straight from the trackers and refresh every 30 seconds. Alerts are raised by the Location Solutions alert engine — read here, closed there.')}
      </p>
    </div>
  );
}
