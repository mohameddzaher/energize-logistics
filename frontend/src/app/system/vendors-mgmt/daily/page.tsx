'use client';
/**
 * The daily operation as the vendors team follows it: requests against fulfilled and why the rest failed, the
 * target, who carried the load (our fleet, master companies, outside companies, freelance drivers), branch reliance
 * on freelancers, customers fully or partly served, route purchase prices with the cheapest and best carrier, the
 * operations reps who appointed carriers, and who on the vendors team placed them; plus the sales requests the team
 * answered. Live from the shipment orders and requests; every card opens the orders or requests it counts.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice, SearchInput } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Kpi, Panel, BarList, DataGrid, LiveDot, PRESETS, presetRange, fmtInt, fmtMoney, fmtPct, ORANGE } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, vendorHref } from '@/lib/vendors';
import VendorFilters, { vendorFilterQuery, type VendorFilterState } from '@/components/vendors/VendorFilters';
import VendorRegisterStats from '@/components/vendors/VendorRegisterStats';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { Activity, Printer } from 'lucide-react';
import TeamPerformance from '@/components/vendors/TeamPerformance';
import { DrillModal, orderCols, type Drill } from '@/components/vendors/VendorDrill';
import SalesRealisation from '@/components/vendors/SalesRealisation';

type Row = Record<string, any>;
const BLAME: [string, string, string][] = [['rep', 'إلغاء من المندوب', 'By the rep'], ['noTruck', 'لا سيارة · علينا', 'No truck · on us'], ['driver', 'إلغاء من السائق', 'By the driver'], ['customer', 'إلغاء من العميل', 'By the customer'], ['none', 'بلا سبب', 'No reason'], ['other', 'أسبابٌ أخرى', 'Other']];

export default function VendorsDailyPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [[from, to], setRange] = useState<[string, string]>(presetRange('month'));
  const [filters, setFilters] = useState<VendorFilterState>({});
  // One chosen branch also sets the branch target the page measures against.
  const branch = filters.branch?.length === 1 ? filters.branch[0] : '';
  const setBranch = (b: string) => setFilters((f) => { const n = { ...f }; if (b) n.branch = [b]; else delete n.branch; return n; });
  const fq = vendorFilterQuery(filters);
  const [d, setD] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [routeQ, setRouteQ] = useState('');
  const [dest, setDest] = useState('');
  const [openRoute, setOpenRoute] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [vendQ, setVendQ] = useState('');
  const [vendKind, setVendKind] = useState('');
  const guard = useLatestRequest();
  const [drill, setDrill] = useState<Drill | null>(null);

  const load = useCallback(async () => {
    const my = guard.begin(); setBusy(true);
    try {
      const r = await api.get<Row>(`/api/vendors-mgmt/daily?from=${from}&to=${to}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}${fq ? `&${fq}` : ''}`);
      if (guard.isCurrent(my)) { setD(r); setError(''); }
    } catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    if (guard.isCurrent(my)) setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branch, fq, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1000); }, [load]);
  useSocket('shipmentOrders:updated', soon);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:fleet', soon);
  useSocket('shipmentRequests:changed', soon);
  useSocket('workflow:bulkImported', soon);

  const routes = useMemo(() => (d?.routes || []).filter((r: Row) => (!dest || r.to === dest) && (!routeQ || `${r.route}`.includes(routeQ))), [d, dest, routeQ]);
  const vendRows = useMemo(() => (d?.purchaseByVendor || []).filter((v: Row) => (!vendKind || v.kind === vendKind) && (!vendQ || v.name.includes(vendQ))), [d, vendKind, vendQ]);
  const pickedSum = useMemo(() => vendRows.filter((v: Row) => picked.has(v.name)).reduce((s: Row, v: Row) => ({ trips: s.trips + v.trips, buy: s.buy + (v.buy || 0) }), { trips: 0, buy: 0 }), [vendRows, picked]);

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const T = d.totals;
  const activePreset = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === from && b === to; })?.[0] || '';
  const money = T.buy != null;
  // A daily card opens the shipment orders it counts, read with the page's span and filters.
  const openRows = async (title: string, set: string) => {
    try {
      const r = await api.get<Row>(`/api/vendors-mgmt/daily/rows?from=${from}&to=${to}&set=${set}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}${fq ? `&${fq}` : ''}`);
      setDrill({ title: r.total > r.rows.length ? `${title} — ${t('أوّل', 'first')} ${r.rows.length}` : title, rows: r.rows, cols: orderCols(ar, money), fileName: `vendors-daily-${set}` });
    } catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
  };

  return (
    <div className="space-y-4 pb-10 print:space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Activity className="w-6 h-6 text-[#f37121]" />} title={t('التحليل التشغيليّ اليوميّ', 'Daily operations analysis')}
        subtitle={t(`${from} — ${to} · ${d.days} يومًا${branch ? ` · فرع ${branch}` : ''}`, `${from} — ${to} · ${d.days} days`)}>
        <LiveDot ar={ar} busy={busy} />
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 print:hidden"><Printer className="w-4 h-4" />{t('طباعة / PDF', 'Print / PDF')}</button>
        <ExportMenu fileName="vendors-daily" lang={ar ? 'ar' : 'en'} options={[{
          key: 'all', label: t('كلّ الجداول', 'All tables'), sheets: [
            { name: t('حسب اليوم', 'By day'), rows: d.byDay, columns: [{ header: t('اليوم', 'Day'), key: 'day' }, { header: t('طلبات', 'Requests'), key: 'requests' }, { header: t('محقّق', 'Done'), key: 'done' }, { header: t('غير محقّق', 'Failed'), key: 'failed' }, { header: t('نسبة التحقيق', 'Rate'), key: 'rate' }, { header: t('المستهدَف', 'Target'), key: 'target' }, ...(money ? [{ header: t('الشراء', 'Purchase'), key: 'buy' }, { header: t('شراء بدون تنشيط', 'External purchase'), key: 'buyExt' }] : []), { header: t('أسطول تنشيط', 'Our fleet'), key: 'fleet' }] },
            { name: t('الفروع', 'Branches'), rows: d.branches, columns: [{ header: t('الفرع', 'Branch'), key: 'branch' }, { header: t('طلبات', 'Requests'), key: 'requests' }, { header: t('محقّق', 'Done'), key: 'done' }, { header: t('غير محقّق', 'Failed'), key: 'failed' }, { header: t('النسبة', 'Rate'), key: 'rate' }, { header: t('محقّق/يوم', 'Per day'), key: 'perDay' }, ...(money ? [{ header: t('الشراء', 'Purchase'), key: 'buy' }] : []), { header: t('أكبر سبب', 'Top reason'), key: 'topReason' }] },
            { name: t('العملاء', 'Customers'), rows: d.customers, columns: [{ header: t('العميل', 'Customer'), key: 'name' }, { header: t('الفرع', 'Branch'), key: 'branch' }, { header: t('المبيعات', 'Sales'), key: 'sales' }, { header: t('طلبات', 'Requests'), key: 'requests' }, { header: t('محقّق', 'Done'), key: 'done' }, { header: t('غير محقّق', 'Failed'), key: 'failed' }, { header: t('النسبة', 'Rate'), key: 'rate' }] },
            { name: t('الموردون', 'Carriers'), rows: d.purchaseByVendor, columns: [{ header: t('المورّد', 'Carrier'), key: 'name' }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('الفرع', 'Branch'), key: 'branch' }, { header: t('رحلات', 'Trips'), key: 'trips' }, ...(money ? [{ header: t('الشراء', 'Purchase'), key: 'buy' }, { header: t('متوسط', 'Avg'), key: 'avg' }] : [])] },
            { name: t('المسارات', 'Routes'), rows: d.routes.map((r: Row) => ({ ...r, priceList: r.prices.map((p: Row) => `${p.price}(${p.n})`).join(' · ') })), columns: [{ header: t('المسار', 'Route'), key: 'route' }, { header: t('محقّق', 'Done'), key: 'done' }, { header: t('أسطول', 'Fleet'), key: 'fleet' }, { header: t('شركات', 'Companies'), key: 'companies' }, { header: t('أفراد', 'Freelancers'), key: 'freelancer' }, { header: t('الجهات المنفّذة', 'Executors'), key: 'executors' }, ...(money ? [{ header: t('الأسعار', 'Prices'), key: 'priceList' }, { header: t('السعر الأكثر', 'Mode'), key: 'modePrice' }] : [])] },
          ],
        }]} />
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-center gap-2 print:hidden">
        {PRESETS.map(([k, a, e]) => (
          <button key={k} type="button" onClick={() => setRange(presetRange(k))} className={`px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold ${activePreset === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{ar ? a : e}</button>
        ))}
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] [color-scheme:light]" />
        <span className="text-slate-400">—</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] [color-scheme:light]" />

        <span className="ms-auto text-[12px] text-slate-500">{d.target.daily ? t(`المستهدَف اليوميّ ${d.target.daily} رحلة · للفترة ${fmtInt(d.target.period)}`, `Daily target ${d.target.daily} · period ${fmtInt(d.target.period)}`) : <Link href="/system/vendors-mgmt/settings" className="text-[#f37121] hover:underline">{t('حدِّد المستهدَف من إعدادات القسم', 'Set the target in section settings')}</Link>}</span>
      </div>

      <div className="print:hidden"><VendorFilters value={filters} onChange={setFilters} from={from} to={to} ar={ar} /></div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi ar={ar} label={t('أوامر النقل', 'Transport orders')} value={fmtInt(T.requests)} sub={t('بتاريخ التحميل في الفترة', 'pickup in the span')} onClick={() => openRows(t('أوامر النقل في الفترة', 'Orders in the span'), 'all')} />
        <Kpi ar={ar} label={t('المحقّق', 'Fulfilled')} value={fmtInt(T.done)} tone="good" sub={t(`${fmtInt(T.perDay)} يوميًّا`, `${fmtInt(T.perDay)}/day`)} onClick={() => openRows(t('أوامرُ محقّقة', 'Fulfilled orders'), 'done')} />
        <Kpi ar={ar} label={t('غير المحقّق (ملغاة)', 'Not fulfilled (cancelled)')} value={fmtInt(T.failed)} tone="bad" onClick={() => openRows(t('أوامرُ ملغاة وأسبابها', 'Cancelled orders and reasons'), 'failed')} />
        <Kpi ar={ar} label={t('نسبة التحقيق', 'Fulfilment rate')} value={fmtPct(T.rate)} tone={T.rate >= 80 ? 'good' : 'warn'} onClick={() => openRows(t('أوامرُ ملغاة وأسبابها', 'Cancelled orders and reasons'), 'failed')} />
        <Kpi ar={ar} label={t('مقابل المستهدَف', 'Against target')} value={T.vsTarget != null ? fmtPct(T.vsTarget) : '—'} tone={T.vsTarget >= 100 ? 'good' : T.vsTarget != null ? 'warn' : 'muted'} sub={d.target.daily ? t(`المستهدَف ${fmtInt(d.target.period)}`, `target ${fmtInt(d.target.period)}`) : t('غير محدّد', 'not set')} onClick={() => openRows(t('أوامرُ محقّقة', 'Fulfilled orders'), 'done')} />
        <Kpi ar={ar} label={t('حصّة أسطول تنشيط', 'Our fleet share')} value={fmtPct(T.fleetShare)} sub={t(`${fmtInt(T.fleet)} رحلة`, `${fmtInt(T.fleet)} trips`)} onClick={() => openRows(t('رحلات أسطول تنشيط', 'Our fleet trips'), 'fleet')} />
        {money && <Kpi ar={ar} label={t('سعر الشراء', 'Purchase')} value={fmtMoney(T.buy)} sub={t(`متوسط ${fmtMoney(T.avgTrip)}`, `avg ${fmtMoney(T.avgTrip)}`)} onClick={() => openRows(t('أوامرُ محقّقة وأسعار شرائها', 'Fulfilled orders and their purchase'), 'done')} />}
        {money && <Kpi ar={ar} label={t('شراءٌ بدون تنشيط', 'Purchase excl. our fleet')} value={fmtMoney(T.buyExt)} onClick={() => openRows(t('رحلات التشغيل الخارجي', 'External trips'), 'external')} />}
        <Kpi ar={ar} label={t('اعتمادٌ على الأفراد', 'Reliance on freelancers')} value={fmtPct(T.freelancerShareExt)} tone={T.freelancerShareExt > 35 ? 'warn' : undefined} sub={t('من التشغيل الخارجي', 'of external work')} onClick={() => openRows(t('رحلات السائقين الأفراد', 'Freelancer trips'), 'freelancer')} />
      </div>

      <SalesRealisation data={d.salesRequests} ar={ar} title={t('تحقيق طلبات المبيعات في الفترة', 'Realisation of sales requests in the span')} />

      <div className="print:hidden"><VendorRegisterStats ar={ar} query={fq} /></div>

      {/* Team performance cards (sourcing / collection / assist) mount here as their own component. */}

      <Panel title={t('حسب اليوم', 'By day')} subtitle={t('المحقّق وغير المحقّق يوميًّا، والخطّ المتقطّع = المستهدَف', 'Fulfilled and not, daily; dashed line = target')}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={d.byDay.map((x: Row) => ({ ...x, label: x.day.slice(5) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
              <Bar dataKey="done" stackId="a" name={t('محقّق', 'Fulfilled')} fill="#10b981" />
              <Bar dataKey="failed" stackId="a" name={t('غير محقّق', 'Not fulfilled')} fill="#fca5a5" radius={[4, 4, 0, 0]} />
              <Line dataKey="fleet" name={t('أسطول تنشيط', 'Our fleet')} stroke="#64748b" strokeWidth={2} dot={false} />
              {d.target.daily ? <ReferenceLine y={d.target.daily} stroke={ORANGE} strokeDasharray="6 4" label={{ value: t('المستهدَف', 'Target'), fill: ORANGE, fontSize: 11 }} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <DataGrid ar={ar} rows={d.byDay} limit={40} rowKey={(r) => r.day} cols={[
          { key: 'day', label: t('اليوم', 'Day'), render: (r) => <span className="tabular-nums font-semibold">{r.day}</span> },
          { key: 'requests', label: t('طلبات', 'Requests'), num: true }, { key: 'done', label: t('محقّق', 'Done'), num: true }, { key: 'failed', label: t('غير محقّق', 'Failed'), num: true },
          { key: 'rate', label: t('التحقيق', 'Rate'), num: true, render: (r) => fmtPct(r.rate) },
          { key: 'vsTarget', label: t('مقابل المستهدَف', 'vs target'), num: true, render: (r) => (r.vsTarget != null ? <span className={r.vsTarget >= 100 ? 'text-emerald-700 font-semibold' : 'text-amber-700'}>{fmtPct(r.vsTarget)}</span> : '—') },
          ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'buyExt', label: t('بدون تنشيط', 'Excl. fleet'), num: true, render: (r: Row) => fmtMoney(r.buyExt) }] : []),
          { key: 'fleetShare', label: t('حصّة تنشيط', 'Fleet share'), num: true, render: (r) => fmtPct(r.fleetShare) },
        ]} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('حسب نوع المورّد', 'By carrier kind')} pad={false}>
          <DataGrid ar={ar} rows={d.kinds} rowKey={(r) => r.kind} cols={[
            { key: 'label', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
            { key: 'vendors', label: t('عدد الجهات', 'Carriers'), num: true }, { key: 'trips', label: t('رحلات', 'Trips'), num: true },
            { key: 'share', label: t('% الرحلات', '% trips'), num: true, render: (r) => fmtPct(r.share) },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'buyShare', label: t('% الشراء', '% purchase'), num: true, render: (r: Row) => fmtPct(r.buyShare) }, { key: 'avg', label: t('متوسط الرحلة', 'Avg trip'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
          ]} />
        </Panel>
        <Panel title={t('حسب نوع الدفع', 'By payment type')} pad={false}>
          <DataGrid ar={ar} rows={d.payments} rowKey={(r) => r.key} cols={[
            { key: 'key', label: t('النوع', 'Type'), render: (r) => (PAYMENT_SUBTYPES as any)[r.key]?.[ar ? 'ar' : 'en'] || r.key || t('غير محدّد', 'Not set') },
            { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'share', label: t('% الرحلات', '% trips'), num: true, render: (r) => fmtPct(r.share) },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
          ]} />
        </Panel>
      </div>

      <Panel title={t('مَن المسؤول عن عدم التحقيق', 'Who is behind the unfulfilled')} subtitle={t('أسباب الإلغاء في خمس خانات لكلّ فرع', 'Cancellation reasons in five buckets per branch')} pad={false}>
        <DataGrid ar={ar} rows={d.blame} rowKey={(r) => r.branch} cols={[
          { key: 'branch', label: t('الفرع', 'Branch'), render: (r) => <span className="font-semibold">{r.branch}</span> },
          { key: 'failed', label: t('غير محقّق', 'Failed'), num: true },
          ...BLAME.map(([k, a, e]) => ({ key: k, label: ar ? a : e, num: true, render: (r: Row) => <span className={r[k] ? '' : 'text-slate-300'}>{r[k] || '·'}</span> })),
          { key: 'repShare', label: t('% على المندوب', '% on the rep'), num: true, render: (r) => fmtPct(r.repShare) },
        ]} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('الشركات مقابل السائقين الأفراد حسب الفرع', 'Companies vs freelancers per branch')} subtitle={t('الهدف تقليل الاعتماد على الأفراد · مرتّبة بالأعلى اعتمادًا', 'Goal: less reliance on freelancers · most reliant first')} pad={false}>
          <DataGrid ar={ar} rows={d.branchKinds} rowKey={(r) => r.branch} cols={[
            { key: 'branch', label: t('الفرع', 'Branch'), render: (r) => <span className="font-semibold">{r.branch}</span> },
            { key: 'done', label: t('محقّق', 'Done'), num: true }, { key: 'fleet', label: t('أسطول تنشيط', 'Our fleet'), num: true },
            { key: 'companies', label: t('موردون (شركات)', 'Companies'), num: true }, { key: 'freelancer', label: t('أفراد', 'Freelancers'), num: true },
            { key: 'freelancerShareExt', label: t('% الأفراد من الخارجي', '% freelancers of external'), num: true, render: (r) => <span className={r.freelancerShareExt > (d.totals.freelancerShareExt || 0) ? 'text-red-600 font-bold' : 'text-emerald-700 font-semibold'}>{fmtPct(r.freelancerShareExt)}</span> },
          ]} />
        </Panel>
        <Panel title={t('أداء الفروع', 'Branch performance')} subtitle={t('مرتّبة حسب عدد الطلبات', 'By requests')} pad={false}>
          <DataGrid ar={ar} rows={d.branches} rowKey={(r) => r.branch} cols={[
            { key: 'branch', label: t('الفرع', 'Branch'), render: (r) => <button type="button" onClick={() => setBranch(r.branch === '—' ? '' : r.branch)} className="font-semibold hover:text-[#f37121]">{r.branch}</button> },
            { key: 'requests', label: t('طلبات', 'Requests'), num: true }, { key: 'done', label: t('محقّق', 'Done'), num: true }, { key: 'failed', label: t('غير محقّق', 'Failed'), num: true },
            { key: 'rate', label: t('التحقيق', 'Rate'), num: true, render: (r) => fmtPct(r.rate) }, { key: 'perDay', label: t('محقّق/يوم', 'Per day'), num: true },
            { key: 'vsTarget', label: t('مقابل المستهدَف', 'vs target'), num: true, render: (r) => (r.vsTarget != null ? fmtPct(r.vsTarget) : '—') },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }] : []),
            { key: 'topReason', label: t('أكبر سببٍ لعدم التحقيق', 'Top reason'), render: (r) => r.topReason || '—' },
          ]} />
        </Panel>
      </div>

      <Panel title={t('الطلبات حسب العميل', 'Requests by customer')}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {([['all', 'الكلّ', 'All'], ['full', 'تحقّق كاملًا', 'Fully'], ['partial', 'تحقّق جزئيًّا', 'Partly'], ['none', 'لم يتحقّق شيء', 'Not at all']] as const).map(([k, a, e]) => (
            <div key={k} className="rounded-xl border border-slate-200 px-3 py-2"><p className="text-[12px] font-semibold text-slate-600">{ar ? a : e}</p>
              <p className="text-lg font-extrabold tabular-nums">{fmtInt(d.customerCats[k].customers)} <span className="text-[12px] font-normal text-slate-500">{t('عميل', 'customers')} · {fmtInt(d.customerCats[k].requests)} {t('طلب', 'req')}</span></p></div>
          ))}
        </div>
        <DataGrid ar={ar} rows={d.customers} limit={20} rowKey={(r) => r.name} cols={[
          { key: 'name', label: t('العميل', 'Customer'), render: (r) => <span className="font-semibold">{r.name}</span> },
          { key: 'branch', label: t('الفرع', 'Branch') }, { key: 'sales', label: t('مندوب المبيعات', 'Sales rep'), render: (r) => r.sales || '—' },
          { key: 'requests', label: t('طلبات', 'Requests'), num: true }, { key: 'done', label: t('محقّق', 'Done'), num: true }, { key: 'failed', label: t('غير محقّق', 'Failed'), num: true },
          { key: 'rate', label: t('التحقيق', 'Rate'), num: true, render: (r) => <span className={r.rate < 70 ? 'text-red-600 font-semibold' : ''}>{fmtPct(r.rate)}</span> },
          { key: 'shareOfDone', label: t('% من المحقّق', '% of done'), num: true, render: (r) => fmtPct(r.shareOfDone) },
          { key: 'reasons', label: t('أسباب غير المحقّق', 'Reasons'), render: (r) => r.reasons.map((x: Row) => `${x.reason} (${x.n})`).join('، ') || '—' },
        ]} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={t('أعلى 10 موردين', 'Top 10 carriers')} subtitle={t('بدون أسطول تنشيط', 'Excluding our fleet')}>
          <BarList ar={ar} rows={d.topVendors.map((v: Row) => ({ key: v.name, label: v.name, value: v.trips, hint: fmtPct(v.share), sub: money ? `${t('شراء', 'purchase')} ${fmtMoney(v.buy)}` : undefined }))} limit={10} />
        </Panel>
        <Panel title={t('أعلى 10 سائقين أفراد', 'Top 10 freelancers')}>
          <BarList ar={ar} rows={d.topFreelancers.map((v: Row) => ({ key: v.name, label: v.name, value: v.trips, hint: fmtPct(v.share), sub: money ? `${t('شراء', 'purchase')} ${fmtMoney(v.buy)}` : undefined }))} limit={10} color="#0ea5e9" />
        </Panel>
        <Panel title={t('أعلى 10 مناديب تشغيل', 'Top 10 operations reps')} subtitle={t('تعميد المورّد · بدون أسطول تنشيط', 'Who appointed the carrier')}>
          <BarList ar={ar} rows={d.topOpsReps.map((v: Row) => ({ key: v.name, label: v.name, value: v.trips, hint: fmtPct(v.share) }))} limit={10} color="#8b5cf6" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('مَن ساعد في الرحلات المحقّقة؟ (فريق الموردين)', 'Who placed the fulfilled trips? (vendors team)')} subtitle={<>{t('من أنشأ أمر النقل من طلبات المبيعات أو سجّله من الفريق', 'From requests placed, or created by the team')} · <a href="#team-performance" className="font-semibold text-[#f37121] hover:underline">{t('التفاصيل: أداء الفريق', 'Details: team performance')}</a></>} pad={false}>
          <DataGrid ar={ar} rows={d.helpers} rowKey={(r) => r.name} empty={t('لا رحلات أسندها الفريق في الفترة', 'None in the period')} cols={[
            { key: 'name', label: t('المساعد', 'Team member'), render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'trips', label: t('رحلات محقّقة', 'Trips'), num: true }, { key: 'share', label: t('% من المحقّق', '% of done'), num: true, render: (r) => fmtPct(r.share) },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }] : []),
          ]} />
        </Panel>
        <Panel title={t('مندوبو التشغيل (تعميد المورّد)', 'Operations reps (carrier appointment)')} pad={false}>
          <DataGrid ar={ar} rows={d.opsReps} rowKey={(r) => r.name} cols={[
            { key: 'name', label: t('المندوب', 'Rep'), render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'shareExt', label: t('% الرحلات', '% trips'), num: true, render: (r) => fmtPct(r.shareExt) },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
          ]} />
        </Panel>
      </div>

      <TeamPerformance />

      <Panel title={t('المسارات التشغيلية وأسعارها', 'Operating routes and their prices')} subtitle={t('السعر (عدد الرحلات التي نُفّذت به) · البرتقالي = السعر الأكثر تكرارًا · أرخص مورّد = أقلّ سعر · أفضل مورّد = الأكثر رحلاتٍ بسعرٍ يساوي الأكثر تكرارًا أو أقل', 'Price (trips at it) · orange = most frequent · cheapest = lowest · best = most trips at or below the mode')}>
        <div className="flex flex-wrap gap-2 mb-3">
          {d.destinations.map((x: Row) => (
            <button key={x.to} type="button" onClick={() => setDest((v) => (v === x.to ? '' : x.to))}
              className={`rounded-xl border px-3 py-2 text-start ${dest === x.to ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 bg-white hover:border-[#f37121]/40'}`}>
              <p className="text-[13px] font-bold text-slate-900">{x.to}</p><p className="text-[11.5px] text-slate-500 tabular-nums">{fmtInt(x.n)} · {fmtPct(x.share)}</p>
            </button>
          ))}
          <div className="ms-auto min-w-[200px]"><SearchInput value={routeQ} onChange={setRouteQ} placeholder={t('بحث بالمسار…', 'Search route…')} /></div>
        </div>
        <div className="space-y-2">
          {routes.slice(0, 60).map((r: Row) => (
            <div key={r.route} className="rounded-xl border border-slate-200">
              <button type="button" onClick={() => setOpenRoute((v) => (v === r.route ? '' : r.route))} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-start hover:bg-slate-50">
                <span className="font-bold text-slate-900">{r.route}</span>
                <span className="text-[12px] text-slate-600 tabular-nums">{t('محقّق', 'done')} {r.done} · {t('أسطول', 'fleet')} {r.fleet} · {t('شركات', 'companies')} {r.companies} · {t('أفراد', 'freelancers')} {r.freelancer}</span>
                <span className="text-[12px] text-slate-500">{t('الجهات المنفّذة', 'executors')} {r.executors}</span>
                {money && r.cheapest && <span className="text-[12px] text-emerald-700">{t('أرخص', 'cheapest')}: {r.cheapest.name} ({fmtMoney(r.cheapest.price)})</span>}
                {r.best && <span className="text-[12px] text-sky-700">{t('أفضل', 'best')}: {r.best.name} ({r.best.trips})</span>}
              </button>
              {openRoute === r.route && money && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {r.prices.map((p: Row) => <span key={p.price} className={`rounded-lg border px-2 py-1 text-[12px] tabular-nums ${p.price === r.modePrice ? 'border-[#f37121] bg-[#f37121] text-white font-bold' : 'border-slate-200 bg-slate-50'}`}>{fmtMoney(p.price)} ({p.n})</span>)}
                  </div>
                  {!!r.fleetPrices.length && <p className="text-[12px] text-slate-600">{t('أسعار أسطول تنشيط', 'Our fleet prices')}: {r.fleetPrices.map((p: Row) => `${fmtMoney(p.price)} (${p.n})`).join(' · ')}</p>}
                </div>
              )}
            </div>
          ))}
          {!routes.length && <p className="py-6 text-center text-sm text-slate-400">{t('لا مسارات', 'No routes')}</p>}
        </div>
      </Panel>

      <Panel title={t('توزيع الشراء على الموردين', 'Purchase by carrier')} subtitle={t('حدّد موردين بالعلامة لجمعهم', 'Tick carriers to add them up')}
        actions={<>
          <select value={vendKind} onChange={(e) => setVendKind(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] bg-white">
            <option value="">{t('كلّ الأنواع', 'All kinds')}</option>{['master', 'outside', 'freelancer'].map((k) => <option key={k} value={k}>{kindLabel(k, ar)}</option>)}
          </select>
          <div className="w-52"><SearchInput value={vendQ} onChange={setVendQ} placeholder={t('بحث…', 'Search…')} /></div>
        </>} pad={false}>
        {picked.size > 0 && (
          <div className="px-4 py-2 bg-[#f37121]/5 border-b border-[#f37121]/20 text-[12.5px] font-semibold text-[#b9541a] flex items-center gap-3">
            {t(`المحدّد: ${picked.size} · ${fmtInt(pickedSum.trips)} رحلة`, `Selected: ${picked.size} · ${fmtInt(pickedSum.trips)} trips`)}{money ? ` · ${fmtMoney(pickedSum.buy)} ${t('ر.س', 'SAR')}` : ''}
            <button type="button" onClick={() => setPicked(new Set())} className="ms-auto text-slate-500 hover:text-slate-900">{t('مسح التحديد', 'Clear')}</button>
          </div>
        )}
        <DataGrid ar={ar} rows={vendRows} limit={25} rowKey={(r) => r.name} cols={[
          { key: 'pick', label: '✓', render: (r) => <input type="checkbox" checked={picked.has(r.name)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.name)) n.delete(r.name); else n.add(r.name); return n; })} className="accent-[#f37121]" /> },
          { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
          { key: 'kind', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
          { key: 'payment', label: t('الدفع', 'Payment'), render: (r) => (PAYMENT_SUBTYPES as any)[r.payment]?.[ar ? 'ar' : 'en'] || r.payment || '—' },
          { key: 'branch', label: t('الفرع', 'Branch') }, { key: 'trips', label: t('رحلات', 'Trips'), num: true },
          ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'share', label: t('% من الإجمالي', '% of total'), num: true, render: (r: Row) => fmtPct(r.share) }, { key: 'avg', label: t('متوسط الرحلة', 'Avg trip'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
        ]} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('أسطول تنشيط حسب الفرع', 'Our fleet by branch')} pad={false}>
          <DataGrid ar={ar} rows={d.fleet.branches} rowKey={(r) => r.branch} cols={[
            { key: 'branch', label: t('الفرع', 'Branch') }, { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'share', label: t('% من رحلات الفرع', '% of branch'), num: true, render: (r) => fmtPct(r.share) },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }] : []),
          ]} />
        </Panel>
        <Panel title={t('أسطول تنشيط حسب العميل', 'Our fleet by customer')} pad={false}>
          <DataGrid ar={ar} rows={d.fleet.customers} rowKey={(r) => r.name} cols={[
            { key: 'name', label: t('العميل', 'Customer') }, { key: 'trips', label: t('رحلات', 'Trips'), num: true },
            ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }] : []),
          ]} />
        </Panel>
      </div>
      <DrillModal drill={drill} onClose={() => setDrill(null)} ar={ar} />
    </div>
  );
}
