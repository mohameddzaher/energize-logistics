'use client';
// لوحةُ القسم — التشغيلُ لا الأرباح.
//
// «تحليلات قسم التخليص» تقول كم ربحنا، وهي للإدارة. وهذه تقول ما يحتاجه الفريقُ
// ليعمل: كم معاملةً قادمةً ومفتوحةً ومغلقة، وأين تقف كلُّ مفتوحة، ومع كم عميلٍ
// نعمل الآن، وما الذي فُوتر ولم تصل فاتورةُ نقله، وما على كلّ فردٍ في الفريق.
// ولا رقمَ ماليًّا فيها.
//
// وكلُّ رقمٍ يُضغَط: البطاقةُ تُصفّي جدولَ المعاملات تحتها بما عدّته، والصفُّ
// يفتح معاملتَه. فلا رقمَ هنا لا يُعرَف ممّ تكوّن.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { getCustomsTranslations } from '@/lib/translations';
import { stageName } from '@/lib/customsPipeline';
import {
  LayoutDashboard, CalendarClock, FolderOpen, Lock, AlertTriangle, Users, Container, Car, RotateCcw,
  Wallet, CalendarCheck, Receipt, X, BarChart3, Clock3, Search,
} from 'lucide-react';

interface Row {
  _id: string; refNumber: string; blNumber: string; customerName: string; customerParty: string | null;
  shippingAgent: string; branch: string; cargoType: 'containers' | 'vehicles'; units: number;
  bucket: 'upcoming' | 'open' | 'closed' | 'cancelled'; percent: number; next: string; nextLabel: string;
  createdAt: string; createdBy: string | null; createdByName: string; expectedDate: string; expectedState?: string;
  completedAt: string | null; invoiceNumber: string; invoiced: boolean; awaitingTransportInvoice: boolean;
  returnDeadline: string; returnState: '' | 'overdue' | 'due'; pendingPayments: number; openTasks: number;
}
interface Member {
  _id: string; name: string; role: string; isManager: boolean; openCreated: number; upcomingCreated: number;
  closedThisMonth: number; stages30: number; notes30: number; payments30: number; tasksOpen: number; tasksOverdue: number;
  lastActivityAt: string | null;
}
interface Dash {
  today: string; counts: Record<string, number>;
  byStage: { key: string; label: string; count: number; units: number }[];
  byCustomer: { key: string; party: string | null; name: string; upcoming: number; open: number; closed: number; awaiting: number; units: number }[];
  byBranch: { key: string; upcoming: number; open: number; closed: number }[];
  team: Member[]; rows: Row[]; canManage: boolean; canSeeAnalytics: boolean;
}

/** ما تعدّه كلُّ بطاقة — والجدولُ يُصفّى بالدالّة نفسِها، فلا يختلف العدُّ عن المعروض. */
const VIEWS: Record<string, (r: Row) => boolean> = {
  all: (r) => r.bucket !== 'cancelled',
  upcoming: (r) => r.bucket === 'upcoming',
  open: (r) => r.bucket === 'open',
  closed: (r) => r.bucket === 'closed',
  awaiting: (r) => r.awaitingTransportInvoice,
  notInvoiced: (r) => r.bucket === 'open' && !r.invoiced,
  returnOverdue: (r) => r.returnState === 'overdue',
  returnDue: (r) => r.returnState === 'due',
  pendingPayments: (r) => r.bucket === 'open' && r.pendingPayments > 0,
  withTasks: (r) => r.openTasks > 0,
  cancelled: (r) => r.bucket === 'cancelled',
};

