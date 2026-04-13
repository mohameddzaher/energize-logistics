'use client';
import { useState, useEffect, useMemo } from 'react';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import { Truck, Activity, DollarSign, MapPin, Navigation, Route, TrendingUp, AlertTriangle, Search, Filter, ChevronUp, ChevronDown } from 'lucide-react';

const T = (lang: string) => lang === 'ar' ? {
  title: 'تحليلات المركبات', totalFleet: 'إجمالي الأسطول', activeVehicles: 'المركبات النشطة',
  totalRevenue: 'إجمالي الإيرادات', totalGpsKm: 'إجمالي كم GPS', totalTrips: 'إجمالي الرحلات',
  fleetKms: 'كيلومترات الأسطول', profitMargin: 'هامش الربح %', alerts: 'التنبيهات',
  revenueByVehicle: 'الإيرادات حسب المركبة', monthlyRevenue: 'الإيرادات الشهرية',
  fleetByCategory: 'الأسطول حسب الفئة', distanceRanking: 'ترتيب المسافات',
  driverPerformance: 'أداء السائقين', vehicle: 'المركبة', model: 'الموديل', branch: 'الفرع',
  driver: 'السائق', status: 'الحالة', fuelPct: 'الوقود %', gpsKm: 'كم GPS', avgSpeed: 'متوسط السرعة',
  trips: 'الرحلات', revenue: 'الإيرادات', expenses: 'المصروفات', allVehicles: 'كل المركبات',
  allBranches: 'كل الفروع', allTypes: 'كل الأنواع', from: 'من', to: 'إلى', noData: 'لا توجد بيانات',
  loading: 'جاري التحميل...', search: 'بحث...', top15: 'أعلى 15',
} : {
  title: 'Vehicle Analytics', totalFleet: 'Total Fleet', activeVehicles: 'Active Vehicles',
  totalRevenue: 'Total Revenue', totalGpsKm: 'Total GPS KMs', totalTrips: 'Total Trips',
  fleetKms: 'Fleet KMs', profitMargin: 'Profit Margin %', alerts: 'Alerts',
  revenueByVehicle: 'Revenue by Vehicle', monthlyRevenue: 'Monthly Revenue Trend',
  fleetByCategory: 'Fleet by Category', distanceRanking: 'Distance Ranking',
  driverPerformance: 'Driver Performance', vehicle: 'Vehicle', model: 'Model', branch: 'Branch',
  driver: 'Driver', status: 'Status', fuelPct: 'Fuel %', gpsKm: 'GPS KM', avgSpeed: 'Avg Speed',
  trips: 'Trips', revenue: 'Revenue', expenses: 'Expenses', allVehicles: 'All Vehicles',
  allBranches: 'All Branches', allTypes: 'All Types', from: 'From', to: 'To', noData: 'No data uploaded yet',
  loading: 'Loading...', search: 'Search...', top15: 'Top 15',
};

interface RawPetro { vehicleId: string; vehicleModel?: string; branch?: string; driver?: string; status?: string; fuelConsumption?: number; vehicleType?: string; [k: string]: any }
interface RawGpsOdo { vehicleId: string; totalKm?: number; avgSpeed?: number; [k: string]: any }
interface RawHtTrip { vehicleId: string; driver?: string; revenue?: number; expenses?: number; month?: string; tripCount?: number; [k: string]: any }
interface RawHtKms { vehicleId: string; totalKm?: number; [k: string]: any }

type SortKey = 'vehicleId' | 'revenue' | 'gpsKm' | 'trips' | 'fuelPct';

