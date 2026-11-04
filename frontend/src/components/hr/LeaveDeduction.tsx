'use client';
/**
 * HR's balance choice on a leave: deducted from the balance, or leave without deduction.
 * The server refuses an HR-stage approval without it (code DEDUCTION_CHOICE_REQUIRED), so every approve path renders or asks it.
 */
import { useCallback, useState } from 'react';
import { MinusCircle, CircleSlash, UserCheck } from 'lucide-react';
import { LeaveRequest, leaveDeducts } from '@/lib/hr';
import { Modal } from '@/components/hr/HRKit';

/** Is the request at the HR stage, where approving needs the choice? */
export const needsDeductionChoice = (l?: LeaveRequest | null) => !!l && (l.status === 'pending_hr' || l.currentStage === 'hr');

/** The choice is preselected from nothing: HR must press one. */
export function DeductionChoice({ value, onChange, leave, ar }: {
  value: boolean | null; onChange: (v: boolean) => void; leave?: LeaveRequest | null; ar: boolean;
}) {
  const days = leave?.days ?? 0;
  const typeDeducts = leave?.leaveType?.affectsBalance !== false;
  const opt = (v: boolean, label: string, hint: string, Icon: any) => (
    <button type="button" onClick={() => onChange(v)}
      className={`flex-1 min-w-[10rem] rounded-lg border p-2.5 text-start transition-colors ${value === v
        ? (v ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500')
        : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Icon className="h-4 w-4" />{label}</span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
    </button>
  );
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-slate-700">
        {ar ? 'رصيد الإجازات — اختيار الموارد البشرية (مطلوب للموافقة)' : 'Leave balance — HR choice (required to approve)'}
      </p>
      <div className="flex flex-wrap gap-2">
        {opt(true, ar ? 'تُخصم من الرصيد' : 'Deduct from balance', ar ? `يُخصم ${days} يوم من الرصيد عند اعتمادها` : `${days} day(s) come off once approved`, MinusCircle)}
        {opt(false, ar ? 'بدون خصم من الرصيد' : 'Without deduction', ar ? 'تُسجَّل الإجازة ولا يتغيّر الرصيد' : 'Recorded; the balance does not change', CircleSlash)}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {ar ? `نوع الإجازة في الإعدادات: ${typeDeducts ? 'يُخصم' : 'لا يُخصم'}` : `Leave type default: ${typeDeducts ? 'deducted' : 'not deducted'}`}
      </p>
    </div>
  );
}

/** Small badge: what the balance does with this leave, and whether a manager filed it. */
export function DeductionBadge({ leave, ar }: { leave: LeaveRequest; ar: boolean }) {
  const decided = typeof leave.deductsBalance === 'boolean';
  const cut = leaveDeducts(leave);
  return (
    <>
      {(decided || leave.status === 'approved') && (
        <span title={decided ? '' : (ar ? 'بحسب نوع الإجازة' : 'from the leave type')}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cut ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {cut ? <MinusCircle className="h-3 w-3" /> : <CircleSlash className="h-3 w-3" />}
          {cut ? (ar ? 'تُخصم من الرصيد' : 'Deducted') : (ar ? 'بدون خصم' : 'No deduction')}
        </span>
      )}
      {leave.filedByManager && (
        <span title={leave.filedByName || ''} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
          <UserCheck className="h-3 w-3" />{ar ? 'قدّمها المدير' : 'Filed by manager'}
        </span>
      )}
    </>
  );
}

/** For one-click approvals: asks the choice in a dialog and resolves it, or null when dismissed. */
export function useDeductionAsk(ar: boolean) {
  const [pending, setPending] = useState<{ leave: LeaveRequest; resolve: (v: boolean | null) => void } | null>(null);
  const [value, setValue] = useState<boolean | null>(null);
  const ask = useCallback((leave: LeaveRequest) => new Promise<boolean | null>((resolve) => {
    setValue(null);
    setPending({ leave, resolve });
  }), []);
  const close = (v: boolean | null) => { pending?.resolve(v); setPending(null); };
  const dialog = (
    <Modal open={!!pending} onClose={() => close(null)} title={ar ? 'الموافقة على الإجازة' : 'Approve leave'}
      footer={<>
        <button type="button" onClick={() => close(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" disabled={value === null} onClick={() => close(value)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {ar ? 'موافقة' : 'Approve'}
        </button>
      </>}>
      {pending && <DeductionChoice value={value} onChange={setValue} leave={pending.leave} ar={ar} />}
    </Modal>
  );
  return { ask, dialog };
}
