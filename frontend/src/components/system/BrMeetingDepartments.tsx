'use client';
// A meeting's departments as cards: each department's tasks with counts by state; a task opens in place with its full
// detail, and the administration marks it done, postpones it, updates it, or raises a follow-up or a new task here.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2, PlayCircle, CircleDashed, PauseCircle, AlertTriangle, Ban, ChevronDown, Plus, CornerDownLeft,
  Loader2, Link2, CalendarDays, User, Layers,
} from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { StatusPill, ProgressForm, Progress, DatesLine, UpdateLog } from '@/components/system/BusinessReviewKit';
import {
  brCreateAction, brUpdateAction, type BrMeta, type Lang, type ProgressReport, tx, deptLabel, fmtDate, isoDay,
} from '@/lib/businessReview';

type Counts = { total: number; done: number; in_progress: number; open: number; postponed: number; blocked: number; overdue: number; today: number };
type Task = any;
type Card = { key: string; counts: Counts; tasks: Task[] };

// The state chips of a card; each one filters the card's list.
const CHIPS: { key: keyof Counts; ar: string; en: string; cls: string; icon: any; test: (t: Task) => boolean }[] = [
  { key: 'overdue', ar: 'متأخر', en: 'Overdue', cls: 'bg-red-600 text-white border-red-600', icon: AlertTriangle, test: (t) => t.overdue },
  { key: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress', cls: 'bg-sky-600 text-white border-sky-600', icon: PlayCircle, test: (t) => t.status === 'in_progress' },
  { key: 'open', ar: 'لم يبدأ', en: 'Not started', cls: 'bg-slate-700 text-white border-slate-700', icon: CircleDashed, test: (t) => t.status === 'open' },
  { key: 'postponed', ar: 'مؤجَّل', en: 'Postponed', cls: 'bg-amber-500 text-white border-amber-500', icon: PauseCircle, test: (t) => t.status === 'postponed' },
  { key: 'blocked', ar: 'متعثر', en: 'Blocked', cls: 'bg-rose-700 text-white border-rose-700', icon: Ban, test: (t) => t.status === 'blocked' },
  { key: 'done', ar: 'تم', en: 'Done', cls: 'bg-emerald-600 text-white border-emerald-600', icon: CheckCircle2, test: (t) => t.status === 'done' },
];

export default function BrMeetingDepartments({ meetingId, meta, L, notify }: {
  meetingId: string; meta: BrMeta; L: Lang; notify: (m: string, k?: any) => void;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  const [d, setD] = useState<{ departments: Card[]; scope: string; canEdit: boolean } | null>(null);
  const [openDept, setOpenDept] = useState('');
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
  useSocket('br:action', soon);
  useSocket('br:meeting', soon);

  if (!d) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  const all = d.departments.reduce((a, c) => ({
    total: a.total + c.counts.total, done: a.done + c.counts.done, overdue: a.overdue + c.counts.overdue,
    active: a.active + c.counts.in_progress + c.counts.open + c.counts.blocked + c.counts.postponed,
  }), { total: 0, done: 0, overdue: 0, active: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-bold">{t('All tasks', 'كل البنود')}: {all.total}</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold">{t('Done', 'تم')}: {all.done}</span>
        <span className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold">{t('Still open', 'لسه شغالة')}: {all.active}</span>
        <span className={`px-2.5 py-1 rounded-lg font-bold ${all.overdue ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('Overdue', 'متأخر')}: {all.overdue}</span>
        <span className="text-slate-700 font-medium">
          {d.scope === 'series'
            ? t('Every task this recurring meeting has raised, by department.', 'كل البنود اللي اتاخدت في الاجتماع ده من أوله، مقسومة على الأقسام.')
            : t('This meeting’s tasks, by department.', 'بنود الاجتماع ده، مقسومة على الأقسام.')}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.departments.map((c) => {
          const open = openDept === c.key;
          const f = filter[c.key] || '';
          const chip = CHIPS.find((x) => x.key === f);
          const shown = chip ? c.tasks.filter(chip.test) : c.tasks;
          const pct = c.counts.total ? Math.round((c.counts.done / c.counts.total) * 100) : 0;
          return (
            <section key={c.key} className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${c.counts.overdue ? 'border-red-400' : c.counts.total ? 'border-slate-300' : 'border-slate-200'} ${open ? 'lg:col-span-2' : ''}`}>
              <button type="button" onClick={() => { setOpenDept(open ? '' : c.key); setOpenTask(''); }}
                className="w-full text-start px-4 py-3 flex items-center gap-3 bg-slate-50 hover:bg-orange-50 border-b border-slate-200">
                <Layers className="w-5 h-5 text-[#f37121] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[16px] text-slate-900">{c.key === 'Unassigned' ? t('No department', 'بدون قسم') : deptLabel(c.key, L)}</p>
                  <p className="text-[12.5px] font-semibold text-slate-700">
                    {c.counts.total} {t('tasks', 'بند')} · {t('done', 'تم')} {c.counts.done} ({pct}%)
                    {!!c.counts.today && <> · {t('raised today', 'اتاخد النهارده')} {c.counts.today}</>}
                  </p>
                </div>
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

              {open && (
                <div className="border-t border-slate-100">
                  {!shown.length && <p className="px-4 py-6 text-center text-sm text-slate-400">{t('No tasks here.', 'مفيش بنود هنا.')}</p>}
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
        {!d.departments.length && <p className="text-sm text-slate-400 py-8 text-center lg:col-span-2">{t('No departments in this meeting.', 'مفيش أقسام في الاجتماع ده.')}</p>}
      </div>
    </div>
  );
}

function TaskRow({ task, meta, L, meetingId, canEdit, dept, open, onToggle, onChanged, notify }: {
  task: Task; meta: BrMeta; L: Lang; meetingId: string; canEdit: boolean; dept: string; open: boolean;
  onToggle: () => void; onChanged: () => void; notify: (m: string, k?: any) => void;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  const [mode, setMode] = useState<'' | 'update' | 'postpone' | 'followup'>('');
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
    <div className={open ? 'bg-orange-50/30' : ''}>
      <button type="button" onClick={onToggle} className="w-full text-start px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-slate-50">
        <span className={`flex-1 min-w-[12rem] font-semibold ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{task.title}</span>
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
            {task.raisedByName && <p>{t('Requested by', 'طلبه')}: <b className="text-slate-800">{task.raisedByName}</b></p>}
            <p>{t('Raised in', 'اتاخد في')}: <b className="text-slate-800">{task.meetingRef}</b> · {fmtDate(task.meetingDate || task.createdAt)}{task.fromThisMeeting ? ` (${t('this meeting', 'الاجتماع ده')})` : ''}</p>
            <p>{t('Due', 'التسليم')}: <b className={task.overdue ? 'text-red-700' : 'text-slate-800'}>{fmtDate(task.dueDate)}</b></p>
            {task.completedAt && <p>{t('Completed', 'اتنفّذ')}: <b className="text-emerald-700">{fmtDate(task.completedAt)}</b></p>}
            {task.postponeReason && <p className="sm:col-span-2 text-amber-800">{t('Postponed because', 'سبب التأجيل')}: {task.postponeReason}</p>}
          </div>
          <DatesLine item={task} lang={L} />
          <div className="max-w-md"><Progress value={task.progress || 0} /></div>
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
                <button type="button" disabled={busy} onClick={() => send({ status: 'done', progress: 100 }, t('Marked done', 'اتسجّل إنه تم'))}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
                  <CheckCircle2 className="w-3.5 h-3.5" />{t('Done', 'تم')}
                </button>
              )}
              {!done && (
                <button type="button" onClick={() => setMode(mode === 'postpone' ? '' : 'postpone')}
                  className="inline-flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg px-3 py-1.5">
                  <PauseCircle className="w-3.5 h-3.5" />{t('Postpone', 'تأجيل')}
                </button>
              )}
              <button type="button" onClick={() => setMode(mode === 'update' ? '' : 'update')}
                className="inline-flex items-center gap-1.5 border border-slate-300 bg-white text-slate-700 text-xs font-bold rounded-lg px-3 py-1.5">
                <PlayCircle className="w-3.5 h-3.5" />{t('Update status', 'تحديث الحالة')}
              </button>
              <button type="button" onClick={() => setMode(mode === 'followup' ? '' : 'followup')}
                className="inline-flex items-center gap-1.5 border border-violet-300 bg-white text-violet-700 text-xs font-bold rounded-lg px-3 py-1.5">
                <Plus className="w-3.5 h-3.5" />{t('Follow-up task', 'بند متابعة عليه')}
              </button>
            </div>
          )}

          {mode === 'postpone' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] items-end">
              <label className="block text-xs font-semibold text-amber-900">{t('New date', 'الموعد الجديد')}
                <input type="date" value={newDue} min={isoDay(new Date())} onChange={(e) => setNewDue(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg border border-amber-300 bg-white text-sm" />
              </label>
              <label className="block text-xs font-semibold text-amber-900">{t('Reason', 'السبب')}
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg border border-amber-300 bg-white text-sm" />
              </label>
              <button type="button" disabled={busy || !newDue || !reason.trim()}
                onClick={() => send({ status: 'postponed', newDueDate: newDue, postponeReason: reason.trim() }, t('Postponed', 'اتأجّل'))}
                className="bg-amber-600 text-white text-xs font-bold rounded-lg px-3 py-2 disabled:opacity-50">{t('Save', 'حفظ')}</button>
            </div>
          )}
          {mode === 'update' && (
            <ProgressForm status={task.status} progress={task.progress || 0} statuses={meta.actionStatuses} lang={L} busy={busy}
              expectedDate={task.expectedDate} onCancel={() => setMode('')}
              onSubmit={(v: ProgressReport) => send(v, t('Updated', 'اتحدّث'))} />
          )}
          {mode === 'followup' && (
            <NewTask meta={meta} L={L} meetingId={meetingId} dept={dept} followUpOf={task} inline
              onDone={() => { setMode(''); onChanged(); }} notify={notify} />
          )}

          <UpdateLog updates={(task.updates || []).slice().reverse()} statuses={meta.actionStatuses} lang={L} />
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
  const head = people.find((p) => p.section === dept && /_manager$/.test(p.role)) || people.find((p) => p.section === dept);
  const [open, setOpen] = useState(!!inline);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState(String(followUpOf?.assignee || head?._id || ''));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || !who) { notify(t('Title and owner are required', 'اكتب البند واختار المسؤول'), 'error'); return; }
    setBusy(true);
    try {
      await brCreateAction(meetingId, {
        title: title.trim(), description: desc.trim(), assignee: who, department: dept,
        ...(due ? { dueDate: due } : {}), ...(followUpOf ? { followUpOf: followUpOf._id } : {}),
      });
      notify(t('Task added', 'اتضاف البند'), 'success');
      setTitle(''); setDesc(''); setDue(''); if (!inline) setOpen(false);
      onDone();
    } catch (e: any) { notify(e?.message || t('Failed', 'تعذّر'), 'error'); }
    setBusy(false);
  };

  if (!open) {
    return (
      <div className="px-4 py-3 border-t border-slate-100">
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[#f37121] text-sm font-bold hover:underline">
          <Plus className="w-4 h-4" />{t('New task for this department', 'بند جديد للقسم ده')}
        </button>
      </div>
    );
  }
  return (
    <div className={`${inline ? 'bg-violet-50 border border-violet-200 rounded-lg' : 'border-t border-slate-100 bg-slate-50'} p-3 space-y-2`}>
      <p className="text-xs font-bold text-slate-700">
        {followUpOf ? `${t('Follow-up on', 'بند متابعة على')}: ${followUpOf.title}` : t('New task for this department', 'بند جديد للقسم ده')}
      </p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('What needs doing', 'المطلوب')}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder={t('Details (optional)', 'تفاصيل (اختياري)')}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <select value={who} onChange={(e) => setWho(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm">
          <option value="">{t('Owner…', 'المسؤول…')}</option>
          {people.map((p) => <option key={p._id} value={p._id}>{p.name}{p.section ? ` — ${deptLabel(p.section, L)}` : ''}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title={t('Due', 'التسليم')}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm" />
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
