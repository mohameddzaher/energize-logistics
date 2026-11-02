'use client';
/**
 * Collections dashboard: what we are owed, how old it is, who owes it, and where.
 * A single 'owed' figure says nothing about risk, so aging always accompanies it. Order follows the questions: total and collection rate, alerts, aging and monthly chart, top debtors and branches; every card opens what it counts.
 * Only what is owed to us; payables and the net belong to management and finance. Live: edits re-read while existing numbers stay shown.
 * Small components are outside the page on purpose: one defined in render is recreated on every update.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { money, canEditCollections } from '@/lib/collections';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import ReceivablesTree, { type Tree, type Check, type AttachKpi, type DefaultTerm } from '@/components/collections/ReceivablesTree';
import DefaultTermList, { type DefaultTermParty } from '@/components/collections/DefaultTermList';
import {
  ReceivablesFilterBar, filtersFromParams, filtersToQuery, receivablesHref,
  DASHBOARD_PATH, type DashFilters, type Facets,
} from '@/components/collections/receivablesFilters';
import {
  Wallet, Users, ChevronLeft, UserCheck, Truck, Scale,
} from 'lucide-react';

interface Recv {
  tree: Tree;
  checks: Check[];
  attachments?: AttachKpi;
  defaultTerm?: DefaultTerm & { parties: DefaultTermParty[] };
  manager?: { name: string; email: string } | null;
  facets?: Facets;
  officers: { officer: string; isManager?: boolean; defaulted?: number; count: number; value: number; late: number; lateValue: number; hard: number; hardValue: number }[];
  parties: { party: string | null; key: string; name: string; code: string; officer: string; officerIsDefault?: boolean; issueState: string; count: number; value: number; late: number; lateValue: number; hard: number; hardValue: number; oldest: number | null }[];
}
// From the operating-statements dashboard only the vendor count remains; all money comes from the ledger.
interface Dash {
  counts: { customer: { active: number; inactive: number }; supplier: { active: number; inactive: number } };
}

/* Dashboard filters: five multi-select lists and a date range, with every number on the page beneath them. They live in the URL (see components/collections/receivablesFilters), so they are carried to the detail page with each number clicked and Back returns to the dashboard with them. */

