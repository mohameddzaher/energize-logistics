'use client';
/**
 * Shipment analytics: the section's single analytics page (it replaced the dashboard and the old analytics page).
 * Every number comes from one server computation under the same filters (GET /api/shipment-orders/insights), so a
 * figure here equals the rows the shipments list returns for the same filters. Money follows the reader: sales see
 * revenue, the vendors team sees cost, management sees both and the profit. Live: any shipment or request change
 * refreshes the page.
 */
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { vocabLabel, type Lang } from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import { Spinner, PageHeader, SearchInput, ErrorNotice } from '@/components/hr/HRKit';
import MultiSearchSelect from '@/components/system/MultiSearchSelect';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import OpsAnalytics from '@/components/ops/OpsAnalytics';
import {
  Kpi, Panel, BarList, DataGrid, Grade, TrendChip, LiveDot, PRESETS, presetRange,
  fmtInt, fmtMoney, fmtPct, fmtDay, ORANGE, CHART, type Col,
} from '@/components/analytics/AnalyticsKit';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Cell,
} from 'recharts';
import { BarChart3, X, SlidersHorizontal, AlertTriangle, RotateCcw, CalendarRange } from 'lucide-react';

type Row = Record<string, any>;
interface Insights {
  span: { from: string; to: string; days: number; prevFrom: string; prevTo: string; dateBy: string; unit: 'day' | 'month' };
  totals: Row; previous: Row; trend: Row[]; byStatus: Record<string, number>;
  customers: Row[]; suppliers: Row[]; routes: Row[]; fromCities: Row[]; toCities: Row[]; branches: Row[];
  truckTypes: Row[]; truckLengths: Row[]; cargoTypes: Row[]; payments: Row[]; salesReps: Row[]; agents: Row[];
  supplierKinds: Row[]; cancelReasons: { reason: string; count: number; pct: number }[];
  cancelByBranch: { branch: string; reason: string; n: number }[]; weekday: Row[];
  duration: { trips: number; avgHours: number | null; buckets: { key: string; n: number }[] };
  marginBands?: { key: string; n: number }[]; losing?: Row[]; requests: Row;
  priceView: { sell: boolean; buy: boolean };
}

