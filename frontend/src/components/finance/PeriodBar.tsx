'use client';
/** Period chooser shared by the finance and data-support pages: preset periods or a typed range (Riyadh calendar days). */
import { useState } from 'react';
import { presetRange } from '@/lib/financeDept';

const PRESETS = [
  { key: 'month', ar: 'هذا الشهر', en: 'This month' },
  { key: 'lastMonth', ar: 'الشهر السابق', en: 'Last month' },
  { key: 'quarter', ar: 'آخر 3 شهور', en: 'Last 3 months' },
  { key: 'year', ar: 'هذه السنة', en: 'This year' },
];

export function usePeriod() {
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(presetRange('month'));
  const pick = (k: string) => { setPreset(k); if (k !== 'custom') setRange(presetRange(k)); };
  return { preset, range, pick, setRange: (r: { from: string; to: string }) => { setPreset('custom'); setRange(r); } };
}

export function PeriodBar({ period, ar }: { period: ReturnType<typeof usePeriod>; ar: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {PRESETS.map((p) => (
        <button key={p.key} type="button" onClick={() => period.pick(p.key)}
          className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${period.preset === p.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
          {ar ? p.ar : p.en}
        </button>
      ))}
      <span className="text-slate-300 mx-1">|</span>
      <label className="text-[12px] text-slate-500">{ar ? 'من' : 'From'}</label>
      <input type="date" value={period.range.from} max={period.range.to}
        onChange={(e) => e.target.value && period.setRange({ ...period.range, from: e.target.value })}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12.5px]" dir="ltr" />
      <label className="text-[12px] text-slate-500">{ar ? 'إلى' : 'To'}</label>
      <input type="date" value={period.range.to} min={period.range.from}
        onChange={(e) => e.target.value && period.setRange({ ...period.range, to: e.target.value })}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12.5px]" dir="ltr" />
    </div>
  );
}
