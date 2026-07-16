'use client';
// Per-vehicle maintenance profile — the 4 service intervals up top (each with a
// prominent "Mark serviced" action) and the full local service history below.
// Reached by clicking a vehicle on the Maintenance list.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Wrench, ArrowLeft, RefreshCw, CheckCircle2, AlertCircle, Clock, History, Gauge, Hammer, MinusCircle, Plus } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  ls2Text, isLs2Staff, isLs2Admin, maintStyle, fmtNum, fmtKm, fmtDate,
  REPAIR_SEVERITIES, REPAIR_STATUSES, repairCategoryLabel,
  type Lang, type Vehicle, type ServiceInterval, type ServiceLog, type Deferral, type Repair,
} from '@/lib/ls2';
import RegisterServiceModal from '@/components/ls2/RegisterServiceModal';
import RepairModal from '@/components/ls2/RepairModal';

function remainOf(iv: ServiceInterval): { value: number; unit: string; next: string } {
  if (iv.remainingKm != null) return { value: iv.remainingKm, unit: 'km', next: iv.nextServiceKm != null ? `${Number(iv.nextServiceKm).toLocaleString('en-US')} km` : '—' };
  if (iv.remainingDays != null) return { value: iv.remainingDays, unit: 'd', next: iv.nextServiceAt ? new Date(iv.nextServiceAt).toLocaleDateString('en-GB') : '—' };
  return { value: iv.remaining ?? 0, unit: 'h', next: iv.nextServiceValue != null ? `${iv.nextServiceValue} h` : '—' };
}

