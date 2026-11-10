'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarCheck, Check, X, HelpCircle, FileDown, PenTool, CalendarPlus, History, Pencil, Trash2, BellRing, Hourglass, Eye } from 'lucide-react';
import { isHRStaff, LeaveRequest, empName, userName, leaveTypeLabel, LEAVE_OPEN, LEAVE_PENDING, canDecideLeave, leaveWaitNote, leaveStatusStyle, seesLeaveProcess, leaveStatusOptions, fridaysOf, countLeaveDays, fridaysNote } from '@/lib/hr';
import DatePair from '@/components/hr/DatePair';
import { gregCell, hijriCell, pairLabels, exportDatePair } from '@/lib/hrDates';
import { Spinner, PageHeader, SearchInput, Badge, Modal, TextArea, PrimaryButton, SearchableSelect, Loader2, StatCard } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrLeavesTranslations } from '@/lib/translations';
import { downloadLeaveSheet, previewLeaveSheet } from '@/lib/leavePdf';
import type { Signature } from '@/components/SignatureManager';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';
import ScrollX from '@/components/system/ScrollX';
import { LeaveReturnChip, LeaveReturnPanel } from '@/components/hr/LeaveReturn';
import FridayPicker from '@/components/hr/FridayPicker';
import { LeaveDetail } from '@/components/hr/LeaveDesk';
import { DeductionChoice, DeductionBadge, needsDeductionChoice, useDeductionAsk } from '@/components/hr/LeaveDeduction';
import PeriodFilter from '@/components/system/PeriodFilter';
import Link from 'next/link';

const idOf = (e: any) => (e?.idType === 'national_id' ? (e?.nationalId || e?.iqamaNumber) : (e?.iqamaNumber || e?.nationalId)) || '—';

/**
 * Where HR stands on a request, for the row mark: 'now' when it waits on HR's decision, 'before' when it is open and has not reached HR yet (or came back to the employee before HR acted), '' once HR has acted or the request is closed.
 */
const hrMark = (l: LeaveRequest): '' | 'now' | 'before' => {
  if (l.status === 'pending_hr') return 'now';
  if (!LEAVE_OPEN.includes(l.status) || (l as any).hrDecision?.at) return '';
  return 'before';
};

/** Counts over every request the page holds: open ones by stage, returned ones, and this month's approvals and rejections. Module level so the page's inputs never remount. */
function LeaveStats({ leaves, ar, active, onPick }: { leaves: LeaveRequest[]; ar: boolean; active: string; onPick: (k: string) => void }) {
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const n = (f: (l: LeaveRequest) => boolean) => leaves.filter(f).length;
  const decidedThisMonth = (l: LeaveRequest, st: string) => l.status === st && String((l as any).updatedAt || l.createdAt || '').slice(0, 7) === month;
  const cards: { k: string; ar: string; en: string; v: number; accent?: string }[] = [
    { k: 'in_review', ar: 'قيد المسار الآن', en: 'In progress', v: n((l) => LEAVE_PENDING.includes(l.status)), accent: 'text-amber-700' },
    { k: 'pending_hr', ar: 'بانتظار الموارد البشرية', en: 'Awaiting HR', v: n((l) => l.status === 'pending_hr'), accent: 'text-blue-700' },
    { k: 'pending_manager', ar: 'عند المدير المباشر', en: 'With the manager', v: n((l) => l.status === 'pending_manager') },
    { k: 'pending_finance', ar: 'عند الإدارة المالية', en: 'With finance', v: n((l) => l.status === 'pending_finance') },
    { k: 'pending_executive', ar: 'عند الإدارة العليا', en: 'With top management', v: n((l) => l.status === 'pending_executive') },
    { k: 'info_requested', ar: 'مطلوب إيضاح من الموظف', en: 'Awaiting the employee', v: n((l) => l.status === 'info_requested'), accent: 'text-orange-700' },
    { k: 'approved', ar: 'معتمدة هذا الشهر', en: 'Approved this month', v: n((l) => decidedThisMonth(l, 'approved')), accent: 'text-green-700' },
    { k: 'rejected', ar: 'مرفوضة هذا الشهر', en: 'Rejected this month', v: n((l) => decidedThisMonth(l, 'rejected')), accent: 'text-red-600' },
    { k: 'on_leave', ar: 'في إجازة اليوم', en: 'On leave today', v: n((l) => l.status === 'approved' && l.startDate <= today && l.endDate >= today), accent: 'text-violet-700' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <StatCard key={c.k} label={ar ? c.ar : c.en} value={c.v.toLocaleString('en-US')} accent={c.accent}
          active={active === c.k} onClick={() => onPick(c.k)} hint={ar ? 'اضغط للعرض' : 'Click to show'} />
      ))}
    </div>
  );
}

