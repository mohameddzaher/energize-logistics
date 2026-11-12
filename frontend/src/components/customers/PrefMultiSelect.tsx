'use client';
/**
 * Several values for one customer preference (e.g. two truck types), as removable chips plus an add picker.
 * Shared by the customer profile (saves on each change) and the customer edit dialog (saves with the form).
 */
import { Loader2, Plus, X } from 'lucide-react';

export default function PrefMultiSelect({ value, options, onChange, disabled, busy, ar }: {
  value: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  busy?: boolean;
  ar: boolean;
}) {
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label || v;
  const left = options.filter((o) => !value.includes(o.value));
  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-h-[36px] px-2 py-1.5 rounded-lg border bg-white ${disabled ? 'border-transparent px-0' : 'border-slate-200'}`}>
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 ps-2.5 pe-1.5 py-0.5 rounded-full bg-[#f37121]/10 border border-[#f37121]/25 text-[12.5px] font-semibold text-[#9a4310]">
          {labelOf(v)}
          {!disabled && (
            <button type="button" disabled={busy} onClick={() => onChange(value.filter((x) => x !== v))}
              className="p-0.5 rounded-full hover:bg-[#f37121]/20 disabled:opacity-50" aria-label={ar ? `إزالة ${labelOf(v)}` : `Remove ${labelOf(v)}`}>
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {!value.length && disabled && <span className="text-[13px] text-slate-400">—</span>}
      {!disabled && left.length > 0 && (
        <label className="relative inline-flex items-center">
          <Plus className="w-3.5 h-3.5 text-slate-400 absolute start-2 pointer-events-none" />
          <select value="" disabled={busy} aria-label={ar ? 'إضافة قيمة' : 'Add a value'}
            onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
            className="appearance-none ps-6 pe-2 py-0.5 rounded-full border border-dashed border-slate-300 bg-white text-[12.5px] text-slate-600 hover:border-[#f37121] focus:outline-none focus:border-[#f37121] disabled:opacity-50 cursor-pointer">
            <option value="">{ar ? 'إضافة' : 'Add'}</option>
            {left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {!disabled && !value.length && !left.length && <span className="text-[12px] text-slate-400">{ar ? 'لا توجد خيارات في الإعدادات' : 'No options in settings'}</span>}
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
    </div>
  );
}
