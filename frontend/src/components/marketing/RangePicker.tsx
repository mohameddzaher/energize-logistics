'use client';
// A from/to date pair with quick presets, shared by the Marketing dashboard,
// activity log and report pages so all three read the same way.
import { type DateRange, type Lang, lastNDays, thisMonthToDate } from '@/lib/marketing';

export default function RangePicker({ value, onChange, lang }: { value: DateRange; onChange: (r: DateRange) => void; lang: Lang }) {
  const ar = lang === 'ar';
  const inputCls = 'px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
  const preset = (label: string, r: DateRange) => (
    <button key={label} type="button" onClick={() => onChange(r)}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${value.from === r.from && value.to === r.to ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={inputCls} aria-label={ar ? 'من تاريخ' : 'From date'} />
      <span className="text-slate-400 text-sm">→</span>
      <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={inputCls} aria-label={ar ? 'إلى تاريخ' : 'To date'} />
      <span className="w-px h-5 bg-slate-200 mx-1" />
      {preset(ar ? '٧ أيام' : '7 days', lastNDays(7))}
      {preset(ar ? '٣٠ يوم' : '30 days', lastNDays(30))}
      {preset(ar ? 'هذا الشهر' : 'This month', thisMonthToDate())}
      {preset(ar ? '٩٠ يوم' : '90 days', lastNDays(90))}
    </div>
  );
}
