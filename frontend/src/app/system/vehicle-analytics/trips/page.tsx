'use client';
import { useState, useEffect, useMemo } from 'react';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import { exportToExcel } from '@/utils/exportExcel';
import { Truck, DollarSign, TrendingUp, Calendar, Users, Building2, Search, Filter, ArrowRight, Receipt, Download } from 'lucide-react';

const T = (lang: string) => lang === 'ar' ? {
  title: 'الرحلات', totalTrips: 'إجمالي الرحلات', totalRevenue: 'إجمالي الإيرادات',
  totalExpenses: 'إجمالي المصروفات', profit: 'الربح', avgRevenue: 'متوسط الإيراد/رحلة',
  avgDays: 'متوسط الأيام/رحلة', activeVehicles: 'المركبات النشطة', topClient: 'أعلى عميل',
  revenueByBranch: 'الإيرادات حسب الفرع', revenueByClient: 'الإيرادات حسب العميل (أعلى 10)',
  tripsTable: 'جدول الرحلات', month: 'الشهر', vehicle: 'المركبة', driver: 'السائق',
  from: 'من', to: 'إلى', days: 'الأيام', revenue: 'الإيرادات', expenses: 'المصروفات',
  client: 'العميل', status: 'الحالة', branch: 'الفرع', vehicleType: 'نوع المركبة',
  allMonths: 'كل الأشهر', allBranches: 'كل الفروع', allTypes: 'كل الأنواع', allClients: 'كل العملاء',
  search: 'بحث...', noData: 'لا توجد بيانات رحلات', loading: 'جاري التحميل...',
  route: 'المسار', serial: 'مسلسل', rental: 'الإيجار', selling: 'البيع',
} : {
  title: 'Trips', totalTrips: 'Total Trips', totalRevenue: 'Total Revenue',
  totalExpenses: 'Total Expenses', profit: 'Profit', avgRevenue: 'Avg Revenue/Trip',
  avgDays: 'Avg Days/Trip', activeVehicles: 'Active Vehicles', topClient: 'Top Client Revenue',
  revenueByBranch: 'Revenue by Branch', revenueByClient: 'Revenue by Client (Top 10)',
  tripsTable: 'Trips Table', month: 'Month', vehicle: 'Vehicle', driver: 'Driver',
  from: 'From', to: 'To', days: 'Days', revenue: 'Revenue', expenses: 'Expenses',
  client: 'Client', status: 'Status', branch: 'Branch', vehicleType: 'Vehicle Type',
  allMonths: 'All Months', allBranches: 'All Branches', allTypes: 'All Types', allClients: 'All Clients',
  search: 'Search...', noData: 'No trip data uploaded yet', loading: 'Loading...',
  route: 'Route', serial: 'Serial', rental: 'Rental', selling: 'Selling',
};

interface HtTrip { vehicleId: string; month?: string; serial?: string; vehicleType?: string; vehicleNumber?: string; driver1?: string; tripStart?: string; tripEnd?: string; days?: number | string; branch?: string; loadingPlace?: string; unloadingPlace?: string; rentalPaymentType?: string; fullRental?: number | string; revenue?: number | string; selling?: number | string; actualDriverExpense?: number | string; [k: string]: any }

