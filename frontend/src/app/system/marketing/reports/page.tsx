'use client';
// Periodic marketing report (التقرير الدوري) — the page a marketing manager
// opens to answer "what did we do this week?": pick daily / weekly / monthly and
// a date range, and every activity in the window is bucketed into periods with
// its posts, impressions, clicks, leads, engagement and spend. Exportable to
// Excel so it can be pasted straight into the management update.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { BarChart3, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import { Spinner, PageHeader, StatCard, ExportButton } from '@/components/hr/HRKit';
import { exportToExcel } from '@/utils/exportExcel';
import RangePicker from '@/components/marketing/RangePicker';
import {
  isMarketingStaff, REPORT_PERIODS, periodLabel, thisMonthToDate, num, money, pct,
  type Lang, type DateRange, type Report, type ReportPeriod,
} from '@/lib/marketing';

export default function MarketingReportsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const L = lang as Lang;

  const [period, setPeriod] = useState<ReportPeriod>('weekly');
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setR(await api.get<Report>(`/api/marketing/report?period=${period}&from=${range.from}&to=${range.to}`));
    } catch { /* keep previous */ }
    setLoading(false);
  }, [period, range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  useSocket('marketing:updated', useCallback(() => load(), [load]));

  const doExport = () => {
    if (!r) return;
    exportToExcel(
      r.rows as unknown as Record<string, unknown>[],
      [
        { header: ar ? 'الفترة' : 'Period', key: 'label', transform: (v) => v || '', width: 34 },
        { header: ar ? 'الأنشطة' : 'Activities', key: 'activities', transform: (v) => v ?? 0, width: 12 },
        { header: ar ? 'مرات الظهور' : 'Impressions', key: 'impressions', transform: (v) => v ?? 0, width: 14 },
        { header: ar ? 'الوصول' : 'Reach', key: 'reach', transform: (v) => v ?? 0, width: 12 },
        { header: ar ? 'النقرات' : 'Clicks', key: 'clicks', transform: (v) => v ?? 0, width: 12 },
        { header: ar ? 'التفاعلات' : 'Engagements', key: 'engagements', transform: (v) => v ?? 0, width: 14 },
        { header: ar ? 'العملاء المحتملون' : 'Leads', key: 'leads', transform: (v) => v ?? 0, width: 14 },
        { header: ar ? 'التحويلات' : 'Conversions', key: 'conversions', transform: (v) => v ?? 0, width: 14 },
        { header: ar ? 'الإنفاق' : 'Spend', key: 'spend', transform: (v) => v ?? 0, width: 14 },
      ],
      `marketing-report-${period}-${range.from}-${range.to}`,
      ar ? 'التقرير' : 'Report'
    );
  };

  if (!isMarketingStaff(user?.role)) {
    return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول إلى قسم التسويق.' : 'You are not authorized to view the Marketing section.'}</div>;
  }
  if (loading && !r) return <Spinner />;
  if (!r) return <div className="text-slate-500 p-8">{ar ? 'لا توجد بيانات.' : 'No data.'}</div>;

  const s = r.summary;
  const cards = [
    { label: ar ? 'عدد الفترات' : 'Periods', value: num(s.buckets), accent: 'text-slate-700' },
    { label: ar ? 'إجمالي الأنشطة' : 'Total activities', value: num(s.activities), accent: 'text-slate-900' },
    { label: ar ? 'متوسط لكل فترة' : 'Avg per period', value: s.avgActivitiesPerBucket.toFixed(1), accent: 'text-slate-700' },
    { label: ar ? 'مرات الظهور' : 'Impressions', value: num(s.impressions), accent: 'text-blue-600' },
    { label: ar ? 'الوصول' : 'Reach', value: num(s.reach), accent: 'text-sky-600' },
    { label: ar ? 'النقرات' : 'Clicks', value: num(s.clicks), accent: 'text-indigo-600' },
    { label: ar ? 'التفاعلات' : 'Engagements', value: num(s.engagements), accent: 'text-purple-600' },
    { label: ar ? 'العملاء المحتملون' : 'Leads', value: num(s.leads), accent: 'text-emerald-600' },
    { label: ar ? 'الإنفاق' : 'Spend', value: money(s.spend, L), accent: 'text-[#f37121]' },
    { label: ar ? 'معدل النقر (CTR)' : 'CTR', value: pct(s.ctr), accent: 'text-purple-600' },
    { label: ar ? 'تكلفة العميل (CPL)' : 'CPL', value: money(s.cpl, L), accent: 'text-amber-600' },
  ];

  // The bucket key is already short (2026-03, 2026-W12, 2026-03-14); the full
  // label with the week's date span goes in the table, not the axis.
  const chartRows = r.rows.map((row) => ({ ...row, axis: row.bucket }));

  const chip = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        title={ar ? 'التقرير الدوري للتسويق' : 'Marketing Periodic Report'}
        subtitle={ar ? 'ما تم إنجازه يومياً أو أسبوعياً أو شهرياً' : 'What was accomplished daily, weekly or monthly'}
      >
        <ExportButton onClick={doExport} label={ar ? 'تصدير Excel' : 'Export Excel'} />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(REPORT_PERIODS) as ReportPeriod[]).map((k) => (
          <button key={k} type="button" onClick={() => setPeriod(k)} className={chip(period === k)}>{periodLabel(k, L)}</button>
        ))}
      </div>

      <RangePicker value={range} onChange={setRange} lang={L} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} accent={c.accent} />)}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3 text-start">
          {ar ? `النتائج لكل فترة (${periodLabel(period, L)})` : `Results per period (${periodLabel(period, L)})`}
        </h2>
        {chartRows.length === 0 ? (
          <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد بيانات في هذه الفترة.' : 'No data in this period.'}</p>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="axis" tick={{ fontSize: 11, fill: '#64748b' }} reversed={isRTL} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} orientation={isRTL ? 'right' : 'left'} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="activities" name={ar ? 'الأنشطة' : 'Activities'} fill="#f37121" radius={[6, 6, 0, 0]} />
                <Bar dataKey="clicks" name={ar ? 'النقرات' : 'Clicks'} fill="#6366f1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="leads" name={ar ? 'العملاء المحتملون' : 'Leads'} fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الفترة' : 'Period'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الأنشطة' : 'Activities'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الظهور' : 'Impressions'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الوصول' : 'Reach'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النقرات' : 'Clicks'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'التفاعلات' : 'Engagements'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'محتملون' : 'Leads'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'التحويلات' : 'Conversions'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الإنفاق' : 'Spend'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">{ar ? 'لا توجد بيانات في هذه الفترة.' : 'No data in this period.'}</td></tr>
              ) : r.rows.map((row) => (
                <tr key={row.bucket} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-start text-slate-800 font-medium whitespace-nowrap">{row.label}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-800">{num(row.activities)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(row.impressions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(row.reach)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(row.clicks)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-purple-600">{num(row.engagements)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-emerald-600 font-medium">{num(row.leads)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-teal-600">{num(row.conversions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700 whitespace-nowrap">{money(row.spend, L)}</td>
                </tr>
              ))}
            </tbody>
            {r.rows.length > 0 && (
              <tfoot className="bg-slate-50 font-semibold text-slate-800">
                <tr>
                  <td className="px-4 py-3 text-start">{ar ? 'الإجمالي' : 'Total'}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.activities)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.impressions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.reach)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.clicks)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.engagements)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.leads)}</td>
                  <td className="px-4 py-3 text-start tabular-nums">{num(s.conversions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums whitespace-nowrap">{money(s.spend, L)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
