'use client';
// Leave dates: «يوم واحد» picks one day (start = end), «عدة أيام» a start and an end.
import { useState } from 'react';
import DatePair from '@/components/hr/DatePair';

export default function LeaveDatesInput({ startDate, endDate, onChange, ar, disabled, fromLabel, toLabel }: {
  startDate: string; endDate: string; onChange: (v: { startDate: string; endDate: string }) => void;
  ar: boolean; disabled?: boolean; fromLabel: string; toLabel: string;
}) {
  const [single, setSingle] = useState(!!startDate && startDate === endDate);
  const t = (a: string, e: string) => (ar ? a : e);
  const pick = (one: boolean) => {
    setSingle(one);
    if (one) onChange({ startDate, endDate: startDate });
  };
  const seg = (on: boolean) => `px-3 py-1.5 text-[13px] font-bold rounded-lg ${on ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`;
  return (
    <div className="space-y-2">
      <div className="inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        <button type="button" className={seg(single)} onClick={() => pick(true)} disabled={disabled}>{t('يوم واحد', 'One day')}</button>
        <button type="button" className={seg(!single)} onClick={() => pick(false)} disabled={disabled}>{t('عدة أيام', 'Several days')}</button>
      </div>
      {single ? (
        <DatePair label={`${t('يوم الإجازة', 'Leave day')} *`} ar={ar} value={startDate} disabled={disabled}
          onChange={(v) => onChange({ startDate: v, endDate: v })} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <DatePair label={`${fromLabel} *`} ar={ar} value={startDate} disabled={disabled}
            onChange={(v) => onChange({ startDate: v, endDate: endDate && endDate < v ? v : endDate })} />
          <DatePair label={`${toLabel} *`} ar={ar} value={endDate} min={startDate || undefined} disabled={disabled || !startDate}
            onChange={(v) => onChange({ startDate, endDate: v })} />
        </div>
      )}
    </div>
  );
}
