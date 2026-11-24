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
  AlertTriangle, CheckCircle2, CircleDashed, Hourglass, SlidersHorizontal, Timer,
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
  shared: { ar: 'أُضيف مسؤول', en: 'Owner added', cls: 'bg-sky-600' },
};

/** A percentage as a ring: the two rates read at a glance instead of as a dash in a table cell. */
function Ring({ value, label, hint, color }: { value: number | null; label: string; hint?: string; color: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 30; const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0 -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="min-w-0">
        <p className="text-[24px] font-extrabold leading-none tabular-nums text-slate-900">{value == null ? '0%' : `${value}%`}</p>
        <p className="mt-1 text-[12.5px] font-bold text-slate-600">{label}</p>
        {hint && <p className="text-[11.5px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
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
  const [moreFilters, setMoreFilters] = useState(false);
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

      {/* 1. Filters: the three asked daily in front, the rest behind «more filters». */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2">
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
          <button type="button" onClick={() => setMoreFilters((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold ${moreFilters || [project, kind, action, link].some(Boolean) ? 'border-[#f37121] text-[#f37121]' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <SlidersHorizontal className="w-4 h-4" />{t('فلاتر أخرى', 'More filters')}
            {[project, kind, action, link].filter(Boolean).length > 0 && <span className="rounded-full bg-[#f37121] px-1.5 text-[11px] text-white">{[project, kind, action, link].filter(Boolean).length}</span>}
          </button>
          {(active > 0 || status || search) && (
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 px-2 py-2 text-[13px] font-semibold text-slate-500 hover:text-red-600">
              <X className="w-4 h-4" />{t('مسح الفلاتر', 'Clear')}
            </button>
          )}
        </div>
        {moreFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
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
          </div>
        )}
      </div>

      {/* 2. Overview: the two rates as rings, the four states as large cards (each filters the list below), then the smaller figures. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row xl:flex-col">
          <Ring value={T.completionRate} label={t('نسبة الإتمام', 'Completion')} hint={t(`${T.done} من ${T.total}`, `${T.done} of ${T.total}`)} color="#10b981" />
          <Ring value={T.onTimeRate} label={t('في موعدها', 'On time')} hint={t(`${T.onTime} في الموعد · ${T.late} بعده`, `${T.onTime} on time · ${T.late} late`)} color="#f37121" />
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              ['open', t('قائمة', 'Open'), T.open - T.overdue, t(`${T.noDeadline} بلا موعد`, `${T.noDeadline} no deadline`), CircleDashed, 'bg-sky-50 text-sky-700 border-sky-200'],
              ['overdue', t('متأخّرة', 'Late'), T.overdue, t('فات موعدها', 'Past deadline'), AlertTriangle, 'bg-red-50 text-red-700 border-red-200'],
              ['soon', t('خلال 24 ساعة', 'Due in 24h'), T.dueSoon, t('موعدها قريب', 'Deadline near'), Hourglass, 'bg-amber-50 text-amber-700 border-amber-200'],
              ['done', t('تمّت', 'Done'), T.done, t(`${T.onTime} في موعدها`, `${T.onTime} on time`), CheckCircle2, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
            ] as const).map(([k, label, n, hint, Icon, cls]) => (
              <button key={k} type="button" onClick={() => pick(k as StatusKey)}
                className={`rounded-2xl border p-4 text-start shadow-sm transition-all ${cls} ${status === k ? 'ring-2 ring-offset-1 ring-[#f37121]' : 'hover:shadow-md'}`}>
                <span className="flex items-center justify-between">
                  <span className="text-[13px] font-bold">{label}</span>
                  <Icon className="w-5 h-5 opacity-80" />
                </span>
                <span className="mt-2 block text-[32px] font-extrabold leading-none tabular-nums">{n}</span>
                <span className="mt-1.5 block truncate text-[11.5px] opacity-80">{hint}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ['', t('الإجمالي', 'Total'), String(T.total), ListChecks, t(`${T.tasks} مهمّة · ${T.requests} طلب`, `${T.tasks} tasks · ${T.requests} requests`)],
              ['postponed', t('أُجِّلت', 'Postponed'), String(T.postponed || 0), CalendarClock, t('بسببٍ مكتوب', 'with a reason')],
              ['', t('الوقت المسجّل', 'Time logged'), data.totals2?.minutes ? fmtMinutes(data.totals2.minutes, ar) : t('لا وقت بعد', 'none yet'), Timer, t('بالمؤقّت', 'by timer')],
            ] as const).map(([k, label, v, Icon, hint], i) => (
              <button key={i} type="button" onClick={() => (k ? pick(k as StatusKey) : label === t('الإجمالي', 'Total') ? setStatus('') : undefined)}
                className={`inline-flex items-center gap-2.5 rounded-xl border bg-white px-3.5 py-2 text-start shadow-sm ${status === k && k ? 'border-[#f37121]' : 'border-slate-200'}`}>
                <Icon className="w-4 h-4 text-[#f37121]" />
                <span className="text-[12.5px] font-semibold text-slate-500">{label}</span>
                <span className="text-[15px] font-extrabold tabular-nums text-slate-900">{v}</span>
                <span className="hidden text-[11px] text-slate-400 md:inline">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Team: one card per person; a card filters the whole board to him. */}
      <Panel title={management ? t('المديرون', 'Managers') : t('الفريق', 'Team')} icon={<Users className="w-4 h-4" />}
        right={<span className="text-[11px] text-slate-400">{t('اضغط بطاقةً لتصفية اللوحة بها', 'Click a card to filter by it')}</span>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {data.members.map((m) => {
            const total = Math.max(1, m.assigned);
            const onOpen = Math.max(0, m.open - m.overdue);
            return (
              <button key={m._id} type="button" disabled={m.former} onClick={() => setAssignee(assignee === m._id ? '' : m._id)}
                className={`rounded-xl border p-3.5 text-start transition-all ${assignee === m._id ? 'border-[#f37121] bg-orange-50/40 ring-1 ring-[#f37121]/40' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'} ${m.former ? 'opacity-60' : ''}`}>
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[15px] font-extrabold text-white">{m.name.trim().charAt(0)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-extrabold text-slate-900">{m.name}{m.former && <span className="ms-1 text-[11px] font-normal text-slate-400">{t('(خارج الفريق)', '(left team)')}</span>}</span>
                    <span className="block truncate text-[11.5px] text-slate-500">{ar ? m.roleAr : m.roleEn}</span>
                  </span>
                  <span className="text-end">
                    <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{m.completionRate == null ? '0%' : `${m.completionRate}%`}</span>
                    <span className="block text-[10.5px] text-slate-400">{t('إتمام', 'done')}</span>
                  </span>
                </span>
                <span className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="bg-emerald-500" style={{ width: `${(m.done / total) * 100}%` }} />
                  <span className="bg-sky-500" style={{ width: `${(onOpen / total) * 100}%` }} />
                  <span className="bg-red-500" style={{ width: `${(m.overdue / total) * 100}%` }} />
                </span>
                <span className="mt-2.5 grid grid-cols-4 gap-1 text-center">
                  {([
                    [t('أُسنِد', 'Assigned'), m.assigned, 'text-slate-900'],
                    [t('قائمة', 'Open'), onOpen, 'text-sky-700'],
                    [t('متأخّرة', 'Late'), m.overdue, m.overdue ? 'text-red-600' : 'text-slate-400'],
                    [t('تمّت', 'Done'), m.done, 'text-emerald-700'],
                  ] as const).map(([l, v, c]) => (
                    <span key={l}><span className={`block text-[15px] font-extrabold tabular-nums ${c}`}>{v}</span><span className="block text-[10.5px] text-slate-500">{l}</span></span>
                  ))}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 pt-2 text-[11.5px] text-slate-500">
                  <span>{t('في موعدها', 'On time')}: <b className="text-slate-800">{m.onTimeRate == null ? t('لا مواعيد', 'no deadlines') : `${m.onTimeRate}%`}</b></span>
                  {m.avgHours != null && <span>{t('متوسّط الإنجاز', 'Avg.')}: <b className="text-slate-800">{spanWords(m.avgHours * 3600000, ar)}</b></span>}
                  {m.requestsMade > 0 && <span>{t('طلباتٌ كتبها', 'Requests')}: <b className="text-slate-800">{m.requestsMade}</b></span>}
                </span>
              </button>
            );
          })}
          {!data.members.length && <p className="py-6 text-center text-sm text-slate-400">{t('لا أحد في الفريق بعد', 'No one on the team yet')}</p>}
        </div>
        {data.idle.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="me-1 inline-flex items-center gap-1 text-[12px] font-bold text-slate-500"><UserX className="w-3.5 h-3.5" />{t('بلا مهامَّ قائمة', 'Nothing open')}:</span>
            {data.idle.map((m) => <span key={m._id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700">{m.name}</span>)}
          </div>
        )}
      </Panel>

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
        {data.byAction.some((a) => a.action) && (
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
            </ul>
          </Panel>
        )}
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
          <div className="flex items-end gap-1.5 h-48 border-b border-slate-200 pb-1">
            {data.daily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day} — ${t('أُسنِدت', 'assigned')} ${d.created} · ${t('تمّت', 'done')} ${d.done}`}>
                <div className="w-full flex items-end justify-center gap-0.5 h-40">
                  <div className="w-1/2 rounded-t-md bg-slate-300" style={{ height: `${Math.max(d.created ? 4 : 0, (d.created / dayMax) * 100)}%` }} />
                  <div className="w-1/2 rounded-t-md bg-emerald-500" style={{ height: `${Math.max(d.done ? 4 : 0, (d.done / dayMax) * 100)}%` }} />
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
