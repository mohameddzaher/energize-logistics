'use client';
// Location Solutions telemetry dashboard — a live, clickable analytical overview
// of the whole heavy-truck fleet: status, alerts, tire/engine temperature and
// maintenance projections. Fed by /api/ls2/dashboard and kept current by the
// `ls2:updated` socket event (the poll job broadcasts every ~20s).
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Gauge, Truck, AlertTriangle, Wrench, Thermometer, Activity, ArrowRight, RefreshCw,
  Satellite, Flame, ShieldAlert, Bell, Route,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import {
  ls2Text, isLs2Staff, severityStyle, statusStyle, alertTypeLabel, alertMessage, fmtNum, fmtKm, timeAgo, tireTempColor, coolantColor, thisMonthToDate, type Lang, type DateRange,
} from '@/lib/ls2';

interface Dash {
  generatedAt: number;
  fleet: { total: number; online: number; statusCounts: Record<string, number> };
  alerts: { totalOpen: number; vehiclesWithAlerts: number; bySeverity: Record<string, number>; byType: Record<string, number>; latest: any[] };
  maintenance: { overdueCount: number; dueCount: number; overdue: any[]; due: any[]; nearest: any[] };
  temperature: { avgTireTempC: number | null; maxTireTempC: number | null; avgCoolantC: number | null; maxCoolantC: number | null; hotTires: number; hotEngines: number; topHotTires: any[] };
  distance: { from: string; to: string; totalKm: number; movedVehicles: number; avgKm: number; topMovers: any[]; hasData: boolean };
  thresholds: any;
}

