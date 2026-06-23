'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarCheck, Check, X } from 'lucide-react';
import { isHRStaff, LeaveRequest, LEAVE_STATUS, empName, userName, fmtDate, leaveTypeLabel, exportToExcel, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, ExportButton, Badge, Modal, TextArea, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import { getHrLeavesTranslations } from '@/lib/translations';

export default function HRLeavesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLeavesTranslations(lang);
  const staff = isHRStaff(user?.role);

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ leaves: LeaveRequest[] }>(`/api/hr/leaves${qs}`);
      setLeaves(d.leaves || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:leave', useCallback(() => load(), [load]));

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!review) return;
    setBusy(true);
    try {
      await api.patch(`/api/hr/leaves/${review._id}/decision`, { decision, note });
      setReview(null); setNote(''); load();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  const filtered = leaves.filter((l) => {
    if (!search.trim()) return true;
    return empName(l.employee).toLowerCase().includes(search.toLowerCase()) || userName(l.requester).toLowerCase().includes(search.toLowerCase());
  });
  const pendingCount = leaves.filter((l) => l.status === 'pending_manager' || l.status === 'pending_hr').length;

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarCheck className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${pendingCount} ${tx.pending}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
          { header: 'Type', key: 'leaveType', transform: (v: any) => leaveTypeLabel(v, 'en'), width: 16 },
          { header: 'From', key: 'startDate', width: 14 },
          { header: 'To', key: 'endDate', width: 14 },
          { header: 'Days', key: 'days', width: 8 },
          { header: 'Status', key: 'status', width: 16 },
          { header: 'Reason', key: 'reason', width: 28 },
        ], `leaves-${today()}`, 'Leaves')} />
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {Object.entries(LEAVE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colPeriod}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colDays}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colBalance}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-end font-semibold px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">{tx.noRequests}</td></tr>
            ) : filtered.map((l) => {
              const over = l.balanceSnapshot && typeof l.balanceSnapshot.remainingAfter === 'number' && l.balanceSnapshot.remainingAfter < 0;
              return (
                <tr key={l._id} className="border-b border-slate-200/70 hover:bg-slate-100 cursor-pointer" onClick={() => { setReview(l); setNote(''); }}>
                  <td className="px-4 py-3 text-slate-900 font-medium">{empName(l.employee, lang)}</td>
                  <td className="px-4 py-3 text-slate-700">{leaveTypeLabel(l.leaveType, lang)}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                  <td className="px-4 py-3 text-slate-700">{l.days}</td>
                  <td className="px-4 py-3"><span className={over ? 'text-red-600' : 'text-slate-700'}>{l.balanceSnapshot?.accrued ?? '—'}{over ? ` ${tx.over}` : ''}</span></td>
                  <td className="px-4 py-3"><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></td>
                  <td className="px-4 py-3 text-end text-slate-500 text-xs">{tx.view}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!review} onClose={() => setReview(null)} title={tx.reviewTitle}
        footer={review && (review.status === 'pending_manager' || review.status === 'pending_hr') ? <>
          <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50"><X className="w-4 h-4" /> {tx.reject}</button>
          <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.approve}</PrimaryButton>
        </> : undefined}>
        {review && (
          <div className="space-y-3 text-sm">
            <Row k={tx.fieldEmployee} v={empName(review.employee, lang)} />
            <Row k={tx.fieldRequester} v={userName(review.requester)} />
            <Row k={tx.fieldType} v={leaveTypeLabel(review.leaveType, lang)} />
            <Row k={tx.fieldPeriod} v={`${fmtDate(review.startDate)} → ${fmtDate(review.endDate)} (${review.days} ${tx.dayUnit})`} />
            <Row k={tx.fieldAccrued} v={`${review.balanceSnapshot?.accrued ?? '—'} ${tx.dayUnit}`} />
            <Row k={tx.fieldRemainingAfter} v={`${review.balanceSnapshot?.remainingAfter ?? '—'} ${tx.dayUnit}`} danger={typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0} />
            <Row k={tx.fieldStatus} v={<Badge style={LEAVE_STATUS[review.status]} lang={lang} />} />
            {review.reason && <div className="border-t border-slate-200 pt-3"><span className="text-slate-500">{tx.fieldReason}: </span><span className="text-slate-900">{review.reason}</span></div>}
            {review.managerDecision?.decision && <p className="text-xs text-slate-500">{tx.managerDecision}: {review.managerDecision.decision} {review.managerDecision.note ? `— ${review.managerDecision.note}` : ''}</p>}
            {(review.status === 'pending_manager' || review.status === 'pending_hr') && (
              <div className="border-t border-slate-200 pt-3">
                <label className="text-slate-500 text-xs mb-1 block">{tx.noteOptional}</label>
                <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: React.ReactNode; danger?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className={danger ? 'text-red-600 font-medium' : 'text-slate-900'}>{v}</span></div>;
}
