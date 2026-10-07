'use client';
/**
 * لوحةُ مدير التشغيل — كما بناها لنفسه، وبأرقامنا حيّةً.
 *
 * ── من أين جاء هذا الترتيبُ بعينه ──────────────────────────────────────────
 * مديرُ التشغيل عمل لنفسه لوحةً في إكسل (ورقةُ `Dashboard` في تقرير الفروع)
 * وعمل بها شهورًا، فهذه ليست تخميننا لما يحتاجه: هي ما يفتحه كلَّ صباح،
 * بعنوانه وترتيبه. والحسابُ كلُّه في الخادم
 * (`backend/utils/opsAnalytics.js`) — فالشاشةُ تعرض ولا تحسب، ولا يختلف رقمٌ
 * بين «التشغيل — خاصّ» ولوحةِ طلبات الشحنات ولا بين الويب والهاتف.
 *
 * ── وما قيس عليه ───────────────────────────────────────────────────────────
 * طُوبقت أرقامُ سبتمبر بورقته صفًّا صفًّا: المبيعاتُ ٥٫٢ مليون، والهامشُ
 * ١٢٫٢٪، والرحلاتُ ٣٫٥ آلاف منها ٢٠٠١ محقَّقة (٥٧٪)، وأعلى مندوب «علاء عادل
 * ٢٠٩ · ١٠٫٤٪»، وأعلى عميل «صليهم ٢٨٢ · ١٤٫١٪»، وأعلى مورد «تنشيط ٦٦٠ ·
 * ٤٥٫٦٪»، وجدة «٨٨٦ · ٤٤٫٣٪». فمن انتقل من ورقته إلى هذه الشاشة يجد أرقامَه.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  TrendingUp, Wallet, ShoppingCart, Percent, Truck, CheckCircle2, XCircle, CalendarDays,
  Target, AlertTriangle, Building2, UserCheck, Users, Package, SlidersHorizontal, RefreshCw, X,
} from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';

interface Node { name: string; trips: number; achieved: number; failed: number; sell: number; buy: number; gp: number; tripShare: number; sellShare: number; margin: number }
interface Peak { highest: Node | null; lowest: Node | null }
export interface OpsAnalyticsData {
  period: { from: string; to: string; days: number };
  periodMeta?: { period: string; month?: string; quarter?: number; year?: number };
  totals: {
    trips: number; achieved: number; failed: number; sell: number; buy: number; gp: number;
    marginPct: number; achievedPct: number; failedPct: number;
    avgRevenuePerDay: number; avgTripsPerDay: number; days: number; rows: number;
  };
  targets: {
    annualTrips: number; annualRevenue: number; periodTrips: number; periodRevenue: number;
    ytdTrips: number; ytdRevenue: number; tripsGap: number; revenueGap: number;
    tripsAchievementPct: number; revenueAchievementPct: number;
    annualTripsPct: number; annualRevenuePct: number; remainingTrips: number; remainingRevenue: number;
  };
  reasons: { name: string; failed: number; share: number }[];
  mainReason: { name: string; failed: number; share: number } | null;
  monthly: { month: string; trips: number; achieved: number; sell: number; buy: number; gp: number; margin: number; partial: boolean }[];
  monthPeak: { bestSell: any; worstSell: any; bestTrips: any; worstTrips: any };
  branches: { list: Node[]; byRevenue: Peak; byTrips: Peak };
  opsReps: { list: Node[]; byTrips: Peak; fleetExcluded?: string };
  salesReps: { list: Node[]; byRevenue: Peak };
  clients: { top: Node[]; count: number; byTrips: Peak; base: number };
  vendors: { top: Node[]; count: number; byTrips: Peak; base: number };
  routes: Node[];
  shares: { rentType: any[]; payType: any[]; vendorType: any[] };
  source?: { kind: string; file: string; importedAt: string | null; rows: number };
}

const ORANGE = '#f37121';
const NAVY = '#12325c';

const nf = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-US');
/** مبلغٌ مختصر: ٥٫٢ مليون لا ٥٢٣٤١٢٠ — البطاقةُ تُقرأ بلمحة. */
const short = (n: number) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

function Kpi({ icon, label, value, sub, tone = NAVY }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm" style={{ borderTopWidth: 3, borderTopColor: tone }}>
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
        <span style={{ color: tone }}>{icon}</span>{label}
      </div>
      <p className="text-[21px] leading-tight font-extrabold tabular-nums text-slate-900 mt-1">{value}</p>
      {sub ? <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p> : null}
    </div>
  );
}