export default function Ls2DashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());

  const load = useCallback(async () => {
    try { setD(await api.get<Dash>(`/api/ls2/dashboard?from=${range.from}&to=${range.to}`)); } catch { /* keep previous */ }
    setLoading(false);
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t.noData}</div>;

  const go = (path: string) => router.push(`/system/ls2${path}`);
  const th = d.thresholds || {};
  const sc = d.fleet.statusCounts || {};

  // KPI cards — each drills into a filtered page.
  const kpis = [
    { label: t.totalVehicles, value: d.fleet.total, icon: Truck, accent: 'text-slate-700', on: () => go('/live') },
    { label: t.moving, value: sc.moving || 0, icon: Satellite, accent: 'text-emerald-600', on: () => go('/live?status=moving') },
    { label: t.criticalAlerts, value: d.alerts.bySeverity.critical || 0, icon: ShieldAlert, accent: 'text-red-600', on: () => go('/alerts?severity=critical') },
    { label: t.warnings, value: d.alerts.bySeverity.warning || 0, icon: AlertTriangle, accent: 'text-amber-600', on: () => go('/alerts?severity=warning') },
    { label: t.serviceOverdue, value: d.maintenance.overdueCount, icon: Wrench, accent: 'text-red-600', on: () => go('/maintenance?filter=overdue') },
    { label: t.serviceDue, value: d.maintenance.dueCount, icon: Wrench, accent: 'text-amber-600', on: () => go('/maintenance?filter=due') },
    { label: t.hotTires, value: d.temperature.hotTires, icon: Flame, accent: 'text-orange-600', on: () => go('/temperature') },
    { label: t.hotEngines, value: d.temperature.hotEngines, icon: Thermometer, accent: 'text-red-600', on: () => go('/temperature') },
    { label: t.faults, value: d.alerts.byType.tire_fault || 0, icon: Activity, accent: 'text-slate-600', on: () => go('/tires') },
    { label: t.openAlerts, value: d.alerts.totalOpen, icon: Bell, accent: 'text-slate-600', on: () => go('/alerts') },
  ];

  const typeChart = Object.entries(d.alerts.byType || {})
    .map(([type, count]) => ({ type: alertTypeLabel(type, lang as Lang), key: type, count: Number(count) }))
    .sort((a, b) => b.count - a.count);
  const typeColor: Record<string, string> = { tire_temp: '#ef4444', coolant_temp: '#dc2626', maintenance_due: '#f59e0b', maintenance_overdue: '#b91c1c', tire_pressure_low: '#f97316', tire_pressure_critical: '#dc2626', tire_pressure_high: '#fb923c', tire_imbalance: '#a855f7', tire_fault: '#94a3b8', rpm_high: '#7c3aed', speeding: '#8b5cf6', fuel_low: '#eab308', overload: '#e11d48', battery_low: '#0ea5e9', idling: '#f59e0b', offline: '#64748b' };

  const statusTiles = [
    { key: 'moving', ...statusStyle('moving') }, { key: 'idle', ...statusStyle('idle') },
    { key: 'stopped', ...statusStyle('stopped') }, { key: 'offline', ...statusStyle('offline') },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Gauge className="w-5 h-5" />} title={t.dashboard} subtitle={`${t.liveSubtitle} · ${t.live}`}>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t.live}
        </span>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((c) => {
          const Icon = c.icon;
          return (
            <button key={c.label} type="button" onClick={c.on} className="text-start bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-[#f37121]/40 transition-all group">
              <div className="flex items-center justify-between">
                <Icon className={`w-5 h-5 ${c.accent}`} />
                <ArrowRight className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? 'rotate-180' : ''}`} />
              </div>
              <p className={`text-2xl font-bold mt-2 ${c.accent}`}>{fmtNum(c.value)}</p>
              <p className="text-slate-500 text-xs mt-0.5">{c.label}</p>
            </button>
          );
        })}
      </div>

      {/* Distance travelled over a chosen period (real Wialon odometer) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Route className="w-4 h-4 text-[#f37121]" /> {t.distanceTraveled}</h2>
          <button type="button" onClick={() => go('/live')} className="text-xs text-[#f37121] hover:underline">{lang === 'ar' ? 'تفاصيل كل مركبة' : 'Per-vehicle detail'}</button>
        </div>
        <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={t.from} labelTo={t.to} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MiniStat label={t.totalDistance} value={`${fmtNum(d.distance?.totalKm ?? 0)} ${t.km}`} accent="text-[#f37121]" />
          <MiniStat label={t.vehiclesMoved} value={`${fmtNum(d.distance?.movedVehicles ?? 0)} / ${d.fleet.total}`} />
          <MiniStat label={t.avgPerVehicle} value={`${fmtNum(d.distance?.avgKm ?? 0)} ${t.km}`} />
        </div>
        {d.distance?.topMovers?.length ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.distance.topMovers.map((m: any) => ({ plate: m.plate || m.unitId, km: m.km, unitId: m.unitId }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="plate" width={90} tick={{ fontSize: 11, fill: '#334155' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: any) => [`${fmtNum(v)} km`, t.distance]} />
                <Bar dataKey="km" radius={[0, 6, 6, 0]} fill="#f37121" cursor="pointer"
                  onClick={(e: any) => e && e.unitId && go(`/${e.unitId}`)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-slate-400 text-sm py-6 text-center">{lang === 'ar' ? 'لا توجد بيانات مسافة لهذه الفترة بعد — اعمل backfill أو استنى التجميع اليومي' : 'No distance data for this period yet'}</p>}
      </div>

      {/* Fleet status distribution */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'حالة الأسطول' : 'Fleet Status'}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statusTiles.map((s) => (
            <button key={s.key} type="button" onClick={() => go(`/live?status=${s.key}`)} className={`text-start rounded-xl p-3 border border-transparent hover:border-current transition-all ${s.bg} ${s.text}`}>
              <p className="text-2xl font-bold">{fmtNum(sc[s.key] || 0)}</p>
              <p className="text-xs mt-0.5 flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{lang === 'ar' ? s.ar : s.en}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alerts by type */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Bell className="w-4 h-4 text-red-600" /> {lang === 'ar' ? 'التنبيهات حسب النوع' : 'Alerts by Type'}</h2>
            <button type="button" onClick={() => go('/alerts')} className="text-xs text-[#f37121] hover:underline">{t.viewAll}</button>
          </div>
          {typeChart.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="type" width={110} tick={{ fontSize: 11, fill: '#334155' }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {typeChart.map((e) => <Cell key={e.key} fill={typeColor[e.key] || '#f37121'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-slate-400 text-sm py-8 text-center">{t.noData}</p>}
        </div>

        {/* Temperature panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><Thermometer className="w-4 h-4 text-red-600" /> {t.temperature}</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MiniStat label={t.avgTireTemp} value={d.temperature.avgTireTempC != null ? `${d.temperature.avgTireTempC}°C` : '—'} />
            <MiniStat label={t.maxTireTemp} value={d.temperature.maxTireTempC != null ? `${d.temperature.maxTireTempC}°C` : '—'} accent={coolantColor(d.temperature.maxTireTempC, th.tireTempC, th.tireTempCriticalC)} />
            <MiniStat label={t.avgEngineTemp} value={d.temperature.avgCoolantC != null ? `${d.temperature.avgCoolantC}°C` : '—'} />
            <MiniStat label={lang === 'ar' ? 'أقصى حرارة موتور' : 'Max Engine Temp'} value={d.temperature.maxCoolantC != null ? `${d.temperature.maxCoolantC}°C` : '—'} accent={coolantColor(d.temperature.maxCoolantC, th.coolantTempC, th.coolantTempCriticalC)} />
          </div>
          <p className="text-xs font-medium text-slate-500 mb-2">{t.hottestTires}</p>
          <div className="space-y-1.5">
            {d.temperature.topHotTires.slice(0, 6).map((v: any) => (
              <button key={v.unitId} type="button" onClick={() => go(`/${v.unitId}`)} className="w-full flex items-center justify-between gap-2 hover:bg-slate-50 rounded-lg px-2 py-1.5 -mx-2">
                <span className="text-sm text-slate-800 truncate">{v.plate} · <span className="text-slate-400">{v.driver}</span></span>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-bold ${tireTempColor(v.value, th.tireTempC, th.tireTempCriticalC)}`}>{v.value}°C</span>
              </button>
            ))}
            {d.temperature.topHotTires.length === 0 && <p className="text-slate-400 text-sm py-2">{t.noData}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Nearest to service */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-600" /> {t.nearestService}</h2>
            <button type="button" onClick={() => go('/maintenance')} className="text-xs text-[#f37121] hover:underline">{t.viewAll}</button>
          </div>
          <div className="divide-y divide-slate-100">
            {d.maintenance.nearest.slice(0, 8).map((v: any) => {
              const over = v.statusLevel === 'overdue';
              return (
                <button key={v.unitId} type="button" onClick={() => go(`/${v.unitId}`)} className="w-full text-start py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-lg px-2 -mx-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 font-medium truncate">{v.plate} · <span className="text-slate-400">{v.driver}</span></p>
                    <p className="text-xs text-slate-400">{t.odometer}: {fmtKm(v.odometerKm)}</p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-bold ${over ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {over ? `${fmtNum(Math.abs(v.kmToService))} ${lang === 'ar' ? 'كم متأخرة' : 'km over'}` : `${fmtNum(v.kmToService)} ${lang === 'ar' ? 'كم' : 'km'}`}
                  </span>
                </button>
              );
            })}
            {d.maintenance.nearest.length === 0 && <p className="text-slate-400 text-sm py-4">{t.noData}</p>}
          </div>
        </div>

        {/* Latest alerts */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Bell className="w-4 h-4 text-red-600" /> {t.latestAlerts}</h2>
            <button type="button" onClick={() => go('/alerts')} className="text-xs text-[#f37121] hover:underline">{t.viewAll}</button>
          </div>
          <div className="divide-y divide-slate-100">
            {d.alerts.latest.slice(0, 10).map((a: any) => {
              const st = severityStyle(a.severity);
              return (
                <button key={a.id} type="button" onClick={() => go(`/${a.unitId}`)} className="w-full text-start py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-lg px-2 -mx-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 truncate">{a.plate} · {alertTypeLabel(a.type, lang as Lang)}</p>
                      <p className="text-xs text-slate-400 truncate">{alertMessage(a, lang as Lang)}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.lastSeenAt, lang as Lang)}</span>
                </button>
              );
            })}
            {d.alerts.latest.length === 0 && <p className="text-slate-400 text-sm py-4">{t.noData}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent || 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
