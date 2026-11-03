'use client';
/**
 * One date as two fields: Gregorian and Hijri, both picked from a calendar.
 * Only the Gregorian YYYY-MM-DD is stored and sent; the Hijri is the same date shown and chosen in Umm al-Qura, so the two never disagree.
 */
import { toDateInput } from '@/lib/hrMaster';
import HijriDateInput from '@/components/system/HijriDateInput';
import { pairLabels } from '@/lib/hrDates';

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60';
const labelCls = 'text-slate-500 text-xs mb-1 block';

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
  // Any stored form (day/month/year text included) opens as yyyy-mm-dd, so the Gregorian box is never blank beside a Hijri.
  const g = toDateInput(value);
  const [gl, hl] = label ? pairLabels(label, ar) : [ar ? 'ميلادي' : 'Gregorian', ar ? 'هجري' : 'Hijri'];

  const gregorian = (
    <div>
      <label className={labelCls}>{gl}</label>
      <input type="date" value={g} min={min} max={max} disabled={disabled} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} border-slate-200 ${inputClassName || ''}`} />
    </div>
  );
  const hijri = (
    <div>
      <label className={labelCls}>{hl}</label>
      {/* A calendar to pick from: the Hijri is chosen, never typed, and fills the Gregorian at once. */}
      <HijriDateInput value={g} onChange={onChange} ar={ar} min={min} max={max} disabled={disabled}
        className={`${inputCls} border-slate-200 ${inputClassName || ''}`} />
    </div>
  );

  // A full-width row with two fields: in the form grid the pair takes the whole row (`col-span-full`) wherever it sits and however many columns there are, so the Hijri field never drops alone onto a line under an unrelated field.
  return <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-3">{gregorian}{hijri}</div>;
}
