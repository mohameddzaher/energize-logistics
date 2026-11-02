/**
 * Filter options computed from the rows on screen.
 * Why local: the small HR screens (contracts, custody, licenses, stock) load fully and filter in the browser, so a server call to count values already on screen is wasted work.
 */
import type { FilterFieldDef, FilterValues } from '@/components/system/FilterPanel';

export interface LocalFieldDef<T> {
  key: string; ar: string; en: string;
  groupAr?: string; groupEn?: string;
  /** The value displayed for this row; filtering compares against the same value. */
  get: (row: T) => string | number | boolean | null | undefined;
}

const show = (v: unknown) => (v === true ? 'نعم' : v === false ? 'لا'
  : (v === null || v === undefined || v === '' ? '—' : String(v)));

/** Whether the row passes all filters; `skip` is excluded to compute that field's own counts. */
export function passes<T>(row: T, defs: LocalFieldDef<T>[], values: FilterValues, skip?: string) {
  return defs.every((d) => {
    if (d.key === skip) return true;
    const sel = String(values[d.key] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!sel.length) return true;
    return sel.includes(show(d.get(row)));
  });
}

/** Rows remaining after the filters. */
export const applyLocalFilters = <T>(rows: T[], defs: LocalFieldDef<T>[], values: FilterValues) =>
  rows.filter((r) => passes(r, defs, values));

/** Panel options: each value and its count after the other filters. */
export function localFilterFields<T>(rows: T[], defs: LocalFieldDef<T>[], values: FilterValues): FilterFieldDef[] {
  return defs.map((d) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!passes(r, defs, values, d.key)) continue;
      const v = show(d.get(r));
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return {
      key: d.key, ar: d.ar, en: d.en, groupAr: d.groupAr, groupEn: d.groupEn,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    };
  });
}
