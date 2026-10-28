'use client';
/**
 * Shipment Orders dashboard.
 *
 * One period (today / 7 days / month / 30 days / year), every number compared
 * with the previous period of the same length. Live: refreshes on section
 * events and every minute. Links only render when the viewer can open the target.
 */
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, BarChart,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import OpsAnalytics from '@/components/ops/OpsAnalytics';
import { statusLabel, vocabLabel, canEditOrders, type ShipmentOrder, type Lang } from '@/lib/shipmentOrders';
import { PAYMENT_SUBTYPES, type PaymentSubtype } from '@/lib/paymentKind';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { canAccessSection, canAccessPage, permsOf } from '@/lib/sections';
import {
  LayoutDashboard, PackagePlus, PackageSearch, Truck, Users, Store, TrendingUp, TrendingDown,
  AlertTriangle, ArrowUpRight, ArrowDownRight, Minus, Wallet, Receipt, PiggyBank, Ban,
  Loader2, Ship, MessageSquareText, IdCard, Clock, ChevronDown, ChevronLeft, ChevronRight, Activity, Award,
  Route as RouteIcon, BarChart3, CalendarDays, Timer, CreditCard, Building2, Target, CheckCircle2, Layers,
} from 'lucide-react';

type Group = { name: string; orders: number; sell: number; margin: number; marginPct?: number | null };
type KeyRow = { key: string; orders: number; sell: number; margin: number };
interface Analytics {
  totals: {
    orders: number; live: number; cancelled: number; cancelRate: number;
    sell: number; buy: number; margin: number; marginPct: number; avgMargin: number; avgSell: number;
    customers: number; suppliers: number; routes: number; losing: number; missingPrice: number;
  };
  byStatus: Record<string, number>;
  byCustomer: Group[]; bySupplier: Group[]; byRoute: Group[];
  cancelReasons?: { reason: string; count: number; pct: number }[];
  salesRanking?: { rank: number; name: string; shipments: number; live: number; cancelled: number; cancelRate: number; sell: number; margin: number }[];
}
interface Insights {
  marginBuckets: { key: string; n: number }[];
  byWeekday: { day: number; orders: number; margin: number }[];
  byPayment: KeyRow[]; byTruckType: KeyRow[]; byBranch: KeyRow[];
  duration: { trips: number; avgHours: number | null; buckets: { key: string; n: number }[] };
  concentration: { customers: number; top5Share: number | null };
}
interface Period {
  key: PeriodKey; from: string; to: string; prevFrom: string; prevTo: string; days: number;
  cur: Analytics;
  prev: { orders: number; live: number; cancelled: number; sell: number; buy: number; margin: number };
  byDay: { day: string; orders: number; live: number; cancelled: number; sell: number; buy: number; margin: number }[];
  advances: number; withAdvance: number; customsLinked: number; platform: number; ours: number; noSalesRep: number;
  followUpNotes: number; followUpShipments: number; lateNow: number; driversExpired: number;
  insights?: Insights;
}
interface FleetSummary { vehicles: number; suppliers: number; drivers: number; gaps?: { unknown: number } }
type PeriodKey = 'today' | '7d' | 'month' | '30d' | 'year';

const PERIODS: [PeriodKey, string, string][] = [
  ['today', 'اليوم', 'Today'], ['7d', '7 أيام', '7 days'], ['month', 'هذا الشهر', 'This month'],
  ['30d', '30 يومًا', '30 days'], ['year', 'هذه السنة', 'This year'],
];
const PREF_KEY = 'so-dash-period';
const ORANGE = '#f37121';
const NAVY = '#12325C';
const GREEN = '#059669';
const RED = '#dc2626';
const LIST = '/system/shipment-orders';
const WEEKDAYS: [string, string][] = [['الأحد', 'Sun'], ['الاثنين', 'Mon'], ['الثلاثاء', 'Tue'], ['الأربعاء', 'Wed'], ['الخميس', 'Thu'], ['الجمعة', 'Fri'], ['السبت', 'Sat']];
const MARGIN_BUCKETS: Record<string, [string, string, string]> = {
  loss: ['خسارة', 'Loss', '#dc2626'], '0-10': ['0–10%', '0–10%', '#f59e0b'], '10-20': ['10–20%', '10–20%', '#84cc16'],
  '20-30': ['20–30%', '20–30%', '#10b981'], '30+': ['+30%', '30%+', '#047857'],
};
const PIE_COLORS = [NAVY, ORANGE, '#0e7490', '#7c3aed', '#64748b', '#be123c'];

