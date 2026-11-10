'use client';
/**
 * Approval chain as shown: four-station stepper and request dialog.
 * A request has a history (who approved and when, who asked and the reply), not one status. Kept in one place so the four pages do not drift apart.
 */
import { LeaveRequest, LEAVE_STAGES, LeaveStage, userName, leaveHasNoManagerStage } from '@/lib/hr';
import { bothDatesShort } from '@/lib/hrDates';
import { Check, X, HelpCircle, Clock, MessageSquare, Paperclip } from 'lucide-react';

const STAGE_INDEX: Record<string, number> = { manager: 0, hr: 1, finance: 2, executive: 3 };

/** State of each station for this request: done, stopped at it, or not reached yet. */
function stageState(leave: LeaveRequest, stage: LeaveStage): 'done' | 'rejected' | 'current' | 'asked' | 'waiting' {
  const d = leave[LEAVE_STAGES.find((s) => s.key === stage)!.decision] as any;
  if (d?.decision === 'rejected') return 'rejected';
  if (d?.decision === 'approved') return 'done';
  if (leave.currentStage === stage) return 'current';
  // Returned to the requester with a question: the asking station is the last question in the dialog.
  if (leave.status === 'info_requested') {
    const lastQ = [...(leave.thread || [])].reverse().find((t) => t.kind === 'question');
    if (lastQ?.stage === stage) return 'asked';
  }
  if (leave.status === 'approved') return 'done';
  return 'waiting';
}

const LOOK: Record<string, { ring: string; dot: string; icon: any }> = {
  done: { ring: 'border-green-300 bg-green-50', dot: 'bg-green-600 text-white', icon: Check },
  rejected: { ring: 'border-red-300 bg-red-50', dot: 'bg-red-600 text-white', icon: X },
  current: { ring: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500 text-white', icon: Clock },
  asked: { ring: 'border-orange-300 bg-orange-50', dot: 'bg-orange-500 text-white', icon: HelpCircle },
  waiting: { ring: 'border-slate-200 bg-white', dot: 'bg-slate-200 text-slate-500', icon: Clock },
};

/** Shown to process viewers only (seesLeaveProcess); `full` false renders nothing. */
export function LeaveChainBar({ leave, lang, full = false }: { leave: LeaveRequest; lang: 'ar' | 'en'; full?: boolean }) {
  const ar = lang === 'ar';
  if (!full) return null;
  // A cancelled or rejected request has no advancing stepper; stations are shown as they stopped.
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {LEAVE_STAGES.filter((s) => !(s.key === 'manager' && leaveHasNoManagerStage(leave))).map((s, i) => {
        const st = stageState(leave, s.key);
        const look = LOOK[st];
        const Icon = look.icon;
        const d = leave[s.decision] as any;
        return (
          <div key={s.key} className={`flex min-w-[8.5rem] flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 ${look.ring}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${look.dot}`}>
              {st === 'waiting' ? i + 1 : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-slate-700">{ar ? s.ar : s.en}</span>
              <span className="block text-[10px] text-slate-500">
                {d?.at ? `${userName(d.by) || ''} · ${bothDatesShort(d.at, ar)}`
                  : st === 'current' ? (ar ? 'بانتظار القرار' : 'awaiting decision')
                  : st === 'asked' ? (ar ? 'طلب إيضاحًا' : 'asked for info')
                  : (ar ? '—' : '—')}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Request dialog: questions and replies in order, oldest first. Who asked (the stage) is named to process viewers only. */
export function LeaveThread({ leave, lang, full = false }: { leave: LeaveRequest; lang: 'ar' | 'en'; full?: boolean }) {
  const ar = lang === 'ar';
  const thread = leave.thread || [];
  if (!thread.length) return null;
  const stageLabel = (k?: string) => (full ? LEAVE_STAGES.find((s) => s.key === k)?.[ar ? 'ar' : 'en'] : '') || (ar ? 'المراجعة' : 'Review');
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <MessageSquare className="h-3.5 w-3.5" />{ar ? 'المراسلات على الطلب' : 'Request conversation'}
      </p>
      {thread.map((t, i) => (
        <div key={i} className={`rounded-lg border p-2.5 text-xs ${t.kind === 'question' ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">
              {t.kind === 'question' ? `${stageLabel(t.stage)} ${ar ? '— استفسار' : '— asked'}` : (ar ? 'ردّ الموظف' : 'Employee reply')}
            </span>
            {(full || t.kind !== 'question') && <span>{t.byName || userName(t.by)}</span>}
            {t.at && <span>· {bothDatesShort(t.at, ar)}</span>}
          </div>
          <p className="whitespace-pre-wrap text-slate-700">{t.text}</p>
          {t.attachment && (
            <a href={t.attachment} target="_blank" rel="noreferrer"
               className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline">
              <Paperclip className="h-3 w-3" />{t.attachmentName || (ar ? 'مرفق' : 'attachment')}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export { STAGE_INDEX };
