'use client';
import { useState, useEffect, useMemo } from 'react';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import { MapPin, Truck, Gauge, AlertTriangle, Search, Filter, Navigation, Activity, Zap } from 'lucide-react';

const T = (lang: string) => lang === 'ar' ? {
  title: 'تتبع GPS', totalTracked: 'المركبات المتتبعة', totalKm: 'إجمالي الكيلومترات',
  avgKm: 'متوسط كم/مركبة', maxSpeed: 'أقصى سرعة مسجلة', speedViolations: 'تجاوزات السرعة',
  engineOnEvents: 'أحداث تشغيل المحرك', topMovers: 'أعلى المركبات حركة', speedViolationsList: 'تجاوزات السرعة (>120 كم/س)',
  dailyDistance: 'المسافة اليومية', vehicle: 'المركبة', distance: 'المسافة (كم)', rank: '#',
  start: 'البداية', end: 'النهاية', duration: 'المدة', maxSpeedCol: 'أقصى سرعة', avgSpeedCol: 'متوسط السرعة',
  allVehicles: 'كل المركبات', search: 'بحث بالمركبة...', noData: 'لا توجد بيانات GPS',
  loading: 'جاري التحميل...', date: 'التاريخ', driver: 'السائق', km: 'كم',
  initialLocation: 'الموقع الأولي', finalLocation: 'الموقع النهائي',
} : {
  title: 'GPS Tracking', totalTracked: 'Tracked Vehicles', totalKm: 'Total KMs',
  avgKm: 'Avg KM/Vehicle', maxSpeed: 'Max Speed Recorded', speedViolations: 'Speed Violations',
  engineOnEvents: 'Engine-On Events', topMovers: 'Top Movers', speedViolationsList: 'Speed Violations (>120 km/h)',
  dailyDistance: 'Daily Distance', vehicle: 'Vehicle', distance: 'Distance (km)', rank: '#',
  start: 'Start', end: 'End', duration: 'Duration', maxSpeedCol: 'Max Speed', avgSpeedCol: 'Avg Speed',
  allVehicles: 'All Vehicles', search: 'Search vehicle...', noData: 'No GPS data uploaded yet',
  loading: 'Loading...', date: 'Date', driver: 'Driver', km: 'KM',
  initialLocation: 'Initial Location', finalLocation: 'Final Location',
};

interface GpsMovement { vehicleId: string; beginning?: string; end?: string; initialLocation?: string; finalLocation?: string; duration?: string; distance?: number | string; maxSpeed?: number | string; avgSpeed?: number | string; [k: string]: any }
interface GpsOdometer { vehicleId: string; date?: string; driver?: string; initial?: number | string; final?: number | string; distance?: number | string; [k: string]: any }
interface GpsEngineOn { vehicleId: string; [k: string]: any }

