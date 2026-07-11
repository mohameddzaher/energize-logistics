'use client';
// Shared period picker for the Location Solutions filters — preset chips
// (this month / last month / last 7·30 days…) plus custom from/to date inputs.
// Emits a { from, to } range (YYYY-MM-DD) whenever the selection changes.
import { CalendarRange } from 'lucide-react';
import { rangePresets, type DateRange, type Lang } from '@/lib/ls2';

export default function RangePicker({
  value, onChange, lang, labelFrom = 'From', labelTo = 'To',
}: {
  value: DateRange; onChange: (r: DateRange) => void; lang: Lang; labelFrom?: string; labelTo?: string;
}) {
  const presets = rangePresets(lang);
  const isActive = (r: DateRange) => r.from === value.from && r.to === value.to;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
      <span className="flex items-center gap-1.5 text-slate-500 text-xs font-medium px-1">
        <CalendarRange className="w-4 h-4 text-[#f37121]" />
      </span>
      {presets.map((p) => {
        const active = isActive(p.range());
        return (
          <button key={p.key} type="button" onClick={() => onChange(p.range())}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {p.label}
          </button>
        );
      })}
      <div className="flex items-center gap-1.5 ms-auto">
        <label className="text-xs text-slate-400">{labelFrom}</label>
        <input type="date" value={value.from} max={value.to}
          onChange={(e) => onChange({ from: e.target.value, to: value.to })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700" />
        <label className="text-xs text-slate-400">{labelTo}</label>
        <input type="date" value={value.to} min={value.from}
          onChange={(e) => onChange({ from: value.from, to: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700" />
      </div>
    </div>
  );
}
