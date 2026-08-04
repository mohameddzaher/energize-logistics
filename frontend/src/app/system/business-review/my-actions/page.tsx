'use client';
// بنودي — a department manager's own board.
//
// Everything the board asked of ME, in due-date order, with the two things a
// manager actually does about them: report progress, or hand pieces of the work
// to the team. What the team then sees is only their own piece.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { ClipboardList, AlertTriangle, CheckCircle2, Clock, Filter } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { KpiTile } from '@/components/system/Scorecard';
import { ActionCard } from '@/components/system/BusinessReviewKit';
import {
  brMeta, brMyActions, brUpdateAction, brDelegate,
  type BrMeta, type BrAction, type Lang, tx, OPEN_STATUSES,
} from '@/lib/businessReview';

export default function MyActionsPage() {
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [actions, setActions] = useState<BrAction[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'overdue' | 'done' | 'all'>('open');

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([brMeta().catch(() => null), brMyActions()]);
      if (m) setMeta(m);
      setActions(r.actions || []);
      setSummary(r.summary);
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('br:action', load);
  useSocket('br:updated', load);

  const shown = useMemo(() => {
    if (filter === 'all') return actions;
    if (filter === 'done') return actions.filter((a) => a.status === 'done');
    if (filter === 'overdue') return actions.filter((a) => a.isOverdue && OPEN_STATUSES.includes(a.status));
    return actions.filter((a) => OPEN_STATUSES.includes(a.status));
  }, [actions, filter]);

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
        icon={<ClipboardList className="w-5 h-5 text-[#f37121]" />}
        title={t('My actions', 'البنود المسندة إليّ')}
        subtitle={t(
          'What the review meetings asked of you — report progress, or delegate parts of it to your team.',
          'ما طُلب منك في اجتماعات المراجعة — حدّث الحالة، أو وزّع أجزاءً منه على فريقك.'
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t('Open', 'مفتوحة')} value={summary?.open || 0} accent="#0ea5e9" icon={<Clock className="w-4 h-4" />} />
        <KpiTile label={t('Overdue', 'متأخرة')} value={summary?.overdue || 0} accent="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiTile label={t('Completed', 'منجزة')} value={summary?.done || 0} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
        <KpiTile label={t('Total', 'الإجمالي')} value={summary?.total || 0} />
      </div>

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
        {meta && shown.map((a) => (
          <ActionCard
            key={a._id} action={a} meta={meta} lang={L} showMeeting
            canDelegate
            people={meta.people.filter((p) => p._id !== meta.me._id)}
            onUpdate={async (v) => {
              try { await brUpdateAction(a._id, v); await load(); notify(t('Updated', 'تم التحديث'), 'success'); }
              catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
            }}
            onDelegate={async (rows) => {
              try { await brDelegate(a._id, rows); await load(); notify(t('Delegated', 'تم التوزيع'), 'success'); }
              catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
            }}
          />
        ))}
        {!shown.length && (
          <p className="text-slate-400 text-sm text-center py-12">
            {filter === 'open'
              ? t('Nothing open — you are clear.', 'لا يوجد شيء مفتوح — كل شيء منجز.')
              : t('Nothing here.', 'لا يوجد شيء هنا.')}
          </p>
        )}
      </div>
    </div>
  );
}
