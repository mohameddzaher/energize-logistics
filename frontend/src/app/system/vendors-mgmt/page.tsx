'use client';
/**
 * Vendors management — the section's analysis: the master carriers, who works and who stopped, how many carriers are
 * activated each month, the team's results, and the share of external trips the master carries. Read as of the end of
 * a chosen month, computed live from the shipments.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Kpi, Panel, BarList, DataGrid, TrendChip, LiveDot, fmtInt, fmtMoney, fmtPct, fmtDay, ORANGE, trendLabel } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, monthName, contractTone, vendorHref } from '@/lib/vendors';
import VendorFilters, { vendorFilterQuery, type VendorFilterState } from '@/components/vendors/VendorFilters';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Building2 } from 'lucide-react';

type Row = Record<string, any>;

export default function VendorsOverviewPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const now = new Date(Date.now() + 3 * 3600000);
  const [month, setMonth] = useState(now.toISOString().slice(0, 7));
  const [d, setD] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actMonth, setActMonth] = useState<number | null>(null);
  const [filters, setFilters] = useState<VendorFilterState>({});
  const fq = vendorFilterQuery(filters);
  const lastDay = (() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();

  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await api.get<Row>(`/api/vendors-mgmt/overview?month=${month}${fq ? `&${fq}` : ''}`); setD(r); setError(''); setActMonth((m) => m ?? r.curMonth); }
    catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, fq]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1200); }, [load]);
  useSocket('shipmentOrders:updated', soon);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:fleet', soon);
  useSocket('shipmentRequests:changed', soon);

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const K = d.kpis;
  const cm = d.curMonth;
  const months = d.months.filter((m: Row) => m.month <= cm).map((m: Row) => ({ ...m, name: monthName(m.month, ar) }));
  const act = d.activations.find((a: Row) => a.month === (actMonth || cm)) || d.activations[cm - 1];
  const trendRows = ['up', 'steady', 'down', 'new', 'stopped', 'never'].map((k) => ({ key: k, label: trendLabel(k, ar), value: d.trendMaster[k] || 0 }));

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Building2 className="w-6 h-6 text-[#f37121]" />} title={t('تحليل قسم الموردين', 'Vendors analysis')}
        subtitle={t('الموردون المعتمدون ونشاطُهم والتنشيطُ الشهريّ وأداءُ الفريق — من الشحنات مباشرة', 'Master carriers, their activity, monthly activations and the team — straight from the shipments')}>
        <LiveDot ar={ar} busy={busy} />
        <input type="month" value={month} max={now.toISOString().slice(0, 7)} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setActMonth(null); } }}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm [color-scheme:light]" />
        <ExportMenu fileName="vendors-analysis" lang={ar ? 'ar' : 'en'} options={[{
          key: 'all', label: t('كلّ الجداول', 'All tables'), sheets: [
            { name: t('الفريق', 'Team'), rows: d.team, columns: [{ header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('الموردون المعتمدون', 'Master'), key: 'vendors' }, { header: t('نشطون 3 أشهر', 'Active 3m'), key: 'active3' }, { header: t('% النشاط', 'Activity %'), key: 'activity' }, { header: t('رحلات', 'Trips'), key: 'trips' }, { header: t('موقّعون', 'Signed'), key: 'signed' }, { header: t('موقّعون غير نشطين', 'Signed inactive'), key: 'signedInactive' }] },
            { name: t('النشطون آخر 3 أشهر', 'Active last 3 months'), rows: d.activeLast3List, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('حالة العقد', 'Contract'), key: 'contractStatus' }, { header: t('رحلات العام', 'Trips'), key: 'trips' }, { header: t('رحلات الشهر', 'Month'), key: 'month' }, { header: t('الحالة', 'Trend'), key: 'trend', transform: (v: string) => trendLabel(v, ar) }, { header: t('آخر رحلة', 'Last'), key: 'last' }] },
            { name: t('موقّعون غير نشطين', 'Signed inactive'), rows: d.signedInactiveList, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('رحلات العام', 'Trips'), key: 'trips' }, { header: t('آخر رحلة', 'Last'), key: 'last' }, { header: t('الجوال', 'Phone'), key: 'phone' }, { header: t('المقر', 'HQ'), key: 'headOffice' }] },
            ...d.activations.filter((a: Row) => a.total).map((a: Row) => ({ name: `${t('تنشيط', 'Activated')} ${monthName(a.month, ar)}`, rows: a.list, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('أوّل رحلة', 'First trip'), key: 'first' }, { header: t('رحلات الشهر', 'Month trips'), key: 'monthTrips' }] })),
          ],
        }]} />
      </PageHeader>

      <VendorFilters value={filters} onChange={setFilters} from={`${month.slice(0, 4)}-01-01`} to={lastDay} ar={ar} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi ar={ar} label={t('الموردون المعتمدون', 'Master carriers')} value={fmtInt(K.masterVendors)} />
        <Kpi ar={ar} label={t('نشطون آخر 3 أشهر', 'Active last 3 months')} value={fmtInt(K.masterActive3)} tone="good" sub={fmtPct((K.masterActive3 / Math.max(1, K.masterVendors)) * 100)} />
        <Kpi ar={ar} label={t(`نشطون في ${monthName(cm, true)}`, `Active in ${monthName(cm, false)}`)} value={fmtInt(K.masterActiveMonth)} tone="brand" />
        <Kpi ar={ar} label={t('موقّعو العقد', 'Signed contracts')} value={fmtInt(K.masterSigned)} sub={t(`منهم غير نشطين ${K.signedInactive}`, `${K.signedInactive} inactive`)} />
        <Kpi ar={ar} label={t('نشطون دون عقد', 'Active, unsigned')} value={fmtInt(K.activeUnsigned)} tone={K.activeUnsigned ? 'warn' : undefined} />
        <Kpi ar={ar} label={t('متوقفون', 'Stopped')} value={fmtInt(K.masterStopped)} tone="bad" sub={t(`لم يعمل ${K.masterNever} هذا العام`, `${K.masterNever} never this year`)} />
        <Kpi ar={ar} label={t('حصّة المعتمدين من التشغيل الخارجي', 'Master share of external trips')} value={fmtPct(K.masterShare)} tone="brand" />
        <Kpi ar={ar} label={t('رحلاتُ التشغيل الخارجي', 'External trips')} value={fmtInt(K.externalTrips)} sub={t(`أسطول تنشيط ${fmtInt(K.fleetTrips)}`, `Our fleet ${fmtInt(K.fleetTrips)}`)} />
        {K.purchase != null && <Kpi ar={ar} label={t('مشتريات الموردين', 'Purchase from carriers')} value={fmtMoney(K.purchase)} sub={t(`متوسط ${fmtMoney(K.avgTrip)} للرحلة`, `avg ${fmtMoney(K.avgTrip)}/trip`)} />}
        <Kpi ar={ar} label={t('موردون نشطون غير معتمدين', 'Active outside the master')} value={fmtInt(K.leadsActive3)} tone="warn" sub={t('مرشَّحون للاعتماد', 'leads to register')} />
        <Kpi ar={ar} label={t('سائقون أفراد نشطون', 'Active freelancers')} value={fmtInt(K.freelancersActive3)} />
        <Kpi ar={ar} label={t(`تنشيطٌ جديد في ${monthName(cm, true)}`, `New in ${monthName(cm, false)}`)} value={fmtInt(K.newThisMonth)} tone="good" onClick={() => setActMonth(cm)} />
      </div>

      <Panel title={t('الرحلات شهرًا بشهر حسب نوع المورّد', 'Trips per month by carrier kind')} subtitle={t('الخطّ = حصّة المعتمدين من التشغيل الخارجي (بدون أسطول تنشيط)', 'Line = master share of external trips (excluding our fleet)')}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={months}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis yAxisId="n" tick={{ fontSize: 11 }} /><YAxis yAxisId="p" orientation="right" unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
              <Tooltip /><Legend />
              <Bar yAxisId="n" dataKey="master" stackId="k" name={t('معتمدون', 'Approved')} fill={KIND.master.color} />
              <Bar yAxisId="n" dataKey="outside" stackId="k" name={t('غير معتمد', 'Outside')} fill={KIND.outside.color} />
              <Bar yAxisId="n" dataKey="freelancer" stackId="k" name={t('أفراد', 'Freelancers')} fill={KIND.freelancer.color} />
              <Bar yAxisId="n" dataKey="fleet" stackId="k" name={t('أسطول تنشيط', 'Our fleet')} fill={KIND.fleet.color} radius={[6, 6, 0, 0]} />
              <Line yAxisId="p" type="monotone" dataKey="masterShare" name={t('حصّة المعتمدين %', 'Master share %')} stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3.5, fill: '#fff', stroke: '#0ea5e9', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={t('التنشيط الشهريّ', 'Monthly activations')} subtitle={t('موردون أوّلُ رحلةٍ لهم على الإطلاق في الشهر — اضغط شهرًا لعرض أسمائهم', 'Carriers whose first ever trip fell in the month — press a month')}>
          <BarList ar={ar} rows={d.activations.filter((a: Row) => a.month <= cm).map((a: Row) => ({ key: String(a.month), label: monthName(a.month, ar), value: a.total, hint: t(`معتمدون ${a.master || 0}`, `master ${a.master || 0}`) }))}
            onPick={(k) => setActMonth(Number(k))} limit={12} color="#10b981" />
        </Panel>
        <Panel className="lg:col-span-2" title={t(`موردون أوّلُ تشغيلٍ لهم في ${monthName(act?.month || cm, true)}`, `First run in ${monthName(act?.month || cm, false)}`)} subtitle={t(`${act?.total || 0} مورّد`, `${act?.total || 0} carriers`)} pad={false}>
          <DataGrid ar={ar} rows={act?.list || []} limit={20} rowKey={(r) => `${r.name}`}
            cols={[
              { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
              { key: 'kind', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
              { key: 'owner', label: t('مسؤول المتابعة', 'Owner'), render: (r) => r.owner || '—' },
              { key: 'first', label: t('أوّل رحلة', 'First trip'), render: (r) => <span className="tabular-nums">{r.first}</span> },
              { key: 'monthTrips', label: t('رحلات الشهر', 'Month trips'), num: true },
              { key: 'trips', label: t('رحلات العام', 'Year trips'), num: true },
            ]} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title={t('أداء الفريق على الموردين المعتمدين', 'Team results on master carriers')} subtitle={t('النشط = له رحلةٌ في آخر 3 أشهر', 'Active = a trip in the last 3 months')} pad={false}>
          <DataGrid ar={ar} rows={d.team} rowKey={(r) => r.owner}
            cols={[
              { key: 'owner', label: t('مسؤول المتابعة', 'Owner'), render: (r) => <span className="font-semibold">{r.owner}</span> },
              { key: 'vendors', label: t('الموردون المعتمدون', 'Master'), num: true },
              { key: 'active3', label: t('نشطون', 'Active'), num: true },
              { key: 'activity', label: t('% النشاط', 'Activity'), num: true, render: (r) => <span className={r.activity >= 50 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{fmtPct(r.activity)}</span> },
              { key: 'activeMonth', label: t('نشطون هذا الشهر', 'This month'), num: true },
              { key: 'trips', label: t('رحلات العام', 'Trips'), num: true },
              { key: 'tripsShare', label: t('% من رحلات المعتمدين', '% of master trips'), num: true, render: (r) => fmtPct(r.tripsShare) },
              { key: 'stopped', label: t('توقّفوا', 'Stopped'), num: true },
              { key: 'never', label: t('لم يعملوا', 'Never'), num: true },
              { key: 'signedActive', label: t('موقّعون نشطون', 'Signed active'), num: true },
              { key: 'signedInactive', label: t('موقّعون غير نشطين', 'Signed inactive'), num: true },
            ]} />
        </Panel>
        <Panel title={t('حالة الموردين المعتمدين', 'Master carriers trend')} subtitle={t('متوسط آخر 3 أشهر مقابل ما قبلها (±20٪)', 'Last 3 months vs before (±20%)')}>
          <BarList ar={ar} rows={trendRows} limit={6} color="#8b5cf6" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={t('أنواع الموردين هذا العام', 'Carrier kinds this year')}>
          <BarList ar={ar} rows={d.kinds.map((k: Row) => ({ key: k.kind, label: k.label, value: k.trips, hint: fmtPct(k.share), sub: t(`${k.vendors} مورّد · ${k.active3} نشط`, `${k.vendors} carriers · ${k.active3} active`) }))} />
        </Panel>
        <Panel title={t('حالة التعاقد', 'Contract status')}>
          <BarList ar={ar} rows={Object.entries(d.contractStatus).map(([k, v]) => ({ key: k, label: k, value: v as number })).sort((a, b) => b.value - a.value)} color="#0ea5e9" />
        </Panel>
        <Panel title={t('التصنيف الضريبي', 'Tax classification')}>
          <BarList ar={ar} rows={Object.entries(d.taxClass).map(([k, v]) => ({ key: k, label: k, value: v as number })).sort((a, b) => b.value - a.value)} color="#14b8a6" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title={t('الموردون المعتمدون النشطون (آخر 3 أشهر)', 'Active master carriers (last 3 months)')} subtitle={t(`${d.activeLast3List.length} مورّد`, `${d.activeLast3List.length} carriers`)} pad={false}>
          <DataGrid ar={ar} rows={d.activeLast3List} rowKey={(r) => r.id}
            cols={[
              { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
              { key: 'owner', label: t('المتابعة', 'Owner') },
              { key: 'contractStatus', label: t('العقد', 'Contract'), render: (r) => r.contractStatus ? <span className={`px-2 py-0.5 rounded-full border text-[11px] ${contractTone(r.contractStatus)}`}>{r.contractStatus}</span> : '—' },
              { key: 'month', label: t('الشهر', 'Month'), num: true },
              { key: 'trips', label: t('العام', 'Year'), num: true },
              { key: 'trend', label: t('الحالة', 'Trend'), render: (r) => <TrendChip t={r.trend} ar={ar} /> },
              { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last) },
            ]} />
        </Panel>
        <Panel title={t('موقّعون وغير نشطين', 'Signed but inactive')} subtitle={t('عقدُهم موقّع ولا رحلات لهم في آخر 3 أشهر — الأولى بالمتابعة', 'Signed, no trips in 3 months — follow them up first')} pad={false}>
          <DataGrid ar={ar} rows={d.signedInactiveList} rowKey={(r) => r.id}
            cols={[
              { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
              { key: 'owner', label: t('المتابعة', 'Owner') },
              { key: 'trips', label: t('رحلات العام', 'Year trips'), num: true },
              { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last) },
              { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—' },
              { key: 'headOffice', label: t('المقر', 'HQ') },
            ]} />
        </Panel>
      </div>

      <Panel title={t('أعلى الموردين تشغيلًا هذا العام', 'Top carriers this year')} pad={false}>
        <DataGrid ar={ar} rows={d.topVendors} rowKey={(r) => `${r.name}`}
          cols={[
            { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
            { key: 'kind', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
            { key: 'trips', label: t('رحلات العام', 'Year trips'), num: true },
            { key: 'month', label: t('رحلات الشهر', 'Month trips'), num: true },
            ...(d.topVendors[0]?.buy != null ? [{ key: 'buy', label: t('المشتريات', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }] : []),
            { key: 'trend', label: t('الحالة', 'Trend'), render: (r) => <TrendChip t={r.trend} ar={ar} /> },
            { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last) },
          ]} />
      </Panel>
    </div>
  );
}