const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export default function CustomsDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();
  const T = getCustomsTranslations(lang);
  // اسمُ المرحلة بلغة الشاشة — والخادمُ يرسل مفتاحَها.
  const stageOf = (key: string, cargo?: string) => (key === 'done' ? t('اكتملت مراحلُها — بقي الإنهاء', 'All stages done — to be closed') : stageName(T.stages, key, cargo));

  const [d, setD] = useState<Dash | null>(null);
  const [opts, setOpts] = useState<{ customers?: any[]; agents?: any[] }>({});
  const [f, setF] = useState<Record<string, string>>({});
  const [view, setView] = useState('open');
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const { begin, isCurrent } = useLatestRequest();

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    const token = begin();
    try {
      const r = await api.get<Dash>(`/api/customs-clearance/dashboard?${qs}`);
      if (isCurrent(token)) setD(r);
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر تحميل اللوحة', 'Could not load the dashboard'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<any>('/api/customs-clearance/filters').then((r) => setOpts(r.options || {})).catch(() => {}); }, []);
  useSocket('customs:created', load);
  useSocket('customs:updated', load);
  useSocket('customs:deleted', load);
  useSocket('jp:changed', useCallback((x: any) => { if (x?.section === 'customs') load(); }, [load]));

  const rows = useMemo(() => {
    if (!d) return [];
    const test = VIEWS[view] || VIEWS.all;
    const s = search.trim().toLowerCase();
    return d.rows.filter((r) => test(r)
      && (!stage || (r.bucket === 'open' && (r.next || 'done') === stage))
      && (!s || [r.blNumber, r.refNumber, r.customerName, r.shippingAgent, r.invoiceNumber, r.createdByName].some((v) => v && String(v).toLowerCase().includes(s))));
  }, [d, view, stage, search]);

  if (!d) return <Spinner />;
  const C = d.counts;
  const active = Object.values(f).filter(Boolean).length;
  const pick = (v: string) => { setView(v); setStage(''); tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const customerName = f.customerParty ? (opts.customers || []).find((o) => o.value === f.customerParty)?.label : '';

  const VIEW_TITLE: Record<string, [string, string]> = {
    all: ['كلّ المعاملات', 'All transactions'], upcoming: ['المعاملات القادمة', 'Upcoming'], open: ['المعاملات المفتوحة', 'Open'],
    closed: ['المعاملات المغلقة', 'Closed'], awaiting: ['مفوترة بانتظار فاتورة النقل', 'Invoiced — awaiting transport invoice'],
    notInvoiced: ['مفتوحة لم تُفوتَر', 'Open, not invoiced'], returnOverdue: ['متأخّرة الإرجاع', 'Return overdue'],
    returnDue: ['يقترب موعد إرجاعها', 'Return due soon'], pendingPayments: ['لها طلبات صرف معلّقة', 'With pending payment requests'],
    withTasks: ['عليها مهامّ مفتوحة', 'With open tasks'], cancelled: ['الملغاة', 'Cancelled'],
  };

  const bucketBadge = (r: Row) => {
    if (r.bucket === 'cancelled') return ['bg-slate-200 text-slate-600', t('ملغاة', 'Cancelled')];
    if (r.bucket === 'upcoming') return ['bg-amber-100 text-amber-800', t('قادمة', 'Upcoming')];
    if (r.bucket === 'closed') return ['bg-green-100 text-green-700', t('مغلقة', 'Closed')];
    return ['bg-blue-100 text-blue-700', t('مفتوحة', 'Open')];
  };

  const exportCols: ExportColumn[] = [
    { header: t('رقم البوليصة', 'BL no.'), key: 'blNumber', width: 18 },
    { header: t('رقم المعاملة', 'Transaction no.'), key: 'refNumber', width: 14 },
    { header: t('العميل', 'Customer'), key: 'customerName', width: 26 },
    { header: t('وكيل الشحن', 'Agent'), key: 'shippingAgent', width: 20 },
    { header: t('الفرع', 'Branch'), key: 'branch', width: 10, transform: (v) => (v === 'dammam' ? t('الدمام', 'Dammam') : t('جدة', 'Jeddah')) },
    { header: t('النوع', 'Type'), key: 'cargoType', width: 10, transform: (v) => (v === 'vehicles' ? t('سيّارات', 'Vehicles') : t('حاويات', 'Containers')) },
    { header: t('العدد', 'Units'), key: 'units', width: 8 },
    { header: t('الحالة', 'State'), key: 'bucket', width: 10, transform: (_v, r) => bucketBadge(r as Row)[1] },
    { header: t('المرحلة المنتظَرة', 'Waiting on'), key: 'next', width: 34, transform: (v, r) => ((r as Row).bucket === 'open' ? stageOf(v || 'done', (r as Row).cargoType) : '—') },
    { header: t('نسبة المراحل', 'Progress'), key: 'percent', width: 10, transform: (v) => `${v}%` },
    { header: t('رقم الفاتورة', 'Invoice no.'), key: 'invoiceNumber', width: 14, transform: (v) => v || '—' },
    { header: t('فاتورة النقل', 'Transport invoice'), key: 'awaitingTransportInvoice', width: 16, transform: (v, r) => (v ? t('لم تُستلَم', 'Not received') : (r as Row).invoiceNumber ? t('مستلَمة', 'Received') : '—') },
    { header: t('آخر موعد إرجاع', 'Return deadline'), key: 'returnDeadline', width: 14, transform: (v) => v || '—' },
    { header: t('أنشأها', 'Created by'), key: 'createdByName', width: 18 },
    { header: t('تاريخ الإنشاء', 'Created'), key: 'createdAt', width: 14, transform: (v) => String(v || '').slice(0, 10) },
  ];

  const maxStage = Math.max(1, ...d.byStage.map((s) => s.count));

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة القسم', 'Section dashboard')}
        subtitle={t('متابعةٌ تشغيليّة: المعاملاتُ ومراحلُها والفريق — اضغط أيَّ رقمٍ لترى ما وراءه', 'Operational follow-up: transactions, stages and the team — click any figure to see what is behind it')}>
        {d.canSeeAnalytics && (
          <Link href="/system/customs/analytics" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#f37121]/50">
            <BarChart3 className="h-4 w-4" />{t('تحليلات قسم التخليص', 'Customs analytics')}
          </Link>
        )}
      </PageHeader>

      {/* ── الفلاتر: تُطبَّق على كلّ ما في الصفحة ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Sel value={f.customerParty} onChange={(v) => set('customerParty', v)} label={t('كلّ العملاء', 'All customers')} list={opts.customers} />
        <Sel value={f.agentParty} onChange={(v) => set('agentParty', v)} label={t('كلّ وكلاء الشحن', 'All agents')} list={opts.agents} />
        <Sel value={f.branch} onChange={(v) => set('branch', v)} label={t('كلّ الفروع', 'All branches')}
          list={[{ value: 'jeddah', label: t('جدة', 'Jeddah') }, { value: 'dammam', label: t('الدمام', 'Dammam') }]} />
        <Sel value={f.cargoType} onChange={(v) => set('cargoType', v)} label={t('حاويات وسيّارات', 'Containers & vehicles')}
          list={[{ value: 'containers', label: t('حاويات', 'Containers') }, { value: 'vehicles', label: t('سيّارات', 'Vehicles') }]} />
        <Sel value={f.member} onChange={(v) => set('member', v)} label={t('كلّ الفريق (مَن أنشأ)', 'Whole team (created by)')}
          list={d.team.map((m) => ({ value: m._id, label: m.name }))} />
        <DateRangeFilter ar={ar} from={f.from || ''} to={f.to || ''} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        {active > 0 && (
          <button type="button" onClick={() => setF({})} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">
            <RotateCcw className="h-4 w-4" />{t('مسح الفلاتر', 'Clear filters')}
          </button>
        )}
      </div>

      {customerName && (
        <p className="text-[13px] text-slate-600">
          {t('الأرقامُ أدناه للعميل:', 'Figures below are for:')} <bdi className="font-bold text-slate-900">{customerName}</bdi>
        </p>
      )}

      {/* ── الحالاتُ الثلاث ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile on={view === 'upcoming'} onClick={() => pick('upcoming')} icon={<CalendarClock className="h-5 w-5" />} tone="amber"
          label={t('معاملات قادمة', 'Upcoming')} value={C.upcoming}
          hint={C.upcomingOverdue ? t(`${C.upcomingOverdue} فات موعدُها ولم تُحوَّل`, `${C.upcomingOverdue} past their date`) : t('لم تبدأ بعد', 'Not started yet')} />
        <Tile on={view === 'open'} onClick={() => pick('open')} icon={<FolderOpen className="h-5 w-5" />} tone="blue"
          label={t('معاملات مفتوحة', 'Open')} value={C.open}
          hint={t(`${C.notInvoiced} لم تُفوتَر بعد`, `${C.notInvoiced} not invoiced yet`)} />
        <Tile on={view === 'closed'} onClick={() => pick('closed')} icon={<Lock className="h-5 w-5" />} tone="green"
          label={t('معاملات مغلقة', 'Closed')} value={C.closed}
          hint={t(`${C.closedThisMonth} أُغلقت هذا الشهر`, `${C.closedThisMonth} closed this month`)} />
        {/* فُوترت ولم تصل فاتورةُ نقلها — حمراءُ ما دام فيها شيء. */}
        <Tile on={view === 'awaiting'} onClick={() => pick('awaiting')} icon={<AlertTriangle className="h-5 w-5" />} tone={C.awaitingTransportInvoice ? 'red' : 'slate'}
          label={t('مفوترة بانتظار فاتورة النقل', 'Invoiced, awaiting transport invoice')} value={C.awaitingTransportInvoice}
          hint={t('تُنهى حين تُرفَق فاتورةُ النقل', 'Closes once the transport invoice is attached')} />
      </div>

      {/* ── ما يُتابَع ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Mini onClick={() => pick('open')} icon={<Users className="h-4 w-4" />} label={t('عملاء نعمل معهم الآن', 'Active customers')} value={C.activeCustomers}
          hint={t(`من ${C.customers} عميلًا`, `of ${C.customers}`)} />
        <Mini onClick={() => pick('open')} icon={<Container className="h-4 w-4" />} label={t('حاويات قيد العمل', 'Containers in work')} value={C.openContainers}
          hint={C.openVehicles ? t(`و${C.openVehicles} سيّارة`, `+ ${C.openVehicles} vehicles`) : ''} />
        <Mini on={view === 'returnOverdue'} onClick={() => pick('returnOverdue')} icon={<Clock3 className="h-4 w-4" />} tone={C.returnOverdue ? 'red' : undefined}
          label={t('متأخّرة الإرجاع', 'Return overdue')} value={C.returnOverdue}
          hint={C.returnDue ? t(`${C.returnDue} يقترب موعدُها`, `${C.returnDue} due soon`) : ''} />
        <Mini on={view === 'pendingPayments'} onClick={() => pick('pendingPayments')} icon={<Wallet className="h-4 w-4" />}
          label={t('طلبات صرف معلّقة', 'Pending payment requests')} value={C.pendingPayments}
          hint={t(`في ${C.withPendingPayments} معاملة`, `in ${C.withPendingPayments} transactions`)} />
        <Mini on={view === 'notInvoiced'} onClick={() => pick('notInvoiced')} icon={<Receipt className="h-4 w-4" />}
          label={t('مفتوحة لم تُفوتَر', 'Open, not invoiced')} value={C.notInvoiced} />
        <Mini on={view === 'withTasks'} onClick={() => pick('withTasks')} icon={<CalendarCheck className="h-4 w-4" />} tone={C.tasksOverdue ? 'red' : undefined}
          label={t('مهامّ خطّة العمل المفتوحة', 'Open work-plan tasks')} value={C.tasksOpen}
          hint={C.tasksOverdue ? t(`${C.tasksOverdue} متأخّرة`, `${C.tasksOverdue} overdue`) : ''} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ── أين تقف المعاملاتُ المفتوحة ─────────────────────────────────── */}
        <Panel title={t('أين تقف المعاملاتُ المفتوحة', 'Where the open transactions stand')}
          hint={t('بالمرحلة التي تنتظرها كلُّ معاملة', 'By the stage each one is waiting on')}>
          {d.byStage.length === 0 ? <Empty text={t('لا معاملاتٍ مفتوحة.', 'No open transactions.')} /> : (
            <ul className="space-y-1.5">
              {d.byStage.map((s) => (
                <li key={s.key}>
                  <button type="button" onClick={() => { setView('open'); setStage(stage === s.key ? '' : s.key); tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                    className={`group w-full rounded-lg px-2.5 py-1.5 text-start transition-colors ${stage === s.key ? 'bg-[#f37121]/10 ring-1 ring-[#f37121]/40' : 'hover:bg-slate-50'}`}>
                    <span className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate font-semibold text-slate-800">{stageOf(s.key)}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        <b className="text-slate-900">{s.count}</b> {t('معاملة', 'tx')} · {s.units} {t('وحدة', 'units')}
                      </span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-[#f37121]" style={{ width: `${(s.count / maxStage) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── العملاء: قادمٌ ومفتوحٌ ومغلق لكلّ عميل ───────────────────────── */}
        <Panel title={t('المعاملاتُ حسب العميل', 'Transactions by customer')}
          hint={t('اضغط عميلًا لتُحصَر اللوحةُ كلُّها فيه', 'Click a customer to narrow the whole dashboard to them')}>
          {d.byCustomer.length === 0 ? <Empty text={t('لا بيانات.', 'No data.')} /> : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white text-[11.5px] text-slate-500">
                  <tr>
                    <th className="py-1.5 text-start font-semibold">{t('العميل', 'Customer')}</th>
                    <th className="px-2 py-1.5 text-center font-semibold">{t('قادمة', 'Upcoming')}</th>
                    <th className="px-2 py-1.5 text-center font-semibold">{t('مفتوحة', 'Open')}</th>
                    <th className="px-2 py-1.5 text-center font-semibold">{t('مغلقة', 'Closed')}</th>
                    <th className="px-2 py-1.5 text-center font-semibold">{t('بانتظار فاتورة النقل', 'Awaiting')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.byCustomer.map((c) => (
                    <tr key={c.key} onClick={() => { if (c.party) { set('customerParty', String(c.party)); setView('all'); setStage(''); } }}
                      className={c.party ? 'cursor-pointer hover:bg-slate-50' : ''}>
                      <td className="max-w-[14rem] truncate py-2 font-semibold text-slate-800">{c.name}</td>
                      <Num v={c.upcoming} cls="text-amber-700" />
                      <Num v={c.open} cls="text-blue-700" />
                      <Num v={c.closed} cls="text-green-700" />
                      <Num v={c.awaiting} cls="text-red-600" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ── الفريق ─────────────────────────────────────────────────────────── */}
      <Panel title={t('الفريق', 'The team')}
        hint={t('ما على كلّ فردٍ الآن، وحركتُه في آخر ثلاثين يومًا — اضغط اسمًا لترى معاملاتِه', 'What each member carries now and their last-30-day activity — click a name to see their transactions')}>
        <ScrollX>
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="text-[11.5px] text-slate-500">
              <tr>
                <th className="py-1.5 text-start font-semibold">{t('الموظّف', 'Member')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('معاملات مفتوحة أنشأها', 'Open (created)')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('قادمة أنشأها', 'Upcoming (created)')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('أغلقها هذا الشهر', 'Closed this month')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('مراحل أنجزها (٣٠ يومًا)', 'Stages ticked (30d)')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('طلبات صرف (٣٠ يومًا)', 'Payment requests (30d)')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('ملاحظات (٣٠ يومًا)', 'Notes (30d)')}</th>
                <th className="px-2 py-1.5 text-center font-semibold">{t('مهامّه المفتوحة', 'Open tasks')}</th>
                <th className="px-2 py-1.5 text-start font-semibold">{t('آخر نشاط', 'Last activity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.team.map((m) => (
                <tr key={m._id} onClick={() => { set('member', f.member === m._id ? '' : m._id); setView('all'); setStage(''); }}
                  className={`cursor-pointer hover:bg-slate-50 ${f.member === m._id ? 'bg-[#f37121]/5' : ''}`}>
                  <td className="py-2 font-semibold text-slate-800">
                    {m.name}
                    {m.isManager && <span className="ms-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{t('مدير القسم', 'Manager')}</span>}
                  </td>
                  <Num v={m.openCreated} cls="text-blue-700" />
                  <Num v={m.upcomingCreated} cls="text-amber-700" />
                  <Num v={m.closedThisMonth} cls="text-green-700" />
                  <Num v={m.stages30} />
                  <Num v={m.payments30} />
                  <Num v={m.notes30} />
                  <td className="px-2 py-2 text-center tabular-nums">
                    <span className={m.tasksOverdue ? 'font-bold text-red-600' : m.tasksOpen ? 'font-bold text-slate-900' : 'text-slate-300'}>{m.tasksOpen}</span>
                    {m.tasksOverdue > 0 && <span className="ms-1 text-[11px] text-red-600">({t(`${m.tasksOverdue} متأخّرة`, `${m.tasksOverdue} late`)})</span>}
                  </td>
                  <td className="px-2 py-2 text-slate-500">{m.lastActivityAt ? fmt(m.lastActivityAt) : t('لا نشاط', 'None')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/system/customs/jp" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:text-[#f37121]">
            <CalendarCheck className="h-3.5 w-3.5" />{t('خطّة العمل (JP)', 'Work plan (JP)')}
          </Link>
          {d.canManage && (
            <Link href="/system/customs/jp-dashboard" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:text-[#f37121]">
              <BarChart3 className="h-3.5 w-3.5" />{t('لوحة خطّة العمل', 'Work-plan dashboard')}
            </Link>
          )}
        </div>
      </Panel>

      {/* ── المعاملاتُ وراء الرقم ───────────────────────────────────────────── */}
      <div ref={tableRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-[14px] font-bold text-slate-900">{ar ? VIEW_TITLE[view][0] : VIEW_TITLE[view][1]}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-slate-700">{rows.length}</span>
          {stage && (
            <button type="button" onClick={() => setStage('')} className="inline-flex items-center gap-1 rounded-full bg-[#f37121]/10 px-2 py-0.5 text-[12px] font-semibold text-[#b4471a]">
              {t('تنتظر', 'Waiting on')}: {stageOf(stage)}<X className="h-3 w-3" />
            </button>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[12px] font-semibold">
              {(['all', 'upcoming', 'open', 'closed'] as const).map((k) => (
                <button key={k} type="button" onClick={() => { setView(k); setStage(''); }}
                  className={`px-2.5 py-1.5 ${view === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {ar ? { all: 'الكلّ', upcoming: 'قادمة', open: 'مفتوحة', closed: 'مغلقة' }[k] : { all: 'All', upcoming: 'Upcoming', open: 'Open', closed: 'Closed' }[k]}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('بحث…', 'Search…')}
                className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pe-2 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
            </div>
            <ExportMenu fileName={`customs-dashboard-${view}`} lang={ar ? 'ar' : 'en'} variant="subtle"
              options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: ar ? VIEW_TITLE[view][0] : VIEW_TITLE[view][1], rows, columns: exportCols }] }]} />
          </div>
        </div>
        <ScrollX>
          <table className="w-full min-w-[1040px] text-[13px]">
            <thead>
              <tr className="bg-slate-900 text-slate-300">
                <th className="px-4 py-2.5 text-start font-semibold">{t('رقم البوليصة', 'BL no.')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('رقم المعاملة', 'Transaction no.')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('العميل', 'Customer')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('الوحدات', 'Units')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('الحالة', 'State')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('المرحلة المنتظَرة', 'Waiting on')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('الفاتورة', 'Invoice')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('تنبيهات', 'Alerts')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('أنشأها', 'Created by')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">{t('لا معاملاتٍ في هذا العرض.', 'No transactions in this view.')}</td></tr>
              ) : rows.map((r) => {
                const [cls, label] = bucketBadge(r);
                return (
                  <tr key={r._id} onClick={() => router.push(`/system/customs/${r._id}`)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${r.awaitingTransportInvoice ? 'bg-red-50/60' : ''}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900"><bdi>{r.blNumber || '—'}</bdi></td>
                    <td className="px-3 py-2.5 text-slate-500"><bdi>{r.refNumber}</bdi></td>
                    <td className="max-w-[14rem] truncate px-3 py-2.5 text-slate-700">{r.customerName || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        {r.cargoType === 'vehicles' ? <Car className="h-3.5 w-3.5" /> : <Container className="h-3.5 w-3.5" />}{r.units}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${cls}`}>{label}</span>
                      {r.bucket === 'upcoming' && r.expectedDate && (
                        <span className={`ms-1.5 text-[11.5px] ${r.expectedState === 'overdue' ? 'font-bold text-red-600' : 'text-slate-500'}`}>{fmt(r.expectedDate)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.bucket === 'open' ? (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${r.percent}%` }} /></span>
                          <span className="tabular-nums text-[11.5px] text-slate-500">{r.percent}%</span>
                          <span className="max-w-[15rem] truncate text-slate-700">{stageOf(r.next || 'done', r.cargoType)}</span>
                        </span>
                      ) : r.bucket === 'closed' ? <span className="text-slate-400">{fmt(r.completedAt)}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.awaitingTransportInvoice
                        ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">{t('بانتظار فاتورة النقل', 'Awaiting transport invoice')}</span>
                        : r.invoiceNumber ? <bdi className="text-slate-700">{r.invoiceNumber}</bdi> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {r.returnState === 'overdue' && <Flag cls="bg-red-100 text-red-700" text={t('متأخّرة الإرجاع', 'Return overdue')} />}
                        {r.returnState === 'due' && <Flag cls="bg-amber-100 text-amber-800" text={t('يقترب الإرجاع', 'Return due')} />}
                        {r.pendingPayments > 0 && <Flag cls="bg-slate-100 text-slate-700" text={t(`${r.pendingPayments} طلب صرف`, `${r.pendingPayments} payment req.`)} />}
                        {r.openTasks > 0 && <Flag cls="bg-violet-50 text-violet-700" text={t(`${r.openTasks} مهمّة`, `${r.openTasks} tasks`)} />}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{r.createdByName || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}

const TONES: Record<string, { ring: string; icon: string; value: string }> = {
  amber: { ring: 'ring-amber-400', icon: 'bg-amber-100 text-amber-700', value: 'text-slate-900' },
  blue: { ring: 'ring-blue-400', icon: 'bg-blue-100 text-blue-700', value: 'text-slate-900' },
  green: { ring: 'ring-green-400', icon: 'bg-green-100 text-green-700', value: 'text-slate-900' },
  red: { ring: 'ring-red-400', icon: 'bg-red-600 text-white', value: 'text-red-700' },
  slate: { ring: 'ring-slate-300', icon: 'bg-slate-100 text-slate-500', value: 'text-slate-900' },
};

function Tile({ label, value, hint, icon, tone, on, onClick }: {
  label: string; value: number; hint?: string; icon: React.ReactNode; tone: string; on?: boolean; onClick: () => void;
}) {
  const c = TONES[tone] || TONES.slate;
  return (
    <button type="button" onClick={onClick}
      className={`min-w-0 rounded-2xl border bg-white p-4 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow ${tone === 'red' ? 'border-red-300 bg-red-50' : 'border-slate-200'} ${on ? `ring-2 ${c.ring}` : ''}`}>
      <span className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.icon}`}>{icon}</span>
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-600" title={label}>{label}</span>
      </span>
      <span className={`mt-2 block text-3xl font-extrabold tabular-nums ${c.value}`}>{value}</span>
      {hint ? <span className="mt-0.5 block truncate text-[11.5px] text-slate-500" title={hint}>{hint}</span> : null}
    </button>
  );
}

function Mini({ label, value, hint, icon, tone, on, onClick }: {
  label: string; value: number; hint?: string; icon: React.ReactNode; tone?: string; on?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`min-w-0 rounded-xl border bg-white px-3 py-2.5 text-start shadow-sm transition-colors hover:border-[#f37121]/50 ${tone === 'red' ? 'border-red-200' : 'border-slate-200'} ${on ? 'ring-2 ring-[#f37121]/50' : ''}`}>
      <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
        <span className={tone === 'red' ? 'text-red-600' : 'text-[#f37121]'}>{icon}</span>
        <span className="truncate" title={label}>{label}</span>
      </span>
      <span className={`block text-xl font-bold tabular-nums ${tone === 'red' ? 'text-red-700' : 'text-slate-900'}`}>{value}</span>
      {hint ? <span className="block truncate text-[10.5px] text-slate-400" title={hint}>{hint}</span> : null}
    </button>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-[14px] font-bold text-slate-900">{title}</h3>
      {hint && <p className="mb-3 text-[11.5px] text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

function Sel({ value, onChange, label, list }: { value?: string; onChange: (v: string) => void; label: string; list?: { value: string; label?: string }[] }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="max-w-[14rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40">
      <option value="">{label}</option>
      {(list || []).map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
    </select>
  );
}

const Num = ({ v, cls = 'text-slate-900' }: { v: number; cls?: string }) => (
  <td className={`px-2 py-2 text-center tabular-nums ${v ? `font-bold ${cls}` : 'text-slate-300'}`}>{v}</td>
);
const Flag = ({ cls, text }: { cls: string; text: string }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>
);
const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-slate-400">{text}</p>;
