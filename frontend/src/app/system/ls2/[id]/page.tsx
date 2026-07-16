'use client';
// Vehicle detail — everything known about one truck: live position (map), engine &
// drivetrain telemetry, full tire layout, the REAL Location Solutions service plan
// (each service with its last-service date + odometer and distance to the next),
// distance travelled over any period (with the exact Wialon report on demand),
// and open alerts. Read-only mirror — servicing is registered inside Wialon.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Truck, ArrowLeft, RefreshCw, Gauge, Thermometer, Fuel, Weight, Activity, Zap, MapPin, Wrench, Bell, Clock, Satellite, Route, AlertCircle, CheckCircle2, FileText, Fingerprint, Navigation, Droplet, MapPinned, FileDown, Loader2,
} from 'lucide-react';
import { downloadVehicleReport } from '@/lib/vehicleReport';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import {
  ls2Text, isLs2Staff, isLs2Admin, severityStyle, statusStyle, maintStyle, alertTypeLabel, alertMessage, tireTempColor, tirePressColor, coolantColor,
  fmtNum, fmtKm, fmtDate, fmtDuration, timeAgo, osmLink, thisMonthToDate, type Lang, type Vehicle, type Alert, type Tire, type ServiceInterval, type DateRange, type TripsResult, type VehicleFuel, type TrackPoint,
} from '@/lib/ls2';
import LiveMap from '@/components/ls2/LiveMap';

interface Detail { vehicle: Vehicle; alerts: Alert[]; serviceLog: any[] }

function remainOf(iv: ServiceInterval): { value: number; unit: string; next: string } {
  if (iv.remainingKm != null) return { value: iv.remainingKm, unit: 'km', next: iv.nextServiceKm != null ? `${Number(iv.nextServiceKm).toLocaleString('en-US')} km` : '—' };
  if (iv.remainingDays != null) return { value: iv.remainingDays, unit: 'd', next: iv.nextServiceAt ? new Date(iv.nextServiceAt).toLocaleDateString('en-GB') : '—' };
  return { value: iv.remaining ?? 0, unit: 'h', next: iv.nextServiceValue != null ? `${iv.nextServiceValue} h` : '—' };
}

