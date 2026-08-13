'use client';
// Edit requests (طلبات تعديل التقييمات) — super-admin only.
//
// A manager cannot change an evaluation once submitted; they ask here and the
// super admin decides. Approving unlocks exactly ONE correction — the approval
// is consumed by the next save, so it can't become a standing permission.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Inbox, Check, X, Loader2, ExternalLink, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { canConfigurePerf, pct, type Lang } from '@/lib/performance';

interface RequestRow {
  _id: string;
  employee: string; employeeName: string; department: string; jobTitle: string;
  evaluatorName: string; periodKey: string;
  percentage: number | null; weightedScore: number | null; band: string | null;
  bonusMultiplier: number | null;
  editRequest: {
    status: 'none' | 'pending' | 'approved' | 'rejected';
    reason: string; requestedByName: string; requestedAt: string | null;
    decidedByName: string; decidedAt: string | null; decisionNote: string;
  };
}

const fmtDate = (iso?: string | null, lang: Lang = 'ar') =>
  !iso ? '—' : new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB',
    { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function PerformanceRequestsPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';

  const [pending, setPending] = useState<RequestRow[]>([]);
  const [recent, setRecent] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ row: RequestRow; decision: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ pending: RequestRow[]; recent: RequestRow[] }>('/api/performance/edit-requests');
      setPending(d.pending || []); setRecent(d.recent || []);
    } catch { /* keep last good */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('performance:editRequest', useCallback(() => load(), [load]));

  const decide = async (row: RequestRow, decision: 'approve' | 'reject', withNote: string) => {
    setBusy(row._id);
    try {
      await api.post(`/api/performance/evaluations/${row._id}/edit-decision`, { decision, note: withNote });
      setNoteFor(null); setNote('');
      await load();
    } catch (e: any) {
      notify(e?.message || (ar ? 'فشل حفظ القرار' : 'Could not record the decision'), 'error');
    }
    setBusy(null);
  };

  if (!canConfigurePerf(user?.role)) {
    return (
      <div className="p-8 text-slate-500">
        {ar ? 'هذه الصفحة للمدير العام فقط.' : 'This page is restricted to super admins.'}
      </div>
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Inbox className="w-5 h-5" />}
        title={ar ? 'طلبات تعديل التقييمات' : 'Evaluation edit requests'}
        subtitle={ar
          ? `${pending.length} طلب في انتظار قرارك`
          : `${pending.length} awaiting your decision`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label={ar ? 'قيد المراجعة' : 'Pending'} value={String(pending.length)} />
        <StatCard label={ar ? 'تمت الموافقة (آخر ٥٠)' : 'Approved (last 50)'} value={String(recent.filter((r) => r.editRequest.status === 'approved').length)} />
        <StatCard label={ar ? 'مرفوضة (آخر ٥٠)' : 'Rejected (last 50)'} value={String(recent.filter((r) => r.editRequest.status === 'rejected').length)} />
      </div>

      {/* Pending */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" /> {ar ? 'في انتظار القرار' : 'Awaiting decision'}
        </h2>
        {pending.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 shadow-sm">
            {ar ? 'لا توجد طلبات معلّقة' : 'No pending requests'}
          </div>
        ) : pending.map((r) => (
          <div key={r._id} className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{r.employeeName}</p>
                <p className="text-xs text-slate-500">
                  {[r.jobTitle, r.department].filter(Boolean).join(' · ')} · {r.periodKey}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {ar ? 'المُقيِّم: ' : 'Evaluator: '}<b className="text-slate-700">{r.evaluatorName || '—'}</b>
                  {' · '}{ar ? 'النتيجة الحالية: ' : 'Current result: '}
                  <b className="text-slate-700 tabular-nums">{pct(r.percentage)}</b>
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/system/performance/evaluate/${r.employee}?period=${r.periodKey}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" /> {ar ? 'فتح التقييم' : 'Open evaluation'}
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <p className="text-xs text-slate-500 mb-0.5">
                {ar ? 'سبب طلب التعديل' : 'Reason for the request'} — {r.editRequest.requestedByName} · {fmtDate(r.editRequest.requestedAt, lang as Lang)}
              </p>
              <p className="text-sm text-slate-800">{r.editRequest.reason || '—'}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                type="button" disabled={busy === r._id}
                onClick={() => { setNoteFor({ row: r, decision: 'approve' }); setNote(''); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy === r._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {ar ? 'موافقة — فتح التعديل' : 'Approve — unlock edit'}
              </button>
              <button
                type="button" disabled={busy === r._id}
                onClick={() => { setNoteFor({ row: r, decision: 'reject' }); setNote(''); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-600 text-sm font-medium disabled:opacity-50"
              >
                <X className="w-4 h-4" /> {ar ? 'رفض — يظل مغلقًا' : 'Reject — keep locked'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Recently decided */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-800">{ar ? 'قرارات سابقة' : 'Recent decisions'}</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'الموظف' : 'Employee'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'الفترة' : 'Period'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'المُقيِّم' : 'Evaluator'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'السبب' : 'Reason'}</th>
                    <th className="text-center font-semibold px-4 py-3">{ar ? 'القرار' : 'Decision'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'التاريخ' : 'Date'}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.employeeName}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{r.periodKey}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{r.evaluatorName || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[280px] truncate" title={r.editRequest.reason}>{r.editRequest.reason || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {r.editRequest.status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" /> {ar ? 'موافق' : 'Approved'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                            <XCircle className="w-3 h-3" /> {ar ? 'مرفوض' : 'Rejected'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(r.editRequest.decidedAt, lang as Lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Decision note dialog */}
      {noteFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setNoteFor(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800">
              {noteFor.decision === 'approve'
                ? (ar ? 'الموافقة على التعديل' : 'Approve the edit')
                : (ar ? 'رفض طلب التعديل' : 'Reject the request')}
            </h3>
            <p className="text-xs text-slate-500">
              {noteFor.decision === 'approve'
                ? (ar ? 'هيقدر يعدّل التقييم مرة واحدة، وبعدها يتقفل تاني تلقائيًا.' : 'They will be able to correct it once, then it locks again automatically.')
                : (ar ? 'التقييم هيفضل مقفول، والسبب هيظهر للمُقيِّم.' : 'The evaluation stays locked and your reason is shown to the evaluator.')}
            </p>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder={ar ? 'ملاحظة (اختيارية)' : 'Note (optional)'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
            />
            <div className="flex gap-2">
              <button
                type="button" disabled={!!busy}
                onClick={() => decide(noteFor.row, noteFor.decision, note)}
                className={`flex-1 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 ${noteFor.decision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (ar ? 'تأكيد' : 'Confirm')}
              </button>
              <button type="button" onClick={() => setNoteFor(null)} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
