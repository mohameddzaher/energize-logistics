'use client';
// One truck's maintenance by type, read from the maintenance ledger (records, older service logs and repairs, store issues).
// `tiles` (maintenance page): four type tiles, nothing open until one is picked, its content opens below.
// `cards` (vehicle profile): one card per type, each with its full history.
// Periodic content (the service-interval cards) is passed in by the caller; the other three types add records here.
import { useState, type ReactNode } from 'react';
import { Plus, Ban, Package, Wrench, Truck as TowIcon, CalendarCheck, ShieldCheck, Siren, CarFront, ChevronDown, Receipt, CheckCircle2, Clock, MinusCircle, User } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { MAINTENANCE_TYPES, MAINTENANCE_SOURCE_LABEL, fmtKm, fmtNum, type Lang, type MaintenanceEntry, type MaintenanceType } from '@/lib/ls2';
import MaintenanceRecordModal from './MaintenanceRecordModal';
import { useMaintenanceEntries, type TypeSummary } from './useMaintenanceEntries';

const money = (n?: number | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const TYPE_ICON: Record<MaintenanceType, typeof Wrench> = { periodic: CalendarCheck, preventive: ShieldCheck, roadside: CarFront, accident: Siren };
const TYPE_TINT: Record<MaintenanceType, { ring: string; icon: string; soft: string }> = {
  periodic: { ring: 'ring-emerald-500', icon: 'bg-emerald-50 text-emerald-700', soft: 'bg-emerald-50/60' },
  preventive: { ring: 'ring-sky-500', icon: 'bg-sky-50 text-sky-700', soft: 'bg-sky-50/60' },
  roadside: { ring: 'ring-amber-500', icon: 'bg-amber-50 text-amber-700', soft: 'bg-amber-50/60' },
  accident: { ring: 'ring-rose-500', icon: 'bg-rose-50 text-rose-700', soft: 'bg-rose-50/60' },
};
const SAR = (ar: boolean) => (ar ? 'ر.س' : 'SAR');

/** Full detail of one entry: what was done, priced parts, work, cost split, who and notes. */
export function EntryCard({ e, ar, admin, onCancel }: { e: MaintenanceEntry; ar: boolean; admin: boolean; onCancel?: () => void }) {
  const cancelled = !!e.cancelled;
  const src = MAINTENANCE_SOURCE_LABEL[e.source];
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-3.5 ${cancelled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-semibold text-slate-900 ${cancelled ? 'line-through' : ''}`}>{e.title || (ar ? 'بدون وصف' : 'No description')}</p>
          <p className="text-[11px] text-slate-600 tabular-nums mt-0.5">
            {e.date}{e.odometerKm != null ? ` · ${fmtKm(e.odometerKm)}` : ''}{e.location ? ` · ${e.location}` : ''}
            {e.ref && e.source === 'record' ? ` · ${ar ? 'طلب صرف' : 'Issue'} ${e.ref}` : ''}{e.issueReasonAr ? ` · ${e.issueReasonAr}` : ''}
          </p>
          {e.source !== 'record' && (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">{ar ? src.ar : src.en}</span>
          )}
          {e.sourceRepair && <span className="inline-block mt-1 ms-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">{ar ? 'منقول من الإصلاحات الاستثنائية' : 'Migrated repair'}</span>}
        </div>
        <div className="text-end shrink-0">
          <p className="text-base font-bold tabular-nums text-slate-900">{money(e.totalCost)} <span className="text-[10px] font-normal text-slate-500">{SAR(ar)}</span></p>
          {cancelled
            ? <span className="text-[10px] font-semibold text-red-600">{ar ? 'ملغى' : 'Cancelled'}</span>
            : admin && e.source === 'record' && onCancel && (
              <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-600">
                <Ban className="w-3 h-3" /> {ar ? 'إلغاء السجل' : 'Cancel record'}
              </button>
            )}
        </div>
      </div>

      {e.parts.length > 0 && (
        <div className="mt-2.5 border border-slate-100 rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-slate-50 text-slate-600">
              <th className="text-start font-semibold px-2 py-1">{ar ? 'القطعة' : 'Part'}</th>
              <th className="text-end font-semibold px-2 py-1">{ar ? 'الكمية' : 'Qty'}</th>
              <th className="text-end font-semibold px-2 py-1">{ar ? 'سعر الوحدة' : 'Unit price'}</th>
              <th className="text-end font-semibold px-2 py-1">{ar ? 'الإجمالي' : 'Total'}</th>
            </tr></thead>
            <tbody>
              {e.parts.map((p, i) => (
                <tr key={`${p.item}-${i}`} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-800">{p.name}{p.isTire && <span className="ms-1 px-1 rounded bg-amber-50 text-amber-800 text-[9px]">{ar ? 'كاوتش' : 'tyre'}</span>}</td>
                  <td className="px-2 py-1 text-end tabular-nums text-slate-700">{fmtNum(p.quantity)} {p.unit}</td>
                  <td className="px-2 py-1 text-end tabular-nums text-slate-700">{money(p.unitPrice)}</td>
                  <td className="px-2 py-1 text-end tabular-nums font-semibold text-slate-900">{money(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {e.work.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-700">
          {e.work.map((w, i) => (
            <li key={i} className="flex justify-between gap-2"><span className="flex items-center gap-1"><Wrench className="w-3 h-3 text-violet-500" /> {w.label}{w.note ? ` — ${w.note}` : ''}</span>{w.cost ? <span className="tabular-nums">{money(w.cost)}</span> : null}</li>
          ))}
        </ul>
      )}
      {(e.checklist?.length || 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.checklist!.map((c, i) => {
            const Icon = c.status === 'done' ? CheckCircle2 : c.status === 'deferred' ? Clock : MinusCircle;
            const cls = c.status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : c.status === 'deferred' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
            return <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${cls}`}><Icon className="w-2.5 h-2.5" /> {c.label}{c.status === 'deferred' && c.deferKm != null ? ` +${fmtNum(c.deferKm)} km` : ''}</span>;
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2.5 text-[10px]">
        {e.partsCost > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200"><Package className="w-3 h-3" /> {ar ? 'قطع' : 'Parts'} {money(e.partsCost)}</span>}
        {e.labourCost > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200"><Wrench className="w-3 h-3" /> {ar ? 'عمالة' : 'Labour'} {money(e.labourCost)}</span>}
        {e.towingCost > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"><TowIcon className="w-3 h-3" /> {ar ? 'سحب' : 'Towing'} {money(e.towingCost)}</span>}
        {e.unsplitCost > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"><Receipt className="w-3 h-3" /> {ar ? 'تكلفة غير مفصّلة' : 'Unitemised'} {money(e.unsplitCost)}</span>}
        {e.by && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-slate-600"><User className="w-3 h-3" /> {e.by}</span>}
      </div>
      {e.notes && <p className="text-[11px] text-slate-600 mt-1.5">{e.notes}</p>}
      {cancelled && e.cancelReason && <p className="text-[11px] text-red-600 mt-1">{ar ? 'سبب الإلغاء' : 'Reason'}: {e.cancelReason}{e.cancelledByName ? ` — ${e.cancelledByName}` : ''}</p>}
    </div>
  );
}

function TypeTile({ type, s, ar, active, onClick }: { type: MaintenanceType; s: TypeSummary; ar: boolean; active: boolean; onClick: () => void }) {
  const m = MAINTENANCE_TYPES.find((x) => x.key === type)!;
  const Icon = TYPE_ICON[type];
  const tint = TYPE_TINT[type];
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={`text-start bg-white border rounded-xl p-4 shadow-sm transition hover:shadow-md hover:border-slate-300 ${active ? `ring-2 ${tint.ring} border-transparent` : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${tint.icon}`}><Icon className="w-5 h-5" /></span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${active ? 'rotate-180' : ''}`} />
      </div>
      <p className="text-sm font-bold text-slate-900 mt-3">{ar ? m.ar : m.en}</p>
      <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">{money(s.total)} <span className="text-[11px] font-normal text-slate-500">{SAR(ar)}</span></p>
      <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-slate-600 tabular-nums">
        <span>{s.count} {ar ? 'سجل' : 'entries'}</span>
        <span>{s.lastDate ? `${ar ? 'آخرها' : 'Last'} ${s.lastDate}` : (ar ? 'لا سجلات' : 'None yet')}</span>
      </div>
    </button>
  );
}

function EntryList({ list, ar, admin, onCancel, limit }: { list: MaintenanceEntry[]; ar: boolean; admin: boolean; onCancel: (e: MaintenanceEntry) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!list.length) return <p className="text-sm text-slate-500 text-center py-6">{ar ? 'لا توجد سجلات من هذا النوع لهذه المركبة.' : 'No entries of this type for this vehicle.'}</p>;
  const shown = limit && !all ? list.slice(0, limit) : list;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {shown.map((e) => <EntryCard key={e.key} e={e} ar={ar} admin={admin} onCancel={() => onCancel(e)} />)}
      </div>
      {limit && list.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          {all ? (ar ? 'عرض أقل' : 'Show less') : (ar ? `عرض الكل (${list.length})` : `Show all (${list.length})`)}
        </button>
      )}
    </div>
  );
}

function NewButton({ ar, onClick }: { ar: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-xs font-medium">
      <Plus className="w-3.5 h-3.5" /> {ar ? 'سجل جديد' : 'New record'}
    </button>
  );
}

export default function MaintenanceRecords({
  unitId, plate, currentOdo, lang, isRTL, admin, periodic, layout = 'tiles',
}: {
  unitId: number;
  plate?: string;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  admin: boolean;
  periodic: ReactNode; // the service-interval cards
  layout?: 'tiles' | 'cards';
}) {
  const ar = lang === 'ar';
  const { prompt, notify } = useDialog();
  const { entries, summary, reload } = useMaintenanceEntries(unitId);
  const [open, setOpen] = useState<MaintenanceType | null>(null);
  const [adding, setAdding] = useState<Exclude<MaintenanceType, 'periodic'> | null>(null);

  const cancel = async (r: MaintenanceEntry) => {
    const reason = await prompt({
      title: ar ? 'إلغاء سجل الصيانة' : 'Cancel maintenance record',
      message: ar ? 'تعود قطع الغيار إلى المخزن ويبقى السجل ظاهرًا كملغى. اكتب السبب:' : 'Parts return to the store and the record stays as cancelled. Reason:',
      confirmLabel: ar ? 'إلغاء السجل' : 'Cancel record',
    });
    if (!reason || reason.trim().length < 3) return;
    try { await api.post(`/api/ls2/maintenance/records/${r.id}/cancel`, { reason: reason.trim() }); reload(); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };
  const ofType = (t: MaintenanceType) => (entries || []).filter((e) => e.type === t);

  const modal = adding && (
    <MaintenanceRecordModal
      unitId={unitId} plate={plate} type={adding} currentOdo={currentOdo} lang={lang} isRTL={isRTL}
      onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }}
    />
  );

  if (entries == null) return <p className="text-sm text-slate-500 text-center py-6">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>;

  if (layout === 'cards') {
    return (
      <div className="space-y-4">
        {MAINTENANCE_TYPES.map((m) => {
          const Icon = TYPE_ICON[m.key];
          const s = summary[m.key];
          return (
            <section key={m.key} id={`maint-${m.key}`} className="scroll-mt-20 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100 ${TYPE_TINT[m.key].soft}`}>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${TYPE_TINT[m.key].icon}`}><Icon className="w-4 h-4" /></span>
                  {ar ? m.ar : m.en}
                  <span className="text-xs font-normal text-slate-600 tabular-nums">· {s.count} {ar ? 'سجل' : 'entries'} · {money(s.total)} {SAR(ar)}{s.lastDate ? ` · ${ar ? 'آخرها' : 'last'} ${s.lastDate}` : ''}</span>
                </h2>
                {admin && m.key !== 'periodic' && <NewButton ar={ar} onClick={() => setAdding(m.key as Exclude<MaintenanceType, 'periodic'>)} />}
              </div>
              <div className="p-4 space-y-3 bg-slate-50/50">
                {m.key === 'periodic' && periodic}
                <EntryList list={ofType(m.key)} ar={ar} admin={admin} onCancel={cancel} limit={6} />
              </div>
            </section>
          );
        })}
        {modal}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
        {MAINTENANCE_TYPES.map((m) => (
          <TypeTile key={m.key} type={m.key} s={summary[m.key]} ar={ar} active={open === m.key} onClick={() => setOpen((p) => (p === m.key ? null : m.key))} />
        ))}
      </div>
      {open && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{ar ? MAINTENANCE_TYPES.find((x) => x.key === open)!.ar : MAINTENANCE_TYPES.find((x) => x.key === open)!.en}</p>
            {admin && open !== 'periodic' && <NewButton ar={ar} onClick={() => setAdding(open as Exclude<MaintenanceType, 'periodic'>)} />}
          </div>
          {open === 'periodic' && periodic}
          {open === 'periodic' && ofType('periodic').length > 0 && <p className="text-xs font-semibold text-slate-700 pt-1">{ar ? 'سجل الصيانة الدورية' : 'Periodic history'}</p>}
          {(open !== 'periodic' || ofType('periodic').length > 0) && <EntryList list={ofType(open)} ar={ar} admin={admin} onCancel={cancel} limit={8} />}
        </div>
      )}
      {modal}
    </div>
  );
}
