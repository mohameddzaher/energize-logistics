'use client';
// Reports — the section's answer to "give me everything, for any period".
// Two reports, one period picker:
//   • All vehicles — one row per truck (identity, distance, engine hours, fuel,
//     maintenance state, open alerts, work done) with a summary on top.
//   • Single vehicle — the full dossier for one truck: identity, distance and
//     its daily series, trips, CAN fuel, service plan, services, repairs, alerts.
// Both export to Excel as a multi-sheet workbook. Everything except fuel and
// trips is instant (mirrored snapshots); those two are Location Solutions
// reports, ~2s per truck, so they are fetched per vehicle and never fanned out.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  FileBarChart, RefreshCw, Search, Droplet, Loader2, Truck, ChevronUp, ChevronDown,
  ExternalLink, AlertTriangle, Wrench, Route, Gauge,
} from 'lucide-react';
import { Spinner, PageHeader, StatCard, Tabs } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import VehiclePicker from '@/components/ls2/VehiclePicker';
import ExportMenu, { type ExportColumn, type ExportSheet } from '@/components/ls2/ExportMenu';
import {
  ls2Text, isLs2Staff, statusStyle, maintStyle, severityStyle, alertTypeLabel, alertMessage,
  repairCategoryLabel, fmtNum, fmtKm, fmtDate, fmtDateTime, fmtDuration, thisMonthToDate,
  type Lang, type DateRange, type Vehicle, type VehicleFuel, type FleetReport, type FleetReportRow, type VehicleReport,
} from '@/lib/ls2';

type SortKey = 'plate' | 'driver' | 'km' | 'avgKmPerDay' | 'engineHoursPeriod' | 'odometerKm' | 'kmPerL' | 'kmToService' | 'alertsTotal';
type MaintFilter = 'all' | 'due' | 'overdue';

// Fuel loaded on demand, merged onto the report rows (null stays null — a truck
// without CAN fuel must never read as 0 litres).
type FuelMap = Record<number, VehicleFuel | null>;

// Excel transform: keep a missing number blank rather than printing "null"/0.
const num = (v: unknown) => (v == null ? '' : v);

