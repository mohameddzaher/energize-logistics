'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import { exportToExcel } from '@/utils/exportExcel';
import { detectTrips, type GPSMovement } from '@/lib/tripDetection';
import { Truck, Activity, DollarSign, MapPin, Navigation, Route, TrendingUp, AlertTriangle, Search, Filter, ChevronUp, ChevronDown, Download } from 'lucide-react';

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
  manageData: 'إدارة البيانات', clearAll: 'مسح الكل', clearConfirm: 'هل أنت متأكد من مسح جميع بيانات تحليلات المركبات؟ لا يمكن التراجع.',
  cancel: 'إلغاء', confirm: 'نعم، مسح الكل', exportExcel: 'تصدير Excel',
  revenuePerKm: 'الإيراد لكل كم', driverLeaderboard: 'ترتيب السائقين', totalRev: 'إجمالي الإيرادات',
  revenuePerTrip: 'الإيراد/رحلة', totalKms: 'إجمالي الكم', routeAnalysis: 'تحليل المسارات',
  route: 'المسار', tripCount: 'عدد الرحلات', avgRevenue: 'متوسط الإيراد', avgDays: 'متوسط الأيام',
  branchComparison: 'مقارنة الفروع', vehicles: 'المركبات', vehicleUtilization: 'استخدام المركبات',
  activeDays: 'أيام نشطة', idleDays: 'أيام خمول', utilization: 'نسبة الاستخدام %',
  complianceOverview: 'نظرة على الامتثال', loaded: 'تم التحميل', unloaded: 'تم النزيل',
  photoSent: 'تم إرسال الصورة', receiptDelivered: 'تم تسليم السند',
  topRoutes: 'أعلى المسارات (من الرحلات المكتشفة)', totalDistance: 'إجمالي المسافة',
  avgDuration: 'متوسط المدة',
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
  manageData: 'Manage Data', clearAll: 'Clear All', clearConfirm: 'Are you sure you want to clear ALL vehicle analytics data? This cannot be undone.',
  cancel: 'Cancel', confirm: 'Yes, Clear All', exportExcel: 'Export Excel',
  revenuePerKm: 'Revenue per KM', driverLeaderboard: 'Driver Leaderboard', totalRev: 'Total Revenue',
  revenuePerTrip: 'Rev/Trip', totalKms: 'Total KMs', routeAnalysis: 'Route Analysis',
  route: 'Route', tripCount: 'Trip Count', avgRevenue: 'Avg Revenue', avgDays: 'Avg Days',
  branchComparison: 'Branch Comparison', vehicles: 'Vehicles', vehicleUtilization: 'Vehicle Utilization',
  activeDays: 'Active Days', idleDays: 'Idle Days', utilization: 'Utilization %',
  complianceOverview: 'Compliance Overview', loaded: 'Loaded', unloaded: 'Unloaded',
  photoSent: 'Photo Sent', receiptDelivered: 'Receipt Delivered',
  topRoutes: 'Top Routes (from Detected Trips)', totalDistance: 'Total Distance',
  avgDuration: 'Avg Duration',
};

interface RawPetro { vehicleId: string; vehicle?: string; model?: string; branch?: string; driver?: string; status?: string; maxConsump?: number; currentRate?: number; fuel?: string; category?: string; consType?: string; [k: string]: any }
interface RawGpsOdo { vehicleId: string; distance?: number | string; driver?: string; date?: string; initial?: number | string; final?: number | string; [k: string]: any }
interface RawGpsMov { vehicleId: string; distance?: number | string; maxSpeed?: number | string; avgSpeed?: number | string; [k: string]: any }
interface RawHtTrip { vehicleId: string; driver1?: string; revenue?: number; selling?: number; actualDriverExpense?: number; month?: string; branch?: string; [k: string]: any }
interface RawHtKms { vehicleId: string; [k: string]: any }

type SortKey = 'vehicleId' | 'revenue' | 'gpsKm' | 'trips' | 'fuelPct';

