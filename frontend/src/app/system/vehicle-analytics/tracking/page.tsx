'use client';
import { useState, useEffect, useMemo } from 'react';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import { exportToExcel } from '@/utils/exportExcel';
import { detectTrips, type GPSMovement } from '@/lib/tripDetection';
import { getVehicleAnalyticsTrackingTranslations } from '@/lib/translations';
import { MapPin, Truck, Gauge, AlertTriangle, Search, Filter, Navigation, Activity, Zap, Download, Route } from 'lucide-react';

interface GpsMovement { vehicleId: string; beginning?: string; end?: string; initialLocation?: string; finalLocation?: string; duration?: string; distance?: number | string; maxSpeed?: number | string; avgSpeed?: number | string; [k: string]: any }
interface GpsOdometer { vehicleId: string; date?: string; driver?: string; initial?: number | string; final?: number | string; distance?: number | string; [k: string]: any }
interface GpsEngineOn { vehicleId: string; [k: string]: any }

export default function GpsTrackingPage() {
  const { lang } = useLanguage();
  const tx = getVehicleAnalyticsTrackingTranslations(lang);
  const [movements, setMovements] = useState<GpsMovement[]>([]);
  const [odometer, setOdometer] = useState<GpsOdometer[]>([]);
  const [engineOn, setEngineOn] = useState<GpsEngineOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [m, o, e] = await Promise.all([
          vehicleDB.getAll<GpsMovement>(vehicleDB.STORES.GPS_MOVEMENTS),
          vehicleDB.getAll<GpsOdometer>(vehicleDB.STORES.GPS_ODOMETER),
          vehicleDB.getAll<GpsEngineOn>(vehicleDB.STORES.GPS_ENGINE_ON),
        ]);
        setMovements(m); setOdometer(o); setEngineOn(e);
      } catch { /* empty */ }
      setLoading(false);
    })();
  }, []);

  const allVehicles = useMemo(() => {
    const set = new Set<string>();
    movements.forEach(r => set.add(r.vehicleId));
    odometer.forEach(r => set.add(r.vehicleId));
    return [...set].filter(Boolean).sort();
  }, [movements, odometer]);

  const filteredMovements = useMemo(() => {
    let d = movements;
    if (vehicleFilter) d = d.filter(r => r.vehicleId === vehicleFilter);
    if (search) { const q = search.toLowerCase(); d = d.filter(r => r.vehicleId.toLowerCase().includes(q)); }
    return d;
  }, [movements, vehicleFilter, search]);

  const filteredOdometer = useMemo(() => {
    let d = odometer;
    if (vehicleFilter) d = d.filter(r => r.vehicleId === vehicleFilter);
    if (search) { const q = search.toLowerCase(); d = d.filter(r => r.vehicleId.toLowerCase().includes(q)); }
    return d;
  }, [odometer, vehicleFilter, search]);

  const parseNum = (v: any): number => { const n = parseFloat(String(v || '0').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);

  const kpis = useMemo(() => {
    const trackedVehicles = new Set([...filteredMovements.map(r => r.vehicleId), ...filteredOdometer.map(r => r.vehicleId)]).size;
    const totalKm = filteredOdometer.reduce((s, r) => s + parseNum(r.distance), 0);
    const avgKm = trackedVehicles > 0 ? totalKm / trackedVehicles : 0;
    const maxSpd = Math.max(...filteredMovements.map(r => parseNum(r.maxSpeed)), 0);
    const violations = filteredMovements.filter(r => parseNum(r.maxSpeed) > 120).length;
    const engineOnCount = vehicleFilter ? engineOn.filter(r => r.vehicleId === vehicleFilter).length : engineOn.length;
    return { trackedVehicles, totalKm, avgKm, maxSpeed: maxSpd, violations, engineOnCount };
  }, [filteredMovements, filteredOdometer, engineOn, vehicleFilter]);

  // Top movers by total distance
  const topMovers = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOdometer.forEach(r => { map[r.vehicleId] = (map[r.vehicleId] || 0) + parseNum(r.distance); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [filteredOdometer]);

  // Speed violations
  const speedViolations = useMemo(() => {
    return filteredMovements.filter(r => parseNum(r.maxSpeed) > 120)
      .sort((a, b) => parseNum(b.maxSpeed) - parseNum(a.maxSpeed)).slice(0, 50);
  }, [filteredMovements]);

  // Daily distance chart
  const dailyDistance = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOdometer.forEach(r => { const d = String(r.date || '').slice(0, 10); if (d) map[d] = (map[d] || 0) + parseNum(r.distance); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredOdometer]);

  const maxDaily = useMemo(() => Math.max(...dailyDistance.map(d => d[1]), 1), [dailyDistance]);
  const maxMover = useMemo(() => (topMovers.length > 0 ? topMovers[0][1] : 1), [topMovers]);

  // Detected trips from algorithm
  const detectedTrips = useMemo(() => {
    const movs: GPSMovement[] = filteredMovements.map(r => ({
      vehicleId: r.vehicleId,
      beginning: String(r.beginning || ''),
      end: String(r.end || ''),
      initialLocation: String(r.initialLocation || ''),
      finalLocation: String(r.finalLocation || ''),
      duration: String(r.duration || ''),
      distance: parseNum(r.distance),
      maxSpeed: parseNum(r.maxSpeed),
      avgSpeed: parseNum(r.avgSpeed),
    }));
    return detectTrips(movs);
  }, [filteredMovements]);

  const allRoutes = useMemo(() => {
    const set = new Set<string>();
    detectedTrips.forEach(tr => set.add(`${tr.startCity} → ${tr.endCity}`));
    return [...set].sort();
  }, [detectedTrips]);

  const filteredTrips = useMemo(() => {
    if (!routeFilter) return detectedTrips;
    return detectedTrips.filter(tr => `${tr.startCity} → ${tr.endCity}` === routeFilter);
  }, [detectedTrips, routeFilter]);

  const tripKpis = useMemo(() => {
    const total = filteredTrips.length;
    const totalDist = filteredTrips.reduce((s, t) => s + t.totalDistance, 0);
    const totalDur = filteredTrips.reduce((s, t) => s + t.durationMinutes, 0);
    const avgDur = total > 0 ? totalDur / total : 0;
    const violations = filteredTrips.reduce((s, t) => s + t.speedViolations, 0);
    return { total, totalDist, avgDur, violations };
  }, [filteredTrips]);

  const fmtDur = (min: number) => {
    if (min <= 0) return '-';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">{tx.loading}</div>;

  const hasData = movements.length > 0 || odometer.length > 0;
  const kpiCards = [
    { label: tx.totalTracked, value: kpis.trackedVehicles, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-400/10' },
    { label: tx.totalKm, value: fmtNum(kpis.totalKm), icon: MapPin, color: 'text-purple-600', bg: 'bg-purple-400/10' },
    { label: tx.avgKm, value: fmtNum(kpis.avgKm), icon: Navigation, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
    { label: tx.maxSpeed, value: kpis.maxSpeed.toFixed(0) + ' km/h', icon: Gauge, color: 'text-amber-700', bg: 'bg-amber-400/10' },
    { label: tx.speedViolations, value: kpis.violations, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-400/10' },
    { label: tx.engineOnEvents, value: fmtNum(kpis.engineOnCount), icon: Zap, color: 'text-green-600', bg: 'bg-green-400/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{tx.title}</h1>
        {(filteredMovements.length > 0 || filteredOdometer.length > 0) && (
          <button type="button" onClick={() => exportToExcel(filteredMovements.map(r => ({
            vehicleId: r.vehicleId, beginning: r.beginning || '', end: r.end || '',
            initialLocation: r.initialLocation || '', finalLocation: r.finalLocation || '',
            duration: r.duration || '', distance: parseNum(r.distance), maxSpeed: parseNum(r.maxSpeed), avgSpeed: parseNum(r.avgSpeed),
          })), [
            { header: tx.vehicle, key: 'vehicleId' }, { header: tx.start, key: 'beginning' }, { header: tx.end, key: 'end' },
            { header: tx.initialLocation, key: 'initialLocation' }, { header: tx.finalLocation, key: 'finalLocation' },
            { header: tx.duration, key: 'duration' }, { header: tx.distance, key: 'distance' },
            { header: tx.maxSpeedCol, key: 'maxSpeed' }, { header: tx.avgSpeedCol, key: 'avgSpeed' },
          ], 'gps-tracking', 'GPS')} className="px-3 py-2 bg-emerald-500/20 text-emerald-600 rounded-lg text-sm hover:bg-emerald-500/30 flex items-center gap-1">
            <Download className="w-4 h-4" /> {tx.exportExcel}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-20 bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tx.search}
            className="w-full bg-slate-100 text-slate-800 text-sm rounded-lg pl-8 pr-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none" />
        </div>
        <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allVehicles}</option>
          {allVehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
          <Filter className="w-12 h-12" />
          <p className="text-lg">{tx.noData}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-slate-200 rounded-xl p-4 flex flex-col items-center gap-1`}>
                <c.icon className={`w-6 h-6 ${c.color}`} />
                <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                <p className="text-slate-500 text-[10px] text-center">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Segments vs Detected Trips comparison */}
          <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p className="text-slate-500 text-xs">{tx.rawSegments}</p>
                <p className="text-2xl font-bold text-slate-700">{fmtNum(filteredMovements.length)}</p>
              </div>
              <div className="bg-indigo-500/20 rounded-lg p-3 border border-indigo-500/40">
                <p className="text-indigo-700 text-xs">{tx.detectedTripsLabel}</p>
                <p className="text-2xl font-bold text-indigo-700">{fmtNum(tripKpis.total)}</p>
              </div>
            </div>
            <p className="text-slate-500 text-xs mt-3 italic">{tx.note}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Movers */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-600" /> {tx.topMovers}
              </h3>
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {topMovers.map(([vid, km], i) => (
                  <div key={vid} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 w-6 text-right shrink-0">{i + 1}</span>
                    <span className="text-slate-700 w-24 shrink-0 truncate">{vid}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div className="bg-purple-500 h-full rounded-full" style={{ width: `${(km / maxMover) * 100}%` }} />
                    </div>
                    <span className="text-purple-600 w-20 text-right">{fmtNum(km)} km</span>
                  </div>
                ))}
                {topMovers.length === 0 && <p className="text-slate-500 text-sm text-center py-4">--</p>}
              </div>
            </div>

            {/* Daily Distance Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.dailyDistance}</h3>
              <div className="flex items-end gap-1 h-[320px] px-1 overflow-x-auto">
                {dailyDistance.map(([date, km]) => (
                  <div key={date} className="flex-1 min-w-[18px] flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[9px] text-cyan-700">{fmtNum(km)}</span>
                    <div className="w-full bg-cyan-500/80 rounded-t-md" style={{ height: `${(km / maxDaily) * 85}%` }} />
                    <span className="text-[8px] text-slate-500 -rotate-45 origin-top-left whitespace-nowrap">{date.slice(5)}</span>
                  </div>
                ))}
                {dailyDistance.length === 0 && <p className="text-slate-500 text-sm text-center w-full self-center">--</p>}
              </div>
            </div>
          </div>

          {/* Speed Violations */}
          {speedViolations.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" /> {tx.speedViolationsList} ({speedViolations.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                    <th className="text-left py-2 px-2">{tx.vehicle}</th>
                    <th className="text-left py-2 px-2">{tx.start}</th>
                    <th className="text-left py-2 px-2">{tx.end}</th>
                    <th className="text-left py-2 px-2">{tx.initialLocation}</th>
                    <th className="text-left py-2 px-2">{tx.finalLocation}</th>
                    <th className="text-left py-2 px-2">{tx.duration}</th>
                    <th className="text-right py-2 px-2">{tx.distance}</th>
                    <th className="text-right py-2 px-2">{tx.maxSpeedCol}</th>
                    <th className="text-right py-2 px-2">{tx.avgSpeedCol}</th>
                  </tr></thead>
                  <tbody>
                    {speedViolations.map((r, i) => (
                      <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                        <td className="py-2 px-2 text-slate-900 font-medium">{r.vehicleId}</td>
                        <td className="py-2 px-2 text-slate-700 text-xs">{r.beginning || '-'}</td>
                        <td className="py-2 px-2 text-slate-700 text-xs">{r.end || '-'}</td>
                        <td className="py-2 px-2 text-slate-500 text-xs max-w-[150px] truncate">{r.initialLocation || '-'}</td>
                        <td className="py-2 px-2 text-slate-500 text-xs max-w-[150px] truncate">{r.finalLocation || '-'}</td>
                        <td className="py-2 px-2 text-slate-700">{r.duration || '-'}</td>
                        <td className="py-2 px-2 text-right text-purple-600">{parseNum(r.distance) > 0 ? parseNum(r.distance).toFixed(1) : '-'}</td>
                        <td className="py-2 px-2 text-right text-red-600 font-bold">{parseNum(r.maxSpeed).toFixed(0)} km/h</td>
                        <td className="py-2 px-2 text-right text-slate-700">{parseNum(r.avgSpeed) > 0 ? parseNum(r.avgSpeed).toFixed(0) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detected Trips Section */}
          <div className="bg-white border border-indigo-500/40 rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
                <Route className="w-5 h-5 text-indigo-600" /> {tx.detectedTrips}
              </h3>
              <select title={tx.route} value={routeFilter} onChange={e => setRouteFilter(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none max-w-[260px]">
                <option value="">{tx.allRoutes}</option>
                {allRoutes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Detected Trip KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3 flex flex-col items-center">
                <Route className="w-5 h-5 text-indigo-600" />
                <p className="text-xl font-bold text-indigo-700">{fmtNum(tripKpis.total)}</p>
                <p className="text-slate-500 text-[10px] text-center">{tx.totalDetected}</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 flex flex-col items-center">
                <MapPin className="w-5 h-5 text-purple-600" />
                <p className="text-xl font-bold text-purple-700">{fmtNum(tripKpis.totalDist)}</p>
                <p className="text-slate-500 text-[10px] text-center">{tx.totalTripDistance}</p>
              </div>
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 flex flex-col items-center">
                <Activity className="w-5 h-5 text-cyan-700" />
                <p className="text-xl font-bold text-cyan-700">{fmtDur(tripKpis.avgDur)}</p>
                <p className="text-slate-500 text-[10px] text-center">{tx.avgTripDuration}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex flex-col items-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <p className="text-xl font-bold text-red-700">{fmtNum(tripKpis.violations)}</p>
                <p className="text-slate-500 text-[10px] text-center">{tx.speedViolations}</p>
              </div>
            </div>

            {/* Trips Table */}
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-300 border-b border-slate-200">
                    <th className="text-left py-2 px-2">{tx.vehicle}</th>
                    <th className="text-left py-2 px-2">{tx.route}</th>
                    <th className="text-left py-2 px-2">{tx.startTime}</th>
                    <th className="text-left py-2 px-2">{tx.endTime}</th>
                    <th className="text-right py-2 px-2">{tx.duration}</th>
                    <th className="text-right py-2 px-2">{tx.distance}</th>
                    <th className="text-right py-2 px-2">{tx.maxSpeedCol}</th>
                    <th className="text-right py-2 px-2">{tx.avgSpeedCol}</th>
                    <th className="text-right py-2 px-2">{tx.violations}</th>
                    <th className="text-right py-2 px-2">{tx.segments}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrips.slice(0, 500).map((tr, i) => (
                    <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                      <td className="py-2 px-2 text-slate-900 font-medium">{tr.vehicleId}</td>
                      <td className="py-2 px-2 text-indigo-700 text-xs">{tr.startCity} → {tr.endCity}</td>
                      <td className="py-2 px-2 text-slate-700 text-xs">{tr.startTime}</td>
                      <td className="py-2 px-2 text-slate-700 text-xs">{tr.endTime}</td>
                      <td className="py-2 px-2 text-right text-cyan-700">{fmtDur(tr.durationMinutes)}</td>
                      <td className="py-2 px-2 text-right text-purple-600">{tr.totalDistance.toFixed(1)}</td>
                      <td className={`py-2 px-2 text-right ${tr.maxSpeed > 120 ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{tr.maxSpeed.toFixed(0)}</td>
                      <td className="py-2 px-2 text-right text-slate-700">{tr.avgSpeed.toFixed(0)}</td>
                      <td className={`py-2 px-2 text-right ${tr.speedViolations > 0 ? 'text-red-600' : 'text-slate-500'}`}>{tr.speedViolations}</td>
                      <td className="py-2 px-2 text-right text-slate-500">{tr.segmentCount}</td>
                    </tr>
                  ))}
                  {filteredTrips.length === 0 && (
                    <tr><td colSpan={10} className="text-center text-slate-500 py-4">--</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
