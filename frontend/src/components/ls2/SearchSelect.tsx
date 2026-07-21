'use client';
// SearchSelect — a searchable, drop-in replacement for a native <select> in the
// Location Solutions section. Same value/onChange contract as a <select>, but the
// panel carries a search box so a 61-flatbed list is a couple of keystrokes away.
//
// Search is a plain case-insensitive substring on each option's label, so it works
// in Arabic and English alike (numbers, plates, names) with zero config. RTL is
// handled with logical (start/end) classes and a `dir` prop.
import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export type SearchOption = { value: string; label: string; hint?: string };

export default function SearchSelect({
  value,
  onChange,
  options,
  ar = false,
  isRTL = ar,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled = false,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  ar?: boolean;
  isRTL?: boolean;
  placeholder?: string;          // shown when nothing is selected
  searchPlaceholder?: string;    // placeholder inside the search box
  emptyLabel?: string;           // label for the "clear/none" row (omit to hide it)
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) || null;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) =>
      [o.label, o.hint, o.value].some((x) => (x || '').toLowerCase().includes(term))
    );
  }, [options, q]);

  // Close on outside click / Escape; focus the search box when opening.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  const btnCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white flex items-center justify-between gap-2 focus:outline-none focus:border-[#f37121] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="relative" ref={wrapRef} dir={isRTL ? 'rtl' : 'ltr'}>
      <button
        type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className={`${btnCls} ${className}`}
      >
        <span className={`truncate text-start ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.label : (placeholder || (ar ? 'اختر…' : 'Select…'))}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-[10000] mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col max-h-72">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder || (ar ? 'ابحث…' : 'Search…')}
                className="w-full ps-8 pe-7 py-1.5 rounded-md border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
              />
              {q && (
                <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto p-1">
            {emptyLabel != null && (
              <button
                type="button" onClick={() => pick('')}
                className="w-full text-start px-3 py-2 rounded-md text-sm text-slate-500 hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="truncate">{emptyLabel}</span>
                {value === '' && <Check className="w-4 h-4 text-[#f37121] shrink-0" />}
              </button>
            )}
            {rows.map((o) => (
              <button
                key={o.value} type="button" onClick={() => pick(o.value)}
                className={`w-full text-start px-3 py-2 rounded-md text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${o.value === value ? 'bg-orange-50 text-[#d95f13] font-medium' : 'text-slate-800'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11px] text-slate-400">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="w-4 h-4 text-[#f37121] shrink-0" />}
              </button>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">{ar ? 'لا توجد نتائج' : 'No matches'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
