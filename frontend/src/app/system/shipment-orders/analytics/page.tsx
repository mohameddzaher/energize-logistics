'use client';
// تحليلات طلبات الشحنات — الوساطةُ تُقاس بالفرق لا بالعدد.
//
// موديلُ العمل هنا غيرُ إدارة الأسطول: هناك السيّارةُ سيّارتُنا فالسؤالُ «هل
// حقّقت هدفَها»، وهنا لا سيّارةَ لنا — نشتري الحمولةَ من مورّدٍ ونبيعها لعميل،
// فالسؤالُ **«كم كان الفرق، وممّن»**: أيُّ عميلٍ يشتري أكثر، وأيُّ مورّدٍ ينفّذ
// أرخص، وأيُّ مسارٍ هامشُه أعلى — وأيُّ شحنةٍ بيعُها أقلُّ من شرائها.
import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { ORDER_STATUSES, statusLabel, Lang } from '@/lib/shipmentOrders';
import { Spinner, PageHeader, StatCard, SearchInput } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { TrendingUp, AlertTriangle, RotateCcw } from 'lucide-react';

const ORANGE = '#f37121';
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

interface Bucket { key: string; name: string; orders: number; sell: number; buy: number; margin: number; marginPct: number | null; avgMargin: number }
interface Data {
  totals: {
    orders: number; live: number; cancelled: number; cancelRate: number;
    sell: number; buy: number; margin: number; marginPct: number; avgMargin: number; avgSell: number;
    customers: number; suppliers: number; routes: number; losing: number; missingPrice: number;
  };
  byCustomer: Bucket[]; bySupplier: Bucket[]; byRoute: Bucket[]; byTruckType: Bucket[]; byBranch: Bucket[];
  byMonth: { key: string; orders: number; sell: number; buy: number; margin: number }[];
  byStatus: Record<string, number>;
  losing: any[];
}

