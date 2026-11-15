'use client';
// Where an employee request stands and every hand-over it went through (backend utils/requestRouting).
import { ArrowLeftRight, CheckCircle2, Clock, UserCheck } from 'lucide-react';
import type { HRRequest } from '@/lib/hr';
import { fmtDateTime } from '@/lib/hr';

export type Target = { key: string; ar: string; en: string };

const ACTION: Record<string, { ar: string; en: string }> = {
  created: { ar: 'قُدِّم الطلب', en: 'Submitted' },
  forwarded: { ar: 'حُوِّل', en: 'Forwarded' },
  in_progress: { ar: 'بدأ التنفيذ', en: 'Started' },
  resolved: { ar: 'أُنجز', en: 'Resolved' },
  rejected: { ar: 'رُفض', en: 'Rejected' },
  closed: { ar: 'أُغلق', en: 'Closed' },
  cancelled: { ar: 'ألغاه صاحبه', en: 'Cancelled by the requester' },
  status: { ar: 'تغيّرت الحالة', en: 'Status changed' },
};

export const targetName = (key: string | null | undefined, targets: Target[], ar: boolean) => {
  if (!key) return '';
  if (key === 'manager') return ar ? 'المدير المباشر' : 'Direct manager';
  const t = targets.find((x) => x.key === key);
  return t ? (ar ? t.ar : t.en) : key;
};
const personName = (u: any) => (u && typeof u === 'object' ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

/** One line: who holds the request now. */
export function whereNow(r: HRRequest, targets: Target[], ar: boolean) {
  const stage = r.stage || (['open', 'in_progress', 'received'].includes(r.status) ? 'department' : 'done');
  if (stage === 'manager') return `${ar ? 'عند المدير المباشر' : 'With the direct manager'}${personName(r.manager) ? ` — ${personName(r.manager)}` : ''}`;
  if (stage === 'department') return `${ar ? 'عند' : 'With'} ${targetName(r.targetSection || 'HR', targets, ar)}`;
  return ar ? 'منتهٍ' : 'Finished';
}

export default function RequestRoute({ r, targets, ar }: { r: HRRequest; targets: Target[]; ar: boolean }) {
  const stage = r.stage || 'department';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
        {stage === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Clock className="w-4 h-4 text-amber-600" />}
        {whereNow(r, targets, ar)}
      </p>
      {(r.history || []).length > 0 && (
        <ol className="space-y-1.5 border-s-2 border-slate-200 ps-3">
          {(r.history || []).map((h, i) => (
            <li key={i} className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">{(ar ? ACTION[h.action]?.ar : ACTION[h.action]?.en) || h.action}</span>
              {h.action === 'forwarded' && (
                <span className="inline-flex items-center gap-1 mx-1">
                  <ArrowLeftRight className="w-3 h-3" />
                  {targetName(h.fromSection, targets, ar)} {ar ? '←' : '→'} {targetName(h.toSection, targets, ar)}
                </span>
              )}
              {h.action === 'created' && h.toSection && <span className="mx-1">{ar ? 'إلى' : 'to'} {targetName(h.toSection, targets, ar)}</span>}
              {h.byName && <span className="text-slate-500 inline-flex items-center gap-1 mx-1"><UserCheck className="w-3 h-3" />{h.byName}</span>}
              <span className="text-slate-400 tabular-nums" dir="ltr">{fmtDateTime(h.at)}</span>
              {h.note && <p className="text-slate-600 mt-0.5 whitespace-pre-wrap">{h.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
