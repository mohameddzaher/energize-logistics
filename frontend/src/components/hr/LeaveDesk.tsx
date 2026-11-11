'use client';
// One stage's leave desk: every leave in the company, with this stage's own decisions. Finance, top management and the chairman each mount it on their API (backend routes/leaveDesk), so the three screens stay the same.
// Layout: a one-line-per-cell table on wide screens and cards on phones; the five stages are one compact progress bar; a request opens into a detail window where the stage decides. Other stages are shown to process viewers only (seesLeaveProcess).
// Components live at module level so no input remounts on a keystroke (see inline-components-remount).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, X, Loader2, FileDown, Search, PenTool, Paperclip, User, CalendarDays, Eye } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, Spinner, Modal } from '@/components/hr/HRKit';
import { DeductionBadge } from '@/components/hr/LeaveDeduction';
import { LeaveChainBar, LeaveThread } from '@/components/hr/LeaveChain';
import { AttachmentList } from '@/components/system/FilePicker';
import { bothDates } from '@/lib/hrDates';
import { LEAVE_STAGES, LEAVE_OPEN, LeaveStage, leaveWaitNote, leaveStatusStyle, seesLeaveProcess } from '@/lib/hr';
import { downloadLeaveSheet, previewLeaveSheet } from '@/lib/leavePdf';

type Decision = { by?: { firstName?: string; lastName?: string }; at?: string; decision?: string; note?: string };
type Leave = {
  _id: string; status: string; currentStage: string; days: number; startDate: string; endDate: string; reason?: string;
  employee?: { firstName?: string; lastName?: string; arabicName?: string; employeeNumber?: string; department?: string; jobTitle?: string; idType?: string; iqamaNumber?: string; nationalId?: string; nationality?: string };
  leaveType?: { nameAr?: string; nameEn?: string; color?: string };
  createdAt: string;
  [k: string]: any;
};

const nameOf = (u?: { firstName?: string; lastName?: string } | null) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const empLabel = (l: Leave) => l.employee?.arabicName || nameOf(l.employee) || '—';
const dm = (v?: string) => (v ? String(v).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '');
const dmy = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' }) : '');
const idOfEmp = (e: Leave['employee']) => (e?.idType === 'national_id' ? (e?.nationalId || e?.iqamaNumber) : (e?.iqamaNumber || e?.nationalId)) || '';

type StageState = 'done' | 'rejected' | 'asked' | 'current' | 'waiting';
function stageStates(l: Leave): { key: LeaveStage; ar: string; en: string; state: StageState; d?: Decision }[] {
  return LEAVE_STAGES.map((s) => {
    const d = l[s.decision as string] as Decision | undefined;
    let state: StageState = 'waiting';
    if (d?.decision === 'approved') state = 'done';
    else if (d?.decision === 'rejected') state = 'rejected';
    else if (d?.decision === 'info') state = 'asked';
    else if (l.currentStage === s.key) state = 'current';
    else if (l.status === 'approved') state = 'done';
    return { key: s.key, ar: s.ar, en: s.en, state, d };
  });
}
const SEG: Record<StageState, string> = {
  done: 'bg-emerald-500', rejected: 'bg-red-500', asked: 'bg-orange-400', current: 'bg-amber-400 animate-pulse', waiting: 'bg-slate-200',
};

/** The five stages as one bar; hover names each stage and who decided. */
function StageProgress({ l, ar }: { l: Leave; ar: boolean }) {
  const st = stageStates(l);
  return (
    <div className="flex items-center gap-1 min-w-[7.5rem]" aria-label={ar ? 'مسار الطلب' : 'Request progress'}>
      {st.map((s) => (
        <span key={s.key} title={`${ar ? s.ar : s.en}${s.d?.at ? ` — ${nameOf(s.d.by)} · ${dmy(s.d.at)}` : ''}`}
          className={`h-2 flex-1 rounded-full ${SEG[s.state]}`} />
      ))}
    </div>
  );
}

