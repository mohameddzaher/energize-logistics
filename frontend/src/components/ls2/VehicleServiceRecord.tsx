'use client';
// The complete maintenance record for ONE truck, in one place: the tasks that were
// deferred and are still outstanding, every periodic service we logged (with the
// checklist of what was actually done on each visit), and every exceptional repair.
//
// This is what any manager opening a vehicle profile needs to see, so it lives in
// a component and is dropped into the vehicle page — there is only one profile.
import { useState, useEffect, useCallback } from 'react';
import { Clock, History, Hammer, Plus, CheckCircle2, MinusCircle } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import RepairModal from '@/components/ls2/RepairModal';
import {
  ls2Text, fmtNum, fmtKm, fmtDate, REPAIR_SEVERITIES, REPAIR_STATUSES, repairCategoryLabel,
  type Lang, type ServiceLog, type Deferral, type Repair,
} from '@/lib/ls2';

export default function VehicleServiceRecord({
  unitId, plate, currentOdo, lang, isRTL, admin,
}: {
  unitId: number;
  plate?: string;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  admin: boolean;
}) {
  const ar = lang === 'ar';
  const t = ls2Text(lang);
  const [history, setHistory] = useState<ServiceLog[]>([]);
  const [deferrals, setDeferrals] = useState<Deferral[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [addRepair, setAddRepair] = useState(false);
  const [editRepair, setEditRepair] = useState<Repair | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ history: ServiceLog[]; deferrals: Deferral[]; repairs: Repair[] }>(`/api/ls2/vehicles/${unitId}/maintenance`);
      setHistory(r.history || []); setDeferrals(r.deferrals || []); setRepairs(r.repairs || []);
    } catch { /* keep */ }
  }, [unitId]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  return (
    <>
      {/* Deferred tasks — inspected, granted extra km, not yet done */}
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
                      {d.intervalName} · {t.deferredOn} {fmtDate(d.deferredAt, lang)}
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

      {/* Every periodic service we logged, with its checklist */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <History className="w-4 h-4 text-[#f37121]" /> {ar ? 'سجل الصيانة الدورية' : 'Periodic service history'} ({history.length})
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
                    <td className="px-4 py-2.5 text-slate-800 tabular-nums whitespace-nowrap">{fmtDate(h.serviceDate || h.createdAt, lang)}</td>
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
                      <td className="px-4 py-2.5 text-slate-800">{repairCategoryLabel(r.category, lang)}</td>
                      <td className="px-4 py-2.5 text-center"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${sev.bg} ${sev.text}`}>{ar ? sev.ar : sev.en}</span></td>
                      <td className="px-4 py-2.5 text-slate-800 tabular-nums whitespace-nowrap">{fmtDate(r.repairDate, lang)}</td>
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
          unitId={unitId} plate={plate} currentOdo={currentOdo}
          existing={editRepair}
          lang={lang} isRTL={isRTL}
          onClose={() => { setAddRepair(false); setEditRepair(null); }}
          onSaved={() => { setAddRepair(false); setEditRepair(null); load(); }}
        />
      )}
    </>
  );
}
