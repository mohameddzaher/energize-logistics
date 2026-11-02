'use client';
import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter, Loader2 } from 'lucide-react';
import { colKey } from '@/lib/colKey';

export type ColumnFilterOption = { value: string; count?: number };

// Excel-style column filter: the funnel in the header opens a value list, ticked values limit the table. Matching runs on the raw DB value, so selected must hold raw values, not display text.
// Two sources: options (server-computed values with row counts; correct for server-paginated tables, since building from loaded rows shows only the current page and loading everything freezes the tab) and rows (derived from loaded rows, for tables fully loaded in the browser).
export function ColumnFilter({ rows, field, valueOf, selected, onChange, onOpen, lang, format, options, loading, truncated, onQuery, label }: {
  rows?: any[];
  field: string;
  /** Reads a column value from a row when it is not a flat property. Vehicle-section tables build each column with a function (nested fields, computed values like status), so r[field] gives undefined and the list shows only "(empty)". This is the same function used to render and export the column, so filtering matches what is read on screen. */
  valueOf?: (row: any) => any;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  onOpen?: () => void;
  lang: 'en' | 'ar';
  format?: (v: any) => string;
  options?: ColumnFilterOption[];
  loading?: boolean;
  truncated?: boolean;
  onQuery?: (q: string) => void;
  /** Shows a labelled dropdown button instead of the small header funnel. */
  label?: string;
}) {
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const serverMode = !!options;

  useEffect(() => {
    if (!open) return;
    // The panel is now in body, so it is not a child of the button; a click inside was read as outside and closed it before anything was ticked. Its contents are excluded explicitly.
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && ref.current.contains(t)) return;
      if (panelRef.current && panelRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Value search runs in the browser while all values are present. Once the list reaches the server cap (columns like statement number have a value per row), search goes to the server; otherwise the browser would say no values for a value that exists but was not delivered.
  const [serverSearch, setServerSearch] = useState(false);
  useEffect(() => { if (truncated) setServerSearch(true); }, [truncated]);
  useEffect(() => { if (!open) { setQ(''); setServerSearch(false); } }, [open]);

  // A ref avoids resetting the timeout on every parent re-render; depending on the function identity would keep cancelling it and the search would never reach the server.
  const queryRef = useRef(onQuery);
  queryRef.current = onQuery;
  useEffect(() => {
    if (!open || !serverSearch) return;
    const t = setTimeout(() => queryRef.current?.(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, open, serverSearch]);

  // Each list line carries the raw values it stands for (raws): rows may hold two variants of the same city (one with trailing space) that show as one line; selecting it ticks both so filtering stays raw-exact on every page.
  type Entry = { value: string; label: string; count?: number; raws: string[] };
  const values = useMemo((): Entry[] => {
    if (!open) return [];
    const label = (value: string, raw: any) =>
      value === '' ? (ar ? '(فارغ)' : '(Blank)') : (format ? format(raw) : value);

    if (options) {
      const seen = new Set(options.map((o) => o.value));
      // A selected value stays visible even if it drops out of the server result (after a search or narrowing other filters), otherwise its box disappears and it cannot be unticked.
      const pinned = [...selected].filter((v) => !seen.has(v)).map((v) => ({ value: v, label: label(v, v), count: undefined, raws: [v] }));
      // Order is the server's: most frequent first, which is what users usually look for.
      return [...pinned, ...options.map((o) => ({ value: o.value, label: label(o.value, o.value), count: o.count, raws: [o.value] }))];
    }

    const map = new Map<string, Entry>();
    for (const r of rows || []) {
      const raw = valueOf ? valueOf(r) : r?.[field];
      const value = raw === null || raw === undefined || raw === '' ? '' : String(raw);
      const k = colKey(value);
      const e = map.get(k);
      if (!e) map.set(k, { value, label: k ? label(value, raw) : label('', raw), count: 1, raws: [value] });
      else { e.count = (e.count || 0) + 1; if (!e.raws.includes(value)) e.raws.push(value); }
    }
    // Selected values no longer in the rows stay visible so they can be unselected.
    for (const v of selected) {
      if ([...map.values()].some((e) => e.raws.includes(v))) continue;
      map.set(`\u0000${v}`, { value: v, label: label(v, v), count: undefined, raws: [v] });
    }
    // Counts are not shown here (as before) because the rows may be one page, not the whole set.
    return Array.from(map.values())
      .map((e) => ({ ...e, count: undefined }))
      .sort((a, b) => a.label.localeCompare(b.label, ar ? 'ar' : 'en', { numeric: true }));
  }, [open, options, rows, field, valueOf, ar, format, selected]);

  const shown = (!serverSearch && q.trim())
    ? values.filter((v) => v.label.toLowerCase().includes(q.trim().toLowerCase()))
    : values;
  const active = selected.size > 0;
  const isOn = (e: Entry) => e.raws.some((r) => selected.has(r));
  const allShownSelected = shown.length > 0 && shown.every(isOn);

  const toggle = (e: Entry) => {
    const n = new Set(selected);
    if (isOn(e)) e.raws.forEach((r) => n.delete(r)); else e.raws.forEach((r) => n.add(r));
    onChange(n);
  };
  const toggleAllShown = () => {
    const n = new Set(selected);
    if (allShownSelected) shown.forEach((e) => e.raws.forEach((r) => n.delete(r)));
    else shown.forEach((e) => e.raws.forEach((r) => n.add(r)));
    onChange(n);
  };

  // Why the panel renders outside the table: it was absolute inside the column header, within an overflow-x-auto container and an overflow-hidden one. A clipping container also clips absolute children and z-index cannot escape it, so with a one-row result the table was shorter than the panel and most of it was cut. It is rendered in body at coordinates from the button, with no clipping parent, and repositioned on scroll and resize.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const W = 240; const M = 8;
      // Keeps the panel within the viewport horizontally.
      let left = ar ? r.right - W : r.left;
      left = Math.max(M, Math.min(left, window.innerWidth - W - M));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, ar]);

  const panel = (
        <div ref={panelRef} className="fixed z-[100] w-60 bg-white border border-slate-200 rounded-lg shadow-2xl p-2 text-slate-900 font-normal normal-case"
          style={{ top: pos ? pos.top : -9999, left: pos ? pos.left : -9999 }}
          dir={ar ? 'rtl' : 'ltr'}>
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
            {loading && shown.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-slate-400 px-1 py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> {ar ? 'جارٍ تحميل القيم...' : 'Loading values...'}
              </p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-2">{ar ? 'لا توجد قيم' : 'No values'}</p>
            ) : shown.map((v) => (
              <label key={v.value} className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-slate-100 rounded cursor-pointer">
                <input type="checkbox" checked={isOn(v)} onChange={() => toggle(v)} className="w-3.5 h-3.5 accent-[#f37121]" />
                <span className="truncate flex-1" title={v.label}>{v.label}</span>
                {v.count != null && <span className="text-[10px] text-slate-400 tabular-nums">{v.count.toLocaleString()}</span>}
              </label>
            ))}
          </div>
          {serverMode && truncated && (
            <p className="text-[10px] text-slate-400 px-1 pt-1 border-t border-slate-100 mt-1">
              {ar ? 'القيم كثيرة — اكتب في البحث للوصول إلى الباقي' : 'Too many values — type to search for the rest'}
            </p>
          )}
          {serverMode && loading && shown.length > 0 && (
            <p className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1 pt-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {ar ? 'تحديث...' : 'Updating...'}
            </p>
          )}
        </div>
  );

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      {/* The funnel must be visible before it can be used: it was a faint 12px icon on a dark navy header and users missed it. It is now a small bordered box that reads as a button and turns clearly orange when active. */}
      {/* The active state shows its count rather than a solid color block: the filled orange square with a white funnel read as an odd blob, not a button, and did not say how many values are ticked. It is now an orange outline with light fill, orange funnel and a count when above one. */}
      {label ? (
        <button type="button" onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }} aria-expanded={open}
          className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border text-[13px] font-semibold transition-colors ${
            active ? 'border-[#f37121] bg-orange-50 text-[#f37121]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
          {label}
          {active && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#f37121] text-white text-[11px] leading-[18px] text-center tabular-nums">{selected.size}</span>}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (<button
        type="button"
        onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }}
        className={`ms-1.5 inline-flex items-center justify-center gap-0.5 h-5 min-w-5 px-1 rounded-md border transition-colors align-middle ${
          active
            ? 'bg-[#f37121]/20 border-[#f37121] text-[#f37121]'
            : open
              ? 'bg-white/30 border-white/50 text-white'
              : 'bg-white/10 border-white/25 text-white/80 hover:bg-white/25 hover:text-white'
        }`}
        title={active
          ? (ar ? `مفلترٌ على ${selected.size} قيمة — اضغط للتعديل` : `Filtered on ${selected.size} — click to change`)
          : (ar ? 'فلترة هذا العمود' : 'Filter this column')}
        aria-label={ar ? 'فلترة هذا العمود' : 'Filter this column'}
      >
        <Filter className="w-3 h-3 shrink-0" fill={active ? 'currentColor' : 'none'} />
        {active && selected.size > 1 && (
          <span className="text-[10px] font-bold leading-none tabular-nums">{selected.size}</span>
        )}
      </button>)}
      {open && typeof document !== 'undefined' && createPortal(panel, document.body)}
    </span>
  );
}
