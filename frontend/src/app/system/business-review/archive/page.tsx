'use client';
// Business review archive: tasks finished more than a day ago leave the meetings and are kept here with their whole timeline.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, Users, CheckCircle2, XCircle, Clock, AlarmClock } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { PageHeader, StatCard, SearchInput, Select, Spinner, ErrorNotice } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import MonthPicker from '@/components/system/MonthPicker';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { brMeta, deptLabel, fmtDate, fmtDateTime, vocabLabel, type BrMeta, type Lang } from '@/lib/businessReview';
import { StatusPill } from '@/components/system/BusinessReviewKit';

type Row = {
  _id: string; title: string; description: string; department: string; priority: string; status: string;
  assigneeName: string; sharedWith: string[]; delegatedTo: string[]; assignedByName: string; raisedByName: string;
  meeting: string; meetingRef: string; meetingTitle: string; meetingDate: string | null; meetingCadence: string;
  assignedAt: string; startDate: string | null; dueDate: string | null; originalDueDate: string | null;
  postponeCount: number; postponeReason: string; closedAt: string | null; archivedAt: string | null;
  timing: '' | 'ontime' | 'late' | 'nodue'; days: number | null; updatesCount: number;
  lastUpdate: { at: string; byName: string; text: string } | null;
};
type Payload = {
  items: Row[];
  totals: { total: number; done: number; cancelled: number; onTime: number; late: number; noDue: number; avgDays: number | null };
  options: { departments: string[]; people: { _id: string; name: string }[]; cadences: string[] };
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };

export default function BusinessReviewArchivePage() {
  const { lang, isRTL } = useLanguage();
  const L = lang as Lang;
  const ar = L === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const guard = useLatestRequest();

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [department, setDepartment] = useState('');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState('');
  const [cadence, setCadence] = useState('');
  const [timing, setTiming] = useState('');
  const [dateBy, setDateBy] = useState('closed');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState('');

  useEffect(() => { brMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { const h = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const load = useCallback(async () => {
    const mine = guard.begin();
    const p = new URLSearchParams({ dateBy });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (department) p.set('department', department);
    if (assignee) p.set('assignee', assignee);
    if (status) p.set('status', status);
    if (cadence) p.set('cadence', cadence);
    if (qd) p.set('q', qd);
    try {
      const d = await api.get<Payload>(`/api/business-review/archive?${p}`);
      if (guard.isCurrent(mine)) { setData(d); setError(''); }
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || 'Request failed'); }
  }, [guard, dateBy, from, to, department, assignee, status, cadence, qd]);
  useEffect(() => { load(); }, [load]);
  // A task closing or reopening anywhere moves it in or out of the archive.
  useSocket('br:action', useCallback(() => load(), [load]));

  const setPeriod = (f: string, tt: string) => { setMonth(''); setFrom(f); setTo(tt); };
  const today = new Date();
  const quick = [
    { k: 'today', label: t('اليوم', 'Today'), f: ymd(today), t: ymd(today) },
    { k: 'week', label: t('آخر 7 أيام', 'Last 7 days'), f: ymd(new Date(today.getTime() - 6 * 86400000)), t: ymd(today) },
    { k: 'month', label: t('هذا الشهر', 'This month'), f: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), t: ymd(today) },
    { k: 'all', label: t('الكل', 'All'), f: '', t: '' },
  ];

  const statusLabel = (s: string) => vocabLabel(meta?.actionStatuses, s, L);
  const cadenceLabel = (c: string) => (c ? vocabLabel(meta?.cadences, c, L) : '');
  const timingLabel = (x: string) => ({ ontime: t('في الموعد', 'On time'), late: t('بعد الموعد', 'Late'), nodue: t('بلا موعد', 'No due date') } as Record<string, string>)[x] || '';
  const rows = useMemo(() => (data?.items || []).filter((r) => !timing || r.timing === timing), [data, timing]);

  const COLS: (ChooserColumn & { cell: (r: Row) => React.ReactNode; exp: ExportColumn })[] = [
    { key: 'title', label: t('البند', 'Task'), locked: true, cell: (r) => <span className="font-semibold text-slate-900">{r.title}</span>, exp: { header: t('البند', 'Task'), key: 'title', width: 40 } },
    { key: 'department', label: t('القسم', 'Department'), cell: (r) => deptLabel(r.department, L), exp: { header: t('القسم', 'Department'), key: 'department', transform: (v) => deptLabel(v, L), width: 20 } },
    { key: 'assigneeName', label: t('المسؤول', 'Owner'), cell: (r) => r.assigneeName, exp: { header: t('المسؤول', 'Owner'), key: 'assigneeName', width: 22 } },
    { key: 'sharedWith', label: t('بمشاركة', 'Shared with'), cell: (r) => (r.sharedWith.length ? <span className="inline-flex items-center gap-1 text-sky-800"><Users className="w-3.5 h-3.5" />{r.sharedWith.join('، ')}</span> : '—'), exp: { header: t('بمشاركة', 'Shared with'), key: 'sharedWith', transform: (v) => (v || []).join('، '), width: 24 } },
    { key: 'delegatedTo', label: t('مُسند لفريقه', 'Delegated to'), cell: (r) => (r.delegatedTo.length ? r.delegatedTo.join('، ') : '—'), exp: { header: t('مُسند لفريقه', 'Delegated to'), key: 'delegatedTo', transform: (v) => (v || []).join('، '), width: 24 } },
    { key: 'assignedByName', label: t('أسندها', 'Assigned by'), cell: (r) => r.assignedByName || '—', exp: { header: t('أسندها', 'Assigned by'), key: 'assignedByName', width: 20 } },
    { key: 'raisedByName', label: t('طلبها', 'Requested by'), cell: (r) => r.raisedByName || '—', exp: { header: t('طلبها', 'Requested by'), key: 'raisedByName', width: 20 } },
    { key: 'meeting', label: t('الاجتماع', 'Meeting'), cell: (r) => (r.meeting ? <Link href={`/system/business-review/${r.meeting}`} className="text-[#f37121] hover:underline">{[cadenceLabel(r.meetingCadence), r.meetingRef].filter(Boolean).join(' · ') || r.meetingTitle}</Link> : '—'), exp: { header: t('الاجتماع', 'Meeting'), key: 'meetingRef', transform: (v, r) => [cadenceLabel(r.meetingCadence), v, r.meetingTitle].filter(Boolean).join(' · '), width: 32 } },
    { key: 'meetingDate', label: t('تاريخ الاجتماع', 'Meeting date'), cell: (r) => fmtDate(r.meetingDate), exp: { header: t('تاريخ الاجتماع', 'Meeting date'), key: 'meetingDate', type: 'date', width: 13 } },
    { key: 'assignedAt', label: t('أُسند في', 'Assigned at'), cell: (r) => fmtDateTime(r.assignedAt), exp: { header: t('أُسند في', 'Assigned at'), key: 'assignedAt', type: 'date', width: 16 } },
    { key: 'startDate', label: t('البداية', 'Start'), cell: (r) => fmtDate(r.startDate), exp: { header: t('البداية', 'Start'), key: 'startDate', type: 'date', width: 13 } },
    { key: 'dueDate', label: t('موعد التسليم', 'Due'), cell: (r) => fmtDate(r.dueDate), exp: { header: t('موعد التسليم', 'Due'), key: 'dueDate', type: 'date', width: 13 } },
    { key: 'originalDueDate', label: t('الموعد الأصلي', 'Original due'), cell: (r) => (r.originalDueDate ? `${fmtDate(r.originalDueDate)}${r.postponeCount ? ` (${t('أُجِّل', 'postponed')} ${r.postponeCount}×)` : ''}` : '—'), exp: { header: t('الموعد الأصلي', 'Original due'), key: 'originalDueDate', type: 'date', width: 13 } },
    { key: 'closedAt', label: t('تم الإنجاز / الإلغاء', 'Closed at'), cell: (r) => fmtDateTime(r.closedAt), exp: { header: t('تم الإنجاز / الإلغاء', 'Closed at'), key: 'closedAt', type: 'date', width: 16 } },
    { key: 'status', label: t('الحالة', 'Status'), cell: (r) => <StatusPill statuses={meta?.actionStatuses} value={r.status} lang={L} />, exp: { header: t('الحالة', 'Status'), key: 'status', transform: (v) => statusLabel(v), width: 12 } },
    { key: 'timing', label: t('الالتزام بالموعد', 'Timing'), cell: (r) => (r.timing ? <span className={`text-[12px] font-semibold ${r.timing === 'late' ? 'text-red-700' : r.timing === 'ontime' ? 'text-emerald-700' : 'text-slate-500'}`}>{timingLabel(r.timing)}</span> : '—'), exp: { header: t('الالتزام بالموعد', 'Timing'), key: 'timing', transform: (v) => timingLabel(v), width: 14 } },
    { key: 'days', label: t('المدة (يوم)', 'Days'), cell: (r) => (r.days == null ? '—' : r.days), exp: { header: t('المدة (يوم)', 'Days'), key: 'days', type: 'number', width: 10 } },
    { key: 'archivedAt', label: t('دخل الأرشيف', 'Archived at'), cell: (r) => fmtDateTime(r.archivedAt), exp: { header: t('دخل الأرشيف', 'Archived at'), key: 'archivedAt', type: 'date', width: 16 } },
    { key: 'lastUpdate', label: t('آخر تحديث', 'Last update'), cell: (r) => (r.lastUpdate?.text ? <span className="block max-w-[22rem] truncate" title={r.lastUpdate.text}>{r.lastUpdate.text}</span> : '—'), exp: { header: t('آخر تحديث', 'Last update'), key: 'lastUpdate', transform: (v) => v?.text || '', width: 40 } },
    { key: 'description', label: t('التفاصيل', 'Details'), cell: (r) => (r.description ? <span className="block max-w-[22rem] truncate" title={r.description}>{r.description}</span> : '—'), exp: { header: t('التفاصيل', 'Details'), key: 'description', width: 40 } },
  ];
  const chooser = useVisibleColumns('br-archive:columns', COLS, { defaults: ['title', 'department', 'assigneeName', 'sharedWith', 'assignedByName', 'meeting', 'assignedAt', 'dueDate', 'closedAt', 'status', 'timing'] });
  const shownCols = COLS.filter((c) => chooser.isOn(c.key));

  if (!data && !error) return <Spinner />;
  const tot = data?.totals;
  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Archive className="w-6 h-6 text-[#f37121]" />} title={t('أرشيف البنود', 'Task archive')}
        subtitle={t('كلُّ بندٍ تمّ إنجازه (أو أُلغي) ومضى عليه يوم يخرج من الاجتماعات ويُحفظ هنا بتفاصيله كاملة.', 'Every task done (or cancelled) for more than a day leaves the meetings and is kept here in full.')}>
        <div className="flex items-center gap-2">
          <ColumnChooser columns={COLS} visible={chooser.visible} onChange={chooser.setVisible} ar={ar} />
          <ExportMenu fileName="business-review-archive" lang={L}
            options={[{ key: 'shown', label: t('المعروض (بعد الفلاتر)', 'Current view (filtered)'), sheets: [{ name: t('الأرشيف', 'Archive'), rows, columns: shownCols.map((c) => c.exp) }] }]} />
        </div>
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={load} lang={L} />}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={t('إجمالي المؤرشف', 'Archived')} value={tot?.total ?? 0} accent="text-[#f37121]" onClick={() => { setStatus(''); setTiming(''); }} active={!status && !timing} />
        <StatCard label={t('تم الإنجاز', 'Done')} value={tot?.done ?? 0} accent="text-emerald-600" onClick={() => { setStatus('done'); setTiming(''); }} active={status === 'done' && !timing} />
        <StatCard label={t('في الموعد', 'On time')} value={tot?.onTime ?? 0} accent="text-emerald-700" onClick={() => { setStatus('done'); setTiming('ontime'); }} active={timing === 'ontime'} />
        <StatCard label={t('بعد الموعد', 'Late')} value={tot?.late ?? 0} accent="text-red-600" onClick={() => { setStatus('done'); setTiming('late'); }} active={timing === 'late'} />
        <StatCard label={t('ملغاة', 'Cancelled')} value={tot?.cancelled ?? 0} accent="text-slate-600" onClick={() => { setStatus('cancelled'); setTiming(''); }} active={status === 'cancelled'} />
        <StatCard label={t('متوسط المدة (يوم)', 'Avg. days')} value={tot?.avgDays ?? '—'} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={t('البند، المسؤول، الاجتماع…', 'Task, owner, meeting…')} /></div>
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="!w-auto">
            <option value="">{t('كل الأقسام', 'All departments')}</option>
            {(data?.options.departments || []).map((d) => <option key={d} value={d}>{deptLabel(d, L)}</option>)}
          </Select>
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="!w-auto">
            <option value="">{t('كل الأشخاص', 'Everyone')}</option>
            {(data?.options.people || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </Select>
          <Select value={cadence} onChange={(e) => setCadence(e.target.value)} className="!w-auto">
            <option value="">{t('كل الاجتماعات', 'All meetings')}</option>
            {(data?.options.cadences || []).map((c) => <option key={c} value={c}>{cadenceLabel(c)}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
            <option value="">{t('كل الحالات', 'All statuses')}</option>
            <option value="done">{statusLabel('done')}</option>
            <option value="cancelled">{statusLabel('cancelled')}</option>
          </Select>
          <Select value={timing} onChange={(e) => setTiming(e.target.value)} className="!w-auto">
            <option value="">{t('الالتزام بالموعد: الكل', 'Timing: all')}</option>
            <option value="ontime">{timingLabel('ontime')}</option>
            <option value="late">{timingLabel('late')}</option>
            <option value="nodue">{timingLabel('nodue')}</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-[12px] font-bold text-slate-600 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('الفترة حسب', 'Period by')}</span>
          <Select value={dateBy} onChange={(e) => setDateBy(e.target.value)} className="!w-auto">
            <option value="closed">{t('تاريخ الإنجاز', 'Closing date')}</option>
            <option value="assigned">{t('تاريخ الإسناد', 'Assignment date')}</option>
            <option value="due">{t('موعد التسليم', 'Due date')}</option>
          </Select>
          {quick.map((x) => {
            const on = !month && from === x.f && to === x.t;
            return <button key={x.k} type="button" onClick={() => setPeriod(x.f, x.t)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${on ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{x.label}</button>;
          })}
          <MonthPicker value={month} ar={ar} label={t('شهر', 'Month')}
            onChange={(v: string) => { setMonth(v); if (v) { setFrom(`${v}-01`); setTo(lastDay(v)); } else { setFrom(''); setTo(''); } }} />
          <DateRangeFilter from={from} to={to} ar={ar} onFrom={(v) => { setMonth(''); setFrom(v); }} onTo={(v) => { setMonth(''); setTo(v); }} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-[12.5px] text-slate-500">
          <span>{t(`${rows.length} بندًا`, `${rows.length} tasks`)}</span>
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{t('تم الإنجاز', 'Done')}</span>
            <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-slate-400" />{t('ملغى', 'Cancelled')}</span>
            <span className="inline-flex items-center gap-1"><AlarmClock className="w-3.5 h-3.5 text-red-500" />{t('بعد الموعد', 'Late')}</span>
          </span>
        </div>
        <ScrollX>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{shownCols.map((c) => <th key={c.key} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50/70 align-top">
                  {shownCols.map((c) => <td key={c.key} className="px-3 py-2.5 whitespace-nowrap text-slate-700">{c.cell(r)}</td>)}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={shownCols.length} className="px-3 py-10 text-center text-slate-400">{t('لا بنود في الأرشيف بهذه الفلاتر.', 'No archived tasks for these filters.')}</td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