/** Change against the previous period, as a percentage (null = nothing before). */
function delta(cur: number, prev: number): { pct: number | null; dir: 'up' | 'down' | 'flat' } {
  if (!prev && !cur) return { pct: 0, dir: 'flat' };
  if (!prev) return { pct: null, dir: 'up' };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { pct, dir: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat' };
}

function Delta({ cur, prev, goodWhenUp = true, ar }: { cur: number; prev: number; goodWhenUp?: boolean; ar: boolean }) {
  const d = delta(cur, prev);
  const good = d.dir === 'flat' ? null : (d.dir === 'up') === goodWhenUp;
  const cls = good == null ? 'bg-slate-100 text-slate-500' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
  const Icon = d.dir === 'up' ? ArrowUpRight : d.dir === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${cls}`}
      title={ar ? 'مقارنةً بالفترة السابقة بطولها نفسِه' : 'vs the previous period of the same length'}>
      <Icon className="w-3 h-3" />
      {d.pct == null ? (ar ? 'جديد' : 'new') : `${Math.abs(d.pct)}%`}
    </span>
  );
}

// Links render only when the viewer can open the target page.
const CanOpen = createContext<(href: string) => boolean>(() => true);

function Go({ href, className, children, title }: { href?: string; className?: string; children: React.ReactNode; title?: string }) {
  const can = useContext(CanOpen);
  return href && can(href)
    ? <Link href={href} className={className} title={title}>{children}</Link>
    : <span className={className} title={title}>{children}</span>;
}

/** Headline figure with its trend line and the change against the previous period. */
function HeroCard({ label, value, unit, sub, tone, icon: Icon, deltaEl, spark, href }: {
  label: string; value: string; unit?: string; sub?: React.ReactNode; tone: string; icon: any;
  deltaEl?: React.ReactNode; spark: number[]; href?: string;
}) {
  const data = spark.map((v, i) => ({ i, v }));
  const id = `g${tone.replace('#', '')}`;
  const body = (
    <>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: tone }} />
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${tone}14`, color: tone }}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <span className="text-[13px] font-semibold text-slate-600 flex-1">{label}</span>
        {deltaEl}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[30px] leading-none font-extrabold tabular-nums tracking-tight text-slate-900">{value}</span>
        {unit && <span className="text-[12px] font-semibold text-slate-400">{unit}</span>}
      </div>
      {sub ? <p className="mt-1.5 text-[12px] text-slate-500">{sub}</p> : null}
      <div className="h-12 -mx-4 -mb-4 mt-2" dir="ltr">
        {data.length > 1 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tone} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={tone} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={tone} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
  const cls = 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  const can = useContext(CanOpen);
  return href && can(href)
    ? <Link href={href} className={`${cls} block transition hover:shadow-md hover:border-slate-300`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** Small ratio tile for the second row. */
function Ratio({ label, value, hint, tone = NAVY, href }: { label: string; value: string; hint?: string; tone?: string; href?: string }) {
  const can = useContext(CanOpen);
  const body = (
    <>
      <p className="text-[12px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: tone }}>{value}</p>
      {hint ? <p className="text-[11.5px] text-slate-400 mt-0.5 truncate" title={hint}>{hint}</p> : null}
    </>
  );
  const cls = 'rounded-xl bg-white border border-slate-200 px-4 py-3';
  return href && can(href) ? <Link href={href} className={`${cls} block hover:border-slate-300 hover:shadow-sm transition`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Panel({ title, subtitle, icon: Icon, action, children, className = '' }: {
  title: string; subtitle?: string; icon: any; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col ${className}`}>
      <header className="flex items-start gap-2.5 px-4 py-3 border-b border-slate-100">
        <span className="mt-0.5 w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 text-[14px] leading-tight">{title}</h3>
          {subtitle ? <p className="text-[11.5px] text-slate-500 mt-0.5">{subtitle}</p> : null}
        </div>
        <div className="ms-auto shrink-0">{action}</div>
      </header>
      <div className="p-4 flex-1">{children}</div>
    </section>
  );
}

/** Horizontal bars for a ranked list (name, count, money). */
function Bars({ rows, money, short, ar, color = NAVY, hrefOf }: {
  rows: { name: string; orders: number; margin: number; sell?: number }[];
  money: (n: number) => string; short: (n: number) => string; ar: boolean; color?: string; hrefOf?: (name: string) => string | undefined;
}) {
  if (!rows.length) return <p className="text-xs text-slate-400 py-8 text-center">{ar ? 'لا بيانات في الفترة' : 'nothing in this period'}</p>;
  const max = Math.max(1, ...rows.map((r) => r.orders));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const row = (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="flex-1 min-w-0 truncate text-slate-800 font-medium" title={r.name}>{r.name || '—'}</span>
              <span className="tabular-nums text-slate-500 text-[12px]">{money(r.orders)}</span>
              <span className={`tabular-nums font-bold w-20 text-end ${r.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{short(r.margin)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(r.orders / max) * 100}%`, background: color, opacity: 0.8 }} />
            </div>
          </>
        );
        const href = hrefOf?.(r.name);
        return <li key={r.name}>{href ? <Go href={href} className="block rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50">{row}</Go> : <div>{row}</div>}</li>;
      })}
    </ul>
  );
}

export default function ShipmentOrdersDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const statusVocab = useOrderStatuses();
  const guard = useLatestRequest();

  const [period, setPeriod] = useState<PeriodKey>(() => {
    try { const v = localStorage.getItem(PREF_KEY) as PeriodKey; return PERIODS.some((p) => p[0] === v) ? v : 'month'; } catch { return 'month'; }
  });
  const [P, setP] = useState<Period | null>(null);
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [recent, setRecent] = useState<ShipmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [showBranch, setShowBranch] = useState(false);
  const [rankTab, setRankTab] = useState<'customers' | 'suppliers' | 'routes'>('customers');

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ period: Period; fleet: FleetSummary; recent: ShipmentOrder[] }>(
        `/api/shipment-orders/dashboard?period=${period}`);
      if (!guard.isCurrent(mine)) return;
      setP(d.period); setFleet(d.fleet); setRecent(d.recent || []);
      setUpdatedAt(new Date()); setError('');
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || 'Request failed'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [period, guard]);
  useEffect(() => { load(); }, [load]);
  // Live: section events, plus a one-minute fallback for changes made elsewhere.
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));
  useSocket('customs:opsLinks', useCallback(() => load(), [load]));
  useEffect(() => { const id = setInterval(() => load(), 60000); return () => clearInterval(id); }, [load]);

  const pick = (k: PeriodKey) => { setPeriod(k); try { localStorage.setItem(PREF_KEY, k); } catch { /* storage unavailable */ } };

  const money = useCallback((n: number) => (Number(n) || 0).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-US', { maximumFractionDigits: 0 }), [ar]);
  const short = useCallback((n: number) => {
    const v = Number(n) || 0; const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(1)}${ar ? ' م' : 'M'}`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(0)}${ar ? ' ألف' : 'k'}`;
    return money(v);
  }, [ar, money]);

  const range = P ? `from=${P.from}&to=${P.to}&dateBy=pickup` : '';
  const listHref = (extra = '') => `${LIST}?${range}${extra ? `&${extra}` : ''}`;

  const statusRows = useMemo(() => {
    const by = P?.cur.byStatus || {};
    const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(by).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([key, n]) => {
      const sv = statusVocab.find((x) => x.key === key) || null;
      return { key, n, pct: Math.round((n / total) * 1000) / 10, color: sv?.color || '#94a3b8', label: sv ? vocabLabel(sv, lang as Lang) : statusLabel(key, lang as Lang) };
    });
  }, [P, statusVocab, lang]);

  const chartData = useMemo(() => (P?.byDay || []).map((d) => ({
    ...d, label: d.day.slice(5).split('-').reverse().join('/'),
  })), [P]);

  if (!canEditOrders(user as any) && !canAccessSection(permsOf(user as any), 'Shipment Orders')) {
    return <div className="text-slate-500 p-8">{t('لا تملك صلاحية.', 'Not authorized.')}</div>;
  }
  if (loading && !P) return <Spinner />;

  // Figures on screen belong to the previous period while the new one loads.
  const switching = !!P && P.key !== period;
  const T = P?.cur.totals;
  const V = P?.prev;
  const I = P?.insights;
  const reps = P?.cur.salesRanking || [];
  const repMax = Math.max(1, ...reps.map((r) => r.live));
  const periodLabel = PERIODS.find((p) => p[0] === period)!;
  const fmtDay = (ymd?: string) => (ymd ? ymd.split('-').reverse().join('/') : '');
  const canOpen = (href: string) => canAccessPage((user as any)?.pageAccess, href.split('?')[0]);
  const series = (k: 'sell' | 'buy' | 'margin' | 'orders') => (P?.byDay || []).map((d) => d[k]);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  // Items that need someone to act, worst first. Zero counts are shown as "all clear".
  const attention = P && T ? [
    { icon: TrendingDown, label: t('بيعٌ أقل من الشراء', 'Sold below cost'), n: T.losing, tone: RED, href: '/system/shipment-orders/analytics' },
    { icon: Clock, label: t('متأخرة الآن', 'Late now'), n: P.lateNow, tone: RED, href: `${LIST}?status=late` },
    { icon: AlertTriangle, label: t('بلا سعر — خارج حساب الربح', 'No price — outside the margin'), n: T.missingPrice, tone: '#d97706', href: listHref('col_buyPrice=__blank__') },
    { icon: IdCard, label: t('بطاقات سائقين منتهية', 'Expired driver cards'), n: P.driversExpired, tone: '#d97706', href: '/system/shipment-orders/fleet' },
    { icon: Users, label: t('شحنات بلا مندوب تشغيل', 'Shipments with no ops rep'), n: P.noSalesRep, tone: '#d97706', href: listHref() },
  ].sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0)) : [];

  const rankRows: Record<typeof rankTab, { rows: Group[]; col: string; all: string }> = {
    customers: { rows: P?.cur.byCustomer || [], col: 'customerName', all: '/system/shipment-orders/customers' },
    suppliers: { rows: P?.cur.bySupplier || [], col: 'supplierName', all: '/system/shipment-orders/fleet' },
    routes: { rows: P?.cur.byRoute || [], col: '', all: '/system/shipment-orders/analytics' },
  };
  const rank = rankRows[rankTab];

  const bucketTotal = (I?.marginBuckets || []).reduce((a, b) => a + b.n, 0);
  const paymentData = (I?.byPayment || []).map((r, i) => ({
    name: PAYMENT_SUBTYPES[r.key as PaymentSubtype] ? (ar ? PAYMENT_SUBTYPES[r.key as PaymentSubtype].ar : PAYMENT_SUBTYPES[r.key as PaymentSubtype].en) : (r.key || t('غير محدد', 'Not set')),
    value: r.orders, margin: r.margin, color: PIE_COLORS[i % PIE_COLORS.length],
  }));
  const weekdayData = WEEKDAYS.map(([a, e], i) => {
    const d = (I?.byWeekday || []).find((x) => x.day === i + 1);
    return { label: ar ? a : e, orders: d?.orders || 0, margin: d?.margin || 0 };
  });
  const busiest = weekdayData.reduce((best, d) => (d.orders > best.orders ? d : best), weekdayData[0]);

  return (
    <CanOpen.Provider value={canOpen}>
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-5 h-5" />}
        title={t('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')}
        subtitle={P ? t(`${fmtDay(P.from)} — ${fmtDay(P.to)} · مقارنةً بـ ${fmtDay(P.prevFrom)} — ${fmtDay(P.prevTo)}`,
          `${P.from} — ${P.to} · vs ${P.prevFrom} — ${P.prevTo}`) : ''}>
        <Go href="/system/shipment-orders/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-bold hover:bg-[#d9601a]">
          <PackagePlus className="w-4 h-4" /> {t('شحنة جديدة', 'New shipment')}
        </Go>
        <Go href={LIST} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <PackageSearch className="w-4 h-4" /> {t('كل الشحنات', 'All shipments')}
        </Go>
      </PageHeader>

      {/* Period picker and live status */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1 gap-1 shadow-sm" role="tablist">
          {PERIODS.map(([k, a, e]) => (
            <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => pick(k)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
                period === k ? 'bg-[#12325C] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
              <span className="inline-flex items-center gap-1.5">
                {period === k && switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {t(a, e)}
              </span>
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
          {switching ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#f37121]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />{t('جارٍ تحميل الفترة…', 'Loading the period…')}
            </span>
          ) : (
            <>
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
              {t('مباشر — يتحدّث وحده', 'Live — updates itself')}
              {updatedAt ? <span className="text-slate-400">· {updatedAt.toLocaleTimeString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span> : null}
            </>
          )}
        </span>
      </div>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className={`space-y-5 transition-opacity ${switching ? 'opacity-40 pointer-events-none' : ''}`} aria-busy={switching}>
      {T && V && P && (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <HeroCard icon={Receipt} label={t('الإيرادات', 'Revenue')} value={short(T.sell)} unit={t('ر.س', 'SAR')} tone={ORANGE}
              deltaEl={<Delta ar={ar} cur={T.sell} prev={V.sell} />} spark={series('sell')}
              sub={t(`متوسط الشحنة ${money(T.avgSell)} ر.س`, `avg ${money(T.avgSell)} SAR / load`)} />
            <HeroCard icon={Wallet} label={t('التكلفة', 'Cost')} value={short(T.buy)} unit={t('ر.س', 'SAR')} tone="#475569"
              deltaEl={<Delta ar={ar} cur={T.buy} prev={V.buy} goodWhenUp={false} />} spark={series('buy')}
              sub={t('أسعار الشراء من الموردين', 'buy prices from suppliers')} />
            <HeroCard icon={PiggyBank} label={t('الربح', 'Margin')} value={short(T.margin)} unit={t('ر.س', 'SAR')} tone={T.margin >= 0 ? GREEN : RED}
              deltaEl={<Delta ar={ar} cur={T.margin} prev={V.margin} />} spark={series('margin')}
              sub={t(`هامش ${T.marginPct}% · ${money(T.avgMargin)} للشحنة`, `${T.marginPct}% · ${money(T.avgMargin)} / load`)} />
            <HeroCard icon={PackageSearch} label={t('الشحنات', 'Shipments')} value={money(T.orders)} tone={NAVY} href={listHref()}
              deltaEl={<Delta ar={ar} cur={T.orders} prev={V.orders} />} spark={series('orders')}
              sub={t(`${money(T.live)} منفَّذة · ${money(T.cancelled)} ملغاة`, `${money(T.live)} live · ${money(T.cancelled)} cancelled`)} />
          </div>

          {/* Operating ratios */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Ratio label={t('هامش الربح', 'Margin %')} value={`${T.marginPct}%`} tone={T.marginPct >= 0 ? GREEN : RED} hint={t('الربح ÷ الإيرادات', 'margin ÷ revenue')} />
            <Ratio label={t('ربح الشحنة', 'Margin per load')} value={money(T.avgMargin)} tone={T.avgMargin >= 0 ? GREEN : RED} hint={t('متوسط الشحنة المنفَّذة', 'average live load')} />
            <Ratio label={t('نسبة الإلغاء', 'Cancel rate')} value={`${T.cancelRate}%`} tone={T.cancelRate > 15 ? RED : '#475569'} href={listHref('status=cancelled')}
              hint={(P.cur.cancelReasons || [])[0] ? t(`أكثر سبب: ${P.cur.cancelReasons![0].reason}`, `top: ${P.cur.cancelReasons![0].reason}`) : t('لا إلغاء', 'none')} />
            <Ratio label={t('السلف للسائقين', 'Driver advances')} value={short(P.advances)} tone="#7c3aed" hint={t(`على ${money(P.withAdvance)} شحنة`, `on ${money(P.withAdvance)} loads`)} />
            <Ratio label={t('عملاء نشطون', 'Active customers')} value={money(T.customers)} href="/system/shipment-orders/customers" hint={t(`${money(T.routes)} مسار`, `${money(T.routes)} routes`)} />
            <Ratio label={t('مربوطة بالتخليص', 'Linked to customs')} value={money(P.customsLinked)} tone="#0e7490" href={listHref('customs=linked')} hint={t('بالبوليصة أو الحاوية', 'by B/L or container')} />
          </div>

          {/* Trend and status */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <Panel title={t(`الشحنات والربح — ${periodLabel[1]}`, `Shipments & margin — ${periodLabel[2]}`)} icon={Activity} className="xl:col-span-2">
              {chartData.length === 0 ? (
                <p className="text-sm text-slate-400 py-16 text-center">{t('لا شحنات في هذه الفترة', 'No shipments in this period')}</p>
              ) : (
                <div className="h-72" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48}
                        tickFormatter={(v) => short(v)} />
                      <Tooltip formatter={(v: any, k: any) => [k === 'margin' ? `${money(v)} ${t('ر.س', 'SAR')}` : money(v),
                        k === 'margin' ? t('الربح', 'Margin') : k === 'live' ? t('منفَّذة', 'Live') : t('ملغاة', 'Cancelled')]} />
                      <Bar yAxisId="l" dataKey="live" stackId="o" fill={NAVY} maxBarSize={28} isAnimationActive={false} />
                      <Bar yAxisId="l" dataKey="cancelled" stackId="o" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                      <Line yAxisId="r" type="monotone" dataKey="margin" stroke={ORANGE} strokeWidth={2.5} dot={chartData.length < 12} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex flex-wrap gap-4 mt-2 text-[12px] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: NAVY }} />{t('منفَّذة', 'Live')}</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-300" />{t('ملغاة', 'Cancelled')}</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: ORANGE }} />{t('الربح', 'Margin')}</span>
              </div>
            </Panel>

            <Panel title={t('أين تقف الشحنات', 'Where shipments stand')} icon={Truck}>
              {statusRows.length === 0 ? (
                <p className="text-sm text-slate-400 py-10 text-center">{t('لا شيء', 'Nothing')}</p>
              ) : (
                <>
                  <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-3">
                    {statusRows.map((s) => <div key={s.key} style={{ width: `${s.pct}%`, background: s.color }} title={`${s.label} ${s.n}`} />)}
                  </div>
                  <ul className="space-y-1">
                    {statusRows.map((s) => (
                      <li key={s.key}>
                        <Go href={listHref(`status=${encodeURIComponent(s.key)}`)}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-[13px]">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                          <span className="flex-1 min-w-0 truncate text-slate-800 font-medium">{s.label}</span>
                          <span className="tabular-nums font-bold text-slate-900">{money(s.n)}</span>
                          <span className="tabular-nums text-slate-400 text-[11px] w-12 text-end">{s.pct}%</span>
                        </Go>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          </div>

          {/* Needs attention + rankings */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <Panel title={t('يحتاج تصرّفًا', 'Needs attention')} subtitle={t('الأهمّ أولًا — اضغط لتفتح القائمة', 'most urgent first — click to open the list')} icon={AlertTriangle}>
              <ul className="space-y-1.5">
                {attention.map((a) => {
                  const Icon = a.icon;
                  const ok = !a.n;
                  return (
                    <li key={a.label}>
                      <Go href={a.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition ${ok ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm bg-white'}`}>
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: ok ? '#ecfdf5' : `${a.tone}14`, color: ok ? GREEN : a.tone }}>
                          {ok ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                        </span>
                        <span className={`flex-1 min-w-0 text-[13px] ${ok ? 'text-slate-500' : 'text-slate-800 font-semibold'}`}>{a.label}</span>
                        <span className="tabular-nums font-extrabold text-[15px]" style={{ color: ok ? '#94a3b8' : a.tone }}>{money(a.n)}</span>
                        {!ok && <Chevron className="w-4 h-4 text-slate-300" />}
                      </Go>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel className="xl:col-span-2" title={t('من يحمل العمل', 'Who carries the business')} subtitle={t('عدد الشحنات والربح في الفترة', 'shipments and margin in the period')} icon={Award}
              action={(
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[12px]">
                  {([['customers', 'العملاء', 'Customers', Users], ['suppliers', 'الموردون', 'Suppliers', Store], ['routes', 'المسارات', 'Routes', RouteIcon]] as const).map(([k, a, e, Icon]) => (
                    <button key={k} type="button" onClick={() => setRankTab(k)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold ${rankTab === k ? 'bg-white text-[#12325C] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                      <Icon className="w-3.5 h-3.5" />{t(a, e)}
                    </button>
                  ))}
                </div>
              )}>
              <Bars rows={rank.rows.slice(0, 8)} money={money} short={short} ar={ar} color={rankTab === 'routes' ? '#0e7490' : NAVY}
                hrefOf={rank.col ? (n) => listHref(`col_${rank.col}=${encodeURIComponent(n)}`) : undefined} />
              <div className="mt-3 text-end">
                <Go href={rank.all} className="text-[12px] font-semibold text-[#f37121] hover:underline">{t('عرض الكل', 'View all')}</Go>
              </div>
            </Panel>
          </div>

          {/* Operations reps */}
          <Panel title={t('أداء مناديب التشغيل', 'Operations reps performance')} icon={Award}
            subtitle={t('من «السيلز التشغيلي» المختار عند إنشاء كلّ شحنة — اضغط اسمًا لترى شحناته', 'From the operational sales chosen on each shipment — click a name to see their shipments')}
            action={P.noSalesRep > 0 ? (
              <span className="text-[11.5px] text-amber-700 font-semibold">{t(`${money(P.noSalesRep)} شحنة بلا مندوب`, `${money(P.noSalesRep)} with no rep`)}</span>
            ) : null}>
            {reps.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">{t('لا شحنات مسجَّلٌ عليها مندوب في هذه الفترة', 'No shipments with a rep in this period')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-slate-500 text-[12px] border-b border-slate-100">
                      <th className="text-start font-semibold py-2 w-8">#</th>
                      <th className="text-start font-semibold py-2">{t('المندوب', 'Rep')}</th>
                      <th className="text-start font-semibold py-2 min-w-[180px]">{t('المنفَّذة', 'Executed')}</th>
                      <th className="text-end font-semibold py-2">{t('ملغاة', 'Cancelled')}</th>
                      <th className="text-end font-semibold py-2">{t('الإيرادات', 'Revenue')}</th>
                      <th className="text-end font-semibold py-2">{t('الربح', 'Margin')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reps.map((r) => (
                      <tr key={r.name} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2">
                          <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[11px] font-bold ${
                            r.rank === 1 ? 'bg-amber-100 text-amber-700' : r.rank <= 3 ? 'bg-slate-100 text-slate-700' : 'text-slate-400'}`}>{r.rank}</span>
                        </td>
                        <td className="py-2">
                          <Go href={listHref(`col_salesRepName=${encodeURIComponent(r.name)}`)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Go>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(r.live / repMax) * 100}%`, background: ORANGE }} />
                            </div>
                            <span className="tabular-nums font-bold text-slate-900 w-10 text-end">{money(r.live)}</span>
                          </div>
                        </td>
                        <td className="py-2 text-end tabular-nums text-slate-600">{money(r.cancelled)}<span className="text-[11px] text-slate-400"> ({r.cancelRate}%)</span></td>
                        <td className="py-2 text-end tabular-nums text-slate-700">{money(r.sell)}</td>
                        <td className={`py-2 text-end tabular-nums font-semibold ${r.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Shipment analytics */}
          {I && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <BarChart3 className="w-5 h-5 text-[#12325C]" />
                <h2 className="text-[17px] font-extrabold text-slate-900">{t('تحليلات الشحنات', 'Shipment analytics')}</h2>
                <span className="text-[12px] text-slate-500">— {t(periodLabel[1], periodLabel[2])}</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                <Panel title={t('توزيع هامش الربح', 'Margin distribution')} subtitle={t('كم شحنة في كل شريحة ربح', 'how many loads fall in each margin band')} icon={Layers}>
                  {bucketTotal === 0 ? <p className="text-xs text-slate-400 py-8 text-center">{t('لا شحنات مسعَّرة', 'no priced loads')}</p> : (
                    <>
                      <div className="flex h-4 rounded-full overflow-hidden bg-slate-100 mb-4">
                        {I.marginBuckets.map((b) => (
                          <div key={b.key} style={{ width: `${(b.n / bucketTotal) * 100}%`, background: MARGIN_BUCKETS[b.key]?.[2] || '#94a3b8' }} title={`${b.key}: ${b.n}`} />
                        ))}
                      </div>
                      <ul className="space-y-1.5 text-[13px]">
                        {Object.entries(MARGIN_BUCKETS).map(([k, [a, e, c]]) => {
                          const n = I.marginBuckets.find((b) => b.key === k)?.n || 0;
                          return (
                            <li key={k} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
                              <span className="flex-1 text-slate-700">{t(a, e)}</span>
                              <span className="tabular-nums font-bold text-slate-900">{money(n)}</span>
                              <span className="tabular-nums text-[11px] text-slate-400 w-12 text-end">{Math.round((n / bucketTotal) * 100)}%</span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </Panel>

                <Panel title={t('نوع الدفع', 'Payment type')} subtitle={t('الشحنات المنفَّذة حسب طريقة التحصيل', 'live loads by how they are collected')} icon={CreditCard}>
                  {paymentData.length === 0 ? <p className="text-xs text-slate-400 py-8 text-center">{t('لا بيانات', 'no data')}</p> : (
                    <div className="flex items-center gap-4">
                      <div className="w-32 h-32 shrink-0" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={paymentData} dataKey="value" innerRadius={38} outerRadius={60} paddingAngle={2} isAnimationActive={false}>
                              {paymentData.map((d) => <Cell key={d.name} fill={d.color} />)}
                            </Pie>
                            <Tooltip formatter={(v: any, _k: any, p: any) => [money(v), p?.payload?.name]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="flex-1 min-w-0 space-y-1.5 text-[13px]">
                        {paymentData.map((d) => (
                          <li key={d.name} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                            <span className="flex-1 min-w-0 truncate text-slate-700">{d.name}</span>
                            <span className="tabular-nums font-bold text-slate-900">{money(d.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Panel>

                <Panel title={t('تركّز العملاء', 'Customer concentration')} subtitle={t('حصة أكبر 5 عملاء من الإيرادات', 'share of revenue from the top 5 customers')} icon={Target}>
                  {I.concentration.top5Share == null ? <p className="text-xs text-slate-400 py-8 text-center">{t('لا إيرادات', 'no revenue')}</p> : (
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[34px] font-extrabold tabular-nums leading-none" style={{ color: I.concentration.top5Share > 60 ? '#d97706' : NAVY }}>{Math.round(I.concentration.top5Share)}%</span>
                        <span className="text-[12px] text-slate-500">{t(`من ${money(I.concentration.customers)} عميل`, `of ${money(I.concentration.customers)} customers`)}</span>
                      </div>
                      <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, I.concentration.top5Share)}%`, background: I.concentration.top5Share > 60 ? '#d97706' : NAVY }} />
                      </div>
                      <p className="mt-3 text-[12px] text-slate-500 leading-relaxed">
                        {I.concentration.top5Share > 60
                          ? t('الإيرادات معتمدة على عدد قليل من العملاء — خسارة عميل واحد تؤثر بقوة.', 'Revenue depends on a few customers — losing one would hurt.')
                          : t('الإيرادات موزّعة على قاعدة عملاء جيدة.', 'Revenue is well spread across customers.')}
                      </p>
                    </div>
                  )}
                </Panel>

                <Panel title={t('أيام الأسبوع', 'Days of the week')}
                  subtitle={busiest && busiest.orders ? t(`الأكثر حركة: ${busiest.label}`, `busiest: ${busiest.label}`) : t('توزيع الشحنات على الأيام', 'loads by weekday')} icon={CalendarDays}>
                  <div className="h-40" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weekdayData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#64748b' }} tickLine={false} axisLine={false} interval={0} />
                        <YAxis tick={{ fontSize: 10.5, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip formatter={(v: any) => [money(v), t('شحنات', 'Loads')]} />
                        <Bar dataKey="orders" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                          {weekdayData.map((d) => <Cell key={d.label} fill={d === busiest && d.orders ? ORANGE : NAVY} fillOpacity={d === busiest && d.orders ? 1 : 0.75} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel title={t('مدة الرحلة', 'Trip duration')} subtitle={t('من التحميل إلى الوصول', 'from pickup to arrival')} icon={Timer}>
                  {!I.duration.trips ? <p className="text-xs text-slate-400 py-8 text-center">{t('لا رحلات مكتملة التواريخ', 'no trips with both dates')}</p> : (
                    <>
                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="text-[30px] font-extrabold tabular-nums leading-none text-[#12325C]">
                          {I.duration.avgHours != null && I.duration.avgHours >= 48 ? (I.duration.avgHours / 24).toFixed(1) : Math.round(I.duration.avgHours || 0)}
                        </span>
                        <span className="text-[12px] font-semibold text-slate-500">
                          {I.duration.avgHours != null && I.duration.avgHours >= 48 ? t('يوم في المتوسط', 'days on average') : t('ساعة في المتوسط', 'hours on average')}
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-[13px]">
                        {I.duration.buckets.map((b) => (
                          <li key={b.key} className="flex items-center gap-2">
                            <span className="w-14 text-slate-600 tabular-nums" dir="ltr">{b.key}</span>
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-[#0e7490]" style={{ width: `${(b.n / I.duration.trips) * 100}%` }} />
                            </div>
                            <span className="tabular-nums font-bold text-slate-900 w-10 text-end">{money(b.n)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[11px] text-slate-400">{t(`من ${money(I.duration.trips)} رحلة لها تاريخ تحميل ووصول`, `from ${money(I.duration.trips)} trips with both dates`)}</p>
                    </>
                  )}
                </Panel>

                <Panel title={t('أنواع الشاحنات', 'Truck types')} subtitle={t('الشحنات والربح لكل نوع', 'loads and margin by type')} icon={Truck}>
                  <Bars rows={I.byTruckType.map((r) => ({ name: r.key || t('غير محدد', 'Not set'), orders: r.orders, margin: r.margin }))}
                    money={money} short={short} ar={ar} color="#7c3aed" />
                </Panel>

                <Panel className="lg:col-span-2 xl:col-span-3" title={t('الفروع', 'Branches')} subtitle={t('الشحنات والإيرادات والربح لكل فرع', 'loads, revenue and margin per branch')} icon={Building2}>
                  {I.byBranch.length === 0 ? <p className="text-xs text-slate-400 py-6 text-center">{t('لا بيانات', 'no data')}</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="text-slate-500 text-[12px] border-b border-slate-100">
                            <th className="text-start font-semibold py-2">{t('الفرع', 'Branch')}</th>
                            <th className="text-start font-semibold py-2 min-w-[160px]">{t('الشحنات', 'Loads')}</th>
                            <th className="text-end font-semibold py-2">{t('الإيرادات', 'Revenue')}</th>
                            <th className="text-end font-semibold py-2">{t('الربح', 'Margin')}</th>
                            <th className="text-end font-semibold py-2">{t('الهامش', 'Margin %')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {I.byBranch.map((b) => {
                            const max = Math.max(1, ...I.byBranch.map((x) => x.orders));
                            const pct = b.sell > 0 ? Math.round((b.margin / b.sell) * 1000) / 10 : null;
                            return (
                              <tr key={b.key || '—'} className="border-b border-slate-50 hover:bg-slate-50">
                                <td className="py-2 font-semibold text-slate-800">{b.key || t('غير محدد', 'Not set')}</td>
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#12325C]/75" style={{ width: `${(b.orders / max) * 100}%` }} /></div>
                                    <span className="tabular-nums font-bold w-10 text-end">{money(b.orders)}</span>
                                  </div>
                                </td>
                                <td className="py-2 text-end tabular-nums text-slate-700">{money(b.sell)}</td>
                                <td className={`py-2 text-end tabular-nums font-semibold ${b.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(b.margin)}</td>
                                <td className="py-2 text-end tabular-nums text-slate-600">{pct == null ? '—' : `${pct}%`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>
            </>
          )}

          {/* Register and sources */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Ratio label={t('الموردون', 'Suppliers')} value={money(fleet?.suppliers ?? 0)} href="/system/shipment-orders/fleet" />
            <Ratio label={t('شاحنات في السجل', 'Trucks on file')} value={money(fleet?.vehicles ?? 0)} href="/system/shipment-orders/fleet"
              hint={fleet?.gaps?.unknown ? t(`${money(fleet.gaps.unknown)} مجهولة المالك`, `${money(fleet.gaps.unknown)} owner unknown`) : undefined} />
            <Ratio label={t('السوّاق', 'Drivers')} value={money(fleet?.drivers ?? 0)} href="/system/shipment-orders/fleet" />
            <Ratio label={t('الخاص بنا / المنصّة', 'Ours / platform')} value={`${money(P.ours)} / ${money(P.platform)}`} href={listHref('source=system')} />
            <Ratio label={t('ملاحظات المتابعة', 'Follow-up notes')} value={money(P.followUpNotes)} tone="#0369a1" href={LIST}
              hint={t(`على ${money(P.followUpShipments)} شحنة`, `on ${money(P.followUpShipments)} loads`)} />
            <Ratio label={t('عملاء في الفترة', 'Customers served')} value={money(T.customers)} href="/system/shipment-orders/customers" />
          </div>
        </>
      )}

      {/* Latest shipments */}
      <Panel title={t('آخر الشحنات', 'Latest shipments')} icon={TrendingUp}
        action={<Go href={LIST} className="text-[12px] text-[#f37121] hover:underline">{t('كل الشحنات', 'all')}</Go>}>
        <ul className="divide-y divide-slate-100 -my-2">
          {recent.length === 0 && <li className="py-8 text-center text-slate-400 text-sm">{t('لا شحنات بعد', 'nothing yet')}</li>}
          {recent.map((o) => {
            const sv = statusVocab.find((x) => x.key === o.status) || null;
            return (
              <li key={o._id}>
                <Go href={`${LIST}?q=${encodeURIComponent(String((o as any).reference || o.waybillNumber || ''))}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-slate-50 rounded-lg px-1">
                  <span className="font-mono font-bold text-[#12325C] text-sm">{(o as any).reference || o.waybillNumber}</span>
                  <span className="text-[13px] text-slate-800 flex-1 min-w-0 truncate">{o.customerName || '—'}</span>
                  <span className="text-xs text-slate-600 whitespace-nowrap">{o.fromCity || '—'} ← <b>{o.toCity || '—'}</b></span>
                  {(o as any).salesRepName ? <span className="text-[11.5px] text-slate-500">{(o as any).salesRepName}</span> : null}
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{ background: `${sv?.color || '#94a3b8'}1f`, color: sv?.color || '#475569' }}>
                    {sv ? vocabLabel(sv, lang as Lang) : statusLabel(o.status, lang as Lang)}
                  </span>
                </Go>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* Branch report analysis (from the branch sheet, opened on demand) */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setShowBranch((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-start">
          <Activity className="w-4 h-4 text-slate-500" />
          <span className="font-bold text-slate-900 text-[14px]">{t('تحليل تقرير الفروع', 'Branch report analysis')}</span>
          <span className="text-[12px] text-slate-500">{t('— من شيت الفروع، لا من الشحنات أعلاه', '— from the branch sheet, not the shipments above')}</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 ms-auto transition-transform ${showBranch ? 'rotate-180' : ''}`} />
        </button>
        {showBranch && (
          <div className="p-4 pt-0">
            <OpsAnalytics base="/api/shipment-orders/ops-analytics" liveEvent="shipmentOrders:changed" />
          </div>
        )}
      </section>
      </div>
    </div>
    </CanOpen.Provider>
  );
}
