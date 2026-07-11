'use client';
// LiveMap — a real, moving map for a single vehicle. Loads Leaflet from a CDN
// once (no npm dependency) and, on every telemetry update, slides the marker to
// the new coordinate and pans the map — so the truck actually MOVES live instead
// of the whole map reloading (which is what a static OSM iframe does).
import { useEffect, useRef } from 'react';

declare global { interface Window { L?: any; __leafletLoading?: Promise<any> } }

const CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// Load Leaflet's script + stylesheet exactly once, shared across all instances.
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject();
  if (window.L) return Promise.resolve(window.L);
  if (window.__leafletLoading) return window.__leafletLoading;
  window.__leafletLoading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = JS; script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.body.appendChild(script);
  });
  return window.__leafletLoading;
}

export default function LiveMap({ lat, lng, label, speed, height = 320, track }: { lat: number; lng: number; label?: string; speed?: number | null; height?: number; track?: { lat: number; lng: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const trackRef = useRef<any>(null);

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([lat, lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      const marker = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#f37121', fillOpacity: 1 }).addTo(map);
      if (label) marker.bindTooltip(label, { permanent: false, direction: 'top' });
      mapRef.current = map; markerRef.current = marker;
      // Leaflet mis-measures size when its container was hidden/animating on init.
      setTimeout(() => map.invalidateSize(), 200);
    }).catch(() => {});
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the marker + pan whenever the coordinate changes (the "live" part).
  useEffect(() => {
    const map = mapRef.current; const marker = markerRef.current;
    if (!map || !marker || lat == null || lng == null) return;
    marker.setLatLng([lat, lng]);
    if (label) marker.setTooltipContent(`${label}${speed != null ? ` · ${speed} km/h` : ''}`);
    if (!track || !track.length) map.panTo([lat, lng], { animate: true, duration: 0.8 });
  }, [lat, lng, label, speed, track]);

  // Draw / clear the route polyline when a track is supplied.
  useEffect(() => {
    const map = mapRef.current; const L = (typeof window !== 'undefined' && window.L);
    if (!map || !L) return;
    if (trackRef.current) { map.removeLayer(trackRef.current); trackRef.current = null; }
    if (track && track.length > 1) {
      const latlngs = track.map((p) => [p.lat, p.lng]);
      const line = L.polyline(latlngs, { color: '#f37121', weight: 3, opacity: 0.85 }).addTo(map);
      trackRef.current = line;
      try { map.fitBounds(line.getBounds(), { padding: [24, 24] }); } catch (e) { /* noop */ }
    }
  }, [track]);

  return <div ref={containerRef} style={{ height }} className="w-full rounded-b-xl overflow-hidden bg-slate-100" />;
}
