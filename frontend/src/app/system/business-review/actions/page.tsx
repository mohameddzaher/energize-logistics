'use client';
// سجل المتابعة — every action from every meeting, for the board and the secretariat.
//
// This is the page the GM opens before the next round: what did we ask for, who
// owes it, and what has slipped. The "load by person" table on the right is the
// question that actually gets asked out loud in the meeting.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  ClipboardList, AlertTriangle, CheckCircle2, Clock, Search, Users,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { KpiTile } from '@/components/system/Scorecard';
import { ActionCard } from '@/components/system/BusinessReviewKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  brMeta, brAllActions, brUpdateAction, brDelegate, brDeleteAction,
  type BrMeta, type BrAction, type Lang,
  vocabLabel, fmtDate, tx, OPEN_STATUSES,
} from '@/lib/businessReview';

export default function ActionRegisterPage() {
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [actions, setActions] = useState<BrAction[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [byPerson, setByPerson] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        brMeta().catch(() => null),
        brAllActions({ status, assignee }),
      ]);
      if (m) setMeta(m);
      setActions(r.actions || []);
      setSummary(r.summary);
      setByPerson(r.byPerson || []);
      setDenied(false);
    } catch (e: any) {
      if (String(e?.message || '').toLowerCase().includes('permission')) setDenied(true);
    }
    setLoading(false);
  }, [status, assignee]);
  useEffect(() => { load(); }, [load]);
  useSocket('br:action', load);

  const shown = useMemo(() => {
    let list = actions;
    if (onlyOverdue) list = list.filter((a) => a.isOverdue && OPEN_STATUSES.includes(a.status));
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((a) => `${a.title} ${a.assigneeName} ${a.meetingRef} ${a.department || ''}`.toLowerCase().includes(s));
    return list;
  }, [actions, q, onlyOverdue]);

  if (loading) return <Spinner />;
  if (denied) {
    return (
      <div className="space-y-5">
        <PageHeader icon={<ClipboardList className="w-5 h-5 text-[#f37121]" />} title={t('Action register', 'سجل المتابعة')} />
        <p className="text-slate-500 text-sm">
          {t('This register is for the board and the administration.', 'هذا السجل مخصص للإدارة والسكرتارية.')}
        </p>
      </div>
    );
  }

  const exportColumns: ExportColumn[] = [
    { header: t('Meeting', 'الاجتماع'), key: 'meetingRef', width: 14 },
    { header: t('Action', 'البند'), key: 'title', width: 44 },
    { header: t('Owner', 'المكلَّف'), key: 'assigneeName', width: 24 },
    { header: t('Requested by', 'بطلب من'), key: 'raisedByName', width: 22 },
    { header: t('Department', 'القسم'), key: 'department', width: 18 },
    { header: t('Due', 'موعد التسليم'), key: 'dueDate', transform: (v: any) => fmtDate(v), width: 14 },
    { header: t('Status', 'الحالة'), key: 'status', transform: (v: string) => vocabLabel(meta?.actionStatuses, v, L), width: 16 },
    { header: t('Progress %', 'الإنجاز %'), key: 'progress', width: 12 },
    { header: t('Overdue', 'متأخر'), key: 'isOverdue', transform: (v: boolean) => (v ? t('Yes', 'نعم') : t('No', 'لا')), width: 10 },
    { header: t('Delegated to', 'موزّع على'), key: 'delegations', transform: (v: any[]) => (v || []).map((d) => d.assigneeName).join(' | '), width: 34 },
  ];
  const sheetName = t('Action register', 'سجل المتابعة');
  // فلترُ الحالة والمكلَّف يجري على الخادم، والبحثُ و«المتأخر فقط» في الذاكرة؛
  // فالسجلّ الظاهر قد يكون شريحةً صغيرةً من البنود. من يفتح الملفَّ ليجرد كلَّ
  // ما على الجميع كان يأخذ شريحةَ الشاشة وحدها، فصار «الكلّ» يعيد النداء بلا فلاتر.
  const fetchAllForExport = async () => {
    const r = await brAllActions({});
    return [{ name: sheetName, rows: (r.actions || []) as unknown as Record<string, any>[], columns: exportColumns }];
  };
  const hasActiveFilters = !!(q.trim() || status || assignee || onlyOverdue);
  const scope = exportScopeLabels(lang === 'ar');
  const shownSheets = [{ name: sheetName, rows: shown as unknown as Record<string, any>[], columns: exportColumns }];
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: shownSheets },
        { key: 'all', label: scope.all, resolve: fetchAllForExport },
      ]
    : [{ key: 'all', label: scope.all, sheets: shownSheets }];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5 text-[#f37121]" />}
        title={t('Action register', 'سجل متابعة البنود')}
        subtitle={t(
          'Every action from every review meeting — who owes what, and what has slipped.',
          'كل البنود التنفيذية من كل الاجتماعات — من عليه ماذا، وما الذي تأخّر.'
        )}
      >
        <ExportMenu fileName="business-review-actions" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle"
          label={t('Export Excel', 'تصدير Excel')} options={exportOptions} />
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label={t('Total actions', 'إجمالي البنود')} value={summary?.total || 0} icon={<ClipboardList className="w-4 h-4" />} />
        <KpiTile label={t('Open', 'مفتوحة')} value={summary?.open || 0} accent="#0ea5e9" icon={<Clock className="w-4 h-4" />} />
        <KpiTile label={t('Overdue', 'متأخرة')} value={summary?.overdue || 0} accent="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiTile label={t('Completed', 'منجزة')} value={summary?.done || 0} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
        <KpiTile label={t('Completion rate', 'نسبة الإنجاز')} value={`${summary?.completionRate || 0}%`} accent="#16a34a" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t('Search actions…', 'ابحث في البنود…')}
                className="w-full ps-8 pe-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700">
              <option value="">{t('All statuses', 'كل الحالات')}</option>
              {meta?.actionStatuses.map((s) => <option key={s.key} value={s.key}>{lang === 'ar' ? s.ar : s.en}</option>)}
            </select>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 max-w-[200px]">
              <option value="">{t('Everyone', 'كل المكلَّفين')}</option>
              {meta?.participants.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="accent-[#f37121]" />
              {t('Overdue only', 'المتأخر فقط')}
            </label>
          </div>

          {meta && shown.map((a) => (
            <ActionCard
              key={a._id} action={a} meta={meta} lang={L} showMeeting canEdit
              canDelegate={a.assignee === meta.me._id || meta.me.canRunMeetings}
              people={meta.people.filter((p) => p._id !== meta.me._id)}
              onUpdate={async (v) => {
                try { await brUpdateAction(a._id, v); await load(); }
                catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
              }}
              onDelegate={async (rows) => {
                try { await brDelegate(a._id, rows); await load(); }
                catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
              }}
              onDelete={async () => {
                try { await brDeleteAction(a._id); await load(); }
                catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
              }}
            />
          ))}
          {!shown.length && (
            <p className="text-slate-400 text-sm text-center py-12">{t('No actions match.', 'لا توجد بنود مطابقة.')}</p>
          )}
        </div>

        {/* Who is carrying what — the follow-up conversation, pre-answered. */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:sticky lg:top-4">
          <p className="text-slate-700 text-xs font-semibold mb-3 inline-flex items-center gap-1.5">
            <Users className="w-4 h-4 text-[#f37121]" />{t('Load by person', 'التوزيع حسب المكلَّف')}
          </p>
          <div className="space-y-2">
            {byPerson.map((p) => (
              <button key={p.assignee} type="button"
                onClick={() => setAssignee(assignee === p.assignee ? '' : p.assignee)}
                className={`w-full text-start rounded-lg border px-2.5 py-2 ${
                  assignee === p.assignee ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 hover:bg-slate-50'
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-900 text-xs font-medium truncate">{p.name}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">{p.open}/{p.total}</span>
                </div>
                {!!p.overdue && (
                  <span className="text-[10px] text-red-600">{p.overdue} {t('overdue', 'متأخر')}</span>
                )}
              </button>
            ))}
            {!byPerson.length && <p className="text-slate-400 text-xs">{t('No actions yet.', 'لا توجد بنود بعد.')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
