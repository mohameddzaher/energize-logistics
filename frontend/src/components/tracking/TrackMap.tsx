'use client';
/**
 * Fleet map for the Express units: one arrow marker per unit coloured by state, gliding to each new position instead of jumping;
 * a trail behind the followed unit; and, when a route is loaded, the route coloured by speed with start/end, stops, speeding
 * points and a playback marker. The map is never rebuilt, so the user's zoom stays.
 * Marker work runs only when units/selection change (not on every parent render), which is what froze the page during playback.
 */
import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '@/components/ls2/LiveMap';

export type UnitState = 'moving' | 'idling' | 'stopped' | 'late' | 'offline';
export const STATE_COLOR: Record<UnitState, string> = { moving: '#16a34a', idling: '#f59e0b', stopped: '#2563eb', late: '#94a3b8', offline: '#475569' };

export type MapUnit = { imei: string; plate: string; lat: number | null; lng: number | null; angle: number | null; speed: number; state: UnitState; label?: string };
export type RoutePoint = [number, number, number, number]; // t, lat, lng, speed
export type MapStop = { lat: number; lng: number; minutes: number; from: string; to: string };
export type MapSpeeding = { lat: number; lng: number; maxSpeed: number; at: string };

export const speedColor = (s: number, limit: number) => (s > limit ? '#dc2626' : s > limit * 0.75 ? '#f97316' : s > 3 ? '#16a34a' : '#64748b');
const arrow = (color: string, angle: number | null, on: boolean, moving: boolean) => {
  const sz = on ? 32 : 22;
  return `<div style="transform:rotate(${angle || 0}deg);width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center">
<svg viewBox="0 0 24 24" width="${sz}" height="${sz}">${moving ? `<circle cx="12" cy="12" r="11.8" fill="${color}" opacity=".28"/>` : ''}<circle cx="12" cy="12" r="9.5" fill="${color}" stroke="#fff" stroke-width="2.5"/><path d="M12 5.5 L16 14.5 L12 12.3 L8 14.5 Z" fill="#fff"/></svg></div>`;
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });

