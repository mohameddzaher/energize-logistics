'use client';
/**
 * Month picker: year and month selects instead of `input type="month"`.
 * Desktop Safari and Firefox render type="month" as a plain text box with no picker or validation, a silent failure used on twelve screens. Two selects work in every browser and read in Arabic month names rather than the native English "2026-09". The value stays "YYYY-MM" so callers and the server are unchanged.
 */
import { useMemo } from 'react';

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthPicker({
  value, onChange, ar, className, fromYear, toYear, allowEmpty = true, label,
}: {
  /** "YYYY-MM" or empty. */
  value: string;
  onChange: (v: string) => void;
  ar: boolean;
  className?: string;
  /** Year bounds; default 2023 to next year. */
  fromYear?: number;
  toYear?: number;
  /** Whether "no month" is accepted: filter screens allow it, entry screens do not. */
  allowEmpty?: boolean;
  label?: string;
}) {
  const now = new Date();
  const y0 = fromYear ?? 2023;
  const y1 = toYear ?? now.getFullYear() + 1;
  const years = useMemo(
    () => Array.from({ length: Math.max(1, y1 - y0 + 1) }, (_, i) => y1 - i),
    [y0, y1],
  );

  const [curY, curM] = (value || '').split('-');
  const months = ar ? MONTHS_AR : MONTHS_EN;
  const box = 'px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

  /** Changing one side fills the other with the current value, so no half-written value remains. */
  const emit = (y: string, m: string) => {
    if (!y && !m) { onChange(''); return; }
    const yy = y || String(now.getFullYear());
    const mm = m || String(now.getMonth() + 1).padStart(2, '0');
    onChange(`${yy}-${mm}`);
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className || ''}`} role="group" aria-label={label || (ar ? 'اختر الشهر' : 'Pick month')}>
      <select
        value={curM || ''}
        onChange={(e) => emit(curY || '', e.target.value)}
        aria-label={ar ? 'الشهر' : 'Month'}
        className={box}
      >
        {allowEmpty && <option value="">{ar ? 'الشهر' : 'Month'}</option>}
        {months.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>
        ))}
      </select>
      <select
        value={curY || ''}
        onChange={(e) => emit(e.target.value, curM || '')}
        aria-label={ar ? 'السنة' : 'Year'}
        className={box}
      >
        {allowEmpty && <option value="">{ar ? 'السنة' : 'Year'}</option>}
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
    </span>
  );
}
