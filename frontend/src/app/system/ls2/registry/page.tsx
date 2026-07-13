'use client';
// Fleet Registry — everything known about every truck in one place: identity
// (brand/year/VIN/SIM/install date), live status, odometer, distance driven over
// a chosen period, maintenance state, and — on demand — real CAN fuel economy.
// All instant (from the mirrored snapshots) except fuel, which is a per-vehicle
// Wialon report loaded sequentially only when you ask for it.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ClipboardList, RefreshCw, Search, Droplet, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import {
  ls2Text, isLs2Staff, statusStyle, maintStyle, fmtNum, fmtKm, fmtDate, thisMonthToDate,
  type Lang, type Vehicle, type DateRange, type VehicleFuel,
} from '@/lib/ls2';

export default function Ls2RegistryPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [fuel, setFuel] = useState<Record<number, VehicleFuel | null>>({});
  const [fuelProgress, setFuelProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: Vehicle[] }>(`/api/ls2/vehicles?from=${range.from}&to=${range.to}`);
      setItems(res.items || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));
  // A new period invalidates the loaded fuel figures.
  useEffect(() => { setFuel({}); }, [range.from, range.to]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((v) => `${v.plate} ${v.driver} ${v.name} ${v.profile?.brand || ''} ${v.profile?.vin || ''} ${v.profile?.simIccid || ''}`.toLowerCase().includes(s));
  }, [items, q]);

  const toggle = (id: number) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Fuel is a heavy per-unit report — fetch sequentially with a progress readout.
  const loadAllFuel = async () => {
    const list = filtered;
    setFuelProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      try {
        const f = await api.get<VehicleFuel>(`/api/ls2/vehicles/${v.unitId}/fuel?from=${range.from}&to=${range.to}`);
        setFuel((prev) => ({ ...prev, [v.unitId]: f }));
      } catch { setFuel((prev) => ({ ...prev, [v.unitId]: null })); }
      setFuelProgress({ done: i + 1, total: list.length });
    }
    setFuelProgress(null);
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const totalKm = filtered.reduce((s, v) => s + (v.periodKm || 0), 0);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-5 h-5" />} title={lang === 'ar' ? 'سجل الأسطول' : 'Fleet Registry'} subtitle={`${filtered.length} ${lang === 'ar' ? 'مركبة' : 'vehicles'} · ${fmtNum(Math.round(totalKm))} ${t.km}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={t.from} labelTo={t.to} />

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'ar' ? 'بحث لوحة / سائق / ماركة / VIN / شريحة…' : 'Search plate / driver / brand / VIN / SIM…'} className="w-full ps-10 pe-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <button type="button" onClick={loadAllFuel} disabled={!!fuelProgress} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-medium disabled:opacity-60">
          {fuelProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />}
          {fuelProgress ? `${fuelProgress.done}/${fuelProgress.total}` : (lang === 'ar' ? 'تحميل استهلاك الوقود' : 'Load fuel economy')}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="px-3 py-3 w-8" />
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.brand}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-start font-semibold px-4 py-3">{t.status}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-3 text-[#f9a06b]">{t.kmInPeriod}</th>
                <th className="text-center font-semibold px-4 py-3">{t.maintenance}</th>
                <th className="text-end font-semibold px-4 py-3">{t.efficiency}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const st = statusStyle(v.status);
                const ms = maintStyle(v.maintenanceStatus);
                const isOpen = open.has(v.unitId);
                const f = fuel[v.unitId];
                return (
                  <Fragment key={v.unitId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(v.unitId)}>
                      <td className="px-3 py-3 text-slate-700">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap" onClick={(e) => { e.stopPropagation(); router.push(`/system/ls2/${v.unitId}`); }}>{v.plate || v.name}</td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap text-xs">{v.profile?.brand || '—'}{v.profile?.modelYear ? ` · ${v.profile.modelYear}` : ''}</td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{v.driver || '—'}</td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span></td>
                      <td className="px-4 py-3 text-end tabular-nums text-slate-800">{fmtKm(v.odometerKm)}</td>
                      <td className="px-4 py-3 text-end tabular-nums font-semibold text-slate-800">{v.periodKm != null ? fmtNum(Math.round(v.periodKm)) : '—'}</td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ms.bg} ${ms.text}`}>{lang === 'ar' ? ms.ar : ms.en}</span></td>
                      <td className="px-4 py-3 text-end tabular-nums text-slate-700">{f === undefined ? <span className="text-slate-300">—</span> : (f && f.efficiencyKmL) ? <span className="font-semibold">{f.efficiencyKmL} <span className="text-[10px] text-slate-700">km/L</span></span> : <span className="text-slate-300 text-xs">{lang === 'ar' ? 'لا يوجد' : 'n/a'}</span>}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60 border-b border-slate-100">
                        <td colSpan={9} className="px-6 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                            <Info label={t.vin} value={v.profile?.vin} mono />
                            <Info label={t.simIccid} value={v.profile?.simIccid} mono />
                            <Info label={t.installDate} value={v.profile?.installDate} />
                            <Info label={t.lsUnitId} value={v.profile?.lsUnitId} mono />
                            <Info label={t.vehicleType} value={v.profile?.vehicleType} />
                            <Info label={t.tireBrand} value={v.tireBrand} />
                            {f && f.fuelL ? <Info label={t.fuelUsed} value={`${fmtNum(Math.round(f.fuelL))} L`} /> : null}
                            {(v.profile?.extra || []).map((e) => <Info key={e.label} label={e.label} value={e.value} />)}
                          </div>
                          {(v.serviceIntervals?.length || 0) > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {[...v.serviceIntervals].sort((a, b) => a.intervalKm - b.intervalKm).map((iv) => {
                                const s = maintStyle(iv.statusLevel);
                                const rem = iv.remainingKm;
                                return (
                                  <span key={iv.id} className={`px-2 py-1 rounded-lg text-[11px] ${s.bg} ${s.text}`}>
                                    {iv.name.replace(/\(.*?\)/, '').trim()}: {rem != null ? (rem < 0 ? `−${fmtNum(Math.abs(rem))}` : fmtNum(rem)) + ' km' : '—'}
                                    <span className="opacity-60"> · {fmtDate(iv.lastServiceAt, lang as Lang)}</span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={9} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-slate-800 truncate ${mono ? 'font-mono text-[11px]' : 'font-medium'}`} title={value}>{value}</p>
    </div>
  );
}