export default function TrackMap({ units = [], selected, onSelect, follow, trail, route, stops = [], speeding = [], speedLimit = 80, playIndex, focus, height = 560, ar = true }: {
  units?: MapUnit[]; selected?: string | null; onSelect?: (imei: string) => void; follow?: boolean;
  trail?: [number, number][] | null;
  route?: RoutePoint[] | null; stops?: MapStop[]; speeding?: MapSpeeding[]; speedLimit?: number; playIndex?: number | null;
  focus?: { lat: number; lng: number; zoom?: number } | null; height?: number | string; ar?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const L = useRef<any>(null);
  const markers = useRef<Map<string, { mk: any; key: string; tip?: string; anim?: number }>>(new Map());
  const routeLayer = useRef<any>(null);
  const trailLayer = useRef<any>(null);
  const playMarker = useRef<any>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    const anims = markers.current;
    loadLeaflet().then((Lf) => {
      if (dead || !box.current || map.current) return;
      L.current = Lf;
      const m = Lf.map(box.current, { zoomControl: true, attributionControl: false }).setView([24.7, 46.7], 6);
      Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 200);
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
      ro?.observe(box.current);
      (m as any).__ro = ro;
    }).catch(() => {});
    return () => {
      dead = true;
      anims.forEach((x) => x.anim && cancelAnimationFrame(x.anim));
      if (map.current) { map.current.__ro?.disconnect(); map.current.remove(); map.current = null; anims.clear(); }
    };
  }, []);

  // Unit markers: added, glided or removed in place; the icon is rebuilt only when its look changes.
  useEffect(() => {
    const Lf = L.current; const m = map.current;
    if (!Lf || !m) return;
    const icon = (u: MapUnit, on: boolean) => Lf.divIcon({ className: '', html: arrow(STATE_COLOR[u.state], u.angle, on, u.state === 'moving'), iconSize: [on ? 32 : 22, on ? 32 : 22], iconAnchor: [on ? 16 : 11, on ? 16 : 11] });
    const seen = new Set<string>();
    for (const u of units) {
      if (u.lat == null || u.lng == null) continue;
      seen.add(u.imei);
      const on = u.imei === selected;
      const key = `${u.state}|${Math.round((u.angle || 0) / 10)}|${on}`;
      let cur = markers.current.get(u.imei);
      if (!cur) {
        const mk = Lf.marker([u.lat, u.lng], { icon: icon(u, on) }).addTo(m);
        mk.on('click', () => onSelectRef.current?.(u.imei));
        cur = { mk, key };
        markers.current.set(u.imei, cur);
      } else {
        if (cur.key !== key) { cur.mk.setIcon(icon(u, on)); cur.key = key; }
        const from = cur.mk.getLatLng();
        if (Math.abs(from.lat - u.lat) > 1e-7 || Math.abs(from.lng - u.lng) > 1e-7) {
          // Glide over 2 s so a vehicle visibly drives to its new fix instead of teleporting.
          if (cur.anim) cancelAnimationFrame(cur.anim);
          const t0 = performance.now(); const c = cur; const to = { lat: u.lat, lng: u.lng };
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / 2000); const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
            c.mk.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
            c.anim = k < 1 ? requestAnimationFrame(step) : undefined;
          };
          cur.anim = requestAnimationFrame(step);
        }
      }
      cur.mk.setZIndexOffset(on ? 1000 : 0);
      // Rebinding 163 tooltips on every push was most of the work per update; only changed ones are rebound.
      const tip = `<b>${u.plate}</b>${u.label ? `<br/>${u.label}` : ''}<br/>${Math.round(u.speed)} ${ar ? 'كم/س' : 'km/h'}`;
      if (cur.tip !== tip) { cur.mk.unbindTooltip(); cur.mk.bindTooltip(tip, { direction: 'top', offset: [0, -12] }); cur.tip = tip; }
    }
    for (const [k, x] of markers.current) if (!seen.has(k)) { if (x.anim) cancelAnimationFrame(x.anim); x.mk.remove(); markers.current.delete(k); }
    if (!fitted.current && seen.size && !route) {
      // Offline units can hold a bad last fix (sea, abroad); the first view frames the units that are reporting.
      const live = units.filter((u) => u.lat != null && u.lng != null && u.state !== 'offline');
      const pts = (live.length ? live : units.filter((u) => u.lat != null && u.lng != null)).map((u) => [u.lat, u.lng]);
      if (pts.length) { m.fitBounds(pts, { padding: [30, 30], maxZoom: 13 }); fitted.current = true; }
    }
    if (follow && selected) { const u = units.find((x) => x.imei === selected); if (u?.lat != null) m.panTo([u.lat, u.lng], { animate: true, duration: 1.5 }); }
  }, [units, selected, follow, ready, ar, route]);

  // Trail behind the followed unit (last half hour).
  useEffect(() => {
    const Lf = L.current; const m = map.current;
    if (!Lf || !m) return;
    trailLayer.current?.remove(); trailLayer.current = null;
    if (trail && trail.length > 1) trailLayer.current = Lf.polyline(trail, { color: '#f37121', weight: 4, opacity: 0.75, dashArray: '6 6' }).addTo(m);
  }, [trail, ready]);

  // Route layer.
  useEffect(() => {
    const Lf = L.current; const m = map.current;
    if (!Lf || !m) return;
    routeLayer.current?.remove(); routeLayer.current = null;
    if (!route || route.length < 2) return;
    const g = Lf.layerGroup().addTo(m);
    // Consecutive points of the same speed band are one polyline, so a month draws in a few hundred segments.
    let band = speedColor(route[0][3], speedLimit); let seg: [number, number][] = [[route[0][1], route[0][2]]];
    for (let i = 1; i < route.length; i += 1) {
      const p = route[i]; const c = speedColor(p[3], speedLimit);
      seg.push([p[1], p[2]]);
      if (c !== band || i === route.length - 1) { Lf.polyline(seg, { color: band, weight: 4, opacity: 0.85 }).addTo(g); band = c; seg = [[p[1], p[2]]]; }
    }
    const s = route[0]; const e = route[route.length - 1];
    Lf.circleMarker([s[1], s[2]], { radius: 8, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip(`${ar ? 'البداية' : 'Start'} ${new Date(s[0]).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}`).addTo(g);
    Lf.circleMarker([e[1], e[2]], { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).bindTooltip(`${ar ? 'النهاية' : 'End'} ${new Date(e[0]).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}`).addTo(g);
    stops.forEach((st, i) => {
      Lf.marker([st.lat, st.lng], { icon: Lf.divIcon({ className: '', html: `<div style="background:#1e293b;color:#fff;border:2px solid #fff;border-radius:9px;font:700 10px sans-serif;padding:1px 5px;white-space:nowrap">P${i + 1}</div>`, iconAnchor: [10, 8] }) })
        .bindTooltip(`${ar ? 'توقّف' : 'Stop'} ${st.minutes} ${ar ? 'د' : 'min'} · ${hhmm(st.from)}–${hhmm(st.to)}`).addTo(g);
    });
    speeding.forEach((sp) => {
      Lf.circleMarker([sp.lat, sp.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#dc2626', fillOpacity: 1 }).bindTooltip(`${ar ? 'سرعة' : 'Speed'} ${Math.round(sp.maxSpeed)} · ${hhmm(sp.at)}`).addTo(g);
    });
    routeLayer.current = g;
    m.fitBounds(route.map((p) => [p[1], p[2]]), { padding: [30, 30] });
  }, [route, stops, speeding, speedLimit, ar, ready]);

  // Playback marker.
  useEffect(() => {
    const Lf = L.current; const m = map.current;
    if (!Lf || !m) return;
    if (!route || playIndex == null || !route[playIndex]) { playMarker.current?.remove(); playMarker.current = null; return; }
    const p = route[playIndex];
    const html = `<div style="width:18px;height:18px;border-radius:50%;background:#f37121;border:3px solid #fff;box-shadow:0 0 0 2px #f37121"></div>`;
    if (!playMarker.current) playMarker.current = Lf.marker([p[1], p[2]], { icon: Lf.divIcon({ className: '', html, iconAnchor: [9, 9] }), zIndexOffset: 2000 }).addTo(m);
    else playMarker.current.setLatLng([p[1], p[2]]);
    if (!m.getBounds().contains([p[1], p[2]])) m.panTo([p[1], p[2]]);
  }, [playIndex, route, ready]);

  useEffect(() => { if (focus && map.current) map.current.setView([focus.lat, focus.lng], focus.zoom || 16); }, [focus]);

  return <div ref={box} className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100" style={{ height }} />;
}
