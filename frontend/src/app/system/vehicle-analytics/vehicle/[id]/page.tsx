'use client';
import { use, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { detectTrips, type GPSMovement } from '@/lib/tripDetection';
import { useLanguage } from '@/context/LanguageContext';
import { ArrowLeft, Truck, Activity, DollarSign, MapPin, Navigation, Route, TrendingUp, AlertTriangle, Gauge, Fuel, Users, Calendar, CheckCircle, XCircle } from 'lucide-react';

const T = (lang: string) => lang === 'ar' ? {
  back: 'رجوع', overview: 'نظرة عامة', trips: 'الرحلات', gpsMov: 'حركات GPS', fuel: 'الوقود',
  financials: 'المالية', compliance: 'الامتثال', status: 'الحالة', branch: 'الفرع', driver: 'السائق',
  model: 'الموديل', year: 'السنة', fuelType: 'نوع الوقود', category: 'الفئة',
  totalDetectedTrips: 'إجمالي الرحلات المكتشفة', totalDistance: 'إجمالي المسافة (كم)',
  totalRevenue: 'إجمالي الإيرادات', totalExpenses: 'إجمالي المصروفات', profit: 'الربح', profitMargin: 'هامش الربح %',
  avgRevPerTrip: 'متوسط الإيراد/رحلة', avgTripDistance: 'متوسط مسافة الرحلة', maxSpeedRecorded: 'أقصى سرعة',
  speedViolations: 'تجاوزات السرعة', fuelConsumption: 'استهلاك الوقود %', htTripCount: 'عدد رحلات HT',
  activeMonths: 'أشهر نشطة', uniqueDrivers: 'سائقون فريدون',
  vehicle: 'المركبة', route: 'المسار', startTime: 'البدء', endTime: 'الانتهاء', duration: 'المدة',
  distance: 'المسافة', maxSpeed: 'أقصى سرعة', avgSpeed: 'متوسط السرعة', segments: 'المقاطع',
  violations: 'التجاوزات', allRoutes: 'كل المسارات', search: 'بحث...',
  date: 'التاريخ', from: 'من', to: 'إلى', days: 'أيام', revenue: 'الإيراد', expenses: 'المصروفات',
  client: 'العميل', monthlyRevenue: 'الإيرادات الشهرية', expenseBreakdown: 'تفصيل المصروفات',
  fuelTypeLabel: 'نوع الوقود', consType: 'نوع الاستهلاك', currentRate: 'المعدل الحالي', maxConsump: 'الحد الأقصى',
  loaded: 'تم التحميل', unloaded: 'تم النزيل', photoSent: 'تم إرسال الصورة', receiptDelivered: 'تم تسليم السند',
  noData: 'لا توجد بيانات', loading: 'جاري التحميل...', vehicleNotFound: 'المركبة غير موجودة',
  noTrips: 'لا توجد رحلات', noSegments: 'لا توجد مقاطع GPS', noFuel: 'لا توجد بيانات وقود',
  noFinancials: 'لا توجد بيانات مالية', noCompliance: 'لا توجد بيانات امتثال',
  sortBy: 'ترتيب حسب', time: 'الوقت', speed: 'السرعة', alertHigh: 'تنبيه: استهلاك عالٍ',
  alertModerate: 'تحذير: استهلاك متوسط',
} : {
  back: 'Back', overview: 'Overview', trips: 'Trips', gpsMov: 'GPS Movements', fuel: 'Fuel',
  financials: 'Financials', compliance: 'Compliance', status: 'Status', branch: 'Branch', driver: 'Driver',
  model: 'Model', year: 'Year', fuelType: 'Fuel Type', category: 'Category',
  totalDetectedTrips: 'Total Detected Trips', totalDistance: 'Total Distance (km)',
  totalRevenue: 'Total Revenue', totalExpenses: 'Total Expenses', profit: 'Profit', profitMargin: 'Profit Margin %',
  avgRevPerTrip: 'Avg Revenue/Trip', avgTripDistance: 'Avg Trip Distance', maxSpeedRecorded: 'Max Speed',
  speedViolations: 'Speed Violations', fuelConsumption: 'Fuel Consumption %', htTripCount: 'HT Trip Count',
  activeMonths: 'Active Months', uniqueDrivers: 'Unique Drivers',
  vehicle: 'Vehicle', route: 'Route', startTime: 'Start Time', endTime: 'End Time', duration: 'Duration',
  distance: 'Distance', maxSpeed: 'Max Speed', avgSpeed: 'Avg Speed', segments: 'Segments',
  violations: 'Violations', allRoutes: 'All Routes', search: 'Search...',
  date: 'Date', from: 'From', to: 'To', days: 'Days', revenue: 'Revenue', expenses: 'Expenses',
  client: 'Client', monthlyRevenue: 'Monthly Revenue', expenseBreakdown: 'Expense Breakdown',
  fuelTypeLabel: 'Fuel Type', consType: 'Consumption Type', currentRate: 'Current Rate', maxConsump: 'Max Rate',
  loaded: 'Loaded', unloaded: 'Unloaded', photoSent: 'Photo Sent', receiptDelivered: 'Receipt Delivered',
  noData: 'No data', loading: 'Loading...', vehicleNotFound: 'Vehicle not found',
  noTrips: 'No trips', noSegments: 'No GPS segments', noFuel: 'No fuel data',
  noFinancials: 'No financial data', noCompliance: 'No compliance data',
  sortBy: 'Sort by', time: 'Time', speed: 'Speed', alertHigh: 'Alert: High consumption',
  alertModerate: 'Warning: Moderate consumption',
};

type Tab = 'overview' | 'trips' | 'gps' | 'fuel' | 'financials' | 'compliance';
type GpsSortKey = 'time' | 'distance' | 'speed';

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLanguage();
  const t = T(lang);

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
      { key: 'actualDriverExpense', label: 'Driver' }, { key: 'fuelCost', label: 'Fuel' },
      { key: 'puncture', label: 'Puncture' }, { key: 'spareParts', label: 'Parts' },
      { key: 'washing', label: 'Washing' }, { key: 'salesCommission', label: 'Sales Comm.' },
      { key: 'brokerCommission', label: 'Broker Comm.' }, { key: 'fridayBonus', label: 'Friday Bonus' },
      { key: 'bonus', label: 'Bonus' },
    ];
    return fields.map(f => ({ label: f.label, total: htTrips.reduce((s, r) => s + parseNum(r[f.key]), 0) })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  }, [htTrips]);

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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">{t.loading}</div>;

  const hasAnyData = petro.length > 0 || gpsMov.length > 0 || gpsOdo.length > 0 || htTrips.length > 0;
  if (!hasAnyData) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/system/vehicle-analytics')} className="text-gray-400 hover:text-white flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> {t.back}
        </button>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-400">
          {t.vehicleNotFound}: {id}
        </div>
      </div>
    );
  }

  const maxMonthly = Math.max(1, ...monthlyRevenue.map(([, v]) => v));
  const maxExpense = Math.max(1, ...expenseBreakdown.map(e => e.total));

  const kpiCards = [
    { label: t.totalDetectedTrips, value: detectedTrips.length, icon: Route, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
    { label: t.totalDistance, value: fmtNum(kpis.totalDist), icon: MapPin, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: t.totalRevenue, value: fmtNum(financials.totalRevenue), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: t.totalExpenses, value: fmtNum(financials.totalExpenses), icon: TrendingUp, color: 'text-red-400', bg: 'bg-red-400/10' },
    { label: t.profit, value: fmtNum(financials.profit), icon: DollarSign, color: financials.profit >= 0 ? 'text-green-400' : 'text-red-400', bg: financials.profit >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: t.profitMargin, value: financials.margin.toFixed(1) + '%', icon: TrendingUp, color: financials.margin >= 0 ? 'text-green-400' : 'text-red-400', bg: financials.margin >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: t.avgRevPerTrip, value: fmtNum(financials.avgRevPerTrip), icon: DollarSign, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: t.avgTripDistance, value: fmtNum(kpis.avgTripDist), icon: Navigation, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: t.maxSpeedRecorded, value: kpis.maxSpeed.toFixed(0), icon: Gauge, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { label: t.speedViolations, value: kpis.speedViolations, icon: AlertTriangle, color: kpis.speedViolations > 0 ? 'text-red-400' : 'text-gray-400', bg: kpis.speedViolations > 0 ? 'bg-red-400/10' : 'bg-gray-700/50' },
    { label: t.fuelConsumption, value: fuel ? fuel.pct.toFixed(0) + '%' : '-', icon: Fuel, color: fuel && fuel.pct > 90 ? 'text-red-400' : 'text-blue-400', bg: fuel && fuel.pct > 90 ? 'bg-red-400/10' : 'bg-blue-400/10' },
    { label: t.htTripCount, value: htTrips.length, icon: Activity, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: t.activeMonths, value: kpis.activeMonths, icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: t.uniqueDrivers, value: kpis.uniqueDrivers, icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t.overview }, { key: 'trips', label: t.trips },
    { key: 'gps', label: t.gpsMov }, { key: 'fuel', label: t.fuel },
    { key: 'financials', label: t.financials }, { key: 'compliance', label: t.compliance },
  ];

  return (
    <div className="space-y-6">
      <button onClick={() => router.push('/system/vehicle-analytics')} className="text-gray-400 hover:text-white flex items-center gap-2 text-sm">
        <ArrowLeft className="w-4 h-4" /> {t.back}
      </button>

      {/* Header */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Truck className="w-10 h-10 text-[#f37121]" />
              <h1 className="text-4xl font-bold text-white">{id}</h1>
              <span className={`px-3 py-1 rounded-full text-xs ${String(vInfo.status || '').toLowerCase() === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-600 text-gray-300'}`}>
                {vInfo.status || '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <div><p className="text-gray-500 text-xs">{t.model}</p><p className="text-gray-200">{vInfo.model || '-'}</p></div>
              <div><p className="text-gray-500 text-xs">{t.year}</p><p className="text-gray-200">{vInfo.year || '-'}</p></div>
              <div><p className="text-gray-500 text-xs">{t.fuelType}</p><p className="text-gray-200">{vInfo.fuel || '-'}</p></div>
              <div><p className="text-gray-500 text-xs">{t.category}</p><p className="text-gray-200">{vInfo.category || '-'}</p></div>
              <div><p className="text-gray-500 text-xs">{t.branch}</p><p className="text-gray-200">{vInfo.branch || '-'}</p></div>
              <div><p className="text-gray-500 text-xs">{t.driver}</p><p className="text-gray-200">{vInfo.driver || '-'}</p></div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700 overflow-x-auto">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition ${tab === tb.key ? 'border-[#f37121] text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {kpiCards.map(c => (
            <div key={c.label} className={`${c.bg} border border-gray-700 rounded-xl p-3 flex flex-col items-center gap-1`}>
              <c.icon className={`w-5 h-5 ${c.color}`} />
              <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
              <p className="text-gray-400 text-[10px] text-center">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Trips */}
      {tab === 'trips' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <h3 className="text-white font-semibold">{t.trips} ({filteredTrips.length})</h3>
            <select title={t.route} value={routeFilter} onChange={e => setRouteFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 max-w-[260px]">
              <option value="">{t.allRoutes}</option>
              {allRoutes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800"><tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2 px-2">{t.route}</th>
                <th className="text-left py-2 px-2">{t.startTime}</th>
                <th className="text-left py-2 px-2">{t.endTime}</th>
                <th className="text-right py-2 px-2">{t.duration}</th>
                <th className="text-right py-2 px-2">{t.distance}</th>
                <th className="text-right py-2 px-2">{t.maxSpeed}</th>
                <th className="text-right py-2 px-2">{t.avgSpeed}</th>
                <th className="text-right py-2 px-2">{t.violations}</th>
                <th className="text-right py-2 px-2">{t.segments}</th>
              </tr></thead>
              <tbody>
                {filteredTrips.map((tr, i) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 px-2 text-indigo-300 text-xs">{tr.startCity} → {tr.endCity}</td>
                    <td className="py-2 px-2 text-gray-300 text-xs">{tr.startTime}</td>
                    <td className="py-2 px-2 text-gray-300 text-xs">{tr.endTime}</td>
                    <td className="py-2 px-2 text-right text-cyan-400">{fmtDur(tr.durationMinutes)}</td>
                    <td className="py-2 px-2 text-right text-purple-400">{tr.totalDistance.toFixed(1)}</td>
                    <td className={`py-2 px-2 text-right ${tr.maxSpeed > 120 ? 'text-red-400 font-bold' : 'text-gray-300'}`}>{tr.maxSpeed.toFixed(0)}</td>
                    <td className="py-2 px-2 text-right text-gray-300">{tr.avgSpeed.toFixed(0)}</td>
                    <td className={`py-2 px-2 text-right ${tr.speedViolations > 0 ? 'text-red-400' : 'text-gray-500'}`}>{tr.speedViolations}</td>
                    <td className="py-2 px-2 text-right text-gray-400">{tr.segmentCount}</td>
                  </tr>
                ))}
                {filteredTrips.length === 0 && <tr><td colSpan={9} className="text-center text-gray-500 py-4">{t.noTrips}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GPS Movements */}
      {tab === 'gps' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input value={gpsSearch} onChange={e => setGpsSearch(e.target.value)} placeholder={t.search}
              className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 min-w-[240px]" />
            <select title={t.sortBy} value={gpsSort} onChange={e => setGpsSort(e.target.value as GpsSortKey)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600">
              <option value="time">{t.time}</option>
              <option value="distance">{t.distance}</option>
              <option value="speed">{t.speed}</option>
            </select>
            <span className="text-gray-400 text-sm">{filteredGpsMov.length}</span>
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800"><tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2 px-2">{t.startTime}</th>
                <th className="text-left py-2 px-2">{t.endTime}</th>
                <th className="text-left py-2 px-2">{t.from}</th>
                <th className="text-left py-2 px-2">{t.to}</th>
                <th className="text-left py-2 px-2">{t.duration}</th>
                <th className="text-right py-2 px-2">{t.distance}</th>
                <th className="text-right py-2 px-2">{t.maxSpeed}</th>
                <th className="text-right py-2 px-2">{t.avgSpeed}</th>
              </tr></thead>
              <tbody>
                {filteredGpsMov.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 px-2 text-gray-300 text-xs">{r.beginning || '-'}</td>
                    <td className="py-2 px-2 text-gray-300 text-xs">{r.end || '-'}</td>
                    <td className="py-2 px-2 text-gray-400 text-xs max-w-[180px] truncate">{r.initialLocation || '-'}</td>
                    <td className="py-2 px-2 text-gray-400 text-xs max-w-[180px] truncate">{r.finalLocation || '-'}</td>
                    <td className="py-2 px-2 text-gray-300">{r.duration || '-'}</td>
                    <td className="py-2 px-2 text-right text-purple-400">{parseNum(r.distance).toFixed(1)}</td>
                    <td className={`py-2 px-2 text-right ${parseNum(r.maxSpeed) > 120 ? 'text-red-400 font-bold' : 'text-gray-300'}`}>{parseNum(r.maxSpeed).toFixed(0)}</td>
                    <td className="py-2 px-2 text-right text-gray-300">{parseNum(r.avgSpeed).toFixed(0)}</td>
                  </tr>
                ))}
                {filteredGpsMov.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-4">{t.noSegments}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fuel */}
      {tab === 'fuel' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
          {!fuel ? (
            <p className="text-gray-500 text-center py-8">{t.noFuel}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-400/10 border border-gray-700 rounded-lg p-3">
                  <p className="text-gray-400 text-xs">{t.fuelTypeLabel}</p>
                  <p className="text-blue-400 font-bold">{fuel.fuelType || '-'}</p>
                </div>
                <div className="bg-cyan-400/10 border border-gray-700 rounded-lg p-3">
                  <p className="text-gray-400 text-xs">{t.consType}</p>
                  <p className="text-cyan-400 font-bold">{fuel.consType || '-'}</p>
                </div>
                <div className="bg-purple-400/10 border border-gray-700 rounded-lg p-3">
                  <p className="text-gray-400 text-xs">{t.currentRate}</p>
                  <p className="text-purple-400 font-bold">{fuel.cur.toFixed(2)}</p>
                </div>
                <div className="bg-amber-400/10 border border-gray-700 rounded-lg p-3">
                  <p className="text-gray-400 text-xs">{t.maxConsump}</p>
                  <p className="text-amber-400 font-bold">{fuel.max.toFixed(2)}</p>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-300">{t.fuelConsumption}</span>
                  <span className={`font-bold ${fuel.pct > 90 ? 'text-red-400' : fuel.pct > 70 ? 'text-amber-400' : 'text-green-400'}`}>{fuel.pct.toFixed(1)}%</span>
                </div>
                <div className="bg-gray-700 rounded-full h-4 overflow-hidden">
                  <div className={`h-full rounded-full ${fuel.pct > 90 ? 'bg-red-500' : fuel.pct > 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(fuel.pct, 100)}%` }} />
                </div>
              </div>
              {fuel.pct > 90 && (
                <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <span className="text-red-300 text-sm">{t.alertHigh}</span>
                </div>
              )}
              {fuel.pct > 70 && fuel.pct <= 90 && (
                <div className="bg-amber-500/20 border border-amber-500/40 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <span className="text-amber-300 text-sm">{t.alertModerate}</span>
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
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-500">{t.noFinancials}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Monthly revenue chart */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-white font-semibold mb-3">{t.monthlyRevenue}</h3>
                  <div className="flex items-end gap-1 h-[240px] px-2">
                    {monthlyRevenue.map(([m, v]) => (
                      <div key={m} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                        <span className="text-[9px] text-emerald-400">{fmtNum(v)}</span>
                        <div className="w-full bg-emerald-500/80 rounded-t-md" style={{ height: `${(v / maxMonthly) * 85}%` }} />
                        <span className="text-[8px] text-gray-500 -rotate-45 origin-top-left whitespace-nowrap">{m}</span>
                      </div>
                    ))}
                    {monthlyRevenue.length === 0 && <p className="text-gray-500 text-sm text-center w-full self-center">--</p>}
                  </div>
                </div>
                {/* Expense breakdown */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-white font-semibold mb-3">{t.expenseBreakdown}</h3>
                  <div className="space-y-2">
                    {expenseBreakdown.map(e => (
                      <div key={e.label} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-300 w-28 shrink-0 text-xs">{e.label}</span>
                        <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden">
                          <div className="bg-red-500 h-full rounded-full" style={{ width: `${(e.total / maxExpense) * 100}%` }} />
                        </div>
                        <span className="text-red-400 w-16 text-right text-xs">{fmtNum(e.total)}</span>
                      </div>
                    ))}
                    {expenseBreakdown.length === 0 && <p className="text-gray-500 text-sm text-center py-4">--</p>}
                  </div>
                </div>
              </div>

              {/* HT Trips Table */}
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <h3 className="text-white font-semibold mb-3">{t.trips} ({htTrips.length})</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-800"><tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left py-2 px-2">{t.date}</th>
                      <th className="text-left py-2 px-2">{t.route}</th>
                      <th className="text-right py-2 px-2">{t.days}</th>
                      <th className="text-right py-2 px-2">{t.revenue}</th>
                      <th className="text-right py-2 px-2">{t.expenses}</th>
                      <th className="text-right py-2 px-2">{t.profit}</th>
                      <th className="text-left py-2 px-2">{t.client}</th>
                      <th className="text-left py-2 px-2">{t.driver}</th>
                    </tr></thead>
                    <tbody>
                      {htTrips.map((r, i) => {
                        const rev = parseNum(r.revenue || r.selling);
                        const te = parseNum(r.totalExpenses);
                        const expensesTotal = te > 0 ? te : parseNum(r.actualDriverExpense) + parseNum(r.fuelCost) + parseNum(r.puncture) + parseNum(r.spareParts) + parseNum(r.washing) + parseNum(r.salesCommission) + parseNum(r.brokerCommission) + parseNum(r.fridayBonus) + parseNum(r.bonus);
                        const profit = rev - expensesTotal;
                        return (
                          <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                            <td className="py-2 px-2 text-gray-300 text-xs">{r.month || r.date || '-'}</td>
                            <td className="py-2 px-2 text-indigo-300 text-xs">{(r.loadingPlace || '?')} → {(r.unloadingPlace || '?')}</td>
                            <td className="py-2 px-2 text-right text-gray-300">{parseNum(r.days) || '-'}</td>
                            <td className="py-2 px-2 text-right text-emerald-400">{fmtNum(rev)}</td>
                            <td className="py-2 px-2 text-right text-red-400">{fmtNum(expensesTotal)}</td>
                            <td className={`py-2 px-2 text-right ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNum(profit)}</td>
                            <td className="py-2 px-2 text-gray-300 text-xs max-w-[140px] truncate">{r.client || '-'}</td>
                            <td className="py-2 px-2 text-gray-300 text-xs">{r.driver1 || '-'}</td>
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
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-500">{t.noCompliance}</div>
          ) : (
            <>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                {[
                  { label: t.loaded, value: compliance.loaded, keyword: 'تم التحميل' },
                  { label: t.unloaded, value: compliance.unloaded, keyword: 'تم النزيل' },
                  { label: t.photoSent, value: compliance.photoSent, keyword: 'تم ارسال صوره السند' },
                  { label: t.receiptDelivered, value: compliance.receiptDelivered, keyword: 'تم تسليم السند' },
                ].map(item => {
                  const pct = (item.value / compliance.total) * 100;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-300">{item.label}</span>
                        <span className="text-gray-400">{item.value}/{compliance.total} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="bg-gray-700 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <h3 className="text-white font-semibold mb-3">{t.compliance} - {t.trips}</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-800"><tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left py-2 px-2">{t.date}</th>
                      <th className="text-left py-2 px-2">{t.route}</th>
                      <th className="text-center py-2 px-2">{t.loaded}</th>
                      <th className="text-center py-2 px-2">{t.unloaded}</th>
                      <th className="text-center py-2 px-2">{t.photoSent}</th>
                      <th className="text-center py-2 px-2">{t.receiptDelivered}</th>
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
                          <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                            <td className="py-2 px-2 text-gray-300 text-xs">{r.month || r.date || '-'}</td>
                            <td className="py-2 px-2 text-indigo-300 text-xs">{(r.loadingPlace || '?')} → {(r.unloadingPlace || '?')}</td>
                            {flags.map((ok, j) => (
                              <td key={j} className="py-2 px-2 text-center">
                                {ok ? <CheckCircle className="w-4 h-4 text-green-400 inline" /> : <XCircle className="w-4 h-4 text-red-400 inline" />}
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