export default function VehicleAnalyticsPage() {
  const { lang } = useLanguage();
  const t = T(lang);
  const router = useRouter();

  const [petro, setPetro] = useState<RawPetro[]>([]);
  const [gpsOdo, setGpsOdo] = useState<RawGpsOdo[]>([]);
  const [gpsMov, setGpsMov] = useState<RawGpsMov[]>([]);
  const [htTrips, setHtTrips] = useState<RawHtTrip[]>([]);
  const [htKms, setHtKms] = useState<RawHtKms[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
        const [p, g, gm, h, k] = await Promise.all([
          vehicleDB.getAll<RawPetro>(vehicleDB.STORES.PETRO),
          vehicleDB.getAll<RawGpsOdo>(vehicleDB.STORES.GPS_ODOMETER),
          vehicleDB.getAll<RawGpsMov>(vehicleDB.STORES.GPS_MOVEMENTS),
          vehicleDB.getAll<RawHtTrip>(vehicleDB.STORES.HT_TRIPS),
          vehicleDB.getAll<RawHtKms>(vehicleDB.STORES.HT_KMS),
        ]);
        setPetro(p); setGpsOdo(g); setGpsMov(gm); setHtTrips(h); setHtKms(k);
      } catch { /* empty db */ }
      setLoading(false);
    })();
  }, []);

  const handleClearAll = async () => {
    await vehicleDB.clearAll();
    setPetro([]); setGpsOdo([]); setGpsMov([]); setHtTrips([]); setHtKms([]);
    setShowClearConfirm(false);
  };

  const handleExport = () => {
    exportToExcel(vehicleTable, [
      { header: t.vehicle, key: 'vehicleId' }, { header: t.model, key: 'model' },
      { header: t.branch, key: 'branch' }, { header: t.driver, key: 'driver' },
      { header: t.status, key: 'status' }, { header: t.fuelPct, key: 'fuelPct', transform: (v: number) => v > 0 ? v.toFixed(0) + '%' : '' },
      { header: t.gpsKm, key: 'gpsKm', transform: (v: number) => v > 0 ? Math.round(v) : '' },
      { header: t.avgSpeed, key: 'avgSpeed', transform: (v: number) => v > 0 ? v.toFixed(0) : '' },
      { header: t.trips, key: 'trips' }, { header: t.revenue, key: 'revenue' }, { header: t.expenses, key: 'expenses' },
    ], 'vehicle-analytics-dashboard', 'Dashboard');
  };

  // Derive filter options
  const parseNum = (v: any): number => { const n = parseFloat(String(v || '0').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };

  const allVehicleIds = useMemo(() => [...new Set([...petro.map(r => r.vehicleId), ...gpsOdo.map(r => r.vehicleId), ...gpsMov.map(r => r.vehicleId), ...htTrips.map(r => r.vehicleId)])].sort(), [petro, gpsOdo, gpsMov, htTrips]);
  const allBranches = useMemo(() => [...new Set(petro.map(r => String(r.branch || '')).filter(Boolean))].sort() as string[], [petro]);
  const allTypes = useMemo(() => [...new Set(petro.map(r => String(r.category || '')).filter(Boolean))].sort() as string[], [petro]);

  // Filtered data
  const filtered = useMemo(() => {
    const vSet = vehicleFilter ? new Set([vehicleFilter]) : null;
    const bSet = branchFilter ? new Set(petro.filter(r => String(r.branch || '').trim() === branchFilter).map(r => r.vehicleId)) : null;
    const tSet = typeFilter ? new Set(petro.filter(r => String(r.category || '').trim() === typeFilter).map(r => r.vehicleId)) : null;
    const pass = (vid: string) => (!vSet || vSet.has(vid)) && (!bSet || bSet.has(vid)) && (!tSet || tSet.has(vid));
    const inDateRange = (m?: any) => { if (!dateFrom && !dateTo) return true; const ms = String(m || ''); if (!ms) return true; return (!dateFrom || ms >= dateFrom) && (!dateTo || ms <= dateTo); };
    return {
      petro: petro.filter(r => pass(r.vehicleId)),
      gpsOdo: gpsOdo.filter(r => pass(r.vehicleId)),
      gpsMov: gpsMov.filter(r => pass(r.vehicleId)),
      htTrips: htTrips.filter(r => pass(r.vehicleId) && inDateRange(String(r.month || ''))),
      htKms: htKms.filter(r => pass(r.vehicleId)),
    };
  }, [petro, gpsOdo, gpsMov, htTrips, htKms, vehicleFilter, branchFilter, typeFilter, dateFrom, dateTo]);

  // KPIs
  const kpis = useMemo(() => {
    const petroVehicles = new Set(filtered.petro.map(r => r.vehicleId));
    const gpsVehicles = new Set(filtered.gpsOdo.map(r => r.vehicleId));
    const tripsVehicles = new Set(filtered.htTrips.map(r => r.vehicleId));
    const allVehicles = new Set([...petroVehicles, ...gpsVehicles, ...tripsVehicles]);

    const totalFleet = allVehicles.size;
    const activeVehicles = filtered.petro.filter(r => String(r.status || '').toLowerCase() === 'active').length;

    const totalRevenue = filtered.htTrips.reduce((s, r) => s + parseNum(r.revenue || r.selling), 0);

    // Full expense calculation - use totalExpenses field if available, else sum individual fields
    const totalExpenses = filtered.htTrips.reduce((s, r) => {
      const te = parseNum((r as any).totalExpenses);
      if (te > 0) return s + te;
      return s + parseNum(r.actualDriverExpense) + parseNum((r as any).fuelCost) +
             parseNum((r as any).puncture) + parseNum((r as any).spareParts) + parseNum((r as any).washing) +
             parseNum((r as any).salesCommission) + parseNum((r as any).brokerCommission) +
             parseNum((r as any).fridayBonus) + parseNum((r as any).bonus);
    }, 0);

    const totalGpsKm = filtered.gpsOdo.reduce((s, r) => s + parseNum(r.distance), 0);
    const totalTrips = filtered.htTrips.length;

    // Fleet KMs from HT KMs Record - sum monthly KM columns
    const fleetKms = filtered.htKms.reduce((s, r) => {
      const monthKms = Object.entries(r)
        .filter(([k]) => /kms?$/i.test(String(k)) && !/odometer/i.test(String(k)))
        .map(([, v]) => parseNum(v))
        .reduce((a, b) => a + b, 0);
      return s + monthKms;
    }, 0);

    const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100) : 0;
    const fuelAlerts = filtered.petro.filter(r => {
      const max = parseNum(r.maxConsump);
      const cur = parseNum(r.currentRate);
      return max > 0 && (cur / max) * 100 > 90;
    }).length;
    const speedAlerts = filtered.gpsMov.filter(r => parseNum(r.maxSpeed) > 120).length;
    const inactiveAlerts = filtered.petro.filter(r => {
      const st = String(r.status || '').toLowerCase();
      return st && st !== 'active';
    }).length;
    return { totalFleet, activeVehicles, totalRevenue, totalExpenses, totalGpsKm, totalTrips, fleetKms, profitMargin, alerts: fuelAlerts + speedAlerts + inactiveAlerts, tripsVehicleCount: tripsVehicles.size };
  }, [filtered, allVehicleIds]);

  // Chart data
  const revenueByVehicle = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.htTrips.forEach(r => { map[r.vehicleId] = (map[r.vehicleId] || 0) + parseNum(r.revenue || r.selling); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [filtered.htTrips]);

  const monthlyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.htTrips.forEach(r => { const m = String(r.month || ''); if (m) map[m] = (map[m] || 0) + parseNum(r.revenue || r.selling); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered.htTrips]);

  const fleetByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.petro.forEach(r => { const cat = String(r.category || '') || 'Other'; map[cat] = (map[cat] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered.petro]);

  const distanceRanking = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.gpsOdo.forEach(r => { map[r.vehicleId] = (map[r.vehicleId] || 0) + parseNum(r.distance); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [filtered.gpsOdo]);

  const driverPerf = useMemo(() => {
    const map: Record<string, { revenue: number; trips: number; km: number }> = {};
    filtered.htTrips.forEach(r => {
      const d = String(r.driver1 || '') || 'Unknown';
      if (!map[d]) map[d] = { revenue: 0, trips: 0, km: 0 };
      map[d].revenue += parseNum(r.revenue || r.selling);
      map[d].trips += 1;
    });
    filtered.gpsOdo.forEach(r => {
      const pet = petro.find(p => p.vehicleId === r.vehicleId);
      const d = String(pet?.driver || r.driver || '') || 'Unknown';
      if (!map[d]) map[d] = { revenue: 0, trips: 0, km: 0 };
      map[d].km += parseNum(r.distance);
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 20);
  }, [filtered, petro]);

  // Vehicle table
  const vehicleTable = useMemo(() => {
    const map: Record<string, { vehicleId: string; model: string; branch: string; driver: string; status: string; fuelPct: number; gpsKm: number; avgSpeed: number; trips: number; revenue: number; expenses: number }> = {};
    const ensure = (vid: string) => { if (!map[vid]) map[vid] = { vehicleId: vid, model: '', branch: '', driver: '', status: '', fuelPct: 0, gpsKm: 0, avgSpeed: 0, trips: 0, revenue: 0, expenses: 0 }; };
    filtered.petro.forEach(r => {
      ensure(r.vehicleId);
      map[r.vehicleId].model = String(r.model || '');
      map[r.vehicleId].branch = String(r.branch || '');
      map[r.vehicleId].status = String(r.status || '');
      const max = parseNum(r.maxConsump);
      const cur = parseNum(r.currentRate);
      map[r.vehicleId].fuelPct = max > 0 ? (cur / max) * 100 : 0;
    });
    filtered.gpsOdo.forEach(r => { ensure(r.vehicleId); map[r.vehicleId].gpsKm += parseNum(r.distance); if (r.driver && !map[r.vehicleId].driver) map[r.vehicleId].driver = String(r.driver); });
    filtered.gpsMov.forEach(r => { ensure(r.vehicleId); const spd = parseNum(r.avgSpeed); if (spd > map[r.vehicleId].avgSpeed) map[r.vehicleId].avgSpeed = spd; });
    filtered.htTrips.forEach(r => { ensure(r.vehicleId); map[r.vehicleId].trips += 1; map[r.vehicleId].revenue += parseNum(r.revenue || r.selling); map[r.vehicleId].expenses += parseNum(r.actualDriverExpense); if (r.driver1 && !map[r.vehicleId].driver) map[r.vehicleId].driver = String(r.driver1); });
    const arr = Object.values(map);
    arr.sort((a, b) => sortAsc ? (a[sortKey] > b[sortKey] ? 1 : -1) : (a[sortKey] < b[sortKey] ? 1 : -1));
    return arr;
  }, [filtered, sortKey, sortAsc]);

  // Revenue per KM
  const revenuePerKm = useMemo(() => {
    return vehicleTable.filter(v => v.gpsKm > 0 && v.revenue > 0).map(v => ({ vehicleId: v.vehicleId, ratio: v.revenue / v.gpsKm })).sort((a, b) => b.ratio - a.ratio).slice(0, 15);
  }, [vehicleTable]);

  // Route Analysis
  const routeAnalysis = useMemo(() => {
    const map: Record<string, { count: number; totalRev: number; totalDays: number }> = {};
    filtered.htTrips.forEach(r => {
      const from = String((r as any).loadingPlace || '').trim() || '?';
      const to = String((r as any).unloadingPlace || '').trim() || '?';
      const key = `${from} → ${to}`;
      if (!map[key]) map[key] = { count: 0, totalRev: 0, totalDays: 0 };
      map[key].count += 1;
      map[key].totalRev += parseNum(r.revenue || r.selling);
      map[key].totalDays += parseNum((r as any).days);
    });
    return Object.entries(map).sort((a, b) => b[1].totalRev - a[1].totalRev).slice(0, 15);
  }, [filtered.htTrips]);

  // Branch Comparison
  const branchComparison = useMemo(() => {
    const map: Record<string, { vehicles: Set<string>; revenue: number; trips: number }> = {};
    filtered.petro.forEach(r => { const b = String(r.branch || '') || 'Other'; if (!map[b]) map[b] = { vehicles: new Set(), revenue: 0, trips: 0 }; map[b].vehicles.add(r.vehicleId); });
    filtered.htTrips.forEach(r => { const b = String(r.branch || '') || 'Other'; if (!map[b]) map[b] = { vehicles: new Set(), revenue: 0, trips: 0 }; map[b].vehicles.add(r.vehicleId); map[b].revenue += parseNum(r.revenue || r.selling); map[b].trips += 1; });
    return Object.entries(map).map(([branch, d]) => ({ branch, vehicles: d.vehicles.size, revenue: d.revenue, trips: d.trips, avgRev: d.vehicles.size > 0 ? d.revenue / d.vehicles.size : 0 })).sort((a, b) => b.revenue - a.revenue);
  }, [filtered.petro, filtered.htTrips]);

  // Vehicle Utilization
  const vehicleUtilization = useMemo(() => {
    const tripDays: Record<string, Set<string>> = {};
    filtered.htTrips.forEach(r => { if (!tripDays[r.vehicleId]) tripDays[r.vehicleId] = new Set(); const m = String(r.month || ''); if (m) tripDays[r.vehicleId].add(m); });
    const allMonths = new Set<string>();
    filtered.htTrips.forEach(r => { const m = String(r.month || ''); if (m) allMonths.add(m); });
    const totalPeriods = Math.max(allMonths.size, 1);
    return Object.entries(tripDays).map(([vid, months]) => {
      const active = months.size;
      const idle = totalPeriods - active;
      const pct = (active / totalPeriods) * 100;
      return { vehicleId: vid, active, idle, pct };
    }).sort((a, b) => b.pct - a.pct).slice(0, 20);
  }, [filtered.htTrips]);

  // Compliance Overview
  const compliance = useMemo(() => {
    const total = filtered.htTrips.length || 1;
    const check = (field: string, keyword: string) => filtered.htTrips.filter(r => String((r as any)[field] || '').includes(keyword)).length;
    // Check all string fields for compliance flags
    const checkAny = (keyword: string) => filtered.htTrips.filter(r => Object.values(r).some(v => String(v || '').includes(keyword))).length;
    return {
      loaded: checkAny('تم التحميل'),
      unloaded: checkAny('تم النزيل'),
      photoSent: checkAny('تم ارسال صوره السند') || checkAny('تم ارسال صورة السند'),
      receiptDelivered: checkAny('تم تسليم السند'),
      total,
    };
  }, [filtered.htTrips]);

  // Top Routes from detected trips
  const topDetectedRoutes = useMemo(() => {
    const movs: GPSMovement[] = filtered.gpsMov.map(r => ({
      vehicleId: r.vehicleId,
      beginning: String((r as any).beginning || ''),
      end: String((r as any).end || ''),
      initialLocation: String((r as any).initialLocation || ''),
      finalLocation: String((r as any).finalLocation || ''),
      duration: String((r as any).duration || ''),
      distance: parseNum(r.distance),
      maxSpeed: parseNum(r.maxSpeed),
      avgSpeed: parseNum(r.avgSpeed),
    }));
    const trips = detectTrips(movs);
    const map: Record<string, { count: number; totalDist: number; totalDur: number }> = {};
    trips.forEach(tr => {
      const key = `${tr.startCity} → ${tr.endCity}`;
      if (!map[key]) map[key] = { count: 0, totalDist: 0, totalDur: 0 };
      map[key].count += 1;
      map[key].totalDist += tr.totalDistance;
      map[key].totalDur += tr.durationMinutes;
    });
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count).slice(0, 20);
  }, [filtered.gpsMov]);

  const fmtDur = (min: number) => {
    if (min <= 0) return '-';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const SortIcon = ({ k }: { k: SortKey }) => sortKey === k ? (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null;
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);
  const maxBar = (data: [string, number][]) => Math.max(...data.map(d => d[1]), 1);

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">{t.loading}</div>;

  const kpiCards = [
    { label: t.totalFleet, value: kpis.totalFleet, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-400/10' },
    { label: t.activeVehicles, value: kpis.activeVehicles, icon: Activity, color: 'text-green-600', bg: 'bg-green-400/10' },
    { label: t.totalRevenue, value: fmtNum(kpis.totalRevenue), icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-400/10' },
    { label: t.totalGpsKm, value: fmtNum(kpis.totalGpsKm), icon: MapPin, color: 'text-purple-600', bg: 'bg-purple-400/10' },
    { label: t.totalTrips, value: fmtNum(kpis.totalTrips), icon: Navigation, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
    { label: t.fleetKms, value: fmtNum(kpis.fleetKms), icon: Route, color: 'text-indigo-600', bg: 'bg-indigo-400/10' },
    { label: t.profitMargin, value: kpis.profitMargin.toFixed(1) + '%', icon: TrendingUp, color: kpis.profitMargin >= 0 ? 'text-green-600' : 'text-red-600', bg: kpis.profitMargin >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: t.alerts, value: kpis.alerts, icon: AlertTriangle, color: kpis.alerts > 0 ? 'text-amber-700' : 'text-slate-500', bg: kpis.alerts > 0 ? 'bg-amber-400/10' : 'bg-slate-100' },
  ];

  const hasData = petro.length > 0 || gpsOdo.length > 0 || gpsMov.length > 0 || htTrips.length > 0;

  return (
    <div className="space-y-6">
      {/* Header + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
        <div className="flex items-center gap-2">
          {hasData && <button onClick={handleExport} className="px-3 py-2 bg-emerald-500/20 text-emerald-600 rounded-lg text-sm hover:bg-emerald-500/30 flex items-center gap-1"><Download className="w-4 h-4" /> {t.exportExcel}</button>}
          <button onClick={() => router.push('/system/vehicle-analytics/upload')} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">
            {lang === 'ar' ? 'إدارة البيانات' : 'Manage Data'}
          </button>
          <button onClick={() => setShowClearConfirm(true)} className="px-3 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm hover:bg-red-500/30">
            {t.clearAll}
          </button>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md mx-4 shadow-sm" onClick={e => e.stopPropagation()}>
            <p className="text-slate-900 mb-4">{t.clearConfirm}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">{t.cancel}</button>
              <button onClick={handleClearAll} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">{t.confirm}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="sticky top-0 z-20 bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-500 pointer-events-none" />
          <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg pl-8 pr-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none min-w-[160px]">
            <option value="">{t.allVehicles}</option>
            {allVehicleIds.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allBranches}</option>
          {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allTypes}</option>
          {allTypes.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>{t.from}</span>
          <input type="month" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-2 py-1.5 border border-slate-300 focus:border-[#f37121] focus:outline-none" />
          <span>{t.to}</span>
          <input type="month" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-100 text-slate-800 text-sm rounded-lg px-2 py-1.5 border border-slate-300 focus:border-[#f37121] focus:outline-none" />
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
          <Filter className="w-12 h-12" />
          <p className="text-lg">{t.noData}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-slate-200 rounded-xl p-4 flex items-center gap-3`}>
                <c.icon className={`w-8 h-8 ${c.color} shrink-0`} />
                <div>
                  <p className="text-slate-500 text-xs">{c.label}</p>
                  <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Horizontal bar chart helper */}
            {[{ title: `${t.revenueByVehicle} (${t.top15})`, data: revenueByVehicle, color: 'bg-emerald-500', textColor: 'text-emerald-600' },
              { title: `${t.distanceRanking} (${t.top15})`, data: distanceRanking, color: 'bg-purple-500', textColor: 'text-purple-600' }].map(chart => (
              <div key={chart.title} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{chart.title}</h3>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {chart.data.map(([vid, val]) => (
                    <div key={vid} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 w-20 shrink-0 truncate">{vid}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div className={`${chart.color} h-full rounded-full`} style={{ width: `${(val / maxBar(chart.data)) * 100}%` }} />
                      </div>
                      <span className={`${chart.textColor} w-16 text-right`}>{fmtNum(val)}</span>
                    </div>
                  ))}
                  {chart.data.length === 0 && <p className="text-slate-500 text-sm text-center py-4">--</p>}
                </div>
              </div>
            ))}
            {/* Monthly Revenue */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.monthlyRevenue}</h3>
              <div className="flex items-end gap-1 h-[280px] px-2">
                {monthlyRevenue.map(([month, val]) => (
                  <div key={month} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[10px] text-emerald-600">{fmtNum(val)}</span>
                    <div className="w-full bg-emerald-500/80 rounded-t-md" style={{ height: `${(val / maxBar(monthlyRevenue)) * 85}%` }} />
                    <span className="text-[9px] text-slate-500 -rotate-45 origin-top-left whitespace-nowrap">{month}</span>
                  </div>
                ))}
                {monthlyRevenue.length === 0 && <p className="text-slate-500 text-sm text-center w-full self-center">--</p>}
              </div>
            </div>
            {/* Fleet by Category */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.fleetByCategory}</h3>
              <div className="space-y-3">
                {(() => { const total = fleetByCategory.reduce((s, c) => s + c[1], 0); const colors = ['bg-blue-500','bg-purple-500','bg-cyan-500','bg-amber-500','bg-rose-500','bg-emerald-500']; return fleetByCategory.map(([cat, count], i) => { const pct = total > 0 ? (count / total) * 100 : 0; return (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1"><span className="text-slate-700">{cat}</span><span className="text-slate-500">{count} ({pct.toFixed(0)}%)</span></div>
                    <div className="bg-slate-100 rounded-full h-3 overflow-hidden"><div className={`${colors[i % colors.length]} h-full rounded-full`} style={{ width: `${pct}%` }} /></div>
                  </div>); }); })()}
                {fleetByCategory.length === 0 && <p className="text-slate-500 text-sm text-center py-4">--</p>}
              </div>
            </div>
          </div>

          {/* Driver Performance Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.driverPerformance}</h3>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                <th className="text-left py-2 px-3">{t.driver}</th><th className="text-right py-2 px-3">{t.revenue}</th>
                <th className="text-right py-2 px-3">{t.trips}</th><th className="text-right py-2 px-3">{t.gpsKm}</th>
              </tr></thead>
              <tbody>{driverPerf.map(([driver, data]) => (
                <tr key={driver} className="border-b border-slate-200/70 hover:bg-slate-100">
                  <td className="py-2 px-3 text-slate-900">{driver}</td><td className="py-2 px-3 text-right text-emerald-600">{fmtNum(data.revenue)}</td>
                  <td className="py-2 px-3 text-right text-slate-700">{data.trips}</td><td className="py-2 px-3 text-right text-purple-600">{fmtNum(data.km)}</td>
                </tr>))}
                {driverPerf.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-4">--</td></tr>}
              </tbody>
            </table></div>
          </div>

          {/* Vehicle Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.title}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
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
                    <tr key={row.vehicleId} onClick={() => router.push(`/system/vehicle-analytics/vehicle/${row.vehicleId}`)} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer">
                      <td className="py-2 px-2 text-slate-900 font-medium">{row.vehicleId}</td>
                      <td className="py-2 px-2 text-slate-700">{row.model || '-'}</td>
                      <td className="py-2 px-2 text-slate-700">{row.branch || '-'}</td>
                      <td className="py-2 px-2 text-slate-700">{row.driver || '-'}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${String(row.status || '').toLowerCase() === 'active' ? 'bg-green-500/20 text-green-600' : 'bg-slate-200 text-slate-700'}`}>
                          {row.status || '-'}
                        </span>
                      </td>
                      <td className={`py-2 px-2 text-right ${row.fuelPct > 90 ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{row.fuelPct > 0 ? row.fuelPct.toFixed(0) + '%' : '-'}</td>
                      <td className="py-2 px-2 text-right text-purple-600">{row.gpsKm > 0 ? fmtNum(row.gpsKm) : '-'}</td>
                      <td className="py-2 px-2 text-right text-slate-700">{row.avgSpeed > 0 ? row.avgSpeed.toFixed(0) : '-'}</td>
                      <td className="py-2 px-2 text-right text-slate-700">{row.trips > 0 ? row.trips : '-'}</td>
                      <td className="py-2 px-2 text-right text-emerald-600">{row.revenue > 0 ? fmtNum(row.revenue) : '-'}</td>
                      <td className="py-2 px-2 text-right text-red-600">{row.expenses > 0 ? fmtNum(row.expenses) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Revenue per KM */}
          {revenuePerKm.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.revenuePerKm}</h3>
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {revenuePerKm.map((item, i) => (
                  <div key={item.vehicleId} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 w-6 text-right shrink-0">{i + 1}</span>
                    <span className="text-slate-700 w-24 shrink-0 truncate">{item.vehicleId}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: `${(item.ratio / (revenuePerKm[0]?.ratio || 1)) * 100}%` }} />
                    </div>
                    <span className="text-amber-700 w-20 text-right">{item.ratio.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Driver Leaderboard */}
          {driverPerf.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.driverLeaderboard}</h3>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                  <th className="text-left py-2 px-3">#</th><th className="text-left py-2 px-3">{t.driver}</th>
                  <th className="text-right py-2 px-3">{t.totalRev}</th><th className="text-right py-2 px-3">{t.trips}</th>
                  <th className="text-right py-2 px-3">{t.revenuePerTrip}</th><th className="text-right py-2 px-3">{t.totalKms}</th>
                </tr></thead>
                <tbody>{driverPerf.map(([driver, data], i) => (
                  <tr key={driver} className="border-b border-slate-200/70 hover:bg-slate-100">
                    <td className="py-2 px-3 text-slate-500">{i + 1}</td><td className="py-2 px-3 text-slate-900">{driver}</td>
                    <td className="py-2 px-3 text-right text-emerald-600">{fmtNum(data.revenue)}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{data.trips}</td>
                    <td className="py-2 px-3 text-right text-cyan-700">{data.trips > 0 ? fmtNum(data.revenue / data.trips) : '-'}</td>
                    <td className="py-2 px-3 text-right text-purple-600">{fmtNum(data.km)}</td>
                  </tr>))}
                </tbody>
              </table></div>
            </div>
          )}

          {/* Route Analysis */}
          {routeAnalysis.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.routeAnalysis}</h3>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                  <th className="text-left py-2 px-3">{t.route}</th><th className="text-right py-2 px-3">{t.tripCount}</th>
                  <th className="text-right py-2 px-3">{t.avgRevenue}</th><th className="text-right py-2 px-3">{t.avgDays}</th>
                  <th className="text-right py-2 px-3">{t.totalRev}</th>
                </tr></thead>
                <tbody>{routeAnalysis.map(([route, data]) => (
                  <tr key={route} className="border-b border-slate-200/70 hover:bg-slate-100">
                    <td className="py-2 px-3 text-slate-900 text-xs">{route}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{data.count}</td>
                    <td className="py-2 px-3 text-right text-cyan-700">{fmtNum(data.totalRev / data.count)}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{data.count > 0 ? (data.totalDays / data.count).toFixed(1) : '-'}</td>
                    <td className="py-2 px-3 text-right text-emerald-600">{fmtNum(data.totalRev)}</td>
                  </tr>))}
                </tbody>
              </table></div>
            </div>
          )}

          {/* Branch Comparison */}
          {branchComparison.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.branchComparison}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {branchComparison.map(b => (
                  <div key={b.branch} className="bg-slate-100 rounded-lg p-3 border border-slate-300/60">
                    <p className="text-slate-900 font-medium mb-2 truncate">{b.branch}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-slate-500">{t.vehicles}:</span> <span className="text-blue-600 font-bold">{b.vehicles}</span></div>
                      <div><span className="text-slate-500">{t.trips}:</span> <span className="text-cyan-700 font-bold">{b.trips}</span></div>
                      <div><span className="text-slate-500">{t.totalRev}:</span> <span className="text-emerald-600 font-bold">{fmtNum(b.revenue)}</span></div>
                      <div><span className="text-slate-500">{t.avgRevenue}:</span> <span className="text-amber-700 font-bold">{fmtNum(b.avgRev)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vehicle Utilization */}
          {vehicleUtilization.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.vehicleUtilization}</h3>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {vehicleUtilization.map(v => (
                  <div key={v.vehicleId} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-700 w-24 shrink-0 truncate">{v.vehicleId}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div className={`h-full rounded-full ${v.pct >= 75 ? 'bg-green-500' : v.pct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${v.pct}%` }} />
                    </div>
                    <span className={`w-14 text-right text-xs font-medium ${v.pct >= 75 ? 'text-green-600' : v.pct >= 40 ? 'text-amber-700' : 'text-red-600'}`}>{v.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Detected Routes */}
          {topDetectedRoutes.length > 0 && (
            <div className="bg-white border border-indigo-500/40 rounded-xl p-4">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                <Route className="w-5 h-5 text-indigo-600" /> {t.topRoutes}
              </h3>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">{t.route}</th>
                  <th className="text-right py-2 px-3">{t.tripCount}</th>
                  <th className="text-right py-2 px-3">{t.totalDistance}</th>
                  <th className="text-right py-2 px-3">{t.avgDuration}</th>
                </tr></thead>
                <tbody>
                  {topDetectedRoutes.map(([route, d], i) => (
                    <tr key={route} className="border-b border-slate-200/70 hover:bg-slate-100">
                      <td className="py-2 px-3 text-slate-500">{i + 1}</td>
                      <td className="py-2 px-3 text-indigo-700">{route}</td>
                      <td className="py-2 px-3 text-right text-cyan-700">{d.count}</td>
                      <td className="py-2 px-3 text-right text-purple-600">{fmtNum(d.totalDist)} km</td>
                      <td className="py-2 px-3 text-right text-slate-700">{fmtDur(d.totalDur / d.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {/* Compliance Overview */}
          {filtered.htTrips.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{t.complianceOverview}</h3>
              <div className="space-y-3">
                {[{ label: t.loaded, value: compliance.loaded }, { label: t.unloaded, value: compliance.unloaded },
                  { label: t.photoSent, value: compliance.photoSent }, { label: t.receiptDelivered, value: compliance.receiptDelivered }].map(item => {
                  const pct = (item.value / compliance.total) * 100;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1"><span className="text-slate-700">{item.label}</span><span className="text-slate-500">{item.value}/{compliance.total} ({pct.toFixed(0)}%)</span></div>
                      <div className="bg-slate-100 rounded-full h-3 overflow-hidden"><div className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