/** Filterable dimensions, in the order the bar shows them. */
const DIMS: [string, string, string][] = [
  ['customer', 'العميل', 'Customer'], ['route', 'المسار', 'Route'], ['fromCity', 'من', 'From'], ['toCity', 'إلى', 'To'],
  ['branch', 'الفرع', 'Branch'], ['truckType', 'نوع الشاحنة', 'Truck type'], ['truckLength', 'طول الشاحنة', 'Truck length'],
  ['cargoType', 'نوع الحمولة', 'Cargo type'], ['payment', 'نوع الدفع', 'Payment'], ['salesRep', 'مندوب المبيعات', 'Ops sales'],
  ['supplier', 'المورّد', 'Supplier'], ['supplierType', 'نوع المورّد', 'Supplier kind'], ['agent', 'مُنشئ الشحنة', 'Created by'],
  ['status', 'الحالة', 'Status'], ['cancelReason', 'سبب الإلغاء', 'Cancel reason'], ['source', 'المصدر', 'Source'], ['request', 'طلبات المبيعات', 'Sales requests'],
];
const DIM_KEYS = DIMS.map((d) => d[0]);
const WEEKDAY_AR = ['', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAY_EN = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_AR: Record<string, string> = { company: 'شركات', freelancer: 'سائقون أفراد', none: 'بلا مورّد مسجَّل' };
const TABS: [string, string, string][] = [
  ['overview', 'نظرة عامة', 'Overview'], ['requests', 'طلبات المبيعات والموردين', 'Sales requests & vendors'], ['customers', 'العملاء وتقييمهم', 'Customers & rating'], ['routes', 'المسارات والمدن', 'Routes & cities'],
  ['suppliers', 'الموردون', 'Suppliers'], ['team', 'المبيعات والفريق', 'Sales & team'], ['cancel', 'الإلغاء', 'Cancellations'],
  ['losing', 'الشحنات الخاسرة', 'Losing shipments'], ['branchReport', 'تقرير الفروع', 'Branch report'],
];

function Inner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const sp = useSearchParams();
  const statusVocab = useOrderStatuses();
  const statusName = (k: string) => { const s = statusVocab.find((x) => x.key === k); return s ? vocabLabel(s, lang as Lang) : k; };
  const payName = (k: string) => (PAYMENT_SUBTYPES as any)[k] ? (ar ? (PAYMENT_SUBTYPES as any)[k].ar : (PAYMENT_SUBTYPES as any)[k].en) : (k || t('غير محدّد', 'Not set'));

  const [defFrom, defTo] = presetRange('month');
  const [from, setFrom] = useState(sp?.get('from') || defFrom);
  const [to, setTo] = useState(sp?.get('to') || defTo);
  const [dateBy, setDateBy] = useState(sp?.get('dateBy') === 'created' ? 'created' : 'pickup');
  const [q, setQ] = useState(sp?.get('q') || '');
  const [qd, setQd] = useState(q);
  useEffect(() => { const h = setTimeout(() => setQd(q), 350); return () => clearTimeout(h); }, [q]);
  const [tab, setTab] = useState(sp?.get('tab') || 'overview');
  const [filters, setFilters] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const k of DIM_KEYS) { const v = sp?.getAll(`f_${k}`) || []; if (v.length) out[k] = v; }
    return out;
  });
  const [showFilters, setShowFilters] = useState(() => Object.keys(filters).length > 0);
  const [d, setD] = useState<Insights | null>(null);
  const [opts, setOpts] = useState<Record<string, { value: string; count: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const guard = useLatestRequest();

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', from); p.set('to', to);
    if (dateBy === 'created') p.set('dateBy', 'created');
    for (const [k, vals] of Object.entries(filters)) {
      if (k === 'request') { if (vals.length === 1) p.set('f_request', vals[0]); continue; }
      vals.forEach((v) => p.append(`f_${k}`, v));
    }
    if (qd.trim()) p.set('q', qd.trim());
    return p;
  }, [from, to, dateBy, filters, qd]);
  const qs = query.toString();

  const load = useCallback(async () => {
    const mine = guard.begin();
    setBusy(true);
    try {
      const r = await api.get<Insights>(`/api/shipment-orders/insights?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setD(r); setError('');
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    finally { if (guard.isCurrent(mine)) { setBusy(false); setLoading(false); } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, guard]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ options: Record<string, { value: string; count: number }[]> }>(`/api/shipment-orders/insights/options?from=${from}&to=${to}${dateBy === 'created' ? '&dateBy=created' : ''}`)
      .then((r) => setOpts(r.options || {})).catch(() => {});
  }, [from, to, dateBy]);
  // A burst of saves becomes one refresh.
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => load(), 900); }, [load]);
  useSocket('shipmentOrders:updated', soon);
  useSocket('shipmentRequests:changed', soon);
  useEffect(() => { const p = new URLSearchParams(qs); if (tab !== 'overview') p.set('tab', tab); syncUrl('/system/shipment-orders/analytics', p); }, [qs, tab]);

  const setDim = (k: string, v: string[]) => setFilters((f) => { const n = { ...f }; if (v.length) n[k] = v; else delete n[k]; return n; });
  const addTo = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: f[k]?.includes(v) ? f[k] : [...(f[k] || []), v] })); setShowFilters(true); };
  const clearAll = () => { setFilters({}); setQ(''); };
  const preset = (key: string) => { const [a, b] = presetRange(key); setFrom(a); setTo(b); };
  const activePreset = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === from && b === to; })?.[0] || '';

  const label = (k: string, v: string) => {
    if (v === '__blank__') return t('— فارغ —', '— blank —');
    if (k === 'status') return statusName(v);
    if (k === 'payment') return payName(v);
    if (k === 'source') return v === 'platform' ? t('المنصّة', 'Platform') : t('النظام', 'System');
    if (k === 'supplierType') return KIND_AR[v] || v;
    if (k === 'request') return v === 'yes' ? t('من طلبات المبيعات', 'From sales requests') : t('إنشاءٌ مباشر', 'Created directly');
    return v;
  };
  const optionsOf = (k: string) => {
    if (k === 'supplierType') return ['company', 'freelancer', 'none'].map((v) => ({ value: v, label: label(k, v) }));
    if (k === 'request') return ['yes', 'no'].map((v) => ({ value: v, label: label(k, v) }));
    return (opts[k] || []).map((o) => ({ value: String(o.value), label: label(k, String(o.value)), count: o.count }));
  };

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorNotice error={error || t('تعذّر التحميل', 'Could not load')} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const T = d.totals; const P = d.previous; const pv = d.priceView;
  const both = pv.sell && pv.buy;
  const activeCount = Object.values(filters).reduce((s, v) => s + v.length, 0) + (qd.trim() ? 1 : 0);
  const tabs = TABS.filter(([k]) => (k !== 'losing' || both) && (k !== 'branchReport' || both));

  const moneyCols = <R extends Row>(): Col<R>[] => [
    ...(pv.sell ? [{ key: 'sell', label: t('الإيرادات', 'Revenue'), num: true, render: (r: R) => fmtMoney(r.sell) } as Col<R>] : []),
    ...(pv.buy ? [{ key: 'buy', label: t('التكلفة', 'Cost'), num: true, render: (r: R) => fmtMoney(r.buy) } as Col<R>] : []),
    ...(both ? [
      { key: 'margin', label: t('الربح', 'Profit'), num: true, render: (r: R) => <span className={r.margin < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>{fmtMoney(r.margin)}</span> } as Col<R>,
      { key: 'marginPct', label: t('الهامش', 'Margin'), num: true, render: (r: R) => fmtPct(r.marginPct) } as Col<R>,
    ] : []),
    ...(pv.sell ? [{ key: 'avgSell', label: t('متوسط البيع', 'Avg sell'), num: true, render: (r: R) => fmtMoney(r.avgSell) } as Col<R>] : []),
    ...(pv.buy ? [{ key: 'avgBuy', label: t('متوسط الشراء', 'Avg buy'), num: true, render: (r: R) => fmtMoney(r.avgBuy) } as Col<R>] : []),
  ];
  const volCols = <R extends Row>(nameLabel: string, filterKey?: string): Col<R>[] => [
    { key: 'name', label: nameLabel, render: (r: R) => (
      <span className="font-semibold text-slate-900">{r.name}{r.spellings > 1 && <span className="ms-1.5 text-[10.5px] text-slate-400" title={t('أسماء مكتوبة بأكثر من طريقة جُمعت', 'Spellings merged')}>×{r.spellings}</span>}</span>
    ) },
    { key: 'orders', label: t('الشحنات', 'Shipments'), num: true },
    { key: 'live', label: t('المنفّذة', 'Executed'), num: true },
    { key: 'share', label: t('الحصّة', 'Share'), num: true, render: (r: R) => fmtPct(r.share) },
    { key: 'cancelRate', label: t('الإلغاء', 'Cancel %'), num: true, render: (r: R) => <span className={r.cancelRate > 15 ? 'text-red-600' : ''}>{fmtPct(r.cancelRate)}</span> },
    ...moneyCols<R>(),
  ];
  const exportCols: ExportColumn[] = [
    { header: t('البند', 'Item'), key: 'name', width: 30 }, { header: t('الشحنات', 'Shipments'), key: 'orders' }, { header: t('المنفّذة', 'Executed'), key: 'live' },
    { header: t('الملغاة', 'Cancelled'), key: 'cancelled' }, { header: t('نسبة الإلغاء', 'Cancel %'), key: 'cancelRate' }, { header: t('الحصّة %', 'Share %'), key: 'share' },
    ...(pv.sell ? [{ header: t('الإيرادات', 'Revenue'), key: 'sell' }, { header: t('متوسط البيع', 'Avg sell'), key: 'avgSell' }] : []),
    ...(pv.buy ? [{ header: t('التكلفة', 'Cost'), key: 'buy' }, { header: t('متوسط الشراء', 'Avg buy'), key: 'avgBuy' }] : []),
    ...(both ? [{ header: t('الربح', 'Profit'), key: 'margin' }, { header: t('الهامش %', 'Margin %'), key: 'marginPct' }] : []),
  ];
  const sheets = [
    ['customers', t('العملاء', 'Customers')], ['routes', t('المسارات', 'Routes')], ['suppliers', t('الموردون', 'Suppliers')], ['branches', t('الفروع', 'Branches')],
    ['truckTypes', t('أنواع الشاحنات', 'Truck types')], ['payments', t('أنواع الدفع', 'Payments')], ['salesReps', t('مندوب المبيعات', 'Ops sales')],
    ['fromCities', t('مدن التحميل', 'From cities')], ['toCities', t('مدن الوصول', 'To cities')], ['cargoTypes', t('أنواع الحمولة', 'Cargo')],
  ].map(([k, n]) => ({ name: n, rows: ((d as any)[k] || []).map((r: Row) => (k === 'payments' ? { ...r, name: payName(r.key) } : r)), columns: k === 'customers'
    ? [...exportCols, { header: t('التقييم', 'Grade'), key: 'grade' }, { header: t('الدرجة', 'Score'), key: 'score' }, { header: t('آخر شحنة', 'Last'), key: 'last', transform: (v: any) => fmtDay(v) }]
    : exportCols }));

  const trend = d.trend.map((x) => ({ ...x, label: d.span.unit === 'month' ? x.key : x.key.slice(5) }));
  const statusRows = Object.entries(d.byStatus).map(([k, n]) => ({ key: k, label: statusName(k), value: n })).sort((a, b) => b.value - a.value);
  const gradeCount = (g: string) => d.customers.filter((c) => c.grade === g).length;
  const R = d.requests || {};
  const reqCols = (nameLabel: string): Col<Row>[] => [
    { key: 'name', label: nameLabel, render: (r) => <span className="font-semibold text-slate-900">{r.name}</span> },
    { key: 'requests', label: t('طلبات', 'Requests'), num: true }, { key: 'trucks', label: t('شاحنات مطلوبة', 'Trucks asked'), num: true },
    { key: 'placed', label: t('حُقّقت', 'Placed'), num: true, render: (r) => <span className="text-emerald-700 font-semibold">{fmtInt(r.placed)}</span> },
    { key: 'rejected', label: t('رُفضت', 'Rejected'), num: true, render: (r) => <span className={r.rejected ? 'text-red-600 font-semibold' : 'text-slate-300'}>{fmtInt(r.rejected)}</span> },
    { key: 'open', label: t('مفتوحة', 'Open'), num: true }, { key: 'cancelled', label: t('مسحوبة', 'Withdrawn'), num: true },
    { key: 'fulfilment', label: t('نسبة التحقيق', 'Fulfilment'), num: true, render: (r) => <span className={r.fulfilment >= 80 ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>{fmtPct(r.fulfilment)}</span> },
    { key: 'reasons', label: t('أسباب الرفض', 'Reasons'), render: (r) => <span className="text-[11.5px] text-slate-600">{(r.reasons || []).map((x: Row) => `${x.reason} (${x.n})`).join('، ') || '—'}</span> },
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-6 h-6 text-[#f37121]" />}
        title={t('تحليلات الشحنات', 'Shipment analytics')}
        subtitle={t('كلُّ أرقام القسم في صفحةٍ واحدة — تُحسب من الشحنات نفسها وتتحدّث لحظيًّا', 'Every number of the section on one page — computed from the shipments and live')}>
        <LiveDot ar={ar} busy={busy} />
        <ExportMenu fileName="shipment-analytics" lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('كلّ التجميعات', 'All groupings'), sheets }]} />
      </PageHeader>

      {/* Period and filters */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-2 bg-slate-50/95 backdrop-blur space-y-2">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-center gap-2">
          <CalendarRange className="w-4 h-4 text-slate-400" />
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(([k, a, e]) => (
              <button key={k} type="button" onClick={() => preset(k)}
                className={`px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${activePreset === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{ar ? a : e}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] [color-scheme:light]" />
            <span className="text-slate-400">—</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] [color-scheme:light]" />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px]">
            {([['pickup', 'بتاريخ التحميل', 'By pickup date'], ['created', 'بتاريخ الإنشاء', 'By creation date']] as const).map(([k, a, e]) => (
              <button key={k} type="button" onClick={() => setDateBy(k)} className={`px-2.5 py-1.5 font-semibold ${dateBy === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{ar ? a : e}</button>
            ))}
          </div>
          <div className="flex-1 min-w-[180px]"><SearchInput value={q} onChange={setQ} placeholder={t('بحث: عميل، مورّد، مدينة، لوحة، أمر نقل…', 'Search: customer, supplier, city, plate, order…')} /></div>
          <button type="button" onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold border ${showFilters || activeCount ? 'border-[#f37121] text-[#f37121] bg-[#f37121]/5' : 'border-slate-200 text-slate-700 bg-white'}`}>
            <SlidersHorizontal className="w-4 h-4" />{t('الفلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
          </button>
          {activeCount > 0 && <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"><RotateCcw className="w-3.5 h-3.5" />{t('مسح الكلّ', 'Clear all')}</button>}
        </div>
        {showFilters && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {DIMS.map(([k, a, e]) => (
              <MultiSearchSelect key={k} label={ar ? a : e} ar={ar} value={filters[k] || []} onChange={(v) => setDim(k, k === 'request' ? v.slice(-1) : v)}
                options={optionsOf(k)} searchable={!['supplierType', 'request', 'source'].includes(k)} />
            ))}
          </div>
        )}
        {activeCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(filters).flatMap(([k, vals]) => vals.map((v) => (
              <span key={`${k}:${v}`} className="inline-flex items-center gap-1 rounded-full bg-[#f37121]/10 text-[#b9541a] border border-[#f37121]/30 px-2.5 py-1 text-[12px] font-semibold">
                <span className="text-slate-500 font-normal">{(DIMS.find((x) => x[0] === k) || [])[ar ? 1 : 2]}:</span>{label(k, v)}
                <button type="button" onClick={() => setDim(k, vals.filter((x) => x !== v))} className="hover:text-red-600"><X className="w-3 h-3" /></button>
              </span>
            )))}
          </div>
        )}
      </div>

      {error && <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />}

      {/* Headline numbers, each against the previous period of the same length */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi ar={ar} label={t('الشحنات', 'Shipments')} value={fmtInt(T.orders)} cur={T.orders} prev={P.orders} sub={t(`${d.span.days} يومًا`, `${d.span.days} days`)} />
        <Kpi ar={ar} label={t('المنفّذة', 'Executed')} value={fmtInt(T.live)} cur={T.live} prev={P.live} tone="good" sub={t(`${fmtInt(T.live / Math.max(1, d.span.days))} يوميًّا`, `${fmtInt(T.live / Math.max(1, d.span.days))}/day`)} />
        <Kpi ar={ar} label={t('الملغاة', 'Cancelled')} value={fmtInt(T.cancelled)} cur={T.cancelled} prev={P.cancelled} inverse tone={T.cancelRate > 15 ? 'bad' : undefined} sub={fmtPct(T.cancelRate)} onClick={() => setTab('cancel')} />
        {pv.sell && <Kpi ar={ar} label={t('الإيرادات', 'Revenue')} value={fmtMoney(T.sell)} cur={T.sell} prev={P.sell} tone="brand" sub={t(`متوسط ${fmtMoney(T.avgSell)} للرحلة`, `avg ${fmtMoney(T.avgSell)}/trip`)} />}
        {pv.buy && <Kpi ar={ar} label={t('تكلفة الشراء', 'Purchase cost')} value={fmtMoney(T.buy)} cur={T.buy} prev={P.buy} sub={t(`متوسط ${fmtMoney(T.avgBuy)} للرحلة`, `avg ${fmtMoney(T.avgBuy)}/trip`)} />}
        {both && <Kpi ar={ar} label={t('الربح', 'Profit')} value={fmtMoney(T.margin)} cur={T.margin} prev={P.margin} tone={T.margin < 0 ? 'bad' : 'good'} sub={t(`هامش ${fmtPct(T.marginPct)} · ${fmtMoney(T.avgMargin)} للرحلة`, `margin ${fmtPct(T.marginPct)} · ${fmtMoney(T.avgMargin)}/trip`)} />}
        <Kpi ar={ar} label={t('العملاء النشطون', 'Active customers')} value={fmtInt(T.customers)} cur={T.customers} prev={P.customers} onClick={() => setTab('customers')} />
        <Kpi ar={ar} label={t('الموردون', 'Suppliers')} value={fmtInt(T.suppliers)} onClick={() => setTab('suppliers')} />
        <Kpi ar={ar} label={t('المسارات', 'Routes')} value={fmtInt(T.routes)} onClick={() => setTab('routes')} />
        <Kpi ar={ar} label={t('من طلبات المبيعات', 'From sales requests')} value={fmtInt(T.fromRequests)} sub={fmtPct(T.orders ? (T.fromRequests / T.orders) * 100 : 0)} onClick={() => setTab('requests')} />
        {pv.buy && <Kpi ar={ar} label={t('السُّلف للسائقين', 'Driver advances')} value={fmtMoney(T.advances)} />}
        <Kpi ar={ar} label={t('بلا مندوب مبيعات', 'No ops sales')} value={fmtInt(T.noSalesRep)} tone={T.noSalesRep ? 'warn' : 'muted'} />
      </div>

      {/* Missing prices are counted, not hidden: a total without them would read as complete. */}
      {(both && (T.noSell || T.noBuy)) || (pv.sell && !pv.buy && T.noSell) || (pv.buy && !pv.sell && T.noBuy) ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {pv.sell && T.noSell ? t(`${fmtInt(T.noSell)} شحنة منفّذة بلا سعر بيع. `, `${fmtInt(T.noSell)} executed without a selling price. `) : ''}
            {pv.buy && T.noBuy ? t(`${fmtInt(T.noBuy)} شحنة منفّذة بلا سعر شراء. `, `${fmtInt(T.noBuy)} executed without a purchase price. `) : ''}
            {both ? t('الربح محسوبٌ على الشحنات التي لها السعران فقط', 'Profit counts only shipments with both prices') + ` (${fmtInt(T.priced)}).` : ''}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map(([k, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {ar ? a : e}{k === 'losing' && T.losing ? <span className="ms-1.5 rounded-full bg-red-100 text-red-700 px-1.5 text-[11px]">{T.losing}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <Panel title={t(d.span.unit === 'month' ? 'الحركة شهرًا بشهر' : 'الحركة يومًا بيوم', d.span.unit === 'month' ? 'Month by month' : 'Day by day')}
            subtitle={t('المنفّذة والملغاة' + (pv.sell ? ' والإيرادات' : '') + (both ? ' والربح' : '') + (!pv.sell && pv.buy ? ' والتكلفة' : ''), 'Executed and cancelled, with money for your side')}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="n" tick={{ fontSize: 11 }} />
                  {(pv.sell || pv.buy) && <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />}
                  <Tooltip formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                  <Legend />
                  <Bar yAxisId="n" dataKey="live" stackId="a" name={t('منفّذة', 'Executed')} fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="n" dataKey="cancelled" stackId="a" name={t('ملغاة', 'Cancelled')} fill="#fca5a5" radius={[4, 4, 0, 0]} />
                  {pv.sell && <Line yAxisId="m" type="monotone" dataKey="sell" name={t('الإيرادات', 'Revenue')} stroke={ORANGE} strokeWidth={2.5} dot={false} />}
                  {both && <Line yAxisId="m" type="monotone" dataKey="margin" name={t('الربح', 'Profit')} stroke="#0f172a" strokeWidth={2} dot={false} />}
                  {!pv.sell && pv.buy && <Line yAxisId="m" type="monotone" dataKey="buy" name={t('التكلفة', 'Cost')} stroke="#64748b" strokeWidth={2} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title={t('أين تقف الشحنات', 'Where shipments stand')} subtitle={t('اضغط حالةً لتصفية الصفحة بها', 'Press a status to filter')}>
              <BarList ar={ar} rows={statusRows} onPick={(k) => addTo('status', k)} valueLabel={(v) => `${fmtInt(v)} · ${fmtPct((v / Math.max(1, T.orders)) * 100)}`} />
            </Panel>
            <Panel title={t('الفروع', 'Branches')}>
              <BarList ar={ar} rows={d.branches.map((b) => ({ key: b.key, label: b.name, value: b.live, hint: fmtPct(b.share), sub: pv.sell ? `${t('إيرادات', 'revenue')} ${fmtMoney(b.sell)}` : pv.buy ? `${t('تكلفة', 'cost')} ${fmtMoney(b.buy)}` : undefined }))} onPick={(k) => addTo('branch', k)} />
            </Panel>
            <Panel title={t('نوع الدفع', 'Payment type')}>
              <BarList ar={ar} rows={d.payments.map((p) => ({ key: p.key, label: payName(p.key), value: p.live, hint: fmtPct(p.share) }))} onPick={(k) => addTo('payment', k || '__blank__')} color="#0ea5e9" />
            </Panel>
            <Panel title={t('أنواع الشاحنات', 'Truck types')}>
              <BarList ar={ar} rows={d.truckTypes.map((p) => ({ key: p.key, label: p.name, value: p.live, hint: fmtPct(p.share) }))} onPick={(k) => addTo('truckType', k || '__blank__')} color="#8b5cf6" />
            </Panel>
            <Panel title={t('أيام الأسبوع', 'Weekdays')} subtitle={t('توزيع الشحنات المنفّذة', 'Executed shipments')}>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.weekday.map((w) => ({ ...w, name: (ar ? WEEKDAY_AR : WEEKDAY_EN)[w.day] }))}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                    <Bar dataKey="live" name={t('منفّذة', 'Executed')} fill={ORANGE} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title={t('مدّة الرحلة', 'Trip duration')} subtitle={d.duration.avgHours != null ? t(`${fmtInt(d.duration.avgHours)} ساعة في المتوسط · ${fmtInt(d.duration.trips)} رحلة مكتملة التواريخ`, `${fmtInt(d.duration.avgHours)}h average · ${fmtInt(d.duration.trips)} dated trips`) : t('لا رحلات مكتملة التواريخ', 'No dated trips')}>
              <BarList ar={ar} rows={d.duration.buckets.map((b) => ({ key: b.key, label: `${b.key} ${t('ساعة', 'h')}`, value: b.n }))} color="#14b8a6" />
            </Panel>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title={t('طول الشاحنة', 'Truck length')}>
              <BarList ar={ar} rows={d.truckLengths.map((p) => ({ key: p.key, label: p.name, value: p.live }))} onPick={(k) => addTo('truckLength', k || '__blank__')} color="#64748b" />
            </Panel>
            <Panel title={t('نوع الحمولة', 'Cargo type')}>
              <BarList ar={ar} rows={d.cargoTypes.map((p) => ({ key: p.key, label: p.name, value: p.live }))} onPick={(k) => addTo('cargoType', k || '__blank__')} color="#f59e0b" />
            </Panel>
            {both && d.marginBands ? (
              <Panel title={t('شرائح هامش الربح', 'Margin bands')} subtitle={t('كم شحنة في كلّ شريحة (% من سعر البيع)', 'Shipments per margin band (% of selling price)')}>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.marginBands}>
                      <XAxis dataKey="key" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                      <Bar dataKey="n" name={t('شحنات', 'Shipments')} radius={[6, 6, 0, 0]}>
                        {d.marginBands.map((b, i) => <Cell key={b.key} fill={b.key === '<0' ? '#ef4444' : CHART[(i + 1) % CHART.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            ) : (
              <Panel title={t('نوع المورّد', 'Supplier kind')}>
                <BarList ar={ar} rows={d.supplierKinds.map((k) => ({ key: k.key, label: KIND_AR[k.key] || k.key, value: k.live, hint: fmtPct(k.share) }))} onPick={(k) => addTo('supplierType', k)} color="#0ea5e9" />
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Kpi ar={ar} label={t('عملاء الفترة', 'Customers')} value={fmtInt(d.customers.length)} />
            {(['A', 'B', 'C', 'D'] as const).map((g) => <Kpi key={g} ar={ar} label={t(`تقييم ${g}`, `Grade ${g}`)} value={fmtInt(gradeCount(g))} tone={g === 'A' ? 'good' : g === 'D' ? 'bad' : undefined} />)}
            <Kpi ar={ar} label={t('جُدد', 'New')} value={fmtInt(d.customers.filter((c) => c.trend === 'new').length)} tone="brand" />
            <Kpi ar={ar} label={t('توقّفوا', 'Stopped')} value={fmtInt(d.customers.filter((c) => c.trend === 'stopped').length)} tone="bad" />
          </div>
          <Panel title={t('تقييم العملاء', 'Customer rating')} pad={false}
            subtitle={t('الدرجة من 100: حجم العمل 30٪، الإيرادات 20٪، انتظام الأشهر 15٪، الالتزام (قلّة الإلغاء) 20٪، حداثة آخر شحنة 15٪ · الاتجاه = آخر 30 يومًا مقابل الثلاثين قبلها · اضغط عميلًا لتصفية الصفحة به', 'Score of 100: volume 30%, revenue 20%, regular months 15%, reliability 20%, recency 15% · trend = last 30 days vs the 30 before · press to filter')}>
            <DataGrid ar={ar} rows={d.customers} limit={25} onRow={(r) => addTo('customer', r.name)} rowKey={(r) => r.key}
              cols={[
                { key: 'grade', label: t('التقييم', 'Grade'), render: (r) => <Grade g={r.grade} score={r.score} />, sort: (r) => r.score },
                ...volCols<Row>(t('العميل', 'Customer')),
                { key: 'trend', label: t('الاتجاه', 'Trend'), render: (r) => <TrendChip t={r.trend} ar={ar} /> },
                { key: 'activeMonths', label: t('أشهر نشطة', 'Active months'), num: true },
                { key: 'routes', label: t('مسارات', 'Routes'), num: true },
                { key: 'last', label: t('آخر شحنة', 'Last'), render: (r) => <span className="tabular-nums">{fmtDay(r.last)}</span>, sort: (r) => String(r.last || '') },
              ]} />
          </Panel>
        </div>
      )}

      {tab === 'routes' && (
        <div className="space-y-4">
          <Panel title={t('المسارات', 'Routes')} subtitle={t('اضغط مسارًا لتصفية الصفحة به', 'Press a route to filter')} pad={false}>
            <DataGrid ar={ar} rows={d.routes} limit={25} onRow={(r) => addTo('route', r.name)} rowKey={(r) => r.key}
              cols={[
                ...volCols<Row>(t('المسار', 'Route')),
                ...(pv.buy ? [{ key: 'minBuy', label: t('أقلّ شراء', 'Min buy'), num: true, render: (r: Row) => fmtMoney(r.minBuy) }, { key: 'maxBuy', label: t('أعلى شراء', 'Max buy'), num: true, render: (r: Row) => fmtMoney(r.maxBuy) }] as Col<Row>[] : []),
                ...(pv.sell ? [{ key: 'minSell', label: t('أقلّ بيع', 'Min sell'), num: true, render: (r: Row) => fmtMoney(r.minSell) }, { key: 'maxSell', label: t('أعلى بيع', 'Max sell'), num: true, render: (r: Row) => fmtMoney(r.maxSell) }] as Col<Row>[] : []),
              ]} />
          </Panel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={t('مدن التحميل', 'Loading cities')}><BarList ar={ar} rows={d.fromCities.map((c) => ({ key: c.name, label: c.name, value: c.live, hint: fmtPct(c.share) }))} onPick={(k) => addTo('fromCity', k)} /></Panel>
            <Panel title={t('مدن الوصول', 'Destinations')}><BarList ar={ar} rows={d.toCities.map((c) => ({ key: c.name, label: c.name, value: c.live, hint: fmtPct(c.share) }))} onPick={(k) => addTo('toCity', k)} color="#0ea5e9" /></Panel>
          </div>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title={t('نوع المورّد', 'Supplier kind')} subtitle={t('من سجلّ الموردين', 'From the supplier register')}>
              <BarList ar={ar} rows={d.supplierKinds.map((k) => ({ key: k.key, label: KIND_AR[k.key] || k.key, value: k.live, hint: fmtPct(k.share), sub: pv.buy ? `${t('تكلفة', 'cost')} ${fmtMoney(k.buy)}` : undefined }))} onPick={(k) => addTo('supplierType', k)} color="#0ea5e9" />
            </Panel>
            <Panel title={t('أعلى الموردين تنفيذًا', 'Top suppliers')} className="lg:col-span-2">
              <BarList ar={ar} rows={d.suppliers.map((s) => ({ key: s.name, label: s.name, value: s.live, hint: fmtPct(s.share), sub: pv.buy ? `${t('متوسط الشراء', 'avg buy')} ${fmtMoney(s.avgBuy)}` : undefined }))} onPick={(k) => addTo('supplier', k)} />
            </Panel>
          </div>
          <Panel title={t('كلّ الموردين', 'All suppliers')} pad={false}>
            <DataGrid ar={ar} rows={d.suppliers} limit={25} onRow={(r) => addTo('supplier', r.name)} rowKey={(r) => r.key}
              cols={[...volCols<Row>(t('المورّد', 'Supplier')), { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last), sort: (r) => String(r.last || '') }]} />
          </Panel>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-4">
          <Panel title={t('مندوب المبيعات', 'Operational sales')} subtitle={t('من جاء بالحمولة — مرتّبون بالمنفّذ', 'Who brought the load — ranked by executed')} pad={false}>
            <DataGrid ar={ar} rows={d.salesReps} onRow={(r) => addTo('salesRep', r.name === '—' ? '__blank__' : r.name)} rowKey={(r) => r.key}
              cols={volCols<Row>(t('مندوب المبيعات', 'Ops sales'))} />
          </Panel>
          <Panel title={t('مُنشئو الشحنات', 'Created by')} subtitle={t('من سجّل الشحنة على النظام (مندوب التشغيل)', 'Who registered the shipment')} pad={false}>
            <DataGrid ar={ar} rows={d.agents} onRow={(r) => addTo('agent', r.name === '—' ? '__blank__' : r.name)} rowKey={(r) => r.key}
              cols={volCols<Row>(t('الموظف', 'Employee'))} />
          </Panel>
        </div>
      )}

      {tab === 'cancel' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={t('أسباب الإلغاء', 'Cancellation reasons')} subtitle={t(`${fmtInt(T.cancelled)} ملغاة · ${fmtPct(T.cancelRate)} من الشحنات`, `${fmtInt(T.cancelled)} cancelled · ${fmtPct(T.cancelRate)}`)}>
              <BarList ar={ar} rows={d.cancelReasons.map((c) => ({ key: c.reason || '__blank__', label: c.reason || t('بلا سببٍ مسجّل', 'No reason recorded'), value: c.count, hint: fmtPct(c.pct) }))} onPick={(k) => addTo('cancelReason', k)} color="#ef4444" />
            </Panel>
            <Panel title={t('الإلغاء حسب الفرع والسبب', 'Cancellations by branch and reason')} pad={false}>
              <CancelMatrix rows={d.cancelByBranch} ar={ar} />
            </Panel>
          </div>

        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi ar={ar} label={t('طلبات المبيعات', 'Sales requests')} value={fmtInt(R.requests)} sub={t(`${fmtInt(R.trucks)} شاحنة مطلوبة`, `${fmtInt(R.trucks)} trucks asked`)} />
            <Kpi ar={ar} label={t('حقّقها الموردون (أوامر نقل)', 'Placed by vendors')} value={fmtInt(R.placed)} tone="good" />
            <Kpi ar={ar} label={t('نسبة التحقيق', 'Fulfilment')} value={fmtPct(R.fulfilment)} tone={R.fulfilment >= 80 ? 'good' : 'warn'} sub={t('من المحسوم (بدون المفتوح والمسحوب)', 'of decided trucks')} />
            <Kpi ar={ar} label={t('مرفوضة', 'Rejected')} value={fmtInt(R.rejectedTrucks)} tone="bad" sub={t('شاحنة', 'trucks')} />
            <Kpi ar={ar} label={t('ما زالت مفتوحة', 'Still open')} value={fmtInt(R.openTrucks)} tone="warn" sub={t('شاحنة تنتظر', 'trucks waiting')} />
            <Kpi ar={ar} label={t('سحبها فريق المبيعات', 'Withdrawn by sales')} value={fmtInt(R.cancelledTrucks)} tone="muted" />
            <Kpi ar={ar} label={t('أوّل إسنادٍ بعد', 'First placement after')} value={R.avgHoursToFirstPlace != null ? `${fmtInt(R.avgHoursToFirstPlace)} ${t('ساعة', 'h')}` : '—'} />
            <Kpi ar={ar} label={t('إكمال الطلب بعد', 'Request completed after')} value={R.avgHoursToComplete != null ? `${fmtInt(R.avgHoursToComplete)} ${t('ساعة', 'h')}` : '—'} />
            <Kpi ar={ar} label={t('أُعيد إرسالها بعد الرفض', 'Resent after rejection')} value={fmtInt(R.resubmitted?.requests)} sub={t(`نُفّذ منها ${fmtInt(R.resubmitted?.placedAfter)}`, `${fmtInt(R.resubmitted?.placedAfter)} placed after`)} />
          </div>
          <Panel title={t('الفجوة بين المطلوب والمحقَّق — وأسبابها', 'The gap between asked and placed — and why')}
            subtitle={t('كلّ شاحنةٍ طلبها فريق المبيعات ولم تصر أمرَ نقل: مرفوضةٌ بسببها، أو مفتوحةٌ بعد، أو سحبها فريق المبيعات', 'Every asked truck that did not become an order')}>
            <BarList ar={ar} color="#ef4444" limit={12} rows={[
              ...Object.entries(R.reasonTrucks || {}).map(([k, v]) => ({ key: k, label: `${t('رفض', 'Rejected')}: ${k}`, value: Number(v) })),
              ...(R.openTrucks ? [{ key: '__open', label: t('مفتوحة لم يُسند لها مورّدٌ بعد', 'Open, not yet placed'), value: R.openTrucks }] : []),
              ...(R.cancelledTrucks ? [{ key: '__cancel', label: t('سحبها فريقُ المبيعات', 'Withdrawn by sales'), value: R.cancelledTrucks }] : []),
            ].sort((a, b) => b.value - a.value)} empty={t('لا فجوة — كلّ المطلوب تحقّق', 'No gap')} />
          </Panel>
          {(R.trend || []).length > 0 && (
            <Panel title={t('الطلبات يومًا بيوم', 'Requests day by day')}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={R.trend.map((x: Row) => ({ ...x, label: x.day.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
                    <Bar dataKey="placed" stackId="a" name={t('حُقّقت', 'Placed')} fill="#10b981" />
                    <Bar dataKey="rejected" stackId="a" name={t('رُفضت', 'Rejected')} fill="#fca5a5" />
                    <Line dataKey="trucks" name={t('المطلوب', 'Asked')} stroke={ORANGE} strokeWidth={2.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
          <Panel title={t('ماذا جاب كلُّ موظّف مبيعات، وكم تحقّق منه', 'What each sales member brought, and how much was placed')} pad={false}>
            <DataGrid ar={ar} rows={R.bySalesRep || []} rowKey={(r) => r.name} cols={reqCols(t('مندوب المبيعات', 'Ops sales'))} />
          </Panel>
          <Panel title={t('أسباب الرفض لكلّ موظّف مبيعات', 'Rejection reasons per sales member')} pad={false}>
            <DataGrid ar={ar} rows={R.reasonBySales || []} rowKey={(r, i) => `${r.sales}-${r.reason}-${i}`} empty={t('لا رفض في الفترة', 'No rejections')} cols={[
              { key: 'sales', label: t('طالب الطلب', 'Asked by') }, { key: 'reason', label: t('السبب', 'Reason') },
              { key: 'requests', label: t('طلبات', 'Requests'), num: true }, { key: 'trucks', label: t('شاحنات', 'Trucks'), num: true },
            ]} />
          </Panel>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title={t('حسب العميل', 'By customer')} pad={false}><DataGrid ar={ar} rows={R.byCustomer || []} rowKey={(r) => r.name} cols={reqCols(t('العميل', 'Customer'))} /></Panel>
            <Panel title={t('حسب المسار', 'By route')} pad={false}><DataGrid ar={ar} rows={R.byRoute || []} rowKey={(r) => r.name} cols={reqCols(t('المسار', 'Route'))} /></Panel>
            <Panel title={t('حسب الفرع', 'By branch')} pad={false}><DataGrid ar={ar} rows={R.byBranch || []} rowKey={(r) => r.name} cols={reqCols(t('الفرع', 'Branch'))} /></Panel>
            <Panel title={t('حسب نوع الشاحنة', 'By truck type')} pad={false}><DataGrid ar={ar} rows={R.byTruckType || []} rowKey={(r) => r.name} cols={reqCols(t('نوع الشاحنة', 'Truck type'))} /></Panel>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title={t('أسباب الرفض', 'Rejection reasons')}><BarList ar={ar} rows={(R.reasons || []).map((x: Row) => ({ key: x.reason, label: x.reason, value: x.count, hint: t(`${fmtInt(R.reasonTrucks?.[x.reason])} شاحنة`, `${fmtInt(R.reasonTrucks?.[x.reason])} trucks`) }))} color="#ef4444" empty={t('لا رفض في الفترة', 'No rejections')} /></Panel>
            <Panel title={t('مَن أنجز من فريق الموردين', 'Placed by (vendors team)')}><BarList ar={ar} rows={(R.byHandler || []).map((x: Row) => ({ key: x.name, label: x.name, value: x.placed }))} color="#10b981" /></Panel>
            <Panel title={t('عمرُ الطلبات المفتوحة', 'Age of open requests')} subtitle={t('كم تنتظر الطلبات التي لم تُحسم بعد', 'How long undecided requests wait')}><BarList ar={ar} rows={(R.openAge || []).map((x: Row) => ({ key: x.key, label: x.key, value: x.trucks, hint: t(`${x.requests} طلب`, `${x.requests} req`) }))} color="#f59e0b" empty={t('لا طلبات مفتوحة', 'Nothing open')} /></Panel>
          </div>
        </div>
      )}

      {tab === 'losing' && both && (
        <Panel title={t('شحناتٌ بيعُها أقلُّ من شرائها', 'Shipments sold below cost')} subtitle={t(`${fmtInt(T.losing)} شحنة — تُعرض بأوامر نقلها لتُراجَع لا لتُحسب في متوسط`, `${fmtInt(T.losing)} — listed to be reviewed`)} pad={false}>
          <DataGrid ar={ar} rows={d.losing || []} limit={50} rowKey={(r) => String(r._id)}
            cols={[
              { key: 'waybillNumber', label: t('أمر النقل', 'Order'), render: (r) => <Link href={`/system/shipment-orders/new?id=${r._id}`} className="font-mono font-bold text-[#f37121] hover:underline">{r.waybillNumber}</Link> },
              { key: 'pickupTime', label: t('التاريخ', 'Date'), render: (r) => fmtDay(r.pickupTime) },
              { key: 'customerName', label: t('العميل', 'Customer') }, { key: 'supplierName', label: t('المورّد', 'Supplier') },
              { key: 'route', label: t('المسار', 'Route'), render: (r) => `${r.fromCity || '—'} → ${r.toCity || '—'}` },
              { key: 'sellPrice', label: t('البيع', 'Sell'), num: true, render: (r) => fmtMoney(r.sellPrice) },
              { key: 'buyPrice', label: t('الشراء', 'Buy'), num: true, render: (r) => fmtMoney(r.buyPrice) },
              { key: 'margin', label: t('الفرق', 'Spread'), num: true, render: (r) => <span className="text-red-600 font-semibold">{fmtMoney(r.margin)}</span> },
            ]} />
        </Panel>
      )}

      {tab === 'branchReport' && both && (
        <Panel title={t('تحليل تقرير الفروع', 'Branch report analysis')} subtitle={t('من شيت الفروع المستورد، لا من الشحنات أعلاه', 'From the imported branch sheet, not the shipments above')}>
          <OpsAnalytics base="/api/shipment-orders/ops-analytics" liveEvent="shipmentOrders:changed" />
        </Panel>
      )}
    </div>
  );
}

/** Branch × reason counts of cancelled shipments. */
function CancelMatrix({ rows, ar }: { rows: { branch: string; reason: string; n: number }[]; ar: boolean }) {
  const branches = [...new Set(rows.map((r) => r.branch || '—'))];
  const reasons = [...new Set(rows.map((r) => r.reason || ''))];
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-400">{ar ? 'لا إلغاء في الفترة' : 'No cancellations'}</p>;
  const cell = (b: string, r: string) => rows.filter((x) => (x.branch || '—') === b && (x.reason || '') === r).reduce((s, x) => s + x.n, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 text-slate-600"><tr>
          <th className="px-3 py-2 text-start font-semibold">{ar ? 'الفرع' : 'Branch'}</th>
          {reasons.map((r) => <th key={r} className="px-2 py-2 text-end font-semibold whitespace-nowrap">{r || (ar ? 'بلا سبب' : 'No reason')}</th>)}
          <th className="px-3 py-2 text-end font-semibold">{ar ? 'الإجمالي' : 'Total'}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {branches.map((b) => (
            <tr key={b}>
              <td className="px-3 py-2 font-semibold text-slate-800">{b}</td>
              {reasons.map((r) => { const n = cell(b, r); return <td key={r} className={`px-2 py-2 text-end tabular-nums ${n ? 'text-slate-900' : 'text-slate-300'}`}>{n || '·'}</td>; })}
              <td className="px-3 py-2 text-end tabular-nums font-bold">{rows.filter((x) => (x.branch || '—') === b).reduce((s, x) => s + x.n, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ShipmentAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
