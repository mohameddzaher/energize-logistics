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
import { Wrench, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Clock, History, FileClock } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, isLs2Admin, maintStyle, fmtNum, fmtKm, fmtDate, type Lang, type Vehicle, type ServiceInterval } from '@/lib/ls2';
import RegisterServiceModal from '@/components/ls2/RegisterServiceModal';

const FILTERS = ['all', 'due', 'overdue'];

// Remaining amount + unit for one service (mileage / days / engine-hours).
function remainOf(iv: ServiceInterval): { value: number; unit: string; next: string } {
  if (iv.remainingKm != null) return { value: iv.remainingKm, unit: 'km', next: iv.nextServiceKm != null ? `${Number(iv.nextServiceKm).toLocaleString('en-US')} km` : '—' };
  if (iv.remainingDays != null) return { value: iv.remainingDays, unit: 'd', next: iv.nextServiceAt ? new Date(iv.nextServiceAt).toLocaleDateString('en-GB') : '—' };
  return { value: iv.remaining ?? 0, unit: 'h', next: iv.nextServiceValue != null ? `${iv.nextServiceValue} h` : '—' };
}

export default function Ls2MaintenancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(params.get('filter') || 'all');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const admin = isLs2Admin(user?.role);
  // Register-service dialog
  const [svc, setSvc] = useState<{ v: Vehicle; iv: ServiceInterval } | null>(null);
  // Full service-history dialog
  const [hist, setHist] = useState<Vehicle | null>(null);
  const [histRows, setHistRows] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const openHistory = async (v: Vehicle) => {
    setHist(v); setHistRows([]); setHistLoading(true);
    try { const r = await api.get<{ history: any[] }>(`/api/ls2/vehicles/${v.unitId}/maintenance`); setHistRows(r.history || []); }
    catch { /* keep */ }
    setHistLoading(false);
  };

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

  const toggle = (id: number) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
                const isOpen = open.has(v.unitId);
                const over = (v.kmToService ?? 0) < 0;
                return (
                  <Fragment key={v.unitId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(v.unitId)}>
                      <td className="px-3 py-3 text-slate-700">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</td>
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
                    {isOpen && (
                      <tr className="bg-slate-50/60 border-b border-slate-100">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-center justify-end mb-2">
                            <button type="button" onClick={() => openHistory(v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-xs font-medium">
                              <FileClock className="w-3.5 h-3.5 text-[#f37121]" /> {lang === 'ar' ? 'سجل الصيانة الكامل' : 'Full service history'}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {[...v.serviceIntervals].sort((a, b) => a.intervalKm - b.intervalKm).map((iv) => {
                              const r = remainOf(iv);
                              const st = maintStyle(iv.statusLevel);
                              const isOver = r.value < 0;
                              const Icon = iv.statusLevel === 'overdue' ? AlertCircle : iv.statusLevel === 'due' ? Clock : CheckCircle2;
                              return (
                                <div key={iv.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-3">
                                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iv.statusLevel === 'overdue' ? 'text-red-500' : iv.statusLevel === 'due' ? 'text-amber-500' : 'text-emerald-500'}`} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-medium text-slate-800 truncate">{iv.name}</p>
                                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${st.bg} ${st.text}`}>
                                        {isOver ? `−${fmtNum(Math.abs(r.value))}` : fmtNum(r.value)} {r.unit === 'km' ? (isOver ? t.kmOverdue : t.kmLeft) : r.unit}
                                      </span>
                                    </div>
                                    {iv.description && <p className="text-[11px] text-slate-700 mt-0.5 line-clamp-2">{iv.description}</p>}
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11px] text-slate-700">
                                      <span>{t.lastService}: <b className="text-slate-700">{fmtDate(iv.lastServiceAt, lang as Lang)}</b>{iv.lastServiceKm != null && <> · {fmtKm(iv.lastServiceKm)}</>}</span>
                                      <span>{lang === 'ar' ? 'القادمة' : 'Next'}: <b className="text-slate-700">{r.next}</b></span>
                                      {iv.serviceCount > 0 && <span>{iv.serviceCount} {t.services}</span>}
                                    </div>
                                    {admin && (
                                      <button type="button" onClick={() => setSvc({ v, iv })} className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-[11px] font-medium">
                                        <CheckCircle2 className="w-3 h-3" /> {lang === 'ar' ? 'تم عمل الصيانة' : 'Mark serviced'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register-service dialog */}
      {svc && (
        <RegisterServiceModal
          unitId={svc.v.unitId} interval={svc.iv} currentOdo={svc.v.odometerKm}
          lang={lang as Lang} isRTL={isRTL}
          onClose={() => setSvc(null)}
          onSaved={() => { setSvc(null); load(); }}
        />
      )}

      {/* Full service-history dialog */}
      {hist && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => setHist(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex items-center gap-2">
              <History className="w-5 h-5 text-[#f37121]" />
              <div>
                <h3 className="text-base font-bold text-slate-900">{lang === 'ar' ? 'سجل صيانة' : 'Service history'} — {hist.plate || hist.name}</h3>
                <p className="text-xs text-slate-500">{lang === 'ar' ? 'كل الصيانات المسجّلة لهذه المركبة' : 'All services logged for this vehicle'}</p>
              </div>
              <button type="button" onClick={() => setHist(null)} className="ms-auto text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {histLoading ? <Spinner /> : histRows.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">{lang === 'ar' ? 'لا توجد صيانات مسجّلة عندنا لهذه المركبة بعد.' : 'No services logged here for this vehicle yet.'}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-900 text-slate-300">
                    <th className="text-start font-semibold px-3 py-2">{lang === 'ar' ? 'الخدمة' : 'Service'}</th>
                    <th className="text-start font-semibold px-3 py-2">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                    <th className="text-end font-semibold px-3 py-2">{t.odometer}</th>
                    <th className="text-end font-semibold px-3 py-2">{lang === 'ar' ? 'التكلفة' : 'Cost'}</th>
                    <th className="text-start font-semibold px-3 py-2">{lang === 'ar' ? 'بواسطة' : 'By'}</th>
                    <th className="text-center font-semibold px-3 py-2">LS2</th>
                  </tr></thead>
                  <tbody>
                    {histRows.map((h) => (
                      <tr key={h._id} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-800">{h.intervalName || '—'}{h.notes ? <p className="text-[10px] text-slate-400">{h.notes}</p> : null}</td>
                        <td className="px-3 py-2 text-slate-800 tabular-nums">{fmtDate(h.serviceDate || h.createdAt, lang as Lang)}</td>
                        <td className="px-3 py-2 text-end text-slate-800 tabular-nums">{h.odometerKm != null ? fmtKm(h.odometerKm) : '—'}</td>
                        <td className="px-3 py-2 text-end text-slate-800 tabular-nums">{h.cost != null ? fmtNum(h.cost) : '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{h.performedByName || '—'}</td>
                        <td className="px-3 py-2 text-center">{h.syncedToWialon ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" /> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
