'use client';
// Unified date-range filter, opens on click; an empty "to" means until today.
// Fixed: inverted calendar icon invisible on white; click on the field not opening the picker (showPicker() does);
// and "from" without "to" reading as open-ended, so the until-today label replaces the blank.
import { useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';

/** Opens the native picker from anywhere in the field, not only the icon. */
function openPicker(el: HTMLInputElement | null) {
  if (!el) return;
  try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); }
  catch { el.focus(); }
}

export function DateField({ value, onChange, label, max, min, ar, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  max?: string;
  min?: string;
  ar: boolean;
  /** Text shown when the input is empty, e.g. "until today". */
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <input
        ref={ref}
        type="date"
        // The global rule in globals.css covers all date inputs; it is repeated here so a local style cannot break it.
        dir="ltr"
        title={label}
        aria-label={label}
        value={value}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => openPicker(ref.current)}
        className="peer w-[168px] ps-9 pe-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] font-semibold cursor-pointer
                   focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 focus:border-[#f37121]
                   [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => openPicker(ref.current)}
        aria-label={label}
        className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 peer-focus:text-[#f37121] hover:text-[#f37121] transition-colors"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      {/* No Arabic text over the date format: the placeholder used to overlap the browser's mm/dd/yyyy and change the field height. The label now sits outside the field. */}
    </div>
  );
}

/** Full range: from, to, and a clear button when there is something to clear. An empty "to" shows "until today", which is what the server does. */
export default function DateRangeFilter({ from, to, onFrom, onTo, ar, className = '' }: {
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  ar: boolean; className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* The from/to labels sit outside the input; inside they overlap the browser format text and change the height. */}
      <span className="text-[12px] font-bold text-slate-600 shrink-0">{ar ? 'من' : 'From'}</span>
      <DateField ar={ar} value={from} onChange={onFrom} max={to || undefined}
        label={ar ? 'من تاريخ' : 'From date'} />
      <span className="text-[12px] font-bold text-slate-600 shrink-0">{ar ? 'إلى' : 'To'}</span>
      {/* "to" is not capped at today: a later date would be silently clamped and the count would differ from what was asked. The server stops at now when it is empty, which is enough. */}
      <DateField ar={ar} value={to} onChange={onTo} min={from || undefined}
        label={ar ? 'إلى تاريخ' : 'To date'} />
      {/* An empty "to" means until today, stated once beside the field. */}
      {!to && <span className="text-[11px] text-slate-400 shrink-0">{ar ? '(حتى اليوم)' : '(until today)'}</span>}
      {(from || to) && (
        <button type="button" onClick={() => { onFrom(''); onTo(''); }}
          title={ar ? 'مسح المدى' : 'Clear range'}
          className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
