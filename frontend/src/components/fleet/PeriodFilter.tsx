'use client';
// Period filter: one component for all fleet-management pages.
// Each screen used to compute its own range, so "this month" in the list and in analytics gave two disagreeing numbers. The UI sends no bounds, only the period name (`preset`), and the server resolves it (resolvePeriod in fleetController), so two screens cannot differ on what "yesterday" means. Hence no date arithmetic here: any line computing month start in the browser reopens the same mismatch.
import { CalendarRange } from 'lucide-react';

export type Period = { preset: string; from: string; to: string; day: string };

export const EMPTY_PERIOD: Period = { preset: '', from: '', to: '', day: '' };

type PresetDef = { key: string; ar: string; en: string; future?: boolean };

// Keys match the server's definitions exactly: an unknown key silently falls back to the default, so the match is a requirement.
export const PERIOD_PRESETS: PresetDef[] = [
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: 'yesterday', ar: 'أمس', en: 'Yesterday' },
  { key: 'last_7', ar: 'آخر 7 أيام', en: 'Last 7 days' },
  { key: 'this_month', ar: 'هذا الشهر', en: 'This month' },
  { key: 'last_month', ar: 'الشهر الماضي', en: 'Last month' },
  { key: 'tomorrow', ar: 'غدًا', en: 'Tomorrow', future: true },
  { key: 'next_7', ar: 'الأيام 7 القادمة', en: 'Next 7 days', future: true },
  { key: 'next_30', ar: 'الـ30 يومًا القادمة', en: 'Next 30 days', future: true },
  { key: 'all', ar: 'كل الفترات', en: 'All time' },
];

export const presetLabel = (key: string, ar: boolean) => {
  const p = PERIOD_PRESETS.find((x) => x.key === key);
  if (p) return ar ? p.ar : p.en;
  if (key === 'day') return ar ? 'يوم محدَّد' : 'Specific day';
  if (key === 'range' || key === 'month') return ar ? 'مدى مخصَّص' : 'Custom range';
  return ar ? 'الفترة' : 'Period';
};

/** What is sent to the server; empty values are dropped to keep the page URL clean. */
export const periodParams = (p: Period): Record<string, string> => {
  const out: Record<string, string> = {};
  if (p.day) { out.day = p.day; return out; }
  if (p.from || p.to) { if (p.from) out.from = p.from; if (p.to) out.to = p.to; return out; }
  if (p.preset) out.preset = p.preset;
  return out;
};

/** Read from the page URL, so the browser back button returns to the same period. */
export const periodFromParams = (sp: URLSearchParams | null): Period => ({
  preset: sp?.get('preset') || '',
  from: sp?.get('from') || '',
  to: sp?.get('to') || '',
  day: sp?.get('day') || '',
});

export const periodIsSet = (p: Period) => !!(p.preset || p.from || p.to || p.day);

export default function PeriodFilter({
  value, onChange, lang = 'ar', showFuture = false, className = '',
}: {
  value: Period;
  onChange: (p: Period) => void;
  lang?: 'en' | 'ar';
  /** The expected-arrival screen asks about the future, not the past, so it needs future periods. */
  showFuture?: boolean;
  className?: string;
}) {
  const ar = lang === 'ar';
  // Future periods are hidden by default: "tomorrow" is meaningless on a screen that analyzes the past.
  const presets = PERIOD_PRESETS.filter((p) => showFuture || !p.future);

  // Choosing a button clears the range and the day; choosing a day or range clears the button. All three mean the same period, and keeping them together leaves the user unsure which applies.
  const pickPreset = (key: string) =>
    onChange(value.preset === key ? EMPTY_PERIOD : { preset: key, from: '', to: '', day: '' });
  const pickDay = (day: string) => onChange({ preset: '', from: '', to: '', day });
  const pickRange = (patch: Partial<Period>) =>
    onChange({ preset: '', day: '', from: value.from, to: value.to, ...patch });

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
      active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`;

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 self-center">
        <CalendarRange className="w-3.5 h-3.5" /> {ar ? 'الفترة:' : 'Period:'}
      </span>
      {presets.map((p) => (
        <button key={p.key} type="button" onClick={() => pickPreset(p.key)} className={chip(value.preset === p.key)}>
          {ar ? p.ar : p.en}
        </button>
      ))}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'يوم بعينه' : 'A day'}</label>
        <input type="date" value={value.day} onChange={(e) => pickDay(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'من' : 'From'}</label>
        <input type="date" value={value.from} onChange={(e) => pickRange({ from: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'إلى' : 'To'}</label>
        <input type="date" value={value.to} onChange={(e) => pickRange({ to: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      {periodIsSet(value) && (
        <button type="button" onClick={() => onChange(EMPTY_PERIOD)}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold self-end">
          {ar ? 'مسح الفترة' : 'Clear'}
        </button>
      )}
    </div>
  );
}

/** A bar showing the period the server resolved, not the one the UI assumed. It is not decoration: opening analytics on an implicit "current month" and searching for last month's load yields zeros with nothing on screen saying why. */
export function PeriodBanner({ period, lang = 'ar', count }: {
  period?: { from?: string; to?: string; preset?: string } | null;
  lang?: 'en' | 'ar';
  count?: number;
}) {
  const ar = lang === 'ar';
  if (!period?.from) return null;
  const d = (v?: string) => (v ? new Date(v).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  // The range end is exclusive on the server, so a day is subtracted for display; otherwise the range would look one day longer than what is computed.
  const toShown = period.to ? new Date(new Date(period.to).getTime() - 1) : null;
  const isAll = period.preset === 'all';
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
      <CalendarRange className="w-3.5 h-3.5 text-amber-600" />
      <span className="font-semibold text-slate-700">{presetLabel(period.preset || '', ar)}</span>
      {!isAll && <span className="tabular-nums">{d(period.from)} → {toShown ? d(toShown.toISOString()) : ''}</span>}
      {typeof count === 'number' && (
        <span className="ms-auto font-semibold text-slate-700">
          {ar ? `${count} نتيجة داخل هذه الفترة` : `${count} results in this period`}
        </span>
      )}
    </div>
  );
}
