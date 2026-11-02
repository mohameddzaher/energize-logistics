'use client';
/**
 * Excel-style column filter for any table, written once as a hook: filters apply last, after search and chips, and the value is read with the same function that renders the cell and writes the export.
 * Usage: const cf = useColumnFilters<Row>(); cf.apply(rows, { plate: (r) => r.plateNumber }); cf.header('plate', rows, getter, ar)
 */
import { useState, useCallback, useMemo } from 'react';
import { ColumnFilter } from '@/components/ColumnFilter';

/** A stable empty set, so a new one is not built every render and the panel reset. */
const EMPTY: Set<string> = new Set();

/** The text filtered on: empty means "(empty)" in the list. */
export const cellText = (v: any): string =>
  (v === null || v === undefined || v === '' ? '' : String(v));

export function useColumnFilters<T = any>() {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});

  const setFilter = useCallback((key: string, sel: Set<string>) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (sel.size) next[key] = sel; else delete next[key];
      return next;
    });
  }, []);

  const clear = useCallback(() => setFilters({}), []);
  const count = Object.keys(filters).length;

  /** Applied last: on what chips and search left, not on the raw records. */
  const apply = useCallback(
    (rows: T[], getters: Record<string, (r: T) => any>): T[] => {
      const keys = Object.keys(filters);
      if (!keys.length) return rows;
      return rows.filter((r) => keys.every((k) => {
        const g = getters[k];
        return !g || filters[k].has(cellText(g(r)));
      }));
    },
    [filters],
  );

  /**
   * The funnel in the column header. `rows` are those shown before column filters.
   * `format` is for a column whose value is a code but whose text differs ("valid" reads as the Arabic valid label): filter on the code and display the text, otherwise the list shows English codes.
   */
  const header = useCallback(
    (key: string, rows: T[], getter: (r: T) => any, ar: boolean, format?: (v: any) => string) => (
      <ColumnFilter
        rows={rows as any[]}
        field={key}
        valueOf={(r: any) => cellText(getter(r))}
        format={format}
        selected={filters[key] || EMPTY}
        onChange={(sel) => setFilter(key, sel)}
        lang={ar ? 'ar' : 'en'} />
    ),
    [filters, setFilter],
  );

  return useMemo(() => ({ filters, setFilter, clear, count, apply, header }),
    [filters, setFilter, clear, count, apply, header]);
}

/** "Clear column filters" button, shown when there is something to clear. */
export function ClearColumnFilters({ count, onClear, ar }: { count: number; onClear: () => void; ar: boolean }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClear}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
      {ar ? `مسح فلاتر الأعمدة (${count})` : `Clear column filters (${count})`}
    </button>
  );
}
