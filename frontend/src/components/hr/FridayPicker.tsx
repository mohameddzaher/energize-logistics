'use client';
/**
 * HR's choice at its stage: every Friday in the period is a leave day, unless HR ticks it out (it is then not a leave day and not off the balance), e.g. the Friday that closes a month away.
 * The server checks the same (hrController.checkExcludedFridays) and recounts the days, so the profile and balance follow at once.
 */
import { fridaysOf, countLeaveDays } from '@/lib/hr';

const dmy = (d: string) => d.split('-').reverse().join('/');

export default function FridayPicker({ startDate, endDate, value, onChange, ar }: {
  startDate: string; endDate: string; value: string[]; onChange: (v: string[]) => void; ar: boolean;
}) {
  const fridays = fridaysOf(startDate, endDate);
  if (!fridays.length) return null;
  const off = value.filter((d) => fridays.includes(d));
  const total = fridays.length;
  const counted = countLeaveDays(startDate, endDate) - off.length;
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 space-y-2">
      <p className="text-sm font-semibold text-sky-900">
        {ar ? `في هذه الإجازة ${total === 1 ? 'يوم جمعة واحد' : `${total} أيام جمعة`} — كلها تُحسب من أيام الإجازة.` : `This leave has ${total} Friday${total > 1 ? 's' : ''} — all counted as leave days.`}
      </p>
      <p className="text-xs text-sky-800">
        {ar ? 'إن أردت ألا تُحسب جمعةٌ معيّنة إجازةً (فلا تُخصم من الرصيد) فاخترها:' : 'To not count a Friday as leave (not off the balance), pick it:'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {fridays.map((d) => {
          const on = off.includes(d);
          return (
            <button key={d} type="button" onClick={() => onChange(on ? off.filter((x) => x !== d) : [...off, d])}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border tabular-nums ${on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-sky-800 border-sky-300 hover:bg-sky-100'}`}>
              {ar ? 'جمعة' : 'Fri'} {dmy(d)}{on ? (ar ? ' — لا تُحسب' : ' — not counted') : ''}
            </button>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-slate-700">
        {ar ? `أيام الإجازة بعد الاختيار: ${counted} يوم` : `Leave days after this: ${counted} day(s)`}
      </p>
    </div>
  );
}
