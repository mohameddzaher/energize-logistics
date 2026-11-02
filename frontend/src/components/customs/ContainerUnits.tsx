'use client';
/**
 * Transaction units: one entry per container.
 * The transaction used to hold only a container count, but work is per container: its number, the vehicle that carried it, and when it was returned to the agent. Containers are drawn by count, each with its own fields. Transport details appear once a transport stage is marked, by company vehicle or external vehicle; both record the dispatch-statement number (external vehicles also get a dispatch statement in the operations workflow), and the UI shows whether it is linked. No invoice number.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { TRANSPORT_LEGS, stageName, unitWord, type Pipeline, type UnitPipeline } from '@/lib/customsPipeline';
import { Car, CalendarDays, Link2, Truck, AlertTriangle, Check, Undo2 } from 'lucide-react';

export interface UnitMove { leg: string; vehicleKind: '' | 'energize' | 'external'; ref: string }
export interface Unit {
  _id?: string; containerNumber?: string; returnDate?: string; notes?: string; moves?: UnitMove[];
  // Container return details: where, with what receipt, by which vehicle.
  returnDepot?: string; returnReceipt?: string; returnVehicleKind?: '' | 'energize' | 'external'; returnRef?: string; returnNotes?: string;
}

const moveOf = (u: Unit, leg: string): UnitMove => (u.moves || []).find((m) => m.leg === leg) || { leg, vehicleKind: '', ref: '' };
const withMove = (u: Unit, leg: string, patch: Partial<UnitMove>): Unit => {
  const next = { ...moveOf(u, leg), ...patch };
  return { ...u, moves: [...(u.moves || []).filter((m) => m.leg !== leg), next] };
};

export default function ContainerUnits({
  units, pipeline, stages, canEdit, ar, onSave,
}: {
  units: Unit[];
  pipeline?: Pipeline;
  stages: Record<string, string>;
  canEdit: boolean;
  ar: boolean;
  onSave: (rows: Unit[]) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const cargo = pipeline?.cargoType || 'containers';
  const vehicles = cargo === 'vehicles';
  // Transport stages completed by each unit; only those ask for the vehicle. Units do not always move together, so each has its own stages (a transaction with no tracked units takes all the transaction's stages).
  const legsOf = (i: number): string[] => {
    const steps = pipeline?.units?.[i]?.steps || pipeline?.steps || [];
    return steps.filter((s) => (TRANSPORT_LEGS as readonly string[]).includes(s.key) && s.done).map((s) => s.key);
  };
  const anyLeg = units.some((_, i) => legsOf(i).length > 0);

  // Typed dispatch-statement numbers: which ones exist in the operations workflow.
  const sheetNumbers = useMemo(() => [...new Set(units.flatMap((u) => (u.moves || [])
    .filter((m) => m.vehicleKind && m.ref).map((m) => m.ref.trim())))].sort().join(','), [units]);
  const [found, setFound] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!sheetNumbers) { setFound({}); return; }
    let live = true;
    api.get<{ found: Record<string, string> }>(`/api/customs-clearance/release-sheets?numbers=${encodeURIComponent(sheetNumbers)}`)
      .then((d) => { if (live) setFound(d.found || {}); }).catch(() => {});
    return () => { live = false; };
  }, [sheetNumbers]);

  const setUnit = (i: number, next: Unit) => onSave(units.map((u, idx) => (idx === i ? next : u)));
  if (!units.length) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        {vehicles ? t('اكتب عدد السيّارات في بيانات المعاملة لتظهر خاناتُها.', 'Enter the vehicle count to open their slots.')
          : t('اكتب عدد الحاويات في بيانات المعاملة لتظهر خاناتُها.', 'Enter the container count to open their slots.')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!anyLeg && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
          {t('بيانُ النقل (سيّارة تنشيط أو سيّارة خارجيّة) يُفتَح في خانة كلّ وحدةٍ حين تُعلَّم لها مرحلةُ نقلٍ في مراحل التخليص.',
             'Transport details open in each unit once a transport stage is ticked for it.')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {units.map((u, i) => (
          // The key is the slot position, not its id: ids regenerate on every save, so keying by id would remount the slot after each field and lose focus on the next one.
          <UnitBox key={i} index={i} unit={u} legs={legsOf(i)} flow={pipeline?.units?.[i]} vehicles={vehicles} cargo={cargo}
            stages={stages} found={found} canEdit={canEdit} ar={ar} onChange={(next) => setUnit(i, next)} />
        ))}
      </div>
    </div>
  );
}

/** A single container drawn as a container: corrugated sides, door and data plate. */
function UnitBox({
  index, unit, legs, flow, vehicles, cargo, stages, found, canEdit, ar, onChange,
}: {
  index: number; unit: Unit; legs: string[]; flow?: UnitPipeline; vehicles: boolean; cargo: string;
  stages: Record<string, string>; found: Record<string, string>;
  canEdit: boolean; ar: boolean; onChange: (u: Unit) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  // Returned from its stage (the server dates it with the day it was marked) or from a typed date.
  const returned = !vehicles && (!!flow?.steps.some((s) => s.key === 'containers_returned' && s.done) || (!flow && !!unit.returnDate));
  // A returned container turns green so it is visible at a glance without reading dates.
  const shell = returned ? ['#15803d', '#166534'] : vehicles ? ['#334155', '#1e293b'] : ['#ea6a1c', '#c9530f'];
  return (
    <div className="overflow-hidden rounded-md shadow-sm ring-1 ring-black/10"
      style={{ background: `repeating-linear-gradient(90deg, ${shell[0]} 0 9px, ${shell[1]} 9px 11px)` }}>
      {/* Top bar: slot number and type. */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-white" style={{ background: shell[1] }}>
        {vehicles ? <Car className="h-4 w-4" /> : <span className="grid h-4 w-5 grid-cols-3 gap-px opacity-80">{[0, 1, 2].map((k) => <i key={k} className="bg-white/70" />)}</span>}
        <span className="text-[12px] font-bold">{unitWord(cargo, ar, false)} {index + 1}</span>
        {returned
          ? <span className="ms-auto inline-flex items-center gap-1 rounded bg-white/20 px-1.5 py-0.5 text-[10.5px] font-bold"><Check className="h-3 w-3" />{t('أُرجعت', 'Returned')}</span>
          : flow && (
            <span className="ms-auto max-w-[60%] truncate rounded bg-white/20 px-1.5 py-0.5 text-[10.5px] font-semibold" title={flow.next ? stageName(stages, flow.next, cargo) : ''}>
              {flow.percent >= 100 ? t('اكتملت', 'Done') : flow.next ? `${t('تنتظر', 'Next')}: ${stageName(stages, flow.next, cargo)}` : `${flow.percent}%`}
            </span>
          )}
      </div>
      {/* Data plate: white on the container body so its content is readable. */}
      <div className="m-2 space-y-2 rounded bg-white/95 p-2.5">
        <Field label={vehicles ? t('رقم السيارة', 'Vehicle no.') : t('رقم الحاوية', 'Container no.')}
          value={unit.containerNumber || ''} disabled={!canEdit} mono
          placeholder={vehicles ? '' : 'MSKU1234567'}
          onSave={(v) => onChange({ ...unit, containerNumber: v.trim().toUpperCase() })} />
        {legs.map((leg) => {
          const m = moveOf(unit, leg);
          const id = m.ref ? found[m.ref.trim()] : '';
          return (
            <div key={leg} className="rounded border border-slate-200 bg-slate-50 p-2">
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-slate-700"><Truck className="h-3.5 w-3.5 text-[#f37121]" />{stageName(stages, leg, cargo)}</p>
              {/* Which vehicle carried this unit in this stage. */}
              <div className="mb-1.5 flex overflow-hidden rounded border border-slate-200 bg-white text-[11.5px] font-semibold">
                {([['energize', 'سيّارة تنشيط', 'Energize truck'], ['external', 'سيّارة خارجيّة', 'External truck']] as const).map(([k, a, e]) => (
                  <button key={k} type="button" disabled={!canEdit} onClick={() => onChange(withMove(unit, leg, { vehicleKind: k }))}
                    className={`flex-1 px-2 py-1 transition-colors ${m.vehicleKind === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-50'} disabled:cursor-default`}>
                    {ar ? a : e}
                  </button>
                ))}
              </div>
              {!!m.vehicleKind && (
                <Field label={t('رقم كشف التخريج', 'Release sheet no.')}
                  value={m.ref} disabled={!canEdit} mono
                  onSave={(v) => onChange(withMove(unit, leg, { ref: v.trim() }))} />
              )}
              {!!m.vehicleKind && !!m.ref && (id ? (
                <Link href={`/system/operations/${id}`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline">
                  <Link2 className="h-3 w-3" />{t('مرتبطٌ بسير عمل التشغيل', 'Linked to operations workflow')}
                </Link>
              ) : (
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3 w-3" />{t('غير موجودٍ في سير عمل التشغيل', 'Not found in operations workflow')}
                </span>
              ))}
            </div>
          );
        })}
        {!vehicles && (
          // Container return: the date plus what is asked when the agent claims a demurrage fine.
          <div className={`rounded border p-2 ${returned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-slate-700"><Undo2 className="h-3.5 w-3.5 text-[#f37121]" />{t('إرجاع الحاوية', 'Container return')}</p>
            <div className="space-y-1.5">
              <Field label={t('تاريخ الإرجاع', 'Return date')} type="date" icon
                value={unit.returnDate || ''} disabled={!canEdit}
                onSave={(v) => onChange({ ...unit, returnDate: v })} />
              <Field label={t('مكان الإرجاع (الساحة / المحطة)', 'Returned to (depot)')}
                value={unit.returnDepot || ''} disabled={!canEdit}
                onSave={(v) => onChange({ ...unit, returnDepot: v.trim() })} />
              <Field label={t('رقم إيصال الإرجاع (EIR)', 'Return receipt (EIR)')} mono
                value={unit.returnReceipt || ''} disabled={!canEdit}
                onSave={(v) => onChange({ ...unit, returnReceipt: v.trim().toUpperCase() })} />
              <div className="flex overflow-hidden rounded border border-slate-200 bg-white text-[11.5px] font-semibold">
                {([['energize', 'سيّارة تنشيط', 'Energize truck'], ['external', 'سيّارة خارجيّة', 'External truck']] as const).map(([k, a, e]) => (
                  <button key={k} type="button" disabled={!canEdit}
                    onClick={() => onChange({ ...unit, returnVehicleKind: unit.returnVehicleKind === k ? '' : k })}
                    className={`flex-1 px-2 py-1 transition-colors ${unit.returnVehicleKind === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-50'} disabled:cursor-default`}>
                    {ar ? a : e}
                  </button>
                ))}
              </div>
              {!!unit.returnVehicleKind && (
                <Field label={t('رقم كشف التخريج', 'Release sheet no.')}
                  value={unit.returnRef || ''} disabled={!canEdit} mono
                  onSave={(v) => onChange({ ...unit, returnRef: v.trim() })} />
              )}
              <Field label={t('ملاحظات الإرجاع', 'Return notes')}
                value={unit.returnNotes || ''} disabled={!canEdit}
                onSave={(v) => onChange({ ...unit, returnNotes: v.trim() })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, onSave, type = 'text', disabled, mono, placeholder, icon,
}: {
  label: string; value: string; onSave: (v: string) => void; type?: string;
  disabled?: boolean; mono?: boolean; placeholder?: string; icon?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
        {icon && <CalendarDays className="h-3 w-3" />}{label}
      </span>
      <input type={type} value={v} disabled={disabled} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== value) onSave(v); }}
        className={`w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 disabled:opacity-70 [color-scheme:light] ${mono ? 'font-mono tracking-wide' : ''}`}
        dir={mono ? 'ltr' : undefined} />
    </label>
  );
}
