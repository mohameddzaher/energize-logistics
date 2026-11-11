'use client';
// A meeting's departments as cards: each department's tasks with counts by state; a task opens in place with its full
// detail, and the administration marks it done, postpones it, updates it, or raises a follow-up or a new task here.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2, PlayCircle, CircleDashed, PauseCircle, AlertTriangle, Ban, ChevronDown, Plus, CornerDownLeft,
  Loader2, Link2, CalendarDays, User, Layers, Pencil, Users, X, ArrowLeftRight, Trash2, History,
} from 'lucide-react';
import { useDialog } from '@/components/system/DialogProvider';
import SearchSelect from '@/components/system/SearchSelect';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { StatusPill, ProgressForm, Progress, DatesLine, UpdateLog, DelegateForm } from '@/components/system/BusinessReviewKit';
import {
  brCreateAction, brUpdateAction, brShareAction, brTransferAction, brDeleteAction, brDelegate, type BrMeta, type Lang, type ProgressReport, tx, deptLabel, fmtDate, isoDay,
} from '@/lib/businessReview';

type Counts = { total: number; done: number; in_progress: number; open: number; postponed: number; blocked: number; overdue: number; today: number; agenda: number; h48: number; week: number; later: number; nodate: number; onTime: number };
type Task = any;
type Card = { key: string; counts: Counts; tasks: Task[]; managers: string[]; minutes: string; inMinutes: boolean };

// Where open tasks' deadlines fall; each one filters the card's list too.
const HORIZON: { key: 'h48' | 'week' | 'later' | 'nodate'; ar: string; en: string }[] = [
  { key: 'h48', ar: 'خلال ٤٨ ساعة', en: 'Within 48h' },
  { key: 'week', ar: 'خلال أسبوع', en: 'Within a week' },
  { key: 'later', ar: 'لاحقًا', en: 'Later' },
  { key: 'nodate', ar: 'بلا موعد', en: 'No date' },
];

