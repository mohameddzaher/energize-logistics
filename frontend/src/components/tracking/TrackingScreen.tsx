'use client';
/**
 * Vehicle tracking (Express GPS units), three tabs:
 *   live      every unit on the map, pushed over the socket as positions change (room `tracking`), markers glide, the followed
 *             unit draws its last half hour;
 *   history   one unit's route for a day, a month or any range: map with playback, analysis, and day / stop / speeding tables with
 *             Excel-style column filters, Excel export (shown or all) and a PDF report;
 *   fleet     kilometres of every unit for a period, same filters, exports and PDF.
 * `base` is the API mount (B2C page or the vehicles section); `only` pins the screen to one unit (vehicle profile).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Search, Navigation, Route as RouteIcon, Play, Pause, X, Crosshair, RefreshCw, MapPin, Gauge, Clock, ParkingCircle, AlertTriangle, FileDown, History, BarChart3, Radio } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { SearchableSelect } from '@/components/hr/HRKit';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { useDialog } from '@/components/system/DialogProvider';
import { routeReportPdf, fleetReportPdf, type RouteStats } from '@/lib/trackingReport';
import TrackMap, { STATE_COLOR, type UnitState, type RoutePoint } from './TrackMap';

export type Unit = {
  imei: string; name: string; plate: string; mediaGo: boolean; lat: number | null; lng: number | null; speed: number; angle: number | null;
  at: string | null; state: UnitState; io: { ignition?: boolean; externalVoltage?: number; batteryVoltage?: number; satellites?: number; odometerKm?: number };
  vehicle: { _id: string; plateNumber: string; city: string; department?: string; brand: string; color: string; serviceStatus: string } | null;
  rider: { _id?: string; name: string; phone?: string; project?: string; city?: string; idNumber?: string; workStatus?: string } | null;
};
type Stats = RouteStats;
type DayRow = Stats['days'][number];
type StopRow = Stats['stops'][number] & { n: number };
type SpeedRow = Stats['speeding'][number];
type SumRow = { imei: string; name: string; plate: string; mediaGo: boolean; state: UnitState; at: string | null; vehicleId: string | null; city: string; rider: string; project: string; km: number | null };
type Col<T> = { key: string; label: string; get: (r: T) => any; show?: (r: T) => React.ReactNode; filter?: boolean; cls?: string };

const STATE_AR: Record<UnitState, [string, string]> = {
  moving: ['يتحرّك', 'Moving'], idling: ['تشغيل بدون حركة', 'Idling'], stopped: ['متوقّف', 'Stopped'], late: ['تأخّر الإرسال', 'Late'], offline: ['لا يُرسِل', 'Offline'],
};
const ORDER: UnitState[] = ['moving', 'idling', 'stopped', 'late', 'offline'];
const riyadh = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const shift = (days: number) => riyadh(new Date(Date.now() - days * 86400000));
const shiftFrom = (d: string, days: number) => riyadh(new Date(new Date(`${d}T12:00:00+03:00`).getTime() + days * 86400000));
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const tm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '—');
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const n1 = (n: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
const ago = (iso: string | null, ar: boolean) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return ar ? 'الآن' : 'now';
  if (m < 60) return ar ? `منذ ${m} د` : `${m} min ago`;
  if (m < 1440) return ar ? `منذ ${Math.floor(m / 60)} س` : `${Math.floor(m / 60)} h ago`;
  return dt(iso);
};
/** Every field known about a unit: vehicle (register), rider (B2C register) and device (last fix). One list for the card, Excel and PDF. */
const detailRows = (u: Unit, ar: boolean): [string, string][] => {
  const t = (a: string, e: string) => (ar ? a : e);
  const v = u.vehicle; const r = u.rider; const io = u.io || {};
  const rows: [string, string | number | null | undefined][] = [
    [t('اللوحة', 'Plate'), u.plate],
    [t('الماركة والطراز', 'Make / model'), v?.brand],
    [t('اللون', 'Color'), v?.color],
    [t('المدينة', 'City'), v?.city || r?.city],
    [t('القسم', 'Department'), v?.department],
    [t('حالة الخدمة', 'Service status'), v?.serviceStatus],
    ['Media Go', u.mediaGo ? t('نعم', 'Yes') : t('لا', 'No')],
    [t('الراكب', 'Rider'), r?.name],
    [t('جوال الراكب', 'Rider phone'), r?.phone],
    [t('رقم هوية الراكب', 'Rider ID'), r?.idNumber],
    [t('المشروع', 'Project'), r?.project],
    [t('حالة الراكب', 'Rider status'), r?.workStatus],
    [t('اسم الجهاز', 'Device name'), u.name],
    [t('رقم الجهاز (IMEI)', 'Device IMEI'), u.imei],
    [t('الحالة الآن', 'State now'), STATE_AR[u.state][ar ? 0 : 1]],
    [t('آخر إشارة', 'Last fix'), dt(u.at)],
    [t('السرعة الآن', 'Speed now'), `${Math.round(u.speed || 0)} ${t('كم/س', 'km/h')}`],
    [t('المحرّك', 'Ignition'), io.ignition == null ? '' : io.ignition ? t('يعمل', 'On') : t('مطفأ', 'Off')],
    [t('جهد المركبة', 'Vehicle voltage'), io.externalVoltage != null ? `${io.externalVoltage} V` : ''],
    [t('جهد بطارية الجهاز', 'Device battery'), io.batteryVoltage != null ? `${io.batteryVoltage} V` : ''],
    [t('الأقمار الصناعية', 'Satellites'), io.satellites],
    [t('عدّاد الكيلومترات', 'Odometer'), io.odometerKm != null ? `${n1(io.odometerKm)} ${t('كم', 'km')}` : ''],
    [t('الموقع الأخير', 'Last position'), u.lat != null ? `${u.lat.toFixed(5)}, ${(u.lng as number).toFixed(5)}` : ''],
  ];
  return rows.filter(([, x]) => x !== undefined && x !== null && String(x) !== '').map(([k, x]) => [k, String(x)]);
};
const fold = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase();
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const spanDays = (f: string, t: string) => Math.round((new Date(t).getTime() - new Date(f).getTime()) / 86400000) + 1;

