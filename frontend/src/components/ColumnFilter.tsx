'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Filter } from 'lucide-react';

// Excel-style per-column filter. Click the funnel in a column header to open a
// checklist of the distinct values present in that column; tick the ones you
// want and the table shows only matching rows. Includes a search box (for
// high-cardinality columns) and select-all / reset. Values are matched by their
// RAW string form so `selected` should hold raw `String(row[field])` values.
export function ColumnFilter({ rows, field, selected, onChange, onOpen, lang, format }: {
  rows: any[];
  field: string;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  onOpen?: () => void;
  lang: 'en' | 'ar';
  format?: (v: any) => string;
}) {
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const values = useMemo(() => {
    if (!open) return [] as { value: string; label: string }[];
    const map = new Map<string, string>();
    for (const r of rows) {
      const raw = r?.[field];
      const value = raw === null || raw === undefined || raw === '' ? '' : String(raw);
      if (!map.has(value)) {
        const label = value === '' ? (ar ? '(فارغ)' : '(Blank)') : (format ? format(raw) : value);
        map.set(value, label);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, ar ? 'ar' : 'en', { numeric: true }));
  }, [open, rows, field, ar, format]);

  const shown = q.trim() ? values.filter((v) => v.label.toLowerCase().includes(q.trim().toLowerCase())) : values;
  const active = selected.size > 0;
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.value));

  const toggle = (v: string) => { const n = new Set(selected); n.has(v) ? n.delete(v) : n.add(v); onChange(n); };
  const toggleAllShown = () => {
    const n = new Set(selected);
    if (allShownSelected) shown.forEach((v) => n.delete(v.value));
    else shown.forEach((v) => n.add(v.value));
    onChange(n);
  };

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }}
        className={`ms-1 p-0.5 rounded transition-colors ${active ? 'text-[#f37121]' : 'text-slate-400 hover:text-white'}`}
        title={ar ? 'تصفية' : 'Filter'}
      >
        <Filter className="w-3 h-3" fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 z-50 w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-2 text-slate-900 font-normal normal-case start-0" dir={ar ? 'rtl' : 'ltr'}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'بحث في القيم...' : 'Search values...'}
            className="w-full mb-2 px-2 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#f37121]"
          />
          <div className="flex items-center justify-between mb-1 px-1">
            <button type="button" onClick={toggleAllShown} className="text-[11px] text-[#f37121] hover:underline">
              {allShownSelected ? (ar ? 'إلغاء تحديد الكل' : 'Clear shown') : (ar ? 'تحديد الكل' : 'Select all')}
            </button>
            {active && <button type="button" onClick={() => onChange(new Set())} className="text-[11px] text-slate-500 hover:underline">{ar ? 'إعادة تعيين' : 'Reset'}</button>}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-2">{ar ? 'لا توجد قيم' : 'No values'}</p>
            ) : shown.map((v) => (
              <label key={v.value} className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-slate-100 rounded cursor-pointer">
                <input type="checkbox" checked={selected.has(v.value)} onChange={() => toggle(v.value)} className="w-3.5 h-3.5 accent-[#f37121]" />
                <span className="truncate" title={v.label}>{v.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
