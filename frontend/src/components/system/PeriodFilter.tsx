'use client';
/**
 * Period filter: a day, a month, or a range between two dates.
 * From/to alone make the most common questions (today, this month) take four clicks, so the period type is chosen first. The output is always from/to as `YYYY-MM-DD`, so the consumer does not need to know which type was used.
 */
import { useState } from 'react';
import DateRangeFilter, { DateField } from '@/components/system/DateRangeFilter';
import MonthPicker from '@/components/system/MonthPicker';

export type PeriodMode = '' | 'day' | 'month' | 'range';

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** First and last day of a "YYYY-MM" key. */
export const monthBounds = (ym: string): [string, string] => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ['', ''];
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`];
};
/** What the from/to pair means: a day, a whole month, or a range. */
const modeOf = (from: string, to: string): PeriodMode => {
  if (!from && !to) return '';
  if (from && from === to) return 'day';
  if (from && to && from.slice(0, 7) === to.slice(0, 7) && monthBounds(from.slice(0, 7)).join() === `${from},${to}`) return 'month';
  return 'range';
};

export default function PeriodFilter({
  from, to, onChange, ar, modes = ['day', 'month', 'range'], className = '',
}: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
  ar: boolean;
  /** Available types; a screen measured by month only drops "day". */
  modes?: Exclude<PeriodMode, ''>[];
  className?: string;
}) {
  const [mode, setMode] = useState<PeriodMode>(() => modeOf(from, to));
  // Range cleared from outside (clear filters): the type returns to "whole period".
  const shown: PeriodMode = !from && !to && mode !== 'range' ? '' : mode;
  const pick = (m: PeriodMode) => {
    setMode(m);
    if (m === '') onChange('', '');
    else if (m === 'day') { const d = today(); onChange(d, d); }
    else if (m === 'month') { const [a, b] = monthBounds(today().slice(0, 7)); onChange(a, b); }
    else onChange(from, to && to !== from ? to : '');
  };
  const LABEL: Record<string, [string, string]> = {
    '': ['كلّ المدّة', 'All time'], day: ['يوم', 'Day'], month: ['شهر', 'Month'], range: ['فترة', 'Range'],
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold">
        {(['', ...modes] as PeriodMode[]).map((m) => (
          <button key={m || 'all'} type="button" onClick={() => pick(m)}
            className={`px-2.5 py-2 transition-colors ${shown === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {ar ? LABEL[m][0] : LABEL[m][1]}
          </button>
        ))}
      </div>
      {shown === 'day' && (
        <DateField ar={ar} value={from} onChange={(v) => onChange(v, v)} label={ar ? 'اليوم' : 'Day'} />
      )}
      {shown === 'month' && (
        <MonthPicker ar={ar} allowEmpty={false} value={from.slice(0, 7)}
          onChange={(v) => { const [a, b] = monthBounds(v); onChange(a, b); }} />
      )}
      {shown === 'range' && (
        <DateRangeFilter ar={ar} from={from} to={to} onFrom={(v) => onChange(v, to)} onTo={(v) => onChange(from, v)} />
      )}
    </div>
  );
}