function Panel({ title, icon, right, children, className = '' }: {
  title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          {icon && <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">{icon}</span>}
          {title}
        </h2>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function CollectionsDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditCollections(user);
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  // Debt tree from the invoice ledger; see components/collections/ReceivablesTree.
  const [recv, setRecv] = useState<Recv | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filters in the URL.
  // Read from it and written to it (`replace`, not `push`: changing a filter is not a page to go back to), so Back from the detail page returns to the dashboard with its filters.
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() || '';
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(qs)), [qs]);
  const setFilters = useCallback((f: DashFilters) => {
    const s = new URLSearchParams(filtersToQuery(f)).toString();
    router.replace(s ? `${DASHBOARD_PATH}?${s}` : DASHBOARD_PATH, { scroll: false });
  }, [router]);

  // Page filters as a query string: sent to the dashboard and carried to every number opened from it.
  const ledgerFilters = useMemo(() => filtersToQuery(filters), [filters]);
  // Every number opens its rows page, with the dashboard filters and the node clicked.
  const openNode = useCallback((node: Record<string, string> = {}) => {
    router.push(receivablesHref(filters, node));
  }, [router, filters]);

  // Each call has its own guard.
  // A late reply for an earlier filter must not overwrite a newer one; the slowest reply is the unfiltered one fired at first open (see stale-response-races). One guard per call: a shared guard makes each call invalidate the other's reply.
  const recvGuard = useLatestRequest();
  const dashGuard = useLatestRequest();

  const loadRecv = useCallback(async () => {
    const mine = recvGuard.begin();
    try {
      const p = new URLSearchParams(ledgerFilters);
      const rv = await api.get<Recv>(`/api/collections-dept/receivables/overview?${p.toString()}`);
      if (recvGuard.isCurrent(mine)) setRecv(rv);
    } catch (e: any) {
      if (recvGuard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (recvGuard.isCurrent(mine)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerFilters, recvGuard]);

  const loadDash = useCallback(async () => {
    const mine = dashGuard.begin();
    try {
      const d = await api.get<Dash>('/api/collections-dept/dashboard');
      if (dashGuard.isCurrent(mine)) setData(d);
    } catch { /* Vendor count only; does not block the dashboard. */ }
  }, [dashGuard]);

  const load = useCallback(() => { loadRecv(); loadDash(); }, [loadRecv, loadDash]);
  useEffect(() => { loadRecv(); }, [loadRecv]);
  useEffect(() => { loadDash(); }, [loadDash]);

  // Live: an edit to a statement, invoice, party or attachment triggers a read after the batch settles.
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => { load(); }, 800);
  }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('workflow:updated', soon);
  useSocket('workflow:bulkImported', soon);
  useSocket('collections:party', soon);
  useSocket('finance:changed', soon);
  useSocket('collections:changed', soon);
  useSocket('collections:attachments', soon);

  if (loading && !recv) return <Spinner />;

  const top = (recv?.parties || []).slice(0, 15);
  const topMax = Math.max(1, ...top.map((r) => r.value));

  const topCols = [
    { header: t('الكود', 'Code'), key: 'code', width: 12 },
    { header: t('العميل', 'Customer'), key: 'name', width: 34 },
    { header: t('موظف التحصيل', 'Officer'), key: 'officer', width: 14 },
    { header: t('فواتير', 'Invoices'), key: 'count', width: 10 },
    { header: t('المديونية', 'Outstanding'), key: 'value', width: 16 },
    { header: t('منها متأخر', 'Of which late'), key: 'lateValue', width: 16 },
    { header: t('منها مرتفع الخطورة', 'Of which hard risk'), key: 'hardValue', width: 16 },
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Wallet className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة التحصيل', 'Collections dashboard')}
        subtitle={t('محسوبةٌ من دفتر الفواتير — حيّةٌ مع كلّ تحصيلٍ وتسليم', 'Straight from the invoice ledger — live with every collection and delivery')}
      >
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{t('مباشر', 'Live')}
        </span>
        <ExportMenu
          fileName="collections-dashboard"
          lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'shown',
            label: t('المعروض', 'Shown'),
            sheets: [
              { name: t('المديونية بالعميل', 'Receivables by customer'), rows: recv?.parties || [], columns: topCols },
            ],
          }]}
        />
      </PageHeader>

      {/* Filters: one bar above the dashboard. Five lists with search and multi-select, each option showing its count under the other filters. Every number on the page beneath it (total, the four types, delay age, attachments, verification) and every table opened carries them. */}
      <ReceivablesFilterBar filters={filters} onChange={setFilters} facets={recv?.facets} ar={ar} manager={recv?.manager} />

      {/* Part 0: debt as a tree. The first question asked in the department: how much is owed, how old, and how much is within the customer's term versus outside it. Its source is the invoice ledger, not transport orders (94% of ledger invoices have no transport order here), and the tree reconciles itself with a verification bar beneath it. */}
      {recv && (
        <ReceivablesTree tree={recv.tree} checks={recv.checks} ar={ar}
          attachments={recv.attachments} defaultTerm={recv.defaultTerm}
          onOpenDefaultTerm={() => setTermOpen(true)}
          onOpen={(q) => openNode(q as Record<string, string>)} />
      )}

      {/* By owner: work distributed, not summed. There is no 'no owner' row: unassigned falls on the department manager, and the amount is stated too. */}
      {!!recv?.officers?.length && (
        <Panel title={t('المديونية بمسؤول التحصيل', 'Receivables by collector')} icon={<UserCheck className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {recv.officers.map((o) => (
              <button key={o.officer} type="button"
                onClick={() => router.push(receivablesHref({ ...filters, officer: [o.officer] }))}
                className="text-start bg-slate-50 border border-slate-200 rounded-xl p-3 hover:border-[#f37121]/50 transition-colors">
                <p className="text-[12px] font-semibold text-slate-800">
                  {o.officer}
                  {o.isManager && <span className="ms-1.5 text-[10.5px] font-medium text-slate-400">{t('مدير القسم', 'Dept. manager')}</span>}
                </p>
                <p className="text-lg font-extrabold tabular-nums text-slate-900">{money(o.value)}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {o.count} {t('صف', 'rows')} · {t('متأخر', 'late')} {money(o.lateValue)} · {t('مرتفع', 'hard')} {money(o.hardValue)}
                </p>
                {!!o.defaulted && (
                  <p className="text-[10.5px] text-slate-400 tabular-nums">{t(`منها ${o.defaulted} غير مُسنَد`, `${o.defaulted} of them unassigned`)}</p>
                )}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* Part 1: how much is ours and how much collected. A card computed from transport orders used to contradict the debt tree computed from the invoice ledger. `collectedAmount` is zero on every transport order (nobody writes it), so it counted everything delivered as owed. The ledger is the truth; a second number contradicting the tree is doubt about both. The credit-limit card (`CreditAlerts`) was removed at the user's request. */}

      {/* Part 3: who owes. Four panels from transport orders used to sit here: due aging, sales and collected by month, top overdue parties, and by branch. They were the same computation whose cards were removed above: it counts every transport order with no collection date as debt, and collection date is not written on transport orders, so 'due aging' summed 47.4 million under a tree saying 19.96. They were removed and replaced by the top debts from the same ledger the tree is built from: numbers here sum to what is above them. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" icon={<Users className="w-4 h-4" />} title={t('أكبر المديونيات', 'Largest receivables')}
          right={<span className="text-[11px] text-slate-400">{t(`أعلى ${top.length} من ${recv?.parties.length || 0}`, `Top ${top.length} of ${recv?.parties.length || 0}`)}</span>}>
          {top.length === 0 ? (
            <p className="py-8 text-center text-slate-400 text-sm">{t('لا شيء مستحق', 'Nothing outstanding')}</p>
          ) : (
            <ol className="-my-1 divide-y divide-slate-100">
              {top.map((r, i) => (
                <li key={`${r.party || r.name}`}>
                  <button type="button"
                    onClick={() => router.push(receivablesHref({ ...filters, parties: [r.key] }))}
                    className="w-full text-start flex items-center gap-3 py-2.5 group">
                    <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[12px] font-bold ${i < 3 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-[#f37121]">{r.name}</span>
                        <span className="shrink-0 tabular-nums text-[13.5px] font-bold text-slate-900">{money(r.value)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-3">
                        <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <span className="block h-full rounded-full bg-red-400/80" style={{ width: `${(Math.max(0, r.value) / topMax) * 100}%` }} />
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                          {t(`${money(r.count)} فاتورة · متأخّر ${money(r.lateValue)}${r.officer ? ` · ${r.officer}` : ''}`,
                             `${money(r.count)} invoices · late ${money(r.lateValue)}${r.officer ? ` · ${r.officer}` : ''}`)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="lg:col-span-2 space-y-4">
          <button type="button" onClick={() => router.push('/system/collections-dept/aging')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Users className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('أعمار الديون — كلُّ الحسابات', 'Ageing — every account')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{money(recv?.tree.all.value || 0)}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
          {/* Cases: customers under negotiation or in litigation; their own page, and the number is what they owe under the dashboard filters. */}
          <button type="button" onClick={() => router.push('/system/collections-dept/cases')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Scale className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('القضايا والتفاوض', 'Cases & negotiations')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">
                {money((recv?.facets?.issue || []).filter((x) => x.value !== 'none').reduce((a, x) => a + (x.amount || 0), 0))}
              </span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
          <button type="button" onClick={() => router.push('/system/collections-dept/suppliers')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Truck className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('موردون مسجَّلون', 'Registered suppliers')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{data ? money(data.counts.supplier.active) : '—'}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>

      {/* Customers on the default term; their terms are written from here. */}
      <DefaultTermList
        open={termOpen} onClose={() => setTermOpen(false)}
        parties={recv?.defaultTerm?.parties || []} days={recv?.defaultTerm?.days || 30}
        ar={ar} canEdit={canEdit} onSaved={load}
        onOpenInvoices={(p) => router.push(receivablesHref({ ...filters, parties: [p.key] }, { term: 'default' }))}
      />
    </div>
  );
}
