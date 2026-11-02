'use client';
// Tire control buttons: one definition used wherever a tire is shown.
// Copying it would let rules drift. The rules are not cosmetic: renewal result only for a tire at the factory, sell as scrap only for scrap or damaged, and a final tire (sold/written off) gets no move or edit. The component is the rule; the page sends the actions and it decides which show.
import { ArrowLeftRight, ArrowDownToLine, Pencil, Trash2, Repeat, Boxes } from 'lucide-react';

export type TireLike = {
  _id: string; serial: string; status: string; condition?: string;
  plate?: string | null; positionLabel?: string; section?: string;
};

export type TireActionHandlers = {
  onMove: (t: TireLike) => void;        // Install on a truck / move and swap
  onDismount: (t: TireLike) => void;    // Remove with all destinations, plus a replacement
  onRenewal: (t: TireLike) => void;     // Renewal result: usable or scrap
  onStatus: (t: TireLike) => void;      // Move status
  onEdit: (t: TireLike) => void;
  onRetire: (t: TireLike) => void;      // Damaged / scrap
  onSell: (t: TireLike) => void;        // Sell as scrap
};

// Final states: the tire has left the cycle, so no install, remove or edit.
export const isTerminalTire = (status: string) => status === 'retired' || status === 'sold';

export default function TireActions({ tire, ar, busy, admin, on, compact = false }: {
  tire: TireLike; ar: boolean; busy?: boolean; admin: boolean;
  on: TireActionHandlers; compact?: boolean;
}) {
  if (!admin) return null;
  const t = tire;
  const terminal = isTerminalTire(t.status);
  const icon = compact ? 'p-1 rounded-md' : 'p-1.5 rounded-md';

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {/* Store (new or used): an uninstalled tire gets a clear install button rather than an obscure icon */}
      {!terminal && t.status === 'spare' && (
        <button type="button" onClick={() => on.onMove(t)}
          className="px-2.5 py-1 rounded-md bg-orange-50 hover:bg-orange-100 text-[#f37121] text-[11px] font-semibold inline-flex items-center gap-1">
          <ArrowDownToLine className="w-3.5 h-3.5" />{ar ? 'تركيب على شاحنة' : 'Mount on truck'}
        </button>
      )}
      {/* Installed: move or swap with another tire */}
      {!terminal && t.status === 'mounted' && (
        <button type="button" title={ar ? 'نقل / تبديل' : 'Move / swap'} onClick={() => on.onMove(t)}
          className={`${icon} hover:bg-blue-50 text-slate-500 hover:text-blue-600`}>
          <ArrowLeftRight className="w-4 h-4" />
        </button>
      )}
      {/* Removal with all destinations (store with percentage / renewal / damaged / scrap) plus a replacement in its place */}
      {!terminal && t.status === 'mounted' && (
        <button type="button" disabled={busy} onClick={() => on.onDismount(t)}
          title={ar ? 'إنزال (مخزن / المصنع / تالفة / سكراب) + بديل' : 'Dismount + optional replacement'}
          className={`${icon} hover:bg-amber-50 text-slate-500 hover:text-amber-600`}>
          <ArrowDownToLine className="w-4 h-4" />
        </button>
      )}
      {!terminal && t.status === 'in_repair' && (
        <button type="button" disabled={busy} onClick={() => on.onRenewal(t)}
          title={ar ? 'نتيجة التجديد: صالحة أو سكراب' : 'Renewal result'}
          className="px-2 py-1 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-medium">
          {ar ? 'نتيجة التجديد' : 'Result'}
        </button>
      )}
      {/* Move status: always available for all states (including final ones, e.g. back to store) */}
      <button type="button" disabled={busy} onClick={() => on.onStatus(t)}
        title={ar ? 'نقل الحالة (مخزن / المصنع / سكراب / تالف / معدوم / مباع)' : 'Change status'}
        className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1">
        <Repeat className="w-3.5 h-3.5" />{ar ? 'نقل الحالة' : 'Status'}
      </button>
      {/* Sell as scrap: for any scrap or damaged tire (installed or final) */}
      {(t.status === 'scrap' || t.status === 'damaged') && (
        <button type="button" disabled={busy} onClick={() => on.onSell(t)}
          className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold inline-flex items-center gap-1">
          <Boxes className="w-3.5 h-3.5" />{ar ? 'بيع كخردة' : 'Sell'}
        </button>
      )}
      {!terminal && (
        <button type="button" title={ar ? 'تعديل' : 'Edit'} onClick={() => on.onEdit(t)}
          className={`${icon} hover:bg-slate-100 text-slate-500 hover:text-slate-800`}>
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {!terminal && t.status !== 'in_repair' && t.status !== 'scrap' && (
        <button type="button" disabled={busy} onClick={() => on.onRetire(t)}
          title={ar ? 'تالفة / سكراب' : 'Damaged / scrap'}
          className={`${icon} hover:bg-red-50 text-slate-500 hover:text-red-600`}>
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
