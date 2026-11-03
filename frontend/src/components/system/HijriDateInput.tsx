'use client';
/**
 * Hijri (Umm al-Qura) date picker: a calendar to pick from, not a text box to type into.
 * It reads and writes the Gregorian YYYY-MM-DD, the only stored value, so the Hijri and the Gregorian beside it are one date and stay in step.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fromHijri, toHijriParts } from '@/lib/hijri';

const MONTHS_AR = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const MONTHS_EN = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qa'dah", 'Dhu al-Hijjah'];
const DAYS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const DAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const daysIn = (y: number, m: number) => (fromHijri(y, m, 30) ? 30 : 29);

export default function HijriDateInput({ value, onChange, ar, min, max, disabled, className = '' }: {
  /** Gregorian YYYY-MM-DD. */
  value: string;
  onChange: (gregorian: string) => void;
  ar: boolean;
  min?: string; max?: string;
  disabled?: boolean;
  className?: string;
}) {
  const current = useMemo(() => (value ? toHijriParts(value) : null), [value]);
  const today = useMemo(() => toHijriParts(new Date())!, []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ y: number; m: number }>(() => ({ y: current?.y || today.y, m: current?.m || today.m }));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setView({ y: current?.y || today.y, m: current?.m || today.m }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const step = (k: number) => setView((v) => {
    const m = v.m + k;
    return m < 1 ? { y: v.y - 1, m: 12 } : m > 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m };
  });
  const first = fromHijri(view.y, view.m, 1);
  const lead = first ? first.getUTCDay() : 0;
  const count = daysIn(view.y, view.m);
  const years = Array.from({ length: 141 }, (_, i) => today.y - 100 + i);
  const pick = (d: number) => {
    const g = fromHijri(view.y, view.m, d);
    if (!g) return;
    onChange(isoOf(g));
    setOpen(false);
  };
  const label = current ? `${current.y}-${pad(current.m)}-${pad(current.d)}` : '';

  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 text-start tabular-nums ${className}`} dir="ltr">
        <span className={label ? 'text-slate-900' : 'text-slate-400'}>{label || (ar ? 'سنة-شهر-يوم' : 'yyyy-mm-dd')}</span>
        <span className="flex items-center gap-1">
          {label && !disabled && (
            <span role="button" tabIndex={-1} title={ar ? 'مسح' : 'Clear'}
              onClick={(e) => { e.stopPropagation(); onChange(''); }} className="text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></span>
          )}
          <CalendarDays className="w-4 h-4 text-slate-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl" dir={ar ? 'rtl' : 'ltr'}>
          <div className="flex items-center justify-between gap-1 mb-2">
            <button type="button" onClick={() => step(-1)} className="p-1 rounded hover:bg-slate-100">{ar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}</button>
            <select value={view.m} onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
              className="rounded border border-slate-200 px-1.5 py-1 text-[12.5px] font-semibold">
              {(ar ? MONTHS_AR : MONTHS_EN).map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
            <select value={view.y} onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
              className="rounded border border-slate-200 px-1.5 py-1 text-[12.5px] font-semibold tabular-nums">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" onClick={() => step(1)} className="p-1 rounded hover:bg-slate-100">{ar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10.5px] text-slate-400 mb-1">
            {(ar ? DAYS_AR : DAYS_EN).map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: count }, (_, i) => {
              const d = i + 1;
              const g = fromHijri(view.y, view.m, d);
              const iso = g ? isoOf(g) : '';
              const out = !g || (!!min && iso < min) || (!!max && iso > max);
              const on = !!current && current.y === view.y && current.m === view.m && current.d === d;
              const isToday = today.y === view.y && today.m === view.m && today.d === d;
              return (
                <button key={d} type="button" disabled={out} onClick={() => pick(d)}
                  className={`h-8 rounded-md text-[12.5px] tabular-nums ${on ? 'bg-[#f37121] text-white font-bold'
                    : isToday ? 'border border-[#f37121] text-[#f37121] font-semibold' : 'hover:bg-slate-100 text-slate-700'} disabled:opacity-30`}>
                  {d}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-500 tabular-nums" dir="ltr">
            {current ? `${label}  ·  ${value}` : (ar ? 'اختر يومًا — يُملأ الميلادي معه' : 'Pick a day — the Gregorian follows')}
          </p>
        </div>
      )}
    </div>
  );
}