export default function VehicleAnalyticsPage() {
  const { lang } = useLanguage();
  const t = T(lang);

  const [petro, setPetro] = useState<RawPetro[]>([]);
  const [gpsOdo, setGpsOdo] = useState<RawGpsOdo[]>([]);
  const [htTrips, setHtTrips] = useState<RawHtTrip[]>([]);
  const [htKms, setHtKms] = useState<RawHtKms[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, g, h, k] = await Promise.all([
          vehicleDB.getAll<RawPetro>(vehicleDB.STORES.PETRO),
          vehicleDB.getAll<RawGpsOdo>(vehicleDB.STORES.GPS_ODOMETER),
          vehicleDB.getAll<RawHtTrip>(vehicleDB.STORES.HT_TRIPS),
          vehicleDB.getAll<RawHtKms>(vehicleDB.STORES.HT_KMS),
        ]);
        setPetro(p); setGpsOdo(g); setHtTrips(h); setHtKms(k);
      } catch { /* empty db */ }
      setLoading(false);
    })();
  }, []);

  // Derive filter options
  const allVehicleIds = useMemo(() => [...new Set([...petro.map(r => r.vehicleId), ...gpsOdo.map(r => r.vehicleId), ...htTrips.map(r => r.vehicleId)])].sort(), [petro, gpsOdo, htTrips]);
  const allBranches = useMemo(() => [...new Set(petro.map(r => r.branch).filter(Boolean))].sort() as string[], [petro]);
  const allTypes = useMemo(() => [...new Set(petro.map(r => r.vehicleType).filter(Boolean))].sort() as string[], [petro]);

  // Filtered data
  const filtered = useMemo(() => {
    const vSet = vehicleFilter ? new Set([vehicleFilter]) : null;
    const bSet = branchFilter ? new Set(petro.filter(r => r.branch === branchFilter).map(r => r.vehicleId)) : null;
    const tSet = typeFilter ? new Set(petro.filter(r => r.vehicleType === typeFilter).map(r => r.vehicleId)) : null;
    const pass = (vid: string) => (!vSet || vSet.has(vid)) && (!bSet || bSet.has(vid)) && (!tSet || tSet.has(vid));
    const inDateRange = (m?: string) => { if (!dateFrom && !dateTo) return true; if (!m) return true; return (!dateFrom || m >= dateFrom) && (!dateTo || m <= dateTo); };
    return {
      petro: petro.filter(r => pass(r.vehicleId)),
      gpsOdo: gpsOdo.filter(r => pass(r.vehicleId)),
      htTrips: htTrips.filter(r => pass(r.vehicleId) && inDateRange(r.month)),
      htKms: htKms.filter(r => pass(r.vehicleId)),
    };
  }, [petro, gpsOdo, htTrips, htKms, vehicleFilter, branchFilter, typeFilter, dateFrom, dateTo]);

  // KPIs
  const kpis = useMemo(() => {
    const totalFleet = new Set(filtered.petro.map(r => r.vehicleId)).size || allVehicleIds.length;
    const activeVehicles = filtered.petro.filter(r => r.status?.toLowerCase() === 'active').length;
    const totalRevenue = filtered.htTrips.reduce((s, r) => s + (r.revenue || 0), 0);
    const totalExpenses = filtered.htTrips.reduce((s, r) => s + (r.expenses || 0), 0);
    const totalGpsKm = filtered.gpsOdo.reduce((s, r) => s + (r.totalKm || 0), 0);
    const totalTrips = filtered.htTrips.reduce((s, r) => s + (r.tripCount || 1), 0);
    const fleetKms = filtered.htKms.reduce((s, r) => s + (r.totalKm || 0), 0);
    const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100) : 0;
    const fuelAlerts = filtered.petro.filter(r => (r.fuelConsumption || 0) > 90).length;
    const speedAlerts = filtered.gpsOdo.filter(r => (r.avgSpeed || 0) > 120).length;
    const inactiveAlerts = filtered.petro.filter(r => r.status?.toLowerCase() !== 'active').length;
    return { totalFleet, activeVehicles, totalRevenue, totalGpsKm, totalTrips, fleetKms, profitMargin, alerts: fuelAlerts + speedAlerts + inactiveAlerts };
  }, [filtered, allVehicleIds]);

  // Chart data
  const revenueByVehicle = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.htTrips.forEach(r => { map[r.vehicleId] = (map[r.vehicleId] || 0) + (r.revenue || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [filtered.htTrips]);

  const monthlyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.htTrips.forEach(r => { if (r.month) map[r.month] = (map[r.month] || 0) + (r.revenue || 0); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered.htTrips]);

  const fleetByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.petro.forEach(r => { const cat = r.vehicleType || 'Other'; map[cat] = (map[cat] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered.petro]);

  const distanceRanking = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.gpsOdo.forEach(r => { map[r.vehicleId] = (map[r.vehicleId] || 0) + (r.totalKm || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [filtered.gpsOdo]);

  const driverPerf = useMemo(() => {
    const map: Record<string, { revenue: number; trips: number; km: number }> = {};
    filtered.htTrips.forEach(r => {
      const d = r.driver || 'Unknown';
      if (!map[d]) map[d] = { revenue: 0, trips: 0, km: 0 };
      map[d].revenue += r.revenue || 0;
      map[d].trips += r.tripCount || 1;
    });
    filtered.gpsOdo.forEach(r => {
      const pet = petro.find(p => p.vehicleId === r.vehicleId);
      const d = pet?.driver || 'Unknown';
      if (!map[d]) map[d] = { revenue: 0, trips: 0, km: 0 };
      map[d].km += r.totalKm || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 20);
  }, [filtered, petro]);

  // Vehicle table
  const vehicleTable = useMemo(() => {
    const map: Record<string, { vehicleId: string; model: string; branch: string; driver: string; status: string; fuelPct: number; gpsKm: number; avgSpeed: number; trips: number; revenue: number; expenses: number }> = {};
    const ensure = (vid: string) => { if (!map[vid]) map[vid] = { vehicleId: vid, model: '', branch: '', driver: '', status: '', fuelPct: 0, gpsKm: 0, avgSpeed: 0, trips: 0, revenue: 0, expenses: 0 }; };
    filtered.petro.forEach(r => { ensure(r.vehicleId); map[r.vehicleId].model = r.vehicleModel || ''; map[r.vehicleId].branch = r.branch || ''; map[r.vehicleId].driver = r.driver || ''; map[r.vehicleId].status = r.status || ''; map[r.vehicleId].fuelPct = r.fuelConsumption || 0; });
    filtered.gpsOdo.forEach(r => { ensure(r.vehicleId); map[r.vehicleId].gpsKm += r.totalKm || 0; map[r.vehicleId].avgSpeed = r.avgSpeed || map[r.vehicleId].avgSpeed; });
    filtered.htTrips.forEach(r => { ensure(r.vehicleId); map[r.vehicleId].trips += r.tripCount || 1; map[r.vehicleId].revenue += r.revenue || 0; map[r.vehicleId].expenses += r.expenses || 0; if (r.driver && !map[r.vehicleId].driver) map[r.vehicleId].driver = r.driver; });
    const arr = Object.values(map);
    arr.sort((a, b) => sortAsc ? (a[sortKey] > b[sortKey] ? 1 : -1) : (a[sortKey] < b[sortKey] ? 1 : -1));
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const SortIcon = ({ k }: { k: SortKey }) => sortKey === k ? (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null;
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);
  const maxBar = (data: [string, number][]) => Math.max(...data.map(d => d[1]), 1);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">{t.loading}</div>;

  const kpiCards = [
    { label: t.totalFleet, value: kpis.totalFleet, icon: Truck, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: t.activeVehicles, value: kpis.activeVehicles, icon: Activity, color: 'text-green-400', bg: 'bg-green-400/10' },
    { label: t.totalRevenue, value: fmtNum(kpis.totalRevenue), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: t.totalGpsKm, value: fmtNum(kpis.totalGpsKm), icon: MapPin, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: t.totalTrips, value: fmtNum(kpis.totalTrips), icon: Navigation, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: t.fleetKms, value: fmtNum(kpis.fleetKms), icon: Route, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
    { label: t.profitMargin, value: kpis.profitMargin.toFixed(1) + '%', icon: TrendingUp, color: kpis.profitMargin >= 0 ? 'text-green-400' : 'text-red-400', bg: kpis.profitMargin >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: t.alerts, value: kpis.alerts, icon: AlertTriangle, color: kpis.alerts > 0 ? 'text-amber-400' : 'text-gray-400', bg: kpis.alerts > 0 ? 'bg-amber-400/10' : 'bg-gray-700/50' },
  ];

  const hasData = petro.length > 0 || gpsOdo.length > 0 || htTrips.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold text-white">{t.title}</h1>

      {/* Filter Bar */}
      <div className="sticky top-0 z-20 bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-gray-500 pointer-events-none" />
          <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg pl-8 pr-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none min-w-[160px]">
            <option value="">{t.allVehicles}</option>
            {allVehicleIds.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allBranches}</option>
          {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allTypes}</option>
          {allTypes.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>{t.from}</span>
          <input type="month" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-2 py-1.5 border border-gray-600 focus:border-[#f37121] focus:outline-none" />
          <span>{t.to}</span>
          <input type="month" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-2 py-1.5 border border-gray-600 focus:border-[#f37121] focus:outline-none" />
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
          <Filter className="w-12 h-12" />
          <p className="text-lg">{t.noData}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-gray-700 rounded-xl p-4 flex items-center gap-3`}>
                <c.icon className={`w-8 h-8 ${c.color} shrink-0`} />
                <div>
                  <p className="text-gray-400 text-xs">{c.label}</p>
                  <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Horizontal bar chart helper */}
            {[{ title: `${t.revenueByVehicle} (${t.top15})`, data: revenueByVehicle, color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              { title: `${t.distanceRanking} (${t.top15})`, data: distanceRanking, color: 'bg-purple-500', textColor: 'text-purple-400' }].map(chart => (
              <div key={chart.title} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <h3 className="text-white font-semibold mb-3">{chart.title}</h3>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {chart.data.map(([vid, val]) => (
                    <div key={vid} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 w-20 shrink-0 truncate">{vid}</span>
                      <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden">
                        <div className={`${chart.color} h-full rounded-full`} style={{ width: `${(val / maxBar(chart.data)) * 100}%` }} />
                      </div>
                      <span className={`${chart.textColor} w-16 text-right`}>{fmtNum(val)}</span>
                    </div>
                  ))}
                  {chart.data.length === 0 && <p className="text-gray-500 text-sm text-center py-4">--</p>}
                </div>
              </div>
            ))}
            {/* Monthly Revenue */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3">{t.monthlyRevenue}</h3>
              <div className="flex items-end gap-1 h-[280px] px-2">
                {monthlyRevenue.map(([month, val]) => (
                  <div key={month} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[10px] text-emerald-400">{fmtNum(val)}</span>
                    <div className="w-full bg-emerald-500/80 rounded-t-md" style={{ height: `${(val / maxBar(monthlyRevenue)) * 85}%` }} />
                    <span className="text-[9px] text-gray-500 -rotate-45 origin-top-left whitespace-nowrap">{month}</span>
                  </div>
                ))}
                {monthlyRevenue.length === 0 && <p className="text-gray-500 text-sm text-center w-full self-center">--</p>}
              </div>
            </div>
            {/* Fleet by Category */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3">{t.fleetByCategory}</h3>
              <div className="space-y-3">
                {(() => { const total = fleetByCategory.reduce((s, c) => s + c[1], 0); const colors = ['bg-blue-500','bg-purple-500','bg-cyan-500','bg-amber-500','bg-rose-500','bg-emerald-500']; return fleetByCategory.map(([cat, count], i) => { const pct = total > 0 ? (count / total) * 100 : 0; return (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1"><span className="text-gray-300">{cat}</span><span className="text-gray-400">{count} ({pct.toFixed(0)}%)</span></div>
                    <div className="bg-gray-700 rounded-full h-3 overflow-hidden"><div className={`${colors[i % colors.length]} h-full rounded-full`} style={{ width: `${pct}%` }} /></div>
                  </div>); }); })()}
                {fleetByCategory.length === 0 && <p className="text-gray-500 text-sm text-center py-4">--</p>}
              </div>
            </div>
          </div>

          {/* Driver Performance Table */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-white font-semibold mb-3">{t.driverPerformance}</h3>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2 px-3">{t.driver}</th><th className="text-right py-2 px-3">{t.revenue}</th>
                <th className="text-right py-2 px-3">{t.trips}</th><th className="text-right py-2 px-3">{t.gpsKm}</th>
              </tr></thead>
              <tbody>{driverPerf.map(([driver, data]) => (
                <tr key={driver} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-2 px-3 text-white">{driver}</td><td className="py-2 px-3 text-right text-emerald-400">{fmtNum(data.revenue)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{data.trips}</td><td className="py-2 px-3 text-right text-purple-400">{fmtNum(data.km)}</td>
                </tr>))}
                {driverPerf.length === 0 && <tr><td colSpan={4} className="text-center text-gray-500 py-4">--</td></tr>}
              </tbody>
            </table></div>
          </div>

          {/* Vehicle Table */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-white font-semibold mb-3">{t.title}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-2 cursor-pointer" onClick={() => toggleSort('vehicleId')}>{t.vehicle} <SortIcon k="vehicleId" /></th>
                  <th className="text-left py-2 px-2">{t.model}</th>
                  <th className="text-left py-2 px-2">{t.branch}</th>
                  <th className="text-left py-2 px-2">{t.driver}</th>
                  <th className="text-left py-2 px-2">{t.status}</th>
                  <th className="text-right py-2 px-2 cursor-pointer" onClick={() => toggleSort('fuelPct')}>{t.fuelPct} <SortIcon k="fuelPct" /></th>
                  <th className="text-right py-2 px-2 cursor-pointer" onClick={() => toggleSort('gpsKm')}>{t.gpsKm} <SortIcon k="gpsKm" /></th>
                  <th className="text-right py-2 px-2">{t.avgSpeed}</th>
                  <th className="text-right py-2 px-2 cursor-pointer" onClick={() => toggleSort('trips')}>{t.trips} <SortIcon k="trips" /></th>
                  <th className="text-right py-2 px-2 cursor-pointer" onClick={() => toggleSort('revenue')}>{t.revenue} <SortIcon k="revenue" /></th>
                  <th className="text-right py-2 px-2">{t.expenses}</th>
                </tr></thead>
                <tbody>
                  {vehicleTable.map(row => (
                    <tr key={row.vehicleId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-2 text-white font-medium">{row.vehicleId}</td>
                      <td className="py-2 px-2 text-gray-300">{row.model || '-'}</td>
                      <td className="py-2 px-2 text-gray-300">{row.branch || '-'}</td>
                      <td className="py-2 px-2 text-gray-300">{row.driver || '-'}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${row.status?.toLowerCase() === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-600 text-gray-300'}`}>
                          {row.status || '-'}
                        </span>
                      </td>
                      <td className={`py-2 px-2 text-right ${row.fuelPct > 90 ? 'text-red-400 font-bold' : 'text-gray-300'}`}>{row.fuelPct > 0 ? row.fuelPct.toFixed(0) + '%' : '-'}</td>
                      <td className="py-2 px-2 text-right text-purple-400">{row.gpsKm > 0 ? fmtNum(row.gpsKm) : '-'}</td>
                      <td className="py-2 px-2 text-right text-gray-300">{row.avgSpeed > 0 ? row.avgSpeed.toFixed(0) : '-'}</td>
                      <td className="py-2 px-2 text-right text-gray-300">{row.trips > 0 ? row.trips : '-'}</td>
                      <td className="py-2 px-2 text-right text-emerald-400">{row.revenue > 0 ? fmtNum(row.revenue) : '-'}</td>
                      <td className="py-2 px-2 text-right text-red-400">{row.expenses > 0 ? fmtNum(row.expenses) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