function StatusChip({ l, canAct, full, ar }: { l: Leave; canAct: boolean; full: boolean; ar: boolean }) {
  const st = leaveStatusStyle(l, false, full, canAct) || { ar: l.status, en: l.status, bg: 'bg-slate-100', text: 'text-slate-700' };
  return <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${st.bg} ${st.text}`}>{ar ? st.ar : st.en}</span>;
}

function TypeChip({ l, ar }: { l: Leave; ar: boolean }) {
  const c = l.leaveType?.color || '#64748b';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-800">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c }} />
      {(ar ? l.leaveType?.nameAr : l.leaveType?.nameEn) || '—'}
    </span>
  );
}

/** A labelled value in the detail window. */
function Info({ k, v, wide = false, ltr = false }: { k: string; v?: React.ReactNode; wide?: boolean; ltr?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white px-3 py-2.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="text-[11px] font-semibold text-slate-500">{k}</p>
      <div className="mt-0.5 text-sm font-semibold text-slate-900 break-words" dir={ltr ? 'ltr' : undefined}>{v || '—'}</div>
    </div>
  );
}

/** The whole request in one window: who, what, when, the process, the conversation and the papers; the stage decides from its footer. Shared with the HR leaves page. */
export function LeaveDetail({ l, ar, full }: { l: Leave; ar: boolean; full: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const e = l.employee || {};
  const snap = l.balanceSnapshot || {};
  const excluded: string[] = l.excludedFridays || [];
  const decisions = stageStates(l).filter((s) => s.d?.at && (full || s.d));
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl bg-gradient-to-l from-[#12325C] to-[#1d4a80] p-4 text-white">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15"><User className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">{empLabel(l)}</p>
          <p className="mt-0.5 text-xs text-white/80">{[e.employeeNumber && `#${e.employeeNumber}`, e.jobTitle, e.department].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-end">
          <p className="text-2xl font-extrabold tabular-nums leading-none">{l.days}</p>
          <p className="text-[11px] text-white/80">{t('يوم', 'days')}</p>
        </div>
      </div>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><CalendarDays className="h-3.5 w-3.5" />{t('بيانات الإجازة', 'Leave')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Info k={t('النوع', 'Type')} v={<TypeChip l={l} ar={ar} />} />
          <Info k={t('تاريخ الطلب', 'Requested on')} v={bothDates(l.createdAt, ar)} />
          {l.filedByManager && <Info wide k={t('مقدّم الطلب', 'Filed by')} v={`${nameOf(l.filedBy) || l.filedByName || nameOf(l.requester) || '—'} — ${t('قدّمها المدير نيابةً عن الموظف', 'filed by the manager for the employee')}`} />}
          {l.startDate === l.endDate
            ? <Info wide k={t('المدة', 'Duration')} v={<b className="text-[#f37121]">{t('يوم واحد فقط', 'One day only')} — {bothDates(l.startDate, ar)}</b>} />
            : <>
              <Info k={t('من', 'From')} v={bothDates(l.startDate, ar)} />
              <Info k={t('إلى', 'To')} v={bothDates(l.endDate, ar)} />
            </>}
          {excluded.length > 0 && <Info wide k={t('أيام جمعة لا تُحسب إجازة', 'Fridays not counted')} v={excluded.map((d) => d.split('-').reverse().join('/')).join('  ·  ')} />}
          {l.reason && <Info wide k={t('السبب', 'Reason')} v={l.reason} />}
          {typeof snap.available === 'number' && <Info k={t('الرصيد المتاح عند الطلب', 'Available at request')} v={`${snap.available} ${t('يوم', 'd')}`} />}
          {typeof snap.remainingAfter === 'number' && (
            <Info k={t('المتبقي بعد الإجازة', 'Remaining after')} v={<span className={snap.remainingAfter < 0 ? 'text-red-600' : ''}>{snap.remainingAfter} {t('يوم', 'd')}</span>} />
          )}
          <Info k={t('الخصم من الرصيد', 'Balance')} v={<DeductionBadge leave={l as any} ar={ar} />} />
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-600">{t('بيانات الموظف', 'Employee')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Info k={e.idType === 'national_id' ? t('رقم الهوية', 'ID no.') : t('رقم الإقامة', 'Iqama no.')} v={idOfEmp(e)} ltr />
          <Info k={t('الجنسية', 'Nationality')} v={e.nationality} />
        </div>
      </section>

      {full && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-600">{t('مسار الموافقات', 'Approval chain')}</h4>
          <LeaveChainBar leave={l as any} lang={ar ? 'ar' : 'en'} full />
        </section>
      )}

      {decisions.some((s) => s.d?.note) && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-600">{t('ملاحظات القرارات', 'Decision notes')}</h4>
          <ul className="space-y-1.5">
            {decisions.filter((s) => s.d?.note).map((s) => (
              <li key={s.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="font-semibold text-slate-800">{full ? (ar ? s.ar : s.en) : t('المراجعة', 'Review')}</span>
                {full && s.d?.by ? <span className="text-slate-500"> · {nameOf(s.d.by)}</span> : null}
                <p className="mt-0.5 text-slate-700 whitespace-pre-wrap">{s.d?.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LeaveThread leave={l as any} lang={ar ? 'ar' : 'en'} full={full} />

      {!!(l.attachments || []).length && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><Paperclip className="h-3.5 w-3.5" />{t('مرفقات الطلب', 'Attachments')}</h4>
          <AttachmentList items={l.attachments} />
        </section>
      )}
    </div>
  );
}

export default function LeaveDesk({ base, stage, canDecide, title, subtitle }: {
  base: string; stage: LeaveStage; canDecide: boolean;
  title: { ar: string; en: string }; subtitle: { ar: string; en: string };
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const full = seesLeaveProcess(user);
  const { notify, prompt } = useDialog();
  const [tab, setTab] = useState('awaiting');
  const [rows, setRows] = useState<Leave[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Leave | null>(null);

  const awaiting = `pending_${stage}`;
  const stageName = LEAVE_STAGES.find((s) => s.key === stage);
  const TABS = [
    // A read-only desk (the chairman's office) names where they wait instead of «awaiting you».
    { key: 'awaiting', ar: canDecide ? `تنتظر ${stageName?.ar || ''}` : `عند ${stageName?.ar || ''}`, en: canDecide ? 'Awaiting you' : `With ${stageName?.en || ''}`, statuses: [awaiting] },
    { key: 'in_chain', ar: full ? 'قيد المسار' : 'قيد المراجعة', en: full ? 'In the chain' : 'Under review', statuses: [...LEAVE_STAGES.map((s) => `pending_${s.key}`).filter((s) => s !== awaiting), 'info_requested'] },
    { key: 'approved', ar: 'معتمدة', en: 'Approved', statuses: ['approved'] },
    { key: 'rejected', ar: 'مرفوضة', en: 'Rejected', statuses: ['rejected'] },
    { key: 'all', ar: 'الكل', en: 'All', statuses: [] as string[] },
  ];

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: Leave[]; counts: Record<string, number> }>(`${base}/leaves?tab=${tab}`);
      setRows(d.leaves || []); setCounts(d.counts || {});
      // The open window follows the list, so a decision elsewhere shows at once.
      setOpen((o) => (o ? (d.leaves || []).find((x) => x._id === o._id) || o : o));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [base, tab, notify]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('hr:leave', useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((l) => [empLabel(l), l.employee?.employeeNumber, l.employee?.department, l.employee?.jobTitle, l.leaveType?.nameAr, l.leaveType?.nameEn]
      .some((x) => String(x || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const canActOn = (l: Leave) => canDecide && l.status === awaiting;

  // Approving signs with the approver's saved signature on the server; there is nothing to tick.
  const decide = async (l: Leave, decision: 'approved' | 'rejected') => {
    let note = '';
    if (decision === 'rejected') {
      const v = await prompt(t('سبب الرفض', 'Reason for rejection'));
      if (v === null) return;
      note = v;
    }
    setBusy(l._id);
    try {
      await api.patch(`/api/hr/leaves/${l._id}/decision`, { decision, note });
      notify(decision === 'approved' ? t('تمت الموافقة ووُضع توقيعك', 'Approved and signed') : t('رُفضت الإجازة', 'Leave rejected'), 'success');
      setOpen(null);
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(null);
  };
  const sheet = async (id: string) => {
    setPdfBusy(id);
    try { await downloadLeaveSheet(id); } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setPdfBusy(null);
  };
  const peek = async (id: string) => {
    setPdfBusy(id);
    try { await previewLeaveSheet(id, ar); } catch (e: any) { notify(e?.message || 'Preview failed', 'error'); }
    setPdfBusy(null);
  };

  const countOf = (statuses: string[]) => (statuses.length ? statuses.reduce((n, s) => n + (counts[s] || 0), 0)
    : Object.values(counts).reduce((a, b) => a + b, 0));

  // In the table the row actions are icons (the full buttons are in the detail window), so the table fits without sideways scrolling.
  const rowActions = (l: Leave) => (
    <>
      <button type="button" title={t('موافقة', 'Approve')} aria-label={t('موافقة', 'Approve')} disabled={busy === l._id} onClick={(e) => { e.stopPropagation(); decide(l, 'approved'); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy === l._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button type="button" title={t('رفض', 'Reject')} aria-label={t('رفض', 'Reject')} disabled={busy === l._id} onClick={(e) => { e.stopPropagation(); decide(l, 'rejected'); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50">
        <X className="h-4 w-4" />
      </button>
    </>
  );
  const actionButtons = (l: Leave, size: 'sm' | 'md' = 'sm') => (
    <>
      <button type="button" disabled={busy === l._id} onClick={(e) => { e.stopPropagation(); decide(l, 'approved'); }}
        className={`inline-flex items-center gap-1 rounded-lg bg-emerald-600 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 ${size === 'md' ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'}`}>
        {busy === l._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{t('موافقة', 'Approve')}
      </button>
      <button type="button" disabled={busy === l._id} onClick={(e) => { e.stopPropagation(); decide(l, 'rejected'); }}
        className={`inline-flex items-center gap-1 rounded-lg bg-red-50 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 ${size === 'md' ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'}`}>
        <X className="h-3.5 w-3.5" />{t('رفض', 'Reject')}
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader icon={<CalendarCheck className="w-6 h-6" />} title={ar ? title.ar : title.en} subtitle={ar ? subtitle.ar : subtitle.en} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {TABS.map((x) => (
            <button key={x.key} type="button" onClick={() => setTab(x.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${tab === x.key ? 'bg-[#12325C] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300'}`}>
              {ar ? x.ar : x.en} <span className={`ms-1 rounded-full px-1.5 tabular-nums text-xs ${tab === x.key ? 'bg-white/20' : 'bg-slate-100'}`}>{countOf(x.statuses).toLocaleString('en-US')}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو الرقم أو القسم…', 'Search name, number, department…')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2 ps-9 pe-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </label>
      </div>

      {loading ? <Spinner /> : shown.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500">{t('لا توجد طلبات هنا', 'Nothing here')}</div>
      ) : (
        <>
          {/* Wide screens: one line per cell. */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-xs text-slate-300 whitespace-nowrap">
                    <th className="px-4 py-3 text-start font-semibold">{t('الموظف', 'Employee')}</th>
                    <th className="hidden 2xl:table-cell px-4 py-3 text-start font-semibold">{t('القسم', 'Department')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t('النوع', 'Type')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t('من', 'From')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t('إلى', 'To')}</th>
                    <th className="px-4 py-3 text-center font-semibold">{t('الأيام', 'Days')}</th>
                    {full && <th className="px-4 py-3 text-start font-semibold">{t('المسار', 'Progress')}</th>}
                    <th className="px-4 py-3 text-start font-semibold">{t('الحالة', 'Status')}</th>
                    <th className="px-4 py-3 text-end font-semibold">{t('الإجراءات', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((l) => (
                    <tr key={l._id} onClick={() => setOpen(l)} className={`cursor-pointer transition hover:bg-slate-50 ${canActOn(l) ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="max-w-[14rem] truncate font-semibold text-slate-900" title={empLabel(l)}>{empLabel(l)}</p>
                        <p className="text-[11px] text-slate-500 truncate max-w-[14rem]">{[l.employee?.employeeNumber && `#${l.employee.employeeNumber}`, l.employee?.jobTitle, l.employee?.department].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="hidden 2xl:table-cell px-4 py-3 whitespace-nowrap text-slate-700">{l.employee?.department || '—'}</td>
                      <td className="px-4 py-3"><TypeChip l={l} ar={ar} /></td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">{dm(l.startDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">{l.startDate === l.endDate
                        ? <span className="text-[12px] font-bold text-[#f37121]">{t('يوم واحد فقط', 'One day only')}</span> : dm(l.endDate)}</td>
                      <td className="px-4 py-3 text-center font-bold tabular-nums">{l.days}</td>
                      {full && <td className="px-4 py-3"><StageProgress l={l} ar={ar} /></td>}
                      <td className="px-4 py-3"><StatusChip l={l} canAct={canActOn(l)} full={full} ar={ar} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {canActOn(l) && rowActions(l)}
                          <button type="button" title={t('معاينة ورقة الإجازة بالتوقيعات', 'Preview the sheet with signatures')} onClick={(e) => { e.stopPropagation(); peek(l._id); }} disabled={pdfBusy === l._id}
                            className="inline-flex items-center rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-[#f37121]/10 hover:text-[#f37121] disabled:opacity-50"><Eye className="h-4 w-4" /></button>
                          <button type="button" title={t('ورقة الإجازة PDF', 'Leave sheet PDF')} onClick={(e) => { e.stopPropagation(); sheet(l._id); }} disabled={pdfBusy === l._id}
                            className="inline-flex items-center rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-[#f37121]/10 hover:text-[#f37121] disabled:opacity-50">
                            {pdfBusy === l._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phones: one card per request. */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {shown.map((l) => (
              <button key={l._id} type="button" onClick={() => setOpen(l)}
                className={`w-full min-w-0 rounded-2xl border bg-white p-4 text-start shadow-sm transition active:scale-[0.99] ${canActOn(l) ? 'border-amber-300' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{empLabel(l)}</p>
                    <p className="truncate text-xs text-slate-500">{[l.employee?.employeeNumber && `#${l.employee.employeeNumber}`, l.employee?.department].filter(Boolean).join(' · ')}</p>
                  </div>
                  <StatusChip l={l} canAct={canActOn(l)} full={full} ar={ar} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <TypeChip l={l} ar={ar} />
                  <span className="tabular-nums text-slate-700">{l.startDate === l.endDate ? `${t('يوم واحد فقط:', 'One day only:')} ${dm(l.startDate)}` : `${t('من', 'From')} ${dm(l.startDate)} ${t('إلى', 'to')} ${dm(l.endDate)}`}</span>
                  <span className="font-bold tabular-nums">{l.days} {t('يوم', 'd')}</span>
                </div>
                {full && <div className="mt-3"><StageProgress l={l} ar={ar} /></div>}
                {!canActOn(l) && LEAVE_OPEN.includes(l.status) && <p className="mt-2 text-[11px] text-slate-500">{leaveWaitNote(l, ar, full)}</p>}
              </button>
            ))}
          </div>
        </>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={t('تفاصيل طلب الإجازة', 'Leave request')}
        footer={open ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
            <button type="button" onClick={() => peek(open._id)} disabled={pdfBusy === open._id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-[#f37121] hover:text-[#f37121] disabled:opacity-50">
              <Eye className="h-4 w-4" />{t('معاينة الورقة', 'Preview sheet')}
            </button>
            <button type="button" onClick={() => sheet(open._id)} disabled={pdfBusy === open._id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-[#f37121] hover:text-[#f37121] disabled:opacity-50">
              {pdfBusy === open._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{t('ورقة الإجازة PDF', 'Leave sheet PDF')}
            </button>
            </div>
            {canActOn(open) ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-slate-500"><PenTool className="h-3.5 w-3.5 text-[#f37121]" />{t('يُوضع توقيعك تلقائيًا عند الموافقة', 'Your signature is applied on approval')}</span>
                {actionButtons(open, 'md')}
              </div>
            ) : (LEAVE_OPEN.includes(open.status) && <span className="text-xs text-slate-500">{leaveWaitNote(open, ar, full)}</span>)}
          </div>
        ) : undefined}>
        {open && <LeaveDetail l={open} ar={ar} full={full} />}
      </Modal>
    </div>
  );
}
