'use client';
/** Leave approvals: what awaits the current user's decision. One page for every stage (direct manager, HR, top management). The server decides what is shown (`utils/leaveChain.inboxFilter`), so the page never guesses a role or filters after reading and no button ends in a 403. The third action is "inquiry", not reject: the request returns to its owner to answer, then restarts from the direct manager. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarCheck, Check, X, HelpCircle, Inbox, Loader2 } from 'lucide-react';
import {
  LeaveRequest, LEAVE_STATUS, LEAVE_STAGES, LeaveStage,
  empName, userName, leaveTypeLabel,
} from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, Badge, Modal, TextArea, Tabs, SearchInput } from '@/components/hr/HRKit';
import { LeaveChainBar, LeaveThread } from '@/components/hr/LeaveChain';
import { bothPeriod } from '@/lib/hrDates';
import { AttachmentList } from '@/components/system/FilePicker';
import { DeductionChoice, DeductionBadge, needsDeductionChoice } from '@/components/hr/LeaveDeduction';

type Decision = 'approved' | 'rejected' | 'info';

export default function LeaveApprovalsPage() {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [stages, setStages] = useState<LeaveStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('all');
  const [q, setQ] = useState('');

  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [deduct, setDeduct] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: LeaveRequest[]; stages: LeaveStage[] }>('/api/hr/leaves/inbox');
      setLeaves(d.leaves || []); setStages(d.stages || []);
    } catch { setLeaves([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live without refresh: a decision at one stage moves the request from one list to another.
  useSocket('hr:leave', useCallback(() => load(), [load]));

  // Tabs come only from stages that have work, so no empty tab.
  const present = useMemo(
    () => LEAVE_STAGES.filter((s) => leaves.some((l) => l.currentStage === s.key)),
    [leaves],
  );
  const tabs = useMemo(() => [
    { key: 'all', label: ar ? 'الكل' : 'All', badge: leaves.length },
    ...present.map((s) => ({
      key: s.key, label: ar ? s.ar : s.en,
      badge: leaves.filter((l) => l.currentStage === s.key).length,
    })),
  ], [present, leaves, ar]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leaves
      .filter((l) => tab === 'all' || l.currentStage === tab)
      .filter((l) => !needle || [
        empName(l.employee, lang), userName(l.requester), leaveTypeLabel(l.leaveType, lang), l.reason,
      ].some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [leaves, tab, q, lang]);

  const decide = async (decision: Decision) => {
    if (!review) return;
    if (decision !== 'approved' && !note.trim()) {
      notify(ar
        ? (decision === 'info' ? 'اكتب استفسارك حتى يعرف الموظّف بمَ يردّ.' : 'اكتب سببَ الرفض.')
        : (decision === 'info' ? 'Write your question so the employee knows what to answer.' : 'Write the reason for rejection.'),
        'error');
      return;
    }
    const withChoice = decision === 'approved' && needsDeductionChoice(review);
    if (withChoice && deduct === null) {
      notify(ar ? 'اختر: تُخصم من الرصيد أم بدون خصم.' : 'Choose whether the leave is deducted from the balance.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/hr/leaves/${review._id}/decision`, { decision, note, ...(withChoice ? { deductBalance: deduct } : {}) });
      setReview(null); setNote('');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<CalendarCheck className="w-6 h-6" />}
        title={ar ? 'موافقات الإجازات' : 'Leave Approvals'}
        subtitle={stages.length
          ? (ar ? `محطّاتك: ${stages.map((s) => LEAVE_STAGES.find((x) => x.key === s)?.ar).filter(Boolean).join(' · ')}`
                : `Your stages: ${stages.map((s) => LEAVE_STAGES.find((x) => x.key === s)?.en).filter(Boolean).join(' · ')}`)
          : undefined}
      />

      {!leaves.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">{ar ? 'لا شيء ينتظر قرارك' : 'Nothing awaits your decision'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {ar ? 'يظهر هنا كلُّ طلب إجازة وصل محطّتك — طلباتُ فريقك إن كنت مديرًا مباشرًا، وما أحاله غيرُك إليك.'
                : 'Every leave request that reaches your stage shows up here — your team’s requests if you are a direct manager, and whatever earlier stages passed on.'}
          </p>
        </div>
      ) : (
        <>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          <SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو نوع الإجازة أو السبب…' : 'Search by name, leave type or reason…'} />

          <div className="space-y-3">
            {rows.map((l) => (
              <div key={l._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{empName(l.employee, lang) || userName(l.requester)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {leaveTypeLabel(l.leaveType, lang)} · {bothPeriod(l.startDate, l.endDate, ar)} · {l.days} {ar ? 'يوم' : 'days'}
                    </p>
                    {l.reason && <p className="mt-1 max-w-2xl text-xs text-slate-600">{l.reason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge style={LEAVE_STATUS[l.status]} lang={lang} />
                    <DeductionBadge leave={l} ar={ar} />
                    <PrimaryButton onClick={() => { setReview(l); setNote(''); setDeduct(null); }}>
                      {ar ? 'مراجعة' : 'Review'}
                    </PrimaryButton>
                  </div>
                </div>
                <LeaveChainBar leave={l} lang={ar ? 'ar' : 'en'} />
              </div>
            ))}
            {!rows.length && (
              <p className="py-10 text-center text-sm text-slate-500">{ar ? 'لا نتائج لهذا البحث' : 'No matches'}</p>
            )}
          </div>
        </>
      )}

      <Modal open={!!review} onClose={() => setReview(null)} wide
        title={ar ? 'مراجعة طلب إجازة' : 'Review leave request'}
        footer={review ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => decide('rejected')} disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-500/30 disabled:opacity-50">
              <X className="h-4 w-4" /> {ar ? 'رفض' : 'Reject'}
            </button>
            {/* A request that needs clarification is not rejected; it returns to its owner with a question. */}
            <button type="button" onClick={() => decide('info')} disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-orange-500/20 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-500/30 disabled:opacity-50">
              <HelpCircle className="h-4 w-4" /> {ar ? 'استفسار / طلب تعديل' : 'Ask / request change'}
            </button>
            <PrimaryButton onClick={() => decide('approved')} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {ar ? 'موافقة' : 'Approve'}
            </PrimaryButton>
          </div>
        ) : undefined}>
        {review && (
          <div className="space-y-3 text-sm">
            <LeaveChainBar leave={review} lang={ar ? 'ar' : 'en'} />
            <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Row label={ar ? 'الموظف' : 'Employee'} value={`${empName(review.employee, lang)} (${userName(review.requester)})`} />
              <Row label={ar ? 'النوع' : 'Type'} value={leaveTypeLabel(review.leaveType, lang)} />
              <Row label={ar ? 'الفترة' : 'Period'} value={`${bothPeriod(review.startDate, review.endDate, ar)} (${review.days} ${ar ? 'يوم' : 'd'})`} />
              <Row label={ar ? 'الرصيد المستحق' : 'Accrued balance'}
                value={<>
                  {review.balanceSnapshot?.accrued ?? '—'} {ar ? 'يوم' : 'd'}
                  {typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0 && (
                    <span className="text-red-600"> ({ar ? 'يتجاوز الرصيد' : 'exceeds balance'})</span>
                  )}
                </>} />
              {review.reason && <Row label={ar ? 'السبب' : 'Reason'} value={review.reason} />}
            </div>

            {!!((review as any).attachments || []).length && (
              <div>
                <p className="mb-1 text-xs text-slate-500">{ar ? 'مرفقات الموظّف' : 'Employee attachments'}</p>
                <AttachmentList items={(review as any).attachments} />
              </div>
            )}

            <LeaveThread leave={review} lang={ar ? 'ar' : 'en'} />

            {needsDeductionChoice(review) && (
              <div className="border-t border-slate-200 pt-3">
                <DeductionChoice value={deduct} onChange={setDeduct} leave={review} ar={ar} />
              </div>
            )}

            <div className="border-t border-slate-200 pt-3">
              <label className="mb-1 block text-xs text-slate-500">
                {ar ? 'ملاحظتك — مطلوبة مع الرفض ومع الاستفسار' : 'Your note — required when rejecting or asking'}
              </label>
              <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={ar ? 'مثال: عليه سلفة 500 ريال تُسدَّد قبل السفر — أرفق الإيصال.' : 'e.g. A 500 SAR advance must be settled first — attach the receipt.'} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <p><span className="text-slate-500">{label}: </span><span className="text-slate-900">{value}</span></p>
);
