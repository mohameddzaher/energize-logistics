'use client';
// مهامي — what an EMPLOYEE sees of the business review, and all they see.
//
// The tasks their manager handed down, with who asked, what exactly is wanted
// and by when. No meeting, no minutes, no other person's work — the endpoint
// behind this page reads a collection that contains none of those things.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { ListTodo, AlertTriangle, CheckCircle2, Clock, Filter } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { KpiTile } from '@/components/system/Scorecard';
import { TaskCard } from '@/components/system/BusinessReviewKit';
import {
  brMeta, brMyTasks, brUpdateTask,
  type BrMeta, type BrDelegation, type Lang, tx, OPEN_STATUSES,
} from '@/lib/businessReview';

export default function MyTasksPage() {
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [tasks, setTasks] = useState<BrDelegation[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'overdue' | 'done' | 'all'>('open');

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([brMeta().catch(() => null), brMyTasks()]);
      if (m) setMeta(m);
      setTasks(r.assignments || []);
      setSummary(r.summary);
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('br:assignment', load);
  useSocket('br:updated', load);

  const shown = useMemo(() => {
    if (filter === 'all') return tasks;
    if (filter === 'done') return tasks.filter((a) => a.status === 'done');
    if (filter === 'overdue') return tasks.filter((a) => a.isOverdue && OPEN_STATUSES.includes(a.status));
    return tasks.filter((a) => OPEN_STATUSES.includes(a.status));
  }, [tasks, filter]);

  if (loading) return <Spinner />;

  const chips: { key: typeof filter; label: string; n: number }[] = [
    { key: 'open', label: t('Open', 'مفتوحة'), n: summary?.open || 0 },
    { key: 'overdue', label: t('Overdue', 'متأخرة'), n: summary?.overdue || 0 },
    { key: 'done', label: t('Completed', 'منجزة'), n: summary?.done || 0 },
    { key: 'all', label: t('All', 'الكل'), n: summary?.total || 0 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<ListTodo className="w-5 h-5 text-[#f37121]" />}
        title={t('My tasks', 'مهامي')}
        subtitle={t(
          'Work assigned to you out of the business review meetings.',
          'المهام المُسندة إليك من اجتماعات مراجعة الأعمال.'
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t('Open', 'مفتوحة')} value={summary?.open || 0} accent="#0ea5e9" icon={<Clock className="w-4 h-4" />} />
        <KpiTile label={t('Overdue', 'متأخرة')} value={summary?.overdue || 0} accent="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiTile label={t('Completed', 'منجزة')} value={summary?.done || 0} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
        <KpiTile label={t('Total', 'الإجمالي')} value={summary?.total || 0} />
      </div>

      {!!summary?.overdue && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">
            {t(`${summary.overdue} task(s) are past their due date.`, `لديك ${summary.overdue} مهمة تجاوزت موعد التسليم.`)}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-slate-400" />
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => setFilter(c.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              filter === c.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}>
            {c.label} ({c.n})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {meta && shown.map((task) => (
          <TaskCard
            key={task._id} task={task} meta={meta} lang={L}
            onUpdate={async (v) => {
              try { await brUpdateTask(task._id, v); await load(); notify(t('Updated', 'تم التحديث'), 'success'); }
              catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
            }}
          />
        ))}
        {!shown.length && (
          <p className="text-slate-400 text-sm text-center py-12">
            {filter === 'open'
              ? t('Nothing open — you are clear.', 'لا توجد مهام مفتوحة — كل شيء منجز.')
              : t('Nothing here.', 'لا يوجد شيء هنا.')}
          </p>
        )}
      </div>
    </div>
  );
}
