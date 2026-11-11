'use client';
/**
 * Vendors management — the section's analysis, every figure from work done on the system: approved carriers (approval
 * action), contracts (saveContract), follow-ups (the team's log) and trips (shipment orders). Read as of the end of a
 * chosen month; "active" uses the section's inactivity window. Every card opens its list.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Kpi, Panel, BarList, DataGrid, TrendChip, LiveDot, fmtInt, fmtMoney, fmtPct, fmtDay, ORANGE, trendLabel } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, monthName, vendorHref } from '@/lib/vendors';
import VendorFilters, { vendorFilterQuery, type VendorFilterState } from '@/components/vendors/VendorFilters';
import { DrillModal, drillCols, followUpCols, contractStateLabel, type Drill } from '@/components/vendors/VendorDrill';
import VendorRegisterStats from '@/components/vendors/VendorRegisterStats';
import VendorRanking from '@/components/vendors/VendorRanking';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Building2 } from 'lucide-react';
import TeamPerformance from '@/components/vendors/TeamPerformance';

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
  const [drill, setDrill] = useState<Drill | null>(null);
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
  useSocket('workflow:bulkImported', soon);

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const K = d.kpis;
  const cm = d.curMonth;
  const N = d.inactiveDays;
  const months = d.months.filter((m: Row) => m.month <= cm).map((m: Row) => ({ ...m, name: monthName(m.month, ar) }));
  const act = d.activations.find((a: Row) => a.month === (actMonth || cm)) || d.activations[cm - 1];
  // Every card opens the list it counts; each list exports to Excel from the modal.
  const C = drillCols(ar);
  const masterCols = [C.name, C.owner, C.contractState, C.month, C.trips, C.last, C.daysIdle];
  const extCols = [C.name, C.kind, C.owner, C.month, C.trips, C.trend, C.last, C.daysIdle];
  const buyCols = [C.name, C.kind, C.trips, { key: 'buy', label: t('المشتريات', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, C.last];
  const actCols = [C.name, C.kind, C.owner, { key: 'first', label: t('أوّل رحلة', 'First trip'), render: (r: Row) => <span className="tabular-nums">{r.first}</span> }, { key: 'monthTrips', label: t('رحلات الشهر', 'Month trips'), num: true }, C.trips];
  const pendCols = [C.name, C.kind, { key: 'approvalStatus', label: t('الحالة', 'State'), render: (r: Row) => (r.approvalStatus === 'returned' ? t('مُعاد للتعديل', 'Returned') : t('بانتظار الاعتماد', 'Pending')) }, { key: 'submittedByName', label: t('قدّمه', 'Submitted by') }, { key: 'submittedAt', label: t('تاريخ التقديم', 'Submitted') }];
  const M: Row[] = d.masterList || [];
  const X: Row[] = d.extActiveList || [];
  const show = (title: string, rows: Row[], cols: any[] = masterCols) => setDrill({ title, rows, cols, fileName: 'vendors-analysis-list' });
  const trendRows = ['up', 'steady', 'down', 'new', 'stopped', 'never'].map((k) => ({ key: k, label: trendLabel(k, ar), value: d.trendMaster[k] || 0 }));
  const inactiveLabel = t(`غير نشطين (${N} يومًا بلا رحلة)`, `Inactive (${N} days without a trip)`);

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Building2 className="w-6 h-6 text-[#f37121]" />} title={t('تحليل قسم الموردين', 'Vendors analysis')}
        subtitle={t(`من عمل النظام: الاعتماد والعقود والمتابعات وأوامر النقل · النشط = له رحلةٌ منفّذة خلال ${N} يومًا (من إعدادات القسم)`, `From work on the system: approvals, contracts, follow-ups and orders · active = an executed trip within ${N} days (section settings)`)}>
        <LiveDot ar={ar} busy={busy} />
        <input type="month" value={month} max={now.toISOString().slice(0, 7)} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setActMonth(null); } }}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm [color-scheme:light]" />
        <ExportMenu fileName="vendors-analysis" lang={ar ? 'ar' : 'en'} options={[{
          key: 'all', label: t('كلّ الجداول', 'All tables'), sheets: [
            { name: t('الفريق', 'Team'), rows: d.team, columns: [{ header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('الموردون المعتمدون', 'Approved'), key: 'vendors' }, { header: t('نشطون', 'Active'), key: 'active' }, { header: t('% النشاط', 'Activity %'), key: 'activity' }, { header: t('غير نشطين', 'Inactive'), key: 'inactive' }, { header: t('رحلات', 'Trips'), key: 'trips' }, { header: t('متعاقَدٌ معهم', 'Contracted'), key: 'signed' }, { header: t('متابعات الشهر', 'Follow-ups'), key: 'followUps' }, { header: t('متابعات مستحقّة', 'Due'), key: 'due' }] },
            { name: t('الموردون المعتمدون', 'Approved carriers'), rows: M, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('حالة العقد', 'Contract'), key: 'contractState', transform: (v: string) => contractStateLabel(v, ar) }, { header: t('رحلات العام', 'Trips'), key: 'trips' }, { header: t('رحلات الشهر', 'Month'), key: 'month' }, { header: t('آخر رحلة', 'Last'), key: 'last' }, { header: t('أيام بلا رحلة', 'Days idle'), key: 'daysIdle' }, { header: t('نشط', 'Active'), key: 'active', transform: (v: boolean) => (v ? t('نعم', 'Yes') : t('لا', 'No')) }] },
            { name: t('متابعات الشهر', 'Follow-ups'), rows: d.followUps, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('التاريخ', 'Date'), key: 'at' }, { header: t('بواسطة', 'By'), key: 'byName' }, { header: t('النتيجة', 'Outcome'), key: 'outcome' }, { header: t('التالية', 'Next'), key: 'nextAt' }] },
            ...d.activations.filter((a: Row) => a.total).map((a: Row) => ({ name: `${t('تنشيط', 'Activated')} ${monthName(a.month, ar)}`, rows: a.list, columns: [{ header: t('المورد', 'Vendor'), key: 'name' }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('أوّل رحلة', 'First trip'), key: 'first' }, { header: t('رحلات الشهر', 'Month trips'), key: 'monthTrips' }] })),
          ],
        }]} />
      </PageHeader>

      <VendorFilters value={filters} onChange={setFilters} from={`${month.slice(0, 4)}-01-01`} to={lastDay} ar={ar} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi ar={ar} label={t('الموردون المعتمدون', 'Approved carriers')} value={fmtInt(K.masterVendors)} sub={t('اعتمادٌ على النظام', 'approved on the system')} onClick={() => show(t('الموردون المعتمدون', 'Approved carriers'), M)} />
        <Kpi ar={ar} label={t(`نشطون (${N} يومًا)`, `Active (${N} days)`)} value={fmtInt(K.masterActive)} tone="good" sub={fmtPct((K.masterActive / Math.max(1, K.masterVendors)) * 100)} onClick={() => show(t(`معتمدون لهم رحلةٌ خلال ${N} يومًا`, `Approved with a trip within ${N} days`), M.filter((m) => m.active))} />
        <Kpi ar={ar} label={inactiveLabel} value={fmtInt(K.masterInactive)} tone={K.masterInactive ? 'bad' : undefined} sub={t(`منهم لم يعملوا قطّ ${K.masterNeverWorked}`, `${K.masterNeverWorked} never worked`)} onClick={() => show(inactiveLabel, M.filter((m) => !m.active).sort((a, b) => (b.daysIdle ?? 99999) - (a.daysIdle ?? 99999)))} />
        <Kpi ar={ar} label={t(`نشطون في ${monthName(cm, true)}`, `Active in ${monthName(cm, false)}`)} value={fmtInt(K.masterActiveMonth)} tone="brand" onClick={() => show(t(`معتمدون عملوا في ${monthName(cm, true)}`, `Approved active in ${monthName(cm, false)}`), M.filter((m) => m.activeThisMonth))} />
        <Kpi ar={ar} label={t('متعاقَدٌ معهم رسميًّا', 'Officially contracted')} value={fmtInt(K.masterSigned)} sub={t(`منهم غير نشطين ${K.signedInactive}`, `${K.signedInactive} inactive`)} onClick={() => show(t('معتمدون متعاقَدٌ معهم (عقدٌ مسجَّلٌ على النظام)', 'Approved, contract recorded on the system'), M.filter((m) => m.contracted))} />
        <Kpi ar={ar} label={t('نشطون دون عقد', 'Active, no contract')} value={fmtInt(K.activeUnsigned)} tone={K.activeUnsigned ? 'warn' : undefined} onClick={() => show(t('نشطون دون عقدٍ مسجَّل', 'Active, no contract recorded'), M.filter((m) => !m.contracted && m.active))} />
        <Kpi ar={ar} label={t('حصّة المعتمدين من التشغيل الخارجي', 'Approved share of external trips')} value={fmtPct(K.masterShare)} tone="brand" onClick={() => show(t('المعتمدون الذين عملوا هذا العام', 'Approved carriers that worked this year'), M.filter((m) => m.trips > 0))} />
        <Kpi ar={ar} label={t('رحلاتُ التشغيل الخارجي', 'External trips')} value={fmtInt(K.externalTrips)} sub={t(`أسطول تنشيط ${fmtInt(K.fleetTrips)}`, `Our fleet ${fmtInt(K.fleetTrips)}`)} onClick={() => show(t('الموردون الذين عملوا هذا العام', 'Carriers that worked this year'), d.extYearList, extCols)} />
        {K.purchase != null && <Kpi ar={ar} label={t('مشتريات الموردين', 'Purchase from carriers')} value={fmtMoney(K.purchase)} sub={t(`متوسط ${fmtMoney(K.avgTrip)} للرحلة`, `avg ${fmtMoney(K.avgTrip)}/trip`)} onClick={() => show(t('المشتريات حسب المورّد', 'Purchase by carrier'), d.extYearList.slice().sort((a: Row, b: Row) => (b.buy || 0) - (a.buy || 0)), buyCols)} />}
        <Kpi ar={ar} label={t('شركاتٌ نشطة غير معتمدة', 'Active, not approved')} value={fmtInt(K.leadsActive)} tone="warn" sub={t('تُقدَّم للاعتماد', 'submit for approval')} onClick={() => show(t(`شركاتٌ غير معتمدة لها رحلةٌ خلال ${N} يومًا`, `Not approved, a trip within ${N} days`), X.filter((v) => v.kind === 'outside'), extCols)} />
        <Kpi ar={ar} label={t('سائقون أفراد نشطون', 'Active freelancers')} value={fmtInt(K.freelancersActive)} onClick={() => show(t(`سائقون أفراد لهم رحلةٌ خلال ${N} يومًا`, `Freelancers with a trip within ${N} days`), X.filter((v) => v.kind === 'freelancer'), extCols)} />
        <Kpi ar={ar} label={t('بانتظار الاعتماد', 'Awaiting approval')} value={fmtInt(K.pendingApproval)} tone={K.pendingApproval ? 'warn' : 'muted'} sub={t('يُقرّرها مديرُ العمليات ومن يفوّضه', 'decided by the operations manager or delegates')} onClick={() => show(t('موردون بانتظار الاعتماد أو مُعادون للتعديل', 'Awaiting approval or returned'), d.pendingList, pendCols)} />
        <Kpi ar={ar} label={t(`تنشيطٌ جديد في ${monthName(cm, true)}`, `New in ${monthName(cm, false)}`)} value={fmtInt(K.newThisMonth)} tone="good" sub={t('أوّلُ رحلةٍ على الإطلاق', 'first ever trip')} onClick={() => show(t(`موردون أوّلُ رحلةٍ لهم في ${monthName(cm, true)}`, `First ever trip in ${monthName(cm, false)}`), d.activations[cm - 1]?.list || [], actCols)} />
        <Kpi ar={ar} label={t('متابعاتُ الشهر', 'Follow-ups this month')} value={fmtInt(K.followUpsMonth)} sub={t(`على ${K.followedMonth} مورّد`, `${K.followedMonth} carriers`)} onClick={() => show(t('متابعاتٌ سجّلها الفريق هذا الشهر', 'Follow-ups logged this month'), d.followUps, followUpCols(ar))} />
        <Kpi ar={ar} label={t('متابعاتٌ مستحقّة', 'Follow-ups due')} value={fmtInt(K.followUpsDue)} tone={K.followUpsDue ? 'bad' : 'muted'} sub={t('حلّ موعدُها دون متابعةٍ أحدث', 'next date passed, nothing newer')} onClick={() => show(t('متابعاتٌ حلّ موعدها', 'Follow-ups due'), d.followUpsDue, followUpCols(ar))} />
      </div>

      <VendorRegisterStats ar={ar} query={fq} />

      {/* Team performance cards (sourcing / collection / assist) mount here as their own component. */}

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

      <VendorRanking ar={ar} query={fq} month={month} />

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
        <Panel className="lg:col-span-2" title={t('أداء الفريق على الموردين المعتمدين', 'Team results on approved carriers')} subtitle={t(`حسب مسؤول المتابعة المسنَد على النظام · النشط = رحلةٌ خلال ${N} يومًا · المتابعات من سجلّ الفريق`, `By the owner assigned on the system · active = a trip within ${N} days · follow-ups from the team's log`)} pad={false}>
          <DataGrid ar={ar} rows={d.team} rowKey={(r) => r.owner}
            cols={[
              { key: 'owner', label: t('مسؤول المتابعة', 'Owner'), render: (r) => <span className="font-semibold">{r.owner}</span> },
              { key: 'vendors', label: t('المعتمدون', 'Approved'), num: true, render: (r) => <button type="button" className="hover:text-[#f37121]" onClick={() => show(`${r.owner}: ${t('الموردون المعتمدون', 'approved carriers')}`, M.filter((m) => (m.owner || 'غير موزَّع') === r.owner))}>{r.vendors}</button> },
              { key: 'active', label: t('نشطون', 'Active'), num: true },
              { key: 'activity', label: t('% النشاط', 'Activity'), num: true, render: (r) => <span className={r.activity >= 50 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{fmtPct(r.activity)}</span> },
              { key: 'inactive', label: t('غير نشطين', 'Inactive'), num: true, render: (r) => <button type="button" className="hover:text-[#f37121]" onClick={() => show(`${r.owner}: ${inactiveLabel}`, M.filter((m) => (m.owner || 'غير موزَّع') === r.owner && !m.active))}>{r.inactive}</button> },
              { key: 'activeMonth', label: t('نشطون هذا الشهر', 'This month'), num: true },
              { key: 'trips', label: t('رحلات العام', 'Trips'), num: true },
              { key: 'tripsShare', label: t('% من رحلات المعتمدين', '% of approved trips'), num: true, render: (r) => fmtPct(r.tripsShare) },
              { key: 'signed', label: t('متعاقَدٌ معهم', 'Contracted'), num: true },
              { key: 'followUps', label: t('متابعات الشهر', 'Follow-ups'), num: true, render: (r) => <button type="button" className="hover:text-[#f37121]" onClick={() => show(`${r.owner}: ${t('متابعات الشهر', 'follow-ups')}`, d.followUps.filter((f: Row) => (f.owner || 'غير موزَّع') === r.owner), followUpCols(ar))}>{r.followUps}</button> },
              { key: 'due', label: t('مستحقّة', 'Due'), num: true, render: (r) => <button type="button" className={r.due ? 'text-red-600 font-semibold hover:underline' : 'text-slate-400'} onClick={() => show(`${r.owner}: ${t('متابعاتٌ مستحقّة', 'follow-ups due')}`, d.followUpsDue.filter((f: Row) => (f.owner || 'غير موزَّع') === r.owner), followUpCols(ar))}>{r.due}</button> },
            ]} />
        </Panel>
        <Panel title={t('اتجاه الموردين المعتمدين', 'Approved carriers trend')} subtitle={t('متوسط آخر 3 أشهر مقابل ما قبلها (±20٪) · اضغط حالةً لعرض موردِيها', 'Last 3 months vs before (±20%) · press one for its list')}>
          <BarList ar={ar} rows={trendRows} limit={6} color="#8b5cf6" onPick={(k) => show(`${t('الاتجاه', 'Trend')}: ${trendLabel(k, ar)}`, M.filter((m) => m.trend === k))} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={t('أنواع الموردين هذا العام', 'Carrier kinds this year')} subtitle={t('اضغط نوعًا لعرض موردِيه', 'Press a kind for its list')}>
          <BarList ar={ar} rows={d.kinds.map((k: Row) => ({ key: k.kind, label: kindLabel(k.kind, ar), value: k.trips, hint: fmtPct(k.share), sub: t(`${k.vendors} مورّد · ${k.active} نشط`, `${k.vendors} carriers · ${k.active} active`) }))}
            onPick={(k) => show(kindLabel(k, ar), d.extYearList.filter((v: Row) => v.kind === k), extCols)} />
        </Panel>
        <Panel className="lg:col-span-2" title={t('متابعات الفريق هذا الشهر', 'Team follow-ups this month')} subtitle={t('ما سجّله كلُّ عضوٍ على النظام (دون ملاحظات الاستيراد) · اضغط اسمًا لعرض متابعاته', 'Logged on the system (imported notes excluded) · press a name for the list')}>
          {d.followUpsByMember.length
            ? <BarList ar={ar} rows={d.followUpsByMember.map((x: Row) => ({ key: x.name, label: x.name, value: x.followUps, sub: t(`${x.carriers} مورّد`, `${x.carriers} carriers`) }))} color="#0ea5e9"
              onPick={(k) => show(`${k}: ${t('متابعات الشهر', 'follow-ups')}`, d.followUps.filter((f: Row) => (f.byName || '—') === k), followUpCols(ar))} />
            : <p className="py-6 text-center text-sm text-slate-400">{t('لم تُسجَّل متابعاتٌ هذا الشهر', 'No follow-ups logged this month')}</p>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title={t(`الموردون المعتمدون النشطون (${N} يومًا)`, `Active approved carriers (${N} days)`)} subtitle={t(`${M.filter((m) => m.active).length} مورّد`, `${M.filter((m) => m.active).length} carriers`)} pad={false}>
          <DataGrid ar={ar} rows={M.filter((m) => m.active)} rowKey={(r) => r.id} cols={[C.name, C.owner, C.contractState, C.month, { ...C.trips, label: t('العام', 'Year') }, { key: 'trend', label: t('الحالة', 'Trend'), render: (r: Row) => <TrendChip t={r.trend} ar={ar} /> }, C.last]} />
        </Panel>
        <Panel title={t('متعاقَدٌ معهم وغير نشطين', 'Contracted but inactive')} subtitle={t(`عقدُهم مسجَّلٌ على النظام ولا رحلة لهم خلال ${N} يومًا — الأولى بالمتابعة`, `Contract recorded, no trip in ${N} days — follow them up first`)} pad={false}>
          <DataGrid ar={ar} rows={M.filter((m) => m.contracted && !m.active)} rowKey={(r) => r.id}
            cols={[C.name, C.owner, C.trips, C.last, C.daysIdle,
              { key: 'phone', label: t('الجوال', 'Phone'), render: (r: Row) => (r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') }]} />
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
      <TeamPerformance />
      <DrillModal drill={drill} onClose={() => setDrill(null)} ar={ar} />
    </div>
  );
}
