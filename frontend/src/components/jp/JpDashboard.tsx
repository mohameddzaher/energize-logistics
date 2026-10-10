'use client';
/**
 * لوحةُ خطّة العمل — لمدير القسم وحدَه (ولمدير النظام في خطّة الإدارة).
 *
 * تجيب عمّا يسأله المديرُ كلَّ صباح: كم مهمّةً قائمة، وما الذي تأخّر وعلى مَن،
 * ومن لا شيءَ عليه، وأين وصل كلُّ مشروع. والخادمُ يردّ 403 لغير المدير —
 * فالشاشةُ تقول ذلك ولا تعرض لوحةً فارغة.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { type JpScope, ACTION_WORDS, deadlineLine, TONE_CLASS, qs, spanWords } from '@/lib/jp';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import { BarChart3, AlertTriangle, Clock, FolderKanban, Users, CheckCircle2, UserX } from 'lucide-react';

interface Slim {
  _id: string; title: string; kind: 'task' | 'request'; assignedToName: string; createdByName: string;
  deadlineAt: string | null; doneAt: string | null; createdAt: string; project: string; files: number; doneNote: string; state: string;
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
  idle: { _id: string; name: string; roleAr: string; roleEn: string }[];
  projects: { _id: string; name: string; status: string; total: number; done: number; overdue: number; people: number; progress: number | null; endDate?: string | null }[];
  byAction: { action: string; total: number; done: number }[];
  daily: { day: string; created: number; done: number }[];
  overdue: Slim[]; dueSoon: Slim[]; recentDone: Slim[];
}

const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);

function Panel({ title, icon, right, children }: { title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><span className="text-[#f37121]">{icon}</span>{title}</h2>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function TaskLines({ rows, ar, now, empty }: { rows: Slim[]; ar: boolean; now: number; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="-my-1 divide-y divide-slate-100">
      {rows.map((r) => {
        const dl = deadlineLine({ deadlineAt: r.deadlineAt, deadlineKind: 'hours', status: r.doneAt ? 'done' : 'open', doneAt: r.doneAt }, now, ar);
        return (
          <li key={r._id} className="py-2.5">
            <p className="text-[13.5px] font-semibold text-slate-900">{r.title}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              <span className="font-semibold text-slate-700">{r.assignedToName}</span>
              {r.project ? ` · ${r.project}` : ''}
              {' · '}<span className={TONE_CLASS[dl.tone]}>{dl.text}</span>
              {r.files ? ` · ${ar ? `${r.files} مرفق` : `${r.files} file(s)`}` : ''}
            </p>
            {r.doneNote && <p className="mt-1 text-[12px] text-emerald-800">{r.doneNote}</p>}
          </li>
        );
      })}
    </ul>
  );
}

export default function JpDashboard({ scope, section }: { scope: JpScope; section?: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [data, setData] = useState<Dash | null>(null);
  const [denied, setDenied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const { begin, isCurrent } = useLatestRequest();
  const q = qs(scope, section);

  const load = useCallback(async () => {
    const token = begin();
    try {
      const p = new URLSearchParams(q);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const d = await api.get<Dash>(`/api/jp/dashboard?${p.toString()}`);
      if (isCurrent(token)) { setData(d); setDenied(''); setNow(Date.now()); }
    } catch (e) {
      if (isCurrent(token)) setDenied((e as { message?: string })?.message || t('تعذّر التحميل', 'Could not load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((d: { scope?: string; section?: string }) => {
    if (!d || (d.scope === scope && (scope === 'management' || d.section === section))) load();
  }, [load, scope, section]));

  if (denied) return <div className="py-20 text-center text-slate-500 text-sm" dir={isRTL ? 'rtl' : 'ltr'}>{denied}</div>;
  if (!data) return <Spinner />;

  const T = data.totals;
  const management = scope === 'management';
  const dayMax = Math.max(1, ...data.daily.map((d) => Math.max(d.created, d.done)));
  const person = management ? t('المدير', 'Manager') : t('الموظّف', 'Employee');

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<BarChart3 className="w-6 h-6 text-[#f37121]" />}
        title={management ? t('لوحة خطّة الإدارة', 'Management plan dashboard') : t(`لوحة خطّة العمل — ${data.sectionAr}`, `Work plan dashboard — ${data.sectionEn}`)}
        subtitle={t('كلُّ مهمّةٍ ومشروعٍ ومن عليه ماذا — تتحدّث مع كلّ تغيير', 'Every task and project and who holds what — updates live')}
      >
        <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label={t('القائمة', 'Open')} value={String(T.open)} />
        <StatCard label={t('المتأخّرة', 'Late')} value={String(T.overdue)} accent={T.overdue ? 'text-red-600' : undefined} />
        <StatCard label={t('تستحقّ خلال ٢٤ ساعة', 'Due within 24h')} value={String(T.dueSoon)} accent={T.dueSoon ? 'text-amber-600' : undefined} />
        <StatCard label={t('التي تمّت', 'Done')} value={String(T.done)} accent="text-emerald-600" hint={t(`نسبة الإتمام ${pctText(T.completionRate)}`, `Completion ${pctText(T.completionRate)}`)} />
        <StatCard label={t('في موعدها', 'On time')} value={pctText(T.onTimeRate)} hint={t(`${T.onTime} في الموعد · ${T.late} بعده`, `${T.onTime} on time · ${T.late} late`)} />
        <StatCard label={t('مهامّ / طلبات', 'Tasks / requests')} value={`${T.tasks} / ${T.requests}`} hint={t(`${T.noDeadline} بلا موعد · ${T.withFiles} بمرفق`, `${T.noDeadline} no deadline · ${T.withFiles} with files`)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Panel title={management ? t('المديرون', 'Managers') : t('الفريق', 'Team')} icon={<Users className="w-4 h-4" />}
            right={<span className="text-[11px] text-slate-400">{t('الأكثرُ مهامَّ قائمةً أوّلًا', 'Most open first')}</span>}>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-slate-500 text-[11.5px]">
                    <th className="text-start font-medium pb-2">{person}</th>
                    <th className="text-center font-medium pb-2">{t('أُسنِد', 'Assigned')}</th>
                    <th className="text-center font-medium pb-2">{t('قائمة', 'Open')}</th>
                    <th className="text-center font-medium pb-2">{t('متأخّرة', 'Late')}</th>
                    <th className="text-center font-medium pb-2">{t('تمّت', 'Done')}</th>
                    <th className="text-center font-medium pb-2">{t('في موعدها', 'On time')}</th>
                    <th className="text-center font-medium pb-2">{t('متوسّط الإنجاز', 'Avg. time')}</th>
                    <th className="text-center font-medium pb-2">{t('طلباتٌ كتبها', 'Requests made')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.members.map((m) => (
                    <tr key={m._id}>
                      <td className="py-2.5">
                        <p className="font-semibold text-slate-900">{m.name}{m.former && <span className="ms-1 text-[11px] text-slate-400">{t('(خارج الفريق)', '(left team)')}</span>}</p>
                        <p className="text-[11.5px] text-slate-500">{ar ? m.roleAr : m.roleEn}</p>
                        <div className="mt-1 h-1.5 w-40 max-w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.completionRate || 0}%` }} />
                        </div>
                      </td>
                      <td className="text-center tabular-nums">{m.assigned}</td>
                      <td className="text-center tabular-nums font-semibold">{m.open}</td>
                      <td className={`text-center tabular-nums ${m.overdue ? 'text-red-600 font-bold' : 'text-slate-400'}`}>{m.overdue}</td>
                      <td className="text-center tabular-nums text-emerald-700">{m.done}</td>
                      <td className="text-center tabular-nums">{pctText(m.onTimeRate)}</td>
                      <td className="text-center tabular-nums">{m.avgHours == null ? '—' : spanWords(m.avgHours * 3600000, ar)}</td>
                      <td className="text-center tabular-nums">{m.requestsMade}</td>
                    </tr>
                  ))}
                  {!data.members.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">{t('لا أحد في الفريق بعد', 'No one on the team yet')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

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
            <ul className="space-y-2">
              {data.byAction.map((a) => {
                const w = ACTION_WORDS[a.action as keyof typeof ACTION_WORDS];
                return (
                  <li key={a.action} className="flex items-center justify-between text-[13px]">
                    <span className="text-slate-700">{w ? (ar ? w.ar : w.en) : t('بلا تواصل', 'No contact')}</span>
                    <span className="tabular-nums text-slate-900 font-semibold">{a.total}<span className="ms-1.5 text-[11.5px] font-normal text-emerald-700">{t(`${a.done} تمّت`, `${a.done} done`)}</span></span>
                  </li>
                );
              })}
              {!data.byAction.length && <li className="text-sm text-slate-400">{t('لا شيء بعد', 'Nothing yet')}</li>}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title={t('المشروعات', 'Projects')} icon={<FolderKanban className="w-4 h-4" />}>
        {data.projects.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.projects.map((p) => (
              <div key={p._id} className={`border border-slate-200 rounded-xl p-3.5 ${p.status === 'closed' ? 'opacity-60' : ''}`}>
                <p className="text-[13.5px] font-bold text-slate-900">{p.name || t('مهامُّ بلا مشروع', 'Tasks without a project')}</p>
                <p className="mt-1 text-[12px] text-slate-500 tabular-nums">
                  {t(`${p.done} من ${p.total} تمّت · ${p.people} مشاركًا`, `${p.done} of ${p.total} done · ${p.people} people`)}
                  {!!p.overdue && <span className="text-red-600 font-semibold"> · {t(`${p.overdue} متأخّرة`, `${p.overdue} late`)}</span>}
                </p>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress || 0}%` }} /></div>
                <p className="mt-1 text-[11.5px] text-slate-400 tabular-nums">{pctText(p.progress)}{p.status === 'closed' ? ` · ${t('مغلق', 'closed')}` : ''}</p>
              </div>
            ))}
          </div>
        ) : <p className="py-4 text-center text-sm text-slate-400">{t('لا مشروعات بعد', 'No projects yet')}</p>}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('المتأخّرة', 'Late')} icon={<AlertTriangle className="w-4 h-4" />} right={<span className="text-[11px] text-red-600 font-bold tabular-nums">{T.overdue}</span>}>
          <TaskLines rows={data.overdue} ar={ar} now={now} empty={t('لا شيء متأخّر', 'Nothing late')} />
        </Panel>
        <Panel title={t('تستحقّ خلال ٢٤ ساعة', 'Due within 24 hours')} icon={<Clock className="w-4 h-4" />} right={<span className="text-[11px] text-amber-600 font-bold tabular-nums">{T.dueSoon}</span>}>
          <TaskLines rows={data.dueSoon} ar={ar} now={now} empty={t('لا شيء يستحقّ قريبًا', 'Nothing due soon')} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('آخر ١٤ يومًا', 'Last 14 days')} icon={<BarChart3 className="w-4 h-4" />}
          right={<span className="text-[11px] text-slate-400"><span className="inline-block w-2 h-2 rounded-sm bg-slate-400 me-1" />{t('أُسنِدت', 'assigned')}<span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 ms-3 me-1" />{t('تمّت', 'done')}</span>}>
          <div className="flex items-end gap-1.5 h-36">
            {data.daily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day} — ${t('أُسنِدت', 'assigned')} ${d.created} · ${t('تمّت', 'done')} ${d.done}`}>
                <div className="w-full flex items-end justify-center gap-0.5 h-28">
                  <div className="w-1/2 rounded-t bg-slate-300" style={{ height: `${(d.created / dayMax) * 100}%` }} />
                  <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: `${(d.done / dayMax) * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title={t('آخر ما تمّ', 'Recently done')} icon={<CheckCircle2 className="w-4 h-4" />}>
          <TaskLines rows={data.recentDone} ar={ar} now={now} empty={t('لم يتمّ شيءٌ بعد', 'Nothing done yet')} />
        </Panel>
      </div>
    </div>
  );
}
