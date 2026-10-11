'use client';
/**
 * مهامُّ خطّة العمل (JP) المربوطةُ بمعاملةٍ أو طرف — تُقرأ في صفحته.
 *
 * كانت المهمّةُ تُكتب في خطّة القسم بنصٍّ حرّ: «تابِع فاتورة نقل بوليصة كذا».
 * فمَن فتح المعاملةَ لم يعرف أنّ عليها مهمّة، ومَن فتح المهمّةَ بحث عن
 * المعاملة بيده. فصارت تُربَط، وتُقرأ هنا بقاعدة الرؤية نفسِها: المديرُ يرى
 * الكلّ، والموظّفُ ما أُسنِد إليه أو كتبه. ومَن ليس من فريق القسم لا يظهر له
 * هذا الصندوقُ أصلًا.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { type JpTask, deadlineLine, TONE_CLASS } from '@/lib/jp';
import { CalendarCheck, Plus, Check, Clock } from 'lucide-react';

export default function ClearanceTasks({ kind, refId, ar }: { kind: 'clearance' | 'customer' | 'agent' | 'carrier'; refId: string; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [tasks, setTasks] = useState<JpTask[] | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    api.get<{ tasks: JpTask[] }>(`/api/jp/tasks?scope=section&section=customs&box=all&linkKind=${kind}&linkRef=${refId}`)
      .then((d) => setTasks(d.tasks || []))
      .catch(() => setHidden(true));
  }, [kind, refId]);
  useEffect(() => { load(); }, [load]);
  useSocket('jp:changed', useCallback((d: any) => { if (d?.section === 'customs') load(); }, [load]));

  if (hidden || tasks === null) return null;
  const now = Date.now();
  const open = tasks.filter((x) => x.status !== 'done');
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><CalendarCheck className="w-4 h-4" /></span>
          {t('مهامّ خطّة العمل (JP)', 'Work-plan tasks (JP)')}
          <span className="text-slate-400 text-xs font-normal">{open.length ? t(`${open.length} مفتوحة`, `${open.length} open`) : ''}</span>
        </h3>
        <Link href={`/system/customs/jp?link=${kind}:${refId}`}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:text-[#f37121]">
          <Plus className="w-3.5 h-3.5" />{t('مهمّة جديدة', 'New task')}
        </Link>
      </header>
      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">{t('لا مهامَّ مربوطةً بعد.', 'No linked tasks yet.')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((x) => {
            const dl = deadlineLine(x, now, ar);
            return (
              <li key={x._id}>
                <Link href={`/system/customs/jp?link=${kind}:${refId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-slate-50">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${x.status === 'done' ? 'bg-emerald-500 text-white' : x.state === 'overdue' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
                    {x.status === 'done' ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${x.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{x.title}</span>
                  <span className="text-[12px] text-slate-500">{x.assignedToName}</span>
                  <span className={`text-[12px] ${TONE_CLASS[dl.tone]}`}>{dl.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