export default function Ls2ReportsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const ar = lang === 'ar';

  const [tab, setTab] = useState<'fleet' | 'vehicle'>('fleet');
  const [range, setRange] = useState<DateRange>(thisMonthToDate());

  // ---- Fleet report ---------------------------------------------------------
  const [report, setReport] = useState<FleetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [maintFilter, setMaintFilter] = useState<MaintFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'km', dir: 'desc' });
  const [fuel, setFuel] = useState<FuelMap>({});
  const [fuelProgress, setFuelProgress] = useState<{ done: number; total: number } | null>(null);

  const loadFleet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<FleetReport>(`/api/ls2/reports/fleet?from=${range.from}&to=${range.to}`);
      setReport(res);
    } catch { /* keep the previous report on screen */ }
    setLoading(false);
  }, [range.from, range.to]);
  useEffect(() => { loadFleet(); }, [loadFleet]);
  // A new period invalidates every fuel figure already loaded.
  useEffect(() => { setFuel({}); }, [range.from, range.to]);

  // Merge the on-demand fuel onto the rows, then filter and sort.
  const rows = useMemo<FleetReportRow[]>(() => {
    let list = (report?.items || []).map((r) => {
      const f = fuel[r.unitId];
      if (f === undefined) return r;
      return { ...r, fuelL: f?.fuelL ?? null, kmPerL: f?.efficiencyKmL ?? null };
    });
    if (maintFilter !== 'all') list = list.filter((r) => r.maintenanceStatus === maintFilter);
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter((r) => `${r.plate} ${r.driver} ${r.name} ${r.brand} ${r.vin} ${r.unitId}`.toLowerCase().includes(term));
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      if (typeof va === 'string' || typeof vb === 'string') return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
      // Nulls always sink, whichever way the column is sorted.
      if (va == null) return 1;
      if (vb == null) return -1;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [report, fuel, q, maintFilter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'plate' || key === 'driver' ? 'asc' : 'desc' }));

  // Fuel is one Location Solutions report per truck — sequential, with progress.
  const loadAllFuel = async () => {
    const list = rows;
    setFuelProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      try {
        const f = await api.get<VehicleFuel>(`/api/ls2/vehicles/${list[i].unitId}/fuel?from=${range.from}&to=${range.to}`);
        setFuel((p) => ({ ...p, [list[i].unitId]: f }));
      } catch { setFuel((p) => ({ ...p, [list[i].unitId]: null })); }
      setFuelProgress({ done: i + 1, total: list.length });
    }
    setFuelProgress(null);
  };

  // ---- Single-vehicle report ------------------------------------------------
  const [fleetList, setFleetList] = useState<Vehicle[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [vr, setVr] = useState<VehicleReport | null>(null);
  const [vrLoading, setVrLoading] = useState(false);

  // The picker needs the full vehicle list; only fetch it when the tab is opened.
  useEffect(() => {
    if (tab !== 'vehicle' || fleetList.length) return;
    api.get<{ items: Vehicle[] }>('/api/ls2/vehicles').then((r) => setFleetList(r.items || [])).catch(() => { /* picker stays empty */ });
  }, [tab, fleetList.length]);

  const loadVehicle = useCallback(async (id: number) => {
    setVrLoading(true);
    try {
      const res = await api.get<VehicleReport>(`/api/ls2/reports/vehicle/${id}?from=${range.from}&to=${range.to}`);
      setVr(res);
    } catch { setVr(null); }
    setVrLoading(false);
  }, [range.from, range.to]);
  useEffect(() => { if (unitId != null) loadVehicle(unitId); }, [unitId, loadVehicle]);

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !report) return <Spinner />;

  const s = report?.summary;
  const periodLabel = `${range.from} → ${range.to}`;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileBarChart className="w-5 h-5" />} title={t.reports} subtitle={t.reportsSubtitle}>
        {tab === 'fleet'
          ? <ExportMenu fileName={`ls2-fleet-report-${range.from}_${range.to}`} lang={lang as Lang} options={fleetExportOptions(ar, t, report, rows, periodLabel)} />
          : <ExportMenu fileName={`ls2-vehicle-report-${vr?.vehicle.plate || ''}-${range.from}_${range.to}`} lang={lang as Lang} options={vehicleExportOptions(ar, t, vr, periodLabel)} />}
        <button type="button" onClick={() => (tab === 'fleet' ? loadFleet() : unitId != null && loadVehicle(unitId))}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {t.refresh}
        </button>
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={t.from} labelTo={t.to} />

      <Tabs
        tabs={[{ key: 'fleet', label: t.fleetReport, badge: report?.items.length }, { key: 'vehicle', label: t.vehicleReport }]}
        active={tab} onChange={(k) => setTab(k as 'fleet' | 'vehicle')}
      />

      {tab === 'fleet' && (
        <>
          {s && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                <StatCard label={t.totalVehicles} value={fmtNum(s.vehicles)} />
                <StatCard label={t.totalDistance} value={<>{fmtNum(s.totalKm)} <span className="text-sm font-normal text-slate-400">{t.km}</span></>} accent="text-[#f37121]" />
                <StatCard label={t.avgPerVehicle} value={<>{fmtNum(s.avgKm)} <span className="text-sm font-normal text-slate-400">{t.km}</span></>} />
                <StatCard label={t.vehiclesMoved} value={`${fmtNum(s.movedVehicles)} / ${fmtNum(s.vehicles)}`} />
                <StatCard label={t.engineHours} value={s.totalEngineHours == null ? '—' : fmtNum(s.totalEngineHours)} />
                <StatCard label={t.serviceOverdue} value={fmtNum(s.overdueVehicles)} accent={s.overdueVehicles ? 'text-red-600' : undefined} />
                <StatCard label={t.serviceDue} value={fmtNum(s.dueVehicles)} accent={s.dueVehicles ? 'text-amber-600' : undefined} />
                <StatCard label={t.criticalAlerts} value={fmtNum(s.criticalAlerts)} accent={s.criticalAlerts ? 'text-red-600' : undefined} />
                <StatCard label={t.openAlerts} value={fmtNum(s.openAlerts)} />
                <StatCard label={t.servicesDone} value={fmtNum(s.services)} />
                <StatCard label={t.repairsDone} value={fmtNum(s.repairs)} />
                <StatCard label={t.idleVehicles} value={fmtNum(s.idleVehicles)} />
              </div>
              {s.partialVehicles > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {fmtNum(s.partialVehicles)} {t.partialNote}
                </p>
              )}
            </>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={ar ? 'بحث لوحة / سائق / ماركة / VIN…' : 'Search plate / driver / brand / VIN…'}
                className="w-full ps-10 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
            </div>
            {(['all', 'due', 'overdue'] as MaintFilter[]).map((f) => (
              <button key={f} type="button" onClick={() => setMaintFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${maintFilter === f ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
                {f === 'all' ? t.all : f === 'due' ? t.serviceDue : t.serviceOverdue}
              </button>
            ))}
            <button type="button" onClick={loadAllFuel} disabled={!!fuelProgress || !rows.length}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-medium disabled:opacity-60">
              {fuelProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />}
              {fuelProgress ? `${fuelProgress.done}/${fuelProgress.total}` : t.loadFuel}
            </button>
            <span className="w-full text-[11px] text-slate-400">{t.fuelHeavyHint}</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <Th label={t.plate} sortKey="plate" sort={sort} onSort={toggleSort} />
                    <Th label={t.driver} sortKey="driver" sort={sort} onSort={toggleSort} />
                    <th className="text-start font-semibold px-4 py-3">{t.brand}</th>
                    <Th label={t.kmInPeriod} sortKey="km" sort={sort} onSort={toggleSort} align="end" accent="text-[#f9a06b]" />
                    <Th label={t.perDay} sortKey="avgKmPerDay" sort={sort} onSort={toggleSort} align="end" />
                    <Th label={t.engineHours} sortKey="engineHoursPeriod" sort={sort} onSort={toggleSort} align="end" />
                    <Th label={t.odometer} sortKey="odometerKm" sort={sort} onSort={toggleSort} align="end" />
                    <th className="text-end font-semibold px-4 py-3">{t.fuelUsed}</th>
                    <Th label={t.efficiency} sortKey="kmPerL" sort={sort} onSort={toggleSort} align="end" />
                    <Th label={t.kmToService} sortKey="kmToService" sort={sort} onSort={toggleSort} align="end" />
                    <Th label={t.alerts} sortKey="alertsTotal" sort={sort} onSort={toggleSort} align="center" />
                    <th className="text-center font-semibold px-4 py-3">{t.workInPeriod}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ms = maintStyle(r.maintenanceStatus);
                    const st = statusStyle(r.status);
                    const over = (r.kmToService ?? 0) < 0;
                    return (
                      <tr key={r.unitId} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button type="button" onClick={() => router.push(`/system/ls2/${r.unitId}`)} className="font-medium text-slate-800 hover:text-[#f37121]">
                            {r.plate}
                          </button>
                          <span className={`ms-2 inline-block w-1.5 h-1.5 rounded-full align-middle ${st.dot}`} title={ar ? st.ar : st.en} />
                          {r.clipped && <span className="ms-1 text-[10px] text-amber-600" title={t.partialData}>*</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{r.driver || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{r.brand || '—'}{r.modelYear ? ` · ${r.modelYear}` : ''}</td>
                        <td className="px-4 py-3 text-end tabular-nums font-semibold text-slate-800">{fmtNum(Math.round(r.km))}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-slate-600">{fmtNum(Math.round(r.avgKmPerDay))}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-slate-600">{r.engineHoursPeriod == null ? '—' : fmtNum(Math.round(r.engineHoursPeriod))}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-slate-600">{fmtKm(r.odometerKm)}</td>
                        <td className="px-4 py-3 text-end tabular-nums text-slate-600">
                          {fuel[r.unitId] === undefined ? <span className="text-slate-300">—</span>
                            : r.fuelL == null ? <span className="text-slate-400 text-xs">{t.notLoaded}</span>
                              : <>{fmtNum(Math.round(r.fuelL))} <span className="text-[10px] text-slate-400">{t.litres}</span></>}
                        </td>
                        <td className="px-4 py-3 text-end tabular-nums text-slate-700">
                          {fuel[r.unitId] === undefined ? <span className="text-slate-300">—</span>
                            : r.kmPerL == null ? <span className="text-slate-400 text-xs">{t.notLoaded}</span>
                              : <span className="font-semibold">{r.kmPerL}</span>}
                        </td>
                        <td className="px-4 py-3 text-end">
                          {r.kmToService == null ? <span className="text-slate-300">—</span> : (
                            <span className={`tabular-nums font-semibold ${over ? 'text-red-600' : r.maintenanceStatus === 'due' ? 'text-amber-600' : 'text-slate-700'}`}>
                              {over ? `−${fmtNum(Math.abs(r.kmToService))}` : fmtNum(r.kmToService)}
                            </span>
                          )}
                          <span className={`ms-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${ms.bg} ${ms.text}`}>{ar ? ms.ar : ms.en}</span>
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {r.alertsTotal === 0 ? <span className="text-slate-300">—</span> : (
                            <span className="inline-flex items-center gap-1 text-xs">
                              {r.alertsCritical > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold tabular-nums">{r.alertsCritical}</span>}
                              {r.alertsWarning > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold tabular-nums">{r.alertsWarning}</span>}
                              {r.alertsInfo > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 tabular-nums">{r.alertsInfo}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-slate-600 whitespace-nowrap">
                          {r.servicesInPeriod === 0 && r.repairsInPeriod === 0 ? <span className="text-slate-300">—</span> : (
                            <>
                              {r.servicesInPeriod > 0 && <span className="inline-flex items-center gap-1 me-2"><Wrench className="w-3 h-3 text-emerald-600" />{r.servicesInPeriod}</span>}
                              {r.repairsInPeriod > 0 && <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-600" />{r.repairsInPeriod}</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={12} className="text-center text-slate-500 py-10">{t.noData}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'vehicle' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3 shadow-sm">
            <button type="button" onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium">
              <Truck className="w-4 h-4" /> {vr ? t.changeVehicle : t.pickVehicle}
            </button>
            {vr && (
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{vr.vehicle.plate}</p>
                <p className="text-[11px] text-slate-500 truncate">{vr.vehicle.driver || '—'} · {periodLabel}</p>
              </div>
            )}
            {vr && (
              <button type="button" onClick={() => router.push(`/system/ls2/${vr.vehicle.unitId}`)}
                className="ms-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-xs font-medium">
                <ExternalLink className="w-3.5 h-3.5 text-[#f37121]" /> {ar ? 'ملف المركبة الكامل' : 'Full vehicle profile'}
              </button>
            )}
          </div>

          {!unitId && <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-8 text-center">{t.pickVehicleHint}</p>}
          {vrLoading && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#f37121] mx-auto" />
              <p className="text-sm text-slate-600 mt-3">{t.buildingReport}</p>
              <p className="text-xs text-slate-400 mt-1">{t.heavyVehicleHint}</p>
            </div>
          )}
          {!vrLoading && vr && <VehicleReportView vr={vr} t={t} ar={ar} lang={lang as Lang} />}
        </div>
      )}

      {pickerOpen && (
        <VehiclePicker
          vehicles={fleetList} lang={lang as Lang} isRTL={isRTL}
          onPick={(v) => { setUnitId(v.unitId); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ---- Sortable table header cell --------------------------------------------
function Th({ label, sortKey, sort, onSort, align = 'start', accent }: {
  label: string; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void; align?: 'start' | 'end' | 'center'; accent?: string;
}) {
  const active = sort.key === sortKey;
  const alignCls = align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start';
  return (
    <th className={`${alignCls} font-semibold px-4 py-3 ${accent || ''}`}>
      <button type="button" onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1 hover:text-white ${active ? 'text-white' : ''}`}>
        {label}
        {active && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

// ---- Single-vehicle report body --------------------------------------------
function VehicleReportView({ vr, t, ar, lang }: { vr: VehicleReport; t: ReturnType<typeof ls2Text>; ar: boolean; lang: Lang }) {
  const p = vr.vehicle.profile;
  const d = vr.distance;
  const maxDaily = Math.max(1, ...d.daily.map((x) => x.km));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label={t.distanceTraveled} value={<>{fmtNum(Math.round(d.km))} <span className="text-sm font-normal text-slate-400">{t.km}</span></>} accent="text-[#f37121]" />
        <StatCard label={t.perDay} value={fmtNum(Math.round(d.avgKmPerDay))} />
        <StatCard label={t.activeDays} value={`${fmtNum(d.activeDays)} / ${fmtNum(vr.days)}`} />
        <StatCard label={t.engineHours} value={d.engineHours == null ? '—' : fmtNum(Math.round(d.engineHours))} />
        <StatCard label={t.odometer} value={fmtKm(vr.vehicle.odometerKm)} />
        <StatCard label={t.openAlerts} value={fmtNum(vr.totals.openAlerts)} accent={vr.totals.criticalAlerts ? 'text-red-600' : undefined} />
      </div>

      {d.clipped && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{t.partialData}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Identity */}
        <Card title={t.identity} icon={<Truck className="w-4 h-4 text-[#f37121]" />}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <Info label={t.plate} value={vr.vehicle.plate} />
            <Info label={t.driver} value={vr.vehicle.driver} />
            <Info label={t.brand} value={p?.brand} />
            <Info label={t.modelYear} value={p?.modelYear} />
            <Info label={t.vehicleType} value={p?.vehicleType} />
            <Info label={t.vin} value={p?.vin} mono />
            <Info label={t.simIccid} value={p?.simIccid} mono />
            <Info label={t.installDate} value={p?.installDate} />
            <Info label={t.lsUnitId} value={p?.lsUnitId} mono />
            <Info label={t.tireBrand} value={vr.vehicle.tireBrand} />
            {(p?.extra || []).map((e) => <Info key={e.label} label={e.label} value={e.value} />)}
          </dl>
        </Card>

        {/* Trips & fuel — the two live Location Solutions reports */}
        <Card title={`${t.activity} · ${t.fuelSection}`} icon={<Route className="w-4 h-4 text-[#f37121]" />}>
          {vr.trips ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Mini label={t.tripCount} value={fmtNum(vr.trips.summary.tripCount)} />
              <Mini label={t.stopCount} value={fmtNum(vr.trips.summary.stopCount)} />
              <Mini label={t.driveTime} value={fmtDuration(vr.trips.summary.totalDriveSec, lang)} />
              <Mini label={t.maxSpeed} value={`${fmtNum(vr.trips.summary.maxSpeed)} km/h`} />
            </div>
          ) : <p className="text-xs text-slate-400">{t.noData}</p>}
          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {vr.fuel ? (
              <>
                <Mini label={t.fuelUsed} value={vr.fuel.fuelL == null ? t.notLoaded : `${fmtNum(Math.round(vr.fuel.fuelL))} ${t.litres}`} />
                <Mini label={t.efficiency} value={vr.fuel.efficiencyKmL == null ? t.notLoaded : `${vr.fuel.efficiencyKmL} ${t.kmPerL}`} />
                <Mini label={t.engineOn} value={fmtDuration(vr.fuel.engineOnSec, lang)} />
                <Mini label={t.distance} value={vr.fuel.distanceKm == null ? t.notLoaded : `${fmtNum(Math.round(vr.fuel.distanceKm))} ${t.km}`} />
              </>
            ) : <p className="col-span-full text-xs text-slate-400">{t.noFuelData}</p>}
          </div>
        </Card>
      </div>

      {/* Daily distance */}
      {d.daily.length > 0 && (
        <Card title={t.dailyDistance} icon={<Gauge className="w-4 h-4 text-[#f37121]" />}>
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {d.daily.map((x) => (
              <div key={x.date} className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full"
                title={`${x.date} · ${fmtNum(Math.round(x.km))} ${t.km}${x.spanDays > 1 ? ` — ${t.dataGap}` : ''}`}>
                <div className={`w-full rounded-t ${x.spanDays > 1 ? 'bg-amber-300' : 'bg-[#f37121]'}`} style={{ height: `${Math.max(2, (x.km / maxDaily) * 100)}%` }} />
                <span className="text-[9px] text-slate-400 mt-1 whitespace-nowrap">{x.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Service plan */}
      <Card title={t.servicePlan} icon={<Wrench className="w-4 h-4 text-[#f37121]" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(vr.maintenance.intervals || []).map((iv) => {
            const st = maintStyle(iv.statusLevel);
            const rem = iv.remainingKm;
            return (
              <div key={iv.id} className="border border-slate-200 rounded-lg p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{iv.name}</p>
                  <p className="text-[11px] text-slate-500">{t.lastService}: {fmtDate(iv.lastServiceAt, lang)}{iv.lastServiceKm != null && ` · ${fmtKm(iv.lastServiceKm)}`}</p>
                </div>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${st.bg} ${st.text}`}>
                  {rem == null ? '—' : rem < 0 ? `−${fmtNum(Math.abs(rem))} ${t.kmOverdue}` : `${fmtNum(rem)} ${t.kmLeft}`}
                </span>
              </div>
            );
          })}
          {(vr.maintenance.intervals || []).length === 0 && <p className="text-xs text-slate-400">{t.noData}</p>}
        </div>
      </Card>

      {/* Work done in the period */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`${t.serviceHistory} (${vr.totals.services})`} icon={<Wrench className="w-4 h-4 text-emerald-600" />}>
          {vr.services.length === 0 ? <p className="text-xs text-slate-400">{t.noData}</p> : (
            <ul className="divide-y divide-slate-100">
              {vr.services.map((sv) => (
                <li key={sv._id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 truncate">{sv.intervalName || sv.serviceType}</p>
                    <p className="text-[11px] text-slate-500">{fmtDate(sv.serviceDate || sv.createdAt, lang)} · {fmtKm(sv.odometerKm)}{sv.performedByName ? ` · ${sv.performedByName}` : ''}</p>
                  </div>
                  {sv.cost != null && <span className="text-xs tabular-nums text-slate-600 shrink-0">{fmtNum(sv.cost)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`${t.repairs} (${vr.totals.repairs})`} icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}>
          {vr.repairs.length === 0 ? <p className="text-xs text-slate-400">{t.noRepairs}</p> : (
            <ul className="divide-y divide-slate-100">
              {vr.repairs.map((rp) => (
                <li key={rp._id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 truncate">{rp.title}</p>
                    <p className="text-[11px] text-slate-500">{fmtDate(rp.repairDate, lang)} · {repairCategoryLabel(rp.category, lang)}{rp.workshop ? ` · ${rp.workshop}` : ''}</p>
                  </div>
                  {rp.cost != null && <span className="text-xs tabular-nums text-slate-600 shrink-0">{fmtNum(rp.cost)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Alerts (open now, plus anything that fired inside the period) */}
      <Card title={`${t.alerts} (${vr.alerts.length})`} icon={<AlertTriangle className="w-4 h-4 text-red-500" />}>
        {vr.alerts.length === 0 ? <p className="text-xs text-slate-400">{t.noData}</p> : (
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {vr.alerts.map((a) => {
              const sv = severityStyle(a.severity);
              return (
                <div key={a._id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 truncate">{alertTypeLabel(a.type, lang)}</p>
                    <p className="text-[11px] text-slate-500 truncate">{alertMessage(a, lang)}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sv.bg} ${sv.text}`}>{ar ? sv.ar : sv.en}</span>
                    <p className="text-[10px] text-slate-400 mt-0.5">{fmtDateTime(a.lastSeenAt, lang)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">{icon} {title}</h3>
      {children}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-lg py-2">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-slate-400">{label}</dt>
      <dd className={`text-slate-800 truncate ${mono ? 'font-mono text-[11px]' : 'font-medium'}`} title={value}>{value}</dd>
    </div>
  );
}

// ---- Excel workbooks --------------------------------------------------------
// The fleet workbook: a one-page summary the CEO reads first, then the full
// vehicle rows, then the supporting detail (alerts, services, repairs).
function fleetVehicleColumns(ar: boolean): ExportColumn[] {
  return [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 22 },
    { header: ar ? 'الماركة' : 'Brand', key: 'brand', width: 16 },
    { header: ar ? 'سنة الصنع' : 'Model year', key: 'modelYear', width: 11 },
    { header: ar ? 'النوع' : 'Type', key: 'vehicleType', width: 14 },
    { header: ar ? 'رقم الشاسيه' : 'VIN', key: 'vin', width: 22 },
    { header: ar ? 'شريحة الاتصال' : 'SIM ICCID', key: 'simIccid', width: 22 },
    { header: ar ? 'كم في الفترة' : 'Km in period', key: 'km', transform: (v) => Math.round(v), width: 14 },
    { header: ar ? 'المتوسط اليومي (كم)' : 'Avg km/day', key: 'avgKmPerDay', transform: (v) => Math.round(v), width: 14 },
    { header: ar ? 'أيام النشاط' : 'Active days', key: 'activeDays', width: 11 },
    { header: ar ? 'عداد البداية' : 'Odometer start', key: 'odoStart', transform: num, width: 15 },
    { header: ar ? 'عداد النهاية' : 'Odometer end', key: 'odoEnd', transform: num, width: 15 },
    { header: ar ? 'ساعات الموتور بالفترة' : 'Engine hours (period)', key: 'engineHoursPeriod', transform: num, width: 18 },
    { header: ar ? 'إجمالي ساعات الموتور' : 'Engine hours (total)', key: 'engineHoursTotal', transform: num, width: 18 },
    { header: ar ? 'الوقود (لتر)' : 'Fuel (L)', key: 'fuelL', transform: (v) => (v == null ? (ar ? 'غير متاح' : 'n/a') : Math.round(v)), width: 13 },
    { header: ar ? 'الكفاءة (كم/لتر)' : 'Efficiency (km/L)', key: 'kmPerL', transform: (v) => (v == null ? (ar ? 'غير متاح' : 'n/a') : v), width: 15 },
    { header: ar ? 'حالة الصيانة' : 'Maintenance', key: 'maintenanceStatus', transform: (v) => (ar ? (v === 'overdue' ? 'متأخرة' : v === 'due' ? 'قريبة' : 'سليمة') : v), width: 12 },
    { header: ar ? 'كم للصيانة' : 'Km to service', key: 'kmToService', transform: num, width: 13 },
    { header: ar ? 'الصيانة القادمة' : 'Next service', key: 'nextServiceName', width: 26 },
    { header: ar ? 'تنبيهات حرِجة' : 'Critical alerts', key: 'alertsCritical', width: 12 },
    { header: ar ? 'تحذيرات' : 'Warnings', key: 'alertsWarning', width: 11 },
    { header: ar ? 'كل التنبيهات' : 'All open alerts', key: 'alertsTotal', width: 12 },
    { header: ar ? 'صيانات بالفترة' : 'Services in period', key: 'servicesInPeriod', width: 14 },
    { header: ar ? 'إصلاحات بالفترة' : 'Repairs in period', key: 'repairsInPeriod', width: 14 },
    { header: ar ? 'تكلفة الإصلاحات' : 'Repair cost', key: 'repairCost', transform: num, width: 13 },
    { header: ar ? 'بيانات جزئية' : 'Partial data', key: 'clipped', transform: (v) => (v ? (ar ? 'نعم' : 'Yes') : ''), width: 12 },
  ];
}

const alertColumns = (ar: boolean, lang: Lang): ExportColumn[] => [
  { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
  { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 20 },
  { header: ar ? 'النوع' : 'Type', key: 'type', transform: (v) => alertTypeLabel(v, lang), width: 22 },
  { header: ar ? 'الخطورة' : 'Severity', key: 'severity', width: 11 },
  { header: ar ? 'الوصف' : 'Description', key: 'type', transform: (_v, row) => alertMessage(row, lang), width: 46 },
  { header: ar ? 'القيمة' : 'Value', key: 'value', transform: num, width: 10 },
  { header: ar ? 'الحد' : 'Threshold', key: 'threshold', transform: num, width: 10 },
  { header: ar ? 'أول ظهور' : 'First seen', key: 'firstSeenAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 18 },
  { header: ar ? 'آخر ظهور' : 'Last seen', key: 'lastSeenAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 18 },
];

const serviceColumns = (ar: boolean): ExportColumn[] => [
  { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
  { header: ar ? 'الخدمة' : 'Service', key: 'intervalName', width: 26 },
  { header: ar ? 'التاريخ' : 'Date', key: 'serviceDate', transform: (v, row) => new Date(v || row.createdAt).toLocaleDateString('en-GB'), width: 14 },
  { header: ar ? 'العداد (كم)' : 'Odometer (km)', key: 'odometerKm', transform: num, width: 14 },
  { header: ar ? 'ساعات الموتور' : 'Engine hours', key: 'engineHours', transform: num, width: 13 },
  { header: ar ? 'التكلفة' : 'Cost', key: 'cost', transform: num, width: 11 },
  { header: ar ? 'نُفّذت بمعرفة' : 'Performed by', key: 'performedByName', width: 22 },
  { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 34 },
];

const repairColumns = (ar: boolean, lang: Lang): ExportColumn[] => [
  { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
  { header: ar ? 'ما الذي حدث' : 'What happened', key: 'title', width: 32 },
  { header: ar ? 'التصنيف' : 'Category', key: 'category', transform: (v) => repairCategoryLabel(v, lang), width: 14 },
  { header: ar ? 'الخطورة' : 'Severity', key: 'severity', width: 11 },
  { header: ar ? 'الحالة' : 'Status', key: 'status', width: 12 },
  { header: ar ? 'التاريخ' : 'Date', key: 'repairDate', transform: (v) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 14 },
  { header: ar ? 'العداد (كم)' : 'Odometer (km)', key: 'odometerKm', transform: num, width: 14 },
  { header: ar ? 'التكلفة' : 'Cost', key: 'cost', transform: num, width: 11 },
  { header: ar ? 'الورشة' : 'Workshop', key: 'workshop', width: 20 },
  { header: ar ? 'القطع المستبدلة' : 'Parts replaced', key: 'partsReplaced', width: 28 },
];

const kvColumns = (ar: boolean): ExportColumn[] => [
  { header: ar ? 'البند' : 'Item', key: 'k', width: 34 },
  { header: ar ? 'القيمة' : 'Value', key: 'v', width: 28 },
];

function fleetSummaryRows(t: ReturnType<typeof ls2Text>, report: FleetReport | null, periodLabel: string) {
  if (!report) return [];
  const s = report.summary;
  return [
    { k: t.reportPeriod, v: periodLabel },
    { k: t.generatedAt, v: new Date(report.generatedAt).toLocaleString('en-GB') },
    { k: t.totalVehicles, v: s.vehicles },
    { k: t.totalDistance, v: s.totalKm },
    { k: t.avgPerVehicle, v: s.avgKm },
    { k: t.vehiclesMoved, v: s.movedVehicles },
    { k: t.idleVehicles, v: s.idleVehicles },
    { k: t.engineHours, v: s.totalEngineHours ?? '' },
    { k: t.serviceOverdue, v: s.overdueVehicles },
    { k: t.serviceDue, v: s.dueVehicles },
    { k: t.openAlerts, v: s.openAlerts },
    { k: t.criticalAlerts, v: s.criticalAlerts },
    { k: t.warnings, v: s.warningAlerts },
    { k: t.servicesDone, v: s.services },
    { k: t.repairsDone, v: s.repairs },
    { k: `${t.repairsDone} — ${t.cost}`, v: s.repairCost ?? '' },
  ];
}

function fleetExportOptions(ar: boolean, t: ReturnType<typeof ls2Text>, report: FleetReport | null, filtered: FleetReportRow[], periodLabel: string) {
  const lang: Lang = ar ? 'ar' : 'en';
  const build = (vehicles: FleetReportRow[]): ExportSheet[] => [
    { name: ar ? 'الملخص' : 'Summary', rows: fleetSummaryRows(t, report, periodLabel), columns: kvColumns(ar) },
    { name: ar ? 'المركبات' : 'Vehicles', rows: vehicles, columns: fleetVehicleColumns(ar) },
    { name: ar ? 'التنبيهات' : 'Alerts', rows: report?.alerts || [], columns: alertColumns(ar, lang) },
    { name: ar ? 'الصيانات' : 'Services', rows: report?.services || [], columns: serviceColumns(ar) },
    { name: ar ? 'الإصلاحات' : 'Repairs', rows: report?.repairs || [], columns: repairColumns(ar, lang) },
  ];
  return [
    { key: 'all', label: ar ? 'كل المركبات' : 'All vehicles', sheets: build(report?.items || []) },
    { key: 'filtered', label: ar ? 'النتائج الحالية (بعد الفلتر)' : 'Current filtered results', sheets: build(filtered) },
  ];
}

// The single-vehicle workbook: the same dossier the page shows, sheet per section.
function vehicleExportOptions(ar: boolean, t: ReturnType<typeof ls2Text>, vr: VehicleReport | null, periodLabel: string) {
  const lang: Lang = ar ? 'ar' : 'en';
  if (!vr) return [{ key: 'none', label: ar ? 'اختر مركبة أولاً' : 'Pick a vehicle first', sheets: [], disabled: true }];
  const p = vr.vehicle.profile;
  const summary = [
    { k: t.plate, v: vr.vehicle.plate },
    { k: t.driver, v: vr.vehicle.driver },
    { k: t.reportPeriod, v: periodLabel },
    { k: t.generatedAt, v: new Date(vr.generatedAt).toLocaleString('en-GB') },
    { k: t.brand, v: p?.brand || '' },
    { k: t.modelYear, v: p?.modelYear || '' },
    { k: t.vehicleType, v: p?.vehicleType || '' },
    { k: t.vin, v: p?.vin || '' },
    { k: t.simIccid, v: p?.simIccid || '' },
    { k: t.installDate, v: p?.installDate || '' },
    { k: t.distanceTraveled, v: Math.round(vr.distance.km) },
    { k: t.perDay, v: Math.round(vr.distance.avgKmPerDay) },
    { k: t.activeDays, v: `${vr.distance.activeDays} / ${vr.days}` },
    { k: t.engineHours, v: vr.distance.engineHours ?? '' },
    { k: t.odometer, v: vr.vehicle.odometerKm ?? '' },
    { k: t.tripCount, v: vr.trips?.summary.tripCount ?? '' },
    { k: t.driveTime, v: vr.trips ? fmtDuration(vr.trips.summary.totalDriveSec, lang) : '' },
    { k: t.maxSpeed, v: vr.trips?.summary.maxSpeed ?? '' },
    { k: t.fuelUsed, v: vr.fuel?.fuelL ?? (ar ? 'غير متاح' : 'n/a') },
    { k: t.efficiency, v: vr.fuel?.efficiencyKmL ?? (ar ? 'غير متاح' : 'n/a') },
    { k: t.kmToService, v: vr.maintenance.kmToService ?? '' },
    { k: t.nextService, v: vr.maintenance.nextServiceName },
    { k: t.servicesDone, v: vr.totals.services },
    { k: t.repairsDone, v: vr.totals.repairs },
    { k: t.openAlerts, v: vr.totals.openAlerts },
  ];
  const sheets: ExportSheet[] = [
    { name: ar ? 'الملخص' : 'Summary', rows: summary, columns: kvColumns(ar) },
    {
      name: ar ? 'المسافة اليومية' : 'Daily distance', rows: vr.distance.daily,
      columns: [
        { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 14 },
        { header: ar ? 'المسافة (كم)' : 'Distance (km)', key: 'km', width: 14 },
        { header: ar ? 'عدد الأيام المغطاة' : 'Days covered', key: 'spanDays', width: 14 },
      ],
    },
    {
      name: ar ? 'الرحلات' : 'Trips', rows: vr.trips?.trips || [],
      columns: [
        { header: ar ? 'البداية' : 'Start', key: 'beginTime', width: 20 },
        { header: ar ? 'مكان البداية' : 'From', key: 'beginLocation', width: 34 },
        { header: ar ? 'النهاية' : 'End', key: 'endTime', width: 20 },
        { header: ar ? 'مكان النهاية' : 'To', key: 'endLocation', width: 34 },
        { header: ar ? 'المسافة (كم)' : 'Distance (km)', key: 'km', width: 14 },
        { header: ar ? 'المدة' : 'Duration', key: 'durationSec', transform: (v) => fmtDuration(v, lang), width: 13 },
        { header: ar ? 'أقصى سرعة' : 'Max speed', key: 'maxSpeed', transform: num, width: 12 },
        { header: ar ? 'متوسط السرعة' : 'Avg speed', key: 'avgSpeed', transform: num, width: 12 },
      ],
    },
    {
      name: ar ? 'الوقفات' : 'Stops', rows: vr.trips?.stops || [],
      columns: [
        { header: ar ? 'المكان' : 'Location', key: 'location', width: 40 },
        { header: ar ? 'من' : 'From', key: 'from', width: 20 },
        { header: ar ? 'إلى' : 'To', key: 'to', width: 20 },
        { header: ar ? 'المدة' : 'Duration', key: 'durationSec', transform: (v) => fmtDuration(v, lang), width: 14 },
      ],
    },
    {
      name: ar ? 'خطة الصيانة' : 'Service plan', rows: vr.maintenance.intervals || [],
      columns: [
        { header: ar ? 'الخدمة' : 'Service', key: 'name', width: 28 },
        { header: ar ? 'كل (كم)' : 'Interval (km)', key: 'intervalKm', transform: num, width: 13 },
        { header: ar ? 'آخر صيانة' : 'Last service', key: 'lastServiceAt', transform: (v) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 15 },
        { header: ar ? 'عداد آخر صيانة' : 'Last service (km)', key: 'lastServiceKm', transform: num, width: 16 },
        { header: ar ? 'تستحق عند (كم)' : 'Due at (km)', key: 'nextServiceKm', transform: num, width: 14 },
        { header: ar ? 'المتبقّي (كم)' : 'Remaining (km)', key: 'remainingKm', transform: num, width: 14 },
        { header: ar ? 'الحالة' : 'Status', key: 'statusLevel', width: 11 },
      ],
    },
    { name: ar ? 'الصيانات' : 'Services', rows: vr.services, columns: serviceColumns(ar) },
    { name: ar ? 'الإصلاحات' : 'Repairs', rows: vr.repairs, columns: repairColumns(ar, lang) },
    { name: ar ? 'التنبيهات' : 'Alerts', rows: vr.alerts, columns: alertColumns(ar, lang) },
  ];
  return [{ key: 'vehicle', label: ar ? 'تقرير المركبة كاملًا' : 'Full vehicle report', sheets }];
}
