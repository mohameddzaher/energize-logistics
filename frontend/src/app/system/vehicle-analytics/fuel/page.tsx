'use client';
import { useState, useEffect, useMemo } from 'react';
import vehicleDB from '@/lib/vehicleAnalyticsDB';
import { useLanguage } from '@/context/LanguageContext';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getVehicleAnalyticsFuelTranslations } from '@/lib/translations';
import { Fuel, Truck, Activity, AlertTriangle, Search, Filter, Droplets, Gauge, Building2 } from 'lucide-react';

interface PetroRow { vehicleId: string; branch?: string; vehicle?: string; model?: string; year?: string; fuel?: string; maxConsump?: number; currentRate?: number; status?: string; category?: string; consType?: string; [k: string]: any }

export default function FuelAnalysisPage() {
  const { lang } = useLanguage();
  const tx = getVehicleAnalyticsFuelTranslations(lang);
  const [data, setData] = useState<PetroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [fuelFilter, setFuelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [alertFilter, setAlertFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const rows = await vehicleDB.getAll<PetroRow>(vehicleDB.STORES.PETRO);
        setData(rows);
      } catch { /* empty */ }
      setLoading(false);
    })();
  }, []);

  const getAlertLevel = (row: PetroRow): 'critical' | 'warning' | 'normal' => {
    const max = Number(row.maxConsump) || 0;
    const cur = Number(row.currentRate) || 0;
    if (max <= 0) return 'normal';
    const pct = (cur / max) * 100;
    if (pct > 90) return 'critical';
    if (pct > 70) return 'warning';
    return 'normal';
  };

  const getConsumptionPct = (row: PetroRow): number => {
    const max = Number(row.maxConsump) || 0;
    const cur = Number(row.currentRate) || 0;
    if (max <= 0) return 0;
    return (cur / max) * 100;
  };

  const branches = useMemo(() => [...new Set(data.map(r => r.branch).filter(Boolean))].sort() as string[], [data]);
  const fuelTypes = useMemo(() => [...new Set(data.map(r => r.fuel).filter(Boolean))].sort() as string[], [data]);
  const statuses = useMemo(() => [...new Set(data.map(r => r.status).filter(Boolean))].sort() as string[], [data]);
  const categories = useMemo(() => [...new Set(data.map(r => r.category).filter(Boolean))].sort() as string[], [data]);

  const filtered = useMemo(() => {
    return data.filter(r => {
      if (branchFilter && String(r.branch || '').trim() !== branchFilter) return false;
      if (fuelFilter && String(r.fuel || '').trim() !== fuelFilter) return false;
      if (statusFilter && String(r.status || '').trim() !== statusFilter) return false;
      if (categoryFilter && String(r.category || '').trim() !== categoryFilter) return false;
      if (alertFilter && getAlertLevel(r) !== alertFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${String(r.vehicleId || '')} ${String(r.vehicle || '')} ${String(r.model || '')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, branchFilter, fuelFilter, statusFilter, categoryFilter, alertFilter, search]);

  const alertRows = useMemo(() => filtered.filter(r => getAlertLevel(r) !== 'normal').sort((a, b) => getConsumptionPct(b) - getConsumptionPct(a)), [filtered]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const active = filtered.filter(r => String(r.status || '').toLowerCase() === 'active').length;
    const dieselCount = filtered.filter(r => String(r.fuel || '').toLowerCase().includes('diesel') || String(r.fuel || '').includes('ديزل')).length;
    const gasolineCount = filtered.filter(r => String(r.fuel || '').toLowerCase().includes('gasoline') || String(r.fuel || '').toLowerCase().includes('benzin') || String(r.fuel || '').includes('بنزين')).length;
    const overLimit = filtered.filter(r => getConsumptionPct(r) > 90).length;
    const monthlyAccounts = filtered.filter(r => String(r.consType || '').toLowerCase().includes('month') || String(r.consType || '').includes('شهري')).length;
    const openedAccounts = filtered.filter(r => String(r.status || '').toLowerCase() === 'opened' || String(r.status || '').toLowerCase() === 'open').length;
    return { total, active, dieselCount, gasolineCount, overLimit, monthlyAccounts, openedAccounts };
  }, [filtered]);

  const exportColumns: ExportColumn[] = [
    { header: '#', key: 'num' }, { header: tx.branch, key: 'branch' }, { header: tx.vehicle, key: 'vehicle' },
    { header: tx.model, key: 'model' }, { header: tx.year, key: 'year' }, { header: tx.fuelType, key: 'fuel' },
    { header: tx.consumption, key: 'consumption' }, { header: tx.status, key: 'status' }, { header: tx.category, key: 'category' },
  ];
  const toExportRows = (rows: PetroRow[]) => rows.map((r, i) => ({
    num: r.num || i + 1, branch: r.branch || '', vehicle: r.vehicle || r.vehicleId, model: r.model || '',
    year: r.year || '', fuel: r.fuel || '', consumption: getConsumptionPct(r).toFixed(0) + '%', status: r.status || '', category: r.category || '',
  }));
  // ستّة فلاتر مجتمعة على هذه الشاشة، وكان الزرّ يصدّر المفلتَر وحده بلا ما يقول ذلك؛
  // مَن يريد سجلّ الوقود كاملًا كان عليه أن يمسح الفلاتر يدويًّا أوّلًا وهو لا يدري.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Fuel', rows: toExportRows(filtered), columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: 'Fuel', rows: toExportRows(data), columns: exportColumns }] },
  ];

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">{tx.loading}</div>;

  const kpiCards = [
    { label: tx.totalVehicles, value: kpis.total, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-400/10' },
    { label: tx.active, value: kpis.active, icon: Activity, color: 'text-green-600', bg: 'bg-green-400/10' },
    { label: tx.diesel, value: kpis.dieselCount, icon: Fuel, color: 'text-amber-700', bg: 'bg-amber-400/10' },
    { label: tx.gasoline, value: kpis.gasolineCount, icon: Droplets, color: 'text-cyan-700', bg: 'bg-cyan-400/10' },
    { label: tx.overLimit, value: kpis.overLimit, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-400/10' },
    { label: tx.monthlyAccounts, value: kpis.monthlyAccounts, icon: Gauge, color: 'text-purple-600', bg: 'bg-purple-400/10' },
    { label: tx.opened, value: kpis.openedAccounts, icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-400/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{tx.title}</h1>
        <ExportMenu fileName="fuel-analysis" lang={lang === 'ar' ? 'ar' : 'en'} label={tx.exportExcel} options={exportOptions} />
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-20 bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute top-2.5 start-2.5 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tx.search}
            className="w-full bg-slate-100 text-slate-800 text-sm rounded-lg ps-8 pe-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allBranches}</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={fuelFilter} onChange={e => setFuelFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allFuel}</option>
          {fuelTypes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allStatus}</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allCategories}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={alertFilter} onChange={e => setAlertFilter(e.target.value)} className="w-full sm:w-44 shrink-0 bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:border-[#f37121] focus:outline-none">
          <option value="">{tx.allAlerts}</option>
          <option value="critical">{tx.critical}</option>
          <option value="warning">{tx.warning}</option>
          <option value="normal">{tx.normal}</option>
        </select>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
          <Filter className="w-12 h-12" />
          <p className="text-lg">{tx.noData}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {kpiCards.map(c => (
              <div key={c.label} className={`${c.bg} border border-slate-200 rounded-xl p-4 flex flex-col items-center gap-1`}>
                <c.icon className={`w-6 h-6 ${c.color}`} />
                <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                <p className="text-slate-500 text-[10px] text-center">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Consumption Alerts */}
          {alertRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-700" /> {tx.alerts} ({alertRows.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                    <th className="text-start py-2 px-2">{tx.vehicle}</th>
                    <th className="text-start py-2 px-2">{tx.branch}</th>
                    <th className="text-start py-2 px-2">{tx.model}</th>
                    <th className="text-end py-2 px-2">{tx.currentRate}</th>
                    <th className="text-end py-2 px-2">{tx.maxConsump}</th>
                    <th className="text-end py-2 px-2">{tx.consumption}</th>
                    <th className="text-center py-2 px-2">{tx.alertLevel}</th>
                  </tr></thead>
                  <tbody>
                    {alertRows.map((r, i) => {
                      const pct = getConsumptionPct(r);
                      const level = getAlertLevel(r);
                      return (
                        <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                          <td className="py-2 px-2 text-slate-900 font-medium">{r.vehicle || r.vehicleId}</td>
                          <td className="py-2 px-2 text-slate-700">{r.branch || '-'}</td>
                          <td className="py-2 px-2 text-slate-700">{r.model || '-'}</td>
                          <td className="py-2 px-2 text-end text-slate-700">{Number(r.currentRate || 0).toFixed(1)}</td>
                          <td className="py-2 px-2 text-end text-slate-700">{Number(r.maxConsump || 0).toFixed(1)}</td>
                          <td className={`py-2 px-2 text-end font-bold ${level === 'critical' ? 'text-red-600' : 'text-amber-700'}`}>{pct.toFixed(0)}%</td>
                          <td className="py-2 px-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${level === 'critical' ? 'bg-red-500/20 text-red-600' : 'bg-amber-500/20 text-amber-700'}`}>
                              {level === 'critical' ? tx.critical : tx.warning}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Vehicle Fuel Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx.vehicleFuelTable} ({filtered.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-900 text-slate-300 border-b border-slate-200">
                  <th className="text-start py-2 px-2">{tx.num}</th>
                  <th className="text-start py-2 px-2">{tx.branch}</th>
                  <th className="text-start py-2 px-2">{tx.vehicle}</th>
                  <th className="text-start py-2 px-2">{tx.model}</th>
                  <th className="text-start py-2 px-2">{tx.year}</th>
                  <th className="text-start py-2 px-2">{tx.fuelType}</th>
                  <th className="text-end py-2 px-2">{tx.consumption}</th>
                  <th className="text-center py-2 px-2">{tx.status}</th>
                  <th className="text-start py-2 px-2">{tx.category}</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const pct = getConsumptionPct(r);
                    const level = getAlertLevel(r);
                    return (
                      <tr key={i} className="border-b border-slate-200/70 hover:bg-slate-100">
                        <td className="py-2 px-2 text-slate-800">{r.num || i + 1}</td>
                        <td className="py-2 px-2 text-slate-700">{r.branch || '-'}</td>
                        <td className="py-2 px-2 text-slate-900 font-medium">{r.vehicle || r.vehicleId}</td>
                        <td className="py-2 px-2 text-slate-700">{r.model || '-'}</td>
                        <td className="py-2 px-2 text-slate-700">{r.year || '-'}</td>
                        <td className="py-2 px-2 text-slate-700">{r.fuel || '-'}</td>
                        <td className="py-2 px-2 text-end">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div className={`h-full rounded-full ${level === 'critical' ? 'bg-red-500' : level === 'warning' ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className={`text-xs font-medium ${level === 'critical' ? 'text-red-600' : level === 'warning' ? 'text-amber-700' : 'text-green-600'}`}>{pct > 0 ? pct.toFixed(0) + '%' : '-'}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${String(r.status || '').toLowerCase() === 'active' ? 'bg-green-500/20 text-green-600' : 'bg-slate-200 text-slate-700'}`}>
                            {r.status || '-'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-slate-700">{r.category || '-'}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan={9} className="text-center text-slate-800 py-8">--</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
