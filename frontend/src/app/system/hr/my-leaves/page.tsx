'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarDays, Plus, Check, X, XCircle } from 'lucide-react';
import { LeaveRequest, LeaveType, LeaveBalance, LEAVE_STATUS, empName, userName, fmtDate, leaveTypeLabel, today } from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, Badge, Modal, Field, TextInput, Select, TextArea, Tabs, StatCard, Loader2 } from '@/components/hr/HRKit';

export default function MyLeavesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';

  const [tab, setTab] = useState('mine');
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [teamLeaves, setTeamLeaves] = useState<LeaveRequest[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [hasTeam, setHasTeam] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, team] = await Promise.all([
        api.get<{ leaves: LeaveRequest[]; balance: LeaveBalance | null }>('/api/hr/me/leaves'),
        api.get<{ leaves: LeaveRequest[] }>('/api/hr/team/leaves').catch(() => ({ leaves: [] })),
      ]);
      setLeaves(mine.leaves || []); setBalance(mine.balance || null);
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
    catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const cancel = async (l: LeaveRequest) => {
    if (!confirm(ar ? 'إلغاء الطلب؟' : 'Cancel request?')) return;
    try { await api.patch(`/api/hr/me/leaves/${l._id}/cancel`, {}); load(); } catch (e: any) { alert(e.message); }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!review) return;
    setBusy(true);
    try { await api.patch(`/api/hr/leaves/${review._id}/decision`, { decision, note }); setReview(null); setNote(''); load(); }
    catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  if (loading) return <Spinner />;
  const teamPending = teamLeaves.filter((l) => l.status === 'pending_manager').length;
  const tabs = [{ key: 'mine', label: ar ? 'إجازاتي' : 'My Leaves' }, ...(hasTeam ? [{ key: 'team', label: ar ? 'فريقي' : 'My Team', badge: teamPending || undefined }] : [])];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="w-5 h-5" />} title={ar ? 'إجازاتي' : 'My Leaves'}>
        {user?.linkedEmployee && <PrimaryButton onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> {ar ? 'طلب إجازة' : 'Request Leave'}</PrimaryButton>}
      </PageHeader>

      {!user?.linkedEmployee && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl p-4 text-sm">
          {ar ? 'حسابك غير مرتبط بملف موظف بعد. تواصل مع الموارد البشرية لربط حسابك حتى تتمكن من تقديم طلبات الإجازات.' : 'Your account is not linked to an employee profile yet. Contact HR to link it so you can request leave.'}
        </div>
      )}

      {balance && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={ar ? 'الاستحقاق السنوي' : 'Annual'} value={`${balance.entitlement} ${ar ? 'يوم' : 'd'}`} />
          <StatCard label={ar ? 'المتراكم' : 'Accrued'} value={`${balance.accrued} ${ar ? 'يوم' : 'd'}`} accent="text-blue-600" />
          <StatCard label={ar ? 'المستخدم' : 'Taken'} value={`${balance.taken} ${ar ? 'يوم' : 'd'}`} accent="text-amber-700" />
          <StatCard label={ar ? 'المتاح' : 'Available'} value={`${balance.available} ${ar ? 'يوم' : 'd'}`} accent={balance.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      {hasTeam && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'mine' && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{ar ? 'النوع' : 'Type'}</Th><Th>{ar ? 'من' : 'From'}</Th><Th>{ar ? 'إلى' : 'To'}</Th><Th>{ar ? 'الأيام' : 'Days'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th><Th end></Th></Tr></thead>
            <tbody>
              {leaves.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-500 py-10">{ar ? 'لا توجد طلبات' : 'No requests'}</td></tr> :
                leaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                    <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                    <Td end>{(l.status === 'pending_manager' || l.status === 'pending_hr') && <button type="button" onClick={() => cancel(l)} className="text-slate-500 hover:text-red-600" title={ar ? 'إلغاء' : 'Cancel'}><XCircle className="w-4 h-4" /></button>}</Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'team' && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{ar ? 'الموظف' : 'Employee'}</Th><Th>{ar ? 'النوع' : 'Type'}</Th><Th>{ar ? 'المدة' : 'Period'}</Th><Th>{ar ? 'الأيام' : 'Days'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th><Th end></Th></Tr></thead>
            <tbody>
              {teamLeaves.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-500 py-10">{ar ? 'لا توجد طلبات لفريقك' : 'No team requests'}</td></tr> :
                teamLeaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{userName(l.requester)}</Td>
                    <Td>{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                    <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                    <Td end>{l.status === 'pending_manager' ? <button type="button" onClick={() => { setReview(l); setNote(''); }} className="text-[#f37121] hover:underline text-xs">{ar ? 'مراجعة' : 'Review'}</button> : null}</Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Request leave modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={ar ? 'طلب إجازة' : 'Request Leave'}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={submit} disabled={saving || !form.leaveType || !form.startDate || !form.endDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تقديم' : 'Submit'}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={ar ? 'نوع الإجازة *' : 'Leave Type *'}><Select value={form.leaveType} onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}><option value="">—</option>{types.map((t) => <option key={t._id} value={t._id}>{ar ? t.nameAr : t.nameEn}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={ar ? 'من *' : 'From *'}><TextInput type="date" value={form.startDate} min={today()} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></Field>
            <Field label={ar ? 'إلى *' : 'To *'}><TextInput type="date" value={form.endDate} min={form.startDate || today()} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></Field>
          </div>
          <Field label={ar ? 'السبب / ملاحظات' : 'Reason / Notes'}><TextArea rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
          {balance && <p className="text-xs text-slate-500">{ar ? `رصيدك المتاح حاليًا: ${balance.available} يوم` : `Your available balance: ${balance.available} days`}</p>}
        </div>
      </Modal>

      {/* Team review modal */}
      <Modal open={!!review} onClose={() => setReview(null)} title={ar ? 'مراجعة طلب الفريق' : 'Review Team Request'}
        footer={review ? <>
          <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50"><X className="w-4 h-4" /> {ar ? 'رفض' : 'Reject'}</button>
          <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {ar ? 'قبول وتحويل للموارد البشرية' : 'Approve → HR'}</PrimaryButton>
        </> : undefined}>
        {review && (
          <div className="space-y-2 text-sm">
            <p><span className="text-slate-500">{ar ? 'الموظف' : 'Employee'}: </span><span className="text-slate-900">{empName(review.employee, lang)} ({userName(review.requester)})</span></p>
            <p><span className="text-slate-500">{ar ? 'النوع' : 'Type'}: </span><span className="text-slate-900">{leaveTypeLabel(review.leaveType, lang)}</span></p>
            <p><span className="text-slate-500">{ar ? 'المدة' : 'Period'}: </span><span className="text-slate-900">{fmtDate(review.startDate)} → {fmtDate(review.endDate)} ({review.days} {ar ? 'يوم' : 'd'})</span></p>
            <p><span className="text-slate-500">{ar ? 'الرصيد المتراكم' : 'Accrued balance'}: </span><span className="text-slate-900">{review.balanceSnapshot?.accrued ?? '—'} {ar ? 'يوم' : 'd'}</span> {typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0 && <span className="text-red-600">({ar ? 'يتجاوز الرصيد' : 'exceeds balance'})</span>}</p>
            {review.reason && <p className="border-t border-slate-200 pt-2"><span className="text-slate-500">{ar ? 'السبب' : 'Reason'}: </span><span className="text-slate-900">{review.reason}</span></p>}
            <div className="border-t border-slate-200 pt-2"><label className="text-slate-500 text-xs mb-1 block">{ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
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
