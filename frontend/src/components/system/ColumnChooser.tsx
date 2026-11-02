'use client';
/**
 * Column chooser: the visible columns are also what is exported and printed.
 * One choice drives screen, export and print so what you see is what comes out. Saved per browser in localStorage (a view preference, not data).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns3, Search, X } from 'lucide-react';

export type ChooserColumn = { key: string; label: string; /** A column that cannot be hidden, e.g. the row key. */ locked?: boolean };

/**
 * Reads and saves the stored selection.
 * The saved value is kept as written and the visible set is derived from it on every render, because HR master columns arrive from the server after the first render and filtering at read time lost the choice.
 * `defaults`: columns shown before any choice (all if omitted).
 */
export function useVisibleColumns(storageKey: string, columns: ChooserColumn[], opts?: { defaults?: string[] }) {
  const allKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  // `undefined` = storage not read yet; `null` = no saved selection.
  const [saved, setSaved] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      setSaved(Array.isArray(parsed) && parsed.length ? parsed.map(String) : null);
    } catch { setSaved(null); /* Storage blocked by the browser: show the defaults. */ }
  }, [storageKey]);

  const defaults = opts?.defaults;
  const visible = useMemo(() => {
    if (saved) {
      const kept = saved.filter((k) => allKeys.includes(k));
      if (kept.length) return kept;
    }
    const d = (defaults || []).filter((k) => allKeys.includes(k));
    return d.length ? d : allKeys;
  }, [saved, allKeys, defaults]);

  const set = (next: string[]) => {
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Ignore storage errors. */ }
  };
  const isOn = (k: string) => visible.includes(k);
  return { visible, setVisible: set, isOn };
}

export default function ColumnChooser({ columns, visible, onChange, ar }: {
  columns: ChooserColumn[];
  visible: string[];
  onChange: (next: string[]) => void;
  ar: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) });
    const close = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node) && !(e.target as HTMLElement)?.closest('[data-column-chooser]')) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? columns.filter((c) => c.label.toLowerCase().includes(s)) : columns;
  }, [columns, q]);

  // Save columns in definition order, not click order, so a re-shown column does not jump to the end.
  const inOrder = (keys: string[]) => columns.filter((c) => keys.includes(c.key)).map((c) => c.key);

  const toggle = (k: string) => {
    if (columns.find((c) => c.key === k)?.locked) return;
    const next = visible.includes(k) ? visible.filter((x) => x !== k) : inOrder([...visible, k]);
    // The last visible column cannot be turned off; an empty table is a fault, not a choice.
    if (!next.length) return;
    onChange(next);
  };

  /** Keep only the pinned column, or the first column if none is pinned. */
  const hideAll = () => {
    const locked = columns.filter((c) => c.locked).map((c) => c.key);
    onChange(locked.length ? locked : columns.slice(0, 1).map((c) => c.key));
  };

  const hidden = columns.length - visible.length;

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((p) => !p)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
          hidden ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}
        title={t('اختيار الأعمدة الظاهرة', 'Choose visible columns')}>
        <Columns3 className="w-4 h-4" />{t('الأعمدة', 'Columns')}{hidden ? ` (${visible.length}/${columns.length})` : ''}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div data-column-chooser dir={ar ? 'rtl' : 'ltr'}
          className="fixed z-[70] w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left }}>
          <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث عن عمود…', 'Find a column…')}
              className="w-full text-[13px] outline-none bg-transparent" />
            {q && <button type="button" onClick={() => setQ('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-[12px]">
            <button type="button" onClick={() => onChange(columns.map((c) => c.key))} className="text-[#f37121] font-medium">
              {t('إظهار الكل', 'Show all')}
            </button>
            <span className="text-slate-300">·</span>
            <button type="button" onClick={hideAll}
              className="text-slate-500 hover:text-slate-800">{t('إخفاء الكل', 'Hide all')}</button>
            <span className="ms-auto text-slate-400">{visible.length}/{columns.length}</span>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {shown.map((c) => (
              <label key={c.key}
                className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${c.locked ? 'opacity-50' : 'hover:bg-slate-50 cursor-pointer'}`}>
                <input type="checkbox" checked={visible.includes(c.key)} disabled={c.locked}
                  onChange={() => toggle(c.key)} className="accent-[#f37121]" />
                <span className="text-slate-700 truncate">{c.label}</span>
              </label>
            ))}
            {!shown.length && <p className="px-3 py-4 text-center text-[12px] text-slate-400">{t('لا عمود بهذا الاسم', 'No such column')}</p>}
          </div>
        </div>, document.body)}
    </>
  );
}