function Inner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const sp = useSearchParams();

  const [from, setFrom] = useState(sp?.get('from') || '');
  const [to, setTo] = useState(sp?.get('to') || '');
  const [status, setStatus] = useState(sp?.get('status') || '');
  const [q, setQ] = useState(sp?.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => { const h = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(h); }, [q]);

  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'byCustomer' | 'bySupplier' | 'byRoute' | 'byTruckType' | 'byBranch'>('byCustomer');
  // شحناتُنا أم شحناتُ المنصّة: خلطُهما يخفي أداءَنا داخل ثلاثةٍ وثلاثين ألفَ
  // صفٍّ منقول، فيُقرأ متوسّطُهم على أنّه متوسّطُنا.
  const [source, setSource] = useState<'' | 'system' | 'platform'>(sp?.get('source') === 'system' ? 'system' : sp?.get('source') === 'platform' ? 'platform' : '');

  const query = (() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status) p.set('status', status);
    if (debouncedQ.trim()) p.set('q', debouncedQ.trim());
    if (source) p.set('source', source);
    return p;
  })();

  const load = useCallback(async () => {
    try { setD(await api.get<Data>(`/api/shipment-orders/analytics?${query.toString()}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  // الرابطُ يُكتب ولا يُنتقَل إليه — التنقّلُ يعيد بناء الشجرة مع كلّ فلتر.
  useEffect(() => { syncUrl('/system/shipment-orders/analytics', query); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()]);

  const reset = () => { setFrom(''); setTo(''); setStatus(''); setQ(''); setSource(''); };

  if (loading && !d) return <Spinner />;
  if (!d) return null;
  const T = d.totals;

  const TABS: [typeof tab, string, string][] = [
    ['byCustomer', 'حسب العميل', 'By customer'],
    ['bySupplier', 'حسب المورّد', 'By supplier'],
    ['byRoute', 'حسب المسار', 'By route'],
    ['byTruckType', 'حسب نوع الشاحنة', 'By truck type'],
    ['byBranch', 'حسب الفرع', 'By branch'],
  ];
  const rows = d[tab] || [];

  const cols: ExportColumn[] = [
    { header: t('البند', 'Item'), key: 'name', width: 28 },
    { header: t('شحنات', 'Orders'), key: 'orders', width: 10 },
    { header: t('البيع', 'Sell'), key: 'sell', width: 14 },
    { header: t('الشراء', 'Buy'), key: 'buy', width: 14 },
    { header: t('الفرق', 'Margin'), key: 'margin', width: 14 },
    { header: t('الهامش %', 'Margin %'), key: 'marginPct', width: 12, transform: (v) => (v == null ? '—' : v) },
    { header: t('متوسط الفرق', 'Avg margin'), key: 'avgMargin', width: 14 },
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<TrendingUp className="w-6 h-6 text-[#f37121]" />}
        title={t('تحليلات طلبات الشحنات', 'Shipment Orders Analytics')}
        subtitle={t('الوساطةُ تُقاس بالفرق: كم اشترينا، بكم بعنا، وممّن', 'Brokerage is measured by the spread: what we bought, what we sold, and with whom')}
      >
        <ExportMenu fileName="shipment-orders-analytics" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'view', label: t('الجدول المعروض', 'Shown table'), sheets: [{ name: t('تحليل', 'Analysis'), rows, columns: cols }] },
            { key: 'all', label: t('كلّ التجميعات', 'All groupings'), sheets: TABS.map(([k, arL, enL]) => ({ name: ar ? arL : enL, rows: d[k] || [], columns: cols })) },
          ]} />
      </PageHeader>

      {/* الفلاتر */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">{t('من', 'From')}</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">{t('إلى', 'To')}</label>
          {/* «إلى» مفتوحًا يعني حتى الآن، لا حتى منتصف ليل اليوم. */}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الحالة', 'Status')}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
            <option value="">{t('كل الحالات', 'All statuses')}</option>
            {ORDER_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">{t('المصدر', 'Source')}</label>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {([['', 'الإجمالي', 'Total'], ['system', 'الخاصّ بنا', 'Ours'], ['platform', 'المنصّة', 'Platform']] as const).map(([k, arL, enL]) => (
              <button key={k || 'all'} type="button" onClick={() => setSource(k as any)}
                className={`px-3 py-2 text-sm font-semibold transition-colors ${source === k
                  ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {t(arL, enL)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[14rem]">
          <label className="block text-xs font-semibold text-slate-600 mb-1">{t('بحث', 'Search')}</label>
          <SearchInput value={q} onChange={setQ}
            placeholder={t('عميل، مورّد، مدينة، سائق، بوليصة…', 'customer, supplier, city, driver, waybill…')} />
        </div>
        <button type="button" onClick={reset}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
          <RotateCcw className="w-4 h-4" /> {t('مسح', 'Reset')}
        </button>
      </div>

      {/* الأرقام */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={t('شحنات منفّذة', 'Live orders')} value={T.live} />
        <StatCard label={t('إجمالي البيع', 'Total sell')} value={money(T.sell)} accent="text-emerald-600" />
        <StatCard label={t('إجمالي الشراء', 'Total buy')} value={money(T.buy)} accent="text-slate-700" />
        <StatCard label={t('الفرق (الربح)', 'Spread (profit)')} value={money(T.margin)} accent={T.margin >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <StatCard label={t('الهامش', 'Margin')} value={`${T.marginPct}%`} accent={T.marginPct >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <StatCard label={t('متوسط الفرق للشحنة', 'Avg spread / order')} value={money(T.avgMargin)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={t('عملاء', 'Customers')} value={T.customers} />
        <StatCard label={t('موردون', 'Suppliers')} value={T.suppliers} />
        <StatCard label={t('مسارات', 'Routes')} value={T.routes} />
        <StatCard label={t('ملغاة', 'Cancelled')} value={`${T.cancelled} (${T.cancelRate}%)`} accent="text-slate-500" />
        <StatCard label={t('شحنات خاسرة', 'Losing orders')} value={T.losing} accent={T.losing ? 'text-red-600' : undefined} />
        <StatCard label={t('بلا سعر كامل', 'Missing a price')} value={T.missingPrice} accent={T.missingPrice ? 'text-amber-600' : undefined} />
      </div>

      {/* ── تنبيهٌ صريح ─────────────────────────────────────────────────────
          بلا سعرِ بيعٍ أو شراءٍ لا يُحسب فرق. والرقمُ يُقرأ تامًّا وهو ناقص،
          فيُقال العددُ بدل أن يُخفى. */}
      {!!T.missingPrice && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            {t(`${T.missingPrice} شحنة ينقصها سعرُ البيع أو الشراء — لا تدخل في حساب الفرق، فالربحُ أعلاه لا يشملها.`,
               `${T.missingPrice} order(s) are missing a sell or buy price — they are excluded from the spread, so the profit above does not include them.`)}
          </p>
        </div>
      )}

      {/* الترند */}
      {d.byMonth.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="font-bold text-slate-900 mb-3">{t('الشهور: البيع والشراء والفرق', 'By month: sell, buy and spread')}</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => money(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="sell" name={t('البيع', 'Sell')} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="buy" name={t('الشراء', 'Buy')} stroke="#64748b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="margin" name={t('الفرق', 'Spread')} stroke={ORANGE} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* التجميعات */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-1.5">
          {TABS.map(([k, arL, enL]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
              {ar ? arL : enL}
            </button>
          ))}
          <span className="ms-auto text-xs text-slate-400">{rows.length}</span>
        </div>

        {rows.length > 1 && (
          <div className="h-64 p-4 border-b border-slate-100">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => money(Number(v))} />
                <Bar dataKey="margin" name={t('الفرق', 'Spread')} fill={ORANGE} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="table-head">
              <tr>{[t('البند', 'Item'), t('شحنات', 'Orders'), t('البيع', 'Sell'), t('الشراء', 'Buy'), t('الفرق', 'Spread'), t('الهامش', 'Margin'), t('متوسط الفرق', 'Avg spread')]
                .map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-900 max-w-[260px] truncate" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2 tabular-nums">{r.orders}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap text-emerald-700">{money(r.sell)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-600">{money(r.buy)}</td>
                  <td className={`px-3 py-2 tabular-nums whitespace-nowrap font-semibold ${r.margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(r.margin)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{money(r.avgMargin)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">{t('لا بيانات ضمن هذه الفلاتر', 'No data for these filters')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── الشحنات الخاسرة ─────────────────────────────────────────────────
          بيعٌ أقلُّ من شراء: ليست رقمًا في متوسّط، بل بوليصةٌ باسمها يُسأل عنها. */}
      {!!d.losing.length && (
        <div className="rounded-2xl border border-red-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <p className="font-bold text-red-800">{t('شحنات بيعُها أقلُّ من شرائها', 'Orders sold below cost')}</p>
            <span className="ms-auto text-xs text-red-600">{d.losing.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="table-head">
                <tr>{[t('البوليصة', 'Waybill'), t('العميل', 'Customer'), t('المورّد', 'Supplier'), t('من', 'From'), t('إلى', 'To'), t('البيع', 'Sell'), t('الشراء', 'Buy'), t('الفرق', 'Spread')]
                  .map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.losing.map((o) => (
                  <tr key={o._id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold">
                      <Link href={`/system/shipment-orders/new?id=${o._id}`} className="text-[#f37121] hover:underline">{o.waybillNumber}</Link>
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate" title={o.customerName}>{o.customerName || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate" title={o.supplierName}>{o.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{o.fromCity || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{o.toCity || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{money(o.sellPrice)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(o.buyPrice)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-red-600">{money(o.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShipmentOrdersAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