export default function GpsTrackingPage() {
  const { lang } = useLanguage();
  const t = T(lang);
  const [movements, setMovements] = useState<GpsMovement[]>([]);
  const [odometer, setOdometer] = useState<GpsOdometer[]>([]);
  const [engineOn, setEngineOn] = useState<GpsEngineOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [search, setSearch] = useState('');

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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">{t.loading}</div>;

  const hasData = movements.length > 0 || odometer.length > 0;
  const kpiCards = [
    { label: t.totalTracked, value: kpis.trackedVehicles, icon: Truck, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: t.totalKm, value: fmtNum(kpis.totalKm), icon: MapPin, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: t.avgKm, value: fmtNum(kpis.avgKm), icon: Navigation, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: t.maxSpeed, value: kpis.maxSpeed.toFixed(0) + ' km/h', icon: Gauge, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { label: t.speedViolations, value: kpis.violations, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/10' },
    { label: t.engineOnEvents, value: fmtNum(kpis.engineOnCount), icon: Zap, color: 'text-green-400', bg: 'bg-green-400/10' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{t.title}</h1>

      {/* Filters */}
      <div className="sticky top-0 z-20 bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-gray-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t.search}
            className="bg-gray-700 text-gray-200 text-sm rounded-lg pl-8 pr-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none min-w-[200px]" />
        </div>
        <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allVehicles}</option>
          {allVehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
          <Filter className="w-12 h-12" />
          <p className="text-lg">{t.noData}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-gray-700 rounded-xl p-4 flex flex-col items-center gap-1`}>
                <c.icon className={`w-6 h-6 ${c.color}`} />
                <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                <p className="text-gray-400 text-[10px] text-center">{c.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Movers */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" /> {t.topMovers}
              </h3>
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {topMovers.map(([vid, km], i) => (
                  <div key={vid} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 w-6 text-right shrink-0">{i + 1}</span>
                    <span className="text-gray-300 w-24 shrink-0 truncate">{vid}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden">
                      <div className="bg-purple-500 h-full rounded-full" style={{ width: `${(km / maxMover) * 100}%` }} />
                    </div>
                    <span className="text-purple-400 w-20 text-right">{fmtNum(km)} km</span>
                  </div>
                ))}
                {topMovers.length === 0 && <p className="text-gray-500 text-sm text-center py-4">--</p>}
              </div>
            </div>

            {/* Daily Distance Chart */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3">{t.dailyDistance}</h3>
              <div className="flex items-end gap-1 h-[320px] px-1 overflow-x-auto">
                {dailyDistance.map(([date, km]) => (
                  <div key={date} className="flex-1 min-w-[18px] flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[9px] text-cyan-400">{fmtNum(km)}</span>
                    <div className="w-full bg-cyan-500/80 rounded-t-md" style={{ height: `${(km / maxDaily) * 85}%` }} />
                    <span className="text-[8px] text-gray-500 -rotate-45 origin-top-left whitespace-nowrap">{date.slice(5)}</span>
                  </div>
                ))}
                {dailyDistance.length === 0 && <p className="text-gray-500 text-sm text-center w-full self-center">--</p>}
              </div>
            </div>
          </div>

          {/* Speed Violations */}
          {speedViolations.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" /> {t.speedViolationsList} ({speedViolations.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2 px-2">{t.vehicle}</th>
                    <th className="text-left py-2 px-2">{t.start}</th>
                    <th className="text-left py-2 px-2">{t.end}</th>
                    <th className="text-left py-2 px-2">{t.initialLocation}</th>
                    <th className="text-left py-2 px-2">{t.finalLocation}</th>
                    <th className="text-left py-2 px-2">{t.duration}</th>
                    <th className="text-right py-2 px-2">{t.distance}</th>
                    <th className="text-right py-2 px-2">{t.maxSpeedCol}</th>
                    <th className="text-right py-2 px-2">{t.avgSpeedCol}</th>
                  </tr></thead>
                  <tbody>
                    {speedViolations.map((r, i) => (
                      <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="py-2 px-2 text-white font-medium">{r.vehicleId}</td>
                        <td className="py-2 px-2 text-gray-300 text-xs">{r.beginning || '-'}</td>
                        <td className="py-2 px-2 text-gray-300 text-xs">{r.end || '-'}</td>
                        <td className="py-2 px-2 text-gray-400 text-xs max-w-[150px] truncate">{r.initialLocation || '-'}</td>
                        <td className="py-2 px-2 text-gray-400 text-xs max-w-[150px] truncate">{r.finalLocation || '-'}</td>
                        <td className="py-2 px-2 text-gray-300">{r.duration || '-'}</td>
                        <td className="py-2 px-2 text-right text-purple-400">{parseNum(r.distance) > 0 ? parseNum(r.distance).toFixed(1) : '-'}</td>
                        <td className="py-2 px-2 text-right text-red-400 font-bold">{parseNum(r.maxSpeed).toFixed(0)} km/h</td>
                        <td className="py-2 px-2 text-right text-gray-300">{parseNum(r.avgSpeed) > 0 ? parseNum(r.avgSpeed).toFixed(0) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