export default function TripsPage() {
  const { lang } = useLanguage();
  const t = T(lang);
  const [data, setData] = useState<HtTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const rows = await vehicleDB.getAll<HtTrip>(vehicleDB.STORES.HT_TRIPS);
        setData(rows);
      } catch { /* empty */ }
      setLoading(false);
    })();
  }, []);

  const parseNum = (v: any): number => { const n = parseFloat(String(v || '0').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);
  const fmtCurrency = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const months = useMemo(() => [...new Set(data.map(r => r.month).filter(Boolean))].sort() as string[], [data]);
  const branches = useMemo(() => [...new Set(data.map(r => r.branch).filter(Boolean))].sort() as string[], [data]);
  const types = useMemo(() => [...new Set(data.map(r => r.vehicleType).filter(Boolean))].sort() as string[], [data]);
  const clients = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => { const c = String(r.rentalPaymentType || '').trim(); if (c) set.add(c); });
    return [...set].sort();
  }, [data]);

  const filtered = useMemo(() => {
    return data.filter(r => {
      if (monthFilter && String(r.month || '').trim() !== monthFilter) return false;
      if (branchFilter && String(r.branch || '').trim() !== branchFilter) return false;
      if (typeFilter && String(r.vehicleType || '').trim() !== typeFilter) return false;
      if (clientFilter && String(r.rentalPaymentType || '').trim() !== clientFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.vehicleId} ${r.vehicleNumber || ''} ${r.driver1 || ''} ${r.loadingPlace || ''} ${r.unloadingPlace || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, monthFilter, branchFilter, typeFilter, clientFilter, search]);

  const kpis = useMemo(() => {
    const totalTrips = filtered.length;
    const totalRevenue = filtered.reduce((s, r) => s + parseNum(r.revenue), 0);
    const totalExpenses = filtered.reduce((s, r) => {
      const te = parseNum((r as any).totalExpenses);
      if (te > 0) return s + te;
      return s + parseNum(r.actualDriverExpense) + parseNum((r as any).fuelCost) +
             parseNum((r as any).puncture) + parseNum((r as any).spareParts) + parseNum((r as any).washing) +
             parseNum((r as any).salesCommission) + parseNum((r as any).brokerCommission) +
             parseNum((r as any).fridayBonus) + parseNum((r as any).bonus);
    }, 0);
    const profit = totalRevenue - totalExpenses;
    const avgRevenue = totalTrips > 0 ? totalRevenue / totalTrips : 0;
    const totalDays = filtered.reduce((s, r) => s + parseNum(r.days), 0);
    const avgDays = totalTrips > 0 ? totalDays / totalTrips : 0;
    const activeVehicles = new Set(filtered.map(r => r.vehicleId)).size;
    // Top client
    const clientMap: Record<string, number> = {};
    filtered.forEach(r => { const c = String(r.rentalPaymentType || 'Other').trim(); clientMap[c] = (clientMap[c] || 0) + parseNum(r.revenue); });
    const topClientEntry = Object.entries(clientMap).sort((a, b) => b[1] - a[1])[0];
    const topClient = topClientEntry ? `${topClientEntry[0]}: ${fmtNum(topClientEntry[1])}` : '-';
    return { totalTrips, totalRevenue, totalExpenses, profit, avgRevenue, avgDays, activeVehicles, topClient };
  }, [filtered]);

  // Revenue by branch
  const revByBranch = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => { const b = r.branch || 'Other'; map[b] = (map[b] || 0) + parseNum(r.revenue); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // Revenue by client top 10
  const revByClient = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => { const c = String(r.rentalPaymentType || 'Other').trim(); map[c] = (map[c] || 0) + parseNum(r.revenue); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  const maxBranchRev = useMemo(() => Math.max(...revByBranch.map(d => d[1]), 1), [revByBranch]);
  const maxClientRev = useMemo(() => (revByClient.length > 0 ? revByClient[0][1] : 1), [revByClient]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">{t.loading}</div>;

  const hasData = data.length > 0;
  const kpiCards = [
    { label: t.totalTrips, value: fmtNum(kpis.totalTrips), icon: Truck, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: t.totalRevenue, value: fmtNum(kpis.totalRevenue), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: t.totalExpenses, value: fmtNum(kpis.totalExpenses), icon: Receipt, color: 'text-red-400', bg: 'bg-red-400/10' },
    { label: t.profit, value: fmtNum(kpis.profit), icon: TrendingUp, color: kpis.profit >= 0 ? 'text-green-400' : 'text-red-400', bg: kpis.profit >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
    { label: t.avgRevenue, value: fmtNum(kpis.avgRevenue), icon: DollarSign, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: t.avgDays, value: kpis.avgDays.toFixed(1), icon: Calendar, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { label: t.activeVehicles, value: kpis.activeVehicles, icon: Truck, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: t.topClient, value: kpis.topClient, icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">{t.title}</h1>
        {filtered.length > 0 && (
          <button type="button" onClick={() => exportToExcel(filtered.map(r => ({
            month: r.month || '', vehicle: r.vehicleNumber || r.vehicleId, driver: r.driver1 || '',
            from: r.loadingPlace || '', to: r.unloadingPlace || '', days: parseNum(r.days),
            revenue: parseNum(r.revenue), expenses: parseNum(r.actualDriverExpense),
            client: r.rentalPaymentType || '', branch: r.branch || '',
          })), [
            { header: t.month, key: 'month' }, { header: t.vehicle, key: 'vehicle' }, { header: t.driver, key: 'driver' },
            { header: t.from, key: 'from' }, { header: t.to, key: 'to' }, { header: t.days, key: 'days' },
            { header: t.revenue, key: 'revenue' }, { header: t.expenses, key: 'expenses' },
            { header: t.client, key: 'client' }, { header: t.branch, key: 'branch' },
          ], 'trips-data', 'Trips')} className="px-3 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm hover:bg-emerald-500/30 flex items-center gap-1">
            <Download className="w-4 h-4" /> {lang === 'ar' ? 'تصدير Excel' : 'Export Excel'}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-20 bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-gray-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t.search}
            className="bg-gray-700 text-gray-200 text-sm rounded-lg pl-8 pr-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none min-w-[200px]" />
        </div>
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allMonths}</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allBranches}</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allTypes}</option>
          {types.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="bg-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-[#f37121] focus:outline-none">
          <option value="">{t.allClients}</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-gray-700 rounded-xl p-4 flex items-center gap-3`}>
                <c.icon className={`w-7 h-7 ${c.color} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-gray-400 text-xs">{c.label}</p>
                  <p className={`text-lg font-bold ${c.color} truncate`}>{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue by Branch - bar chart */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" /> {t.revenueByBranch}
              </h3>
              <div className="flex items-end gap-2 h-[280px] px-2">
                {revByBranch.map(([branch, val]) => (
                  <div key={branch} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[10px] text-emerald-400">{fmtNum(val)}</span>
                    <div className="w-full bg-emerald-500/80 rounded-t-md" style={{ height: `${(val / maxBranchRev) * 85}%` }} />
                    <span className="text-[9px] text-gray-500 -rotate-45 origin-top-left whitespace-nowrap truncate max-w-[60px]">{branch}</span>
                  </div>
                ))}
                {revByBranch.length === 0 && <p className="text-gray-500 text-sm text-center w-full self-center">--</p>}
              </div>
            </div>

            {/* Revenue by Client - horizontal bars */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" /> {t.revenueByClient}
              </h3>
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {revByClient.map(([client, val], i) => (
                  <div key={client} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 w-5 text-right shrink-0">{i + 1}</span>
                    <span className="text-gray-300 w-28 shrink-0 truncate">{client}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden">
                      <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${(val / maxClientRev) * 100}%` }} />
                    </div>
                    <span className="text-cyan-400 w-16 text-right">{fmtNum(val)}</span>
                  </div>
                ))}
                {revByClient.length === 0 && <p className="text-gray-500 text-sm text-center py-4">--</p>}
              </div>
            </div>
          </div>

          {/* Trips Table */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-white font-semibold mb-3">{t.tripsTable} ({filtered.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-2">{t.month}</th>
                  <th className="text-left py-2 px-2">{t.vehicle}</th>
                  <th className="text-left py-2 px-2">{t.driver}</th>
                  <th className="text-left py-2 px-2">{t.route}</th>
                  <th className="text-right py-2 px-2">{t.days}</th>
                  <th className="text-right py-2 px-2">{t.revenue}</th>
                  <th className="text-right py-2 px-2">{t.expenses}</th>
                  <th className="text-left py-2 px-2">{t.client}</th>
                  <th className="text-left py-2 px-2">{t.branch}</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const rev = parseNum(r.revenue);
                    const exp = parseNum(r.actualDriverExpense);
                    return (
                      <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="py-2 px-2 text-gray-300 text-xs">{r.month || '-'}</td>
                        <td className="py-2 px-2 text-white font-medium">{r.vehicleNumber || r.vehicleId}</td>
                        <td className="py-2 px-2 text-gray-300">{r.driver1 || '-'}</td>
                        <td className="py-2 px-2 text-gray-400 text-xs">
                          <span className="flex items-center gap-1">
                            {r.loadingPlace || '?'} <ArrowRight className="w-3 h-3 text-gray-600 shrink-0" /> {r.unloadingPlace || '?'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-300">{parseNum(r.days) > 0 ? parseNum(r.days).toFixed(0) : '-'}</td>
                        <td className="py-2 px-2 text-right text-emerald-400">{rev > 0 ? fmtCurrency(rev) : '-'}</td>
                        <td className="py-2 px-2 text-right text-red-400">{exp > 0 ? fmtCurrency(exp) : '-'}</td>
                        <td className="py-2 px-2 text-gray-300 text-xs max-w-[120px] truncate">{r.rentalPaymentType || '-'}</td>
                        <td className="py-2 px-2 text-gray-300 text-xs">{r.branch || '-'}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan={9} className="text-center text-gray-500 py-8">--</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
