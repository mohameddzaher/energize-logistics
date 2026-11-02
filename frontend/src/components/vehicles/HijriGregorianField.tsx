'use client';
import { useState, useEffect } from 'react';
import { toHijriPlain, fromHijri } from '@/lib/vehicleRegistry';

/**
 * Paired Hijri and Gregorian inputs for one date; editing either updates the other.
 * Only the Gregorian value is stored; the Hijri value is derived (toHijri/fromHijri in lib/vehicleRegistry). A partial Hijri entry leaves the Gregorian value untouched until it is complete.
 */
export default function HijriGregorianField({
  value, onChange, ar, inp, min, max, autoFocus,
}: {
  value: string; onChange: (v: string) => void; ar: boolean; inp: string;
  /** Gregorian date bounds (YYYY-MM-DD), applied to both inputs. */
  min?: string; max?: string; autoFocus?: boolean;
}) {
  const [hijri, setHijri] = useState(() => toHijriPlain(value));
  // The min bound must also apply to the Hijri input: the Gregorian input enforces it natively, but the Hijri text input does not.
  const [outOfRange, setOutOfRange] = useState(false);
  // The date can change from outside (another row opened, a renew button), so the Hijri text follows it unless the user is typing in it.
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setHijri(toHijriPlain(value)); }, [value, typing]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <input type="date" value={value || ''} onChange={(e) => { setOutOfRange(false); onChange(e.target.value); }}
          className={inp} min={min} max={max} autoFocus={autoFocus} />
        <p className="text-[10px] text-slate-400 mt-0.5">{ar ? 'ميلادي' : 'Gregorian'}</p>
      </div>
      <div>
        <input
          type="text" dir="ltr" inputMode="numeric" placeholder="1448/04/04"
          value={hijri}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(e) => {
            setHijri(e.target.value);
            const g = fromHijri(e.target.value);
            if (!g) return;
            if ((min && g < min) || (max && g > max)) { setOutOfRange(true); return; }
            setOutOfRange(false);
            onChange(g);
          }}
          className={`${inp} font-mono`} />
        <p className={`text-[10px] mt-0.5 ${outOfRange ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
          {outOfRange
            ? (ar ? 'التاريخ خارج المسموح' : 'Date out of range')
            : (ar ? 'هجري — يُسمِع الميلاديّ' : 'Hijri — fills the Gregorian')}
        </p>
      </div>
    </div>
  );
}

