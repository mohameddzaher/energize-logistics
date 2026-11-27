/**
 * PDF reports for vehicle tracking, on the company letterhead (lib/reportPdf): a unit's route report (summary, route sketch,
 * daily kilometres, days, stops, speeding) and the fleet distance report. Drawings are SVG built here from numbers only.
 */
import { downloadReport, type Block } from '@/lib/reportPdf';

const ORANGE = '#f37121';
const speedColor = (s: number, limit: number) => (s > limit ? '#dc2626' : s > limit * 0.75 ? '#f97316' : s > 3 ? '#16a34a' : '#64748b');
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const tm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '—');
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const n1 = (n: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

/** Route drawn to scale (equirectangular, longitude scaled by cos(lat)) on a light grid, coloured by speed. */
export function routeSvg(points: [number, number, number, number][], stops: { lat: number; lng: number }[], limit: number, W = 680, H = 380): string {
  if (points.length < 2) return '';
  const step = Math.max(1, Math.floor(points.length / 2500));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const lats = pts.map((p) => p[1]); const lngs = pts.map((p) => p[2]);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const w = Math.max((maxLng - minLng) * k, 1e-4); const h = Math.max(maxLat - minLat, 1e-4);
  const pad = 24; const sc = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
  const ox = (W - w * sc) / 2; const oy = (H - h * sc) / 2;
  const X = (lng: number) => ox + (lng - minLng) * k * sc; const Y = (lat: number) => H - (oy + (lat - minLat) * sc);
  let path = ''; let band = speedColor(pts[0][3], limit); let d = `M${X(pts[0][2]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const c = speedColor(pts[i][3], limit); const xy = `${X(pts[i][2]).toFixed(1)},${Y(pts[i][1]).toFixed(1)}`;
    d += ` L${xy}`;
    if (c !== band || i === pts.length - 1) { path += `<path d="${d}" fill="none" stroke="${band}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`; band = c; d = `M${xy}`; }
  }
  const grid = Array.from({ length: 9 }, (_, i) => `<line x1="${(W / 8) * i}" y1="0" x2="${(W / 8) * i}" y2="${H}" stroke="#eef2f7"/>`).join('')
    + Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${(H / 5) * i}" x2="${W}" y2="${(H / 5) * i}" stroke="#eef2f7"/>`).join('');
  const s = pts[0]; const e = pts[pts.length - 1];
  const stopsSvg = stops.slice(0, 40).map((st, i) => `<g><rect x="${X(st.lng) - 9}" y="${Y(st.lat) - 7}" width="18" height="13" rx="4" fill="#1e293b"/><text x="${X(st.lng)}" y="${Y(st.lat) + 3}" font-size="8" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial">${i + 1}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="border:1px solid #e5e7eb;border-radius:8px;background:#fbfcfe">${grid}${path}${stopsSvg}
<circle cx="${X(s[2])}" cy="${Y(s[1])}" r="7" fill="#16a34a" stroke="#fff" stroke-width="2"/><circle cx="${X(e[2])}" cy="${Y(e[1])}" r="7" fill="#dc2626" stroke="#fff" stroke-width="2"/>

<text x="${W - 8}" y="16" font-family="Arial" font-size="10" fill="#94a3b8" text-anchor="end">N ↑</text></svg>`;
}

/** Vertical bar chart (kilometres per label). */
export function barsSvg(rows: { label: string; value: number }[], W = 680, H = 200): string {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.value), 1);
  const left = 34; const bottom = 34; const top = 14; const bw = (W - left - 8) / rows.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${left}" x2="${W}" y1="${top + (H - top - bottom) * (1 - t)}" y2="${top + (H - top - bottom) * (1 - t)}" stroke="#eef2f7"/><text x="${left - 4}" y="${top + (H - top - bottom) * (1 - t) + 3}" font-size="8" fill="#94a3b8" text-anchor="end">${Math.round(max * t)}</text>`).join('');
  const bars = rows.map((r, i) => {
    const h = ((H - top - bottom) * r.value) / max; const x = left + i * bw + bw * 0.15; const y = H - bottom - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${ORANGE}"/>`
      + (rows.length <= 31 ? `<text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="7.5" fill="#0f172a" text-anchor="middle">${r.value >= 10 ? Math.round(r.value) : r.value}</text>` : '')
      + `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - bottom + 11}" font-size="7.5" fill="#475569" text-anchor="middle" transform="rotate(-35 ${(x + bw * 0.35).toFixed(1)} ${H - bottom + 11})">${esc(r.label)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial">${ticks}${bars}</svg>`;
}

export type RouteStats = {
  km: number; points: number; movingMinutes: number; idleMinutes: number; stoppedMinutes: number; maxSpeed: number; avgMovingSpeed: number;
  speedLimit: number; speedingCount: number; speeding: { at: string; maxSpeed: number; lat: number; lng: number; seconds: number }[];
  stopsCount: number; stops: { from: string; to: string; minutes: number; lat: number; lng: number }[]; first: string | null; last: string | null;
  days: { day: string; km: number; movingMin: number; maxSpeed: number; firstMove: string | null; lastMove: string | null; points: number }[];
};

export async function routeReportPdf({ ar, unit, from, to, stats, points, days, stops, speeding }: {
  ar: boolean; unit: { plate: string; mediaGo?: boolean; rider?: { name?: string; project?: string; phone?: string } | null; vehicle?: { city?: string; brand?: string } | null };
  from: string; to: string; stats: RouteStats; points: [number, number, number, number][];
  /** Rows as filtered on screen (column filters); the report prints what the user sees. */
  days: RouteStats['days']; stops: RouteStats['stops']; speeding: RouteStats['speeding'];
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const period = from === to ? from : `${from} → ${to}`;
  const blocks: Block[] = [
    { kind: 'title', text: t('تقرير خط سير المركبة', 'Vehicle Route Report'), sub: `${unit.plate}${unit.mediaGo ? ' · MEDIA GO' : ''} · ${period}` },
    { kind: 'kv', items: [
      [t('اللوحة', 'Plate'), unit.plate],
      [t('الراكب', 'Rider'), [unit.rider?.name, unit.rider?.phone].filter(Boolean).join(' · ') || '—'],
      [t('المشروع / المدينة', 'Project / city'), [unit.rider?.project, unit.vehicle?.city].filter(Boolean).join(' · ') || '—'],
      [t('الفترة', 'Period'), period],
      [t('أول / آخر إشارة', 'First / last fix'), `${fmt(stats.first)} — ${fmt(stats.last)}`],
    ] },
    { kind: 'stats', items: [
      { label: t('المسافة', 'Distance'), value: `${n1(stats.km)} ${t('كم', 'km')}`, accent: true },
      { label: t('وقت الحركة', 'Moving time'), value: hm(stats.movingMinutes) },
      { label: t('تشغيل بدون حركة', 'Idling'), value: hm(stats.idleMinutes) },
      { label: t('التوقّفات', 'Stops'), value: `${stats.stopsCount} · ${hm(stats.stoppedMinutes)}` },
    ] },
    { kind: 'stats', items: [
      { label: t('أعلى سرعة', 'Max speed'), value: `${stats.maxSpeed} ${t('كم/س', 'km/h')}` },
      { label: t('متوسط سرعة الحركة', 'Avg moving speed'), value: `${stats.avgMovingSpeed} ${t('كم/س', 'km/h')}` },
      { label: `${t('تجاوز', 'Over')} ${stats.speedLimit}`, value: String(stats.speedingCount) },
      { label: t('أيام بحركة', 'Days moving'), value: `${stats.days.filter((d) => d.km >= 1).length} ${t('من', 'of')} ${stats.days.length}` },
    ] },
  ];
  const sketch = routeSvg(points, stops, stats.speedLimit);
  if (sketch) blocks.push({ kind: 'section', text: t('خط السير', 'Route') }, { kind: 'svg', svg: sketch, caption: t('أخضر: سير عادي · برتقالي: قرب الحدّ · أحمر: تجاوز السرعة · الأرقام: نقاط التوقّف', 'Green: normal · orange: near the limit · red: over the limit · numbers: stops') });
  if (stats.days.length > 1) blocks.push({ kind: 'section', text: t('الكيلومترات يوميًا', 'Kilometres per day') }, { kind: 'svg', svg: barsSvg(stats.days.map((d) => ({ label: d.day.slice(5), value: Math.round(d.km * 10) / 10 }))) });
  if (days.length) {
    blocks.push({ kind: 'section', text: t('الأيام', 'Days') }, {
      kind: 'table', head: [t('اليوم', 'Day'), t('كم', 'km'), t('وقت الحركة', 'Moving'), t('أعلى سرعة', 'Max'), t('أول حركة', 'First'), t('آخر حركة', 'Last')],
      rows: days.map((d) => [d.day, n1(d.km), hm(d.movingMin), String(d.maxSpeed), tm(d.firstMove), tm(d.lastMove)]), align: ['start', 'end', 'end', 'end', 'center', 'center'],
    });
  }
  if (stops.length) {
    blocks.push({ kind: 'section', text: `${t('التوقّفات (5 دقائق فأكثر)', 'Stops (5 min+)')} · ${stops.length}` }, {
      kind: 'table', head: ['#', t('من', 'From'), t('إلى', 'To'), t('المدة', 'Duration'), t('الموقع', 'Location')],
      rows: stops.map((s, i) => [String(i + 1), fmt(s.from), tm(s.to), hm(s.minutes), `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`]), align: ['center', 'start', 'center', 'end', 'center'],
    });
  }
  if (speeding.length) {
    blocks.push({ kind: 'section', text: `${t('تجاوزات السرعة', 'Speeding')} · ${speeding.length}` }, {
      kind: 'table', head: [t('الوقت', 'Time'), t('أعلى سرعة', 'Max speed'), t('المدة (ث)', 'Seconds'), t('الموقع', 'Location')],
      rows: speeding.map((s) => [fmt(s.at), { t: `${s.maxSpeed} ${t('كم/س', 'km/h')}`, color: '#dc2626' }, String(s.seconds), `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`]), align: ['start', 'end', 'end', 'center'],
    });
  }
  await downloadReport({ fileName: `route-${unit.plate}-${from}-${to}`, lang: ar ? 'ar' : 'en', blocks, footerNote: t('المصدر: أجهزة تتبّع إكسبريس', 'Source: Express GPS units') });
}

export async function fleetReportPdf({ ar, from, to, rows }: {
  ar: boolean; from: string; to: string;
  rows: { plate: string; mediaGo: boolean; rider: string; project: string; city: string; km: number | null; stateLabel: string }[];
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const period = from === to ? from : `${from} → ${to}`;
  const total = rows.reduce((a, r) => a + (r.km || 0), 0);
  const moved = rows.filter((r) => (r.km || 0) >= 1);
  const top = [...rows].sort((a, b) => (b.km || 0) - (a.km || 0)).slice(0, 20);
  const blocks: Block[] = [
    { kind: 'title', text: t('تقرير مسافات مركبات Media Go', 'Media Go Fleet Distance Report'), sub: period },
    { kind: 'stats', items: [
      { label: t('إجمالي الكيلومترات', 'Total km'), value: n1(total), accent: true },
      { label: t('عدد المركبات', 'Vehicles'), value: String(rows.length) },
      { label: t('تحرّكت', 'Moved'), value: String(moved.length) },
      { label: t('متوسط كم للمتحرّكة', 'Avg km (moved)'), value: moved.length ? n1(total / moved.length) : '0' },
    ] },
    { kind: 'section', text: t('الأعلى كيلومترات', 'Top distance') },
    { kind: 'svg', svg: barsSvg(top.map((r) => ({ label: r.plate, value: Math.round((r.km || 0) * 10) / 10 }))) },
    { kind: 'section', text: t('كل المركبات', 'All vehicles') },
    {
      kind: 'table', head: ['#', t('اللوحة', 'Plate'), t('الراكب', 'Rider'), t('المشروع', 'Project'), t('المدينة', 'City'), t('كم', 'km'), t('الحالة', 'State')],
      rows: rows.map((r, i) => [String(i + 1), `${r.plate}${r.mediaGo ? ' · MG' : ''}`, r.rider || '—', r.project || '—', r.city || '—', { t: r.km == null ? '—' : n1(r.km), color: ORANGE }, r.stateLabel]),
      align: ['center', 'start', 'start', 'start', 'start', 'end', 'center'],
    },
  ];
  await downloadReport({ fileName: `fleet-distance-${from}-${to}`, lang: ar ? 'ar' : 'en', blocks, footerNote: t('المصدر: أجهزة تتبّع إكسبريس', 'Source: Express GPS units') });
}
