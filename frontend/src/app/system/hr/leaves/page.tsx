'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { CalendarCheck, Check, X, HelpCircle, FileDown, PenTool, CalendarPlus, History, Pencil, Trash2 } from 'lucide-react';
import { isHRStaff, LeaveRequest, LEAVE_STATUS, empName, userName, leaveTypeLabel } from '@/lib/hr';
import DatePair from '@/components/hr/DatePair';
import { bothDates, gregCell, hijriCell, pairLabels, exportDatePair } from '@/lib/hrDates';
import { LeaveChainBar, LeaveThread } from '@/components/hr/LeaveChain';
import { Spinner, PageHeader, SearchInput, Badge, Modal, TextArea, PrimaryButton, SearchableSelect, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrLeavesTranslations } from '@/lib/translations';
import { downloadLeaveSheet } from '@/lib/leavePdf';
import type { Signature } from '@/components/SignatureManager';
import FilePicker, { AttachmentList, type PickedFile } from '@/components/system/FilePicker';
import ScrollX from '@/components/system/ScrollX';
import { LeaveReturnChip, LeaveReturnPanel } from '@/components/hr/LeaveReturn';
import { DeductionChoice, DeductionBadge, needsDeductionChoice, useDeductionAsk } from '@/components/hr/LeaveDeduction';
import PeriodFilter from '@/components/system/PeriodFilter';
import Link from 'next/link';

const idOf = (e: any) => (e?.idType === 'national_id' ? (e?.nationalId || e?.iqamaNumber) : (e?.iqamaNumber || e?.nationalId)) || '—';
const BG = 'bg-white group-hover:bg-slate-100';

