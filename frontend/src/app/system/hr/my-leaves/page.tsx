'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarDays, Plus, Check, X, XCircle, AlertTriangle, ShieldCheck, Pencil, Trash2, HelpCircle, Eye, Send } from 'lucide-react';
import { LeaveRequest, LeaveType, LeaveBalance, LEAVE_STATUS, empName, userName, leaveTypeLabel, today, earliestStartDate, daysUntil } from '@/lib/hr';
import DatePair from '@/components/hr/DatePair';
import { bothPeriod, gregCell, hijriCell, pairLabels, exportDatePair } from '@/lib/hrDates';
import { Spinner, PageHeader, PrimaryButton, Badge, Modal, Field, Select, TextArea, Tabs, StatCard, Pick, Loader2, SearchableSelect } from '@/components/hr/HRKit';
import { getHrMyLeavesTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import FilePicker, { AttachmentList, type PickedFile } from '@/components/system/FilePicker';
import { LeaveChainBar, LeaveThread } from '@/components/hr/LeaveChain';
import { DeductionBadge } from '@/components/hr/LeaveDeduction';

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
  // Request supporting document. Sick leave is requested with a report; it used to be sent over chat and got lost, then was asked for two months later. It now lives with the request and is read from the employee file.
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [kept, setKept] = useState<string[]>([]);

  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // A manager files leave for the people under him (backend utils/leaveTeam); it starts at HR.
  const [members, setMembers] = useState<any[]>([]);
  const [memberBalances, setMemberBalances] = useState<Record<string, number | null>>({});
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' });
  const [teamFiles, setTeamFiles] = useState<PickedFile[]>([]);
  const [teamSaving, setTeamSaving] = useState(false);

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
  const loadMembers = useCallback(() => {
    api.get<{ members: any[]; balances: Record<string, number | null> }>('/api/hr/team/leave-members')
      .then((d) => { setMembers(d.members || []); setMemberBalances(d.balances || {}); }).catch(() => {});
  }, []);
  useEffect(() => { if (hasTeam) loadMembers(); }, [hasTeam, loadMembers]);
  useSocket('hr:leave', useCallback(() => { if (hasTeam) loadMembers(); }, [hasTeam, loadMembers]));

  const teamType = types.find((t) => t._id === teamForm.leaveType) || null;
  const teamMinStart = earliestStartDate(teamType);
  const submitTeam = async () => {
    if (!teamForm.employee || !teamForm.leaveType || !teamForm.startDate || !teamForm.endDate) return;
    setTeamSaving(true);
    try {
      await api.post('/api/hr/team/leaves', { ...teamForm, files: teamFiles.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })) });
      notify(ar ? 'قُدِّمت الإجازة — موافقتك مسجّلة، وهي الآن عند الموارد البشرية.' : 'Leave filed — your approval is recorded; it is now with HR.', 'success');
      setTeamFormOpen(false);
      setTeamForm({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' });
      setTeamFiles([]);
      load(); loadMembers();
    } catch (e: any) { notify(e.message, 'error'); }
    setTeamSaving(false);
  };
  const filedByMe = (l: LeaveRequest) => String((l.filedBy as any)?._id || l.filedBy || '') === String(user?._id || '');

  // Advance-notice policy: the picked type decides the earliest legal start date.
  const chosenType = types.find((t) => t._id === form.leaveType) || null;
  const minStart = earliestStartDate(chosenType);
  const noticeDays = chosenType?.requiresAdvanceNotice === false ? 0 : (chosenType?.minAdvanceDays ?? 30);
  const noticeViolated = !!(chosenType && noticeDays > 0 && form.startDate && form.startDate < minStart);

  // While pending, it belongs to its owner. The employee may get a date wrong, and the only fix was to cancel and rewrite, so the manager saw two requests. The door closes as soon as any decision is made: approving one date and then changing it would approve one thing and approve another.
  const [editing, setEditing] = useState<LeaveRequest | null>(null);
  const editable = (l: LeaveRequest) =>
    ['pending_manager', 'pending_hr'].includes(l.status) && !l.managerDecision?.at && !l.hrDecision?.at;
  // Cancel is available while the request is not closed, at any stage or returned for reply.
  const cancellable = (l: LeaveRequest) =>
    ['pending_manager', 'pending_hr', 'pending_finance', 'pending_executive', 'info_requested'].includes(l.status);

  const openEdit = (l: LeaveRequest) => {
    setEditing(l);
    setForm({
      leaveType: typeof l.leaveType === 'object' ? l.leaveType?._id : l.leaveType,
      startDate: l.startDate, endDate: l.endDate, reason: l.reason || '',
    });
    setFiles([]);
    setKept(((l as any).attachments || []).map((a: any) => String(a._id)));
    setShowForm(true);
  };

  const removeLeave = async (l: LeaveRequest) => {
    if (!(await confirm(ar
      ? 'حذف هذا الطلب نهائيًّا؟ لن يظهر لأحد.'
      : 'Delete this request permanently? Nobody will see it.'))) return;
    try { await api.delete(`/api/hr/me/leaves/${l._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const submit = async () => {
    if (!form.leaveType || !form.startDate || !form.endDate) return;
    if (noticeViolated) {
      notify(ar
        ? `يجب تقديم هذا الطلب قبل موعد بدايته بـ ${noticeDays} يومًا على الأقل — أقرب تاريخ متاح ${minStart}. الإجازة الطارئة والمرضية معفاة.`
        : `This leave must be requested at least ${noticeDays} days ahead — the earliest available start is ${minStart}. Emergency and sick leave are exempt.`, 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: any = { ...form, files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })) };
      if (editing) {
        // Files removed from the saved list are also deleted from disk, leaving no orphan file.
        const before = ((editing as any).attachments || []).map((a: any) => String(a._id));
        payload.removeAttachments = before.filter((id: string) => !kept.includes(id));
        await api.put(`/api/hr/me/leaves/${editing._id}`, payload);
      } else {
        await api.post('/api/hr/me/leaves', payload);
      }
      setShowForm(false); setEditing(null);
      setForm({ leaveType: '', startDate: '', endDate: '', reason: '' });
      setFiles([]); setKept([]);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const cancel = async (l: LeaveRequest) => {
    if (!(await confirm(tx.cancelRequestConfirm))) return;
    try { await api.patch(`/api/hr/me/leaves/${l._id}/cancel`, {}); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  // Reply to an inquiry. A stage asked instead of rejecting and the request returned to its owner. His reply restarts the chain from the beginning, because the request after the reply is no longer the one the manager approved.
  const [answering, setAnswering] = useState<LeaveRequest | null>(null);
  const [answer, setAnswer] = useState('');
  const [answerFiles, setAnswerFiles] = useState<PickedFile[]>([]);
  const [detail, setDetail] = useState<LeaveRequest | null>(null);

  const lastQuestion = (l: LeaveRequest) =>
    [...(l.thread || [])].reverse().find((t) => t.kind === 'question') || null;

  const sendReply = async () => {
    if (!answering || !answer.trim()) return;
    setBusy(true);
    try {
      const f = answerFiles[0];
      const r = await api.post<{ leave: LeaveRequest }>(`/api/hr/me/leaves/${answering._id}/reply`, {
        text: answer.trim(),
        attachment: f?.dataUrl, attachmentName: f?.fileName,
      });
      setAnswering(null); setAnswer(''); setAnswerFiles([]);
      // The filing manager's own reply keeps his approval, so it returns to HR, not to him.
      notify(r?.leave?.currentStage === 'hr'
        ? (ar ? 'أُرسل ردّك — عاد الطلبُ إلى الموارد البشرية.' : 'Your reply was sent — the request went back to HR.')
        : (ar ? 'أُرسل ردّك — عاد الطلبُ إلى المدير المباشر.' : 'Your reply was sent — the request went back to the direct manager.'), 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!review) return;
    setBusy(true);
    try { await api.patch(`/api/hr/leaves/${review._id}/decision`, { decision, note }); setReview(null); setNote(''); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  // Each date is two adjacent columns: Gregorian, then its derived Hijri. The "from Gregorian" label is never shown; the main name is start/end date.
  const FROM_LABEL = ar ? 'تاريخ البداية' : 'Start date';
  const TO_LABEL = ar ? 'تاريخ النهاية' : 'End date';
  const fromLabels = pairLabels(FROM_LABEL, ar);
  const toLabels = pairLabels(TO_LABEL, ar);
  const mineColumns: ExportColumn[] = [
    { header: tx.colType, key: 'leaveType', transform: (v) => leaveTypeLabel(v, lang), width: 20 },
    ...exportDatePair(FROM_LABEL, 'startDate', ar),
    ...exportDatePair(TO_LABEL, 'endDate', ar),
    { header: tx.colDays, key: 'days', width: 8 },
    { header: tx.colStatus, key: 'status', transform: (v) => (LEAVE_STATUS[v] ? (ar ? LEAVE_STATUS[v].ar : LEAVE_STATUS[v].en) : v), width: 16 },
  ];
  const teamColumns: ExportColumn[] = [
    { header: tx.colEmployee, key: 'employee', transform: (v) => empName(v, lang), width: 22 },
    { header: tx.colType, key: 'leaveType', transform: (v) => leaveTypeLabel(v, lang), width: 20 },
    ...exportDatePair(FROM_LABEL, 'startDate', ar),
    ...exportDatePair(TO_LABEL, 'endDate', ar),
    { header: tx.colDays, key: 'days', width: 8 },
    { header: tx.colStatus, key: 'status', transform: (v) => (LEAVE_STATUS[v] ? (ar ? LEAVE_STATUS[v].ar : LEAVE_STATUS[v].en) : v), width: 16 },
  ];
  // Each tab here is a self-contained scope (all my requests, all my team's requests) without search or filter, so a second scope would repeat the same file under another title.
  const scope = exportScopeLabels(ar);
  const mineExportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: tx.pageTitle, rows: leaves, columns: mineColumns }] },
  ];
  const teamExportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: tx.tabTeam, rows: teamLeaves, columns: teamColumns }] },
  ];

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
          {/* Three of the four numbers have no rows beneath them: annual balance is a policy item, accrued-to-date is a duration calculation, and available is their difference. Consumed is leave that happened and has a list below the page, so only it opens it. */}
          <StatCard label={tx.annual} value={`${balance.entitlement} ${tx.dayShort}`} />
          <StatCard label={tx.accrued} value={`${balance.accrued} ${tx.dayShort}`} accent="text-blue-600" />
          <Pick onClick={() => document.getElementById('my-leave-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <StatCard label={tx.taken} value={`${balance.taken} ${tx.dayShort}`} accent="text-amber-700" />
          </Pick>
          <StatCard label={tx.available} value={`${balance.available} ${tx.dayShort}`} accent={balance.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      {hasTeam && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'mine' && (
        <div id="my-leave-list" className="space-y-3 scroll-mt-24">
        {leaves.length > 0 && (
          <div className="flex justify-end">
            <ExportMenu fileName="my-leaves" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={mineExportOptions} />
          </div>
        )}
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{tx.colType}</Th><Th>{fromLabels[0]}</Th><Th>{fromLabels[1]}</Th><Th>{toLabels[0]}</Th><Th>{toLabels[1]}</Th><Th>{tx.colDays}</Th><Th>{tx.colStatus}</Th><Th end></Th></Tr></thead>
            <tbody>
              {leaves.length === 0 ? <tr><td colSpan={8} className="text-center text-slate-800 py-10">{tx.noRequests}</td></tr> :
                leaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{gregCell(l.startDate)}</Td><Td className="whitespace-nowrap tabular-nums"><span dir="ltr">{hijriCell(l.startDate)}</span></Td><Td className="whitespace-nowrap tabular-nums">{gregCell(l.endDate)}</Td><Td className="whitespace-nowrap tabular-nums"><span dir="ltr">{hijriCell(l.endDate)}</span></Td><Td>{l.days}</Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1.5"><Badge style={LEAVE_STATUS[l.status]} lang={lang} /><DeductionBadge leave={l} ar={ar} /></span>
                      {l.status === 'info_requested' && lastQuestion(l) && (
                        <p className="mt-1 max-w-xs truncate text-[11px] text-orange-700" title={lastQuestion(l)?.text}>
                          {lastQuestion(l)?.text}
                        </p>
                      )}
                    </Td>
                    <Td end>
                      <div className="flex items-center justify-end gap-1">
                        {editable(l) && (
                          <>
                            <button type="button" onClick={() => openEdit(l)} className="text-slate-400 hover:text-[#f37121]" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>
                            <button type="button" onClick={() => removeLeave(l)} className="text-slate-400 hover:text-red-600" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                        {l.status === 'info_requested' && (
                          <button type="button" onClick={() => { setAnswering(l); setAnswer(''); setAnswerFiles([]); }}
                            className="flex items-center gap-1 rounded-lg bg-orange-500/20 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-500/30">
                            <HelpCircle className="w-3.5 h-3.5" />{ar ? 'الردّ على الاستفسار' : 'Reply'}
                          </button>
                        )}
                        <button type="button" onClick={() => setDetail(l)} className="text-slate-400 hover:text-[#f37121]" title={ar ? 'مسار الطلب' : 'Request trail'}><Eye className="w-4 h-4" /></button>
                        {cancellable(l) && (
                          <button type="button" onClick={() => cancel(l)} className="text-slate-500 hover:text-red-600" title={tx.cancel}><XCircle className="w-4 h-4" /></button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {members.length > 0 ? (
            <PrimaryButton onClick={() => { setTeamForm({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' }); setTeamFiles([]); setTeamFormOpen(true); }}>
              <Plus className="w-4 h-4" /> {ar ? `تقديم إجازة لأحد فريقي (${members.length})` : `File leave for my team (${members.length})`}
            </PrimaryButton>
          ) : <span />}
          {teamLeaves.length > 0 && (
            <ExportMenu fileName="team-leaves" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={teamExportOptions} />
          )}
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><Tr head><Th>{tx.colEmployee}</Th><Th>{tx.colType}</Th><Th>{fromLabels[0]}</Th><Th>{fromLabels[1]}</Th><Th>{toLabels[0]}</Th><Th>{toLabels[1]}</Th><Th>{tx.colDays}</Th><Th>{tx.colStatus}</Th><Th end></Th></Tr></thead>
            <tbody>
              {teamLeaves.length === 0 ? <tr><td colSpan={9} className="text-center text-slate-800 py-10">{tx.noTeamRequests}</td></tr> :
                teamLeaves.map((l) => (
                  <Tr key={l._id}>
                    <Td className="text-slate-900">{empName(l.employee, lang) || userName(l.requester)}</Td>
                    <Td>{leaveTypeLabel(l.leaveType, lang)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{gregCell(l.startDate)}</Td><Td className="whitespace-nowrap tabular-nums"><span dir="ltr">{hijriCell(l.startDate)}</span></Td><Td className="whitespace-nowrap tabular-nums">{gregCell(l.endDate)}</Td><Td className="whitespace-nowrap tabular-nums"><span dir="ltr">{hijriCell(l.endDate)}</span></Td><Td>{l.days}</Td>
                    <Td><span className="inline-flex flex-wrap items-center gap-1.5"><Badge style={LEAVE_STATUS[l.status]} lang={lang} /><DeductionBadge leave={l} ar={ar} /></span></Td>
                    <Td end>
                      <div className="flex items-center justify-end gap-2">
                        {l.status === 'pending_manager' && <button type="button" onClick={() => { setReview(l); setNote(''); }} className="text-[#f37121] hover:underline text-xs">{tx.review}</button>}
                        {filedByMe(l) && l.status === 'info_requested' && (
                          <button type="button" onClick={() => { setAnswering(l); setAnswer(''); setAnswerFiles([]); }}
                            className="flex items-center gap-1 rounded-lg bg-orange-500/20 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-500/30">
                            <HelpCircle className="w-3.5 h-3.5" />{ar ? 'الردّ على الاستفسار' : 'Reply'}
                          </button>
                        )}
                        <button type="button" onClick={() => setDetail(l)} className="text-slate-400 hover:text-[#f37121]" title={ar ? 'مسار الطلب' : 'Request trail'}><Eye className="w-4 h-4" /></button>
                        {filedByMe(l) && cancellable(l) && (
                          <button type="button" onClick={() => cancel(l)} className="text-slate-500 hover:text-red-600" title={tx.cancel}><XCircle className="w-4 h-4" /></button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </table>
        </Card>
        </div>
      )}

      {/* Request leave modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? (ar ? 'تعديل الطلب' : 'Edit request') : tx.requestLeave}
        footer={<>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={submit} disabled={saving || !form.leaveType || !form.startDate || !form.endDate || noticeViolated}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.submit}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={tx.leaveTypeRequired}>
            <Select
              value={form.leaveType}
              onChange={(e) => {
                const id = e.target.value;
                const t = types.find((x) => x._id === id) || null;
                const min = earliestStartDate(t);
                // Switching to a type with a longer notice must not silently keep
                // an illegal date sitting in the form.
                setForm((f) => ({
                  ...f,
                  leaveType: id,
                  startDate: f.startDate && f.startDate < min ? '' : f.startDate,
                  endDate: f.startDate && f.startDate < min ? '' : f.endDate,
                }));
              }}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t._id} value={t._id}>
                  {ar ? t.nameAr : t.nameEn}
                  {t.requiresAdvanceNotice === false ? (ar ? ' — بدون إخطار مسبق' : ' — no notice required') : ` — ${t.minAdvanceDays ?? 30}${ar ? ' يوم مقدّمًا' : 'd notice'}`}
                </option>
              ))}
            </Select>
          </Field>

          {/* The rule, stated before they pick a date rather than after they submit. */}
          {chosenType && (
            noticeDays > 0 ? (
              <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {ar
                    ? `هذه الإجازة تحتاج إخطارًا مسبقًا ${noticeDays} يومًا — أقرب تاريخ بداية متاح ${minStart}.`
                    : `This leave needs ${noticeDays} days' notice — the earliest start date available is ${minStart}.`}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2.5">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {ar
                    ? 'إجازة طارئة/مرضية — معفاة من قاعدة الإخطار المسبق ويمكن تقديمها لليوم نفسه.'
                    : 'Emergency / sick leave — exempt from the advance-notice rule and can start today.'}
                </span>
              </div>
            )
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Two cells per date: Gregorian then Hijri. The minimum applies to both together, otherwise a date under the notice period could be entered in Hijri and pass. */}
            <DatePair label={`${FROM_LABEL} *`} ar={ar} value={form.startDate} min={minStart} disabled={!form.leaveType}
              onChange={(v) => setForm((f) => ({ ...f, startDate: v }))} />
            <DatePair label={`${TO_LABEL} *`} ar={ar} value={form.endDate} min={form.startDate || minStart} disabled={!form.startDate}
              onChange={(v) => setForm((f) => ({ ...f, endDate: v }))} />
          </div>
          {noticeViolated && (
            <p className="text-xs text-red-600">
              {ar
                ? `التاريخ المختار بعد ${daysUntil(form.startDate)} يوم فقط — القاعدة ${noticeDays} يومًا على الأقل.`
                : `The chosen date is only ${daysUntil(form.startDate)} day(s) away — the rule is at least ${noticeDays}.`}
            </p>
          )}
          <Field label={tx.reasonNotes}><TextArea rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
          <Field label={ar ? 'المرفقات (تقرير طبّي، ورقة تُبرّر الطلب…)' : 'Attachments (medical report, supporting paper…)'}>
            <FilePicker files={files} onChange={setFiles} max={5} />
            {/* Previously uploaded files stay shown and are removed by pressing, so nobody re-uploads what was already uploaded. */}
            {editing && !!((editing as any).attachments || []).length && (
              <ul className="mt-2 space-y-1.5">
                {((editing as any).attachments || []).map((a: any) => {
                  const on = kept.includes(String(a._id));
                  return (
                    <li key={a._id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${on ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                      <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download={a.fileName || undefined}
                        className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#f37121]">
                        {a.title || a.fileName}
                      </a>
                      <button type="button" onClick={() => setKept((k) => (on ? k.filter((x) => x !== String(a._id)) : [...k, String(a._id)]))}
                        className="text-[11px] font-semibold text-slate-500 hover:text-red-600 shrink-0">
                        {on ? (ar ? 'إزالة' : 'Remove') : (ar ? 'تراجع' : 'Undo')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>
          {balance && <p className="text-xs text-slate-500">{`${tx.availableBalancePrefix} ${balance.available} ${tx.daysWord}`}</p>}
        </div>
      </Modal>

      {/* Reply to an inquiry: text and one attachment, then the chain restarts from the beginning. */}
      <Modal open={!!answering} onClose={() => setAnswering(null)}
        title={ar ? 'الردّ على الاستفسار' : 'Reply to the question'}
        footer={<>
          <button type="button" onClick={() => setAnswering(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">{tx.cancel}</button>
          <PrimaryButton onClick={sendReply} disabled={busy || !answer.trim()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{ar ? 'إرسال الردّ' : 'Send reply'}
          </PrimaryButton>
        </>}>
        {answering && (
          <div className="space-y-3">
            <LeaveThread leave={answering} lang={ar ? 'ar' : 'en'} />
            <Field label={ar ? 'ردّك' : 'Your reply'}>
              <TextArea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)}
                placeholder={ar ? 'اكتب ردّك أو ما عدّلته…' : 'Write your reply or what you changed…'} />
            </Field>
            <Field label={ar ? 'مرفق (إيصال، تقرير…) — اختياري' : 'Attachment (receipt, report…) — optional'}>
              <FilePicker files={answerFiles} onChange={setAnswerFiles} max={1} />
            </Field>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              {ar ? 'بعد الإرسال يبدأ الطلبُ دورتَه من المدير المباشر مرّةً أخرى — لأنّ ما وافقوا عليه قد تغيّر.'
                  : 'After sending, the request starts again from your direct manager — because what they approved has changed.'}
            </p>
          </div>
        )}
      </Modal>

      {/* Request trail: where it stopped and who said what. */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={ar ? 'مسار الطلب' : 'Request trail'}>
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              {leaveTypeLabel(detail.leaveType, lang)} · {bothPeriod(detail.startDate, detail.endDate, ar)} · {detail.days} {tx.dayShort}
            </p>
            <LeaveChainBar leave={detail} lang={ar ? 'ar' : 'en'} />
            <LeaveThread leave={detail} lang={ar ? 'ar' : 'en'} />
            {!(detail.thread || []).length && (
              <p className="text-xs text-slate-500">{ar ? 'لا مراسلات على هذا الطلب.' : 'No conversation on this request.'}</p>
            )}
          </div>
        )}
      </Modal>

      {/* File leave for someone under me: my approval is the filing, so it goes to HR. */}
      <Modal open={teamFormOpen} onClose={() => setTeamFormOpen(false)} title={ar ? 'تقديم إجازة لأحد فريقي' : 'File leave for my team'}
        footer={<>
          <button type="button" onClick={() => setTeamFormOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={submitTeam} disabled={teamSaving || !teamForm.employee || !teamForm.leaveType || !teamForm.startDate || !teamForm.endDate}>
            {teamSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.submit}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs text-indigo-800">
            {ar ? 'تُسجَّل موافقتك كمديرٍ مباشر عند التقديم، ويذهب الطلب مباشرةً إلى الموارد البشرية ثم الإدارة العليا.'
                : 'Your manager approval is recorded with the filing; the request goes straight to HR, then top management.'}
          </p>
          <Field label={ar ? 'الموظّف *' : 'Employee *'}>
            <SearchableSelect value={teamForm.employee} onChange={(v) => setTeamForm((f) => ({ ...f, employee: v }))}
              placeholder={ar ? '— اختر من فريقك —' : '— pick from your team —'} searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم…' : 'name or number…'}
              options={members.map((m) => {
                const b = memberBalances[String(m._id)];
                return {
                  value: m._id,
                  label: [empName(m, lang), m.employeeNumber ? `#${m.employeeNumber}` : '', m.department || '', typeof b === 'number' ? `${ar ? 'الرصيد' : 'balance'} ${b}` : ''].filter(Boolean).join(' · '),
                };
              })} />
          </Field>
          <Field label={tx.leaveTypeRequired}>
            <Select value={teamForm.leaveType} onChange={(e) => {
              const id = e.target.value;
              const min = earliestStartDate(types.find((x) => x._id === id) || null);
              setTeamForm((f) => ({ ...f, leaveType: id, startDate: f.startDate && f.startDate < min ? '' : f.startDate, endDate: f.startDate && f.startDate < min ? '' : f.endDate }));
            }}>
              <option value="">—</option>
              {types.map((t) => (
                <option key={t._id} value={t._id}>
                  {ar ? t.nameAr : t.nameEn}
                  {t.requiresAdvanceNotice === false ? (ar ? ' — بدون إخطار مسبق' : ' — no notice required') : ` — ${t.minAdvanceDays ?? 30}${ar ? ' يوم مقدّمًا' : 'd notice'}`}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <DatePair label={`${FROM_LABEL} *`} ar={ar} value={teamForm.startDate} min={teamMinStart} disabled={!teamForm.leaveType}
              onChange={(v) => setTeamForm((f) => ({ ...f, startDate: v }))} />
            <DatePair label={`${TO_LABEL} *`} ar={ar} value={teamForm.endDate} min={teamForm.startDate || teamMinStart} disabled={!teamForm.startDate}
              onChange={(v) => setTeamForm((f) => ({ ...f, endDate: v }))} />
          </div>
          <Field label={tx.reasonNotes}><TextArea rows={2} value={teamForm.reason} onChange={(e) => setTeamForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
          <Field label={ar ? 'المرفقات (اختياري)' : 'Attachments (optional)'}>
            <FilePicker files={teamFiles} onChange={setTeamFiles} max={5} />
          </Field>
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
            <p><span className="text-slate-500">{tx.colPeriod}: </span><span className="text-slate-900">{bothPeriod(review.startDate, review.endDate, ar)} ({review.days} {tx.dayShort})</span></p>
            <p><span className="text-slate-500">{tx.accruedBalance}: </span><span className="text-slate-900">{review.balanceSnapshot?.accrued ?? '—'} {tx.dayShort}</span> {typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0 && <span className="text-red-600">({tx.exceedsBalance})</span>}</p>
            {review.reason && <p className="border-t border-slate-200 pt-2"><span className="text-slate-500">{tx.reason}: </span><span className="text-slate-900">{review.reason}</span></p>}
            {!!((review as any)?.attachments || []).length && (
              <div className="border-t border-slate-200 pt-2">
                <p className="text-slate-500 text-xs mb-1">{ar ? 'مرفقات الموظّف' : 'Employee attachments'}</p>
                <AttachmentList items={(review as any).attachments} />
              </div>
            )}
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
