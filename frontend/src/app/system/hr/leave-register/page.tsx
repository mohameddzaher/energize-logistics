'use client';
/**
 * The leave register: every approved leave, whether it came from an employee's request
 * (after the approval chain) or was recorded by HR. History, state, who approved it, balance.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CalendarPlus, ExternalLink, FileDown } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { isHRStaff, empName, leaveTypeLabel, type LeaveRequest } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, Modal } from '@/components/hr/HRKit';
import { LeaveChainBar, LeaveThread } from '@/components/hr/LeaveChain';
import { LeaveReturnChip, LeaveReturnPanel } from '@/components/hr/LeaveReturn';
import { DeductionBadge } from '@/components/hr/LeaveDeduction';
import LeaveRecordModal from '@/components/hr/LeaveRecordModal';
import PeriodFilter from '@/components/system/PeriodFilter';
import ScrollX from '@/components/system/ScrollX';
import { AttachmentList } from '@/components/system/FilePicker';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { downloadLeaveSheet } from '@/lib/leavePdf';

type Row = LeaveRequest & { state: string; source: string; approvedByName?: string; approvedAt?: string };

const STATES: [string, string, string, string][] = [
  ['current', 'في الإجازة الآن', 'On leave now', 'bg-blue-50 text-blue-700'],
  ['upcoming', 'قادمة', 'Upcoming', 'bg-slate-100 text-slate-700'],
  ['ended', 'انتهت — بانتظار العودة', 'Ended — return pending', 'bg-amber-50 text-amber-700'],
  ['returned', 'عاد', 'Returned', 'bg-emerald-50 text-emerald-700'],
  ['no_show', 'مخالفة — لم يعد', 'No-show', 'bg-red-50 text-red-700'],
];
const SOURCES: [string, string, string][] = [
  ['request', 'طلب من الموظف', 'Employee request'],
  ['manual', 'تسجيل الموارد البشرية', 'Recorded by HR'],
  ['backdated', 'قيد رجعي', 'Back-dated'],
];
const ymd = (v?: string | null) => String(v || '').slice(0, 10);

export default function LeaveRegisterPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const staff = isHRStaff(user);

  const [rows, setRows] = useState<Row[]>([]);
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [source, setSource] = useState('');
  const [type, setType] = useState('');
  const [dept, setDept] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: Row[]; balances: Record<string, number | null> }>('/api/hr/leave-register');
      setRows(d.leaves || []);
      setBalances(d.balances || {});
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التحميل' : 'Could not load'), 'error'); }
    setLoading(false);
  }, [ar, notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:leave', useCallback(() => load(), [load]));
  useSocket('hr:employee', useCallback(() => load(), [load]));
  // Keep the open record in step with reloads.
  useEffect(() => { setOpen((o) => (o ? rows.find((r) => r._id === o._id) || o : o)); }, [rows]);

  const types = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows) if (r.leaveType?._id) m.set(r.leaveType._id, r.leaveType);
    return [...m.values()];
  }, [rows]);
  const depts = useMemo(() => [...new Set(rows.map((r) => r.employee?.department).filter(Boolean))].sort() as string[], [rows]);

  const fold = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const base = useMemo(() => rows.filter((r) => {
    if (source && r.source !== source) return false;
    if (type && r.leaveType?._id !== type) return false;
    if (dept && r.employee?.department !== dept) return false;
    if (from && ymd(r.endDate) < from) return false;
    if (to && ymd(r.startDate) > to) return false;
    if (q.trim()) {
      const e = r.employee || {};
      const hay = fold([e.arabicName, e.firstName, e.lastName, e.employeeNumber, e.iqamaNumber, e.nationalId, r.reason].filter(Boolean).join(' '));
      if (!hay.includes(fold(q.trim()))) return false;
    }
    return true;
  }), [rows, source, type, dept, from, to, q]);
  const shown = useMemo(() => (state ? base.filter((r) => r.state === state) : base), [base, state]);
  const counts = useMemo(() => Object.fromEntries(STATES.map(([k]) => [k, base.filter((r) => r.state === k).length])), [base]);

  const stateCell = (k: string) => STATES.find((s) => s[0] === k);
  const sourceLabel = (k: string) => { const s = SOURCES.find((x) => x[0] === k); return s ? (ar ? s[1] : s[2]) : k; };
  const bal = (r: Row) => { const v = balances[String(r.employee?._id || '')]; return v === null || v === undefined ? '—' : v; };
  const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

  const columns: ExportColumn[] = [
    { header: ar ? 'الموظف' : 'Employee', key: 'employee', transform: (v: any) => empName(v, lang), width: 26 },
    { header: ar ? 'الرقم الوظيفي' : 'Emp. no.', key: 'employee', transform: (v: any) => v?.employeeNumber || '', width: 12 },
    { header: ar ? 'القسم' : 'Department', key: 'employee', transform: (v: any) => v?.department || '', width: 16 },
    { header: ar ? 'النوع' : 'Type', key: 'leaveType', transform: (v: any) => leaveTypeLabel(v, lang), width: 16 },
    { header: ar ? 'من' : 'From', key: 'startDate', transform: (v: any) => ymd(v), width: 12 },
    { header: ar ? 'إلى' : 'To', key: 'endDate', transform: (v: any) => ymd(v), width: 12 },
    { header: ar ? 'الأيام' : 'Days', key: 'days', width: 8 },
    { header: ar ? 'الحالة' : 'State', key: 'state', transform: (v: any) => { const s = stateCell(v); return s ? (ar ? s[1] : s[2]) : v; }, width: 18 },
    { header: ar ? 'المصدر' : 'Source', key: 'source', transform: (v: any) => sourceLabel(v), width: 18 },
    { header: ar ? 'اعتمدها / سجّلها' : 'Approved / recorded by', key: 'approvedByName', width: 20 },
    { header: ar ? 'التاريخ' : 'On', key: 'approvedAt', transform: (v: any) => dt(v), width: 12 },
    { header: ar ? 'الرصيد المتاح' : 'Available balance', key: 'employee', transform: (v: any) => { const b = balances[String(v?._id || '')]; return b ?? ''; }, width: 12 },
  ];
  const scope = exportScopeLabels(ar);

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  const sel = 'px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm';
  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="w-5 h-5" />} title={ar ? 'الإجازات' : 'Leaves'}
        subtitle={ar ? 'سجل كل الإجازات المعتمدة — من طلبات الموظفين أو مسجّلة من الموارد البشرية' : 'Every approved leave — from requests or recorded by HR'}>
        <button type="button" onClick={() => setRecording(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010]">
          <CalendarPlus className="w-4 h-4" /> {ar ? 'تسجيل إجازة' : 'Record a leave'}
        </button>
        <ExportMenu fileName="leave-register" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name: 'Leaves', rows: shown, columns }] },
            { key: 'all', label: scope.all, sheets: [{ name: 'Leaves', rows, columns }] },
          ]} />
      </PageHeader>

      {/* State cards filter the table below them. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATES.map(([k, a, e, cls]) => (
          <button key={k} type="button" onClick={() => setState(state === k ? '' : k)}
            className={`rounded-xl border p-3 text-start transition ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]' : 'border-slate-200 hover:border-slate-300'} bg-white`}>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{ar ? a : e}</span>
            <p className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">{counts[k] || 0}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الهوية…' : 'Name, employee no. or ID…'} /></div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel} aria-label={ar ? 'النوع' : 'Type'}>
          <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
          {types.map((t) => <option key={t._id} value={t._id}>{ar ? t.nameAr : t.nameEn}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className={sel} aria-label={ar ? 'المصدر' : 'Source'}>
          <option value="">{ar ? 'كل المصادر' : 'All sources'}</option>
          {SOURCES.map(([k, a, e]) => <option key={k} value={k}>{ar ? a : e}</option>)}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={sel} aria-label={ar ? 'القسم' : 'Department'}>
          <option value="">{ar ? 'كل الأقسام' : 'All departments'}</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <PeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} ar={ar} />
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 text-slate-300">
            {[ar ? 'الموظف' : 'Employee', ar ? 'الرقم الوظيفي' : 'Emp. no.', ar ? 'القسم' : 'Department', ar ? 'النوع' : 'Type',
              ar ? 'من' : 'From', ar ? 'إلى' : 'To', ar ? 'الأيام' : 'Days', ar ? 'الحالة' : 'State', ar ? 'المصدر' : 'Source',
              ar ? 'اعتمدها / سجّلها' : 'Approved by', ar ? 'الرصيد المتاح' : 'Balance'].map((h) => (
              <th key={h} className="text-start font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={11} className="text-center text-slate-500 py-12">{ar ? 'لا توجد إجازات' : 'No leaves'}</td></tr>
            ) : shown.map((r) => (
              <tr key={r._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(r)}>
                <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap"><span className="block max-w-[15rem] truncate" title={empName(r.employee, lang)}>{empName(r.employee, lang)}</span></td>
                <td className="px-4 py-3 text-slate-700 tabular-nums">{r.employee?.employeeNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.employee?.department || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{leaveTypeLabel(r.leaveType, lang)}</td>
                <td className="px-4 py-3 text-slate-700 tabular-nums whitespace-nowrap">{ymd(r.startDate)}</td>
                <td className="px-4 py-3 text-slate-700 tabular-nums whitespace-nowrap">{ymd(r.endDate)}</td>
                <td className="px-4 py-3 text-slate-700 tabular-nums">{r.days}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-1.5"><LeaveReturnChip leave={r} ar={ar} /><DeductionBadge leave={r} ar={ar} /></div></td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{sourceLabel(r.source)}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{r.approvedByName || '—'}{r.approvedAt ? ` · ${dt(r.approvedAt)}` : ''}</td>
                <td className="px-4 py-3 text-slate-900 font-semibold tabular-nums">{bal(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      <Modal open={!!open} onClose={() => setOpen(null)} title={ar ? 'تفاصيل الإجازة' : 'Leave details'}>
        {open && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-slate-900 font-semibold">{empName(open.employee, lang)}{open.employee?.employeeNumber ? ` · #${open.employee.employeeNumber}` : ''}</p>
              {open.employee?._id && (
                <Link href={`/system/hr/employees/${open.employee._id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#f37121] hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> {ar ? 'ملف الموظف' : 'Employee profile'}
                </Link>
              )}
            </div>
            {open.source === 'request' && <LeaveChainBar leave={open} lang={ar ? 'ar' : 'en'} />}
            {[
              [ar ? 'النوع' : 'Type', leaveTypeLabel(open.leaveType, lang)],
              [ar ? 'المدة' : 'Period', `${ymd(open.startDate)} → ${ymd(open.endDate)} (${open.days} ${ar ? 'يوم' : 'days'})`],
              [ar ? 'المصدر' : 'Source', sourceLabel(open.source)],
              [ar ? 'اعتمدها / سجّلها' : 'Approved / recorded by', `${open.approvedByName || '—'}${open.approvedAt ? ` · ${dt(open.approvedAt)}` : ''}`],
              [ar ? 'الرصيد المتاح الآن' : 'Available balance now', `${bal(open)}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className="text-slate-900">{v}</span></div>
            ))}
            {open.reason && <p className="border-t border-slate-200 pt-2"><span className="text-slate-500">{ar ? 'السبب: ' : 'Reason: '}</span>{open.reason}</p>}
            {!!(open as any).attachments?.length && (
              <div className="border-t border-slate-200 pt-2"><AttachmentList items={(open as any).attachments} /></div>
            )}
            <LeaveReturnPanel leave={open} ar={ar} canAct={staff} onDone={load} />
            <LeaveThread leave={open} lang={ar ? 'ar' : 'en'} />
            <div className="border-t border-slate-200 pt-3">
              <button type="button" onClick={async () => {
                try {
                  const { leave } = await api.get<{ leave: any }>(`/api/hr/leaves/${open._id}`);
                  await downloadLeaveSheet(leave, ar ? 'ar' : 'en');
                } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التحميل' : 'Could not download'), 'error'); }
              }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                <FileDown className="w-4 h-4" /> {ar ? 'ورقة الإجازة PDF' : 'Leave sheet PDF'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <LeaveRecordModal open={recording} onClose={() => setRecording(false)} onSaved={load} ar={ar} />
    </div>
  );
}
