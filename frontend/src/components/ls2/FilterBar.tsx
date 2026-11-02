'use client';
// One filter bar for all screens.
// Rules: (1) the count sits on the chip itself, and a zero-count chip is dimmed rather than hidden, since 'none stopped' is information. (2) Filtering is client-side on the same displayed list, so a chip count always equals the rows it opens. (3) Filters combine and a clear-filters button shows the visible count, so no one hunts for a row hidden by a forgotten filter.
import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { flexNormalize } from '@/lib/flexMatch';

export type Chip = {
  key: string;
  label: string;
  /** The condition. If absent, this chip is 'all'. */
  test?: (row: any) => boolean;
  /** Accent color, taken from the same section palette. */
  tone?: 'slate' | 'green' | 'amber' | 'blue' | 'violet' | 'red' | 'sky' | 'orange';
};

const TONES: Record<string, { on: string; off: string; dot: string }> = {
  slate: { on: 'bg-slate-900 text-white border-slate-900', off: 'bg-white text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  green: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'bg-white text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  amber: { on: 'bg-amber-500 text-white border-amber-500', off: 'bg-white text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  blue: { on: 'bg-[#12325c] text-white border-[#12325c]', off: 'bg-white text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  violet: { on: 'bg-violet-600 text-white border-violet-600', off: 'bg-white text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  red: { on: 'bg-rose-600 text-white border-rose-600', off: 'bg-white text-rose-800 border-rose-200', dot: 'bg-rose-500' },
  sky: { on: 'bg-sky-600 text-white border-sky-600', off: 'bg-white text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  // Orange between amber and pink: 'critical' is stronger than 'warning' and weaker than 'expired'; the three sit side by side and must grade by eye.
  orange: { on: 'bg-orange-600 text-white border-orange-600', off: 'bg-white text-orange-800 border-orange-200', dot: 'bg-orange-500' },
};

/** Returns the filtered rows plus counts per chip. Counts are computed on the list before chip filtering and after search, so the number means 'what you get if you click here'. */
export function useChipFilter<T>(rows: T[], chips: Chip[], active: string, query: string, searchIn: (r: T) => (string | number | null | undefined)[]) {
  // Unified folding, see lib/flexMatch. This used to fold hamza and ta marbuta but not whitespace, so a plate pasted with two spaces did not match the stored one-space plate.
  const norm = flexNormalize;

  return useMemo(() => {
    const q = norm(query);
    const searched = !q ? rows : rows.filter((r) => searchIn(r).some((x) => norm(x).includes(q)));
    const counts: Record<string, number> = {};
    for (const c of chips) counts[c.key] = c.test ? searched.filter(c.test).length : searched.length;
    const chip = chips.find((c) => c.key === active);
    const shown = chip?.test ? searched.filter(chip.test) : searched;
    return { shown, counts, total: rows.length, searched: searched.length };
  }, [rows, chips, active, query, searchIn]);
}

export default function FilterBar({
  chips, counts, active, onChange, query, onQuery, placeholder, shown, total, ar, children,
}: {
  chips: Chip[];
  counts: Record<string, number>;
  active: string;
  onChange: (key: string) => void;
  query?: string;
  onQuery?: (v: string) => void;
  placeholder?: string;
  shown: number;
  total: number;
  ar: boolean;
  /** Extra page-specific filters (tracked, duration...) */
  children?: React.ReactNode;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const filtered = active !== chips[0]?.key || !!query?.trim();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const on = active === c.key;
          const n = counts[c.key] ?? 0;
          const tone = TONES[c.tone || 'slate'];
          const empty = n === 0 && !!c.test;
          return (
            <button key={c.key} type="button"
              onClick={() => onChange(on && c.test ? chips[0].key : c.key)}
              disabled={empty}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border transition
                ${on ? tone.on : tone.off} ${empty ? 'opacity-45 cursor-default' : 'hover:border-slate-400'}`}>
              {!on && c.test && <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />}
              {c.label}
              <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {(onQuery || children) && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          {onQuery && (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={query || ''} onChange={(e) => onQuery(e.target.value)}
                placeholder={placeholder || t('بحث…', 'Search…')}
                className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-[13px] w-64 max-w-full" />
            </div>
          )}
          {children}
          {filtered && (
            <button type="button"
              onClick={() => { onChange(chips[0].key); onQuery?.(''); }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 text-[12.5px] text-slate-700 hover:text-slate-900 hover:border-slate-400">
              <X className="w-3.5 h-3.5" />{t('إلغاء الفلترة', 'Clear')}
            </button>
          )}
          <span className="ms-auto text-[12.5px] font-semibold text-slate-700 whitespace-nowrap">
            {shown === total
              ? t(`${total}`, `${total}`)
              : t(`${shown} من ${total}`, `${shown} of ${total}`)}
          </span>
        </div>
      )}
    </div>
  );
}
