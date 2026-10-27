'use client';
/**
 * لوحة طلبات الشحنات — أوّلُ صفحةِ القسم.
 *
 * ── أُعيد بناؤها (٢٠٢٦/١٠/٢٧) ────────────────────────────────────────────────
 * صاحبُ الشركة: «كارداتها محتاجة تتعدّل والديزاين يكون بروفيشنال أكتر،
 * أوتوماتيك وداينميك، ومربوطة بالكامل مع كلّ حاجة في الشركة»، و«أداء مناديب
 * التشغيل مربوط بوقت إنشاء الشحنة — بالدروب ليست بتاعة مندوب التشغيل».
 *
 *   • فترةٌ يختارها الناظر (اليوم، ٧ أيّام، الشهر، ٣٠ يومًا، السنة)، وكلُّ رقمٍ
 *     يُقارَن بالفترة السابقة بطولها — سهمٌ وصعودٌ أو هبوط.
 *   • تتحدّث وحدَها: مع كلّ شحنةٍ تُنشأ أو تُعدَّل (المقبس)، وكلَّ دقيقةٍ احتياطًا.
 *   • أداءُ مناديب التشغيل من الشحنات نفسِها — «السيلز التشغيلي» المختارُ عند
 *     الإنشاء (`salesRanking`) — لا من شيت الفروع.
 *   • وكلُّ رقمٍ يفتح صفوفَه: الجدولُ بفلتره في العنوان (الحالة، المندوب،
 *     العميل، المورّد، المدى بيوم الاستلام)، ومعاملاتُ التخليص، والسوّاق.
 *   • وتحليلُ «تقرير الفروع» (شيت مدير التشغيل) باقٍ في آخرها، مُعنوَنًا بمصدره
 *     كي لا يُخلَط رقمُه برقم الشحنات.
 */
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import OpsAnalytics from '@/components/ops/OpsAnalytics';
import { statusLabel, vocabLabel, canEditOrders, type ShipmentOrder, type Lang } from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { canAccessSection, canAccessPage, permsOf } from '@/lib/sections';
import {
  LayoutDashboard, PackagePlus, PackageSearch, Truck, Users, Store, TrendingUp, TrendingDown,
  AlertTriangle, ArrowUpRight, ArrowDownRight, Minus, Wallet, Receipt, PiggyBank, Percent, Ban,
  Loader2, Ship, MessageSquareText, IdCard, Clock, ChevronDown, Activity, Award, Route as RouteIcon,
} from 'lucide-react';

type Group = { name: string; orders: number; sell: number; margin: number; marginPct?: number | null };
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
interface Period {
  key: PeriodKey; from: string; to: string; prevFrom: string; prevTo: string; days: number;
  cur: Analytics;
  prev: { orders: number; live: number; cancelled: number; sell: number; buy: number; margin: number };
  byDay: { day: string; orders: number; live: number; cancelled: number; sell: number; buy: number; margin: number }[];
  advances: number; withAdvance: number; customsLinked: number; platform: number; ours: number; noSalesRep: number;
  followUpNotes: number; followUpShipments: number; lateNow: number; driversExpired: number;
}
interface FleetSummary { vehicles: number; suppliers: number; drivers: number; gaps?: { unknown: number } }
type PeriodKey = 'today' | '7d' | 'month' | '30d' | 'year';

const PERIODS: [PeriodKey, string, string][] = [
  ['today', 'اليوم', 'Today'], ['7d', '٧ أيام', '7 days'], ['month', 'هذا الشهر', 'This month'],
  ['30d', '٣٠ يومًا', '30 days'], ['year', 'هذه السنة', 'This year'],
];
const PREF_KEY = 'so-dash-period';
const ORANGE = '#f37121';
const NAVY = '#12325C';
const LIST = '/system/shipment-orders';

/** التغيُّرُ عن الفترة السابقة — نسبةً، أو «جديد» حين لا شيءَ قبلَه. */
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

// ── لا رابطَ إلى ما لا يُفتَح (٢٠٢٦/١٠/٢٧) ──────────────────────────────────
// «لو اليوزر ملهوش أكسيس على قسم تاني هيفتحها إزاي؟». فكلُّ رابطٍ في اللوحة
// يُسأل عنه: أيفتح المستخدمُ هذه الصفحة؟ (خريطةُ صفحاته من /auth/me). وما لا
// يُفتَح يبقى رقمًا يُقرأ لا رابطًا يقود إلى «لا تملك صلاحية». والروابطُ كلُّها
// داخل القسم نفسِه — ما كان يقود إلى التخليص صار يفتح الشحناتِ المربوطةَ هنا.
const CanOpen = createContext<(href: string) => boolean>(() => true);

