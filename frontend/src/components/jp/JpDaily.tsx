'use client';
/**
 * Daily log: what each person worked on each day and how long it took.
 * One row per task per day: what was planned, what was worked with the timer (a span across midnight is split between its two days), the manager's correction, and what was done. Filter by day or range, employee, task and status. All computation is on the server (GET /api/jp/daily).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
const STATUS: Record<Row['status'], { ar: string; en: string; dot: string }> = {
  todo: { ar: 'لم تبدأ', en: 'Not started', dot: 'bg-slate-300' },
  doing: { ar: 'جارية', en: 'In progress', dot: 'bg-emerald-500' },
  paused: { ar: 'متوقّفة', en: 'Paused', dot: 'bg-amber-500' },
  done: { ar: 'تمّت', en: 'Done', dot: 'bg-sky-600' },
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
    } catch { /* The daily log is an addition to the board. */ }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [scope, section, from, to, assignee, title, status, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((x: { scope?: string; section?: string }) => {
    if (!x || (x.scope === scope && (scope === 'management' || x.section === section))) load();
  }, [load, scope, section]));

  const sel = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700';
  // Lines grouped per person; identical tasks (same title, status and day) are one line with a count.
  const multiDay = !!d && d.from !== d.to;
  const groups = useMemo(() => {
    const out = new Map<string, { key: string; name: string; tasks: number; done: number; minutes: number; running: boolean; lines: { key: string; day: string; title: string; status: Row['status']; count: number; minutes: number; expected: number | null; request: boolean; carried: boolean }[] }>();
    for (const r of d?.rows || []) {
      const key = r.assignedTo || r.assignedToName || '—';
      const g = out.get(key) || { key, name: r.assignedToName || '—', tasks: 0, done: 0, minutes: 0, running: false, lines: [] };
      g.tasks += 1; if (r.status === 'done') g.done += 1; g.minutes += r.minutes || 0; if (r.running) g.running = true;
      const lk = `${r.day}|${r.title}|${r.status}|${r.kind}|${r.planned}`;
      const line = g.lines.find((x) => x.key === lk);
      if (line) { line.count += 1; line.minutes += r.minutes || 0; if (r.expectedMinutes != null) line.expected = (line.expected || 0) + r.expectedMinutes; }
      else g.lines.push({ key: lk, day: r.day, title: r.title, status: r.status, count: 1, minutes: r.minutes || 0, expected: r.expectedMinutes, request: r.kind === 'request', carried: !r.planned });
      out.set(key, g);
    }
    return [...out.values()].sort((a, b) => b.minutes - a.minutes || b.tasks - a.tasks);
  }, [d]);
  const titles = [...new Set([...(d?.titles || []).map((x) => x.title), ...(title ? [title] : [])])];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <CalendarClock className="h-4 w-4 text-[#f37121]" />
        <h2 className="text-[15px] font-bold text-slate-900">{t('اليوميّة', 'Daily log')}</h2>
        <span className="text-[12.5px] text-slate-500">{t('ما عمل عليه كلُّ موظّف والوقت المسجّل', 'What each person worked on and the time logged')}</span>
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
        <div className="px-4 pb-4">
          {!d.rows.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-[13px] text-slate-400">{t('لا شيء مسجّل في هذه الفترة', 'Nothing logged in this period')}</p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200">
                  {/* One block per person: total time and counts on the header, his tasks below. */}
                  <button type="button" onClick={() => setAssignee(assignee === g.key ? '' : g.key)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 px-4 py-2.5 text-start hover:bg-slate-100">
                    <span className="text-[14px] font-bold text-slate-900">{g.name}{g.running ? <span className="ms-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" title={t('يعمل الآن', 'Working now')} /> : null}</span>
                    <span className="text-[12.5px] text-slate-500">{t(`${g.tasks} مهمّة`, `${g.tasks} tasks`)} · {t(`${g.done} تمّت`, `${g.done} done`)}</span>
                    <span className="ms-auto text-[13px] font-bold tabular-nums text-slate-900">{g.minutes ? fmtMinutes(g.minutes, ar) : <span className="font-normal text-slate-400">{t('لم يُسجَّل وقت', 'No time logged')}</span>}</span>
                  </button>
                  <table className="w-full text-[13px]">
                    <tbody className="divide-y divide-slate-100">
                      {g.lines.map((r) => {
                        const over = r.expected != null && r.minutes > r.expected;
                        return (
                          <tr key={r.key}>
                            {multiDay && <td className="w-24 px-4 py-2 tabular-nums text-slate-500">{r.day.split('-').reverse().join('/')}</td>}
                            <td className="px-4 py-2 text-slate-800">
                              <button type="button" onClick={() => setTitle(title === r.title ? '' : r.title)} className="font-medium hover:text-[#f37121]">{r.title}</button>
                              {r.count > 1 && <span className="ms-1.5 text-[12px] font-semibold text-slate-500">×{r.count}</span>}
                              {r.request && <span className="ms-2 text-[11.5px] text-slate-400">{t('طلب', 'request')}</span>}
                              {r.carried && <span className="ms-2 text-[11.5px] text-slate-400">{t('من يومٍ سابق', 'carried over')}</span>}
                            </td>
                            <td className="w-36 px-4 py-2"><span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-700"><span className={`h-2 w-2 rounded-[2px] ${STATUS[r.status].dot}`} />{ar ? STATUS[r.status].ar : STATUS[r.status].en}</span></td>
                            <td className={`w-40 px-4 py-2 text-end tabular-nums ${over ? 'font-bold text-red-600' : 'text-slate-800'}`}>
                              {r.minutes ? fmtMinutes(r.minutes, ar) : <span className="text-[12px] text-slate-400">{t('بلا مؤقّت', 'not timed')}</span>}
                              {r.expected != null && <span className="ms-1.5 text-[11.5px] font-normal text-slate-400">/ {fmtMinutes(r.expected, ar)}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
