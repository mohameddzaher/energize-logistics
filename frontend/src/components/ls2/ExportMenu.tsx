'use client';
// ExportMenu: the single export button of the platform. Pages pass 'scopes' (filtered view, all, current page...); one scope renders a plain button, several a dropdown with a row count beside each, so nobody exports 20 rows believing it was 200. Each scope carries its sheets, so a scope can be multi-sheet. File names get the export date appended.
import { useEffect, useRef, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { FileSpreadsheet, ChevronDown } from 'lucide-react';
import { exportMultiSheet, type ExportBlock } from '@/utils/exportExcel';

// `type` decides the Excel cell type: `date` writes a real date object instead of date-looking text, and `hijri` writes the date with a Hijri display format so it stays sortable and computable. See utils/exportExcel.
export type ExportColumn = { header: string; key: string; transform?: (value: any, row: any) => any; width?: number; type?: 'text' | 'date' | 'number' | 'hijri' };
export interface ExportSheet {
  name: string;
  rows: Record<string, any>[];
  columns: ExportColumn[];
  /** Blocks printed above the main table in the same sheet: summary above, detail below. Two sheets would hide half the picture, and the page shows them stacked. The row counter in the list counts `rows` only, the exported table. */
  above?: ExportBlock[];
  /** Title printed above the main table header. */
  title?: string;
}
export interface ExportOption {
  key: string; label: string;
  sheets?: ExportSheet[];
  /** Alternative to `sheets` when the data is not loaded in the page: fetched when the user picks the option. For sensitive fetches (e.g. passwords) that must not load on every page open. */
  resolve?: () => Promise<ExportSheet[]>;
  /** Alternative to both when the server builds the file and it downloads ready. A large table built in the browser crosses the network as raw JSON and then freezes the render thread while the workbook is built; thousands of rows are built on the server. */
  download?: () => Promise<void>;
  disabled?: boolean;
  /** Shown beside the name instead of a row count when the count is unknown before fetching. */
  hint?: string;
}

/** Scope names in one place: over ninety pages show these options, and separate wording would make 'all' mean different things. `page` is used only for server-side pagination where only the screen rows exist, so the file does not claim more than it has. */
export const exportScopeLabels = (ar: boolean) => ({
  shown: ar ? 'تصدير المعروض (بعد الفلتر)' : 'Export shown (filtered)',
  all: ar ? 'تصدير الكلّ' : 'Export everything',
  page: ar ? 'الصفحة الحالية فقط' : 'Current page only',
  matching: ar ? 'كلّ نتائج الفلتر' : 'All rows matching filter',
});

export default function ExportMenu({ fileName, options, lang = 'en', className = '', label }: {
  fileName: string;
  options: ExportOption[];
  lang?: 'en' | 'ar';
  className?: string;
  /** Deprecated: used to distinguish two shapes, now unified. Kept in the type so the screens passing it do not break; it has no effect. */
  variant?: 'primary' | 'subtle';
  /** Button text when the page translates it itself; otherwise the default text. */
  label?: string;
}) {
  const { notify } = useDialog();
  const [openMenu, setOpenMenu] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ar = lang === 'ar';

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  const run = async (opt: ExportOption) => {
    if (opt.download) {
      setBusyKey(opt.key);
      try { await opt.download(); }
      catch (e: any) { notify(e?.message || (ar ? 'تعذّر تجهيز الملف' : 'Could not prepare the file'), 'error'); }
      setBusyKey(null); setOpenMenu(false);
      return;
    }
    // A sheet the caller could not build (e.g. a tab with nothing to export) is skipped instead of crashing the menu.
    let sheets = (opt.sheets || []).filter(Boolean);
    if (opt.resolve) {
      setBusyKey(opt.key);
      try { sheets = ((await opt.resolve()) || []).filter(Boolean); }
      catch (e: any) { notify(e?.message || (ar ? 'تعذّر تجهيز الملف' : 'Could not prepare the file'), 'error'); setBusyKey(null); return; }
      setBusyKey(null);
    }
    setOpenMenu(false);
    // Counts what is above the table too: a day with a wallet and no movements is a valid file (opening and closing balance) and was rejected as 'no data'.
    const total = (sheets || []).reduce(
      (n, s) => n + (s.rows?.length || 0) + (s.above || []).reduce((m, b) => m + (b.rows?.length || 0), 0), 0);
    if (!total) { notify(ar ? 'لا توجد بيانات للتصدير' : 'No data to export'); return; }
    const date = new Date().toISOString().slice(0, 10);
    exportMultiSheet((sheets || []).map((s) => ({ name: s.name, data: s.rows, columns: s.columns, above: s.above, title: s.title })), `${fileName}-${date}`);
  };

  // One export button look across the platform: a clear green with a table icon, a color no other button on the screen has. `variant` stays in the API so callers need no change, but it no longer differs.
  const btnCls = `inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[13px] font-bold shadow-sm transition-colors disabled:opacity-60 ${className}`;
  const btnText = label || (ar ? 'تصدير Excel' : 'Export Excel');

  if (options.length === 1) {
    return (
      <button type="button" disabled={!!busyKey} onClick={() => run(options[0])} className={btnCls}>
        <FileSpreadsheet className="w-4 h-4" /> {busyKey ? (ar ? '…جارٍ' : '…') : btnText}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpenMenu((v) => !v)} className={btnCls}>
        <FileSpreadsheet className="w-4 h-4" /> {btnText} <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {openMenu && (
        <div className={`absolute z-30 mt-1 min-w-[230px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 ${ar ? 'left-0' : 'right-0'}`}>
          {options.map((opt) => {
            const count = (opt.sheets || []).filter(Boolean).reduce((n, s) => n + (s.rows?.length || 0), 0);
            const busy = busyKey === opt.key;
            return (
              <button
                key={opt.key} type="button" disabled={opt.disabled || !!busyKey}
                onClick={() => run(opt)}
                className="w-full text-start px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center justify-between gap-3"
              >
                <span>{opt.label}</span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {busy ? (ar ? '…جارٍ' : '…') : (opt.resolve ? (opt.hint || '') : count)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
