'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarDays, Plus, Check, X, XCircle } from 'lucide-react';
import { LeaveRequest, LeaveType, LeaveBalance, LEAVE_STATUS, empName, userName, fmtDate, leaveTypeLabel, today } from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, Badge, Modal, Field, TextInput, Select, TextArea, Tabs, StatCard, Loader2 } from '@/components/hr/HRKit';
import { getHrMyLeavesTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';
import { Download } from 'lucide-react';

export default function MyLeavesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrMyLeavesTranslations(lang);

  const [tab, setTab] = useState('mine');
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [teamLeaves, setTeamLeaves] = useState<LeaveRequest[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [hasTeam, setHasTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  // Backend truth — the login-cached user object may predate the employee
  // link, which used to show "not linked" to accounts that were linked fine.
  const [linked, setLinked] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, team] = await Promise.all([
        api.get<{ leaves: LeaveRequest[]; balance: LeaveBalance | null; linked?: boolean }>('/api/hr/me/leaves'),
        api.get<{ leaves: LeaveRequest[] }>('/api/hr/team/leaves').catch(() => ({ leaves: [] })),
      ]);
      setLeaves(mine.leaves || []); setBalance(mine.balance || null);
      setLinked(mine.linked !== false);
      setTeamLeaves(team.leaves || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:leave', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ leaveTypes: LeaveType[] }>('/api/hr/leave-types').then((d) => setTypes(d.leaveTypes || [])).catch(() => {});
    api.get<{ hasTeam: boolean }>('/api/hr/me/team').then((d) => setHasTeam(!!d.hasTeam)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.leaveType || !form.startDate || !form.endDate) return;
    setSaving(true);
    try { await api.post('/api/hr/me/leaves', form); setShowForm(false); setForm({ leaveType: '', startDate: '', endDate: '', reason: '' }); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const cancel = async (l: LeaveRequest) => {
    if (!(await confirm(tx.cancelRequestConfirm))) return;
    try { await api.patch(`/api/hr/me/leaves/${l._id}/cancel`, {}); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!review) return;
    setBusy(true);
    try { await api.patch(`/api/hr/leaves/${review._id}/decision`, { decision, note }); setReview(null); setNote(''); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  const exportMine = () => exportToExcel(leaves, [
    { header: tx.colType, key: 'leaveType', transform: (v) => leaveTypeLabel(v, lang), width: 20 },
    { header: tx.colFrom, key: 'startDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colTo, key: 'endDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colDays, key: 'days', width: 8 },
    { header: tx.colStatus, key: 'status', transform: (v) => (LEAVE_STATUS[v] ? (ar ? LEAVE_STATUS[v].ar : LEAVE_STATUS[v].en) : v), width: 16 },
  ], 'my-leaves', tx.pageTitle);

  const exportTeam = () => exportToExcel(teamLeaves, [
    { header: tx.colEmployee, key: 'requester', transform: (v) => userName(v), width: 22 },
    { header: tx.colType, key: 'leaveType', transform: (v) => leaveTypeLabel(v, lang), width: 20 },
    { header: tx.colFrom, key: 'startDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colTo, key: 'endDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colDays, key: 'days', width: 8 },
    { header: tx.colStatus, key: 'status', transform: (v) => (LEAVE_STATUS[v] ? (ar ? LEAVE_STATUS[v].ar : LEAVE_STATUS[v].en) : v), width: 16 },
  ], 'team-leaves', tx.tabTeam);

  if (loading) return <Spinner />;
  const teamPending = teamLeaves.filter((l) => l.status === 'pending_manager').length;
  const tabs = [{ key: 'mine', label: tx.tabMine }, ...(hasTeam ? [{ key: 'team', label: tx.tabTeam, badge: teamPending || undefined }] : [])];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="w-5 h-5" />} title={tx.pageTitle}>
        {linked && <PrimaryButton onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> {tx.requestLeave}</PrimaryButton>}
      </PageHeader>

      {!linked && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl p-4 text-sm">
          {tx.notLinkedNotice}
        </div>
      )}

      {balance && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={tx.annual} value={`${balance.entitlement} ${tx.dayShort}`} />
          <StatCard label={tx.accrued} value={`${balance.accrued} ${tx.dayShort}`} accent="text-blue-600" />
          <StatCard label={tx.taken} value={`${balance.taken} ${tx.dayShort}`} accent="text-amber-700" />
          <StatCard label={tx.available} value={`${balance.available} ${tx.dayShort}`} accent={balance.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      {hasTeam && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'mine' && (
        <div className="space-y-3">
        {leaves.length > 0 && (
          <div className="flex justify-end">
            <button type="button" onClick={exportMine} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm">
              <Download className="w-4 h-4" /> {ar ? 'تصدير Excel' : 'Export Excel'}
            </button>
          </div>
        )}
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{tx.colType}</Th><Th>{tx.colFrom}</Th><Th>{tx.colTo}</Th><Th>{tx.colDays}</Th><Th>{tx.colStatus}</Th><Th end></Th></Tr></thead>
            <tbody>
              {leaves.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-800 py-10">{tx.noRequests}</td></tr> :
                leaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                    <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                    <Td end>{(l.status === 'pending_manager' || l.status === 'pending_hr') && <button type="button" onClick={() => cancel(l)} className="text-slate-500 hover:text-red-600" title={tx.cancel}><XCircle className="w-4 h-4" /></button>}</Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-3">
        {teamLeaves.length > 0 && (
          <div className="flex justify-end">
            <button type="button" onClick={exportTeam} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm">
              <Download className="w-4 h-4" /> {ar ? 'تصدير Excel' : 'Export Excel'}
            </button>
          </div>
        )}
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{tx.colEmployee}</Th><Th>{tx.colType}</Th><Th>{tx.colPeriod}</Th><Th>{tx.colDays}</Th><Th>{tx.colStatus}</Th><Th end></Th></Tr></thead>
            <tbody>
              {teamLeaves.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-800 py-10">{tx.noTeamRequests}</td></tr> :
                teamLeaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{userName(l.requester)}</Td>
                    <Td>{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                    <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                    <Td end>{l.status === 'pending_manager' ? <button type="button" onClick={() => { setReview(l); setNote(''); }} className="text-[#f37121] hover:underline text-xs">{tx.review}</button> : null}</Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
        </div>
      )}

      {/* Request leave modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={tx.requestLeave}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={submit} disabled={saving || !form.leaveType || !form.startDate || !form.endDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.submit}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={tx.leaveTypeRequired}><Select value={form.leaveType} onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}><option value="">—</option>{types.map((t) => <option key={t._id} value={t._id}>{ar ? t.nameAr : t.nameEn}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx.fromRequired}><TextInput type="date" value={form.startDate} min={today()} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></Field>
            <Field label={tx.toRequired}><TextInput type="date" value={form.endDate} min={form.startDate || today()} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></Field>
          </div>
          <Field label={tx.reasonNotes}><TextArea rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
          {balance && <p className="text-xs text-slate-500">{`${tx.availableBalancePrefix} ${balance.available} ${tx.daysWord}`}</p>}
        </div>
      </Modal>

      {/* Team review modal */}
      <Modal open={!!review} onClose={() => setReview(null)} title={tx.reviewTeamRequest}
        footer={review ? <>
          <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50"><X className="w-4 h-4" /> {tx.reject}</button>
          <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.approveToHr}</PrimaryButton>
        </> : undefined}>
        {review && (
          <div className="space-y-2 text-sm">
            <p><span className="text-slate-500">{tx.colEmployee}: </span><span className="text-slate-900">{empName(review.employee, lang)} ({userName(review.requester)})</span></p>
            <p><span className="text-slate-500">{tx.colType}: </span><span className="text-slate-900">{leaveTypeLabel(review.leaveType, lang)}</span></p>
            <p><span className="text-slate-500">{tx.colPeriod}: </span><span className="text-slate-900">{fmtDate(review.startDate)} → {fmtDate(review.endDate)} ({review.days} {tx.dayShort})</span></p>
            <p><span className="text-slate-500">{tx.accruedBalance}: </span><span className="text-slate-900">{review.balanceSnapshot?.accrued ?? '—'} {tx.dayShort}</span> {typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0 && <span className="text-red-600">({tx.exceedsBalance})</span>}</p>
            {review.reason && <p className="border-t border-slate-200 pt-2"><span className="text-slate-500">{tx.reason}: </span><span className="text-slate-900">{review.reason}</span></p>}
            <div className="border-t border-slate-200 pt-2"><label className="text-slate-500 text-xs mb-1 block">{tx.noteOptional}</label><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">{children}</div>;
const Th = ({ children, end }: { children?: React.ReactNode; end?: boolean }) => <th className={`${end ? 'text-end' : 'text-start'} text-slate-300 font-semibold px-4 py-3`}>{children}</th>;
const Td = ({ children, className, end }: { children: React.ReactNode; className?: string; end?: boolean }) => <td className={`px-4 py-3 ${end ? 'text-end' : ''} text-slate-700 ${className || ''}`}>{children}</td>;
function Tr({ children, head }: { children: React.ReactNode; head?: boolean }) {
  return <tr className={head ? 'text-slate-300' : 'border-b border-slate-200/70 hover:bg-slate-100'}>{children}</tr>;
}
