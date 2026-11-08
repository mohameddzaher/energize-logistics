'use client';
// Department board: every business review action grouped by the department that owns it, with start, due, expected and postponement dates.
// Each manager reports for their department; a status change made by the owner anywhere reaches this page live.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  LayoutDashboard, CalendarClock, AlertTriangle, CheckCircle2, Clock, PauseCircle, PlayCircle,
  CircleDashed, Ban, ChevronDown, ChevronRight, ArrowUpRight, Repeat, Plus, Trash2, Users, FileText, Loader2,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import BrSeriesModal from '@/components/system/BrSeriesModal';
import { StatusPill, ProgressForm, Progress, SharedWith, PersonSelect } from '@/components/system/BusinessReviewKit';
import {
  brMeta, brBoard, brUpdateAction, brShareAction, brSeriesList, brCreateSeries, brUpdateSeries, brDeleteSeries, brSeriesDay,
  type BrMeta, type Lang, type ProgressReport,
  vocabColor, fmtDate, tx, deptLabel, isoDay,
} from '@/lib/businessReview';

type Row = any;
const NO_DEPT = 'Unassigned';
const PERIODS = [['today', 'Today', 'اليوم'], ['week', '7 days', 'آخر ٧ أيام'], ['month', 'This month', 'هذا الشهر'], ['all', 'All', 'الكل']] as const;
const GROUPS = [
  ['', 'All', 'الكل'], ['overdue', 'Overdue', 'متأخر'], ['in_progress', 'In progress', 'قيد التنفيذ'],
  ['open', 'Not started', 'لم يبدأ'], ['postponed', 'Postponed', 'مؤجَّل'], ['blocked', 'Blocked', 'متعثر'], ['done', 'Done', 'تم إنجازه'],
] as const;

const inGroup = (r: Row, g: string) => (!g ? true : g === 'overdue' ? r.overdue : r.status === g);

