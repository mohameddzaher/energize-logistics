'use client';
/**
 * Return from leave: state chip + HR actions (record return, extend, no-show).
 * Server rules live in backend utils/leaveReturn; this only collects input.
 */
import { useState } from 'react';
import { LogIn, CalendarPlus, AlertTriangle, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { today as companyToday } from '@/lib/companyDay';
import { useDialog } from '@/components/system/DialogProvider';
import type { LeaveRequest } from '@/lib/hr';

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ymd = (v?: string) => String(v || '').slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);

type Tone = 'slate' | 'blue' | 'green' | 'amber' | 'red';
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
};

/** Where an approved leave stands today. null for leaves that are not approved. */
export function leaveReturnState(l: LeaveRequest, ar: boolean, today = companyToday()): { label: string; tone: Tone } | null {
  if (l.status !== 'approved') return null;
  const start = ymd(l.startDate);
  const end = ymd(l.endDate);
  const planned = ymd(l.plannedEndDate) || end;
  if (l.returnState === 'no_show') {
    return { label: ar ? `لم يعد — مخالفة منذ ${l.noShow?.since || addDays(end, 1)}` : `Did not return — since ${l.noShow?.since || addDays(end, 1)}`, tone: 'red' };
  }
  if (l.returnState === 'returned') {
    const starts = l.workStartsOn || addDays(end, 1);
    const shift = diffDays(planned, end);
    const extra = shift < 0 ? (ar ? ` · مبكرًا ${-shift} يوم` : ` · ${-shift}d early`) : shift > 0 ? (ar ? ` · متأخرًا ${shift} يوم` : ` · ${shift}d late`) : '';
    return {
      label: ar ? `عاد — يباشر ${starts}${extra}${l.returnAuto ? ' (تلقائي)' : ''}` : `Returned — works from ${starts}${extra}${l.returnAuto ? ' (auto)' : ''}`,
      tone: shift < 0 ? 'blue' : shift > 0 ? 'amber' : 'green',
    };
  }
  if (start > today) return { label: ar ? `تبدأ ${start}` : `Starts ${start}`, tone: 'slate' };
  if (end >= today) {
    const ext = (l.extensions || []).length;
    return { label: ar ? `في الإجازة — يعود ${addDays(end, 1)}${ext ? ` · مُمدَّدة` : ''}` : `On leave — back ${addDays(end, 1)}${ext ? ' · extended' : ''}`, tone: 'blue' };
  }
  return { label: ar ? `انتهت ${end} — بانتظار العودة` : `Ended ${end} — return pending`, tone: 'amber' };
}

