'use client';
// Maintenance — a live mirror of each truck's REAL service plan from Location
// Solutions (Wialon). Every vehicle carries its own service intervals (Group A/B/C,
// TR Wheels…); each shows when it was last serviced (date + odometer) and how far
// it is from the next one — next = last-service odometer + interval, exactly as
// Wialon computes it. Read-only: services are registered inside Location Solutions
// and reflected here automatically. Expand a row to see every service.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Wrench, RefreshCw, ChevronRight } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, maintStyle, fmtNum, fmtKm, type Lang, type Vehicle } from '@/lib/ls2';

const FILTERS = ['all', 'due', 'overdue'];

// Click a vehicle → its full profile at /system/ls2/[id] (one profile everywhere).
export default function Ls2MaintenancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(params?.get('filter') || 'all');

  const load = useCallback(async () => {
    try { const res = await api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'); setItems(res.items || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const rows = useMemo(() => {
    let r = items.filter((v) => (v.serviceIntervals?.length || 0) > 0);
    if (filter === 'due') r = r.filter((v) => v.maintenanceStatus === 'due');
    else if (filter === 'overdue') r = r.filter((v) => v.maintenanceStatus === 'overdue');
    // Worst first: overdue by how much, then closest to due.
    return r.sort((a, b) => (a.kmToService ?? 1e9) - (b.kmToService ?? 1e9));
  }, [items, filter]);


  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const counts = {
    due: items.filter((v) => v.maintenanceStatus === 'due').length,
    overdue: items.filter((v) => v.maintenanceStatus === 'overdue').length,
  };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wrench className="w-5 h-5" />} title={t.maintenance} subtitle={`${counts.overdue} ${t.serviceOverdue} · ${counts.due} ${t.serviceDue}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === f ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {f === 'all' ? t.all : f === 'due' ? t.serviceDue : t.serviceOverdue}
          </button>
        ))}
        <span className="ms-auto text-xs text-slate-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t.fromWialon}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="px-3 py-3 w-8" />
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-3 text-red-300">{t.mostOverdue}</th>
                <th className="text-end font-semibold px-4 py-3 text-amber-300">{t.nextUpcoming}</th>
                <th className="text-center font-semibold px-4 py-3">{t.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const ms = maintStyle(v.maintenanceStatus);
                const over = (v.kmToService ?? 0) < 0;
                return (
                  <Fragment key={v.unitId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/ls2/${v.unitId}`)}>
                      <td className="px-3 py-3 text-slate-400"><ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /></td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{v.plate || v.name}</td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{v.driver || '—'}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-slate-800">{fmtKm(v.odometerKm)}</td>
                      {/* Most overdue (or most urgent) service */}
                      <td className="px-4 py-3 text-end">
                        {v.kmToService == null ? <span className="text-slate-300">—</span> : (
                          <div className={`tabular-nums font-bold ${over ? 'text-red-600' : v.maintenanceStatus === 'due' ? 'text-amber-600' : 'text-slate-700'}`}>
                            {over ? `−${fmtNum(Math.abs(v.kmToService))}` : fmtNum(v.kmToService)} <span className="text-[10px] font-normal text-slate-700">{over ? t.kmOverdue : t.kmLeft}</span>
                            <p className="text-[10px] font-normal text-slate-700 truncate max-w-[180px] ms-auto">{v.nextServiceName}</p>
                          </div>
                        )}
                      </td>
                      {/* Nearest upcoming (not-yet-passed) service */}
                      <td className="px-4 py-3 text-end">
                        {v.upcomingKm == null ? <span className="text-slate-300 text-xs">{lang === 'ar' ? 'كلها متأخرة' : 'all overdue'}</span> : (
                          <div className="tabular-nums font-semibold text-slate-700">
                            {fmtNum(v.upcomingKm)} <span className="text-[10px] font-normal text-slate-700">{t.kmLeft}</span>
                            <p className="text-[10px] font-normal text-slate-700 truncate max-w-[180px]">{v.upcomingServiceName}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ms.bg} ${ms.text}`}>{lang === 'ar' ? ms.ar : ms.en}</span></td>
                    </tr>
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
