'use client';
/**
 * لوحةُ خطّة العمل — لمدير القسم وحدَه (ولمدير النظام في خطّة الإدارة).
 *
 * ── تُقرأ من فوق إلى تحت ───────────────────────────────────────────────────
 *   ١. الفلاتر: موظّفٌ، يومٌ أو مدّة، مشروعٌ، نوعٌ، طريقةُ تواصل.
 *   ٢. ستُّ بطاقات: كم قائمٌ وكم تأخّر وكم يستحقّ اليوم — وكلٌّ منها تفتح
 *      قائمتَها أسفلَ الصفحة.
 *   ٣. الفريق: من عليه ماذا، وصفُّه يفلتر اللوحةَ به.
 *   ٤. المشروعات وطرقُ التواصل وآخرُ ١٤ يومًا.
 *   ٥. قائمةُ المهامّ نفسُها تحت الفلاتر — فكلُّ رقمٍ فوق له صفوفُه تحت.
 *
 * والخادمُ يطبّق الفلاترَ على كلّ شيء، ويردّ 403 لغير المدير — فتُقال الرسالةُ
 * ولا تُعرَض لوحةٌ فارغة.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { type JpScope, ACTION_WORDS, deadlineLine, TONE_CLASS, qs, spanWords } from '@/lib/jp';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import {
  BarChart3, AlertTriangle, Clock, FolderKanban, Users, CheckCircle2, UserX, ListChecks, X, Timer, Paperclip, MessageSquare,
} from 'lucide-react';

interface Row {
  _id: string; title: string; kind: 'task' | 'request'; assignedToName: string; createdByName: string;
  deadlineAt: string | null; doneAt: string | null; createdAt: string; project: string; files: number; doneNote: string;
  state: 'open' | 'overdue' | 'done'; action: string; comments: number; dueSoon: boolean;
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
    noDeadline: number; withFiles: number; dueSoon: number; completionRate: number | null; onTimeRate: number | null;
  };
  members: Member[];
  idle: { _id: string; name: string }[];
  projects: { _id: string; name: string; status: string; total: number; done: number; overdue: number; people: number; progress: number | null }[];
  byAction: { action: string; total: number; done: number }[];
  daily: { day: string; created: number; done: number }[];
  tasks: Row[];
  team: { _id: string; name: string }[];
  projectOptions: { _id: string; name: string }[];
}

type StatusKey = '' | 'open' | 'overdue' | 'soon' | 'done';
const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);
const selectCls = 'px-3 py-2 rounded-lg bg-white border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

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

/** بطاقةُ رقم: أيقونةٌ بلونها، والرقمُ كبيرًا، وسطرٌ يشرحه — وتُضغَط فتفلتر القائمة. */
function Kpi({ icon, tone, label, value, hint, on, onClick }: {
  icon: React.ReactNode; tone: string; label: string; value: string; hint?: string; on?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-start bg-white border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${on ? 'border-[#f37121] ring-1 ring-[#f37121]/40' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone}`}>{icon}</span>
        <p className="text-[12px] font-semibold text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-[26px] leading-none font-extrabold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1.5 text-[11.5px] text-slate-400 truncate">{hint}</p>}
    </button>
  );
}

/** حلقةُ نسبةٍ بلا مكتبة: دائرةٌ مخروطيّةُ التدرّج وفي وسطها الرقم. */
function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: `conic-gradient(${color} ${v * 3.6}deg, #e2e8f0 0deg)` }}>
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-[13px] font-extrabold tabular-nums text-slate-900">{pctText(value)}</div>
      </div>
      <p className="text-[12.5px] text-slate-600">{label}</p>
    </div>
  );
}

const STATE_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  open: { ar: 'قائمة', en: 'Open', cls: 'bg-sky-50 text-sky-700' },
  overdue: { ar: 'متأخّرة', en: 'Late', cls: 'bg-red-50 text-red-700' },
  done: { ar: 'تمّت', en: 'Done', cls: 'bg-emerald-50 text-emerald-700' },
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
  const [status, setStatus] = useState<StatusKey>('');
  const [search, setSearch] = useState('');
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
      const d = await api.get<Dash>(`/api/jp/dashboard?${p.toString()}`);
      if (isCurrent(token)) { setData(d); setDenied(''); setNow(Date.now()); }
    } catch (e) {
      if (isCurrent(token)) setDenied((e as { message?: string })?.message || t('تعذّر التحميل', 'Could not load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to, assignee, project, kind, action]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((d: { scope?: string; section?: string }) => {
    if (!d || (d.scope === scope && (scope === 'management' || d.section === section))) load();
  }, [load, scope, section]));

  // فلترُ الحالة والبحثُ على القائمة وحدَها: البطاقاتُ تبقى تعدّ الحالاتِ كلَّها ليُختار منها.
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.tasks || []).filter((r) => (
      (status === '' || (status === 'soon' ? r.dueSoon : r.state === status))
      && (!s || `${r.title} ${r.assignedToName} ${r.createdByName} ${r.project}`.toLowerCase().includes(s))
    ));
  }, [data, status, search]);

  if (denied) return <div className="py-20 text-center text-slate-500 text-sm" dir={isRTL ? 'rtl' : 'ltr'}>{denied}</div>;
  if (!data) return <Spinner />;

  const T = data.totals;
  const management = scope === 'management';
  const dayMax = Math.max(1, ...data.daily.map((d) => Math.max(d.created, d.done)));
  const person = management ? t('المدير', 'Manager') : t('الموظّف', 'Employee');
  const active = [from, to, assignee, project, kind, action].filter(Boolean).length;
  const clear = () => { setFrom(''); setTo(''); setAssignee(''); setProject(''); setKind(''); setAction(''); setStatus(''); setSearch(''); };
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

      {/* ── ١. الفلاتر ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-2.5">
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls} aria-label={person}>
          <option value="">{management ? t('كلُّ المديرين', 'All managers') : t('كلُّ الموظّفين', 'All employees')}</option>
          {data.team.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
        </select>
        <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
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
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 px-3 py-2 text-[13px] text-slate-400 hover:text-red-600">
            <X className="w-4 h-4" />{t('إزالة الفلاتر', 'Clear')}
          </button>
        )}
      </div>

      {/* ── ٢. الأرقام ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<ListChecks className="w-5 h-5" />} tone="bg-slate-100 text-slate-700" label={t('الإجمالي', 'Total')} value={String(T.total)}
          hint={t(`${T.tasks} مهمّة · ${T.requests} طلب`, `${T.tasks} tasks · ${T.requests} requests`)} on={status === ''} onClick={() => setStatus('')} />
        <Kpi icon={<Clock className="w-5 h-5" />} tone="bg-sky-50 text-sky-700" label={t('قائمة', 'Open')} value={String(T.open - T.overdue)}
          hint={t(`${T.noDeadline} بلا موعد`, `${T.noDeadline} without deadline`)} on={status === 'open'} onClick={() => pick('open')} />
        <Kpi icon={<AlertTriangle className="w-5 h-5" />} tone="bg-red-50 text-red-600" label={t('متأخّرة', 'Late')} value={String(T.overdue)}
          hint={t('فات موعدُها ولم تتمّ', 'Past deadline, not done')} on={status === 'overdue'} onClick={() => pick('overdue')} />
        <Kpi icon={<Timer className="w-5 h-5" />} tone="bg-amber-50 text-amber-600" label={t('تستحقّ خلال ٢٤ ساعة', 'Due within 24h')} value={String(T.dueSoon)}
          hint={t('قائمةٌ وموعدُها قريب', 'Open, deadline near')} on={status === 'soon'} onClick={() => pick('soon')} />
        <Kpi icon={<CheckCircle2 className="w-5 h-5" />} tone="bg-emerald-50 text-emerald-600" label={t('تمّت', 'Done')} value={String(T.done)}
          hint={t(`${T.onTime} في موعدها · ${T.late} بعده`, `${T.onTime} on time · ${T.late} late`)} on={status === 'done'} onClick={() => pick('done')} />
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-center gap-3">
          <Ring value={T.completionRate} color="#10b981" label={t('نسبة الإتمام', 'Completion')} />
          <Ring value={T.onTimeRate} color="#f37121" label={t('في موعدها', 'On time')} />
        </div>
      </div>

      {/* ── ٣. الفريق ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel className="xl:col-span-2" title={management ? t('المديرون', 'Managers') : t('الفريق', 'Team')} icon={<Users className="w-4 h-4" />}
          right={<span className="text-[11px] text-slate-400">{t('اضغط اسمًا لتصفية اللوحة به', 'Click a name to filter by it')}</span>}>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-500 text-[11.5px] border-b border-slate-100">
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
                    <td className="py-2.5">
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

      {/* ── ٤. المشروعات وسيرُ الأيّام ─────────────────────────────────────── */}
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

        <Panel title={t('آخر ١٤ يومًا', 'Last 14 days')} icon={<BarChart3 className="w-4 h-4" />}
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

      {/* ── ٥. المهامُّ نفسُها ─────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
            <span className="text-[#f37121]"><ListChecks className="w-4 h-4" /></span>
            {status === 'overdue' ? t('المتأخّرة', 'Late') : status === 'soon' ? t('تستحقّ خلال ٢٤ ساعة', 'Due within 24h')
              : status === 'done' ? t('التي تمّت', 'Done') : status === 'open' ? t('القائمة', 'Open') : t('كلُّ المهامّ', 'All tasks')}
            <span className="text-[12px] font-semibold text-slate-400 tabular-nums">({rows.length})</span>
          </h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('بحث في العنوان أو الاسم…', 'Search title or name…')}
            className="w-56 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11.5px]">
                <th className="text-start font-medium px-4 py-2">{t('المطلوب', 'Task')}</th>
                <th className="text-start font-medium px-3 py-2">{t('إلى', 'To')}</th>
                <th className="text-start font-medium px-3 py-2">{t('من', 'From')}</th>
                <th className="text-start font-medium px-3 py-2">{t('المشروع', 'Project')}</th>
                <th className="text-start font-medium px-3 py-2">{t('الموعد', 'Deadline')}</th>
                <th className="text-start font-medium px-3 py-2">{t('الحالة', 'State')}</th>
                <th className="text-start font-medium px-3 py-2">{t('أُسنِدت في', 'Assigned on')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 200).map((r) => {
                const dl = deadlineLine({ deadlineAt: r.deadlineAt, deadlineKind: 'hours', status: r.state === 'done' ? 'done' : 'open', doneAt: r.doneAt }, now, ar);
                const b = STATE_BADGE[r.state];
                return (
                  <tr key={r._id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-2.5 max-w-[340px]">
                      <p className="font-semibold text-slate-900">{r.title}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-slate-400">
                        <span className={`px-1.5 py-0.5 rounded ${r.kind === 'task' ? 'bg-slate-900 text-white' : 'bg-sky-50 text-sky-700'}`}>{r.kind === 'task' ? t('مهمّة', 'Task') : t('طلب', 'Request')}</span>
                        {!!r.files && <span className="inline-flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{r.files}</span>}
                        {!!r.comments && <span className="inline-flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{r.comments}</span>}
                      </p>
                      {r.doneNote && <p className="mt-1 text-[12px] text-emerald-800">{r.doneNote}</p>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-800">{r.assignedToName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{r.createdByName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{r.project || '—'}</td>
                    <td className={`px-3 py-2.5 text-[12.5px] ${TONE_CLASS[dl.tone]}`}>{dl.text}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${b.cls}`}>{ar ? b.ar : b.en}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 tabular-nums">{new Date(r.createdAt).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{t('لا شيء يطابق هذا الاختيار', 'Nothing matches')}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && <p className="px-5 py-2.5 text-[12px] text-slate-400 border-t border-slate-100">{t(`تُعرَض أوّلُ 200 من ${rows.length} — ضيِّق الفلاتر لرؤية الباقي.`, `Showing the first 200 of ${rows.length} — narrow the filters to see the rest.`)}</p>}
      </section>
    </div>
  );
}