// The state chips of a card; each one filters the card's list.
const CHIPS: { key: keyof Counts; ar: string; en: string; cls: string; icon: any; test: (t: Task) => boolean }[] = [
  { key: 'overdue', ar: 'متأخر', en: 'Overdue', cls: 'bg-red-600 text-white border-red-600', icon: AlertTriangle, test: (t) => t.overdue },
  { key: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress', cls: 'bg-sky-600 text-white border-sky-600', icon: PlayCircle, test: (t) => t.status === 'in_progress' },
  { key: 'open', ar: 'لم يبدأ', en: 'Not started', cls: 'bg-slate-700 text-white border-slate-700', icon: CircleDashed, test: (t) => t.status === 'open' },
  { key: 'postponed', ar: 'مؤجَّل', en: 'Postponed', cls: 'bg-amber-500 text-white border-amber-500', icon: PauseCircle, test: (t) => t.status === 'postponed' },
  { key: 'blocked', ar: 'متعثر', en: 'Blocked', cls: 'bg-rose-700 text-white border-rose-700', icon: Ban, test: (t) => t.status === 'blocked' },
  { key: 'done', ar: 'تم', en: 'Done', cls: 'bg-emerald-600 text-white border-emerald-600', icon: CheckCircle2, test: (t) => t.status === 'done' },
];

/** A company day as YYYY-MM-DD; Friday is the weekend, so it moves to Saturday. */
const dayAfter = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  if (d.getDay() === 5) d.setDate(d.getDate() + 1);
  return isoDay(d);
};
const nextWeekday = (wd: number) => { const d = new Date(); const add = ((wd - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); return isoDay(d); };
const QUICK_DATES = [
  { ar: 'غدًا', en: 'Tomorrow', at: () => dayAfter(1) },
  { ar: 'بعد يومين', en: 'In 2 days', at: () => dayAfter(2) },
  { ar: 'الأحد القادم', en: 'Next Sunday', at: () => nextWeekday(0) },
  { ar: 'نهاية الأسبوع (الخميس)', en: 'End of week (Thu)', at: () => nextWeekday(4) },
  { ar: 'بعد أسبوع', en: 'In a week', at: () => dayAfter(7) },
  { ar: 'بعد أسبوعين', en: 'In 2 weeks', at: () => dayAfter(14) },
];

export default function BrMeetingDepartments({ meetingId, meta, L, notify, initialDept = '', minutesLabel }: {
  meetingId: string; meta: BrMeta; L: Lang; notify: (m: string, k?: any) => void;
  /** Open this department's card on arrival (a link that names a department). */
  initialDept?: string;
  /** Heading for each department's part of the minutes; defaults to "this meeting's minutes". */
  minutesLabel?: string;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  const [d, setD] = useState<{ departments: Card[]; scope: string; canEdit: boolean } | null>(null);
  const [openDept, setOpenDept] = useState(initialDept);
  useEffect(() => { if (initialDept) setOpenDept(initialDept); }, [initialDept]);
  // An opened department spans the full row and moves; scroll to its top once the layout settles.
  useEffect(() => {
    if (!openDept) return;
    const id = requestAnimationFrame(() => document.getElementById(`br-dept-${openDept}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [openDept]);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [openTask, setOpenTask] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await api.get<any>(`/api/business-review/meetings/${meetingId}/departments`);
      if (mine === seq.current) setD(r);
    } catch (e: any) { if (mine === seq.current) notify(e?.message || t('Could not load', 'تعذّر التحميل'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);
  useEffect(() => { load(); }, [load]);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (tick.current) clearTimeout(tick.current); tick.current = setTimeout(() => load(), 400); }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  // Every change another user makes reaches this view: tasks, the meeting (minutes, departments), team delegations, the series.
  useSocket('br:action', soon);
  useSocket('br:meeting', soon);
  useSocket('br:assignment', soon);
  useSocket('br:series', soon);

  if (!d) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  const all = d.departments.reduce((a, c) => ({
    total: a.total + c.counts.total, done: a.done + c.counts.done, overdue: a.overdue + c.counts.overdue,
    active: a.active + c.counts.in_progress + c.counts.open + c.counts.blocked + c.counts.postponed,
    agenda: a.agenda + c.counts.agenda,
  }), { total: 0, done: 0, overdue: 0, active: 0, agenda: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-bold">{t('All tasks', 'كل البنود')}: {all.total}</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold">{t('Done', 'تم')}: {all.done}</span>
        <span className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold">{t('Open', 'مفتوحة')}: {all.active}</span>
        <span className={`px-2.5 py-1 rounded-lg font-bold ${all.agenda ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-700'}`}>{t('For discussion today', 'للنقاش اليوم')}: {all.agenda}</span>
        <span className={`px-2.5 py-1 rounded-lg font-bold ${all.overdue ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('Overdue', 'متأخر')}: {all.overdue}</span>
        <span className="text-slate-700 font-medium">
          {d.scope === 'series'
            ? t('Every task raised in this recurring meeting since it began, by department. Click a department to see its tasks.', 'جميع البنود التي أُسندت في هذا الاجتماع منذ بدايته، موزّعة على الأقسام. اضغط على القسم لعرض بنوده.')
            : t('This meeting’s tasks, by department. Click a department to see its tasks.', 'بنود هذا الاجتماع موزّعة على الأقسام. اضغط على القسم لعرض بنوده.')}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.departments.map((c) => {
          const open = openDept === c.key;
          const f = filter[c.key] || '';
          const chip = CHIPS.find((x) => x.key === f);
          const shown = chip ? c.tasks.filter(chip.test) : f ? c.tasks.filter((x) => x.horizon === f) : c.tasks;
          const pct = c.counts.total ? Math.round((c.counts.done / c.counts.total) * 100) : 0;
          return (
            <section key={c.key} id={`br-dept-${c.key}`} className={`scroll-mt-20 bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${c.counts.overdue ? 'border-red-400' : c.counts.total ? 'border-slate-300' : 'border-slate-200'} ${open ? 'lg:col-span-2' : ''}`}>
              <button type="button" onClick={() => { setOpenDept(open ? '' : c.key); setOpenTask(''); }}
                className="w-full text-start px-4 py-3 flex items-center gap-3 bg-slate-50 hover:bg-orange-50 border-b border-slate-200">
                <Layers className="w-5 h-5 text-[#f37121] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[16px] text-slate-900">{c.key === 'Unassigned' ? t('No department', 'بدون قسم') : deptLabel(c.key, L)}</p>
                  {!!c.managers?.length && <p className="text-[12.5px] text-slate-600">{t('Manager', 'المدير')}: <b className="text-slate-800">{c.managers.join('، ')}</b></p>}
                  <p className="text-[12.5px] font-semibold text-slate-700">
                    {c.counts.total} {t('tasks', 'بند')} · {t('done', 'منجز')} {c.counts.done} ({pct}%)
                    {!!c.counts.today && <> · {t('raised in this meeting', 'أُسند في هذا الاجتماع')} {c.counts.today}</>}
                  </p>
                </div>
                {c.counts.agenda
                  ? <span className="shrink-0 px-2.5 py-1 rounded-lg bg-[#f37121] text-white text-[12px] font-extrabold">{t('For discussion today', 'للنقاش اليوم')}: {c.counts.agenda}</span>
                  : <span className="shrink-0 text-[11.5px] text-slate-500 font-semibold">{t('Nothing for discussion today', 'لا بنود للنقاش اليوم')}</span>}
                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              <div className="px-4 pt-3"><Progress value={pct} color="#16a34a" /></div>

              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {CHIPS.map((x) => {
                  const n = c.counts[x.key];
                  const on = f === x.key;
                  const Icon = x.icon;
                  return (
                    <button key={x.key} type="button" disabled={!n}
                      onClick={() => { setFilter((p) => ({ ...p, [c.key]: on ? '' : x.key })); setOpenDept(c.key); }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12.5px] font-extrabold ${n ? x.cls : 'bg-slate-100 text-slate-600 border-slate-200 cursor-default'} ${on ? 'ring-2 ring-offset-1 ring-[#f37121]' : ''}`}>
                      <Icon className="w-3.5 h-3.5" />{t(x.en, x.ar)}
                      <span className={`min-w-[1.25rem] text-center rounded px-1 ${n ? 'bg-white/25' : 'bg-white text-slate-700'}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="px-4 pb-3 grid grid-cols-4 gap-1.5 text-center">
                {HORIZON.map((h) => {
                  const n = c.counts[h.key];
                  const on = f === h.key;
                  return (
                    <button key={h.key} type="button" disabled={!n}
                      onClick={() => { setFilter((p) => ({ ...p, [c.key]: on ? '' : h.key })); setOpenDept(c.key); }}
                      className={`rounded-lg border px-1 py-1.5 ${n ? 'bg-white border-slate-300 hover:border-[#f37121]' : 'bg-slate-50 border-slate-200 cursor-default'} ${on ? 'ring-2 ring-[#f37121]' : ''}`}>
                      <b className={`block text-[16px] leading-none ${n ? (h.key === 'h48' ? 'text-[#f37121]' : 'text-slate-900') : 'text-slate-400'}`}>{n}</b>
                      <span className="text-[11px] font-semibold text-slate-600">{t(h.en, h.ar)}</span>
                    </button>
                  );
                })}
              </div>

              {c.inMinutes && (
                <div className={`mx-4 mb-3 rounded-lg border px-3 py-2 text-[12.5px] ${c.minutes ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`font-bold ${c.minutes ? 'text-emerald-800' : 'text-slate-600'}`}>
                    {minutesLabel || t('This meeting’s minutes', 'محضر القسم في هذا الاجتماع')}: {c.minutes ? t('written', 'مكتوب') : t('not written yet', 'لم يُكتب بعد')}
                  </p>
                  {c.minutes && <p className={`mt-1 text-slate-800 whitespace-pre-wrap ${open ? '' : 'line-clamp-2'}`}>{c.minutes}</p>}
                </div>
              )}

              {open && (
                <div className="border-t border-slate-100">
                  {!shown.length && <p className="px-4 py-6 text-center text-sm text-slate-400">{t('No tasks here.', 'لا توجد بنود هنا.')}</p>}
                  <div className="divide-y divide-slate-100">
                    {shown.map((task) => (
                      <TaskRow key={task._id} task={task} meta={meta} L={L} meetingId={meetingId} canEdit={d.canEdit} dept={c.key}
                        open={openTask === task._id} onToggle={() => setOpenTask(openTask === task._id ? '' : task._id)}
                        onChanged={load} notify={notify} />
                    ))}
                  </div>
                  {d.canEdit && <NewTask meta={meta} L={L} meetingId={meetingId} dept={c.key} onDone={load} notify={notify} />}
                </div>
              )}
            </section>
          );
        })}
        {!d.departments.length && <p className="text-sm text-slate-400 py-8 text-center lg:col-span-2">{t('No departments in this meeting.', 'لا توجد أقسام في هذا الاجتماع.')}</p>}
      </div>
    </div>
  );
}

/**
 * One task row with its actions; shared by the meeting cards and «البنود المسندة إليّ».
 * `runner` (meeting runners) adds edit/share/move/delete/follow-up; an owner keeps done/postpone/update and can hand parts to the team.
 */
export function TaskRow({ task, meta, L, meetingId, canEdit, runner = canEdit, canDelegate = false, dept, open, onToggle, onChanged, notify }: {
  task: Task; meta: BrMeta; L: Lang; meetingId: string; canEdit: boolean; runner?: boolean; canDelegate?: boolean; dept: string; open: boolean;
  onToggle: () => void; onChanged: () => void; notify: (m: string, k?: any) => void;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  const [mode, setMode] = useState<'' | 'update' | 'postpone' | 'followup' | 'edit' | 'share' | 'transfer' | 'delegate'>('');
  const { confirm } = useDialog();
  const [moveTo, setMoveTo] = useState('');
  const personOpts = (exclude: string[]) => people.filter((p) => !exclude.includes(String(p._id)))
    .map((p) => ({ value: String(p._id), label: p.name, hint: p.section ? deptLabel(p.section, L) : '' }));
  const transfer = async () => {
    if (!moveTo) return;
    setBusy(true);
    try {
      const r = await brTransferAction(task._id, moveTo);
      notify(r.merged ? t('Moved; they already shared it, so it is one task now', 'نُقل البند؛ وكان مشتركًا معه فأصبح بندًا واحدًا عنده') : t('Moved', 'نُقل البند إلى المسؤول الجديد'), 'success');
      setMode(''); setMoveTo(''); onChanged();
    } catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };
  const remove = async (onlyThisOwner: boolean) => {
    const ok = await confirm({
      tone: 'danger', confirmLabel: t('Delete', 'حذف'),
      title: onlyThisOwner ? t('Remove this owner', 'إزالة هذا المسؤول من البند') : t('Delete task', 'حذف البند'),
      message: onlyThisOwner
        ? t(`${task.assigneeName} is removed from this task; the other owners keep it.`, `يُزال ${task.assigneeName} من البند، ويبقى عند باقي المشتركين.`)
        : t('The task is deleted for everyone sharing it, with its team parts.', `يُحذف البند «${task.title}» عند كلّ المشتركين فيه مع ما وُزّع منه على الفريق.`),
    });
    if (!ok) return;
    setBusy(true);
    try { await brDeleteAction(task._id, onlyThisOwner); notify(onlyThisOwner ? t('Removed', 'أُزيل المسؤول من البند') : t('Deleted', 'حُذف البند'), 'success'); onChanged(); }
    catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };
  const [ed, setEd] = useState({ title: task.title || '', description: task.description || '', dueDate: task.dueDate ? isoDay(new Date(task.dueDate)) : '', priority: task.priority || 'medium' });
  // Several people can be added in one go; each becomes an owner of the same task.
  const [shareTo, setShareTo] = useState<string[]>([]);
  const people = [...meta.participants].sort((a, b) => String(a.section || '').localeCompare(String(b.section || '')));
  const share = async () => {
    if (!shareTo.length) return;
    setBusy(true);
    try {
      for (const id of shareTo) await brShareAction(task._id, id);
      notify(shareTo.length > 1 ? t(`Assigned to ${shareTo.length}`, `أُسند البند إلى ${shareTo.length} أشخاص أيضًا`) : t('Shared', 'أُسند البند إليه أيضًا وظهر في قسمه'), 'success');
      setMode(''); setShareTo([]); onChanged();
    } catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };;
  const [busy, setBusy] = useState(false);
  const [newDue, setNewDue] = useState('');
  const [reason, setReason] = useState('');

  const send = async (body: any, ok: string) => {
    setBusy(true);
    try { await brUpdateAction(task._id, body); notify(ok, 'success'); setMode(''); onChanged(); }
    catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };
  const done = task.status === 'done';

  return (
    <div className={open ? 'bg-orange-50/30' : done ? 'bg-emerald-50' : ''}>
      <button type="button" onClick={onToggle} className={`w-full text-start px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 ${done ? 'border-s-4 border-emerald-500 hover:bg-emerald-100/60' : 'hover:bg-slate-50'}`}>
        <span className={`flex-1 min-w-[12rem] font-semibold inline-flex items-center gap-1.5 ${done ? 'text-emerald-800' : 'text-slate-900'}`}>
          {done && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}{task.title}
        </span>
        <span className="text-[12px] text-slate-600 inline-flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-400" />{task.assigneeName}</span>
        <span className={`text-[12px] inline-flex items-center gap-1 ${task.overdue ? 'text-red-700 font-bold' : 'text-slate-500'}`}>
          <CalendarDays className="w-3.5 h-3.5" />{fmtDate(task.dueDate)}
        </span>
        {task.overdue && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">{t('Overdue', 'متأخر')}</span>}
        <StatusPill statuses={meta.actionStatuses} value={task.status} lang={L} />
        <span className="text-[11px] text-slate-400 tabular-nums w-9 text-end">{task.progress || 0}%</span>
        <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2.5">
          {task.description && <p className="text-[13px] text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg p-2.5">{task.description}</p>}
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[12.5px] text-slate-600">
            <p>{t('Owner', 'المسؤول')}: <b className="text-slate-800">{task.assigneeName}</b></p>
            {!!task.sharedWith?.length && (
              <p className="sm:col-span-2 inline-flex flex-wrap items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-sky-600" />{t('Shared with', 'مشترك مع')}:
                {task.sharedWith.map((x: any) => (
                  <span key={x._id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800">
                    <b>{x.assigneeName}</b> · {deptLabel(x.department, L)} · <StatusPill statuses={meta.actionStatuses} value={x.status} lang={L} /> {x.progress || 0}%
                    {x.expectedDate && <span className="text-sky-700"> · {t('ETA', 'متوقَّع')} {fmtDate(x.expectedDate)}</span>}
                    {x.lastUpdate?.text && <span className="text-slate-600 max-w-[22rem] truncate" title={x.lastUpdate.text}> · {x.lastUpdate.text}</span>}
                  </span>
                ))}
              </p>
            )}
            {task.raisedByName && <p>{t('Requested by', 'بطلب من')}: <b className="text-slate-800">{task.raisedByName}</b></p>}
            <p>{t('Raised in', 'أُسند في')}: <b className="text-slate-800">{task.meetingRef}</b> · {fmtDate(task.meetingDate || task.createdAt)}{task.fromThisMeeting ? ` (${t('this meeting', 'هذا الاجتماع')})` : ''}</p>
            <p>{t('Due', 'التسليم')}: <b className={task.overdue ? 'text-red-700' : 'text-slate-800'}>{fmtDate(task.dueDate)}</b></p>
            {task.completedAt && <p>{t('Completed', 'أُنجز في')}: <b className="text-emerald-700">{fmtDate(task.completedAt)}</b></p>}
            {task.postponeReason && <p className="sm:col-span-2 text-amber-800">{t('Postponed because', 'سبب التأجيل')}: {task.postponeReason}</p>}
          </div>
          <DatesLine item={task} lang={L} />
          <div className="max-w-md"><Progress value={task.progress || 0} /></div>
          {!!task.delegations?.length && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <p className="text-[12px] font-bold text-slate-700 mb-1">{t('Handed to the team', 'موزّع على الفريق')}</p>
              {task.delegations.map((x: any) => (
                <div key={x._id} className="flex flex-wrap items-center gap-2 text-[12.5px] py-0.5">
                  <User className="w-3.5 h-3.5 text-slate-400" /><b className="text-slate-800">{x.assigneeName}</b>
                  <span className="text-slate-600 flex-1 min-w-0 truncate">{x.title}</span>
                  <span className="text-slate-500">{fmtDate(x.dueDate)}</span>
                  <StatusPill statuses={meta.actionStatuses} value={x.status} lang={L} />
                  <span className="text-slate-500 tabular-nums">{x.progress || 0}%</span>
                </div>
              ))}
            </div>
          )}
          {task.followUpOf && (
            <p className="text-[12px] text-violet-700 inline-flex items-center gap-1"><CornerDownLeft className="w-3.5 h-3.5" />{t('Follow-up of', 'متابعة لـ')}: {task.followUpOf.title}</p>
          )}
          {!!task.followUps.length && (
            <div className="text-[12px] text-violet-700 flex flex-wrap items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" />{t('Follow-ups', 'بنود متابعة')}:
              {task.followUps.map((x: any) => (
                <span key={x._id} className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">{x.title} · <StatusPill statuses={meta.actionStatuses} value={x.status} lang={L} /></span>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              {!done && (
                <button type="button" disabled={busy} onClick={() => send({ status: 'done', progress: 100 }, t('Marked done', 'سُجّل البند منجزًا'))}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
                  <CheckCircle2 className="w-3.5 h-3.5" />{t('Mark done', 'تم الإنجاز')}
                </button>
              )}
              {!done && (
                <button type="button" onClick={() => setMode('postpone')}
                  className="inline-flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg px-3 py-1.5">
                  <PauseCircle className="w-3.5 h-3.5" />{t('Postpone', 'تأجيل')}
                </button>
              )}
              <button type="button" onClick={() => setMode('update')}
                className="inline-flex items-center gap-1.5 border border-slate-300 bg-white text-slate-700 text-xs font-bold rounded-lg px-3 py-1.5">
                <PlayCircle className="w-3.5 h-3.5" />{t('Update status', 'تحديث الحالة')}
              </button>
              {canDelegate && !done && (
                <button type="button" onClick={() => setMode('delegate')}
                  className="inline-flex items-center gap-1.5 border border-emerald-300 text-emerald-700 bg-white text-xs font-bold rounded-lg px-3 py-1.5">
                  <Users className="w-3.5 h-3.5" />{t('Hand parts to my team', 'توزيع على الفريق')}
                </button>
              )}
              {runner && (<>
              <button type="button" onClick={() => setMode('followup')}
                className="inline-flex items-center gap-1.5 border border-violet-300 text-violet-700 bg-white text-xs font-bold rounded-lg px-3 py-1.5">
                <Plus className="w-3.5 h-3.5" />{t('Follow-up task', 'إضافة بند متابعة')}
              </button>
              <button type="button" onClick={() => setMode('edit')}
                className="inline-flex items-center gap-1.5 border border-slate-300 text-slate-700 bg-white text-xs font-bold rounded-lg px-3 py-1.5">
                <Pencil className="w-3.5 h-3.5" />{t('Edit task', 'تعديل البند')}
              </button>
              <button type="button" onClick={() => setMode('share')}
                className="inline-flex items-center gap-1.5 border border-sky-300 text-sky-700 bg-white text-xs font-bold rounded-lg px-3 py-1.5">
                <Users className="w-3.5 h-3.5" />{t('Also assign to…', 'إسناده لمسؤولٍ آخر أيضًا')}
              </button>
              <button type="button" onClick={() => setMode('transfer')}
                className="inline-flex items-center gap-1.5 border border-indigo-300 text-indigo-700 bg-white text-xs font-bold rounded-lg px-3 py-1.5">
                <ArrowLeftRight className="w-3.5 h-3.5" />{t('Move to…', 'نقله لمسؤولٍ آخر')}
              </button>
              {!!task.sharedWith?.length && (
                <button type="button" disabled={busy} onClick={() => remove(true)}
                  className="inline-flex items-center gap-1.5 border border-red-200 bg-white text-red-600 text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
                  <X className="w-3.5 h-3.5" />{t('Remove this owner', 'إزالة هذا المسؤول')}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => remove(false)}
                className="inline-flex items-center gap-1.5 border border-red-300 bg-white text-red-700 text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />{t('Delete task', 'حذف البند')}
              </button>
              </>)}
            </div>
          )}

          {/* Every action opens on its own above the page, so the task's details stay as they are and nothing stacks under them. */}
          {mode && (() => {
            const lbl = 'block text-[12px] font-bold text-slate-600 mb-1';
            const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 focus:border-[#f37121]';
            const close = () => setMode('');
            const cancel = <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('Cancel', 'إلغاء')}</button>;
            const primary = (label: string, onClick: () => void, disabled: boolean, cls: string) => (
              <button type="button" disabled={busy || disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold text-white shadow-sm disabled:opacity-40 ${cls}`}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}{label}
              </button>
            );
            const cfg: Record<string, { icon: any; title: string; tone: string; body: any; footer?: any }> = {
              postpone: {
                icon: PauseCircle, title: t('Postpone task', 'تأجيل البند'), tone: 'bg-amber-500',
                body: (
                  <div className="space-y-4">
                    <div>
                      <span className={lbl}>{t('Quick pick', 'اختيار سريع')}</span>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_DATES.map((q) => {
                          const v = q.at();
                          return (
                            <button key={q.ar} type="button" onClick={() => setNewDue(v)}
                              className={`px-3 py-1.5 rounded-full border text-[12.5px] font-bold transition ${newDue === v ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-700 border-slate-300 hover:border-amber-400'}`}>
                              {t(q.en, q.ar)} <span className="font-normal opacity-75 tabular-nums">{v.split('-').reverse().join('/')}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block"><span className={lbl}>{t('New due date', 'الموعد الجديد')} *</span>
                        <input type="date" value={newDue} min={isoDay(new Date())} onChange={(e) => setNewDue(e.target.value)} className={inp} /></label>
                      <label className="block"><span className={lbl}>{t('Current due date', 'الموعد الحالي')}</span>
                        <p className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700">{fmtDate(task.dueDate)}</p></label>
                    </div>
                    <label className="block"><span className={lbl}>{t('Reason (optional)', 'سبب التأجيل (اختياري)')}</span>
                      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inp} /></label>
                  </div>
                ),
                footer: primary(t('Save postponement', 'تسجيل التأجيل'), () => send({ status: 'postponed', newDueDate: newDue, postponeReason: reason.trim() }, t('Postponed', 'تم تأجيل البند')), !newDue, 'bg-amber-500 hover:bg-amber-600'),
              },
              edit: {
                icon: Pencil, title: t('Edit task', 'تعديل البند'), tone: 'bg-[#f37121]',
                body: (
                  <div className="space-y-4">
                    <label className="block"><span className={lbl}>{t('Task', 'نص البند')} *</span>
                      <input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} className={inp} /></label>
                    <label className="block"><span className={lbl}>{t('Details', 'التفاصيل')}</span>
                      <textarea rows={3} value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} className={inp} /></label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block"><span className={lbl}>{t('Due date', 'موعد التسليم')}</span>
                        <input type="date" value={ed.dueDate} onChange={(e) => setEd({ ...ed, dueDate: e.target.value })} className={inp} /></label>
                      <div><span className={lbl}>{t('Priority', 'الأولوية')}</span>
                        <div className="flex gap-1.5">
                          {(meta.priorities || []).map((p: any) => (
                            <button key={p.key} type="button" onClick={() => setEd({ ...ed, priority: p.key })}
                              className={`flex-1 px-2 py-2 rounded-lg border text-[12.5px] font-bold ${ed.priority === p.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'}`}>
                              {L === 'ar' ? p.ar : p.en}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {!!task.sharedWith?.length && <p className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-[12px] text-sky-800">{t('Title, details, priority and due date change for every owner sharing it.', 'نصُّ البند وتفاصيلُه وأولويّتُه وموعدُه تتغيّر عند كلّ المشتركين فيه.')}</p>}
                  </div>
                ),
                footer: primary(t('Save', 'حفظ التعديل'), () => send({ title: ed.title.trim(), description: ed.description.trim(), dueDate: ed.dueDate || null, priority: ed.priority }, t('Saved', 'حُفظ تعديل البند')), !ed.title.trim(), 'bg-[#f37121] hover:bg-[#e06010]'),
              },
              share: {
                icon: Users, title: t('Also assign to', 'إسناده لمسؤولٍ آخر أيضًا'), tone: 'bg-sky-600',
                body: (
                  <div className="space-y-4">
                    <div><span className={lbl}>{t('Current owner', 'المسؤول الحالي')}</span>
                      <p className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-800">{task.assigneeName}</p></div>
                    <div><span className={lbl}>{t('Add owners (one or more)', 'إضافة مسؤولين (واحد أو أكثر)')} *</span>
                      <SearchSelect ar={L === 'ar'} value="" onChange={(v) => v && setShareTo((a) => (a.includes(v) ? a : [...a, v]))} placeholder={t('Search by name…', 'ابحث بالاسم…')}
                        options={personOpts([String(task.assignee?._id || task.assignee), ...(task.sharedWith || []).map((x: any) => String(x.assignee)), ...shareTo])} />
                      {!!shareTo.length && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {shareTo.map((id) => {
                            const p = people.find((x) => String(x._id) === id);
                            return (
                              <span key={id} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[12.5px] font-semibold text-sky-800">
                                {p?.name || id}
                                <button type="button" onClick={() => setShareTo((a) => a.filter((x) => x !== id))} aria-label="remove"><X className="h-3.5 w-3.5" /></button>
                              </span>
                            );
                          })}
                        </div>
                      )}</div>
                  </div>
                ),
                footer: primary(shareTo.length > 1 ? t(`Assign (${shareTo.length})`, `إسناد (${shareTo.length})`) : t('Assign', 'إسناد'), share, !shareTo.length, 'bg-sky-600 hover:bg-sky-700'),
              },
              transfer: {
                icon: ArrowLeftRight, title: t('Move to another owner', 'نقله لمسؤولٍ آخر'), tone: 'bg-indigo-600',
                body: (
                  <div className="space-y-4">
                    <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
                      <div><span className={lbl}>{t('From', 'من')}</span>
                        <p className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-800 truncate">{task.assigneeName}</p></div>
                      <ArrowLeftRight className="hidden sm:block w-4 h-4 text-slate-400 mb-3" />
                      <div><span className={lbl}>{t('To', 'إلى')} *</span>
                        <SearchSelect ar={L === 'ar'} value={moveTo} onChange={setMoveTo} placeholder={t('Search by name…', 'ابحث بالاسم…')}
                          options={personOpts([String(task.assignee?._id || task.assignee)])} /></div>
                    </div>
                  </div>
                ),
                footer: primary(t('Move', 'نقل البند'), transfer, !moveTo, 'bg-indigo-600 hover:bg-indigo-700'),
              },
              update: {
                icon: PlayCircle, title: t('Update status', 'تحديث الحالة'), tone: 'bg-emerald-600',
                body: <ProgressForm status={task.status} progress={task.progress || 0} statuses={meta.actionStatuses} lang={L} busy={busy}
                  expectedDate={task.expectedDate} onCancel={close} onSubmit={(v: ProgressReport) => send(v, t('Updated', 'تم تحديث البند'))} />,
              },
              followup: {
                icon: Plus, title: t('Follow-up task', 'إضافة بند متابعة'), tone: 'bg-violet-600',
                body: <NewTask meta={meta} L={L} meetingId={meetingId} dept={dept} followUpOf={task} inline onDone={() => { close(); onChanged(); }} notify={notify} />,
              },
              delegate: {
                icon: Users, title: t('Hand parts to my team', 'توزيع على الفريق'), tone: 'bg-emerald-600',
                body: <DelegateForm people={meta.people.filter((p) => String(p._id) !== String(meta.me._id))} defaultDue={task.dueDate} priorities={meta.priorities} lang={L} busy={busy}
                  onCancel={close}
                  onSubmit={async (rows) => {
                    setBusy(true);
                    try { await brDelegate(task._id, rows); notify(t('Delegated', 'تم التوزيع'), 'success'); close(); onChanged(); }
                    catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
                    setBusy(false);
                  }} />,
              },
            };
            const c = cfg[mode];
            if (!c) return null;
            const Icon = c.icon;
            return (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4" onClick={close}>
                <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
                  className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
                  <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
                    <span className={`grid place-items-center w-10 h-10 rounded-xl text-white shrink-0 ${c.tone}`}><Icon className="w-5 h-5" /></span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[16px] font-extrabold text-slate-900">{c.title}</h3>
                      <p className="text-[12.5px] text-slate-500 truncate" title={task.title}>{task.title}</p>
                    </div>
                    <button type="button" onClick={close} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="px-5 py-4 overflow-y-auto">{c.body}</div>
                  {c.footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/70">{cancel}{c.footer}</div>}
                </div>
              </div>
            );
          })()}

          {!!task.updates?.length && (
            <details className="group rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer select-none list-none px-3 py-2 text-[12.5px] font-bold text-slate-700 inline-flex items-center gap-1.5 w-full">
                <History className="w-3.5 h-3.5 text-slate-400" />{t('History', 'سجلّ التحديثات')} ({task.updates.length})
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 ms-auto transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-2"><UpdateLog updates={(task.updates || []).slice().reverse()} statuses={meta.actionStatuses} lang={L} /></div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** A new task for a department, or a follow-up on one task (defaults to the same owner). */
function NewTask({ meta, L, meetingId, dept, followUpOf, inline, onDone, notify }: {
  meta: BrMeta; L: Lang; meetingId: string; dept: string; followUpOf?: Task; inline?: boolean;
  onDone: () => void; notify: (m: string, k?: any) => void;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  // The department's heads first, then everyone else who can own a task.
  const people = [...meta.participants].sort((a, b) => Number(b.section === dept) - Number(a.section === dept));
  // The department head: the CFO for finance, else the section's manager.
  const head = people.find((p) => p.section === dept && p.role === 'cfo')
    || people.find((p) => p.section === dept && /_manager$/.test(p.role)) || people.find((p) => p.section === dept);
  const [open, setOpen] = useState(!!inline);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState(String(followUpOf?.assignee || head?._id || ''));
  // Other owners in any department: one task, one row per owner, shown in each owner's department card.
  const [also, setAlso] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || !who) { notify(t('Title and owner are required', 'اكتب نص البند واختر المسؤول'), 'error'); return; }
    setBusy(true);
    try {
      await brCreateAction(meetingId, {
        title: title.trim(), description: desc.trim(), assignee: who, assignees: [who, ...also.filter((x) => x !== who)], department: dept,
        ...(due ? { dueDate: due } : {}), ...(followUpOf ? { followUpOf: followUpOf._id } : {}),
      });
      notify(t('Task added', 'أُضيف البند'), 'success');
      setTitle(''); setDesc(''); setDue(''); setAlso([]); if (!inline) setOpen(false);
      onDone();
    } catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };

  if (!open) {
    return (
      <div className="px-4 py-3 border-t border-slate-100">
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[#f37121] text-sm font-bold hover:underline">
          <Plus className="w-4 h-4" />{t('New task for this department', 'إضافة بند لهذا القسم')}
        </button>
      </div>
    );
  }
  return (
    <div className={`${inline ? '' : 'border-t border-slate-100 bg-slate-50 p-3'} space-y-2`}>
      <p className="text-xs font-bold text-slate-700">
        {followUpOf ? `${t('Follow-up on', 'بند متابعة على')}: ${followUpOf.title}` : t('New task for this department', 'إضافة بند لهذا القسم')}
      </p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Task', 'نص البند')}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder={t('Details (optional)', 'تفاصيل (اختياري)')}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <SearchSelect ar={L === 'ar'} value={who} onChange={setWho} placeholder={t('Owner…', 'المسؤول…')}
          options={people.map((p) => ({ value: String(p._id), label: p.name, hint: p.section ? deptLabel(p.section, L) : '' }))} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title={t('Due', 'التسليم')}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold text-slate-600">{t('Also assign to', 'وإسناده أيضًا إلى')}:</span>
        {also.map((id) => {
          const p = people.find((x) => String(x._id) === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[12px] text-sky-800">
              {p?.name}{p?.section ? ` — ${deptLabel(p.section, L)}` : ''}
              <button type="button" onClick={() => setAlso((a) => a.filter((x) => x !== id))}><X className="w-3 h-3" /></button>
            </span>
          );
        })}
        <SearchSelect className="w-60" ar={L === 'ar'} value="" placeholder={t('+ another owner (any department)', '+ مسؤولٌ آخر (أيّ قسم)')}
          onChange={(v) => { if (v) setAlso((a) => (a.includes(v) ? a : [...a, v])); }}
          options={people.filter((p) => String(p._id) !== who && !also.includes(String(p._id))).map((p) => ({ value: String(p._id), label: p.name, hint: p.section ? deptLabel(p.section, L) : '' }))} />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={save}
          className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{t('Add', 'إضافة')}
        </button>
        <button type="button" onClick={() => (inline ? onDone() : setOpen(false))} className="text-xs text-slate-500 px-2">{t('Cancel', 'إلغاء')}</button>
      </div>
    </div>
  );
}