export default function HRLeavesPage() {
  // Only the actions stay pinned; number, name and ID scroll with the rest (the owner's call).
  const pin = usePinnedColumns(1);
  const { notify, confirm, prompt } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLeavesTranslations(lang);
  const staff = isHRStaff(user);

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
  const leaves = statusFilter ? allLeaves.filter((l) => l.status === statusFilter) : allLeaves;

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
  const editDays = (() => {
    const { startDate, endDate } = editForm;
    if (!startDate || !endDate || endDate < startDate) return 0;
    return Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
  })();
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
        ? `تُحذف إجازة ${empName(l.employee, lang)} (${l.days} يوم، ${String(l.startDate).slice(0, 10)} → ${String(l.endDate).slice(0, 10)}) نهائيًّا، ويعود ما خُصم بها إلى رصيده.`
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

  const openReview = (l: LeaveRequest) => { setReview(l); setNote(''); setSignWith(''); setFiles([]); setDeduct(null); };
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

  // Fetch the full leave (with signatures) then build the official PDF sheet.
  const downloadPdf = async (id: string) => {
    setPdfBusy(id);
    try {
      const { leave } = await api.get<{ leave: any }>(`/api/hr/leaves/${id}`);
      await downloadLeaveSheet(leave, lang as 'ar' | 'en');
    } catch (e: any) { notify(e.message || 'PDF failed', 'error'); }
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
  // Pending means waiting at one of the four stages or returned to its owner. Counting only two stages dropped requests at accounts or management from the counter, making them look finished.
  const OPEN = ['pending_manager', 'pending_hr', 'pending_finance', 'pending_executive', 'info_requested'];
  const pendingCount = allLeaves.filter((l) => OPEN.includes(l.status)).length;
  // Decisions are made only at an existing stage; the server verifies it is the reader's stage.
  const actionable = (l: LeaveRequest | null) => !!l && ['pending_manager', 'pending_hr', 'pending_finance', 'pending_executive'].includes(l.status);
  // Row buttons only where this reader decides now, as the server checks (utils/leaveChain canActAt): HR at the HR stage, top management at the last, super admins anywhere.
  const top = ['super_admin', 'admin'].includes(user?.role || '');
  const canActNow = (l: LeaveRequest) => actionable(l) && (top
    || (staff && l.status === 'pending_hr')
    || ((user as any)?.isTopManagement === true && l.status === 'pending_executive')
    || (l.status === 'pending_manager' && String((l.manager as any)?._id || l.manager || '') === String(user?._id || '')));

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
    { header: 'Status', key: 'status', width: 16 },
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


      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {Object.entries(LEAVE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
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

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th {...pin.th(0, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{ar ? 'الإجراءات' : 'Actions'}</th>
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
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} className="text-center text-slate-800 py-12">{tx.noRequests}</td></tr>
            ) : filtered.map((l) => {
              const over = l.balanceSnapshot && typeof l.balanceSnapshot.remainingAfter === 'number' && l.balanceSnapshot.remainingAfter < 0;
              return (
                <tr key={l._id} className="group border-b border-slate-200/70 hover:bg-slate-100 cursor-pointer" onClick={() => openReview(l)}>
                  <td {...pin.td(0, 'px-4 py-3', BG)}>
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
                  <td className="px-4 py-3 text-slate-700">{l.days}</td>
                  <td className="px-4 py-3"><span className={over ? 'text-red-600' : 'text-slate-700'}>{l.balanceSnapshot?.accrued ?? '—'}{over ? ` ${tx.over}` : ''}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge style={LEAVE_STATUS[l.status]} lang={lang} />
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
              <p className="text-slate-900 text-sm font-semibold">{ar ? `المدّة: ${editDays} يوم` : `Duration: ${editDays} day(s)`}</p>
            )}
            <div>
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'السبب / ملاحظة' : 'Reason / note'}</label>
              <TextArea rows={2} value={editForm.reason} onChange={(e: any) => setEditForm((f: any) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!review} onClose={() => setReview(null)} title={tx.reviewTitle}
        footer={actionable(review) ? <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50"><X className="w-4 h-4" /> {tx.reject}</button>
          <button type="button" onClick={() => decide('info')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-500/30 disabled:opacity-50"><HelpCircle className="w-4 h-4" /> {ar ? 'استفسار / طلب تعديل' : 'Ask / request change'}</button>
          <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.approve}</PrimaryButton>
        </div> : undefined}>
        {review && (
          <div className="space-y-3 text-sm">
            {/* Where the request stands and who signed, before any other field. */}
            <LeaveChainBar leave={review} lang={ar ? 'ar' : 'en'} />
            <Row k={tx.fieldEmployee} v={empName(review.employee, lang)} />
            <Row k={tx.fieldRequester} v={userName(review.requester)} />
            <Row k={tx.fieldType} v={leaveTypeLabel(review.leaveType, lang)} />
            <Row k={FROM_LABEL} v={bothDates(review.startDate, ar)} />
            <Row k={TO_LABEL} v={bothDates(review.endDate, ar)} />
            <Row k={tx.colDays} v={`${review.days} ${tx.dayUnit}`} />
            <Row k={tx.fieldAccrued} v={`${review.balanceSnapshot?.accrued ?? '—'} ${tx.dayUnit}`} />
            <Row k={tx.fieldRemainingAfter} v={`${review.balanceSnapshot?.remainingAfter ?? '—'} ${tx.dayUnit}`} danger={typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0} />
            <Row k={tx.fieldStatus} v={<span className="inline-flex flex-wrap items-center gap-1.5"><Badge style={LEAVE_STATUS[review.status]} lang={lang} /><DeductionBadge leave={review} ar={ar} /></span>} />
            {/* Each text has its owner in its label: the employee's request text versus the reviewer's decision note were both generic and read as duplicates. */}
            {review.reason && (
              <div className="border-t border-slate-200 pt-3">
                <span className="text-slate-500">{ar ? 'سبب الموظّف في طلبه' : 'Employee’s reason'}: </span>
                <span className="text-slate-900">{review.reason}</span>
              </div>
            )}
            {/* The supporting document is read before deciding, so approval is never given on a doctor's report requested over chat. */}
            {!!((review as any).attachments || []).length && (
              <div className="border-t border-slate-200 pt-3">
                <p className="text-slate-500 text-xs mb-1">{ar ? 'مرفقات الموظّف' : 'Employee attachments'}</p>
                <AttachmentList items={(review as any).attachments} />
              </div>
            )}
            <LeaveReturnPanel leave={review} ar={ar} canAct={staff} onDone={load} />
            <LeaveThread leave={review} lang={ar ? 'ar' : 'en'} />
            {actionable(review) && (
              <div className="border-t border-slate-200 pt-3 space-y-3">
                {needsDeductionChoice(review) && <DeductionChoice value={deduct} onChange={setDeduct} leave={review} ar={ar} />}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">
                    {ar ? 'ملاحظتك على القرار — مطلوبة مع الاستفسار' : 'Your note — required when asking a question'}
                  </label>
                  <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder={ar ? 'تُحفظ مع موافقتك أو رفضك ويقرؤها الموظّف' : 'saved with your approval or rejection'} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{ar ? 'مرفقات القرار (اختياري)' : 'Decision attachments (optional)'}</label>
                  <FilePicker files={files} onChange={setFiles} max={5} />
                </div>
                {/* Optional: sign this approval with one of your signatures */}
                <div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!signWith} disabled={mySigs.length === 0}
                      onChange={(e) => setSignWith(e.target.checked ? (mySigs.find((s) => s.isDefault)?._id || mySigs[0]?._id || '') : '')} />
                    <PenTool className="w-4 h-4 text-[#f37121]" /> {t('Sign this approval', 'أوقّع على الموافقة')}
                  </label>
                  {/* The disabled field referred to Settings with no link, and Settings was hidden from most roles. It is now a link opening Settings in a new tab, so the review text is not lost. */}
                  {mySigs.length === 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t('You have no signature yet — ', 'ما عندكش توقيع لسه — ')}
                      <a href="/system/settings" target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-[#f37121] hover:underline">
                        {t('create one in Settings', 'اعمل واحد من الإعدادات')}
                      </a>
                      {t(' (opens in a new tab), then reopen this review.', ' (هيفتح في تبويب جديد)، وبعدين افتح المراجعة تاني.')}
                    </p>
                  )}
                  {signWith && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {mySigs.map((s) => (
                        <button key={s._id} type="button" onClick={() => setSignWith(s._id)} className={`border rounded-lg p-1 bg-white ${signWith === s._id ? 'border-[#f37121] ring-1 ring-[#f37121]' : 'border-slate-200'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.dataUrl} alt={s.name} className="h-9 w-20 object-contain" />
                          <div className="text-[10px] text-slate-500 text-center truncate w-20">{s.name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="border-t border-slate-200 pt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadPdf(review._id)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                {pdfBusy === review._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {t('Download PDF sheet', 'تحميل ورقة الإجازة PDF')}
              </button>
              <button type="button" onClick={() => { const l = review; setReview(null); openEdit(l); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 text-sm">
                <Pencil className="w-4 h-4" /> {t('Edit', 'تعديل')}
              </button>
              <button type="button" onClick={() => removeLeave(review)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm">
                <Trash2 className="w-4 h-4" /> {t('Delete', 'حذف')}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {deductionAsk.dialog}
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: React.ReactNode; danger?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className={danger ? 'text-red-600 font-medium' : 'text-slate-900'}>{v}</span></div>;
}
