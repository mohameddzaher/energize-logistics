'use client';
import { use, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { detectTrips, type GPSMovement } from '@/lib/tripDetection';
import { useLanguage } from '@/context/LanguageContext';
import { getVehicleAnalyticsVehicleIdTranslations } from '@/lib/translations';
import { ArrowLeft, Truck, Activity, DollarSign, MapPin, Navigation, Route, TrendingUp, AlertTriangle, Gauge, Fuel, Users, Calendar, CheckCircle, XCircle } from 'lucide-react';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

type Tab = 'overview' | 'trips' | 'gps' | 'fuel' | 'financials' | 'compliance';
type GpsSortKey = 'time' | 'distance' | 'speed';

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLanguage();
  const tx = getVehicleAnalyticsVehicleIdTranslations(lang);

  const [petro, setPetro] = useState<any[]>([]);
  const [gpsMov, setGpsMov] = useState<any[]>([]);
  const [gpsOdo, setGpsOdo] = useState<any[]>([]);
  const [htTrips, setHtTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [routeFilter, setRouteFilter] = useState('');
  const [gpsSearch, setGpsSearch] = useState('');
  const [gpsSort, setGpsSort] = useState<GpsSortKey>('time');

  useEffect(() => {
    (async () => {
      try {
        const [p, gm, go, h] = await Promise.all([
          vehicleDB.getAll<any>(vehicleDB.STORES.PETRO),
          vehicleDB.getAll<any>(vehicleDB.STORES.GPS_MOVEMENTS),
          vehicleDB.getAll<any>(vehicleDB.STORES.GPS_ODOMETER),
          vehicleDB.getAll<any>(vehicleDB.STORES.HT_TRIPS),
        ]);
        setPetro(p.filter(r => String(r.vehicleId) === id));
        setGpsMov(gm.filter(r => String(r.vehicleId) === id));
        setGpsOdo(go.filter(r => String(r.vehicleId) === id));
        setHtTrips(h.filter(r => String(r.vehicleId) === id));
      } catch { /* empty */ }
      setLoading(false);
    })();
  }, [id]);

  const parseNum = (v: any): number => { const n = parseFloat(String(v ?? '0').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);
  const fmtDur = (min: number) => { if (min <= 0) return '-'; const h = Math.floor(min / 60); const m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

  const vInfo = petro[0] || {};

  const detectedTrips = useMemo(() => {
    const movs: GPSMovement[] = gpsMov.map(r => ({
      vehicleId: String(r.vehicleId),
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
  }, [gpsMov]);

  const allRoutes = useMemo(() => {
    const set = new Set<string>();
    detectedTrips.forEach(tr => set.add(`${tr.startCity} → ${tr.endCity}`));
    return [...set].sort();
  }, [detectedTrips]);

  const filteredTrips = useMemo(() => {
    if (!routeFilter) return detectedTrips;
    return detectedTrips.filter(tr => `${tr.startCity} → ${tr.endCity}` === routeFilter);
  }, [detectedTrips, routeFilter]);

  // Financial calcs
  const financials = useMemo(() => {
    const totalRevenue = htTrips.reduce((s, r) => s + parseNum(r.revenue || r.selling), 0);
    const expenseFields = ['actualDriverExpense', 'fuelCost', 'puncture', 'spareParts', 'washing', 'salesCommission', 'brokerCommission', 'fridayBonus', 'bonus'];
    const totalExpenses = htTrips.reduce((s, r) => {
      const te = parseNum(r.totalExpenses);
      if (te > 0) return s + te;
      return s + expenseFields.reduce((a, f) => a + parseNum(r[f]), 0);
    }, 0);
    const profit = totalRevenue - totalExpenses;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
    const avgRevPerTrip = htTrips.length > 0 ? totalRevenue / htTrips.length : 0;
    return { totalRevenue, totalExpenses, profit, margin, avgRevPerTrip };
  }, [htTrips]);

  // Monthly revenue
  const monthlyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    htTrips.forEach(r => { const m = String(r.month || ''); if (m) map[m] = (map[m] || 0) + parseNum(r.revenue || r.selling); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [htTrips]);

  // Expense breakdown
  const expenseBreakdown = useMemo(() => {
    const fields: { key: string; label: string }[] = [
      { key: 'actualDriverExpense', label: tx.expDriver }, { key: 'fuelCost', label: tx.expFuel },
      { key: 'puncture', label: tx.expPuncture }, { key: 'spareParts', label: tx.expParts },
      { key: 'washing', label: tx.expWashing }, { key: 'salesCommission', label: tx.expSalesComm },
      { key: 'brokerCommission', label: tx.expBrokerComm }, { key: 'fridayBonus', label: tx.expFridayBonus },
      { key: 'bonus', label: tx.expBonus },
    ];
    return fields.map(f => ({ label: f.label, total: htTrips.reduce((s, r) => s + parseNum(r[f.key]), 0) })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  }, [htTrips, tx]);

  // Fuel
  const fuel = useMemo(() => {
    const p = petro[0];
    if (!p) return null;
    const max = parseNum(p.maxConsump);
    const cur = parseNum(p.currentRate);
    const pct = max > 0 ? (cur / max) * 100 : 0;
    return { fuelType: String(p.fuel || ''), consType: String(p.consType || ''), max, cur, pct };
  }, [petro]);

  // Compliance
  const compliance = useMemo(() => {
    const total = htTrips.length || 1;
    const checkAny = (keyword: string) => htTrips.filter(r => Object.values(r).some(v => String(v || '').includes(keyword))).length;
    const tripFlag = (r: any, keyword: string) => Object.values(r).some(v => String(v || '').includes(keyword));
    return {
      loaded: checkAny('تم التحميل'),
      unloaded: checkAny('تم النزيل'),
      photoSent: checkAny('تم ارسال صوره السند') || checkAny('تم ارسال صورة السند'),
      receiptDelivered: checkAny('تم تسليم السند'),
      total,
      tripFlag,
    };
  }, [htTrips]);

  // KPIs
  const kpis = useMemo(() => {
    const totalDist = gpsOdo.reduce((s, r) => s + parseNum(r.distance), 0);
    const maxSpeed = Math.max(0, ...gpsMov.map(r => parseNum(r.maxSpeed)));
    const speedViolations = detectedTrips.reduce((s, tr) => s + tr.speedViolations, 0);
    const avgTripDist = detectedTrips.length > 0 ? detectedTrips.reduce((s, tr) => s + tr.totalDistance, 0) / detectedTrips.length : 0;
    const activeMonths = new Set(htTrips.map(r => String(r.month || '')).filter(Boolean)).size;
    const uniqueDrivers = new Set([...htTrips.map(r => String(r.driver1 || '')), ...gpsOdo.map(r => String(r.driver || ''))].filter(Boolean)).size;
    return { totalDist, maxSpeed, speedViolations, avgTripDist, activeMonths, uniqueDrivers };
  }, [gpsOdo, gpsMov, detectedTrips, htTrips]);

  // Filtered GPS movements
  const filteredGpsMov = useMemo(() => {
    let d = gpsMov;
    if (gpsSearch) {
      const q = gpsSearch.toLowerCase();
      d = d.filter(r => String(r.initialLocation || '').toLowerCase().includes(q) || String(r.finalLocation || '').toLowerCase().includes(q));
    }
    d = [...d];
    if (gpsSort === 'distance') d.sort((a, b) => parseNum(b.distance) - parseNum(a.distance));
    else if (gpsSort === 'speed') d.sort((a, b) => parseNum(b.maxSpeed) - parseNum(a.maxSpeed));
    else d.sort((a, b) => String(a.beginning || '').localeCompare(String(b.beginning || '')));
    return d;
  }, [gpsMov, gpsSearch, gpsSort]);

  const gpsExportColumns: ExportColumn[] = [
    { header: tx.startTime, key: 'beginning', transform: (v) => v || '-', width: 18 },
    { header: tx.endTime, key: 'end', transform: (v) => v || '-', width: 18 },
    { header: tx.from, key: 'initialLocation', transform: (v) => v || '-', width: 28 },
    { header: tx.to, key: 'finalLocation', transform: (v) => v || '-', width: 28 },
    { header: tx.duration, key: 'duration', transform: (v) => v || '-', width: 14 },
    { header: tx.distance, key: 'distance', transform: (v) => parseNum(v).toFixed(1), width: 12 },
    { header: tx.maxSpeed, key: 'maxSpeed', transform: (v) => parseNum(v).toFixed(0), width: 12 },
    { header: tx.avgSpeed, key: 'avgSpeed', transform: (v) => parseNum(v).toFixed(0), width: 12 },
  ];
  // الجدول نفسه لا يرسم إلّا أوّل خمسمئة مقطع، والبحث فوقه يضيّقها أكثر؛ فلزم أن
  // يقول الزرّ صراحةً أيَّ مجموعةٍ يأخذ، وإلّا خرج ملفٌّ ناقصٌ بلا علامةٍ على نقصه.
  const gpsSheetName = lang === 'ar' ? 'حركة GPS' : 'GPS Movements';
  const gpsScope = exportScopeLabels(lang === 'ar');
  const gpsExportOptions = [
    { key: 'shown', label: gpsScope.shown, sheets: [{ name: gpsSheetName, rows: filteredGpsMov, columns: gpsExportColumns }] },
    { key: 'all', label: gpsScope.all, sheets: [{ name: gpsSheetName, rows: gpsMov, columns: gpsExportColumns }] },
  ];

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">{tx.loading}</div>;

  const hasAnyData = petro.length > 0 || gpsMov.length > 0 || gpsOdo.length > 0 || htTrips.length > 0;
  if (!hasAnyData) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/system/vehicle-analytics')} className="text-slate-500 hover:text-slate-900 flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> {tx.back}
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 shadow-sm">
          {tx.vehicleNotFound}: {id}
        </div>
      </div>
    );
  }

  const maxMonthly = Math.max(1, ...monthlyRevenue.map(([, v]) => v));
  const maxExpense = Math.max(1, ...expenseBreakdown.map(e => e.total));

  const kpiCards = [
    { label: tx.totalDetectedTrips, value: detectedTrips.length, icon: Route, color: 'text-indigo-600', bg: 'bg-indigo-400/10' },
    { label: tx.totalDistance, value: fmtNum(kpis.totalDist), icon: MapPin, color: 'text-purple-600', bg: 'bg-purple-400/10' },
    { label: tx.totalRevenue, value: fmtNum(financials.totalRevenue), icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-400/10' },
    { label: tx.totalExpenses, value: fmtNum(financials.totalExpenses), icon: TrendingUp, color: 'text-red-600', bg: 'bg-red-400/10' },
    { label: tx.profit, value: fmtNum(financials.profit), icon: DollarSign, color: financials.profit >= 0 ? 'text-green-600' : 'text-red-600', bg: financials.profit >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: tx.profitMargin, value: financials.margin.toFixed(1) + '%', icon: TrendingUp, color: financials.margin >= 0 ? 'text-green-600' : 'text-red-600', bg: financials.margin >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: tx.avgRevPerTrip, value: fmtNum(financials.avgRevPerTrip), icon: DollarSign, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
    { label: tx.avgTripDistance, value: fmtNum(kpis.avgTripDist), icon: Navigation, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
    { label: tx.maxSpeedRecorded, value: kpis.maxSpeed.toFixed(0), icon: Gauge, color: 'text-amber-700', bg: 'bg-amber-400/10' },
    { label: tx.speedViolations, value: kpis.speedViolations, icon: AlertTriangle, color: kpis.speedViolations > 0 ? 'text-red-600' : 'text-slate-500', bg: kpis.speedViolations > 0 ? 'bg-red-400/10' : 'bg-slate-100' },
    { label: tx.fuelConsumption, value: fuel ? fuel.pct.toFixed(0) + '%' : '-', icon: Fuel, color: fuel && fuel.pct > 90 ? 'text-red-600' : 'text-blue-600', bg: fuel && fuel.pct > 90 ? 'bg-red-400/10' : 'bg-blue-400/10' },
    { label: tx.htTripCount, value: htTrips.length, icon: Activity, color: 'text-purple-600', bg: 'bg-purple-400/10' },
    { label: tx.activeMonths, value: kpis.activeMonths, icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-400/10' },
    { label: tx.uniqueDrivers, value: kpis.uniqueDrivers, icon: Users, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: tx.overview }, { key: 'trips', label: tx.trips },
    { key: 'gps', label: tx.gpsMov }, { key: 'fuel', label: tx.fuel },
    { key: 'financials', label: tx.financials }, { key: 'compliance', label: tx.compliance },
  ];

  return (
    <div className="space-y-6">
      <button onClick={() => router.push('/system/vehicle-analytics')} className="text-slate-500 hover:text-slate-900 flex items-center gap-2 text-sm">
        <ArrowLeft className="w-4 h-4" /> {tx.back}
      </button>

      {/* Header */}
      <div className="bg-gradient-to-br from-slate-100 to-slate-100 border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Truck className="w-10 h-10 text-[#f37121]" />
              <h1 className="text-4xl font-bold text-slate-900">{id}</h1>
              <span className={`px-3 py-1 rounded-full text-xs ${String(vInfo.status || '').toLowerCase() === 'active' ? 'bg-green-500/20 text-green-600' : 'bg-slate-200 text-slate-700'}`}>
                {vInfo.status || '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <div><p className="text-slate-500 text-xs">{tx.model}</p><p className="text-slate-800">{vInfo.model || '-'}</p></div>
              <div><p className="text-slate-500 text-xs">{tx.year}</p><p className="text-slate-800">{vInfo.year || '-'}</p></div>
              <div><p className="text-slate-500 text-xs">{tx.fuelType}</p><p className="text-slate-800">{vInfo.fuel || '-'}</p></div>
              <div><p className="text-slate-500 text-xs">{tx.category}</p><p className="text-slate-800">{vInfo.category || '-'}</p></div>
              <div><p className="text-slate-500 text-xs">{tx.branch}</p><p className="text-slate-800">{vInfo.branch || '-'}</p></div>
              <div><p className="text-slate-500 text-xs">{tx.driver}</p><p className="text-slate-800">{vInfo.driver || '-'}</p></div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition ${tab === tb.key ? 'border-[#f37121] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {kpiCards.map(c => (
            <div key={c.label} className={`${c.bg} border border-slate-200 rounded-xl p-3 flex flex-col items-center gap-1`}>
              <c.icon className={`w-5 h-5 ${c.color}`} />
              <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
              <p className="text-slate-500 text-[10px] text-center">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Trips */}
      {tab === 'trips' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.trips} ({filteredTrips.length})</h3>
            <select title={tx.route} value={routeFilter} onChange={e => setRouteFilter(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 max-w-[260px]">
              <option value="">{tx.allRoutes}</option>
              {allRoutes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900"><tr className="text-slate-300 border-b border-slate-200">
                <th className="text-start py-2 px-2">{tx.route}</th>
                <th className="text-start py-2 px-2">{tx.startTime}</th>
                <th className="text-start py-2 px-2">{tx.endTime}</th>
                <th className="text-end py-2 px-2">{tx.duration}</th>
                <th className="text-end py-2 px-2">{tx.distance}</th>
                <th className="text-end py-2 px-2">{tx.maxSpeed}</th>
                <th className="text-end py-2 px-2">{tx.avgSpeed}</th>
                <th className="text-end py-2 px-2">{tx.violations}</th>
                <th className="text-end py-2 px-2">{tx.segments}</th>
              </tr></thead>
              <tbody>
                {filteredTrips.map((tr, i) => (
                  <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                    <td className="py-2 px-2 text-indigo-700 text-xs">{tr.startCity} → {tr.endCity}</td>
                    <td className="py-2 px-2 text-slate-700 text-xs">{tr.startTime}</td>
                    <td className="py-2 px-2 text-slate-700 text-xs">{tr.endTime}</td>
                    <td className="py-2 px-2 text-end text-cyan-700">{fmtDur(tr.durationMinutes)}</td>
                    <td className="py-2 px-2 text-end text-purple-600">{tr.totalDistance.toFixed(1)}</td>
                    <td className={`py-2 px-2 text-end ${tr.maxSpeed > 120 ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{tr.maxSpeed.toFixed(0)}</td>
                    <td className="py-2 px-2 text-end text-slate-700">{tr.avgSpeed.toFixed(0)}</td>
                    <td className={`py-2 px-2 text-end ${tr.speedViolations > 0 ? 'text-red-600' : 'text-slate-800'}`}>{tr.speedViolations}</td>
                    <td className="py-2 px-2 text-end text-slate-800">{tr.segmentCount}</td>
                  </tr>
                ))}
                {filteredTrips.length === 0 && <tr><td colSpan={9} className="text-center text-slate-800 py-4">{tx.noTrips}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GPS Movements */}
      {tab === 'gps' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
            <input value={gpsSearch} onChange={e => setGpsSearch(e.target.value)} placeholder={tx.search}
              className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 flex-1 min-w-[240px]" />
            <select title={tx.sortBy} value={gpsSort} onChange={e => setGpsSort(e.target.value as GpsSortKey)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 w-full sm:w-44 shrink-0">
              <option value="time">{tx.time}</option>
              <option value="distance">{tx.distance}</option>
              <option value="speed">{tx.speed}</option>
            </select>
            <span className="text-slate-500 text-sm shrink-0">{filteredGpsMov.length}</span>
            <ExportMenu fileName={`gps-${id}`} lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" className="shrink-0 border border-slate-300" options={gpsExportOptions} />
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900"><tr className="text-slate-300 border-b border-slate-200">
                <th className="text-start py-2 px-2">{tx.startTime}</th>
                <th className="text-start py-2 px-2">{tx.endTime}</th>
                <th className="text-start py-2 px-2">{tx.from}</th>
                <th className="text-start py-2 px-2">{tx.to}</th>
                <th className="text-start py-2 px-2">{tx.duration}</th>
                <th className="text-end py-2 px-2">{tx.distance}</th>
                <th className="text-end py-2 px-2">{tx.maxSpeed}</th>
                <th className="text-end py-2 px-2">{tx.avgSpeed}</th>
              </tr></thead>
              <tbody>
                {filteredGpsMov.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                    <td className="py-2 px-2 text-slate-700 text-xs">{r.beginning || '-'}</td>
                    <td className="py-2 px-2 text-slate-700 text-xs">{r.end || '-'}</td>
                    <td className="py-2 px-2 text-slate-800 text-xs max-w-[180px] truncate">{r.initialLocation || '-'}</td>
                    <td className="py-2 px-2 text-slate-800 text-xs max-w-[180px] truncate">{r.finalLocation || '-'}</td>
                    <td className="py-2 px-2 text-slate-700">{r.duration || '-'}</td>
                    <td className="py-2 px-2 text-end text-purple-600">{parseNum(r.distance).toFixed(1)}</td>
                    <td className={`py-2 px-2 text-end ${parseNum(r.maxSpeed) > 120 ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{parseNum(r.maxSpeed).toFixed(0)}</td>
                    <td className="py-2 px-2 text-end text-slate-700">{parseNum(r.avgSpeed).toFixed(0)}</td>
                  </tr>
                ))}
                {filteredGpsMov.length === 0 && <tr><td colSpan={8} className="text-center text-slate-800 py-4">{tx.noSegments}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fuel */}
      {tab === 'fuel' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm">
          {!fuel ? (
            <p className="text-slate-500 text-center py-8">{tx.noFuel}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-400/10 border border-slate-200 rounded-lg p-3">
                  <p className="text-slate-500 text-xs">{tx.fuelTypeLabel}</p>
                  <p className="text-blue-600 font-bold">{fuel.fuelType || '-'}</p>
                </div>
                <div className="bg-cyan-400/10 border border-slate-200 rounded-lg p-3">
                  <p className="text-slate-500 text-xs">{tx.consType}</p>
                  <p className="text-cyan-700 font-bold">{fuel.consType || '-'}</p>
                </div>
                <div className="bg-purple-400/10 border border-slate-200 rounded-lg p-3">
                  <p className="text-slate-500 text-xs">{tx.currentRate}</p>
                  <p className="text-purple-600 font-bold">{fuel.cur.toFixed(2)}</p>
                </div>
                <div className="bg-amber-400/10 border border-slate-200 rounded-lg p-3">
                  <p className="text-slate-500 text-xs">{tx.maxConsump}</p>
                  <p className="text-amber-700 font-bold">{fuel.max.toFixed(2)}</p>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700">{tx.fuelConsumption}</span>
                  <span className={`font-bold ${fuel.pct > 90 ? 'text-red-600' : fuel.pct > 70 ? 'text-amber-700' : 'text-green-600'}`}>{fuel.pct.toFixed(1)}%</span>
                </div>
                <div className="bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div className={`h-full rounded-full ${fuel.pct > 90 ? 'bg-red-500' : fuel.pct > 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(fuel.pct, 100)}%` }} />
                </div>
              </div>
              {fuel.pct > 90 && (
                <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <span className="text-red-700 text-sm">{tx.alertHigh}</span>
                </div>
              )}
              {fuel.pct > 70 && fuel.pct <= 90 && (
                <div className="bg-amber-500/20 border border-amber-500/40 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-700" />
                  <span className="text-amber-700 text-sm">{tx.alertModerate}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Financials */}
      {tab === 'financials' && (
        <div className="space-y-4">
          {htTrips.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 shadow-sm">{tx.noFinancials}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Monthly revenue chart */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.monthlyRevenue}</h3>
                  <div className="flex items-end gap-1 h-[240px] px-2">
                    {monthlyRevenue.map(([m, v]) => (
                      <div key={m} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                        <span className="text-[9px] text-emerald-600">{fmtNum(v)}</span>
                        <div className="w-full bg-emerald-500/80 rounded-t-md" style={{ height: `${(v / maxMonthly) * 85}%` }} />
                        <span className="text-[8px] text-slate-500 -rotate-45 origin-top-left whitespace-nowrap">{m}</span>
                      </div>
                    ))}
                    {monthlyRevenue.length === 0 && <p className="text-slate-500 text-sm text-center w-full self-center">--</p>}
                  </div>
                </div>
                {/* Expense breakdown */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.expenseBreakdown}</h3>
                  <div className="space-y-2">
                    {expenseBreakdown.map(e => (
                      <div key={e.label} className="flex items-center gap-2 text-sm">
                        <span className="text-slate-700 w-28 shrink-0 text-xs">{e.label}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                          <div className="bg-red-500 h-full rounded-full" style={{ width: `${(e.total / maxExpense) * 100}%` }} />
                        </div>
                        <span className="text-red-600 w-16 text-end text-xs">{fmtNum(e.total)}</span>
                      </div>
                    ))}
                    {expenseBreakdown.length === 0 && <p className="text-slate-500 text-sm text-center py-4">--</p>}
                  </div>
                </div>
              </div>

              {/* HT Trips Table */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.trips} ({htTrips.length})</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900"><tr className="text-slate-300 border-b border-slate-200">
                      <th className="text-start py-2 px-2">{tx.date}</th>
                      <th className="text-start py-2 px-2">{tx.route}</th>
                      <th className="text-end py-2 px-2">{tx.days}</th>
                      <th className="text-end py-2 px-2">{tx.revenue}</th>
                      <th className="text-end py-2 px-2">{tx.expenses}</th>
                      <th className="text-end py-2 px-2">{tx.profit}</th>
                      <th className="text-start py-2 px-2">{tx.client}</th>
                      <th className="text-start py-2 px-2">{tx.driver}</th>
                    </tr></thead>
                    <tbody>
                      {htTrips.map((r, i) => {
                        const rev = parseNum(r.revenue || r.selling);
                        const te = parseNum(r.totalExpenses);
                        const expensesTotal = te > 0 ? te : parseNum(r.actualDriverExpense) + parseNum(r.fuelCost) + parseNum(r.puncture) + parseNum(r.spareParts) + parseNum(r.washing) + parseNum(r.salesCommission) + parseNum(r.brokerCommission) + parseNum(r.fridayBonus) + parseNum(r.bonus);
                        const profit = rev - expensesTotal;
                        return (
                          <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                            <td className="py-2 px-2 text-slate-700 text-xs">{r.month || r.date || '-'}</td>
                            <td className="py-2 px-2 text-indigo-700 text-xs">{(r.loadingPlace || '?')} → {(r.unloadingPlace || '?')}</td>
                            <td className="py-2 px-2 text-end text-slate-700">{parseNum(r.days) || '-'}</td>
                            <td className="py-2 px-2 text-end text-emerald-600">{fmtNum(rev)}</td>
                            <td className="py-2 px-2 text-end text-red-600">{fmtNum(expensesTotal)}</td>
                            <td className={`py-2 px-2 text-end ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtNum(profit)}</td>
                            <td className="py-2 px-2 text-slate-700 text-xs max-w-[140px] truncate">{r.client || '-'}</td>
                            <td className="py-2 px-2 text-slate-700 text-xs">{r.driver1 || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Compliance */}
      {tab === 'compliance' && (
        <div className="space-y-4">
          {htTrips.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 shadow-sm">{tx.noCompliance}</div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
                {[
                  { label: tx.loaded, value: compliance.loaded, keyword: 'تم التحميل' },
                  { label: tx.unloaded, value: compliance.unloaded, keyword: 'تم النزيل' },
                  { label: tx.photoSent, value: compliance.photoSent, keyword: 'تم ارسال صوره السند' },
                  { label: tx.receiptDelivered, value: compliance.receiptDelivered, keyword: 'تم تسليم السند' },
                ].map(item => {
                  const pct = (item.value / compliance.total) * 100;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-700">{item.label}</span>
                        <span className="text-slate-500">{item.value}/{compliance.total} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.compliance} - {tx.trips}</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900"><tr className="text-slate-300 border-b border-slate-200">
                      <th className="text-start py-2 px-2">{tx.date}</th>
                      <th className="text-start py-2 px-2">{tx.route}</th>
                      <th className="text-center py-2 px-2">{tx.loaded}</th>
                      <th className="text-center py-2 px-2">{tx.unloaded}</th>
                      <th className="text-center py-2 px-2">{tx.photoSent}</th>
                      <th className="text-center py-2 px-2">{tx.receiptDelivered}</th>
                    </tr></thead>
                    <tbody>
                      {htTrips.map((r, i) => {
                        const flags = [
                          compliance.tripFlag(r, 'تم التحميل'),
                          compliance.tripFlag(r, 'تم النزيل'),
                          compliance.tripFlag(r, 'تم ارسال صوره السند') || compliance.tripFlag(r, 'تم ارسال صورة السند'),
                          compliance.tripFlag(r, 'تم تسليم السند'),
                        ];
                        return (
                          <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                            <td className="py-2 px-2 text-slate-700 text-xs">{r.month || r.date || '-'}</td>
                            <td className="py-2 px-2 text-indigo-700 text-xs">{(r.loadingPlace || '?')} → {(r.unloadingPlace || '?')}</td>
                            {flags.map((ok, j) => (
                              <td key={j} className="py-2 px-2 text-center">
                                {ok ? <CheckCircle className="w-4 h-4 text-green-600 inline" /> : <XCircle className="w-4 h-4 text-red-600 inline" />}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