export default function Ls2VehicleDetailPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const t = ls2Text(lang as Lang);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [mileage, setMileage] = useState<{ km: number; source: string; clipped?: boolean } | null>(null);
  const [history, setHistory] = useState<{ date: string; km: number }[]>([]);
  const [exact, setExact] = useState<{ km: number } | null>(null);
  const [exactLoading, setExactLoading] = useState(false);
  const [activity, setActivity] = useState<TripsResult | null>(null);
  const [fuel, setFuel] = useState<VehicleFuel | null>(null);
  const [actLoading, setActLoading] = useState(false);
  const [tab, setTab] = useState<'trips' | 'stops'>('trips');
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);

  const [brandEdit, setBrandEdit] = useState(false);
  const [brandInput, setBrandInput] = useState('');
  const [brandSaving, setBrandSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Full vehicle report over the period selected above (identity, distance,
  // maintenance, service history, drivers, trips, fuel, alerts) → PDF.
  const downloadPdf = async () => {
    setPdfBusy(true);
    try { await downloadVehicleReport(Number(id), range.from, range.to, lang as Lang); }
    catch (e: any) { alert(e?.message || 'PDF failed'); }
    setPdfBusy(false);
  };

  const load = useCallback(async () => {
    try { setD(await api.get<Detail>(`/api/ls2/vehicles/${id}`)); } catch { /* keep */ }
    setLoading(false);
  }, [id]);

  const saveBrand = async () => {
    setBrandSaving(true);
    try { await api.patch(`/api/ls2/vehicles/${id}/meta`, { tireBrand: brandInput.trim() }); setBrandEdit(false); await load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
    setBrandSaving(false);
  };
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  // Distance for the chosen period (snapshots) + the daily trend series.
  const loadDistance = useCallback(async () => {
    setExact(null);
    try {
      const [m, h] = await Promise.all([
        api.get<{ km: number; source: string; clipped?: boolean }>(`/api/ls2/vehicles/${id}/mileage?from=${range.from}&to=${range.to}`),
        api.get<{ series: { date: string; km: number }[] }>(`/api/ls2/vehicles/${id}/history?from=${range.from}&to=${range.to}`),
      ]);
      setMileage(m); setHistory(h.series || []);
    } catch { /* keep */ }
  }, [id, range.from, range.to]);
  useEffect(() => { loadDistance(); }, [loadDistance]);

  const fetchExact = async () => {
    setExactLoading(true);
    try { const r = await api.get<{ km: number }>(`/api/ls2/vehicles/${id}/mileage?from=${range.from}&to=${range.to}&source=report`); setExact(r); }
    catch { /* ignore */ }
    setExactLoading(false);
  };

  // Trips/stops + fuel for the chosen period (Wialon reports, cached server-side).
  const loadActivity = useCallback(async () => {
    setActLoading(true); setTrack(null);
    try {
      const [a, f] = await Promise.all([
        api.get<TripsResult>(`/api/ls2/vehicles/${id}/trips?from=${range.from}&to=${range.to}`),
        api.get<VehicleFuel>(`/api/ls2/vehicles/${id}/fuel?from=${range.from}&to=${range.to}`),
      ]);
      setActivity(a); setFuel(f);
    } catch { /* keep */ }
    setActLoading(false);
  }, [id, range.from, range.to]);
  useEffect(() => { loadActivity(); }, [loadActivity]);

  const toggleTrack = async () => {
    if (track) { setTrack(null); return; }
    setTrackLoading(true);
    try { const r = await api.get<{ points: TrackPoint[] }>(`/api/ls2/vehicles/${id}/track?from=${range.from}&to=${range.to}`); setTrack(r.points || []); }
    catch { /* ignore */ }
    setTrackLoading(false);
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t.noData}</div>;

  const v = d.vehicle;
  const st = statusStyle(v.status);
  const openAlerts = d.alerts.filter((a) => a.status === 'open');
  const intervals = [...(v.serviceIntervals || [])].sort((a, b) => a.intervalKm - b.intervalKm);

  const cards = [
    { label: t.speed, value: v.speed != null ? `${v.speed} km/h` : '—', icon: Gauge, accent: 'text-slate-700' },
    { label: t.ignitionLabel, value: v.ignition == null ? '—' : (v.ignition ? t.on : t.off), icon: Zap, accent: v.ignition ? 'text-emerald-600' : 'text-slate-500' },
    { label: t.coolant, value: v.coolantC != null ? `${v.coolantC}°C` : '—', icon: Thermometer, accent: coolantColor(v.coolantC) },
    { label: t.maxTireTemp, value: v.maxTireTempC != null ? `${v.maxTireTempC}°C` : '—', icon: Activity, accent: v.maxTireTempC != null && v.maxTireTempC >= 85 ? 'text-red-600' : v.maxTireTempC != null && v.maxTireTempC >= 75 ? 'text-amber-600' : 'text-slate-700' },
    { label: t.fuel, value: v.fuelPct != null ? `${v.fuelPct}%` : '—', icon: Fuel, accent: 'text-slate-700' },
    { label: t.weight, value: v.weightKg != null ? `${fmtNum(v.weightKg)} kg` : '—', icon: Weight, accent: 'text-slate-700' },
    { label: t.rpm, value: v.rpm != null ? fmtNum(v.rpm) : '—', icon: Activity, accent: 'text-slate-700' },
    { label: t.voltage, value: v.mainPowerV != null ? `${v.mainPowerV} V` : '—', icon: Zap, accent: v.mainPowerV != null && v.mainPowerV < 22 ? 'text-amber-600' : 'text-slate-700' },
    { label: t.engineHours, value: v.engineHours != null ? `${fmtNum(v.engineHours)} h` : '—', icon: Clock, accent: 'text-slate-700' },
    { label: t.totalFuelUsed, value: v.totalFuelUsedL != null ? `${fmtNum(v.totalFuelUsedL)} L` : '—', icon: Fuel, accent: 'text-slate-700' },
    { label: t.backupBattery, value: v.backupBatteryV != null ? `${v.backupBatteryV} V` : '—', icon: Zap, accent: 'text-slate-700' },
    { label: t.gsm, value: v.gsmSignal != null ? `${Math.round((v.gsmSignal / 31) * 100)}%` : '—', icon: Satellite, accent: 'text-slate-700' },
  ];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {lang === 'ar' ? 'رجوع' : 'Back'}</button>

      <PageHeader icon={<Truck className="w-5 h-5" />} title={`${v.plate || v.name}`} subtitle={v.driver}>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span>
        <span className="text-xs text-slate-400">{t.lastSeen}: {timeAgo(v.lastMessageAt, lang as Lang)}</span>
        <button type="button" onClick={downloadPdf} disabled={pdfBusy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium disabled:opacity-60">
          {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          {lang === 'ar' ? 'تحميل تقرير PDF' : 'Download PDF Report'}
        </button>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      {/* Vehicle identity (mirrored from Location Solutions) */}
      {v.profile && (v.profile.vin || v.profile.brand || v.profile.simIccid) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Fingerprint className="w-4 h-4 text-[#f37121]" /> {t.identity}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <IdField label={t.brand} value={[v.profile.brand, v.profile.modelYear].filter(Boolean).join(' · ')} />
            <IdField label={t.vehicleType} value={v.profile.vehicleType} />
            <IdField label={t.vin} value={v.profile.vin} mono />
            <IdField label={t.simIccid} value={v.profile.simIccid} mono />
            <IdField label={t.installDate} value={v.profile.installDate} />
            <IdField label={t.lsUnitId} value={v.profile.lsUnitId} mono />
            {(v.profile.extra || []).map((e) => <IdField key={e.label} label={e.label} value={e.value} />)}
          </div>
        </div>
      )}

      {/* Telemetry cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <Icon className={`w-4 h-4 ${c.accent}`} />
              <p className={`text-xl font-bold mt-2 ${c.accent}`}>{c.value}</p>
              <p className="text-slate-500 text-xs mt-0.5">{c.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Map */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'الموقع المباشر' : 'Live Position'} {v.status === 'moving' && !track && <span className="flex items-center gap-1 text-[10px] text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{lang === 'ar' ? 'يتحرك' : 'moving'}</span>}{track && <span className="text-[10px] text-[#f37121]">· {t.track} ({range.from}{range.from !== range.to ? `→${range.to}` : ''})</span>}</h2>
            <div className="flex items-center gap-3">
              <button type="button" onClick={toggleTrack} disabled={trackLoading} className={`flex items-center gap-1 text-xs font-medium ${track ? 'text-[#f37121]' : 'text-slate-500 hover:text-[#f37121]'}`}>
                <MapPinned className="w-3.5 h-3.5" /> {trackLoading ? '…' : track ? (lang === 'ar' ? 'إخفاء المسار' : 'Hide route') : t.showTrack}
              </button>
              {v.position && <a href={osmLink(v.position.lat, v.position.lng)} target="_blank" rel="noopener noreferrer" className="text-xs text-[#f37121] hover:underline">{t.openInMap}</a>}
            </div>
          </div>
          {v.position ? (
            <LiveMap lat={v.position.lat} lng={v.position.lng} label={v.plate || v.name} speed={v.speed} height={320} track={track || undefined} />
          ) : <p className="text-slate-400 text-sm py-16 text-center">{t.noData}</p>}
        </div>

        {/* Service plan (mirrored from Location Solutions) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-600" /> {t.servicePlan}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${maintStyle(v.maintenanceStatus).bg} ${maintStyle(v.maintenanceStatus).text}`}>{lang === 'ar' ? maintStyle(v.maintenanceStatus).ar : maintStyle(v.maintenanceStatus).en}</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">{t.odometer}: <b className="text-slate-600">{fmtKm(v.odometerKm)}</b></p>
          <div className="space-y-2">
            {intervals.map((iv) => {
              const r = remainOf(iv);
              const stI = maintStyle(iv.statusLevel);
              const isOver = r.value < 0;
              const Icon = iv.statusLevel === 'overdue' ? AlertCircle : iv.statusLevel === 'due' ? Clock : CheckCircle2;
              return (
                <div key={iv.id} className="border border-slate-100 rounded-lg p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-slate-800 flex items-center gap-1.5 min-w-0"><Icon className={`w-3.5 h-3.5 shrink-0 ${iv.statusLevel === 'overdue' ? 'text-red-500' : iv.statusLevel === 'due' ? 'text-amber-500' : 'text-emerald-500'}`} /><span className="truncate">{iv.name}</span></p>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${stI.bg} ${stI.text}`}>{isOver ? `−${fmtNum(Math.abs(r.value))}` : fmtNum(r.value)} {r.unit === 'km' ? (isOver ? t.kmOverdue : t.kmLeft) : r.unit}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 mt-1 text-[10px] text-slate-500">
                    <span>{t.lastService}: <b className="text-slate-700">{fmtDate(iv.lastServiceAt, lang as Lang)}</b>{iv.lastServiceKm != null && <> · {fmtKm(iv.lastServiceKm)}</>}</span>
                    <span>{lang === 'ar' ? 'القادمة' : 'Next'}: <b className="text-slate-700">{r.next}</b></span>
                  </div>
                </div>
              );
            })}
            {intervals.length === 0 && <p className="text-slate-400 text-sm py-3">{t.noData}</p>}
          </div>
        </div>
      </div>

      {/* Distance travelled over a period */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Route className="w-4 h-4 text-[#f37121]" /> {t.distanceTraveled}</h2>
        <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={t.from} labelTo={t.to} />
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-3xl font-bold text-[#f37121] tabular-nums">{mileage ? fmtNum(Math.round(mileage.km)) : '—'} <span className="text-base text-slate-400">{t.km}</span></p>
            <p className="text-xs text-slate-400 mt-0.5">{range.from} → {range.to}{mileage?.clipped ? ` · ${t.partialData}` : ''}</p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {exact && <span className="text-sm text-slate-600">{t.exactFromWialon}: <b className="text-slate-900 tabular-nums">{fmtNum(Math.round(exact.km))} {t.km}</b></span>}
            <button type="button" onClick={fetchExact} disabled={exactLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium disabled:opacity-50">
              <FileText className="w-3.5 h-3.5" /> {exactLoading ? (lang === 'ar' ? 'جاري…' : 'Loading…') : t.exactFromWialon}
            </button>
          </div>
        </div>
        {history.length > 0 ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(val: any) => [`${fmtNum(val)} km`, t.dailyDistance]} />
                <Bar dataKey="km" radius={[4, 4, 0, 0]} fill="#f37121" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-slate-400 text-sm py-6 text-center">{lang === 'ar' ? 'لا توجد بيانات مسافة يومية لهذه الفترة بعد' : 'No daily distance data for this period yet'}</p>}
      </div>

      {/* Fuel (CAN consumption over the selected period) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Droplet className="w-4 h-4 text-[#f37121]" /> {t.fuelSection} · <span className="text-xs font-normal text-slate-400">{range.from} → {range.to}</span></h2>
        {fuel && (fuel.fuelL || fuel.efficiencyKmL) ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniStat label={t.fuelUsed} value={fuel.fuelL != null ? `${fmtNum(Math.round(fuel.fuelL))} L` : '—'} accent="text-[#f37121]" />
            <MiniStat label={t.efficiency} value={fuel.efficiencyKmL != null ? `${fuel.efficiencyKmL} km/L` : '—'} />
            <MiniStat label={t.distance} value={fuel.distanceKm != null ? `${fmtNum(Math.round(fuel.distanceKm))} km` : '—'} />
            <MiniStat label={t.engineOn} value={fmtDuration(fuel.engineOnSec, lang as Lang)} />
          </div>
        ) : <p className="text-slate-400 text-sm py-3">{t.noFuelData}</p>}
      </div>

      {/* Trips & Stops over the selected period */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Navigation className="w-4 h-4 text-[#f37121]" /> {t.activity} · <span className="text-xs font-normal text-slate-400">{range.from} → {range.to}</span></h2>
          {activity && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button type="button" onClick={() => setTab('trips')} className={`px-3 py-1 rounded-md text-xs font-medium ${tab === 'trips' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>{t.trips} ({activity.summary.tripCount})</button>
              <button type="button" onClick={() => setTab('stops')} className={`px-3 py-1 rounded-md text-xs font-medium ${tab === 'stops' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>{t.stops} ({activity.summary.stopCount})</button>
            </div>
          )}
        </div>
        {activity && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MiniStat label={t.tripCount} value={fmtNum(activity.summary.tripCount)} />
          <MiniStat label={t.distance} value={`${fmtNum(Math.round(activity.summary.totalKm))} km`} accent="text-[#f37121]" />
          <MiniStat label={t.driveTime} value={fmtDuration(activity.summary.totalDriveSec, lang as Lang)} />
          <MiniStat label={t.maxSpeed} value={`${activity.summary.maxSpeed} km/h`} />
        </div>}
        {actLoading && !activity ? <Spinner /> : !activity || (!activity.trips.length) ? (
          <p className="text-slate-400 text-sm py-6 text-center">{lang === 'ar' ? 'لا توجد رحلات في هذه الفترة' : 'No trips in this period'}</p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-lg border border-slate-100">
            {tab === 'trips' ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0"><tr className="bg-slate-900 text-slate-300">
                  <th className="text-start font-semibold px-3 py-2">{t.startLabel}</th>
                  <th className="text-start font-semibold px-3 py-2">{t.endLabel}</th>
                  <th className="text-end font-semibold px-3 py-2">{t.distance}</th>
                  <th className="text-end font-semibold px-3 py-2">{t.duration}</th>
                  <th className="text-end font-semibold px-3 py-2">{t.maxSpeed}</th>
                </tr></thead>
                <tbody>
                  {activity.trips.map((tr, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="text-slate-700 font-medium tabular-nums">{tr.beginTime?.slice(5, 16)}</p><p className="text-slate-700 truncate max-w-[220px]">{tr.beginLocation}</p></td>
                      <td className="px-3 py-2"><p className="text-slate-700 font-medium tabular-nums">{tr.endTime?.slice(5, 16)}</p><p className="text-slate-700 truncate max-w-[220px]">{tr.endLocation}</p></td>
                      <td className="px-3 py-2 text-end tabular-nums font-semibold text-slate-800">{fmtNum(Math.round(tr.km))}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-800">{fmtDuration(tr.durationSec, lang as Lang)}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-800">{tr.maxSpeed ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0"><tr className="bg-slate-900 text-slate-300">
                  <th className="text-start font-semibold px-3 py-2">{t.location}</th>
                  <th className="text-start font-semibold px-3 py-2">{t.startLabel}</th>
                  <th className="text-end font-semibold px-3 py-2">{t.duration}</th>
                </tr></thead>
                <tbody>
                  {activity.stops.map((s, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-800 truncate max-w-[360px]">{s.location}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-800">{s.from?.slice(5, 16)}</td>
                      <td className="px-3 py-2 text-end tabular-nums font-semibold text-slate-700">{fmtDuration(s.durationSec, lang as Lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Tire layout */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Activity className="w-4 h-4 text-[#f37121]" /> {t.tireLayout}</h2>
          {/* Manual tire brand/type (optional) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{t.tireBrand}:</span>
            {brandEdit ? (
              <>
                <input autoFocus value={brandInput} onChange={(e) => setBrandInput(e.target.value)} placeholder="Continental…" className="px-2 py-1 rounded-lg border border-slate-200 text-sm w-40" />
                <button type="button" onClick={saveBrand} disabled={brandSaving} className="px-2.5 py-1 rounded-lg bg-[#f37121] text-white text-xs font-medium disabled:opacity-60">{brandSaving ? '…' : t.save}</button>
                <button type="button" onClick={() => setBrandEdit(false)} className="px-2 py-1 text-xs text-slate-400">✕</button>
              </>
            ) : (
              <>
                <span className={`text-sm font-medium ${v.tireBrand ? 'text-slate-800' : 'text-slate-300'}`}>{v.tireBrand || t.notSet}</span>
                {isLs2Admin(user?.role) && <button type="button" title={t.edit} onClick={() => { setBrandInput(v.tireBrand || ''); setBrandEdit(true); }} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-[#f37121]"><Wrench className="w-3.5 h-3.5" /></button>}
              </>
            )}
          </div>
        </div>
        <TireLayout tires={v.tires} t={t} lang={lang as Lang} />
      </div>

      {/* Open alerts */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-red-600" /> {t.alerts} ({openAlerts.length})</h2>
        <div className="divide-y divide-slate-100">
          {openAlerts.map((a) => {
            const sv = severityStyle(a.severity);
            return (
              <div key={a._id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sv.dot}`} /><div className="min-w-0"><p className="text-sm text-slate-800 truncate">{alertTypeLabel(a.type, lang as Lang)}</p><p className="text-xs text-slate-400 truncate">{alertMessage(a, lang as Lang)}</p></div></div>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.lastSeenAt, lang as Lang)}</span>
              </div>
            );
          })}
          {openAlerts.length === 0 && <p className="text-slate-400 text-sm py-3">{lang === 'ar' ? 'لا توجد تنبيهات' : 'No open alerts'}</p>}
        </div>
      </div>
    </div>
  );
}

function IdField({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-sm text-slate-800 truncate ${mono ? 'font-mono text-xs' : 'font-medium'}`} title={value}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className={`text-lg font-bold mt-0.5 tabular-nums ${accent || 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function TireLayout({ tires, t, lang }: { tires: Tire[]; t: any; lang: Lang }) {
  if (!tires || tires.length === 0) return <p className="text-slate-400 text-sm py-4 text-center">{t.noTireData}</p>;
  const axles = [...new Set(tires.map((x) => x.axle))].sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      {axles.map((axle) => {
        const row = tires.filter((x) => x.axle === axle).sort((a, b) => a.position - b.position);
        return (
          <div key={axle} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">{t.axle} {axle}</span>
            <div className="flex flex-wrap gap-2">
              {row.map((tire) => (
                <div key={`${axle}-${tire.position}`} className="rounded-xl min-w-[168px] overflow-hidden border border-slate-200 shadow-sm">
                  <p className="text-[11px] text-slate-500 bg-slate-50 py-1 text-center font-medium">{lang === 'ar' ? 'إطار' : 'Tire'} {tire.position}</p>
                  {tire.fault ? (
                    <div className="bg-slate-50 py-5 text-center text-slate-400 text-sm font-medium">{lang === 'ar' ? 'عطل حساس' : 'Sensor fault'}</div>
                  ) : (
                    <div className="flex">
                      {/* Left half — temperature, coloured by its state */}
                      <div className={`flex-1 py-3 text-center ${tireTempColor(tire.tempC)}`}>
                        <p className="text-[10px] opacity-70 leading-none mb-1">{lang === 'ar' ? 'حرارة' : 'Temp'}</p>
                        <p className="text-lg font-bold leading-none">{tire.tempC != null ? `${tire.tempC}°` : '—'}</p>
                        <p className="text-[9px] opacity-60 leading-none mt-0.5">°C</p>
                      </div>
                      {/* Right half — pressure, coloured by its state */}
                      <div className={`flex-1 py-3 text-center border-s-2 border-slate-300 ${tirePressColor(tire.pressurePsi)}`}>
                        <p className="text-[10px] opacity-70 leading-none mb-1">{lang === 'ar' ? 'ضغط' : 'Pressure'}</p>
                        <p className="text-lg font-bold leading-none">{tire.pressurePsi != null ? `${tire.pressurePsi}` : '—'}</p>
                        <p className="text-[9px] opacity-60 leading-none mt-0.5">psi</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