/** Period: quick ranges, one day, one month, or a free range; the server limit is shown. */
function PeriodPicker({ ar, from, to, onChange, maxDays }: { ar: boolean; from: string; to: string; onChange: (f: string, t: string) => void; maxDays: number }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const today = riyadh();
  const monthStart = `${today.slice(0, 7)}-01`;
  const pm = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1);
  const pmKey = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;
  const quick = [
    [t('اليوم', 'Today'), today, today], [t('أمس', 'Yesterday'), shift(1), shift(1)], [t('آخر 7 أيام', 'Last 7 days'), shift(6), today],
    [t('هذا الشهر', 'This month'), monthStart, today], [t('الشهر الماضي', 'Last month'), `${pmKey}-01`, lastDay(pmKey)],
  ] as const;
  const [mode, setMode] = useState<'day' | 'month' | 'range'>(from === to ? 'day' : 'range');
  const days = spanDays(from, to);
  const inp = 'px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
        {quick.map(([l, f, tt]) => (
          <button key={l} type="button" onClick={() => onChange(f, tt)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold ${from === f && to === tt ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="px-1.5 py-1 rounded-md text-xs font-semibold bg-white border border-slate-200">
          <option value="day">{t('يوم محدّد', 'A day')}</option>
          <option value="month">{t('شهر محدّد', 'A month')}</option>
          <option value="range">{t('فترة من … إلى', 'From … to')}</option>
        </select>
        {mode === 'day' && <input type="date" value={from} max={today} onChange={(e) => e.target.value && onChange(e.target.value, e.target.value)} className={inp} />}
        {mode === 'month' && <input type="month" value={from.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => { const m = e.target.value; if (m) { const end = lastDay(m); onChange(`${m}-01`, end > today ? today : end); } }} className={inp} />}
        {mode === 'range' && (<>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to < e.target.value ? e.target.value : to)} className={inp} />
          <span className="text-slate-400 text-xs">←</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && onChange(from, e.target.value)} className={inp} />
        </>)}
      </div>
      <span className={`text-[11px] ${days > maxDays ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{days} {t('يوم', 'days')} · {t(`الحد ${maxDays}`, `max ${maxDays}`)}</span>
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

/** A full-width titled block. */
function Section({ title, tools, children }: { title: React.ReactNode; tools?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-sm font-bold text-slate-800">{title}</span>
        {tools ? <div className="flex flex-wrap items-center gap-2">{tools}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0 border-b border-slate-100 pb-1">
          <dt className="text-[11px] font-semibold text-slate-500">{k}</dt>
          <dd className="text-sm font-bold text-slate-800 break-words" dir="auto">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table with Excel-style funnels per column (values from the rows themselves). */
function FilterTable<T>({ ar, title, rows, cols, cf, onRow, empty, tools }: {
  ar: boolean; title: React.ReactNode; rows: T[]; cf: ReturnType<typeof useColumnFilters<T>>; cols: Col<T>[];
  onRow?: (r: T) => void; empty: string; tools?: React.ReactNode;
}) {
  const shown = cf.apply(rows, Object.fromEntries(cols.map((c) => [c.key, c.get])));
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800">{title} <span className="text-slate-400 font-normal">({shown.length}{shown.length !== rows.length ? ` / ${rows.length}` : ''})</span></span>
        <div className="flex items-center gap-2"><ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />{tools}</div>
      </div>
      <ScrollX className="max-h-[26rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-white text-xs sticky top-0 z-10"><tr>
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2 text-start font-semibold whitespace-nowrap">
                <span className="inline-flex items-center gap-1">{c.label}{c.filter !== false ? cf.header(c.key, rows, c.get, ar) : null}</span>
              </th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r, i) => (
              <tr key={i} className={`hover:bg-orange-50 ${onRow ? 'cursor-pointer' : ''}`} onClick={() => onRow?.(r)}>
                {cols.map((c) => <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${c.cls || ''}`}>{c.show ? c.show(r) : (c.get(r) || '—')}</td>)}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-400">{empty}</td></tr>}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}

