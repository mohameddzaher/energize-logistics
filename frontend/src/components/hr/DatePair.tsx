'use client';
/**
 * Contracts tabs: one menu entry with two views.
 * Contracts is the work register (create, renew, end); Contract data shows the contract columns in the HR file with their state and what is missing.
 */
import { useState } from 'react';
import { gregorianToHijri, hijriToGregorian } from '@/lib/hijri';
import { pairLabels } from '@/lib/hrDates';

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60';
const labelCls = 'text-slate-500 text-xs mb-1 block';

// Arabic-Indic and Persian digits typed from the Arabic keyboard are read as Latin.
const latinDigits = (s: string) => s
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
  .replace(/[.\s]+/g, '-');

type Draft = { text: string; forValue: string } | null;

export default function DatePair({
  label, value, onChange, ar, min, max, disabled, autoFocus, inputClassName,
}: {
  /** Base label from which "... Gregorian" and "... Hijri" are derived; without it, plain Gregorian/Hijri labels are used. */
  label?: string;
  /** Gregorian yyyy-mm-dd; the only value stored and sent. */
  value: string;
  onChange: (gregorian: string) => void;
  ar: boolean;
  /** Gregorian date bounds, applied to both fields. */
  min?: string; max?: string;
  disabled?: boolean; autoFocus?: boolean;
  inputClassName?: string;
}) {
  const g = (value || '').slice(0, 10);
  // What the user is typing in the Hijri field now. `forValue` ties it to the Gregorian value it was typed against: if the Gregorian changes from outside (another row, a renew button) the draft is dropped and the Hijri follows the value, with no `useEffect` re-formatting under the fingers.
  const [draft, setDraft] = useState<Draft>(null);
  const live = draft && draft.forValue === g ? draft : null;
  const text = live ? live.text : gregorianToHijri(g);

  const parsed = live && live.text.trim() ? hijriToGregorian(latinDigits(live.text.trim())) : '';
  const outOfRange = !!parsed && ((!!min && parsed < min) || (!!max && parsed > max));
  const invalid = !!live && !!live.text.trim() && (!parsed || outOfRange);

  const onHijri = (raw: string) => {
    const t = raw.trim();
    if (!t) { setDraft(null); if (g) onChange(''); return; }
    const next = hijriToGregorian(latinDigits(t));
    const ok = !!next && !(min && next < min) && !(max && next > max);
    // Only a complete valid date is converted; anything less leaves the Gregorian as it was.
    setDraft({ text: raw, forValue: ok ? next : g });
    if (ok && next !== g) onChange(next);
  };

  const [gl, hl] = label ? pairLabels(label, ar) : [ar ? 'ميلادي' : 'Gregorian', ar ? 'هجري' : 'Hijri'];
  const message = invalid
    ? (outOfRange
      ? (ar ? 'التاريخ خارج المدّة المسموح بها' : 'Date is out of the allowed range')
      : (ar ? 'تاريخ هجري غير صحيح — بقي التاريخ السابق كما هو' : 'Not a valid Hijri date — the previous date was kept'))
    : '';

  const gregorian = (
    <div>
      <label className={labelCls}>{gl}</label>
      <input type="date" value={g} min={min} max={max} disabled={disabled} autoFocus={autoFocus}
        onChange={(e) => { setDraft(null); onChange(e.target.value); }}
        className={`${inputCls} border-slate-200 ${inputClassName || ''}`} />
    </div>
  );
  const hijri = (
    <div>
      <label className={labelCls}>{hl}</label>
      <input type="text" dir="ltr" inputMode="numeric" placeholder="1448-05-01" value={text} disabled={disabled}
        aria-invalid={invalid || undefined}
        title={ar ? 'اكتب التاريخ الهجري (سنة-شهر-يوم) — يُحوَّل إلى الميلادي في الحال' : 'Type the Hijri date (year-month-day) — the Gregorian follows at once'}
        onChange={(e) => onHijri(e.target.value)}
        // On blur the canonical format is restored if the typed value is valid; an invalid one stays visible to be fixed.
        onBlur={() => { if (!invalid) setDraft(null); }}
        className={`${inputCls} tabular-nums text-start ${invalid ? 'border-red-400 bg-red-50' : 'border-slate-200'} ${inputClassName || ''}`} />
      {message && <p className="text-[11px] text-red-600 mt-1">{message}</p>}
    </div>
  );

  // A full-width row with two fields: in the form grid the pair takes the whole row (`col-span-full`) wherever it sits and however many columns there are, so the Hijri field never drops alone onto a line under an unrelated field.
  return <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-3">{gregorian}{hijri}</div>;
}
