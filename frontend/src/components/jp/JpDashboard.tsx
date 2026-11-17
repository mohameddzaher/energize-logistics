'use client';
/**
 * Work plan board: for the section manager only (and system admin in the management plan).
 * Top to bottom: filters (employee, day or range, project, type, contact method); six cards (open, late, due today), each opening its list below; the team, whose row filters the board; projects, contact methods and last 14 days; the task list itself, so every number above has rows below.
 * The server applies the filters to everything and returns 403 for non-managers, so the message is shown instead of an empty board.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { type JpScope, ACTION_WORDS, deadlineLine, TONE_CLASS, qs, spanWords, fmtMinutes } from '@/lib/jp';
import Link from 'next/link';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import JpDaily from '@/components/jp/JpDaily';
import ExportMenu from '@/components/ls2/ExportMenu';
import {
  BarChart3, Clock, FolderKanban, Users, UserX, ListChecks, X, Paperclip, MessageSquare, Tags, Link2, ChevronDown, CalendarClock,
} from 'lucide-react';

interface Row {
  _id: string; title: string; kind: 'task' | 'request'; assignedToName: string; createdByName: string;
  deadlineAt: string | null; doneAt: string | null; createdAt: string; project: string; files: number; doneNote: string;
  state: 'open' | 'overdue' | 'done'; action: string; comments: number; dueSoon: boolean;
  spentMinutes?: number; expectedMinutes?: number | null; links?: { kind: string; label: string; href: string }[];
  assignedToId?: string; details?: string; contact?: string; workDate?: string | null; postponeCount?: number; lastPostponeReason?: string;
  events?: JpEvent[]; commentList?: { byName: string; text: string; at: string }[]; fileList?: { name: string; url: string; phase: string }[];
}
interface JpEvent { type: string; note: string; fromAt?: string | null; toAt?: string | null; byName: string; at: string }
/** Words and colours for each step of a task's story. */
const EVENT_WORDS: Record<string, { ar: string; en: string; cls: string }> = {
  created: { ar: 'أُسنِدت', en: 'Assigned', cls: 'bg-slate-500' },
  started: { ar: 'بدأ العمل', en: 'Started', cls: 'bg-sky-500' },
  paused: { ar: 'أوقف مؤقّتًا', en: 'Paused', cls: 'bg-slate-400' },
  postponed: { ar: 'أُجِّلت', en: 'Postponed', cls: 'bg-amber-500' },
  done: { ar: 'تمّ الإنجاز', en: 'Done', cls: 'bg-emerald-600' },
  reopened: { ar: 'أُعيد فتحها', en: 'Reopened', cls: 'bg-violet-500' },
  reassigned: { ar: 'نُقلت إلى آخر', en: 'Reassigned', cls: 'bg-indigo-500' },
};
interface Member {
  _id: string; name: string; roleAr: string; roleEn: string; former?: boolean;
  assigned: number; open: number; done: number; overdue: number; onTime: number; late: number; requestsMade: number;
  completionRate: number | null; onTimeRate: number | null; avgHours: number | null;
}
interface Dash {
  sectionAr: string; sectionEn: string;
  totals: {
    total: number; tasks: number; requests: number; open: number; done: number; overdue: number; onTime: number; late: number;
    noDeadline: number; withFiles: number; dueSoon: number; completionRate: number | null; onTimeRate: number | null; postponed?: number;
  };
  members: Member[];
  idle: { _id: string; name: string }[];
  projects: { _id: string; name: string; status: string; total: number; done: number; overdue: number; people: number; progress: number | null }[];
  byAction: { action: string; total: number; done: number }[];
  daily: { day: string; created: number; done: number }[];
  tasks: Row[];
  team: { _id: string; name: string }[];
  projectOptions: { _id: string; name: string }[];
  byTitle?: { title: string; total: number; done: number; overdue: number; minutes: number; avgMinutes: number | null }[];
  titleOptions?: string[];
  linkOptions?: { kind: string; ar: string; en: string; count: number }[];
  totals2?: { minutes: number };
}

type StatusKey = '' | 'open' | 'overdue' | 'soon' | 'done' | 'postponed';
const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);
const selectCls = 'h-9 px-2.5 rounded-lg bg-white border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

