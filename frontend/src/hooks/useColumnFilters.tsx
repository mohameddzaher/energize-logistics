'use client';
/**
 * Excel-style column filters for any table in three lines.
 * Tables lacked filters, and adding one per page needed state, a filter function, a value reader per column and edits to every th. All of that now lives here:
 * const cf = useColumnFilters(getters, rows, lang); cf.apply(rows); cf.head(key, label).
 * Rule: the value read is the value filtered.
 */
import { useMemo, useState, useCallback } from 'react';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';

export type ValueReaders<T> = Record<string, (row: T) => any>;

export interface ColumnFiltersApi<T> {
  /** What the user picked for each column. */
  selected: Record<string, Set<string>>;
  /** Number of columns that have a selection. */
  activeCount: number;
  /** Filters the rows by the selection. */
  apply: (rows: T[]) => T[];
  /** Column header: the title with its filter. */
  head: (key: string, label: React.ReactNode) => React.ReactNode;
  /** The filter alone, for a hand-built header. */
  filterFor: (key: string) => React.ReactNode;
  clear: () => void;
  clearOne: (key: string) => void;
}

export function useColumnFilters<T>(
  readers: ValueReaders<T>,
  rows: T[],
  lang: 'ar' | 'en',
  opts?: { options?: Record<string, ColumnFilterOption[]> },
): ColumnFiltersApi<T> {
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const set = useCallback((key: string, v: Set<string>) => {
    setSelected((p) => {
      const n = { ...p };
      if (v.size) n[key] = v; else delete n[key];
      return n;
    });
  }, []);

  const keys = Object.keys(selected);
  const sig = JSON.stringify(keys.map((k) => [k, [...selected[k]].sort()]));

  const apply = useCallback((list: T[]) => {
    if (!keys.length) return list;
    return list.filter((r) => keys.every((k) => {
      const read = readers[k];
      const v = read ? read(r) : (r as any)?.[k];
      return selected[k].has(v == null ? '' : String(v));
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, readers]);

  // The option list is built from rows not filtered by this column. Built from the displayed rows, the other values would vanish after the first pick and the user could not add a second value to the selection, as in Excel.
  const rowsFor = useMemo(() => {
    const out: Record<string, T[]> = {};
    for (const k of Object.keys(readers)) {
      const others = keys.filter((x) => x !== k);
      out[k] = others.length
        ? rows.filter((r) => others.every((o) => {
          const read = readers[o];
          const v = read ? read(r) : (r as any)?.[o];
          return selected[o].has(v == null ? '' : String(v));
        }))
        : rows;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sig, readers]);

  const filterFor = useCallback((key: string) => (
    <ColumnFilter
      rows={rowsFor[key] || rows}
      field={key}
      valueOf={readers[key]}
      options={opts?.options?.[key]}
      selected={selected[key] || new Set()}
      onChange={(v) => set(key, v)}
      lang={lang}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [rowsFor, rows, selected, lang, set, opts?.options]);

  const head = useCallback((key: string, label: React.ReactNode) => (
    <span className="inline-flex items-center gap-1">{label}{filterFor(key)}</span>
  ), [filterFor]);

  return {
    selected,
    activeCount: keys.length,
    apply,
    head,
    filterFor,
    clear: () => setSelected({}),
    clearOne: (key: string) => set(key, new Set()),
  };
}

export default useColumnFilters;