export default function BusinessReviewBoardPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);
  const { notify, confirm } = useDialog();

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');
  const [dept, setDept] = useState('');
  const [group, setGroup] = useState('');
  const [openRow, setOpenRow] = useState('');
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await brBoard({ period });
      if (mine === seq.current) setData(d);
    } catch (e: any) {
      if (mine === seq.current) notify(e?.message || t('Could not load', 'تعذّر التحميل'), 'error');
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { brMeta().then(setMeta).catch(() => {}); }, []);

  // Owners update from their own screens; every change lands here at once.
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => load(), 400);
  }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('br:action', soon);
  useSocket('br:assignment', soon);
  useSocket('br:meeting', soon);
  useSocket('br:series', soon);

  const depts: any[] = data?.departments || [];
  const shownDepts = useMemo(() => depts.filter((d) => !dept || d.key === dept), [depts, dept]);
  const statuses = meta?.actionStatuses;
  const dLabel = (k: string) => (k === NO_DEPT ? t('No department', 'بدون قسم') : deptLabel(k, L));

  const report = async (r: Row, v: ProgressReport) => {
    setBusy(true);
    try {
      await brUpdateAction(r._id, v);
      setEditing('');
      notify(t('Updated', 'تم التحديث'), 'success');
      load();
    } catch (e: any) {
      notify(e?.message || t('Could not save', 'تعذّر الحفظ'), 'error');
    }
    setBusy(false);
  };

  if (loading) return <Spinner />;
  const T = data?.totals || {};

  const kpi = (label: string, value: number, color: string, icon: React.ReactNode, g?: string) => (
    <button type="button" onClick={() => g !== undefined && setGroup(group === g ? '' : g)}
      className={`text-start bg-white border rounded-xl px-4 py-3 shadow-sm transition-colors ${g !== undefined && group === g ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 font-semibold truncate">{label}</p>
        <span style={{ color }}>{icon}</span>
      </div>
      <p className="text-2xl font-extrabold tabular-nums mt-1" style={{ color: value ? color : '#94a3b8' }}>{value || 0}</p>
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={<LayoutDashboard className="w-5 h-5 text-[#f37121]" />}
        title={t('Department board', 'لوحة الأقسام')}
        subtitle={t('Every department’s tasks from the review meetings: what is done, in progress, postponed and late, with their dates.',
          'مهام كل قسم من اجتماعات المراجعة: ما تم إنجازه وما قيد التنفيذ وما تأجّل وما تأخّر، بمواعيدها كاملة.')}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {PERIODS.map(([k, en, ar]) => (
              <button key={k} type="button" onClick={() => setPeriod(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${period === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                {t(en, ar)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSeriesOpen(true)}
            className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg px-3.5 py-2">
            <Repeat className="w-4 h-4" />{t('Recurring meetings', 'الاجتماعات الدورية')}
          </button>
        </div>
      </PageHeader>

      {/* Today's recurring meetings, each with its own minutes. */}
      {!!data?.today?.length && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.today.map((m: any) => (
            <div key={m._id} className="min-w-0 bg-gradient-to-l from-orange-50 to-white border border-orange-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
              <CalendarClock className="w-8 h-8 text-[#f37121] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-[#f37121]">{t('Today’s meeting', 'اجتماع اليوم')}</p>
                <p className="font-bold text-slate-900 truncate">{m.title}</p>
                <p className="text-xs text-slate-500">
                  {new Date(m.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}{t('Minutes', 'المحضر')}: {m.minutesWritten}/{m.minutesTotal} {t('departments', 'أقسام')}
                </p>
              </div>
              <button type="button" onClick={() => router.push(`/system/business-review/${m._id}`)}
                className="w-full sm:w-auto justify-center shrink-0 inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-semibold rounded-lg px-3 py-2">
                <FileText className="w-4 h-4" />{t('Open minutes', 'فتح المحضر')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpi(t('All tasks', 'كل البنود'), T.total, '#0f172a', <LayoutDashboard className="w-4 h-4" />, '')}
        {kpi(t('Done', 'تم إنجازه'), T.done, '#16a34a', <CheckCircle2 className="w-4 h-4" />, 'done')}
        {kpi(t('In progress', 'قيد التنفيذ'), T.in_progress, '#0284c7', <PlayCircle className="w-4 h-4" />, 'in_progress')}
        {kpi(t('Not started', 'لم يبدأ'), T.open, '#64748b', <CircleDashed className="w-4 h-4" />, 'open')}
        {kpi(t('Postponed', 'مؤجَّل'), T.postponed, '#d97706', <PauseCircle className="w-4 h-4" />, 'postponed')}
        {kpi(t('Blocked', 'متعثر'), T.blocked, '#dc2626', <Ban className="w-4 h-4" />, 'blocked')}
        {kpi(t('Overdue', 'متأخر'), T.overdue, '#b91c1c', <AlertTriangle className="w-4 h-4" />, 'overdue')}
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500 font-semibold">{t('Completion', 'نسبة الإنجاز')}</p>
          <p className="text-2xl font-extrabold tabular-nums mt-1 text-emerald-700">{T.completionRate || 0}%</p>
          <Progress value={T.completionRate || 0} color="#16a34a" />
        </div>
      </div>

      {/* One card per department: the manager speaks for it. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {depts.map((d) => {
          const c = d.counts;
          const on = dept === d.key;
          return (
            <button key={d.key} type="button" onClick={() => setDept(on ? '' : d.key)}
              className={`text-start bg-white border rounded-xl p-4 shadow-sm transition-all ${on ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200 hover:border-slate-300 hover:shadow'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{dLabel(d.key)}</p>
                  <p className="text-[11px] text-slate-500 truncate">{d.heads?.length ? d.heads.join('، ') : t('No manager on record', 'لا مدير مسجّل')}</p>
                </div>
                <span className="text-lg font-extrabold tabular-nums text-emerald-700">{d.completionRate}%</span>
              </div>
              <div className="mt-2"><Progress value={d.completionRate} color="#16a34a" /></div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{t('Tasks', 'بنود')} {c.total}</span>
                {!!c.done && <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">{t('Done', 'منجز')} {c.done}</span>}
                {!!c.in_progress && <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700">{t('In progress', 'قيد التنفيذ')} {c.in_progress}</span>}
                {!!c.open && <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">{t('Not started', 'لم يبدأ')} {c.open}</span>}
                {!!c.postponed && <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700">{t('Postponed', 'مؤجَّل')} {c.postponed}</span>}
                {!!c.blocked && <span className="px-2 py-0.5 rounded bg-red-50 text-red-700">{t('Blocked', 'متعثر')} {c.blocked}</span>}
                {!!c.overdue && <span className="px-2 py-0.5 rounded bg-red-600 text-white">{t('Overdue', 'متأخر')} {c.overdue}</span>}
                {!!c.dueThisWeek && <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700">{t('Due in 7 days', 'يستحق خلال ٧ أيام')} {c.dueThisWeek}</span>}
              </div>
            </button>
          );
        })}
        {!depts.length && (
          <div className="sm:col-span-2 lg:col-span-3 bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
            {t('No tasks in this period yet.', 'لا توجد بنود في هذه الفترة بعد.')}
          </div>
        )}
      </div>

      {/* Status filter for the detail below. */}
      <div className="flex items-center gap-2 flex-wrap">
        {GROUPS.map(([k, en, ar]) => (
          <button key={k} type="button" onClick={() => setGroup(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${group === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            {t(en, ar)}
          </button>
        ))}
        {dept && (
          <button type="button" onClick={() => setDept('')} className="ms-auto text-xs text-slate-500 underline">
            {t('Show all departments', 'عرض كل الأقسام')}
          </button>
        )}
      </div>

      {shownDepts.map((d) => {
        const rows = (d.items as Row[]).filter((r) => inGroup(r, group));
        if (!rows.length) return null;
        return (
          <section key={d.key} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{dLabel(d.key)}</p>
                <p className="text-[11px] text-slate-500 truncate">{d.heads?.join('، ')}</p>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{rows.length} {t('tasks', 'بند')}</span>
            </div>
            {/* Table on wide screens. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white text-[11px] text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="text-start font-semibold px-3 py-2">{t('Task', 'البند')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Owner', 'المسؤول')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Start', 'البداية')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Due', 'التسليم')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Duration', 'المدة')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Expected / done', 'متوقَّع / أُنجز')}</th>
                    <th className="text-start font-semibold px-3 py-2">{t('Status', 'الحالة')}</th>
                    <th className="text-start font-semibold px-3 py-2 hidden xl:table-cell">{t('Last update', 'آخر تحديث')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <BoardRow key={r._id} r={r} L={L} statuses={statuses} open={openRow === r._id}
                      people={data?.canRunMeetings ? meta?.participants || [] : null}
                      onShare={async (id) => {
                        try { await brShareAction(r._id, id); notify(t('Shared', 'تمت المشاركة'), 'success'); load(); }
                        catch (e: any) { notify(e?.message || t('Could not share', 'تعذّرت المشاركة'), 'error'); }
                      }}
                      onToggle={() => setOpenRow(openRow === r._id ? '' : r._id)}
                      editing={editing === r._id} setEditing={(v) => setEditing(v ? r._id : '')}
                      busy={busy} onReport={(v) => report(r, v)} onMeeting={() => router.push(`/system/business-review/${r.meeting}`)} />
                  ))}
                </tbody>
              </table>
            </div>
            {/* Cards on phones. */}
            <div className="md:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r._id} className={`p-3 ${r.overdue ? 'bg-red-50/40' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900 text-sm">{r.title}</p>
                    <StatusPill statuses={statuses} value={r.status} lang={L} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{r.assigneeName}{r.meetingRef ? ` · ${r.meetingRef}` : ''}</p>
                  <SharedWith list={r.sharedWith} lang={L} statuses={statuses} />
                  <p className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3">
                    <span>{t('Start', 'البداية')}: {fmtDate(r.startDate)}</span>
                    <span className={r.overdue ? 'text-red-600 font-bold' : ''}>{t('Due', 'التسليم')}: {fmtDate(r.dueDate)}</span>
                    {r.durationDays != null && <span>{r.durationDays} {t('d', 'يوم')}</span>}
                    {r.expectedDate && r.status !== 'done' && <span className="text-sky-700">{t('Expected', 'متوقَّع')}: {fmtDate(r.expectedDate)}</span>}
                  </p>
                  {r.status === 'postponed' && r.postponeReason && <p className="text-[11px] text-amber-700 mt-1">{t('Reason', 'السبب')}: {r.postponeReason}</p>}
                  <div className="mt-2"><Progress value={r.progress} color={vocabColor(statuses, r.status)} /></div>
                  {r.mine && editing !== r._id && (
                    <button type="button" onClick={() => setEditing(r._id)} className="mt-2 text-xs font-semibold text-[#f37121]">{t('Update status', 'تحديث الحالة')}</button>
                  )}
                  {editing === r._id && (
                    <ProgressForm status={r.status} progress={r.progress} statuses={statuses} lang={L} busy={busy}
                      expectedDate={r.expectedDate} onCancel={() => setEditing('')} onSubmit={(v) => report(r, v)} />
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {seriesOpen && meta && (
        <BrSeriesModal meta={meta} L={L} onClose={() => setSeriesOpen(false)}
          onOpenMeeting={(id) => router.push(`/system/business-review/${id}`)} notify={notify} confirm={confirm} />
      )}
    </div>
  );
}

function BoardRow({ r, L, statuses, open, onToggle, editing, setEditing, busy, onReport, onMeeting, people, onShare }: {
  r: Row; L: Lang; statuses: any; open: boolean; onToggle: () => void; people: any[] | null; onShare: (id: string) => void;
  editing: boolean; setEditing: (v: boolean) => void; busy: boolean; onReport: (v: ProgressReport) => void; onMeeting: () => void;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  return (
    <>
      <tr onClick={onToggle} className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${r.overdue ? 'bg-red-50/50' : ''}`}>
        <td className="px-3 py-2.5 align-top">
          <div className="flex items-start gap-1.5">
            {open ? <ChevronDown className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 shrink-0 rtl:rotate-180" />}
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{r.title}</p>
              <p className="text-[11px] text-slate-400">{r.meetingRef} · {fmtDate(r.meetingDate)}</p>
              <SharedWith list={r.sharedWith} lang={L} statuses={statuses} />
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 align-top text-slate-700 whitespace-nowrap">{r.assigneeName}</td>
        <td className="px-3 py-2.5 align-top tabular-nums text-slate-600 whitespace-nowrap">{fmtDate(r.startDate)}</td>
        <td className="px-3 py-2.5 align-top tabular-nums whitespace-nowrap">
          <span className={r.overdue ? 'text-red-600 font-bold' : 'text-slate-700'}>{fmtDate(r.dueDate)}</span>
          {r.originalDueDate && <p className="text-[10px] text-amber-700">{t('was', 'كان')} {fmtDate(r.originalDueDate)}</p>}
        </td>
        <td className="px-3 py-2.5 align-top tabular-nums text-slate-600 whitespace-nowrap">{r.durationDays != null ? `${r.durationDays} ${t('d', 'يوم')}` : '—'}</td>
        <td className="px-3 py-2.5 align-top tabular-nums whitespace-nowrap">
          {r.status === 'done'
            ? <span className="text-emerald-700">{fmtDate(r.completedAt)}</span>
            : r.expectedDate ? <span className="text-sky-700">{fmtDate(r.expectedDate)}</span> : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2.5 align-top min-w-[130px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusPill statuses={statuses} value={r.status} lang={L} />
            {r.overdue && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">{t('Late', 'متأخر')}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1"><Progress value={r.progress} color={vocabColor(statuses, r.status)} /></div>
            <span className="text-[10px] text-slate-500 tabular-nums">{r.progress}%</span>
          </div>
        </td>
        <td className="px-3 py-2.5 align-top text-[11px] text-slate-500 hidden xl:table-cell max-w-[220px]">
          {r.lastUpdate ? <><span className="text-slate-700">{r.lastUpdate.byName}</span> · {fmtDate(r.lastUpdate.at)}{r.lastUpdate.text ? <p className="truncate">{r.lastUpdate.text}</p> : null}</> : '—'}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-1.5 text-xs text-slate-600">
                {r.description && <p className="text-slate-800 whitespace-pre-wrap">{r.description}</p>}
                {r.raisedByName && <p>{t('Requested by', 'بطلب من')}: <b className="text-slate-800">{r.raisedByName}</b></p>}
                {r.status === 'postponed' && (
                  <p className="text-amber-700">{t('Postponed', 'مؤجَّل')} {r.postponeCount > 1 ? `${r.postponeCount}×` : ''} — {r.postponeReason}</p>
                )}
                {!!r.delegations?.length && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    {r.delegations.map((x: any) => (
                      <span key={x._id} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[11px]">{x.assigneeName} · {x.progress}%</span>
                    ))}
                  </div>
                )}
                <button type="button" onClick={onMeeting} className="inline-flex items-center gap-1 text-[#f37121] font-semibold">
                  {t('Open the meeting', 'فتح الاجتماع')} <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                {people && (
                  <div className="pt-1 max-w-xs" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[11px] text-slate-500 mb-1">{t('Also give it to another department head', 'مشاركة البند مع مدير قسم آخر')}</p>
                    <PersonSelect people={people.filter((p: any) => /_manager$/.test(p.role))} value="" lang={L}
                      exclude={[String(r.assignee), ...(r.sharedWith || []).map((x: any) => String(x.assignee || ''))]}
                      placeholder={t('Pick a manager…', 'اختر مديرًا…')} onChange={(id) => id && onShare(id)} />
                  </div>
                )}
              </div>
              <div>
                {r.mine && !editing && (
                  <button type="button" onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 text-xs rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
                    <Clock className="w-3.5 h-3.5" />{t('Update status', 'تحديث الحالة')}
                  </button>
                )}
                {editing && (
                  <ProgressForm status={r.status} progress={r.progress} statuses={statuses} lang={L} busy={busy}
                    expectedDate={r.expectedDate} onCancel={() => setEditing(false)} onSubmit={onReport} />
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
