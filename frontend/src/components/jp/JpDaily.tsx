'use client';
/**
 * اليوميّة — «كلُّ واحدٍ في اليوم يعمل على ماذا، وكم أخذ من وقت» (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢).
 *
 * صفٌّ لكلّ مهمّةٍ في كلّ يوم: ما خُطِّط له ذلك اليوم، وما عُمل فيه بالمؤقّت (والفترةُ
 * عبر منتصف الليل تُقسَم على يوميها)، وتصحيحُ المدير، وما تمّ فيه. يُفلتَر بيومٍ أو مدًى،
 * وبالموظّف، وبالمهمّة، وبالحالة — والحسابُ كلُّه في الخادم (GET /api/jp/daily).
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { type JpScope, qs, fmtMinutes } from '@/lib/jp';
import PeriodFilter from '@/components/system/PeriodFilter';
import { CalendarClock, Loader2 } from 'lucide-react';

interface Row {
  day: string; taskId: string; title: string; kind: string; assignedTo: string | null; assignedToName: string;
  createdByName: string; status: 'todo' | 'doing' | 'paused' | 'done'; running: boolean;
  expectedMinutes: number | null; minutes: number; totalMinutes: number; planned: boolean;
}
interface Person { assignedTo: string | null; name: string; tasks: number; done: number; minutes: number; expected: number; running: number }
interface Daily { from: string; to: string; rows: Row[]; people: Person[]; titles: { title: string; minutes: number }[]; team: { _id: string; name: string }[] }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const STATUS: Record<Row['status'], { ar: string; en: string; cls: string }> = {
  todo: { ar: 'لم تبدأ', en: 'Not started', cls: 'bg-slate-100 text-slate-600' },
  doing: { ar: 'جارية', en: 'In progress', cls: 'bg-emerald-50 text-emerald-700' },
  paused: { ar: 'متوقّفة', en: 'Paused', cls: 'bg-amber-50 text-amber-800' },
  done: { ar: 'تمّت', en: 'Done', cls: 'bg-sky-50 text-sky-700' },
};

export default function JpDaily({ scope, section, ar }: { scope: JpScope; section?: string; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [assignee, setAssignee] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [d, setD] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(true);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const p = new URLSearchParams(qs(scope, section));
      p.set('from', from || today()); p.set('to', to || from || today());
      if (assignee) p.set('assignee', assignee);
      if (title) p.set('title', title);
      if (status) p.set('status', status);
      const r = await api.get<Daily>(`/api/jp/daily?${p.toString()}`);
      if (guard.isCurrent(mine)) setD(r);
    } catch { /* اليوميّةُ زيادةٌ على اللوحة */ }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [scope, section, from, to, assignee, title, status, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((x: { scope?: string; section?: string }) => {
    if (!x || (x.scope === scope && (scope === 'management' || x.section === section))) load();
  }, [load, scope, section]));

  const sel = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]';
  const titles = [...new Set([...(d?.titles || []).map((x) => x.title), ...(title ? [title] : [])])];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <CalendarClock className="h-4 w-4 text-[#f37121]" />
        <h2 className="text-[15px] font-bold text-slate-900">{t('اليوميّة — مَن عمل على ماذا وكم أخذ', 'Daily log — who worked on what, and for how long')}</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <PeriodFilter ar={ar} modes={['day', 'range']} from={from} to={to} onChange={(a, b) => { setFrom(a || today()); setTo(b || a || today()); }} />
        {(d?.team || []).length > 0 && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={sel} aria-label={t('الموظّف', 'Employee')}>
            <option value="">{t('كلُّ الفريق', 'Whole team')}</option>
            {d!.team.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
        )}
        <select value={title} onChange={(e) => setTitle(e.target.value)} className={sel} aria-label={t('المهمّة', 'Task')}>
          <option value="">{t('كلُّ المهامّ', 'All tasks')}</option>
          {titles.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel} aria-label={t('الحالة', 'Status')}>
          <option value="">{t('كلُّ الحالات', 'Any status')}</option>
          {(Object.keys(STATUS) as Row['status'][]).map((k) => <option key={k} value={k}>{ar ? STATUS[k].ar : STATUS[k].en}</option>)}
        </select>
      </div>

      {d && (
        <>
          {/* لكلّ موظّفٍ: وقتُه في المدى، وما خُطِّط له، وما تمّ. */}
          {d.people.length > 0 && (
            <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 lg:grid-cols-4">
              {d.people.map((p) => (
                <button key={p.assignedTo || p.name} type="button" onClick={() => setAssignee(assignee === p.assignedTo ? '' : (p.assignedTo || ''))}
                  className={`rounded-xl border px-3 py-2.5 text-start transition-colors ${assignee && assignee === p.assignedTo ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <p className="truncate text-[13px] font-bold text-slate-900">{p.name}{p.running ? <span className="ms-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> : null}</p>
                  <p className="text-[18px] font-extrabold tabular-nums text-slate-900">{fmtMinutes(p.minutes, ar)}</p>
                  <p className="text-[11.5px] text-slate-500">
                    {t(`${p.tasks} مهمّة · ${p.done} تمّت`, `${p.tasks} tasks · ${p.done} done`)}
                    {p.expected ? ` · ${t('المتوقّع', 'planned')} ${fmtMinutes(p.expected, ar)}` : ''}
                  </p>
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="bg-slate-50 text-[12px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t('اليوم', 'Day')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('الموظّف', 'Employee')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('المهمّة', 'Task')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('الحالة', 'Status')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('الوقت في اليوم', 'Time that day')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('المتوقّع', 'Expected')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('الإجمالي', 'Total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => {
                  const over = r.expectedMinutes != null && r.totalMinutes > r.expectedMinutes;
                  return (
                    <tr key={`${r.taskId}-${r.day}`} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 tabular-nums text-slate-600">{r.day.split('-').reverse().join('/')}</td>
                      <td className="px-3 py-2 font-semibold text-slate-800">{r.assignedToName || '—'}</td>
                      <td className="px-3 py-2 text-slate-800">
                        <button type="button" onClick={() => setTitle(title === r.title ? '' : r.title)} className="hover:underline">{r.title}</button>
                        {r.kind === 'request' && <span className="ms-1 text-[11px] text-sky-600">{t('طلب', 'request')}</span>}
                        {!r.planned && <span className="ms-1 text-[11px] text-slate-400">{t('(من يومٍ سابق)', '(carried over)')}</span>}
                      </td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STATUS[r.status].cls}`}>{ar ? STATUS[r.status].ar : STATUS[r.status].en}</span></td>
                      <td className="px-3 py-2 font-bold tabular-nums text-slate-900">{r.minutes ? fmtMinutes(r.minutes, ar) : '—'}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{r.expectedMinutes != null ? fmtMinutes(r.expectedMinutes, ar) : '—'}</td>
                      <td className={`px-3 py-2 tabular-nums ${over ? 'font-bold text-red-600' : 'text-slate-600'}`}>{fmtMinutes(r.totalMinutes, ar)}</td>
                    </tr>
                  );
                })}
                {!d.rows.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400">{t('لا شيء مسجّل في هذا اليوم', 'Nothing logged for this day')}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