function Panel({ title, icon, right, children, className = '' }: {
  title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><span className="text-[#f37121]">{icon}</span>{title}</h2>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** One cell of the numbers strip: label, number, a short line; clicking a status cell filters the task list. */
function Stat({ label, value, hint, tone = 'text-slate-900', on, onClick }: {
  label: string; value: string; hint?: string; tone?: string; on?: boolean; onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[12px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 text-[24px] leading-none font-extrabold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-1.5 truncate text-[11.5px] text-slate-400">{hint}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`px-4 py-3 text-start transition-colors hover:bg-slate-50 ${on ? 'bg-orange-50/60 shadow-[inset_0_-2px_0_#f37121]' : ''}`}>{body}</button>
  ) : <div className="px-4 py-3">{body}</div>;
}

const STATE_BADGE: Record<string, { ar: string; en: string; dot: string }> = {
  open: { ar: 'قائمة', en: 'Open', dot: 'bg-sky-500' },
  overdue: { ar: 'متأخّرة', en: 'Late', dot: 'bg-red-500' },
  done: { ar: 'تمّت', en: 'Done', dot: 'bg-emerald-500' },
};

export default function JpDashboard({ scope, section }: { scope: JpScope; section?: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [data, setData] = useState<Dash | null>(null);
  const [denied, setDenied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [assignee, setAssignee] = useState('');
  const [project, setProject] = useState('');
  const [kind, setKind] = useState('');
  const [action, setAction] = useState('');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [status, setStatus] = useState<StatusKey>('');
  const [search, setSearch] = useState('');
  // Task rows open into their full story; the list grows by 200 on request.
  const [openRow, setOpenRow] = useState('');
  const [limit, setLimit] = useState(200);
  const [now, setNow] = useState(() => Date.now());
  const { begin, isCurrent } = useLatestRequest();
  const q = qs(scope, section);

  const load = useCallback(async () => {
    const token = begin();
    try {
      const p = new URLSearchParams(q);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (assignee) p.set('assignee', assignee);
      if (project) p.set('project', project);
      if (kind) p.set('kind', kind);
      if (action) p.set('action', action);
      if (title) p.set('title', title);
      if (link) p.set('link', link);
      const d = await api.get<Dash>(`/api/jp/dashboard?${p.toString()}`);
      if (isCurrent(token)) { setData(d); setDenied(''); setNow(Date.now()); }
    } catch (e) {
      if (isCurrent(token)) setDenied((e as { message?: string })?.message || t('تعذّر التحميل', 'Could not load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to, assignee, project, kind, action, title, link]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((d: { scope?: string; section?: string }) => {
    if (!d || (d.scope === scope && (scope === 'management' || d.section === section))) load();
  }, [load, scope, section]));

  // Status filter and search apply to the list only; the cards keep counting all statuses so they can be picked from.
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.tasks || []).filter((r) => (
      (status === '' || (status === 'soon' ? r.dueSoon : status === 'postponed' ? (r.postponeCount || 0) > 0 : r.state === status))
      && (!s || [r.title, r.assignedToName, r.createdByName, r.project, r.details, r.contact, r.doneNote,
        ...(r.links || []).map((l) => l.label), ...(r.events || []).map((e) => e.note), ...(r.commentList || []).map((c) => c.text)]
        .join(' ').toLowerCase().includes(s))
    ));
  }, [data, status, search]);

  if (denied) return <div className="py-20 text-center text-slate-500 text-sm" dir={isRTL ? 'rtl' : 'ltr'}>{denied}</div>;
  if (!data) return <Spinner />;

  const T = data.totals;
  const management = scope === 'management';
  const dayMax = Math.max(1, ...data.daily.map((d) => Math.max(d.created, d.done)));
  const person = management ? t('المدير', 'Manager') : t('الموظّف', 'Employee');
  const active = [from, to, assignee, project, kind, action, title, link].filter(Boolean).length;
  const clear = () => { setFrom(''); setTo(''); setAssignee(''); setProject(''); setKind(''); setAction(''); setTitle(''); setLink(''); setStatus(''); setSearch(''); };
  const pick = (k: StatusKey) => setStatus((cur) => (cur === k ? '' : k));

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<BarChart3 className="w-6 h-6 text-[#f37121]" />}
        title={management ? t('لوحة خطّة الإدارة', 'Management plan dashboard') : t(`لوحة خطّة العمل — ${data.sectionAr}`, `Work plan dashboard — ${data.sectionEn}`)}
      >
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{t('مباشر', 'Live')}
        </span>
      </PageHeader>

      {/* 1. Filters: one bar, including the section's own task types and linked records. */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-2">
        <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls} aria-label={person}>
          <option value="">{management ? t('كلُّ المديرين', 'All managers') : t('كلُّ الموظّفين', 'All employees')}</option>
          {data.team.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
        </select>
        {!!(data.titleOptions || []).length && (
          <select value={title} onChange={(e) => setTitle(e.target.value)} className={selectCls} aria-label={t('نوع المهمّة', 'Task type')}>
            <option value="">{t('كلُّ أنواع المهامّ', 'All task types')}</option>
            {data.titleOptions!.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        {!!(data.linkOptions || []).length && (
          <select value={link} onChange={(e) => setLink(e.target.value)} className={selectCls} aria-label={t('مرتبطة بـ', 'Linked to')}>
            <option value="">{t('مرتبطة بأيّ شيء', 'Linked to anything')}</option>
            {data.linkOptions!.map((x) => <option key={x.kind} value={x.kind}>{t(`مرتبطة بـ ${x.ar}`, `Linked to ${x.en}`)} ({x.count})</option>)}
            <option value="none">{t('بلا ارتباط', 'Not linked')}</option>
          </select>
        )}
        {data.projectOptions.length > 0 && (
          <select value={project} onChange={(e) => setProject(e.target.value)} className={selectCls} aria-label={t('المشروع', 'Project')}>
            <option value="">{t('كلُّ المشروعات', 'All projects')}</option>
            {data.projectOptions.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            <option value="none">{t('بلا مشروع', 'No project')}</option>
          </select>
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls} aria-label={t('النوع', 'Kind')}>
          <option value="">{t('مهامّ وطلبات', 'Tasks and requests')}</option>
          <option value="task">{t('مهامّ فقط', 'Tasks only')}</option>
          <option value="request">{t('طلبات فقط', 'Requests only')}</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={selectCls} aria-label={t('طريقة التواصل', 'Contact method')}>
          <option value="">{t('كلُّ طرق التواصل', 'Any contact method')}</option>
          {(Object.keys(ACTION_WORDS) as (keyof typeof ACTION_WORDS)[]).map((k) => <option key={k} value={k}>{ar ? ACTION_WORDS[k].ar : ACTION_WORDS[k].en}</option>)}
          <option value="none">{t('بلا تواصل', 'No contact')}</option>
        </select>
        {(active > 0 || status || search) && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 px-2 py-2 text-[13px] font-semibold text-slate-500 hover:text-red-600">
            <X className="w-4 h-4" />{t('مسح الفلاتر', 'Clear')}
          </button>
        )}
      </div>

      {/* 2. Numbers: one strip; the status cells filter the task list. */}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-4 xl:grid-cols-8 divide-y divide-slate-100 sm:divide-y-0 sm:divide-x rtl:sm:divide-x-reverse">
        <Stat label={t('الإجمالي', 'Total')} value={String(T.total)} hint={t(`${T.tasks} مهمّة · ${T.requests} طلب`, `${T.tasks} tasks · ${T.requests} requests`)} on={status === ''} onClick={() => setStatus('')} />
        <Stat label={t('قائمة', 'Open')} value={String(T.open - T.overdue)} tone="text-sky-700" hint={t(`${T.noDeadline} بلا موعد`, `${T.noDeadline} no deadline`)} on={status === 'open'} onClick={() => pick('open')} />
        <Stat label={t('متأخّرة', 'Late')} value={String(T.overdue)} tone={T.overdue ? 'text-red-600' : 'text-slate-900'} hint={t('فات موعدها', 'Past deadline')} on={status === 'overdue'} onClick={() => pick('overdue')} />
        <Stat label={t('خلال 24 ساعة', 'Due in 24h')} value={String(T.dueSoon)} tone={T.dueSoon ? 'text-amber-600' : 'text-slate-900'} hint={t('موعدها قريب', 'Deadline near')} on={status === 'soon'} onClick={() => pick('soon')} />
        <Stat label={t('تمّت', 'Done')} value={String(T.done)} tone="text-emerald-700" hint={t(`${T.onTime} في موعدها · ${T.late} بعده`, `${T.onTime} on time · ${T.late} late`)} on={status === 'done'} onClick={() => pick('done')} />
        <Stat label={t('أُجِّلت', 'Postponed')} value={String(T.postponed || 0)} tone={T.postponed ? 'text-amber-700' : 'text-slate-900'} hint={t('بسببٍ مكتوب', 'with a reason')} on={status === 'postponed'} onClick={() => pick('postponed')} />
        <Stat label={t('نسبة الإتمام', 'Completion')} value={pctText(T.completionRate)} />
        <Stat label={t('في موعدها', 'On time')} value={pctText(T.onTimeRate)} hint={t('من التي لها موعد', 'of those with a deadline')} />
        <Stat label={t('الوقت المسجّل', 'Time logged')} value={data.totals2?.minutes ? fmtMinutes(data.totals2.minutes, ar) : '—'} hint={t('بالمؤقّت', 'by timer')} />
      </div>

      {/* 3. Team */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel className="xl:col-span-2" title={management ? t('المديرون', 'Managers') : t('الفريق', 'Team')} icon={<Users className="w-4 h-4" />}
          right={<span className="text-[11px] text-slate-400">{t('اضغط اسمًا لتصفية اللوحة به', 'Click a name to filter by it')}</span>}>
          <div className="overflow-x-auto -mx-5 -my-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200 text-[11.5px] [&>th]:py-2.5 [&>th]:px-3">
                  <th className="text-start font-medium pb-2">{person}</th>
                  <th className="text-center font-medium pb-2">{t('أُسنِد', 'Assigned')}</th>
                  <th className="text-center font-medium pb-2">{t('قائمة', 'Open')}</th>
                  <th className="text-center font-medium pb-2">{t('متأخّرة', 'Late')}</th>
                  <th className="text-center font-medium pb-2">{t('تمّت', 'Done')}</th>
                  <th className="text-start font-medium pb-2 w-40">{t('الإتمام', 'Completion')}</th>
                  <th className="text-center font-medium pb-2">{t('في موعدها', 'On time')}</th>
                  <th className="text-center font-medium pb-2">{t('متوسّط الإنجاز', 'Avg. time')}</th>
                  <th className="text-center font-medium pb-2">{t('طلباتٌ كتبها', 'Requests made')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.members.map((m) => (
                  <tr key={m._id} className={`hover:bg-slate-50 ${assignee === m._id ? 'bg-orange-50/50' : ''}`}>
                    <td className="py-2.5 px-3">
                      <button type="button" disabled={m.former} onClick={() => setAssignee(assignee === m._id ? '' : m._id)} className="text-start">
                        <span className="block font-semibold text-slate-900 hover:text-[#f37121]">{m.name}{m.former && <span className="ms-1 text-[11px] text-slate-400">{t('(خارج الفريق)', '(left team)')}</span>}</span>
                        <span className="block text-[11.5px] text-slate-500">{ar ? m.roleAr : m.roleEn}</span>
                      </button>
                    </td>
                    <td className="text-center tabular-nums">{m.assigned}</td>
                    <td className="text-center tabular-nums font-semibold">{m.open}</td>
                    <td className="text-center"><span className={`inline-block min-w-[26px] px-1.5 py-0.5 rounded-full tabular-nums text-[12px] ${m.overdue ? 'bg-red-50 text-red-700 font-bold' : 'text-slate-300'}`}>{m.overdue}</span></td>
                    <td className="text-center tabular-nums text-emerald-700">{m.done}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.completionRate || 0}%` }} /></div>
                        <span className="w-10 text-[11.5px] tabular-nums text-slate-500 text-end">{pctText(m.completionRate)}</span>
                      </div>
                    </td>
                    <td className="text-center tabular-nums">{pctText(m.onTimeRate)}</td>
                    <td className="text-center tabular-nums">{m.avgHours == null ? '—' : spanWords(m.avgHours * 3600000, ar)}</td>
                    <td className="text-center tabular-nums">{m.requestsMade}</td>
                  </tr>
                ))}
                {!data.members.length && <tr><td colSpan={9} className="py-6 text-center text-slate-400">{t('لا أحد في الفريق بعد', 'No one on the team yet')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title={t('بلا مهامَّ قائمة', 'Nothing open')} icon={<UserX className="w-4 h-4" />}
            right={<span className="text-[11px] text-slate-400 tabular-nums">{data.idle.length}</span>}>
            {data.idle.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {data.idle.map((m) => <li key={m._id} className="px-2.5 py-1 rounded-full bg-slate-100 text-[12.5px] text-slate-700">{m.name}</li>)}
              </ul>
            ) : <p className="text-sm text-slate-400">{t('الكلُّ عليه عمل', 'Everyone has work')}</p>}
          </Panel>
          <Panel title={t('بطريقة التواصل', 'By contact method')} icon={<Clock className="w-4 h-4" />}>
            <ul className="space-y-2.5">
              {data.byAction.map((a) => {
                const w = ACTION_WORDS[a.action as keyof typeof ACTION_WORDS];
                return (
                  <li key={a.action}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-slate-700">{w ? (ar ? w.ar : w.en) : t('بلا تواصل', 'No contact')}</span>
                      <span className="tabular-nums text-slate-900 font-semibold">{a.total}<span className="ms-1.5 text-[11.5px] font-normal text-emerald-700">{t(`${a.done} تمّت`, `${a.done} done`)}</span></span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#f37121]/70" style={{ width: `${T.total ? (a.total / T.total) * 100 : 0}%` }} /></div>
                  </li>
                );
              })}
              {!data.byAction.length && <li className="text-sm text-slate-400">{t('لا شيء بعد', 'Nothing yet')}</li>}
            </ul>
          </Panel>
        </div>
      </div>

      {/* 4. By task type: the section's own work, how much of each and how long it took. */}
      <Panel title={t('حسب نوع المهمّة', 'By task type')} icon={<Tags className="w-4 h-4" />}
        right={<span className="text-[11px] text-slate-400">{t('اضغط نوعًا لتصفية اللوحة به', 'Click a type to filter by it')}</span>}>
        {(data.byTitle || []).length ? (
          <div className="overflow-x-auto -mx-5 -my-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200 text-[11.5px] [&>th]:py-2.5 [&>th]:px-3">
                  <th className="text-start font-medium">{t('نوع المهمّة', 'Task type')}</th>
                  <th className="text-center font-medium">{t('العدد', 'Count')}</th>
                  <th className="text-center font-medium">{t('تمّت', 'Done')}</th>
                  <th className="text-center font-medium">{t('متأخّرة', 'Late')}</th>
                  <th className="text-start font-medium w-48">{t('الإتمام', 'Completion')}</th>
                  <th className="text-center font-medium">{t('الوقت المسجّل', 'Time logged')}</th>
                  <th className="text-center font-medium">{t('متوسّط المهمّة', 'Avg per task')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byTitle!.map((b) => {
                  const pctDone = b.total ? Math.round((b.done / b.total) * 100) : 0;
                  return (
                    <tr key={b.title} className={`hover:bg-slate-50 ${title === b.title ? 'bg-orange-50/50' : ''}`}>
                      <td className="px-3 py-2.5"><button type="button" onClick={() => setTitle(title === b.title ? '' : b.title)} className="font-semibold text-slate-900 hover:text-[#f37121]">{b.title}</button></td>
                      <td className="px-3 text-center tabular-nums">{b.total}</td>
                      <td className="px-3 text-center tabular-nums text-emerald-700">{b.done}</td>
                      <td className={`px-3 text-center tabular-nums ${b.overdue ? 'font-bold text-red-600' : 'text-slate-300'}`}>{b.overdue}</td>
                      <td className="px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pctDone}%` }} /></div>
                          <span className="w-9 text-[11.5px] tabular-nums text-slate-500 text-end">{pctDone}%</span>
                        </div>
                      </td>
                      <td className="px-3 text-center tabular-nums">{b.minutes ? fmtMinutes(b.minutes, ar) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 text-center tabular-nums text-slate-500">{b.avgMinutes ? fmtMinutes(b.avgMinutes, ar) : <span className="text-slate-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="py-4 text-center text-sm text-slate-400">{t('لا مهامَّ في هذا الاختيار', 'No tasks in this selection')}</p>}
      </Panel>

      {/* 5. Daily log: who worked on what, and the time logged. */}
      <JpDaily scope={scope} section={section} ar={ar} />

      {/* 6. Projects and daily trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('المشروعات', 'Projects')} icon={<FolderKanban className="w-4 h-4" />}>
          {data.projects.length ? (
            <ul className="space-y-3">
              {data.projects.map((p) => (
                <li key={p._id} className={p.status === 'closed' ? 'opacity-60' : ''}>
                  <button type="button" onClick={() => setProject(project === p._id ? '' : p._id)} className="w-full text-start">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="font-bold text-slate-900 hover:text-[#f37121] truncate">{p.name || t('مهامُّ بلا مشروع', 'Tasks without a project')}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 text-[12px]">
                        {t(`${p.done} من ${p.total} · ${p.people} مشاركًا`, `${p.done} of ${p.total} · ${p.people} people`)}
                        {!!p.overdue && <span className="text-red-600 font-semibold"> · {t(`${p.overdue} متأخّرة`, `${p.overdue} late`)}</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress || 0}%` }} /></div>
                      <span className="w-10 text-[11.5px] tabular-nums text-slate-500 text-end">{pctText(p.progress)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="py-4 text-center text-sm text-slate-400">{t('لا مشروعات بعد', 'No projects yet')}</p>}
        </Panel>

        <Panel title={t('آخر 14 يومًا', 'Last 14 days')} icon={<BarChart3 className="w-4 h-4" />}
          right={<span className="text-[11px] text-slate-400"><span className="inline-block w-2 h-2 rounded-sm bg-slate-300 me-1" />{t('أُسنِدت', 'assigned')}<span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 ms-3 me-1" />{t('تمّت', 'done')}</span>}>
          <div className="flex items-end gap-1.5 h-40">
            {data.daily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day} — ${t('أُسنِدت', 'assigned')} ${d.created} · ${t('تمّت', 'done')} ${d.done}`}>
                <div className="w-full flex items-end justify-center gap-0.5 h-32">
                  <div className="w-1/2 rounded-t bg-slate-300" style={{ height: `${(d.created / dayMax) * 100}%` }} />
                  <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: `${(d.done / dayMax) * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* 7. The tasks themselves: filter by person, open any row for its whole story (each step, note and time). */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
            <span className="text-[#f37121]"><ListChecks className="w-4 h-4" /></span>
            {status === 'overdue' ? t('المتأخّرة', 'Late') : status === 'soon' ? t('تستحقّ خلال 24 ساعة', 'Due within 24h')
              : status === 'done' ? t('التي تمّت', 'Done') : status === 'open' ? t('القائمة', 'Open') : status === 'postponed' ? t('المؤجَّلة', 'Postponed') : t('كلُّ المهامّ', 'All tasks')}
            <span className="text-[12px] font-semibold text-slate-400 tabular-nums">({rows.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls} aria-label={person}>
              <option value="">{t('كلُّ الأشخاص', 'Everyone')}</option>
              {data.members.map((m) => <option key={m._id} value={m._id}>{m.name}{m.assigned ? ` (${m.assigned})` : ''}</option>)}
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('بحث في المهمّة والتفاصيل والملاحظات…', 'Search task, details, notes…')}
              className="w-64 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
            <ExportMenu fileName="jp-tasks" lang={ar ? 'ar' : 'en'}
              options={[{ key: 'shown', label: t('المعروض بكلّ التفاصيل', 'Shown, all details'), sheets: [{ name: t('المهامّ', 'Tasks'), rows, columns: [
                { header: t('المطلوب', 'Task'), key: 'title' },
                { header: t('إلى', 'To'), key: 'assignedToName' }, { header: t('من', 'From'), key: 'createdByName' },
                { header: t('الحالة', 'State'), key: 'state', transform: (v: any) => (STATE_BADGE[v as Row['state']] ? (ar ? STATE_BADGE[v as Row['state']].ar : STATE_BADGE[v as Row['state']].en) : v) },
                { header: t('أُسنِدت في', 'Assigned on'), key: 'createdAt', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '') },
                { header: t('الموعد', 'Deadline'), key: 'deadlineAt', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '') },
                { header: t('تمّت في', 'Done on'), key: 'doneAt', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '') },
                { header: t('التفاصيل', 'Details'), key: 'details' },
                { header: t('التواصل', 'Contact'), key: 'action', transform: (v: any, r: any) => [v ? (ar ? (ACTION_WORDS as any)[v]?.ar : (ACTION_WORDS as any)[v]?.en) : '', r.contact].filter(Boolean).join(' · ') },
                { header: t('تتعلّق بـ', 'Related to'), key: 'links', transform: (v: any) => (v || []).map((l: any) => l.label).join('، ') },
                { header: t('ما تمّ', 'What was done'), key: 'doneNote' },
                { header: t('مرّات التأجيل', 'Postponed'), key: 'postponeCount', type: 'number' as const },
                { header: t('آخر سبب تأجيل', 'Last postpone reason'), key: 'lastPostponeReason' },
                { header: t('سجلّ المهمّة', 'Task log'), key: 'events', transform: (v: any) => (v || []).map((e: JpEvent) => `${new Date(e.at).toLocaleString('en-GB')} — ${ar ? EVENT_WORDS[e.type]?.ar : EVENT_WORDS[e.type]?.en} — ${e.byName}${e.note ? `: ${e.note}` : ''}`).join(' | ') },
                { header: t('الوقت (دقائق)', 'Time (min)'), key: 'spentMinutes', type: 'number' as const },
              ] }] }]} />
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className="w-8" />
                <th className="text-start font-medium px-3 py-2.5">{t('المطلوب', 'Task')}</th>
                <th className="text-start font-medium px-3 py-2">{t('إلى', 'To')}</th>
                <th className="text-start font-medium px-3 py-2">{t('من', 'From')}</th>
                <th className="text-start font-medium px-3 py-2">{t('الموعد', 'Deadline')}</th>
                <th className="text-start font-medium px-3 py-2">{t('الحالة', 'State')}</th>
                <th className="text-start font-medium px-3 py-2">{t('آخر ما حدث', 'Latest')}</th>
                <th className="text-start font-medium px-3 py-2">{t('الوقت', 'Time')}</th>
                <th className="text-start font-medium px-3 py-2">{t('أُسنِدت في', 'Assigned on')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, limit).map((r) => {
                const dl = deadlineLine({ deadlineAt: r.deadlineAt, deadlineKind: 'hours', status: r.state === 'done' ? 'done' : 'open', doneAt: r.doneAt }, now, ar);
                const b = STATE_BADGE[r.state];
                const isOpen = openRow === r._id;
                const last = [...(r.events || [])].reverse().find((e) => e.type !== 'created');
                return (
                  <Fragment key={r._id}>
                    <tr onClick={() => setOpenRow(isOpen ? '' : r._id)} className={`cursor-pointer align-top ${isOpen ? 'bg-orange-50/50' : 'hover:bg-slate-50'}`}>
                      <td className="ps-3 pt-3 text-slate-400"><ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-[#f37121]' : ''}`} /></td>
                      <td className="px-3 py-2.5 max-w-[320px]">
                        <p className="font-semibold text-slate-900">{r.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
                          <span className="font-semibold text-slate-500">{r.kind === 'task' ? t('مهمّة', 'Task') : t('طلب', 'Request')}</span>
                          {r.action && <span>{ar ? (ACTION_WORDS as any)[r.action]?.ar : (ACTION_WORDS as any)[r.action]?.en}</span>}
                          {!!r.files && <span className="inline-flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{r.files}</span>}
                          {!!r.comments && <span className="inline-flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{r.comments}</span>}
                          {!!r.postponeCount && <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800">{t(`أُجِّلت ${r.postponeCount}×`, `postponed ${r.postponeCount}×`)}</span>}
                        </p>
                        {!!(r.links || []).length && (
                          <p className="mt-1 flex flex-wrap gap-1.5">
                            {r.links!.map((l, i) => l.href
                              ? <Link key={i} href={l.href} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#c2410c] hover:underline"><Link2 className="w-3 h-3" />{l.label}</Link>
                              : <span key={i} className="inline-flex items-center gap-1 text-[12px] text-slate-500"><Link2 className="w-3 h-3" />{l.label}</span>)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-800">{r.assignedToName}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{r.createdByName}</td>
                      <td className={`px-3 py-2.5 text-[12.5px] ${TONE_CLASS[dl.tone]}`}>{dl.text}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-700"><span className={`h-2 w-2 rounded-[2px] ${b.dot}`} />{ar ? b.ar : b.en}</span></td>
                      <td className="px-3 py-2.5 max-w-[260px] text-[12.5px]">
                        {last ? (
                          <>
                            <span className="font-semibold text-slate-800">{ar ? EVENT_WORDS[last.type]?.ar : EVENT_WORDS[last.type]?.en}</span>
                            {last.note && <span className="block text-slate-600 line-clamp-2">{last.note}</span>}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700">{r.spentMinutes ? fmtMinutes(r.spentMinutes, ar) : <span className="text-slate-300">—</span>}{r.expectedMinutes ? <span className="ms-1 text-[11px] text-slate-400">/ {fmtMinutes(r.expectedMinutes, ar)}</span> : null}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 tabular-nums">{fmtDT(r.createdAt, ar)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-orange-50/30">
                        <td />
                        <td colSpan={8} className="px-3 pb-4 pt-1"><TaskStory r={r} ar={ar} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">{t('لا شيء يطابق هذا الاختيار', 'Nothing matches')}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div className="flex items-center justify-center gap-3 px-5 py-3 border-t border-slate-100">
            <span className="text-[12px] text-slate-500">{t(`المعروض ${limit} من ${rows.length}`, `Showing ${limit} of ${rows.length}`)}</span>
            <button type="button" onClick={() => setLimit((n) => n + 200)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121]">{t('عرض المزيد', 'Show more')}</button>
          </div>
        )}
      </section>
    </div>
  );
}

const fmtDT = (v: string | null | undefined, ar: boolean) => (v ? new Date(v).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** One task in full: what was asked, with whom and when, and every step with its note. */
function TaskStory({ r, ar }: { r: Row; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const fact = (label: string, value: React.ReactNode) => (
    <div><p className="text-[11px] font-semibold text-slate-500">{label}</p><div className="text-[13px] text-slate-900">{value || <span className="text-slate-300">—</span>}</div></div>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-3">
          {fact(t('أُسنِدت في', 'Assigned on'), fmtDT(r.createdAt, ar))}
          {fact(t('الموعد', 'Deadline'), fmtDT(r.deadlineAt, ar))}
          {fact(t('يوم العمل', 'Work day'), r.workDate ? new Date(r.workDate).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB') : '')}
          {fact(t('تمّت في', 'Done on'), r.doneAt ? fmtDT(r.doneAt, ar) : '')}
          {fact(t('طريقة التواصل', 'Contact method'), r.action ? (ar ? (ACTION_WORDS as any)[r.action]?.ar : (ACTION_WORDS as any)[r.action]?.en) : '')}
          {fact(t('مع مَن', 'With whom'), r.contact)}
          {fact(t('المشروع', 'Project'), r.project)}
          {fact(t('الوقت', 'Time'), r.spentMinutes ? `${fmtMinutes(r.spentMinutes, ar)}${r.expectedMinutes ? ` / ${fmtMinutes(r.expectedMinutes, ar)}` : ''}` : '')}
        </div>
        {fact(t('التفاصيل', 'Details'), r.details ? <p className="whitespace-pre-wrap">{r.details}</p> : '')}
        {r.doneNote && fact(t('ما تمّ إنجازه', 'What was done'), <p className="whitespace-pre-wrap text-emerald-800">{r.doneNote}</p>)}
        {!!(r.fileList || []).length && fact(t('المرفقات', 'Files'), (
          <div className="flex flex-wrap gap-1.5">{r.fileList!.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[12px] text-slate-700 hover:text-[#c2410c]">
              <Paperclip className="w-3 h-3" />{f.name || t('ملف', 'file')}{f.phase === 'done' ? ` · ${t('عند الإنجاز', 'on completion')}` : ''}
            </a>))}</div>
        ))}
        {!!(r.commentList || []).length && fact(t('التعليقات', 'Comments'), (
          <ul className="space-y-1.5">{r.commentList!.map((c, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5"><span className="font-semibold">{c.byName}</span> <span className="text-[11px] text-slate-500">{fmtDT(c.at, ar)}</span><p className="whitespace-pre-wrap">{c.text}</p></li>))}</ul>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700"><CalendarClock className="w-4 h-4 text-[#f37121]" />{t('سجلّ المهمّة', 'Task log')}</p>
        {(r.events || []).length ? (
          <ol className="relative space-y-3 border-s-2 border-slate-100 ps-4">
            {r.events!.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -start-[1.4rem] top-1 h-3 w-3 rounded-full ring-2 ring-white ${EVENT_WORDS[e.type]?.cls || 'bg-slate-400'}`} />
                <p className="text-[12.5px]"><span className="font-bold text-slate-900">{ar ? EVENT_WORDS[e.type]?.ar : EVENT_WORDS[e.type]?.en}</span>
                  <span className="text-slate-500"> · {e.byName} · {fmtDT(e.at, ar)}</span></p>
                {e.type === 'postponed' && <p className="text-[12px] text-amber-800">{t('من', 'from')} {fmtDT(e.fromAt, ar)} {t('إلى', 'to')} {fmtDT(e.toAt, ar)}</p>}
                {e.note && <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-800">{e.note}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-[12.5px] text-slate-400">{t('لا خطوات مسجّلة بعد — المهامّ القديمة لا سجلَّ لها قبل هذه الميزة.', 'No steps recorded yet — older tasks have no log before this feature.')}</p>}
      </div>
    </div>
  );
}