export default function TrackingScreen({ base, ar, only }: { base: string; ar: boolean; only?: Unit | null }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const scope = exportScopeLabels(ar);
  const [units, setUnits] = useState<Unit[]>(only ? [only] : []);
  const [loading, setLoading] = useState(!only);
  const [err, setErr] = useState('');
  const [liveAt, setLiveAt] = useState<string>('');
  // Bumped when the register links change, so the distances tab refetches too.
  const [linksAt, setLinksAt] = useState(0);
  const [q, setQ] = useState('');
  const [states, setStates] = useState<Set<UnitState>>(new Set());
  const [selected, setSelected] = useState<string | null>(only?.imei || null);
  const [follow, setFollow] = useState(!!only);
  const [tab, setTab] = useState<'live' | 'history' | 'fleet'>(only ? 'history' : 'live');
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  const loadUnits = useCallback(async () => {
    try {
      const d = await api.get<{ units: Unit[]; at: string }>(`${base}/units`);
      setUnits(only ? d.units.filter((u) => u.imei === only.imei) : d.units);
      setLiveAt(d.at); setErr('');
    } catch (e: any) { setErr(e?.message || t('تعذّر الاتصال بمزوّد التتبّع', 'Tracking provider unavailable')); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, only?.imei]);

  // Live: positions pushed by the server as they change; a slow reload every 2 min keeps links (rider, vehicle) current.
  useEffect(() => {
    loadUnits();
    const s = getSocket();
    const join = () => s.emit('join:tracking');
    join();
    s.on('connect', join);
    const onPos = (d: { units: Partial<Unit>[]; at: string }) => {
      const by = new Map(d.units.map((u) => [u.imei as string, u]));
      setUnits((prev) => prev.map((u) => (by.has(u.imei) ? { ...u, ...by.get(u.imei), vehicle: u.vehicle, rider: u.rider } : u)));
      setLiveAt(d.at);
    };
    s.on('tracking:positions', onPos);
    // A vehicle flagged / unflagged Media Go, or a rider / device link changed: reload the list at once.
    const onLinks = () => { loadUnits(); setLinksAt(Date.now()); };
    s.on('tracking:links', onLinks);
    const id = setInterval(() => { if (!document.hidden) loadUnits(); }, 120000);
    return () => { clearInterval(id); s.off('tracking:positions', onPos); s.off('tracking:links', onLinks); s.off('connect', join); s.emit('leave:tracking'); };
  }, [loadUnits]);

  // Deep link: ?imei= or ?q= from the vehicles list or profile.
  useEffect(() => {
    if (only || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('imei')) { setSelected(sp.get('imei')); setFollow(true); }
    if (sp.get('q')) setQ(sp.get('q') || '');
  }, [only]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: units.length, mediaGo: 0 };
    units.forEach((u) => { c[u.state] = (c[u.state] || 0) + 1; if (u.mediaGo) c.mediaGo += 1; });
    return c;
  }, [units]);
  const shown = useMemo(() => {
    const k = fold(q.trim());
    return units.filter((u) => (!states.size || states.has(u.state))
      && (!k || fold(`${u.name} ${u.plate} ${u.rider?.name || ''} ${u.rider?.project || ''} ${u.vehicle?.city || ''} ${u.imei}`).includes(k)))
      .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.plate.localeCompare(b.plate));
  }, [units, q, states]);
  const sel = units.find((u) => u.imei === selected) || null;
  const mapUnits = useMemo(() => shown.map((u) => ({ imei: u.imei, plate: u.plate, lat: u.lat, lng: u.lng, angle: u.angle, speed: u.speed, state: u.state, label: u.rider?.name || '' })), [shown]);

  // Trail of the followed unit: its last 30 min, refreshed whenever a new fix arrives.
  const [trail, setTrail] = useState<[number, number][] | null>(null);
  const selAt = sel?.at; const selImei = sel?.imei;
  useEffect(() => {
    if (!follow || !selImei || tab !== 'live') { setTrail(null); return undefined; }
    let dead = false;
    const f = new Date(Date.now() - 30 * 60000).toISOString(); const tt = new Date().toISOString();
    api.get<{ points: RoutePoint[] }>(`${base}/units/${selImei}/history?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}`)
      .then((d) => { if (!dead) setTrail(d.points.map((p) => [p[1], p[2]] as [number, number])); }).catch(() => {});
    return () => { dead = true; };
  }, [follow, selImei, selAt, tab, base]);

  const pickUnit = (imei: string) => { setSelected(imei); setFollow(true); const u = units.find((x) => x.imei === imei); if (u?.lat != null) setFocus({ lat: u.lat, lng: u.lng as number, zoom: 15 }); };
  const toggleState = (s: UnitState) => setStates((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  // ── History ──
  const [hUnit, setHUnit] = useState<string>(only?.imei || '');
  const [from, setFrom] = useState(riyadh());
  const [to, setTo] = useState(riyadh());
  const [limit, setLimit] = useState(80);
  const [route, setRoute] = useState<{ points: RoutePoint[]; stats: Stats } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [play, setPlay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hFocus, setHFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const seq = useRef(0);
  const hDays = spanDays(from, to);
  useEffect(() => {
    if (tab !== 'history' || !hUnit || hDays > 31) return;
    const n = ++seq.current;
    setRouteBusy(true); setPlay(null); setPlaying(false);
    api.get<{ points: RoutePoint[]; stats: Stats }>(`${base}/units/${hUnit}/history?from=${from}&to=${to}&speedLimit=${limit}`, { timeoutMs: 120000 })
      .then((d) => { if (n === seq.current) setRoute(d); })
      .catch((e) => { if (n === seq.current) { setRoute(null); setErr(e?.message || 'Failed'); } })
      .finally(() => { if (n === seq.current) setRouteBusy(false); });
  }, [tab, hUnit, from, to, limit, base, hDays]);
  useEffect(() => {
    if (!playing || !route) return undefined;
    const id = setInterval(() => setPlay((p) => { const nx = (p ?? 0) + Math.max(1, Math.round(route.points.length / 600)); if (nx >= route.points.length) { setPlaying(false); return route.points.length - 1; } return nx; }), 80);
    return () => clearInterval(id);
  }, [playing, route]);
  const hu = units.find((u) => u.imei === hUnit) || null;
  const st = route?.stats;
  const playPoint = route && play != null ? route.points[play] : null;
  const cfDays = useColumnFilters<DayRow>();
  const cfStops = useColumnFilters<StopRow>();
  const cfSpeed = useColumnFilters<SpeedRow>();
  const stopRows = useMemo<StopRow[]>(() => (st?.stops || []).map((s, i) => ({ ...s, n: i + 1 })), [st]);
  const dayCols: Col<DayRow>[] = [
    { key: 'day', label: t('اليوم', 'Day'), get: (d) => d.day },
    { key: 'km', label: t('كم', 'km'), get: (d) => n1(d.km), cls: 'font-bold text-[#f37121] tabular-nums', filter: false },
    { key: 'band', label: t('فئة المسافة', 'Band'), get: (d) => (d.km < 1 ? t('بدون حركة', 'No movement') : d.km < 50 ? '1–50' : d.km < 150 ? '50–150' : d.km < 300 ? '150–300' : '300+') },
    { key: 'moving', label: t('وقت الحركة', 'Moving'), get: (d) => hm(d.movingMin), filter: false },
    { key: 'max', label: t('أعلى سرعة', 'Max speed'), get: (d) => String(d.maxSpeed), filter: false },
    { key: 'first', label: t('أول حركة', 'First move'), get: (d) => tm(d.firstMove), filter: false },
    { key: 'last', label: t('آخر حركة', 'Last move'), get: (d) => tm(d.lastMove), filter: false },
  ];
  const stopCols: Col<StopRow>[] = [
    { key: 'n', label: '#', get: (s) => `P${s.n}`, filter: false },
    { key: 'day', label: t('اليوم', 'Day'), get: (s) => riyadh(new Date(s.from)) },
    { key: 'from', label: t('من', 'From'), get: (s) => tm(s.from), filter: false },
    { key: 'to', label: t('إلى', 'To'), get: (s) => tm(s.to), filter: false },
    { key: 'dur', label: t('المدة', 'Duration'), get: (s) => (s.minutes >= 60 ? t('ساعة فأكثر', '1 h+') : s.minutes >= 30 ? t('30–60 د', '30–60 min') : s.minutes >= 15 ? t('15–30 د', '15–30 min') : t('5–15 د', '5–15 min')), show: (s) => <b className="text-blue-700">{hm(s.minutes)}</b> },
  ];
  const speedCols: Col<SpeedRow>[] = [
    { key: 'day', label: t('اليوم', 'Day'), get: (s) => riyadh(new Date(s.at)) },
    { key: 'time', label: t('الوقت', 'Time'), get: (s) => tm(s.at), filter: false },
    { key: 'speed', label: t('أعلى سرعة', 'Max speed'), get: (s) => (s.maxSpeed >= 120 ? '120+' : s.maxSpeed >= 100 ? '100–119' : s.maxSpeed >= 90 ? '90–99' : `${s.maxSpeed < 90 ? `≤89` : ''}`), show: (s) => <b className="text-red-600">{s.maxSpeed} {t('كم/س', 'km/h')}</b> },
    { key: 'sec', label: t('المدة (ث)', 'Seconds'), get: (s) => String(s.seconds), filter: false },
  ];
  const daysShown = st ? cfDays.apply(st.days, Object.fromEntries(dayCols.map((c) => [c.key, c.get]))) : [];
  const stopsShown = cfStops.apply(stopRows, Object.fromEntries(stopCols.map((c) => [c.key, c.get])));
  const speedShown = st ? cfSpeed.apply(st.speeding, Object.fromEntries(speedCols.map((c) => [c.key, c.get]))) : [];
  const kvCols: ExportColumn[] = [{ header: t('البيان', 'Item'), key: 'k' }, { header: t('القيمة', 'Value'), key: 'v' }];
  const xDays: ExportColumn[] = [{ header: t('اليوم', 'Day'), key: 'day' }, { header: t('كم', 'km'), key: 'km', type: 'number' }, { header: t('وقت الحركة', 'Moving'), key: 'moving' }, { header: t('أعلى سرعة', 'Max speed'), key: 'maxSpeed', type: 'number' }, { header: t('أول حركة', 'First move'), key: 'first' }, { header: t('آخر حركة', 'Last move'), key: 'last' }];
  const xStops: ExportColumn[] = [{ header: '#', key: 'n' }, { header: t('من', 'From'), key: 'from' }, { header: t('إلى', 'To'), key: 'to' }, { header: t('الدقائق', 'Minutes'), key: 'minutes', type: 'number' }, { header: t('الموقع', 'Location'), key: 'map' }];
  const xSpeed: ExportColumn[] = [{ header: t('الوقت', 'Time'), key: 'at' }, { header: t('السرعة', 'Speed'), key: 'maxSpeed', type: 'number' }, { header: t('ثوانٍ', 'Seconds'), key: 'seconds', type: 'number' }, { header: t('الموقع', 'Location'), key: 'map' }];
  const daysSheet = (days: DayRow[]) => ({ name: t('الأيام', 'Days'), rows: days.map((d) => ({ ...d, moving: hm(d.movingMin), first: tm(d.firstMove), last: tm(d.lastMove) })), columns: xDays });
  const stopsSheet = (stops: StopRow[]) => ({ name: t('التوقفات', 'Stops'), rows: stops.map((s) => ({ n: `P${s.n}`, from: dt(s.from), to: dt(s.to), minutes: s.minutes, map: `https://www.google.com/maps?q=${s.lat},${s.lng}` })), columns: xStops });
  const speedSheet = (sp: SpeedRow[]) => ({ name: t('تجاوز السرعة', 'Speeding'), rows: sp.map((s) => ({ at: dt(s.at), maxSpeed: s.maxSpeed, seconds: s.seconds, map: `https://www.google.com/maps?q=${s.lat},${s.lng}` })), columns: xSpeed });
  const statRows = (x: Stats): [string, string][] => [
    [t('الفترة', 'Period'), from === to ? from : `${from} → ${to}`],
    [t('المسافة', 'Distance'), `${n1(x.km)} ${t('كم', 'km')}`],
    [t('متوسط اليوم', 'Per day'), x.days.length ? `${n1(x.km / x.days.length)} ${t('كم', 'km')}` : '—'],
    [t('وقت الحركة', 'Moving time'), hm(x.movingMinutes)],
    [t('تشغيل بدون حركة', 'Idling'), hm(x.idleMinutes)],
    [t('التوقّفات (5 د+)', 'Stops (5 min+)'), String(x.stopsCount)],
    [t('مجموع التوقّف', 'Stopped time'), hm(x.stoppedMinutes)],
    [t('أعلى سرعة', 'Max speed'), `${x.maxSpeed} ${t('كم/س', 'km/h')}`],
    [t('متوسط سرعة الحركة', 'Avg moving speed'), `${x.avgMovingSpeed} ${t('كم/س', 'km/h')}`],
    [`${t('تجاوزات السرعة فوق', 'Speeding over')} ${x.speedLimit}`, String(x.speedingCount)],
    [t('أيّام بحركة', 'Days moving'), `${x.days.filter((d) => d.km >= 1).length} ${t('من', 'of')} ${x.days.length}`],
    [t('أول / آخر إشارة', 'First / last fix'), `${dt(x.first)} — ${dt(x.last)}`],
  ];
  const summarySheet = (u: Unit | null, x: Stats) => ({ name: t('الملخّص', 'Summary'), rows: [...(u ? detailRows(u, ar) : []), ...statRows(x)].map(([k, v]) => ({ k, v })), columns: kvCols });
  const routeSheets = (days: DayRow[], stops: StopRow[], sp: SpeedRow[]) => [
    ...(st ? [summarySheet(hu, st)] : []), daysSheet(days), stopsSheet(stops), speedSheet(sp),
  ];
  const [pdfBusy, setPdfBusy] = useState(false);
  const routePdf = async () => {
    if (!route || !st || !hu) return;
    setPdfBusy(true);
    try { await routeReportPdf({ ar, unit: hu, from, to, stats: st, points: route.points, days: daysShown, stops: stopsShown, speeding: speedShown, details: detailRows(hu, ar) }); } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setPdfBusy(false);
  };
  const openHistory = (imei: string, f?: string, tt?: string) => { setHUnit(imei); if (f) setFrom(f); if (tt) setTo(tt); setTab('history'); };

  // ── Fleet ──
  const [sFrom, setSFrom] = useState(riyadh());
  const [sTo, setSTo] = useState(riyadh());
  const [sum, setSum] = useState<{ rows: SumRow[] } | null>(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sq, setSq] = useState('');
  const sDays = spanDays(sFrom, sTo);
  useEffect(() => {
    if (tab !== 'fleet' || only || sDays > 62) return undefined;
    let dead = false;
    setSumBusy(true);
    api.get<{ rows: SumRow[] }>(`${base}/summary?from=${sFrom}&to=${sTo}`, { timeoutMs: 120000 }).then((d) => { if (!dead) setSum(d); }).catch((e) => { if (!dead) setErr(e?.message || 'Failed'); }).finally(() => { if (!dead) setSumBusy(false); });
    return () => { dead = true; };
  }, [tab, sFrom, sTo, base, only, sDays, linksAt]);
  const cfFleet = useColumnFilters<SumRow>();
  const fleetCols: Col<SumRow>[] = [
    { key: 'plate', label: t('اللوحة', 'Plate'), get: (r) => r.plate, show: (r) => <b>{r.plate}{r.mediaGo && <span className="ms-1 rounded bg-violet-100 text-violet-700 text-[9px] font-bold px-1">MG</span>}</b> },
    { key: 'mg', label: 'Media Go', get: (r) => (r.mediaGo ? t('نعم', 'Yes') : t('لا', 'No')) },
    { key: 'rider', label: t('الراكب', 'Rider'), get: (r) => r.rider || '' },
    { key: 'project', label: t('المشروع', 'Project'), get: (r) => r.project || '' },
    { key: 'city', label: t('المدينة', 'City'), get: (r) => r.city || '' },
    { key: 'km', label: t('كم', 'km'), get: (r) => (r.km == null ? '' : n1(r.km)), filter: false, cls: 'font-extrabold text-[#f37121] tabular-nums' },
    { key: 'band', label: t('فئة المسافة', 'Distance band'), get: (r) => { const k = r.km || 0; return k < 1 ? t('لم تتحرّك', 'Did not move') : k < 50 ? '1–50' : k < 150 ? '50–150' : k < 300 ? '150–300' : '300+'; } },
    { key: 'state', label: t('الحالة الآن', 'Now'), get: (r) => STATE_AR[r.state][ar ? 0 : 1], show: (r) => <span className="inline-flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[r.state] }} />{STATE_AR[r.state][ar ? 0 : 1]}</span> },
  ];
  const fleetBase = useMemo(() => {
    const k = fold(sq.trim());
    return (sum?.rows || []).filter((r) => (!k || fold(`${r.name} ${r.plate} ${r.rider} ${r.project} ${r.city}`).includes(k)));
  }, [sum, sq]);
  const fleetShown = cfFleet.apply(fleetBase, Object.fromEntries(fleetCols.map((c) => [c.key, c.get])));
  const xFleet: ExportColumn[] = [{ header: t('اللوحة', 'Plate'), key: 'plate' }, { header: 'Media Go', key: 'mg' }, { header: t('الراكب', 'Rider'), key: 'rider' }, { header: t('المشروع', 'Project'), key: 'project' }, { header: t('المدينة', 'City'), key: 'city' }, { header: t('كم', 'km'), key: 'km', type: 'number' }, { header: t('الحالة الآن', 'State now'), key: 'state' }];
  const fleetSheet = (rows: SumRow[]) => {
    const moved = rows.filter((r) => (r.km || 0) >= 1); const total = rows.reduce((a, r) => a + (r.km || 0), 0);
    return [
      { name: t('الملخّص', 'Summary'), rows: [
        [t('الفترة', 'Period'), sFrom === sTo ? sFrom : `${sFrom} → ${sTo}`], [t('عدد المركبات', 'Vehicles'), rows.length], [t('إجمالي الكيلومترات', 'Total km'), n1(total)],
        [t('مركبات تحرّكت', 'Moved'), moved.length], [t('لم تتحرّك', 'Did not move'), rows.length - moved.length], [t('متوسط كم للمتحرّكة', 'Avg km (moved)'), moved.length ? n1(total / moved.length) : 0],
      ].map(([k, v]) => ({ k, v })), columns: kvCols },
      { name: t('المسافات', 'Distances'), rows: rows.map((r) => ({ ...r, mg: r.mediaGo ? 'نعم' : '', state: STATE_AR[r.state][ar ? 0 : 1] })), columns: xFleet },
    ];
  };
  const fleetPdf = async () => {
    setPdfBusy(true);
    try { await fleetReportPdf({ ar, from: sFrom, to: sTo, rows: fleetShown.map((r) => ({ ...r, stateLabel: STATE_AR[r.state][ar ? 0 : 1] })) }); } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setPdfBusy(false);
  };

  const unitOptions = useMemo(() => units.map((u) => ({ value: u.imei, label: `${u.plate}${u.mediaGo ? ' · MG' : ''}`, hint: [u.rider?.name, u.rider?.project, u.vehicle?.city, STATE_AR[u.state][ar ? 0 : 1]].filter(Boolean).join(' · '), search: `${u.name} ${u.rider?.name || ''}` })), [units, ar]);

  const pdfBtn = (onClick: () => void, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled || pdfBusy}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50">
      {pdfBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}{t('تقرير PDF', 'PDF report')}
    </button>
  );

  /** One table on its own: the rows as filtered, or all of them. */
  const tableExport = (fileName: string, shownSheet: any, allSheet: any) => (
    <ExportMenu lang={ar ? 'ar' : 'en'} fileName={fileName} options={[
      { key: 'shown', label: scope.shown, sheets: [shownSheet] },
      { key: 'all', label: scope.all, sheets: [allSheet] },
    ]} />
  );

  const unitCard = sel && (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold text-slate-900 text-base" dir="auto">{sel.plate}{sel.mediaGo && <span className="ms-2 rounded bg-violet-100 text-violet-700 text-[10px] font-bold px-1.5 py-0.5">MEDIA GO</span>}</div>
          <div className="text-xs text-slate-500">{[sel.rider?.name, sel.rider?.project, sel.vehicle?.city || sel.rider?.city].filter(Boolean).join(' · ') || t('لا راكب مربوط', 'No rider linked')}</div>
        </div>
        {!only && <button type="button" onClick={() => { setSelected(null); setFollow(false); }} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: STATE_COLOR[sel.state] }}>{STATE_AR[sel.state][ar ? 0 : 1]}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{Math.round(sel.speed)} {t('كم/س', 'km/h')}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('آخر إشارة', 'Last fix')} {ago(sel.at, ar)}</span>
        {sel.io.ignition != null && <span className={`rounded-full px-2 py-0.5 ${sel.io.ignition ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t('المحرّك', 'Ignition')} {sel.io.ignition ? t('يعمل', 'on') : t('مطفأ', 'off')}</span>}
        {sel.io.externalVoltage != null && <span className="rounded-full bg-slate-100 px-2 py-0.5" dir="ltr">{sel.io.externalVoltage} V</span>}
      </div>
      {sel.rider?.phone && <a href={`tel:${sel.rider.phone}`} className="block text-xs text-slate-600" dir="ltr">{sel.rider.phone}</a>}
      <div className="flex flex-wrap gap-2 pt-1">
        {!only && <button type="button" onClick={() => { setFollow((f) => !f); if (sel.lat != null) setFocus({ lat: sel.lat, lng: sel.lng as number, zoom: 16 }); }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${follow ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}><Crosshair className="w-3.5 h-3.5" />{follow ? t('يتابِع لايف', 'Following') : t('تابِع لايف', 'Follow live')}</button>}
        {!only && <button type="button" onClick={() => openHistory(sel.imei)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-orange-50 text-[#c2410c]"><History className="w-3.5 h-3.5" />{t('سجل الحركة', 'Movement history')}</button>}
        {sel.lat != null && <a href={`https://www.google.com/maps?q=${sel.lat},${sel.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700"><MapPin className="w-3.5 h-3.5" />Google Maps</a>}
        {!only && sel.vehicle && <Link href={`/system/vehicles/registry/${sel.vehicle._id}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">{t('ملف المركبة', 'Vehicle file')}</Link>}
      </div>
      <details className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-bold text-slate-700">{t('التفاصيل الكاملة', 'Full details')}</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {detailRows(sel, ar).map(([k, v]) => (<div key={k} className="min-w-0"><dt className="text-[10px] text-slate-500">{k}</dt><dd className="text-xs font-semibold text-slate-800 break-words" dir="auto">{v}</dd></div>))}
        </dl>
      </details>
      {follow && !only && <div className="text-[11px] text-slate-400">{t('الخط المتقطّع البرتقالي = آخر نصف ساعة', 'Dashed orange line = last half hour')}</div>}
    </div>
  );

  const liveTab = (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-3">
      <div className="space-y-3 lg:max-h-[calc(100vh-280px)] lg:overflow-y-auto">
        {unitCard}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('لوحة، راكب، مشروع، مدينة…', 'Plate, rider, project, city…')} className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          <div className="text-[11px] text-slate-400 px-3 pt-1.5">{shown.length} {t('مركبة', 'vehicles')}</div>
          <div className="divide-y divide-slate-100">
            {loading && <div className="p-4 text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{t('جارٍ تحميل المواقع…', 'Loading positions…')}</div>}
            {shown.map((u) => (
              <button key={u.imei} type="button" onClick={() => pickUnit(u.imei)} className={`w-full text-start px-3 py-2 hover:bg-orange-50 ${u.imei === selected ? 'bg-orange-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${u.state === 'moving' ? 'animate-pulse' : ''}`} style={{ background: STATE_COLOR[u.state] }} />{u.plate}{u.mediaGo && <span className="rounded bg-violet-100 text-violet-700 text-[9px] font-bold px-1">MG</span>}</span>
                  <span className="text-[11px] tabular-nums text-slate-500">{u.state === 'moving' ? `${Math.round(u.speed)} ${t('كم/س', 'km/h')}` : ago(u.at, ar)}</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{[u.rider?.name, u.rider?.project, u.vehicle?.city].filter(Boolean).join(' · ') || (u.vehicle ? '' : t('غير مربوطة بسجلّ المركبات', 'Not in the vehicle register'))}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <TrackMap ar={ar} units={mapUnits} selected={selected} onSelect={pickUnit} follow={follow} trail={trail} focus={focus} height="calc(100vh - 280px)" />
    </div>
  );

  const historyTab = (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {!only && (
            <div className="w-full sm:w-80">
              <SearchableSelect value={hUnit} onChange={(v) => setHUnit(v)} options={unitOptions} searchAfter={0} placeholder={t('اختر المركبة (لوحة، راكب…)', 'Pick a vehicle (plate, rider…)')} />
            </div>
          )}
          <PeriodPicker ar={ar} from={from} to={to} maxDays={31} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">{t('حدّ السرعة', 'Speed limit')}
            <input type="number" min={20} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 80)} className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs" /></label>
        </div>
        {hDays > 31 && <div className="text-xs text-red-600">{t('أقصى فترة لخط السير 31 يومًا — اختر شهرًا أو فترة أقصر', 'Route period is limited to 31 days')}</div>}
        {!hUnit && <div className="text-sm text-slate-500">{t('اختر مركبة لعرض سجل حركتها', 'Pick a vehicle to see its movement history')}</div>}
      </div>
      {hUnit && (
        <div className="space-y-2">
          {/* Own stacking context: Leaflet panes (z 400+) and the loading veil never cover the vehicle picker above. */}
          <div className="relative isolate z-0">
            <TrackMap ar={ar} units={[]} route={route?.points || null} stops={st?.stops || []} speeding={st?.speeding || []} speedLimit={limit} playIndex={play} focus={hFocus} height={only ? 420 : 520} />
            {routeBusy && <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-xl z-[1000]"><span className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white px-3 py-2 rounded-lg shadow"><RefreshCw className="w-4 h-4 animate-spin" />{t('جارٍ تحميل خط السير…', 'Loading route…')}{hDays > 3 ? <span className="text-[11px] font-normal text-slate-500">{t('أوّل فتح لفترة طويلة يجلبها من المزوّد ثم تُحفظ، وبعدها تفتح فورًا', 'The first open of a long period fetches it once; it then opens instantly')}</span> : null}</span></div>}
          </div>
          {route && route.points.length > 1 && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <button type="button" onClick={() => { if (play == null || play >= route.points.length - 1) setPlay(0); setPlaying((p) => !p); }} className="p-1.5 rounded-lg bg-slate-900 text-white">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
              <input type="range" min={0} max={route.points.length - 1} value={play ?? 0} onChange={(e) => { setPlaying(false); setPlay(Number(e.target.value)); }} className="flex-1 accent-[#f37121]" />
              <span className="text-[11px] tabular-nums text-slate-600 w-40 text-end" dir="ltr">{playPoint ? `${dt(new Date(playPoint[0]).toISOString())} · ${Math.round(playPoint[3])} km/h` : t('تشغيل المسار', 'Replay')}</span>
            </div>
          )}
          {route && !routeBusy && route.points.length < 2 && <div className="text-sm text-slate-500 px-1">{t('لا حركة مسجّلة في هذه الفترة', 'No movement recorded in this period')}</div>}
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 px-1">
            <span className="flex items-center gap-1"><span className="w-4 h-1 rounded bg-[#16a34a]" />{t('سير عادي', 'Normal')}</span>
            <span className="flex items-center gap-1"><span className="w-4 h-1 rounded bg-[#f97316]" />{t('قرب حدّ السرعة', 'Near limit')}</span>
            <span className="flex items-center gap-1"><span className="w-4 h-1 rounded bg-[#dc2626]" />{t('تجاوز السرعة', 'Over limit')}</span>
            <span className="flex items-center gap-1"><span className="rounded bg-slate-800 text-white px-1 text-[9px] font-bold">P1</span>{t('توقّف 5 د+', 'Stop 5 min+')}</span>
          </div>
        </div>
      )}
      {st && (
        <>
          {/* Each block takes the full width, one under another, with its own title. */}
          <Section title={t('ملخّص الفترة', 'Period summary')} tools={<>
            {pdfBtn(routePdf, !hu)}
            <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`route-${hu?.plate || hUnit}-${from}-${to}`} label={t('تصدير الصفحة كاملة', 'Export whole page')} options={[
              { key: 'shown', label: scope.shown, sheets: routeSheets(daysShown, stopsShown, speedShown) },
              { key: 'all', label: scope.all, sheets: routeSheets(st.days, stopRows, st.speeding) },
            ]} />
          </>}>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
              <Card icon={<RouteIcon className="w-3.5 h-3.5" />} label={t('المسافة', 'Distance')} value={`${n1(st.km)} ${t('كم', 'km')}`} sub={st.days.length > 1 ? `${t('متوسط اليوم', 'per day')} ${n1(st.km / st.days.length)}` : undefined} tone="#f37121" />
              <Card icon={<Navigation className="w-3.5 h-3.5" />} label={t('وقت الحركة', 'Moving')} value={hm(st.movingMinutes)} sub={`${t('تشغيل بدون حركة', 'idling')} ${hm(st.idleMinutes)}`} tone="#16a34a" />
              <Card icon={<ParkingCircle className="w-3.5 h-3.5" />} label={t('التوقّفات (5 د+)', 'Stops (5 min+)')} value={st.stopsCount} sub={`${t('مجموعها', 'total')} ${hm(st.stoppedMinutes)}`} tone="#2563eb" />
              <Card icon={<Gauge className="w-3.5 h-3.5" />} label={t('أعلى سرعة', 'Max speed')} value={`${st.maxSpeed} ${t('كم/س', 'km/h')}`} sub={`${t('متوسط سرعة الحركة', 'avg moving')} ${st.avgMovingSpeed} ${t('كم/س', 'km/h')}`} />
              <Card icon={<AlertTriangle className="w-3.5 h-3.5" />} label={`${t('تجاوز', 'Over')} ${st.speedLimit} ${t('كم/س', 'km/h')}`} value={st.speedingCount} sub={t('مرّة', 'times')} tone={st.speedingCount ? '#dc2626' : '#0f172a'} />
              <Card icon={<Clock className="w-3.5 h-3.5" />} label={t('أيّام بحركة', 'Days moving')} value={`${st.days.filter((d) => d.km >= 1).length} ${t('من', 'of')} ${st.days.length}`} sub={`${dt(st.first)} — ${dt(st.last)}`} />
            </div>
            <div className="text-[11px] text-slate-400 mt-2">{t('التقرير والتصدير «المعروض» يتبعان فلاتر الجداول تحت', 'The PDF and the “shown” export follow the table filters below')}</div>
          </Section>
          {hu && (
            <Section title={t('بيانات المركبة والراكب والجهاز', 'Vehicle, rider and device')} tools={
              <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`vehicle-${hu.plate}`} options={[{ key: 'all', label: scope.all, sheets: [{ name: t('البيانات', 'Details'), rows: detailRows(hu, ar).map(([k, v]) => ({ k, v })), columns: kvCols }] }]} />
            }>
              <DetailGrid rows={detailRows(hu, ar)} />
            </Section>
          )}
          {st.days.length > 1 && (
            <Section title={t('الكيلومترات يوميًا — اضغط على يوم في الجدول لفتحه', 'Kilometres per day — click a day in the table to open it')}>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={st.days}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} fontSize={10} /><YAxis fontSize={10} width={34} />
                    <Tooltip formatter={(v: any) => [`${v} ${t('كم', 'km')}`, '']} /><Bar dataKey="km" fill="#f37121" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}
          <FilterTable ar={ar} title={t('الأيام', 'Days')} rows={st.days} cols={dayCols} cf={cfDays} empty={t('لا أيام', 'No days')} onRow={(d) => { setFrom(d.day); setTo(d.day); }}
            tools={tableExport(`days-${hu?.plate || hUnit}-${from}-${to}`, daysSheet(daysShown), daysSheet(st.days))} />
          <FilterTable ar={ar} title={t('التوقّفات', 'Stops')} rows={stopRows} cols={stopCols} cf={cfStops} empty={t('لا توقّفات 5 دقائق فأكثر', 'No stops of 5 min+')} onRow={(s) => setHFocus({ lat: s.lat, lng: s.lng, zoom: 17 })}
            tools={tableExport(`stops-${hu?.plate || hUnit}-${from}-${to}`, stopsSheet(stopsShown), stopsSheet(stopRows))} />
          <FilterTable ar={ar} title={t('تجاوزات السرعة', 'Speeding')} rows={st.speeding} cols={speedCols} cf={cfSpeed} empty={t('لا تجاوزات', 'No speeding')} onRow={(s) => setHFocus({ lat: s.lat, lng: s.lng, zoom: 16 })}
            tools={tableExport(`speeding-${hu?.plate || hUnit}-${from}-${to}`, speedSheet(speedShown), speedSheet(st.speeding))} />
        </>
      )}
    </div>
  );

  const fleetTab = (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker ar={ar} from={sFrom} to={sTo} maxDays={62} onChange={(f, tt) => { setSFrom(f); setSTo(tt); }} />
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder={t('بحث…', 'Search…')} className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-sm w-52" />
        </div>
      </div>
      {sDays > 62 && <div className="text-xs text-red-600">{t('أقصى فترة 62 يومًا', 'Max 62 days')}</div>}
      {sumBusy && <div className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{t('جارٍ حساب المسافات لكل المركبات…', 'Computing distances for every vehicle…')}</div>}
      {sum && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card icon={<RouteIcon className="w-3.5 h-3.5" />} label={t('إجمالي الكيلومترات', 'Total km')} value={n1(fleetShown.reduce((a, r) => a + (r.km || 0), 0))} tone="#f37121" />
            <Card icon={<Navigation className="w-3.5 h-3.5" />} label={t('مركبات تحرّكت', 'Vehicles that moved')} value={fleetShown.filter((r) => (r.km || 0) >= 1).length} tone="#16a34a" />
            <Card icon={<ParkingCircle className="w-3.5 h-3.5" />} label={t('لم تتحرّك', 'Did not move')} value={fleetShown.filter((r) => (r.km || 0) < 1).length} tone="#475569" />
            <Card icon={<Gauge className="w-3.5 h-3.5" />} label={t('متوسط كم للمتحرّكة', 'Avg km (moving)')} value={(() => { const a = fleetShown.filter((r) => (r.km || 0) >= 1); return a.length ? n1(a.reduce((x, r) => x + (r.km || 0), 0) / a.length) : 0; })()} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-bold text-slate-700 mb-2">{t('الأعلى كيلومترات (حسب الفلاتر)', 'Top distance (as filtered)')}</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...fleetShown].sort((a, b) => (b.km || 0) - (a.km || 0)).slice(0, 20)}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="plate" fontSize={9} interval={0} angle={-35} textAnchor="end" height={55} /><YAxis fontSize={10} width={40} />
                  <Tooltip formatter={(v: any) => [`${v} ${t('كم', 'km')}`, '']} /><Bar dataKey="km" fill="#f37121" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <FilterTable ar={ar} title={t('كل المركبات', 'All vehicles')} rows={fleetBase} cols={fleetCols} cf={cfFleet} empty={t('لا مركبات', 'No vehicles')}
            onRow={(r) => openHistory(r.imei, sFrom, sDays <= 31 ? sTo : shiftFrom(sFrom, 30))}
            tools={<>
              {pdfBtn(fleetPdf, !fleetShown.length)}
              <ExportMenu lang={ar ? 'ar' : 'en'} fileName={`tracking-distance-${sFrom}-${sTo}`} options={[
                { key: 'shown', label: scope.shown, sheets: fleetSheet(fleetShown) },
                { key: 'all', label: scope.all, sheets: fleetSheet(sum.rows) },
              ]} />
            </>} />
          <div className="text-[11px] text-slate-400">{t('اضغط على أي مركبة لفتح سجل حركتها في نفس الفترة', 'Click a vehicle to open its movement history for the same period')}</div>
        </>
      )}
    </div>
  );

  if (only) {
    return (
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{err}</div>}
        {unitCard}
        {historyTab}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {([['all', t('كل الأجهزة', 'All units'), counts.total, '#0f172a'], ...ORDER.map((s) => [s, STATE_AR[s][ar ? 0 : 1], counts[s] || 0, STATE_COLOR[s]])] as [string, string, number, string][]).map(([k, l, v, c]) => (
          <button key={k} type="button" onClick={() => { setTab('live'); if (k === 'all') setStates(new Set()); else toggleState(k as UnitState); }}
            className={`rounded-xl border bg-white px-3 py-2 text-start ${k !== 'all' && states.has(k as UnitState) ? 'ring-2' : ''}`} style={{ borderColor: k !== 'all' && states.has(k as UnitState) ? c : '#e2e8f0' }}>
            <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</div>
            <div className="text-xl font-extrabold tabular-nums" style={{ color: c }}>{loading ? '—' : v}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
          {([['live', t('الخريطة المباشرة', 'Live map'), <Radio key="i" className="w-4 h-4" />], ['history', t('سجل الحركة وخط السير', 'Movement history'), <History key="i" className="w-4 h-4" />], ['fleet', t('المسافات والتحليل', 'Distances & analysis'), <BarChart3 key="i" className="w-4 h-4" />]] as const).map(([k, l, ic]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{ic}{l}</button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 text-violet-700 text-xs font-semibold px-2.5 py-1.5">{t('مركبات Media Go المعلَّمة في سجلّ مركبات النقل الخفيف فقط', 'Only vehicles flagged Media Go in the light-transport register')}</span>
        {tab === 'live' && (
          <span className="ms-auto inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
            <span className="relative flex w-2 h-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" /></span>
            {t('لايف', 'Live')} · {t('آخر تحديث', 'updated')} {liveAt ? tm(liveAt) : '—'}
          </span>
        )}
      </div>
      {err && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 flex items-center justify-between">{err}<button type="button" onClick={() => setErr('')}><X className="w-4 h-4" /></button></div>}
      {tab === 'live' ? liveTab : tab === 'history' ? historyTab : fleetTab}
    </div>
  );
}