function Go({ href, className, children, title }: { href?: string; className?: string; children: React.ReactNode; title?: string }) {
  const can = useContext(CanOpen);
  return href && can(href)
    ? <Link href={href} className={className} title={title}>{children}</Link>
    : <span className={className} title={title}>{children}</span>;
}

function Kpi({ icon: Icon, label, value, sub, href, tone = NAVY, deltaEl }: {
  icon: any; label: string; value: string; sub?: React.ReactNode; href?: string; tone?: string; deltaEl?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tone}14`, color: tone }}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <p className="text-[13px] font-semibold text-slate-600 leading-tight flex-1 min-w-0">{label}</p>
        {deltaEl}
      </div>
      <p className="mt-3 text-[26px] leading-none font-extrabold tabular-nums tracking-tight" style={{ color: tone }}>{value}</p>
      {sub ? <p className="mt-2 text-[12px] text-slate-500 leading-snug">{sub}</p> : null}
    </>
  );
  const cls = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  const can = useContext(CanOpen);
  return href && can(href)
    ? <Link href={href} className={`${cls} block transition hover:border-[#f37121]/60 hover:shadow-md`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

function Panel({ title, icon: Icon, action, children, className = '' }: {
  title: string; icon: any; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <Icon className="w-4 h-4 text-[#f37121]" />
        <h3 className="font-bold text-slate-900 text-[14px]">{title}</h3>
        <div className="ms-auto">{action}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
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
  // تتحدّث وحدَها: مع كلّ تغييرٍ في القسم، وكلَّ دقيقةٍ احتياطًا (ما يتغيّر في
  // التخليص أو السجلّ لا يبثّ على قناة القسم دائمًا).
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));
  useSocket('customs:opsLinks', useCallback(() => load(), [load]));
  useEffect(() => { const id = setInterval(() => load(), 60000); return () => clearInterval(id); }, [load]);

  const pick = (k: PeriodKey) => { setPeriod(k); try { localStorage.setItem(PREF_KEY, k); } catch { /* */ } };

  const money = useCallback((n: number) => (Number(n) || 0).toLocaleString(ar ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }), [ar]);
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

  // البياناتُ على الشاشة لفترةٍ غيرِ المختارة = الفترةُ الجديدةُ في الطريق.
  const switching = !!P && P.key !== period;
  const T = P?.cur.totals;
  const V = P?.prev;
  const reps = P?.cur.salesRanking || [];
  const repMax = Math.max(1, ...reps.map((r) => r.live));
  const periodLabel = PERIODS.find((p) => p[0] === period)!;
  const fmtDay = (ymd?: string) => (ymd ? ymd.split('-').reverse().join('/') : '');

  const canOpen = (href: string) => canAccessPage((user as any)?.pageAccess, href.split('?')[0]);
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

      {/* ── الفترةُ وحالُ التحديث ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-1" role="tablist">
          {PERIODS.map(([k, a, e]) => (
            <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => pick(k)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
                period === k ? 'bg-white text-[#12325C] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
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
          {updatedAt ? <span className="text-slate-400">· {updatedAt.toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span> : null}
            </>
          )}
        </span>
      </div>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* الأرقامُ المعروضةُ لفترةٍ غيرِ المختارة تُعتَّم حتى تصل فترتُها —
          فلا يُقرأ رقمُ الشهر على أنّه رقمُ اليوم (٢٠٢٦/١٠/٢٧). */}
      <div className={`space-y-5 transition-opacity ${switching ? 'opacity-40 pointer-events-none' : ''}`} aria-busy={switching}>
      {T && V && (
        <>
          {/* ── الأرقامُ الستّة — وكلٌّ بسهمه عن الفترة السابقة ───────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={PackageSearch} label={t('الشحنات', 'Shipments')} value={money(T.orders)} tone={NAVY}
              href={listHref()} deltaEl={<Delta ar={ar} cur={T.orders} prev={V.orders} />}
              sub={t(`${money(T.live)} منفَّذة · ${money(T.cancelled)} ملغاة`, `${money(T.live)} live · ${money(T.cancelled)} cancelled`)} />
            <Kpi icon={Receipt} label={t('الإيرادات', 'Revenue')} value={short(T.sell)} tone={ORANGE}
              deltaEl={<Delta ar={ar} cur={T.sell} prev={V.sell} />} sub={t(`متوسط الشحنة ${money(T.avgSell)} ر.س`, `avg ${money(T.avgSell)} SAR / load`)} />
            <Kpi icon={Wallet} label={t('التكلفة', 'Cost')} value={short(T.buy)} tone="#475569"
              deltaEl={<Delta ar={ar} cur={T.buy} prev={V.buy} goodWhenUp={false} />} sub={t('أسعار الشراء من الموردين', 'buy prices from suppliers')} />
            <Kpi icon={PiggyBank} label={t('الربح', 'Margin')} value={short(T.margin)} tone={T.margin >= 0 ? '#059669' : '#dc2626'}
              deltaEl={<Delta ar={ar} cur={T.margin} prev={V.margin} />}
              sub={t(`هامش ${T.marginPct}% · ${money(T.avgMargin)} للشحنة`, `${T.marginPct}% · ${money(T.avgMargin)} / load`)} />
            <Kpi icon={Ban} label={t('نسبة الإلغاء', 'Cancel rate')} value={`${T.cancelRate}%`} tone={T.cancelRate > 15 ? '#dc2626' : '#475569'}
              href={listHref('status=cancelled')}
              deltaEl={<Delta ar={ar} cur={T.cancelled} prev={V.cancelled} goodWhenUp={false} />}
              sub={(P?.cur.cancelReasons || [])[0] ? t(`أكثر سبب: ${P!.cur.cancelReasons![0].reason}`, `top reason: ${P!.cur.cancelReasons![0].reason}`) : t('لا إلغاء', 'none')} />
            <Kpi icon={Percent} label={t('السلف للسائقين', 'Driver advances')} value={short(P!.advances)} tone="#7c3aed"
              sub={t(`على ${money(P!.withAdvance)} شحنة`, `on ${money(P!.withAdvance)} loads`)} />
          </div>

          {/* ── الاتّجاهُ يومًا بيوم: الشحناتُ أعمدةً والربحُ خطًّا ─────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <Panel title={t(`الشحنات والربح — ${periodLabel[1]}`, `Shipments & margin — ${periodLabel[2]}`)} icon={Activity} className="xl:col-span-2">
              {chartData.length === 0 ? (
                <p className="text-sm text-slate-400 py-16 text-center">{t('لا شحنات في هذه الفترة', 'No shipments in this period')}</p>
              ) : (
                <div className="h-64" dir="ltr">
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

            {/* ── أين تقف الشحنات — شريطٌ واحدٌ وأسطرٌ تُفتَح ───────────────── */}
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

          {/* ── أداءُ مناديب التشغيل — من «السيلز التشغيلي» عند إنشاء الشحنة ────── */}
          <Panel title={t('أداء مناديب التشغيل', 'Operations reps performance')} icon={Award}
            action={P!.noSalesRep > 0 ? (
              <span className="text-[11.5px] text-amber-700 font-semibold">{t(`${money(P!.noSalesRep)} شحنة بلا مندوب`, `${money(P!.noSalesRep)} with no rep`)}</span>
            ) : null}>
            <p className="text-[12px] text-slate-500 -mt-1 mb-3">
              {t('من «السيلز التشغيلي — من جاء بهذه الحمولة» المختار عند إنشاء كلّ شحنة. اضغط اسمًا لترى شحناته.',
                'From the «operational sales» chosen when each shipment is created. Click a name to see their shipments.')}
            </p>
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

          {/* ── من يحمل العمل: العملاء والموردون والمسارات ─────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {([
              [t('أكبر العملاء', 'Top customers'), Users, P!.cur.byCustomer, 'customerName', '/system/shipment-orders/customers'],
              [t('أكبر الموردين', 'Top suppliers'), Store, P!.cur.bySupplier, 'supplierName', '/system/shipment-orders/fleet'],
              [t('أكثر المسارات', 'Top routes'), RouteIcon, P!.cur.byRoute, '', '/system/shipment-orders/analytics'],
            ] as [string, any, Group[], string, string][]).map(([title, Icon, rows, col, href]) => {
              const max = Math.max(1, ...rows.slice(0, 6).map((r) => r.orders));
              return (
                <Panel key={title} title={title} icon={Icon}
                  action={<Go href={href} className="text-[12px] text-[#f37121] hover:underline">{t('الكل', 'all')}</Go>}>
                  {rows.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">{t('لا بيانات في الفترة', 'nothing in this period')}</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {rows.slice(0, 6).map((r) => {
                        const row = (
                          <>
                            <div className="flex items-center gap-2 text-[13px]">
                              <span className="flex-1 min-w-0 truncate text-slate-800 font-medium" title={r.name}>{r.name}</span>
                              <span className="tabular-nums text-slate-500 text-[12px]">{money(r.orders)}</span>
                              <span className={`tabular-nums font-bold w-20 text-end ${r.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{short(r.margin)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden">
                              <div className="h-full rounded-full bg-[#12325C]/70" style={{ width: `${(r.orders / max) * 100}%` }} />
                            </div>
                          </>
                        );
                        return (
                          <li key={r.name}>
                            {col
                              ? <Go href={listHref(`col_${col}=${encodeURIComponent(r.name)}`)} className="block rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50">{row}</Go>
                              : <div>{row}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              );
            })}
          </div>

          {/* ── مربوطةٌ بالشركة: ما يحتاج تصرّفًا وما يمرّ بأقسامٍ أخرى ─────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={TrendingDown} label={t('بيعٌ أقل من الشراء', 'Sold below cost')} value={money(T.losing)}
              tone={T.losing ? '#dc2626' : '#64748b'} href="/system/shipment-orders/analytics" sub={t('تُراجَع في التحليلات', 'review in analytics')} />
            <Kpi icon={AlertTriangle} label={t('بلا سعر', 'No price')} value={money(T.missingPrice)}
              tone={T.missingPrice ? '#d97706' : '#64748b'} href={listHref('col_buyPrice=__blank__')} sub={t('خارج حساب الربح', 'out of the margin')} />
            <Kpi icon={Clock} label={t('متأخرة الآن', 'Late now')} value={money(P!.lateNow)}
              tone={P!.lateNow ? '#dc2626' : '#64748b'} href={`${LIST}?status=late`} sub={t('حالة «متأخرة» الآن', 'status «late» now')} />
            <Kpi icon={Ship} label={t('مربوطة بالتخليص', 'Linked to customs')} value={money(P!.customsLinked)}
              tone="#0e7490" href={listHref('customs=linked')} sub={t('بالبوليصة أو الحاوية — تُفتح هنا', 'by B/L or container')} />
            <Kpi icon={MessageSquareText} label={t('ملاحظات المتابعة', 'Follow-up notes')} value={money(P!.followUpNotes)}
              tone="#0369a1" href={LIST} sub={t(`على ${money(P!.followUpShipments)} شحنة`, `on ${money(P!.followUpShipments)} loads`)} />
            <Kpi icon={IdCard} label={t('بطاقات سائقين منتهية', 'Expired driver cards')} value={money(P!.driversExpired)}
              tone={P!.driversExpired ? '#d97706' : '#64748b'} href="/system/shipment-orders/fleet" sub={t('في سجلّ السوّاق', 'in the drivers register')} />
          </div>

          {/* ── السجلُّ والمصدر ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi icon={Store} label={t('الموردون', 'Suppliers')} value={money(fleet?.suppliers ?? 0)} href="/system/shipment-orders/fleet" />
            <Kpi icon={Truck} label={t('شاحنات في السجل', 'Trucks on file')} value={money(fleet?.vehicles ?? 0)} href="/system/shipment-orders/fleet"
              sub={fleet?.gaps?.unknown ? t(`${money(fleet.gaps.unknown)} مجهولة المالك`, `${money(fleet.gaps.unknown)} owner unknown`) : undefined} />
            <Kpi icon={Users} label={t('السوّاق', 'Drivers')} value={money(fleet?.drivers ?? 0)} href="/system/shipment-orders/fleet" />
            <Kpi icon={Users} label={t('عملاء نشطون', 'Active customers')} value={money(T.customers)} href="/system/shipment-orders/customers"
              sub={t(`${money(T.routes)} مسار`, `${money(T.routes)} routes`)} />
            <Kpi icon={PackageSearch} label={t('الخاص بنا / المنصّة', 'Ours / platform')} value={`${money(P!.ours)} / ${money(P!.platform)}`}
              href={listHref('source=system')} sub={t('مصدر الشحنات في الفترة', 'source of the period\'s loads')} />
          </div>
        </>
      )}

      {/* ── آخرُ ما سُجِّل ──────────────────────────────────────────────────── */}
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

      {/* ── تحليلُ تقرير الفروع (شيت مدير التشغيل) — مصدرٌ آخر، يُفتَح عند الطلب ── */}
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