export default function VehicleMaintenancePage() {
  const params = useParams();
  const id = params?.id as string;
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const ar = lang === 'ar';
  const admin = isLs2Admin(user?.role);

  const [v, setV] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<ServiceLog[]>([]);
  const [deferrals, setDeferrals] = useState<Deferral[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [svc, setSvc] = useState<ServiceInterval | null>(null);
  const [addRepair, setAddRepair] = useState(false);
  const [editRepair, setEditRepair] = useState<Repair | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ vehicle: Vehicle; history: ServiceLog[]; deferrals: Deferral[]; repairs: Repair[] }>(`/api/ls2/vehicles/${id}/maintenance`);
      setV(r.vehicle); setHistory(r.history || []); setDeferrals(r.deferrals || []); setRepairs(r.repairs || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading) return <Spinner />;
  if (!v) return <div className="text-slate-500 p-8">{t.noData}</div>;

  const intervals = [...(v.serviceIntervals || [])].sort((a, b) => a.intervalKm - b.intervalKm);
  const ms = maintStyle(v.maintenanceStatus);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {ar ? 'رجوع' : 'Back'}
      </button>

      <PageHeader icon={<Wrench className="w-5 h-5" />} title={`${ar ? 'صيانة' : 'Maintenance'} — ${v.plate || v.name}`} subtitle={v.driver}>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${ms.bg} ${ms.text}`}>{ar ? ms.ar : ms.en}</span>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Gauge className="w-4 h-4 text-[#f37121]" /> {t.odometer}: <b className="text-slate-900 tabular-nums">{fmtKm(v.odometerKm)}</b>
      </div>

      {/* The 4 service intervals — prominent, each with a Mark-serviced button */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {intervals.map((iv) => {
          const r = remainOf(iv);
          const st = maintStyle(iv.statusLevel);
          const isOver = r.value < 0;
          const Icon = iv.statusLevel === 'overdue' ? AlertCircle : iv.statusLevel === 'due' ? Clock : CheckCircle2;
          return (
            <div key={iv.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${iv.statusLevel === 'overdue' ? 'text-red-500' : iv.statusLevel === 'due' ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className="truncate">{iv.name}</span>
                </p>
                <span className={`shrink-0 px-2 py-0.5 rounded-lg text-xs font-bold tabular-nums ${st.bg} ${st.text}`}>
                  {isOver ? `−${fmtNum(Math.abs(r.value))}` : fmtNum(r.value)} {r.unit === 'km' ? (isOver ? t.kmOverdue : t.kmLeft) : r.unit}
                </span>
              </div>
              {iv.description && <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{iv.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-[11px] text-slate-600">
                <span>{t.lastService}: <b className="text-slate-800">{fmtDate(iv.lastServiceAt, lang as Lang)}</b>{iv.lastServiceKm != null && <> · {fmtKm(iv.lastServiceKm)}</>}</span>
                <span>{ar ? 'القادمة' : 'Next'}: <b className="text-slate-800">{r.next}</b></span>
                {iv.serviceCount > 0 && <span>{iv.serviceCount} {t.services}</span>}
              </div>
              {admin && (
                <button type="button" onClick={() => setSvc(iv)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" /> {ar ? 'تم عمل الصيانة' : 'Mark serviced'}
                </button>
              )}
            </div>
          );
        })}
        {intervals.length === 0 && <p className="text-slate-400 text-sm py-4">{t.noData}</p>}
      </div>

      {/* Open deferrals — tasks inspected and granted extra km, not yet done */}
      {deferrals.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 px-5 py-3 border-b border-amber-100 bg-amber-50">
            <Clock className="w-4 h-4 text-amber-600" /> {t.openDeferrals} ({deferrals.length})
          </h2>
          <div className="divide-y divide-slate-100">
            {deferrals.map((d) => {
              const over = d.remainingKm != null && d.remainingKm < 0;
              return (
                <div key={`${d.logId}-${d.label}`} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{d.label}</p>
                    <p className="text-[11px] text-slate-600">
                      {d.intervalName} · {t.deferredOn} {fmtDate(d.deferredAt, lang as Lang)}
                      {d.deferredAtOdometerKm != null && <> ({fmtKm(d.deferredAtOdometerKm)})</>}
                      {d.deferKm != null && <> · +{fmtNum(d.deferKm)} km</>}
                      {d.note && <> · {d.note}</>}
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${over ? 'text-red-600' : 'text-amber-700'}`}>
                      {d.remainingKm == null ? '—' : over ? `−${fmtNum(Math.abs(d.remainingKm))} ${t.kmOverdue}` : `${fmtNum(d.remainingKm)} ${t.kmLeft}`}
                    </p>
                    <p className="text-[11px] text-slate-600">{t.dueAt} {fmtKm(d.dueAtOdometerKm)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full service history (everything we logged) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <History className="w-4 h-4 text-[#f37121]" /> {ar ? 'سجل الصيانة الكامل' : 'Full service history'} ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">{ar ? 'لا توجد صيانات مسجّلة عندنا لهذه المركبة بعد.' : 'No services logged here for this vehicle yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-900 text-slate-300">
                <th className="text-start font-semibold px-4 py-2.5">{ar ? 'الخدمة' : 'Service'}</th>
                <th className="text-start font-semibold px-4 py-2.5">{ar ? 'التاريخ' : 'Date'}</th>
                <th className="text-end font-semibold px-4 py-2.5">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-2.5">{ar ? 'التكلفة' : 'Cost'}</th>
                <th className="text-start font-semibold px-4 py-2.5">{ar ? 'بواسطة' : 'By'}</th>
                <th className="text-center font-semibold px-4 py-2.5">LS2</th>
              </tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h._id} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-2.5 text-slate-800">
                      {h.intervalName || '—'}
                      {h.notes ? <p className="text-[10px] text-slate-500">{h.notes}</p> : null}
                      {/* What was actually done, task by task */}
                      {(h.checklist?.length || 0) > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {h.checklist.map((c, i) => {
                            const style = c.status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : c.status === 'deferred' ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200';
                            const Icon = c.status === 'done' ? CheckCircle2 : c.status === 'deferred' ? Clock : MinusCircle;
                            return (
                              <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${style}`}>
                                <Icon className="w-2.5 h-2.5" /> {c.label}
                                {c.status === 'deferred' && c.deferKm != null && <b>+{fmtNum(c.deferKm)} km</b>}
                                {c.status === 'deferred' && c.resolved && <b>· {t.done}</b>}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 tabular-nums">{fmtDate(h.serviceDate || h.createdAt, lang as Lang)}</td>
                    <td className="px-4 py-2.5 text-end text-slate-800 tabular-nums">{h.odometerKm != null ? fmtKm(h.odometerKm) : '—'}</td>
                    <td className="px-4 py-2.5 text-end text-slate-800 tabular-nums">{h.cost != null ? fmtNum(h.cost) : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-700">{h.performedByName || '—'}</td>
                    <td className="px-4 py-2.5 text-center">{h.syncedToWialon ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" /> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Exceptional repairs for this truck (ours — never in Location Solutions) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Hammer className="w-4 h-4 text-[#f37121]" /> {t.repairs} ({repairs.length})
          </h2>
          {admin && (
            <button type="button" onClick={() => setAddRepair(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">
              <Plus className="w-3.5 h-3.5" /> {t.newRepair}
            </button>
          )}
        </div>
        {repairs.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">{t.noRepairs}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-900 text-slate-300">
                <th className="text-start font-semibold px-4 py-2.5">{t.repairTitle}</th>
                <th className="text-start font-semibold px-4 py-2.5">{t.category}</th>
                <th className="text-center font-semibold px-4 py-2.5">{t.severity}</th>
                <th className="text-start font-semibold px-4 py-2.5">{t.repairDate}</th>
                <th className="text-end font-semibold px-4 py-2.5">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-2.5">{ar ? 'التكلفة' : 'Cost'}</th>
                <th className="text-start font-semibold px-4 py-2.5">{t.workshop}</th>
                <th className="text-center font-semibold px-4 py-2.5">{t.status}</th>
              </tr></thead>
              <tbody>
                {repairs.map((r) => {
                  const sev = REPAIR_SEVERITIES[r.severity];
                  const st = REPAIR_STATUSES[r.status];
                  return (
                    <tr key={r._id} className={`border-b border-slate-100 ${admin ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => admin && setEditRepair(r)}>
                      <td className="px-4 py-2.5 text-slate-800">
                        {r.title}
                        {r.description && <p className="text-[10px] text-slate-500">{r.description}</p>}
                        {r.partsReplaced && <p className="text-[10px] text-slate-500">{t.partsReplaced}: {r.partsReplaced}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">{repairCategoryLabel(r.category, lang as Lang)}</td>
                      <td className="px-4 py-2.5 text-center"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${sev.bg} ${sev.text}`}>{ar ? sev.ar : sev.en}</span></td>
                      <td className="px-4 py-2.5 text-slate-800 tabular-nums">{fmtDate(r.repairDate, lang as Lang)}</td>
                      <td className="px-4 py-2.5 text-end text-slate-800 tabular-nums">{r.odometerKm != null ? fmtKm(r.odometerKm) : '—'}</td>
                      <td className="px-4 py-2.5 text-end text-slate-800 tabular-nums">{r.cost != null ? fmtNum(r.cost) : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-800">{r.workshop || '—'}</td>
                      <td className="px-4 py-2.5 text-center"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${st.bg} ${st.text}`}>{ar ? st.ar : st.en}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(addRepair || editRepair) && (
        <RepairModal
          unitId={v.unitId} plate={v.plate} currentOdo={v.odometerKm}
          existing={editRepair}
          lang={lang as Lang} isRTL={isRTL}
          onClose={() => { setAddRepair(false); setEditRepair(null); }}
          onSaved={() => { setAddRepair(false); setEditRepair(null); load(); }}
        />
      )}

      {svc && (
        <RegisterServiceModal
          unitId={v.unitId} interval={svc} currentOdo={v.odometerKm}
          lang={lang as Lang} isRTL={isRTL}
          onClose={() => setSvc(null)}
          onSaved={() => { setSvc(null); load(); }}
        />
      )}
    </div>
  );
}