export default function HRLeavesPage() {
  const { notify, confirm, prompt } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLeavesTranslations(lang);
  const staff = isHRStaff(user);
  // Stages are shown to process viewers only (super admin powers, top management, chairman); HR staff see «قيد المراجعة».
  const full = seesLeaveProcess(user);

  const [allLeaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [deduct, setDeduct] = useState<boolean | null>(null);
  // Fridays HR leaves out of the leave (not counted, not off the balance); chosen at its own stage.
  const [offFridays, setOffFridays] = useState<string[]>([]);
  const deductionAsk = useDeductionAsk(ar);
  // Decision paper: the approved doctor's report, or the rejection letter with its reason.
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [mySigs, setMySigs] = useState<Signature[]>([]);
  const [signWith, setSignWith] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');
  // Edit and delete a leave: a record correction, not a decision.
  const [editing, setEditing] = useState<LeaveRequest | null>(null);
  const [editForm, setEditForm] = useState<any>({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [editSaving, setEditSaving] = useState(false);
  const t = (en: string, a: string) => (ar ? a : en);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: LeaveRequest[] }>('/api/hr/leaves');
      setLeaves(d.leaves || []);
    } catch {}
    setLoading(false);
  }, []);
  // Status is filtered client-side. Sent to the server, the "N under review" header count was computed on the filtered result and dropped to zero; so fetch all and filter only the table.
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const leaves = statusFilter ? allLeaves.filter((l) => (statusFilter === 'in_review' ? LEAVE_PENDING.includes(l.status)
    : statusFilter === 'on_leave' ? (l.status === 'approved' && l.startDate <= todayKey && l.endDate >= todayKey)
    : l.status === statusFilter)) : allLeaves;

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ signatures: Signature[] }>('/api/auth/signatures').then((r) => setMySigs(r.signatures || [])).catch(() => {}); }, []);
  // The edit dialog needs only the types, not the employee list.
  useEffect(() => {
    if (!editing || types.length) return;
    api.get<{ leaveTypes: any[] }>('/api/hr/leave-types').then((d) => setTypes(d.leaveTypes || []))
      .catch((e: any) => notify(e?.message || (ar ? 'تعذّر تحميل أنواع الإجازات' : 'Could not load the leave types'), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, types.length]);

  const openEdit = (l: LeaveRequest) => {
    setEditing(l);
    setEditForm({
      leaveType: (l.leaveType as any)?._id || l.leaveType || '',
      startDate: String(l.startDate || '').slice(0, 10),
      endDate: String(l.endDate || '').slice(0, 10),
      reason: l.reason || '',
    });
  };
  // The type picked in the edit, else the request's own rule (older requests count calendar days, as the server keeps them).
  const editFridays = (() => {
    const t = types.find((x: any) => x._id === editForm.leaveType);
    if (t && editing && String(t._id) !== String((editing.leaveType as any)?._id || editing.leaveType)) return t.countsFridays === true;
    return (editing as any)?.countsFridays !== false;
  })();
  const editDays = countLeaveDays(editForm.startDate, editForm.endDate, editFridays);
  const saveEdit = async () => {
    if (!editing) return;
    if (!editForm.leaveType || !editDays) {
      notify(ar ? 'اختر نوع الإجازة وتاريخين صحيحين' : 'Pick the leave type and valid dates', 'error');
      return;
    }
    setEditSaving(true);
    try {
      await api.put(`/api/hr/leaves/${editing._id}`, editForm);
      notify(ar ? 'عُدِّلت الإجازة' : 'Leave updated', 'success');
      setEditing(null);
      load();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التعديل' : 'Could not update'), 'error'); }
    setEditSaving(false);
  };
  const removeLeave = async (l: LeaveRequest) => {
    const ok = await confirm({
      title: ar ? 'حذف الإجازة؟' : 'Delete this leave?',
      message: ar
        ? `تُحذف إجازة ${empName(l.employee, lang)} (${l.days} يوم، من ${String(l.startDate).slice(0, 10)} إلى ${String(l.endDate).slice(0, 10)}) نهائيًّا، ويعود ما خُصم بها إلى رصيده.`
        : `${empName(l.employee, lang)}'s leave (${l.days} day(s)) is deleted permanently and any deducted days return to the balance.`,
      confirmLabel: ar ? 'حذف' : 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/hr/leaves/${l._id}`);
      notify(ar ? 'حُذفت الإجازة' : 'Leave deleted', 'success');
      if (review?._id === l._id) setReview(null);
      load();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحذف' : 'Could not delete'), 'error'); }
  };

  useSocket('hr:leave', useCallback(() => load(), [load]));

  const openReview = (l: LeaveRequest) => { setReview(l); setNote(''); setSignWith(''); setFiles([]); setDeduct(null); setOffFridays(((l as any).excludedFridays || []) as string[]); };
  // Keep the open review in step with the reloaded list (return/extension/no-show).
  useEffect(() => {
    setReview((r) => (r ? (allLeaves.find((x) => x._id === r._id) || r) : r));
  }, [allLeaves]);

  const decide = async (decision: 'approved' | 'rejected' | 'info') => {
    if (!review) return;
    // An inquiry without text reaches the employee as an empty question, so text is required.
    if (decision === 'info' && !note.trim()) {
      notify(ar ? 'اكتب استفسارك حتى يعرف الموظّف بمَ يردّ.' : 'Write your question so the employee knows what to answer.', 'error');
      return;
    }
    const withChoice = decision === 'approved' && needsDeductionChoice(review);
    if (withChoice && deduct === null) {
      notify(ar ? 'اختر: تُخصم من الرصيد أم بدون خصم.' : 'Choose whether the leave is deducted from the balance.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/hr/leaves/${review._id}/decision`, {
        decision, note, signatureId: signWith || undefined,
        ...(withChoice ? { deductBalance: deduct } : {}),
        ...(decision === 'approved' && review.status === 'pending_hr' ? { excludedFridays: offFridays } : {}),
        files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      setReview(null); setNote(''); setSignWith(''); setFiles([]); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  // Decide straight from the row; a rejection or a question asks for its text first. Signature and files stay in the review window.
  const [rowBusy, setRowBusy] = useState('');
  const quickDecide = async (l: LeaveRequest, decision: 'approved' | 'rejected' | 'info') => {
    let text = '';
    let choice: boolean | null = null;
    // At HR's stage a period with Fridays opens the review window, where HR picks the Fridays not to count.
    if (decision === 'approved' && l.status === 'pending_hr' && fridaysOf(l.startDate, l.endDate).length) { openReview(l); return; }
    // HR's approval states the balance choice even from the row.
    if (decision === 'approved' && needsDeductionChoice(l)) {
      choice = await deductionAsk.ask(l);
      if (choice === null) return;
    }
    if (decision !== 'approved') {
      const v = await prompt(decision === 'info'
        ? (ar ? 'اكتب استفسارك أو التعديل المطلوب — يصل للموظّف ليردّ' : 'Write your question or the change needed — the employee will reply')
        : (ar ? 'سبب الرفض (اختياري)' : 'Reason for rejection (optional)'));
      if (v === null) return;
      if (decision === 'info' && !v.trim()) { notify(ar ? 'اكتب استفسارك حتى يعرف الموظّف بمَ يردّ.' : 'Write your question so the employee knows what to answer.', 'error'); return; }
      text = v;
    }
    setRowBusy(l._id);
    try {
      await api.patch(`/api/hr/leaves/${l._id}/decision`, { decision, note: text, ...(choice !== null ? { deductBalance: choice } : {}) });
      notify(decision === 'approved' ? (ar ? 'تمت الموافقة' : 'Approved') : decision === 'rejected' ? (ar ? 'رُفض الطلب' : 'Rejected') : (ar ? 'أُرسل الاستفسار للموظّف' : 'Question sent to the employee'), 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setRowBusy('');
  };

  const downloadPdf = async (id: string) => {
    setPdfBusy(id);
    try {
      await downloadLeaveSheet(id);
    } catch (e: any) { notify(e.message || 'PDF failed', 'error'); }
    setPdfBusy('');
  };
  const previewPdf = async (id: string) => {
    setPdfBusy(id);
    try { await previewLeaveSheet(id, ar); } catch (e: any) { notify(e.message || 'Preview failed', 'error'); }
    setPdfBusy('');
  };

  const leaveTypes = [...new Map(allLeaves.filter((l) => l.leaveType?._id).map((l) => [l.leaveType._id, l.leaveType])).values()];
  const depts = [...new Set(allLeaves.map((l) => l.employee?.department).filter(Boolean))].sort() as string[];
  const filtered = leaves.filter((l) => {
    if (typeFilter && l.leaveType?._id !== typeFilter) return false;
    if (deptFilter && l.employee?.department !== deptFilter) return false;
    if (from && String(l.endDate).slice(0, 10) < from) return false;
    if (to && String(l.startDate).slice(0, 10) > to) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return empName(l.employee).toLowerCase().includes(q) || userName(l.requester).toLowerCase().includes(q)
      || String(l.employee?.employeeNumber || '').includes(q);
  });
  // Pending means waiting at any stage or returned to its owner; one list (lib/hr) so a stage added later is counted.
  const pendingCount = allLeaves.filter((l) => LEAVE_OPEN.includes(l.status)).length;
  // Decisions are made only at an existing stage; the server verifies it is the reader's stage.
  const actionable = (l: LeaveRequest | null) => !!l && LEAVE_PENDING.includes(l.status);
  // Row buttons only where this reader decides now, as the server checks (utils/leaveChain canActAt): the direct manager at his stage only, HR and top management at theirs, other super admins past the manager stage.
  const top = ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(user?.role || '');
  const canActNow = (l: LeaveRequest) => actionable(l) && canDecideLeave(user, l, staff);

  // The "from Gregorian" label is never shown; the main name is start/end date.
  const FROM_LABEL = ar ? 'تاريخ البداية' : 'Start date';
  const TO_LABEL = ar ? 'تاريخ النهاية' : 'End date';
  const fromLabels = pairLabels(FROM_LABEL, ar);
  const toLabels = pairLabels(TO_LABEL, ar);
  const exportColumns: ExportColumn[] = [
    { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
    { header: 'Type', key: 'leaveType', transform: (v: any) => leaveTypeLabel(v, 'en'), width: 16 },
    // Each date is two adjacent columns: Gregorian, then its derived Hijri (lib/hrDates).
    ...exportDatePair(FROM_LABEL, 'startDate', ar),
    ...exportDatePair(TO_LABEL, 'endDate', ar),
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Status', key: 'status', transform: (v: any) => { const st = leaveStatusStyle({ status: v }, false, full); return st ? (ar ? st.ar : st.en) : v; }, width: 16 },
    { header: 'Reason', key: 'reason', width: 28 },
  ];
  // Status filter runs on the server, so with e.g. "pending" memory holds nothing else. "All" re-fetches without status, otherwise the leave register is exported truncated.
  const fetchAllLeaves = async () => {
    const d = await api.get<{ leaves: LeaveRequest[] }>('/api/hr/leaves');
    return [{ name: 'Leaves', rows: d.leaves || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Leaves', rows: filtered, columns: exportColumns }] },
    statusFilter
      ? { key: 'all', label: scope.all, resolve: fetchAllLeaves }
      : { key: 'all', label: scope.all, sheets: [{ name: 'Leaves', rows: leaves, columns: exportColumns }] },
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarCheck className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${pendingCount} ${tx.pending}`}>
        {/* Recording a leave (incl. for employees without a login) lives in the leave register. */}
        <Link href="/system/hr/leave-register"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors">
          <CalendarPlus className="w-4 h-4" /> {ar ? 'سجل الإجازات وتسجيل إجازة' : 'Leave register & record a leave'}
        </Link>
        <ExportMenu fileName="leaves" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
      </PageHeader>

      {/* The process at a glance: where every open request stands, and this month's outcomes. Each card filters the list. */}
      <LeaveStats leaves={allLeaves} ar={ar} active={statusFilter} onPick={(k) => setStatusFilter(statusFilter === k ? '' : k)} />


      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {leaveStatusOptions(full).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={ar ? 'النوع' : 'Type'} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
          {leaveTypes.map((t: any) => <option key={t._id} value={t._id}>{ar ? t.nameAr : t.nameEn}</option>)}
        </select>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label={ar ? 'القسم' : 'Department'} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{ar ? 'كل الأقسام' : 'All departments'}</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <PeriodFilter from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); }} ar={ar} />
      </div>

      {/* What the row marks mean, once above the table. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><BellRing className="w-4 h-4 text-orange-600" />{ar ? 'بانتظار إجراء الموارد البشرية الآن' : 'Awaiting HR action now'}</span>
        <span className="inline-flex items-center gap-1.5"><Hourglass className="w-4 h-4 text-sky-600" />{ar ? 'مفتوح ولم يصل الموارد البشرية بعد' : 'Open, not yet at HR'}</span>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="w-8 px-2 py-3" aria-label={ar ? 'إجراء الموارد البشرية' : 'HR action'} />
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'الرقم الوظيفي' : 'Emp. no.'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'الهوية / الإقامة' : 'ID / Iqama'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap min-w-[160px]">{tx.colType}</th>
            {/* From and To are two columns: a combined range in one cell cannot be sorted or compared, and the questions differ (when absence starts, when it ends). */}
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{fromLabels[0]}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{fromLabels[1]}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{toLabels[0]}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{toLabels[1]}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colDays}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colBalance}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'الإجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={13} className="text-center text-slate-800 py-12">{tx.noRequests}</td></tr>
            ) : filtered.map((l) => {
              const over = l.balanceSnapshot && typeof l.balanceSnapshot.remainingAfter === 'number' && l.balanceSnapshot.remainingAfter < 0;
              return (
                <tr key={l._id} className={`group border-b border-slate-200/70 cursor-pointer ${hrMark(l) === 'now' ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-slate-100'}`} onClick={() => openReview(l)}>
                  <td className={`px-2 py-3 ${hrMark(l) === 'now' ? 'border-s-4 border-orange-500' : ''}`}>
                    {hrMark(l) === 'now' && <span title={ar ? 'بانتظار إجراء الموارد البشرية الآن' : 'Awaiting HR action now'}><BellRing className="w-4 h-4 text-orange-600 animate-pulse" /></span>}
                    {hrMark(l) === 'before' && <span title={ar ? 'مفتوح ولم يصل الموارد البشرية بعد' : 'Open, not yet at HR'}><Hourglass className="w-4 h-4 text-sky-600" /></span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(l.employee as any)?.employeeNumber || '—'}</td>
                  <td className="px-4 py-3 text-slate-900 font-medium whitespace-nowrap">
                    {/* Cap the width and truncate: an uncapped long name hides the columns the table exists for. The full name is in the tooltip. */}
                    <span className="block max-w-[15rem] truncate" title={empName(l.employee, lang)}>{empName(l.employee, lang)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{idOf(l.employee)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap min-w-[160px]">{leaveTypeLabel(l.leaveType, lang)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{gregCell(l.startDate)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums" dir="ltr">{hijriCell(l.startDate)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{gregCell(l.endDate)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums" dir="ltr">{hijriCell(l.endDate)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {l.days}
                    {!!((l as any).excludedFridays || []).length && (
                      <span className="block text-[10.5px] text-sky-700 whitespace-nowrap">{ar ? `بدون ${(l as any).excludedFridays.length} جمعة` : `${(l as any).excludedFridays.length} Fri not counted`}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className={over ? 'text-red-600' : 'text-slate-700'}>{l.balanceSnapshot?.available ?? '—'}{over ? ` ${tx.over}` : ''}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge style={leaveStatusStyle(l, false, full, canActNow(l))} lang={lang} />
                      <LeaveReturnChip leave={l} ar={ar} />
                      <DeductionBadge leave={l} ar={ar} />
                      {/* Requested-and-approved vs recorded after the fact stays visible. */}
                      {(l as any).backdated && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600"
                          title={(l as any).recordedByName ? `${ar ? 'قيّدها' : 'Recorded by'} ${(l as any).recordedByName}` : ''}>
                          <History className="w-3 h-3" /> {ar ? 'قيد رجعيّ' : 'Back-dated'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {canActNow(l) && <>
                        <button type="button" disabled={rowBusy === l._id} onClick={(e) => { e.stopPropagation(); quickDecide(l, 'approved'); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                          {rowBusy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{tx.approve}
                        </button>
                        <button type="button" disabled={rowBusy === l._id} onClick={(e) => { e.stopPropagation(); quickDecide(l, 'info'); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-700 text-xs font-semibold hover:bg-orange-500/25 disabled:opacity-50 whitespace-nowrap">
                          <HelpCircle className="w-3.5 h-3.5" />{ar ? 'استفسار / طلب تعديل' : 'Ask / change'}
                        </button>
                        <button type="button" disabled={rowBusy === l._id} onClick={(e) => { e.stopPropagation(); quickDecide(l, 'rejected'); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-600 text-xs font-semibold hover:bg-red-500/25 disabled:opacity-50">
                          <X className="w-3.5 h-3.5" />{tx.reject}
                        </button>
                      </>}
                      {!canActNow(l) && LEAVE_OPEN.includes(l.status) && (
                        <span className="max-w-[260px] text-[11px] leading-snug text-slate-500" title={leaveWaitNote(l, ar, full)}>{leaveWaitNote(l, ar, full)}</span>
                      )}
                      <button type="button" title={t('Preview with signatures', 'معاينة الورقة بالتوقيعات')} onClick={(e) => { e.stopPropagation(); previewPdf(l._id); }} className="p-1.5 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-slate-600"><Eye className="w-3.5 h-3.5" /></button>
                      <button type="button" title={t('Download PDF', 'تحميل PDF')} onClick={(e) => { e.stopPropagation(); downloadPdf(l._id); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-slate-600 text-xs">
                        {pdfBusy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
                      </button>
                      <button type="button" title={t('Edit', 'تعديل')} onClick={(e) => { e.stopPropagation(); openEdit(l); }} className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title={t('Delete', 'حذف')} onClick={(e) => { e.stopPropagation(); removeLeave(l); }} className="p-1.5 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={ar ? 'تعديل الإجازة' : 'Edit leave'}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveEdit} disabled={editSaving || !editDays}>
            {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        {editing && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-900 font-semibold">{empName(editing.employee, lang)}</p>
            <p className="text-slate-500 text-xs">
              {ar
                ? 'تصحيحٌ للسجلّ: الحالة ومراحل الموافقة لا تتغيّر، والرصيد يُعاد حسابه تلقائيًّا.'
                : 'A record correction: status and approvals stay as they are; the balance is recalculated.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-slate-500 text-xs mb-1 block">{ar ? 'نوع الإجازة' : 'Leave type'}</label>
                <SearchableSelect
                  value={editForm.leaveType}
                  onChange={(v) => setEditForm((f: any) => ({ ...f, leaveType: v }))}
                  placeholder={ar ? '— اختر نوع الإجازة —' : '— pick the leave type —'}
                  searchPlaceholder={ar ? 'ابحث…' : 'search…'}
                  options={types.map((ty) => ({ value: ty._id, label: ar ? ty.nameAr : ty.nameEn }))}
                />
              </div>
              <DatePair label={FROM_LABEL} ar={ar} inputClassName="[color-scheme:light]"
                value={editForm.startDate} onChange={(v) => setEditForm((f: any) => ({ ...f, startDate: v }))} />
              <DatePair label={TO_LABEL} ar={ar} inputClassName="[color-scheme:light]" min={editForm.startDate || undefined}
                value={editForm.endDate} onChange={(v) => setEditForm((f: any) => ({ ...f, endDate: v }))} />
            </div>
            {!!editDays && (
              <p className="text-slate-900 text-sm font-semibold">{ar ? `المدّة: ${editDays} يوم` : `Duration: ${editDays} day(s)`} <span className="text-xs font-normal text-slate-500">{fridaysNote(editForm.startDate, editForm.endDate, editFridays, ar)}</span></p>
            )}
            <div>
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'السبب / ملاحظة' : 'Reason / note'}</label>
              <TextArea rows={2} value={editForm.reason} onChange={(e: any) => setEditForm((f: any) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>

      {/* Wide review window: the request on one side, HR's decision and tools on the other (stacked on narrow screens). */}
      <Modal open={!!review} onClose={() => setReview(null)} title={tx.reviewTitle} wide="xl"
        footer={review && canActNow(review) ? <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><PenTool className="h-3.5 w-3.5 text-[#f37121]" />{t('Your signature is applied to the approval', 'يُوضع توقيعك على الموافقة تلقائيًا')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100 disabled:opacity-50"><X className="w-4 h-4" /> {tx.reject}</button>
            <button type="button" onClick={() => decide('info')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm font-semibold hover:bg-orange-100 disabled:opacity-50"><HelpCircle className="w-4 h-4" /> {ar ? 'استفسار / طلب تعديل' : 'Ask / request change'}</button>
            <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.approve}</PrimaryButton>
          </div>
        </div> : (review && LEAVE_OPEN.includes(review.status) ? <p className="text-xs text-slate-500">{leaveWaitNote(review, ar, full)}</p> : undefined)}>
        {review && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge style={leaveStatusStyle(review, false, full, canActNow(review))} lang={lang} />
                <LeaveReturnChip leave={review} ar={ar} />
                {(review as any).backdated && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600"><History className="w-3 h-3" /> {ar ? 'قيد رجعيّ' : 'Back-dated'}</span>}
              </div>
              <LeaveDetail l={review as any} ar={ar} full={full} />
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              {canActNow(review) && (
                <section className="space-y-3 rounded-2xl border border-[#f37121]/30 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-900">{ar ? 'قرارك' : 'Your decision'}</h4>
                  {review.status === 'pending_hr' && <FridayPicker startDate={review.startDate} endDate={review.endDate} value={offFridays} onChange={setOffFridays} ar={ar} />}
                  {needsDeductionChoice(review) && <DeductionChoice value={deduct} onChange={setDeduct} leave={review} ar={ar} />}
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{ar ? 'ملاحظتك — مطلوبة مع الاستفسار' : 'Your note — required when asking'}</label>
                    <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={ar ? 'تُحفظ مع قرارك ويقرؤها الموظّف' : 'saved with your decision'} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{ar ? 'مرفقات القرار (اختياري)' : 'Decision attachments (optional)'}</label>
                    <FilePicker files={files} onChange={setFiles} max={5} />
                  </div>
                  {mySigs.length === 0 && (
                    <p className="text-xs text-slate-500">
                      {t('You have no signature yet — ', 'لا يوجد لديك توقيع بعد — ')}
                      <a href="/system/settings" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#f37121] hover:underline">{t('create one in Settings', 'اعمل واحد من الإعدادات')}</a>
                    </p>
                  )}
                  {mySigs.length > 1 && (
                    <div>
                      <p className="text-slate-500 text-xs mb-1">{ar ? 'التوقيع' : 'Signature'}</p>
                      <div className="flex gap-2 flex-wrap">
                        {mySigs.map((s) => (
                          <button key={s._id} type="button" onClick={() => setSignWith(s._id)} className={`border rounded-lg p-1 bg-white ${(signWith || mySigs.find((x) => x.isDefault)?._id || mySigs[0]?._id) === s._id ? 'border-[#f37121] ring-1 ring-[#f37121]' : 'border-slate-200'}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={s.dataUrl} alt={s.name} className="h-9 w-20 object-contain" />
                            <div className="text-[10px] text-slate-500 text-center truncate w-20">{s.name}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <LeaveReturnPanel leave={review} ar={ar} canAct={staff} onDone={load} />
              </section>

              <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-bold text-slate-900">{ar ? 'أدوات' : 'Tools'}</h4>
                <button type="button" onClick={() => previewPdf(review._id)} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-[#f37121]/10 hover:text-[#f37121]">
                  <Eye className="w-4 h-4" /> {t('Preview the sheet with signatures', 'معاينة ورقة الإجازة بالتوقيعات')}
                </button>
                <button type="button" onClick={() => downloadPdf(review._id)} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-[#f37121]/10 hover:text-[#f37121]">
                  {pdfBusy === review._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {t('Download PDF sheet', 'تحميل ورقة الإجازة PDF')}
                </button>
                <button type="button" onClick={() => { const l = review; setReview(null); openEdit(l); }} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600">
                  <Pencil className="w-4 h-4" /> {t('Edit', 'تعديل')}
                </button>
                <button type="button" onClick={() => removeLeave(review)} className="flex w-full items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 hover:bg-red-100">
                  <Trash2 className="w-4 h-4" /> {t('Delete', 'حذف')}
                </button>
              </section>
            </aside>
          </div>
        )}
      </Modal>
      {deductionAsk.dialog}
    </div>
  );
}