/** شريطٌ بنسبةٍ — يُقرأ قبل الرقم. */
function Bar2({ pct, tone = ORANGE }: { pct: number; tone?: string }) {
  return (
    <span className="block h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <span className="block h-full rounded-full transition-all" style={{ width: `${Math.max(1, Math.min(100, pct))}%`, background: tone }} />
    </span>
  );
}

function Panel({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
        {right ? <span className="ms-auto">{right}</span> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** صفٌّ في قائمةٍ مرتَّبة: اسمٌ وشريطٌ ورقمٌ ونسبة. */
function RankRow({ i, name, value, share, extra, tone = ORANGE }: {
  i: number; name: string; value: string; share: number; extra?: string; tone?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-6 text-[10.5px] text-slate-400 tabular-nums shrink-0">#{i + 1}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] text-slate-800 truncate" title={name}>{name}</span>
        <Bar2 pct={share} tone={tone} />
      </span>
      <span className="text-[12px] font-bold tabular-nums text-slate-900 shrink-0">{value}</span>
      <span className="w-12 text-[11px] text-slate-500 tabular-nums text-end shrink-0">{share}%</span>
      {extra ? <span className="w-20 text-[11px] text-slate-400 tabular-nums text-end shrink-0">{extra}</span> : null}
    </div>
  );
}

export default function OpsAnalytics({ base, liveEvent }: { base: string; liveEvent?: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [d, setD] = useState<OpsAnalyticsData | null>(null);
  const [opts, setOpts] = useState<any>({ branch: [], rentType: [], payType: [], vendorType: [], opsRep: [], months: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState<Record<string, string>>({ period: 'month' });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '') as [string, string][]);
      const data = await api.get<OpsAnalyticsData>(`${base}?${p}`);
      setD(data);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, JSON.stringify(q)]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<any>(`${base}/filters`).then(setOpts).catch(() => {});
  }, [base]);
  // حيّة: أيُّ تغييرٍ في التشغيل يُعيد القراءة.
  useSocket(liveEvent || 'workflow:updated', useCallback(() => { load(); }, [load]));

  const set = (k: string, v: string) => setQ((x) => ({ ...x, [k]: v }));

  const monthly = useMemo(() => (d?.monthly || []).map((m) => ({
    ...m, label: m.month.slice(5), sellM: Math.round(m.sell / 1000),
  })), [d]);

  if (loading) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  const T = d.totals;
  const G = d.targets;
  const active = Object.entries(q).filter(([k, v]) => k !== 'period' && v).length;

  return (
    <div className={`space-y-4 ${busy ? 'opacity-60 transition-opacity' : 'transition-opacity'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── الفلتر: المدّةُ أوّلًا، فهي أوّلُ ما يُسأل ─────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-slate-500 me-1">{t('الفترة', 'Period')}</span>
          {[['all', 'الكل', 'All'], ['day', 'يوم', 'Day'], ['month', 'شهر', 'Month'], ['quarter', 'ربع', 'Quarter'], ['range', 'مدى', 'Range']].map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => set('period', k)}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-colors ${
                (q.period || 'month') === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
              {t(a, e)}
            </button>
          ))}
          {(q.period || 'month') === 'month' && (
            <select value={q.month || ''} onChange={(e) => set('month', e.target.value)}
              className="px-2 py-1 rounded-lg border border-slate-200 text-[12px]">
              <option value="">{t('الشهر الحالي', 'This month')}</option>
              {(opts.months || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {(q.period || 'month') === 'day' && (
            <input type="date" value={q.day || ''} onChange={(e) => set('day', e.target.value)}
              className="px-2 py-1 rounded-lg border border-slate-200 text-[12px] [color-scheme:light]" />
          )}
          {(q.period || 'month') === 'range' && (
            <>
              <input type="date" value={q.from || ''} onChange={(e) => set('from', e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 text-[12px] [color-scheme:light]" />
              <input type="date" value={q.to || ''} onChange={(e) => set('to', e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 text-[12px] [color-scheme:light]" />
            </>
          )}
          <button type="button" onClick={() => setShowFilters((v) => !v)}
            className="ms-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:text-slate-900">
            <SlidersHorizontal className="w-3.5 h-3.5" />{t('فلاتر', 'Filters')}
            {active ? <span className="px-1.5 rounded-full bg-[#f37121] text-white text-[10px]">{active}</span> : null}
          </button>
          <button type="button" onClick={load} title={t('تحديث', 'Refresh')}
            className="px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:text-[#f37121]">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-1.5 border-t border-slate-100">
            {[['branch', 'الفرع', 'Branch'], ['rentType', 'نوع الإيجار', 'Rent type'], ['payType', 'دفع العميل', 'Customer payment'],
              ['vendorType', 'نوع المورد', 'Vendor type'], ['opsRep', 'مندوب التشغيل', 'Ops rep']].map(([k, a, e]) => (
              <label key={k} className="block">
                <span className="block text-[10.5px] text-slate-500 mb-0.5">{t(a, e)}</span>
                <select value={q[k] || ''} onChange={(ev) => set(k, ev.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]">
                  <option value="">{t('الكل', 'All')}</option>
                  {(opts[k] || []).map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
            {active ? (
              <button type="button" onClick={() => setQ({ period: q.period || 'month', month: q.month || '' })}
                className="self-end inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-500 hover:text-red-600">
                <X className="w-3.5 h-3.5" />{t('مسح الفلاتر', 'Clear')}
              </button>
            ) : null}
          </div>
        )}
        <p className="text-[10.5px] text-slate-400">
          {t(`${d.period.from || '—'} → ${d.period.to || '—'} · ${T.days} يومًا · ${nf(T.rows)} سطرًا من تقرير الفروع`,
             `${d.period.from || '—'} → ${d.period.to || '—'} · ${T.days} days · ${nf(T.rows)} report rows`)}
          {d.source?.importedAt ? t(` · آخر تحديثٍ للتقرير ${String(d.source.importedAt).slice(0, 10)}`, ` · report imported ${String(d.source.importedAt).slice(0, 10)}`) : ''}
        </p>
      </div>

      {/* ① المال والرحلات */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
        <Kpi icon={<Wallet className="w-3.5 h-3.5" />} label={t('إجمالي المبيعات', 'Total sales')} value={`${short(T.sell)}`} sub={t('إجمالي الإيراد', 'Total revenue')} tone={NAVY} />
        <Kpi icon={<ShoppingCart className="w-3.5 h-3.5" />} label={t('إجمالي تكلفة الشراء', 'Total buying cost')} value={`${short(T.buy)}`} sub={`${T.sell ? Math.round((T.buy / T.sell) * 1000) / 10 : 0}% ${t('من المبيعات', 'of sales')}`} tone="#64748b" />
        <Kpi icon={<Percent className="w-3.5 h-3.5" />} label={t('هامش الربح', 'Gross margin')} value={`${short(T.gp)}`} sub={`${T.marginPct}% ${t('من المبيعات', 'of sales')}`} tone="#16a34a" />
        <Kpi icon={<Truck className="w-3.5 h-3.5" />} label={t('إجمالي الرحلات', 'Total trips')} value={nf(T.trips)} sub={t('محقق + غير محقق', 'achieved + failed')} tone={ORANGE} />
        <Kpi icon={<CheckCircle2 className="w-3.5 h-3.5" />} label={t('الرحلات المحققة', 'Achieved trips')} value={nf(T.achieved)} sub={`${T.achievedPct}% ${t('من الإجمالي', 'of total')}`} tone="#16a34a" />
        <Kpi icon={<XCircle className="w-3.5 h-3.5" />} label={t('الرحلات غير المحققة', 'Failed trips')} value={nf(T.failed)} sub={`${T.failedPct}% ${t('من الإجمالي', 'of total')}`} tone="#dc2626" />
        <Kpi icon={<CalendarDays className="w-3.5 h-3.5" />} label={t('متوسط الإيراد / يوم', 'Avg revenue / day')} value={short(T.avgRevenuePerDay)} sub={t(`على ${T.days} يوم`, `over ${T.days} days`)} tone="#0ea5e9" />
        <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label={t('متوسط الرحلات / يوم', 'Avg trips / day')} value={String(T.avgTripsPerDay)} sub={t('رحلة محققة', 'achieved trips')} tone="#7c3aed" />
      </div>

      {/* ② الأهداف ③ أسبابُ عدم التحقيق */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          { key: 'trips', title: t('هدف الرحلات', 'Trips target'), got: T.achieved, target: G.periodTrips, pctv: G.tripsAchievementPct, gap: G.tripsGap, ytd: G.ytdTrips, annual: G.annualTrips, annualPct: G.annualTripsPct, remain: G.remainingTrips, fmt: nf },
          { key: 'sales', title: t('هدف المبيعات', 'Revenue target'), got: T.sell, target: G.periodRevenue, pctv: G.revenueAchievementPct, gap: G.revenueGap, ytd: G.ytdRevenue, annual: G.annualRevenue, annualPct: G.annualRevenuePct, remain: G.remainingRevenue, fmt: short },
        ].map((x) => (
          <Panel key={x.key} title={x.title}
            right={<span className={`text-[11px] font-bold ${x.pctv >= 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {x.pctv >= 100 ? t('بلغ الهدف', 'on target') : t('أقل من الهدف', 'below target')}
            </span>}>
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <span className="text-[26px] leading-none font-extrabold tabular-nums text-slate-900">{x.pctv}%</span>
                <span className="text-[12px] text-slate-500 tabular-nums">{x.fmt(x.got)} {t('من', 'of')} {x.fmt(x.target)}</span>
              </div>
              <Bar2 pct={x.pctv} tone={x.pctv >= 100 ? '#16a34a' : ORANGE} />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <p className="text-[10.5px] text-slate-400">{t('الفجوة عن الهدف', 'Gap')}</p>
                  <p className={`text-[13px] font-bold tabular-nums ${x.gap >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{x.gap >= 0 ? '+' : ''}{x.fmt(x.gap)}</p>
                </div>
                <div>
                  <p className="text-[10.5px] text-slate-400">{t('المحقق من أول السنة', 'YTD')}</p>
                  <p className="text-[13px] font-bold tabular-nums text-slate-800">{x.fmt(x.ytd)} <span className="text-[10.5px] font-normal text-slate-400">{x.annualPct}%</span></p>
                </div>
                <div>
                  <p className="text-[10.5px] text-slate-400">{t('المتبقي على هدف السنة', 'Remaining')}</p>
                  <p className="text-[13px] font-bold tabular-nums text-slate-800">{x.fmt(x.remain)}</p>
                </div>
              </div>
            </div>
          </Panel>
        ))}

        <Panel title={t('مساهمة أسباب الإلغاء', 'Cancellation share')}
          hint={t(`${nf(T.failed)} غير محقق`, `${nf(T.failed)} failed`)}>
          <div className="space-y-1.5">
            {d.reasons.slice(0, 7).map((r, i) => (
              <RankRow key={r.name} i={i} name={r.name} value={nf(r.failed)} share={r.share} tone="#dc2626" />
            ))}
            {!d.reasons.length && <p className="text-[12px] text-slate-400">{t('لا إلغاءات في الفترة', 'No cancellations')}</p>}
            {d.mainReason && (
              <p className="text-[11px] text-red-700 flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t(`السبب الرئيسي: ${d.mainReason.name} ${d.mainReason.share}%`, `Main reason: ${d.mainReason.name} ${d.mainReason.share}%`)}
              </p>
            )}
          </div>
        </Panel>
      </div>

      {/* ④ الاتّجاه */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={t('اتجاه المبيعات', 'Sales trend')}
          hint={t('بالألف — الشهر الجاري غير مكتمل', 'in thousands — current month incomplete')}
          right={d.monthPeak.bestSell ? <span className="text-[10.5px] text-slate-400">
            {t(`الأعلى ${d.monthPeak.bestSell.month.slice(5)}: ${short(d.monthPeak.bestSell.sell)}`, `top ${d.monthPeak.bestSell.month.slice(5)}`)}
          </span> : null}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => `${nf(v)}K`} />
                <Bar dataKey="sellM" radius={[4, 4, 0, 0]}>
                  {monthly.map((m) => <Cell key={m.month} fill={m.partial ? '#cbd5e1' : NAVY} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title={t('اتجاه الرحلات', 'Trips trend')} hint={t('المحقق شهريًّا', 'achieved per month')}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => nf(v)} />
                <Line type="monotone" dataKey="achieved" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ⑤ الفروع ⑥ المناديب */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={t('أداء الفروع', 'Branch performance')} hint={t(`${d.branches.list.length} فروع`, `${d.branches.list.length} branches`)}>
          <ScrollX>
            <table className="w-full text-[12px]">
              <thead><tr className="text-slate-500 text-[10.5px]">
                <th className="text-start py-1">{t('الفرع', 'Branch')}</th>
                <th className="text-end py-1">{t('محقق', 'Achieved')}</th>
                <th className="text-end py-1">%</th>
                <th className="text-end py-1">{t('مبيعات', 'Sales')}</th>
                <th className="text-end py-1">{t('هامش', 'Margin')}</th>
              </tr></thead>
              <tbody>
                {d.branches.list.map((b) => (
                  <tr key={b.name} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-800">{b.name}</td>
                    <td className="py-1.5 text-end tabular-nums font-semibold">{nf(b.achieved)}</td>
                    <td className="py-1.5 text-end tabular-nums text-slate-500">{b.tripShare}%</td>
                    <td className="py-1.5 text-end tabular-nums">{short(b.sell)}</td>
                    <td className={`py-1.5 text-end tabular-nums ${b.margin >= 12 ? 'text-emerald-600' : 'text-amber-600'}`}>{b.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
            {[['أعلى فرع مبيعات', 'Top revenue', d.branches.byRevenue.highest, 'sell'],
              ['أقل فرع مبيعات', 'Lowest revenue', d.branches.byRevenue.lowest, 'sell']].map(([a, e, n, k]: any) => (
              <div key={a}>
                <p className="text-[10.5px] text-slate-400 flex items-center gap-1"><Building2 className="w-3 h-3" />{t(a, e)}</p>
                <p className="text-[13px] font-bold text-slate-900">{n?.name || '—'}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">{short(n?.[k] || 0)} · {n?.sellShare || 0}%</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={t('أداء مناديب التشغيل', 'Ops representatives')}
          hint={d.opsReps.fleetExcluded ? t(`بطاقتا الأعلى والأدنى تستثنيان «${d.opsReps.fleetExcluded}» (أسطول الشركة)`, 'top/lowest exclude the company fleet') : ''}>
          <div className="space-y-1">
            {d.opsReps.list.slice(0, 12).map((r, i) => (
              <RankRow key={r.name} i={i} name={r.name} value={nf(r.achieved)} share={r.tripShare} tone={ORANGE} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
            {[['أعلى مندوب', 'Top rep', d.opsReps.byTrips.highest], ['أقل مندوب', 'Lowest rep', d.opsReps.byTrips.lowest]].map(([a, e, n]: any) => (
              <div key={a}>
                <p className="text-[10.5px] text-slate-400 flex items-center gap-1"><UserCheck className="w-3 h-3" />{t(a, e)}</p>
                <p className="text-[13px] font-bold text-slate-900">{n?.name || '—'}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">{nf(n?.achieved || 0)} · {n?.tripShare || 0}%</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ⑦ العملاء والموردون */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={t('أعلى ١٠ عملاء', 'Top 10 clients')}
          hint={t(`${d.clients.count} عميلًا نشطًا · النسبة من رحلات العملاء`, `${d.clients.count} active · share of client trips`)}>
          <div className="space-y-1">
            {d.clients.top.map((c, i) => (
              <RankRow key={c.name} i={i} name={c.name} value={nf(c.achieved)} share={c.tripShare} extra={short(c.sell)} tone={NAVY} />
            ))}
          </div>
        </Panel>
        <Panel title={t('أعلى ١٠ موردين', 'Top 10 vendors')}
          hint={t(`${d.vendors.count} موردًا · النسبة من رحلات الموردين`, `${d.vendors.count} vendors · share of vendor trips`)}>
          <div className="space-y-1">
            {d.vendors.top.map((v, i) => (
              <RankRow key={v.name} i={i} name={v.name} value={nf(v.achieved)} share={v.tripShare} extra={short(v.buy)} tone="#7c3aed" />
            ))}
          </div>
        </Panel>
      </div>

      {/* ⑧ التوزيعات وأهمُّ المسارات */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {[['rentType', 'نوع الإيجار', 'Rent type'], ['payType', 'دفع العميل', 'Customer payment'], ['vendorType', 'نوع المورد', 'Vendor type']].map(([k, a, e]) => (
          <Panel key={k} title={t(a, e)} hint={t('من المحقق', 'of achieved')}>
            <div className="space-y-1.5">
              {(d.shares as any)[k].map((x: any, i: number) => (
                <RankRow key={x.name} i={i} name={x.name} value={nf(x.trips)} share={x.share} tone="#0ea5e9" />
              ))}
            </div>
          </Panel>
        ))}
        <Panel title={t('أكثر المسارات', 'Top routes')} hint={t('محقق', 'achieved')}>
          <div className="space-y-1">
            {d.routes.slice(0, 8).map((r, i) => (
              <RankRow key={r.name} i={i} name={r.name} value={nf(r.achieved)} share={r.tripShare} tone="#16a34a" />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
