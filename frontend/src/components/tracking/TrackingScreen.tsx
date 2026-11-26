'use client';
/**
 * Vehicle tracking (Express GPS units): live map with search and filters, one unit's route for any span with its analysis
 * (distance, moving/stopped time, stops, speeding, per-day table and chart, playback), and the fleet distance ranking.
 * `base` is the API mount (B2C page or the vehicles section); `only` pins the screen to one unit (vehicle profile).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Search, Navigation, Route as RouteIcon, Play, Pause, X, Crosshair, RefreshCw, MapPin, Gauge, Clock, ParkingCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu from '@/components/ls2/ExportMenu';
import TrackMap, { STATE_COLOR, type UnitState, type RoutePoint } from './TrackMap';

export type Unit = {
  imei: string; name: string; plate: string; mediaGo: boolean; lat: number | null; lng: number | null; speed: number; angle: number | null;
  at: string | null; state: UnitState; io: { ignition?: boolean; externalVoltage?: number; batteryVoltage?: number; satellites?: number; odometerKm?: number };
  vehicle: { _id: string; plateNumber: string; city: string; brand: string; color: string; serviceStatus: string } | null;
  rider: { _id?: string; name: string; phone?: string; project?: string; city?: string } | null;
};
type Stats = {
  km: number; points: number; movingMinutes: number; idleMinutes: number; stoppedMinutes: number; spanMinutes: number; maxSpeed: number; avgMovingSpeed: number;
  speedLimit: number; speedingCount: number; speeding: { at: string; maxSpeed: number; lat: number; lng: number; seconds: number }[];
  stopsCount: number; stops: { from: string; to: string; minutes: number; lat: number; lng: number }[]; first: string | null; last: string | null;
  days: { day: string; km: number; movingMin: number; maxSpeed: number; firstMove: string | null; lastMove: string | null; points: number }[];
};
type SumRow = { imei: string; name: string; plate: string; mediaGo: boolean; state: UnitState; at: string | null; vehicleId: string | null; city: string; rider: string; project: string; km: number | null };

const STATE_AR: Record<UnitState, [string, string]> = {
  moving: ['يتحرّك', 'Moving'], idling: ['تشغيل بدون حركة', 'Idling'], stopped: ['متوقّف', 'Stopped'], late: ['تأخّر الإرسال', 'Late'], offline: ['لا يُرسِل', 'Offline'],
};
const riyadh = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const shift = (days: number) => riyadh(new Date(Date.now() - days * 86400000));
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const tm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '—');
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const n1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

function periods(ar: boolean) {
  const today = riyadh(); const d = new Date(`${today}T12:00:00+03:00`);
  const monthStart = `${today.slice(0, 7)}-01`;
  const pm = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const pmStart = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}-01`;
  const pmEnd = riyadh(new Date(new Date(`${monthStart}T12:00:00+03:00`).getTime() - 86400000));
  return [
    { k: 'today', l: ar ? 'اليوم' : 'Today', f: today, t: today },
    { k: 'yesterday', l: ar ? 'أمس' : 'Yesterday', f: shift(1), t: shift(1) },
    { k: 'week', l: ar ? 'آخر 7 أيام' : 'Last 7 days', f: shift(6), t: today },
    { k: 'month', l: ar ? 'هذا الشهر' : 'This month', f: monthStart, t: today },
    { k: 'prev', l: ar ? 'الشهر الماضي' : 'Last month', f: pmStart, t: pmEnd },
  ];
}

function PeriodPicker({ ar, from, to, onChange, maxDays }: { ar: boolean; from: string; to: string; onChange: (f: string, t: string) => void; maxDays: number }) {
  const ps = periods(ar);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
        {ps.map((p) => (
          <button key={p.k} type="button" onClick={() => onChange(p.f, p.t)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold ${from === p.f && to === p.t ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{p.l}</button>
        ))}
      </div>
      <input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to < e.target.value ? e.target.value : to)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
      <span className="text-slate-400 text-xs">←</span>
      <input type="date" value={to} min={from} max={riyadh()} onChange={(e) => e.target.value && onChange(from, e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
      <span className="text-[11px] text-slate-400">{ar ? `أقصى ${maxDays} يومًا` : `max ${maxDays} days`}</span>
    </div>
  );
}

function Card({ icon, label, value, sub, tone = '#0f172a' }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">{icon}{label}</div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums" style={{ color: tone }}>{value}</div>
      {sub ? <div className="text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

export default function TrackingScreen({ base, ar, only }: { base: string; ar: boolean; only?: Unit | null }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [units, setUnits] = useState<Unit[]>(only ? [only] : []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(!only);
  const [err, setErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [q, setQ] = useState('');
  const [states, setStates] = useState<Set<UnitState>>(new Set());
  const [mediaGoOnly, setMediaGoOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(only?.imei || null);
  const [follow, setFollow] = useState(!!only);
  const [tab, setTab] = useState<'live' | 'fleet'>('live');

  const loadUnits = useCallback(async () => {
    try {
      const d = await api.get<{ units: Unit[]; counts: Record<string, number>; at: string }>(`${base}/units`);
      setUnits(only ? d.units.filter((u) => u.imei === only.imei) : d.units);
      setCounts(d.counts || {}); setUpdatedAt(d.at); setErr('');
    } catch (e: any) { setErr(e?.message || t('تعذّر الاتصال بمزوّد التتبّع', 'Tracking provider unavailable')); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, only?.imei]);
  useEffect(() => {
    loadUnits();
    // Positions arrive about every 2 min from a moving unit; 30 s keeps the map current without hammering the provider.
    const id = setInterval(() => { if (!document.hidden) loadUnits(); }, 30000);
    return () => clearInterval(id);
  }, [loadUnits]);

  // Deep link: ?imei= or ?q= from the vehicles list or profile.
  useEffect(() => {
    if (only || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('imei')) { setSelected(sp.get('imei')); setFollow(true); }
    if (sp.get('q')) setQ(sp.get('q') || '');
  }, [only]);

  const fold = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase();
  const shown = useMemo(() => {
    const k = fold(q.trim());
    return units.filter((u) => (!states.size || states.has(u.state)) && (!mediaGoOnly || u.mediaGo)
      && (!k || fold(`${u.name} ${u.plate} ${u.rider?.name || ''} ${u.rider?.project || ''} ${u.vehicle?.city || ''} ${u.imei}`).includes(k)))
      .sort((a, b) => ['moving', 'idling', 'stopped', 'late', 'offline'].indexOf(a.state) - ['moving', 'idling', 'stopped', 'late', 'offline'].indexOf(b.state) || a.plate.localeCompare(b.plate));
  }, [units, q, states, mediaGoOnly]);
  const sel = units.find((u) => u.imei === selected) || null;

  // Route.
  const [from, setFrom] = useState(riyadh());
  const [to, setTo] = useState(riyadh());
  const [limit, setLimit] = useState(80);
  const [route, setRoute] = useState<{ points: RoutePoint[]; stats: Stats } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [play, setPlay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const seq = useRef(0);
  const loadRoute = useCallback(async (imei: string, f: string, tt: string, lim: number) => {
    const n = ++seq.current;
    setRouteBusy(true); setPlay(null); setPlaying(false);
    try {
      const d = await api.get<{ points: RoutePoint[]; stats: Stats }>(`${base}/units/${imei}/history?from=${f}&to=${tt}&speedLimit=${lim}`);
      if (n === seq.current) setRoute(d);
    } catch (e: any) { if (n === seq.current) { setRoute(null); setErr(e?.message || 'Failed'); } }
    if (n === seq.current) setRouteBusy(false);
  }, [base]);
  useEffect(() => { if (routeOpen && selected) loadRoute(selected, from, to, limit); }, [routeOpen, selected, from, to, limit, loadRoute]);
  useEffect(() => { if (!selected) { setRouteOpen(false); setRoute(null); } }, [selected]);
  useEffect(() => {
    if (!playing || !route) return undefined;
    const id = setInterval(() => setPlay((p) => { const nx = (p ?? 0) + Math.max(1, Math.round(route.points.length / 600)); if (nx >= route.points.length) { setPlaying(false); return route.points.length - 1; } return nx; }), 80);
    return () => clearInterval(id);
  }, [playing, route]);

  // Fleet ranking.
  const [sFrom, setSFrom] = useState(riyadh());
  const [sTo, setSTo] = useState(riyadh());
  const [sum, setSum] = useState<{ rows: SumRow[]; totals: { km: number; units: number; activeUnits: number; idleUnits: number; avgKmActive: number } } | null>(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sq, setSq] = useState('');
  useEffect(() => {
    if (tab !== 'fleet' || only) return;
    let dead = false;
    setSumBusy(true);
    api.get<any>(`${base}/summary?from=${sFrom}&to=${sTo}`).then((d) => { if (!dead) setSum(d); }).catch((e) => { if (!dead) setErr(e?.message || 'Failed'); }).finally(() => { if (!dead) setSumBusy(false); });
    return () => { dead = true; };
  }, [tab, sFrom, sTo, base, only]);
  const sumRows = useMemo(() => {
    const k = fold(sq.trim());
    return (sum?.rows || []).filter((r) => (!mediaGoOnly || r.mediaGo) && (!k || fold(`${r.name} ${r.plate} ${r.rider} ${r.project} ${r.city}`).includes(k)));
  }, [sum, sq, mediaGoOnly]);

  const pickUnit = (imei: string) => { setSelected(imei); setFollow(true); const u = units.find((x) => x.imei === imei); if (u?.lat != null) setFocus({ lat: u.lat, lng: u.lng as number, zoom: 15 }); };
  const toggleState = (s: UnitState) => setStates((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const st = route?.stats;
  const mapUnits = (routeOpen ? units.filter((u) => u.imei === selected) : shown).map((u) => ({ imei: u.imei, plate: u.plate, lat: u.lat, lng: u.lng, angle: u.angle, speed: u.speed, state: u.state, label: u.rider?.name || '' }));
  const playPoint = route && play != null ? route.points[play] : null;

  const unitPanel = sel && (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold text-slate-900 text-base" dir="auto">{sel.plate}{sel.mediaGo && <span className="ms-2 rounded bg-violet-100 text-violet-700 text-[10px] font-bold px-1.5 py-0.5">MEDIA GO</span>}</div>
          <div className="text-xs text-slate-500">{[sel.rider?.name, sel.rider?.project, sel.vehicle?.city || sel.rider?.city].filter(Boolean).join(' · ') || t('لا راكب مربوط', 'No rider linked')}</div>
        </div>
        {!only && <button type="button" onClick={() => setSelected(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: STATE_COLOR[sel.state] }}>{STATE_AR[sel.state][ar ? 0 : 1]}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{Math.round(sel.speed)} {t('كم/س', 'km/h')}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('آخر إشارة', 'Last fix')} {dt(sel.at)}</span>
        {sel.io.ignition != null && <span className={`rounded-full px-2 py-0.5 ${sel.io.ignition ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t('المحرّك', 'Ignition')} {sel.io.ignition ? t('يعمل', 'on') : t('مطفأ', 'off')}</span>}
        {sel.io.externalVoltage != null && <span className="rounded-full bg-slate-100 px-2 py-0.5" dir="ltr">{sel.io.externalVoltage} V</span>}
        {sel.io.satellites != null && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('أقمار', 'Sats')} {sel.io.satellites}</span>}
      </div>
      {sel.rider?.phone && <div className="text-xs text-slate-500" dir="ltr">{sel.rider.phone}</div>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => { setFollow((f) => !f); if (sel.lat != null) setFocus({ lat: sel.lat, lng: sel.lng as number, zoom: 16 }); }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${follow ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}><Crosshair className="w-3.5 h-3.5" />{follow ? t('يتابِع لايف', 'Following') : t('تابِع لايف', 'Follow live')}</button>
        <button type="button" onClick={() => setRouteOpen((o) => !o)}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${routeOpen ? 'bg-[#f37121] text-white' : 'bg-orange-50 text-[#c2410c]'}`}><RouteIcon className="w-3.5 h-3.5" />{t('خط السير والتحليل', 'Route & analysis')}</button>
        {sel.lat != null && <a href={`https://www.google.com/maps?q=${sel.lat},${sel.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700"><MapPin className="w-3.5 h-3.5" />Google Maps</a>}
        {!only && sel.vehicle && <Link href={`/system/vehicles/registry/${sel.vehicle._id}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">{t('ملف المركبة', 'Vehicle file')}</Link>}
      </div>
    </div>
  );

  const routePanel = routeOpen && sel && (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodPicker ar={ar} from={from} to={to} maxDays={31} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">{t('حدّ السرعة', 'Speed limit')}
            <input type="number" min={20} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 80)} className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs" /></label>
        </div>
        {routeBusy && <div className="text-xs text-slate-500 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />{t('جارٍ تحميل خط السير…', 'Loading route…')}</div>}
        {route && !routeBusy && route.points.length < 2 && <div className="text-xs text-slate-500">{t('لا حركة مسجّلة في هذه الفترة', 'No movement recorded in this period')}</div>}
        {route && route.points.length > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { if (play == null || play >= route.points.length - 1) setPlay(0); setPlaying((p) => !p); }} className="p-1.5 rounded-lg bg-slate-900 text-white">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
            <input type="range" min={0} max={route.points.length - 1} value={play ?? 0} onChange={(e) => { setPlaying(false); setPlay(Number(e.target.value)); }} className="flex-1 accent-[#f37121]" />
            <span className="text-[11px] tabular-nums text-slate-600 w-36 text-end" dir="ltr">{playPoint ? `${dt(new Date(playPoint[0]).toISOString())} · ${Math.round(playPoint[3])} km/h` : '—'}</span>
          </div>
        )}
      </div>
      {st && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Card icon={<RouteIcon className="w-3.5 h-3.5" />} label={t('المسافة', 'Distance')} value={`${n1(st.km)} ${t('كم', 'km')}`} sub={st.days.length > 1 ? `${t('متوسط اليوم', 'per day')} ${n1(st.km / st.days.length)}` : undefined} tone="#f37121" />
            <Card icon={<Navigation className="w-3.5 h-3.5" />} label={t('وقت الحركة', 'Moving')} value={hm(st.movingMinutes)} sub={`${t('تشغيل بدون حركة', 'idling')} ${hm(st.idleMinutes)}`} tone="#16a34a" />
            <Card icon={<ParkingCircle className="w-3.5 h-3.5" />} label={t('التوقّفات (5 د+)', 'Stops (5 min+)')} value={st.stopsCount} sub={`${t('مجموعها', 'total')} ${hm(st.stoppedMinutes)}`} tone="#2563eb" />
            <Card icon={<Gauge className="w-3.5 h-3.5" />} label={t('أعلى / متوسط سرعة', 'Max / avg speed')} value={`${st.maxSpeed} / ${st.avgMovingSpeed}`} sub={t('كم/س', 'km/h')} />
            <Card icon={<AlertTriangle className="w-3.5 h-3.5" />} label={`${t('تجاوز', 'Over')} ${st.speedLimit} ${t('كم/س', 'km/h')}`} value={st.speedingCount} sub={t('مرّة', 'times')} tone={st.speedingCount ? '#dc2626' : '#0f172a'} />
            <Card icon={<Clock className="w-3.5 h-3.5" />} label={t('أوّل / آخر إشارة', 'First / last fix')} value={<span className="text-sm">{dt(st.first)}</span>} sub={dt(st.last)} />
            <Card icon={<MapPin className="w-3.5 h-3.5" />} label={t('أيّام بحركة', 'Days with movement')} value={`${st.days.filter((d) => d.km >= 1).length} / ${st.days.length}`} />
            <Card icon={<MapPin className="w-3.5 h-3.5" />} label={t('نقاط الموقع', 'Fixes')} value={st.points.toLocaleString('en-US')} />
          </div>
          <div className="flex justify-end">
            <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`route-${sel.plate}-${from}-${to}`} options={[{
              key: 'all', label: t('تحليل خط السير', 'Route analysis'),
              sheets: [
                { name: t('الأيام', 'Days'), rows: st.days.map((d) => ({ ...d, firstMove: tm(d.firstMove), lastMove: tm(d.lastMove), movingMin: hm(d.movingMin) })), columns: [
                  { header: t('اليوم', 'Day'), key: 'day' }, { header: t('كم', 'km'), key: 'km', type: 'number' }, { header: t('وقت الحركة', 'Moving'), key: 'movingMin' },
                  { header: t('أعلى سرعة', 'Max speed'), key: 'maxSpeed', type: 'number' }, { header: t('أول حركة', 'First move'), key: 'firstMove' }, { header: t('آخر حركة', 'Last move'), key: 'lastMove' }] },
                { name: t('التوقفات', 'Stops'), rows: st.stops.map((s) => ({ from: dt(s.from), to: dt(s.to), minutes: s.minutes, map: `https://www.google.com/maps?q=${s.lat},${s.lng}` })), columns: [
                  { header: t('من', 'From'), key: 'from' }, { header: t('إلى', 'To'), key: 'to' }, { header: t('الدقائق', 'Minutes'), key: 'minutes', type: 'number' }, { header: t('الموقع', 'Location'), key: 'map' }] },
                { name: t('تجاوز السرعة', 'Speeding'), rows: st.speeding.map((s) => ({ at: dt(s.at), maxSpeed: s.maxSpeed, seconds: s.seconds, map: `https://www.google.com/maps?q=${s.lat},${s.lng}` })), columns: [
                  { header: t('الوقت', 'Time'), key: 'at' }, { header: t('السرعة', 'Speed'), key: 'maxSpeed', type: 'number' }, { header: t('ثوانٍ', 'Seconds'), key: 'seconds', type: 'number' }, { header: t('الموقع', 'Location'), key: 'map' }] },
              ],
            }]} />
          </div>
          {st.days.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-bold text-slate-700 mb-2">{t('الكيلومترات يوميًا', 'Kilometres per day')}</div>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={st.days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} fontSize={10} /><YAxis fontSize={10} width={34} />
                    <Tooltip formatter={(v: any) => [`${v} ${t('كم', 'km')}`, '']} /><Bar dataKey="km" fill="#f37121" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              </div>
              <ScrollX className="mt-2 max-h-56 overflow-y-auto">
                <table className="w-full text-xs"><thead className="bg-slate-900 text-white sticky top-0"><tr>
                  {[t('اليوم', 'Day'), t('كم', 'km'), t('وقت الحركة', 'Moving'), t('أعلى سرعة', 'Max'), t('أول حركة', 'First'), t('آخر حركة', 'Last')].map((h) => <th key={h} className="px-2 py-1.5 text-start">{h}</th>)}
                </tr></thead><tbody className="divide-y divide-slate-100">
                  {st.days.map((d) => (
                    <tr key={d.day} className="hover:bg-orange-50 cursor-pointer" onClick={() => { setFrom(d.day); setTo(d.day); }}>
                      <td className="px-2 py-1">{d.day}</td><td className="px-2 py-1 font-bold">{n1(d.km)}</td><td className="px-2 py-1">{hm(d.movingMin)}</td><td className="px-2 py-1">{d.maxSpeed}</td><td className="px-2 py-1">{tm(d.firstMove)}</td><td className="px-2 py-1">{tm(d.lastMove)}</td>
                    </tr>))}
                </tbody></table>
              </ScrollX>
            </div>
          )}
          {st.stops.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-bold text-slate-700 mb-2">{t('التوقّفات', 'Stops')} ({st.stopsCount})</div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                {st.stops.map((s, i) => (
                  <button key={i} type="button" onClick={() => setFocus({ lat: s.lat, lng: s.lng, zoom: 17 })} className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-xs hover:bg-slate-50 text-start">
                    <span><b>P{i + 1}</b> · {dt(s.from)} – {tm(s.to)}</span><span className="font-bold text-blue-700">{hm(s.minutes)}</span>
                  </button>))}
              </div>
            </div>
          )}
          {st.speeding.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-bold text-red-700 mb-2">{t('تجاوزات السرعة', 'Speeding')} ({st.speedingCount})</div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {st.speeding.map((s, i) => (
                  <button key={i} type="button" onClick={() => setFocus({ lat: s.lat, lng: s.lng, zoom: 16 })} className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-xs hover:bg-red-50 text-start">
                    <span>{dt(s.at)} · {s.seconds} {t('ث', 's')}</span><span className="font-bold text-red-600">{s.maxSpeed} {t('كم/س', 'km/h')}</span>
                  </button>))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const map = (
    <TrackMap ar={ar} units={mapUnits} selected={selected} onSelect={pickUnit} follow={follow && !routeOpen}
      route={routeOpen ? route?.points || null : null} stops={routeOpen ? st?.stops || [] : []} speeding={routeOpen ? st?.speeding || [] : []}
      speedLimit={limit} playIndex={routeOpen ? play : null} focus={focus} height={only ? 420 : 'calc(100vh - 260px)'} />
  );

  if (only) {
    return (
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{err}</div>}
        {unitPanel}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-3"><div>{map}</div><div>{routePanel}</div></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {([['all', t('كل الأجهزة', 'All units'), counts.total, '#0f172a'], ['moving', STATE_AR.moving[ar ? 0 : 1], counts.moving, STATE_COLOR.moving], ['idling', STATE_AR.idling[ar ? 0 : 1], counts.idling, STATE_COLOR.idling],
          ['stopped', STATE_AR.stopped[ar ? 0 : 1], counts.stopped, STATE_COLOR.stopped], ['late', STATE_AR.late[ar ? 0 : 1], counts.late, STATE_COLOR.late], ['offline', STATE_AR.offline[ar ? 0 : 1], counts.offline, STATE_COLOR.offline]] as const).map(([k, l, v, c]) => (
          <button key={k} type="button" onClick={() => (k === 'all' ? setStates(new Set()) : toggleState(k as UnitState))}
            className={`rounded-xl border bg-white px-3 py-2 text-start ${k !== 'all' && states.has(k as UnitState) ? 'ring-2' : ''}`} style={{ borderColor: k !== 'all' && states.has(k as UnitState) ? c : '#e2e8f0' }}>
            <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</div>
            <div className="text-xl font-extrabold tabular-nums" style={{ color: c }}>{v ?? '—'}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {([['live', t('الخريطة المباشرة', 'Live map')], ['fleet', t('المسافات والتحليل', 'Distances & analysis')]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={mediaGoOnly} onChange={(e) => setMediaGoOnly(e.target.checked)} className="accent-violet-600" />{t('Media Go فقط', 'Media Go only')} ({counts.mediaGo ?? 0})</label>
        <span className="text-[11px] text-slate-400 ms-auto">{t('يتحدّث كل 30 ثانية', 'Refreshes every 30 s')} · {updatedAt ? tm(updatedAt) : '—'}</span>
        <button type="button" onClick={loadUnits} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200"><RefreshCw className="w-4 h-4 text-slate-600" /></button>
      </div>
      {err && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{err}</div>}

      {tab === 'live' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-3">
          <div className="space-y-3 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto">
            {unitPanel}
            {routePanel}
            {!routeOpen && (
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="p-2 border-b border-slate-100 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-4" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('لوحة، راكب، مشروع، مدينة…', 'Plate, rider, project, city…')} className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </div>
                <div className="text-[11px] text-slate-400 px-3 pt-1.5">{shown.length} {t('مركبة', 'vehicles')}</div>
                <div className="divide-y divide-slate-100">
                  {loading && <div className="p-4 text-sm text-slate-400">{t('جارٍ الاتصال بمزوّد التتبّع… قد يستغرق أول تحميل حتى 30 ثانية', 'Contacting the tracking provider… the first load can take up to 30 s')}</div>}
                  {shown.map((u) => (
                    <button key={u.imei} type="button" onClick={() => pickUnit(u.imei)} className={`w-full text-start px-3 py-2 hover:bg-orange-50 ${u.imei === selected ? 'bg-orange-50' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATE_COLOR[u.state] }} />{u.plate}{u.mediaGo && <span className="rounded bg-violet-100 text-violet-700 text-[9px] font-bold px-1">MG</span>}</span>
                        <span className="text-[11px] tabular-nums text-slate-500">{u.state === 'moving' ? `${Math.round(u.speed)} ${t('كم/س', 'km/h')}` : tm(u.at)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{[u.rider?.name, u.rider?.project, u.vehicle?.city].filter(Boolean).join(' · ') || (u.vehicle ? '' : t('غير مربوطة بسجلّ المركبات', 'Not in the vehicle register'))}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>{map}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center justify-between gap-2">
            <PeriodPicker ar={ar} from={sFrom} to={sTo} maxDays={62} onChange={(f, tt) => { setSFrom(f); setSTo(tt); }} />
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder={t('بحث…', 'Search…')} className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-sm w-52" />
            </div>
          </div>
          {sumBusy && <div className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{t('جارٍ حساب المسافات لكل المركبات…', 'Computing distances for every vehicle…')}</div>}
          {sum && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Card icon={<RouteIcon className="w-3.5 h-3.5" />} label={t('إجمالي الكيلومترات', 'Total km')} value={n1(sumRows.reduce((a, r) => a + (r.km || 0), 0))} tone="#f37121" />
                <Card icon={<Navigation className="w-3.5 h-3.5" />} label={t('مركبات تحرّكت', 'Vehicles that moved')} value={sumRows.filter((r) => (r.km || 0) >= 1).length} tone="#16a34a" />
                <Card icon={<ParkingCircle className="w-3.5 h-3.5" />} label={t('لم تتحرّك', 'Did not move')} value={sumRows.filter((r) => (r.km || 0) < 1).length} tone="#475569" />
                <Card icon={<Gauge className="w-3.5 h-3.5" />} label={t('متوسط كم للمتحرّكة', 'Avg km (moving)')} value={(() => { const a = sumRows.filter((r) => (r.km || 0) >= 1); return a.length ? n1(a.reduce((x, r) => x + (r.km || 0), 0) / a.length) : 0; })()} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-bold text-slate-700 mb-2">{t('الأعلى كيلومترات', 'Top distance')}</div>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sumRows.slice(0, 20)}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="plate" fontSize={9} interval={0} angle={-35} textAnchor="end" height={55} /><YAxis fontSize={10} width={40} />
                      <Tooltip formatter={(v: any) => [`${v} ${t('كم', 'km')}`, '']} /><Bar dataKey="km" fill="#f37121" radius={[4, 4, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                  <span className="text-sm font-bold text-slate-800">{t('كل المركبات', 'All vehicles')} ({sumRows.length})</span>
                  <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`tracking-distance-${sFrom}-${sTo}`} options={[{ key: 'all', label: t('المسافات', 'Distances'), sheets: [{ name: t('المسافات', 'Distances'), rows: sumRows.map((r) => ({ ...r, state: STATE_AR[r.state][ar ? 0 : 1], mediaGo: r.mediaGo ? 'نعم' : '' })), columns: [
                    { header: t('اللوحة', 'Plate'), key: 'plate' }, { header: 'Media Go', key: 'mediaGo' }, { header: t('الراكب', 'Rider'), key: 'rider' }, { header: t('المشروع', 'Project'), key: 'project' },
                    { header: t('المدينة', 'City'), key: 'city' }, { header: t('كم', 'km'), key: 'km', type: 'number' }, { header: t('الحالة الآن', 'State now'), key: 'state' }] }] }]} />
                </div>
                <ScrollX className="max-h-[32rem] overflow-y-auto">
                  <table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-900 text-white sticky top-0 text-xs"><tr>
                    {['#', t('اللوحة', 'Plate'), t('الراكب', 'Rider'), t('المشروع', 'Project'), t('المدينة', 'City'), t('كم', 'km'), t('الحالة الآن', 'Now'), ''].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
                  </tr></thead><tbody className="divide-y divide-slate-100">
                    {sumRows.map((r, i) => (
                      <tr key={r.imei} className="hover:bg-orange-50">
                        <td className="px-3 py-1.5 text-slate-400 text-xs">{i + 1}</td>
                        <td className="px-3 py-1.5 font-bold">{r.plate}{r.mediaGo && <span className="ms-1 rounded bg-violet-100 text-violet-700 text-[9px] font-bold px-1">MG</span>}</td>
                        <td className="px-3 py-1.5">{r.rider || '—'}</td><td className="px-3 py-1.5">{r.project || '—'}</td><td className="px-3 py-1.5">{r.city || '—'}</td>
                        <td className="px-3 py-1.5 font-extrabold text-[#f37121] tabular-nums">{r.km == null ? '—' : n1(r.km)}</td>
                        <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[r.state] }} />{STATE_AR[r.state][ar ? 0 : 1]}</span></td>
                        <td className="px-3 py-1.5"><button type="button" onClick={() => { setTab('live'); setSelected(r.imei); setFrom(sFrom); setTo(sTo); setRouteOpen(true); }} className="text-xs font-semibold text-[#c2410c] hover:underline">{t('خط السير', 'Route')}</button></td>
                      </tr>))}
                  </tbody></table>
                </ScrollX>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