export function LeaveReturnChip({ leave, ar }: { leave: LeaveRequest; ar: boolean }) {
  const s = leaveReturnState(leave, ar);
  if (!s) return null;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${TONES[s.tone]}`}>{s.label}</span>;
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

type Mode = '' | 'return' | 'extend' | 'noshow';

/** Details + HR actions for one approved leave. `canAct` = HR staff. */
export function LeaveReturnPanel({ leave, ar, canAct, onDone }: { leave: LeaveRequest; ar: boolean; canAct: boolean; onDone?: () => void }) {
  const { notify, confirm } = useDialog();
  const today = companyToday();
  const [mode, setMode] = useState<Mode>('');
  const [returnDate, setReturnDate] = useState(today);
  const [sameDay, setSameDay] = useState(false);
  const [newEnd, setNewEnd] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (leave.status !== 'approved') return null;

  const start = ymd(leave.startDate);
  const end = ymd(leave.endDate);
  const planned = ymd(leave.plannedEndDate) || end;
  const manualReturn = leave.returnState === 'returned' && !leave.returnAuto;
  const started = start <= today;
  const canReturn = started && leave.returnState !== 'returned';
  const canExtend = leave.returnState !== 'returned';
  const canNoShow = end < today && !manualReturn && leave.returnState !== 'no_show';

  // Preview of the corrected leave for the return form.
  const previewEnd = returnDate ? (sameDay ? addDays(returnDate, -1) : returnDate) : '';
  const previewDays = previewEnd && previewEnd >= start ? diffDays(start, previewEnd) + 1 : 0;
  const previewShift = previewEnd ? diffDays(planned, previewEnd) : 0;

  const open = (m: Mode) => {
    setMode(mode === m ? '' : m);
    setNote('');
    // The return day is still leave by default, so an on-time return date is the end date.
    setReturnDate(end < today ? end : today);
    setSameDay(false);
    setNewEnd(addDays(end, 1));
  };

  const send = async (path: string, body: any, ok: string) => {
    setBusy(true);
    try {
      const r = await api.post<any>(`/api/hr/leaves/${leave._id}/${path}`, body);
      const bal = r?.balance?.available;
      notify(`${ok}${typeof bal === 'number' ? (ar ? ` — الرصيد المتاح ${bal} يوم` : ` — available balance ${bal}`) : ''}`, 'success');
      setMode('');
      onDone?.();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error'); }
    setBusy(false);
  };

  const submitReturn = () => {
    if (!returnDate) return;
    send('return', { returnDate, startsSameDay: sameDay, note }, ar ? 'سُجِّلت العودة' : 'Return recorded');
  };
  const submitExtend = () => {
    if (!newEnd || newEnd <= end) { notify(ar ? 'اختر تاريخ نهاية بعد النهاية الحالية' : 'Pick an end date after the current one', 'error'); return; }
    send('extend', { newEndDate: newEnd, note }, ar ? 'مُدِّدت الإجازة' : 'Leave extended');
  };
  const submitNoShow = async () => {
    const ok = await confirm({
      title: ar ? 'تسجيل مخالفة عدم العودة؟' : 'Record a no-show?',
      message: ar
        ? `انتهت الإجازة في ${end}. يصبح الموظف «لا يعمل — لم يعد من الإجازة» من ${addDays(end, 1)} حتى تُسجَّل عودته أو تُمدَّد الإجازة.`
        : `The leave ended on ${end}. The employee becomes "not working — did not return" from ${addDays(end, 1)} until a return or extension is recorded.`,
      confirmLabel: ar ? 'تسجيل المخالفة' : 'Record',
    });
    if (ok) send('no-show', { note }, ar ? 'سُجِّلت المخالفة' : 'No-show recorded');
  };

  const state = leaveReturnState(leave, ar, today);
  const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50';

  return (
    <div className="border-t border-slate-200 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-slate-500">{ar ? 'العودة من الإجازة' : 'Return from leave'}</span>
        {state && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TONES[state.tone]}`}>{state.label}</span>}
      </div>
      {planned !== end && (
        <p className="text-xs text-slate-500">{ar ? `النهاية المخططة ${planned} — الفعلية ${end}` : `Planned end ${planned} — actual ${end}`}</p>
      )}
      {leave.returnState === 'returned' && (
        <p className="text-xs text-slate-500">
          {ar
            ? `تاريخ العودة ${leave.returnedOn || '—'} · يباشر العمل ${leave.workStartsOn || '—'}${leave.returnCountsAsWork ? ' (يوم العودة يوم عمل)' : ''}${leave.returnRecordedByName ? ` · سجّلها ${leave.returnRecordedByName}` : ''}`
            : `Returned ${leave.returnedOn || '—'} · works from ${leave.workStartsOn || '—'}${leave.returnCountsAsWork ? ' (return day is a work day)' : ''}${leave.returnRecordedByName ? ` · by ${leave.returnRecordedByName}` : ''}`}
        </p>
      )}
      {leave.returnState === 'no_show' && leave.noShow?.note && (
        <p className="text-xs text-red-700">{leave.noShow.note}{leave.noShow.byName ? ` — ${leave.noShow.byName}` : ''}</p>
      )}
      {!!(leave.extensions || []).length && (
        <ul className="text-xs text-slate-600 space-y-0.5">
          {(leave.extensions || []).map((x, i) => (
            <li key={i}>
              {ar ? `تمديد: ${x.fromEnd} → ${x.toEnd} (+${x.days} يوم)` : `Extended: ${x.fromEnd} → ${x.toEnd} (+${x.days}d)`}
              {x.byName ? ` · ${x.byName}` : ''}{x.note ? ` · ${x.note}` : ''}
            </li>
          ))}
        </ul>
      )}

      {canAct && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canReturn && (
            <button type="button" onClick={() => open('return')} className={`${btn} ${mode === 'return' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
              <LogIn className="w-4 h-4" /> {ar ? 'تسجيل عودة' : 'Record return'}
            </button>
          )}
          {canExtend && (
            <button type="button" onClick={() => open('extend')} className={`${btn} ${mode === 'extend' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
              <CalendarPlus className="w-4 h-4" /> {ar ? 'تمديد' : 'Extend'}
            </button>
          )}
          {canNoShow && (
            <button type="button" onClick={() => open('noshow')} className={`${btn} ${mode === 'noshow' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}>
              <AlertTriangle className="w-4 h-4" /> {ar ? 'مخالفة — لم يعد' : 'No-show'}
            </button>
          )}
        </div>
      )}

      {canAct && mode === 'return' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
          <label className="text-slate-500 text-xs block">{ar ? 'تاريخ العودة' : 'Return date'}</label>
          <input type="date" className={inputCls} value={returnDate} min={start} max={today} onChange={(e) => setReturnDate(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={sameDay} onChange={(e) => setSameDay(e.target.checked)} />
            {ar ? 'يبدأ العمل في نفس يوم العودة (يوم العودة يُحسب عملًا لا إجازة)' : 'Starts work on the return day (the return day counts as work)'}
          </label>
          {returnDate && (
            <p className="text-xs text-slate-600">
              {ar
                ? `يباشر العمل ${sameDay ? returnDate : addDays(returnDate, 1)} · الإجازة ${start} → ${previewEnd} (${previewDays} يوم)`
                : `Works from ${sameDay ? returnDate : addDays(returnDate, 1)} · leave ${start} → ${previewEnd} (${previewDays}d)`}
              {previewShift < 0 && (ar ? ` · يُعاد ${-previewShift} يوم إلى رصيده` : ` · ${-previewShift}d back to the balance`)}
              {previewShift > 0 && (ar ? ` · يُخصم ${previewShift} يوم إضافي من رصيده` : ` · ${previewShift}d extra charged`)}
            </p>
          )}
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'} />
          <button type="button" disabled={busy || !returnDate || !previewDays} onClick={submitReturn} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {ar ? 'حفظ العودة' : 'Save return'}
          </button>
        </div>
      )}

      {canAct && mode === 'extend' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
          <label className="text-slate-500 text-xs block">{ar ? `النهاية الجديدة (الحالية ${end})` : `New end date (current ${end})`}</label>
          <input type="date" className={inputCls} value={newEnd} min={addDays(end, 1)} onChange={(e) => setNewEnd(e.target.value)} />
          {newEnd > end && (
            <p className="text-xs text-slate-600">{ar ? `+${diffDays(end, newEnd)} يوم تُخصم من الرصيد · يعود ${addDays(newEnd, 1)}` : `+${diffDays(end, newEnd)}d charged · back ${addDays(newEnd, 1)}`}</p>
          )}
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ar ? 'سبب التمديد (اختياري)' : 'Reason (optional)'} />
          <button type="button" disabled={busy || !(newEnd > end)} onClick={submitExtend} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {ar ? 'حفظ التمديد' : 'Save extension'}
          </button>
        </div>
      )}

      {canAct && mode === 'noshow' && (
        <div className="rounded-lg border border-red-200 bg-red-50/40 p-3 space-y-2">
          <p className="text-xs text-red-700">{ar ? 'لم يعد بعد انتهاء الإجازة ولم تُمدَّد — ليست تمديدًا.' : 'Did not come back and the leave was not extended.'}</p>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'} />
          <button type="button" disabled={busy} onClick={submitNoShow} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {ar ? 'تسجيل المخالفة' : 'Record no-show'}
          </button>
        </div>
      )}
    </div>
  );
}
